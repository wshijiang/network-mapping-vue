<script setup>
import { tr } from '../i18n/index.js'

import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import EmptyState from '@/components/EmptyState.vue'
import ChartCsvExport from '@/components/ChartCsvExport.vue'
import NetworkProxySettings from '@/components/NetworkProxySettings.vue'
import SystemDateTimeInput from '@/components/SystemDateTimeInput.vue'
import { useChartTheme } from '@/composables/useChartTheme'
import { renderChartTooltip } from '@/utils/chartTooltip'
import { formatDateTime as formatSystemDateTime, formatTime as formatSystemClock, localToIso } from '../i18n/time.js'
import http from '@/utils/http'

const ApexChart = defineAsyncComponent(() => import('vue3-apexcharts/core'))

const formFieldId = useId()

const alerts = ref([])
const loading = ref(false)
const loadFailed = ref(false)
const saving = ref(false)
const revision = ref(0)
const changeReason = ref('')
const savedSnapshot = ref('')

function defaultSettings() {
  return {
    enabled: false,
    facility: 'local0',
    appName: 'network-mapping',
    minLevel: 'info',
    forwardAuditEvents: true,
    forwardAccessLogs: true,
    forwardScannerDiagnostics: true,
    queueCapacity: 8192,
    metricsRetentionDays: 30,
    targets: [],
    alerts: {
      windowMinutes: 5,
      cooldownSeconds: 1800,
      failureRate: { enabled: true, warningPercent: 5, criticalPercent: 20, minSamples: 20 },
      latencyP95: { enabled: false, warningMs: 1000, criticalMs: 5000 },
      latencyP99: { enabled: false, warningMs: 2000, criticalMs: 10000 }
    }
  }
}

const settings = ref(defaultSettings())
const dirty = computed(() => revision.value > 0 && JSON.stringify(settings.value) !== savedSnapshot.value)

const facilityOptions = [
  'kern', 'user', 'mail', 'daemon', 'auth', 'syslog', 'lpr', 'news', 'uucp', 'cron', 'authpriv', 'ftp',
  'local0', 'local1', 'local2', 'local3', 'local4', 'local5', 'local6', 'local7'
]
const levelOptions = [
  { value: 'error', get label() { return tr("错误") } },
  { value: 'warn', get label() { return tr("警告") } },
  { value: 'info', get label() { return tr("信息") } },
  { value: 'debug', get label() { return tr("调试") } }
]
const protocolOptions = [
  { value: 'udp', label: 'UDP', defaultPort: 514 },
  { value: 'tcp', label: 'TCP', defaultPort: 514 },
  { value: 'tls', label: 'TLS', defaultPort: 6514 }
]

function pushAlert(type, title, description = '', timeout = 7000) {
  alerts.value.unshift({ id: crypto.randomUUID(), type, title, description, timeout })
}
function closeAlert(id) {
  alerts.value = alerts.value.filter((alert) => alert.id !== id)
}
function formatTime(value) {
  if (!value) return '--'
  return formatSystemDateTime(new Date(value))
}

// ---- 配置加载 / 保存 ----

function applyDocument(document, nextRevision) {
  settings.value = { ...defaultSettings(), ...document, alerts: { ...defaultSettings().alerts, ...(document.alerts || {}) } }
  revision.value = nextRevision
  savedSnapshot.value = JSON.stringify(settings.value)
  changeReason.value = ''
}

async function load() {
  loading.value = true
  try {
    const response = await http.get('/api/config/runtime/syslog')
    const data = response.data?.data
    if (!data?.document || !Number.isInteger(data.revision)) throw new Error('invalid response')
    applyDocument(data.document, data.revision)
    loadFailed.value = false
  } catch (error) {
    console.error('load syslog config failed', error)
    loadFailed.value = true
    pushAlert('error', tr("Syslog 配置加载失败"), error.response?.data?.message || tr("请检查网络连接后重试。"))
  } finally {
    loading.value = false
  }
}

async function save() {
  if (saving.value || !revision.value) return
  for (const target of settings.value.targets) {
    if (!target.name?.trim() || !target.host?.trim()) {
      pushAlert('error', tr("无法保存"), tr("每个服务器都必须填写名称和地址。"))
      return
    }
  }
  saving.value = true
  try {
    const response = await http.post('/api/config/runtime/syslog', {
      expectedRevision: revision.value,
      document: settings.value,
      changeReason: changeReason.value.trim()
    })
    const data = response.data?.data
    if (!data?.document || !Number.isInteger(data.revision)) throw new Error('invalid response')
    applyDocument(data.document, data.revision)
    pushAlert('success', tr("Syslog 配置已保存"), tr("当前版本 #{0}，转发管道已热更新。", [data.revision]))
    loadStatus()
  } catch (error) {
    console.error('save syslog config failed', error)
    if (error.response?.status === 409) {
      pushAlert('error', tr("保存冲突"), tr("配置已被其他管理员更新，请点击“重新加载”后再保存。"))
    } else {
      pushAlert('error', tr("Syslog 配置保存失败"), error.response?.data?.message || tr("请检查网络连接后重试。"))
    }
  } finally {
    saving.value = false
  }
}

// ---- 目标编辑 ----

const targetDialog = ref(null)
const targetDraft = ref(null)
const targetDraftIndex = ref(-1)

function openAddTarget() {
  targetDraftIndex.value = -1
  targetDraft.value = {
    id: crypto.randomUUID(),
    name: '',
    host: '',
    port: 514,
    protocol: 'udp',
    enabled: true,
    tls: { caFile: '', verify: true, serverName: '' },
    sources: ['system', 'audit', 'access', 'scanner']
  }
  targetDialog.value?.showModal()
}

function openEditTarget(index) {
  targetDraftIndex.value = index
  const draft = JSON.parse(JSON.stringify(settings.value.targets[index]))
  // 兼容旧文档：缺失 sources 时按全部类型处理，避免复选框渲染报错。
  if (!Array.isArray(draft.sources) || !draft.sources.length) {
    draft.sources = ['system', 'audit', 'access', 'scanner']
  }
  targetDraft.value = draft
  targetDialog.value?.showModal()
}

function onDraftProtocolChange() {
  const option = protocolOptions.find((item) => item.value === targetDraft.value.protocol)
  if (option) targetDraft.value.port = option.defaultPort
}

function toggleDraftSource(key) {
  const list = targetDraft.value.sources
  const index = list.indexOf(key)
  if (index >= 0) list.splice(index, 1)
  else list.push(key)
}

function sourcesLabel(target) {
  const list = target.sources || ['system', 'audit', 'access', 'scanner']
  if (list.length === 4) return tr("全部")
  return list.map((key) => sourceLabels[key] || key).join('、')
}

function confirmTarget() {
  const draft = targetDraft.value
  if (!draft.name.trim() || !draft.host.trim()) {
    pushAlert('error', tr("无法保存服务器"), tr("名称和地址为必填项。"))
    return
  }
  if (!Number.isInteger(draft.port) || draft.port < 1 || draft.port > 65535) {
    pushAlert('error', tr("无法保存服务器"), tr("端口必须为 1～65535。"))
    return
  }
  if (!draft.sources.length) {
    pushAlert('error', tr("无法保存服务器"), tr("至少选择一种日志类型。"))
    return
  }
  if (targetDraftIndex.value === -1) {
    settings.value.targets.push(draft)
  } else {
    settings.value.targets[targetDraftIndex.value] = draft
  }
  targetDialog.value?.close()
}

function removeTarget(index) {
  const target = settings.value.targets[index]
  if (!window.confirm(tr("确定删除服务器「{0}」？保存后生效。", [target.name]))) return
  settings.value.targets.splice(index, 1)
}

// ---- 状态 ----

const status = ref({ enabled: false, queue: { capacity: 0, enqueueDrops: 0 }, proxy: { mode: 'direct', endpoint: null, remoteDns: false }, targets: [] })
const statusLoading = ref(false)
let statusTimer = null

const statusById = computed(() => Object.fromEntries(status.value.targets.map((item) => [item.id, item])))

function stateBadge(target) {
  const state = statusById.value[target.id]?.state || (target.enabled ? 'connecting' : 'disabled')
  if (!target.enabled || state === 'disabled') return { get text() { return tr("已停用") }, class: 'badge-ghost' }
  if (state === 'connected') return { get text() { return tr("在线") }, class: 'badge-success' }
  if (state === 'error') return { get text() { return tr("错误") }, class: 'badge-error' }
  return { get text() { return tr("连接中") }, class: 'badge-warning' }
}

async function loadStatus({ silent = false } = {}) {
  if (statusLoading.value) return
  statusLoading.value = true
  try {
    const response = await http.get('/api/syslog/status')
    if (response.data?.success === true) status.value = response.data.data
  } catch (error) {
    console.error('load syslog status failed', error)
    if (!silent) pushAlert('error', tr("Syslog 状态加载失败"), tr("请稍后重试。"))
  } finally {
    statusLoading.value = false
  }
}

const testingId = ref('')
async function testTarget(target) {
  if (testingId.value) return
  testingId.value = target.id
  try {
    // 直接提交当前表单值：未保存的新建/编辑中的服务器也能测试连接。
    const response = await http.post('/api/syslog/test', {
      host: target.host,
      port: target.port,
      protocol: target.protocol,
      tls: target.tls
    })
    const data = response.data?.data
    if (data?.success) {
      pushAlert('success', tr("测试成功"), tr("已向 {0} 发送测试消息，耗时 {1} ms。", [target.name, Number(data.latencyMs || 0).toFixed(1)]))
    } else {
      pushAlert('error', tr("测试失败"), data?.error || tr("无法连接到该服务器。"))
    }
  } catch (error) {
    pushAlert('error', tr("测试失败"), error.response?.data?.message || tr("请检查网络连接后重试。"))
  } finally {
    testingId.value = ''
    loadStatus({ silent: true })
  }
}

// ---- 统计 ----

const statsWindow = ref('24h')
const statsGranularity = ref('auto')
const statsTarget = ref('')
const statsLoading = ref(false)
const statsFailed = ref(false)
const summary = ref({ sent: 0, failed: 0, dropped: 0, failure_rate: 0, p95_ms: null, p99_ms: null, by_source: {} })
const trend = ref([])

const windowOptions = [
  { value: '1h', get label() { return tr("最近 1 小时") } },
  { value: '24h', get label() { return tr("最近 24 小时") } },
  { value: '7d', get label() { return tr("最近 7 天") } }
]
const granularityOptions = [
  { value: 'auto', get label() { return tr("自动") } },
  { value: '1m', get label() { return tr("1 分钟") } },
  { value: '5m', get label() { return tr("5 分钟") } },
  { value: '15m', get label() { return tr("15 分钟") } },
  { value: '30m', get label() { return tr("30 分钟") } },
  { value: '1h', get label() { return tr("1 小时") } },
  { value: '2h', get label() { return tr("2 小时") } },
  { value: '6h', get label() { return tr("6 小时") } }
]
const sourceLabels = {
  get system() { return tr("系统日志") },
  get audit() { return tr("审计事件") },
  get access() { return tr("IP 访问日志") },
  get scanner() { return tr("扫描器诊断") }
}
const sourceColors = { system: '#3b82f6', audit: '#8b5cf6', access: '#10b981', scanner: '#f59e0b' }

async function loadStats() {
  statsLoading.value = true
  try {
    const params = { window: statsWindow.value, granularity: statsGranularity.value }
    if (statsTarget.value) params.target_id = statsTarget.value
    const response = await http.get('/api/syslog/statistics', { params })
    const data = response.data?.data
    if (!data) throw new Error('invalid response')
    summary.value = data.summary
    trend.value = data.trend || []
    statsFailed.value = false
  } catch (error) {
    console.error('load syslog statistics failed', error)
    statsFailed.value = true
  } finally {
    statsLoading.value = false
  }
}

const failureRatePercent = computed(() => (Number(summary.value.failure_rate || 0) * 100).toFixed(2))

function points(field, scale = 1) {
  return trend.value.map((point) => ({ x: point.bucket, y: Number(point[field] || 0) * scale }))
}

const volumeSeries = computed(() => [
  { get name() { return tr("已发送") }, data: points('sent'), color: '#3b82f6' },
  { get name() { return tr("失败") }, data: points('failed'), color: '#ef4444' },
  { get name() { return tr("丢弃") }, data: points('dropped'), color: '#f59e0b' }
])
const volumeOptions = useChartTheme(() => ({
  chart: { type: 'line', toolbar: { show: false } },
  dataLabels: { enabled: false },
  stroke: { curve: 'smooth', width: 2 },
  xaxis: { type: 'datetime', labels: { datetimeUTC: true, formatter: (value, timestamp) => formatSystemClock(timestamp ?? value) } },
  yaxis: { labels: { formatter: (value) => Number(value).toLocaleString('zh-CN') } },
  legend: { position: 'top' },
  tooltip: { shared: true, intersect: false }
}))

const failureSeries = computed(() => [
  { get name() { return tr("失败率 %") }, data: points('failure_rate', 100), color: '#ef4444' }
])
const failureOptions = useChartTheme(() => ({
  chart: { type: 'area', toolbar: { show: false } },
  dataLabels: { enabled: false },
  stroke: { curve: 'smooth', width: 2 },
  fill: { opacity: 0.15 },
  xaxis: { type: 'datetime', labels: { datetimeUTC: true, formatter: (value, timestamp) => formatSystemClock(timestamp ?? value) } },
  yaxis: { labels: { formatter: (value) => `${Number(value).toFixed(1)}%` } },
  legend: { position: 'top' },
  tooltip: { shared: true, intersect: false, y: { formatter: (value) => `${Number(value).toFixed(2)}%` } }
}))

const latencySeries = computed(() => [
  { name: 'P95', data: trend.value.map((point) => ({ x: point.bucket, y: point.p95_ms })), color: '#8b5cf6' },
  { name: 'P99', data: trend.value.map((point) => ({ x: point.bucket, y: point.p99_ms })), color: '#ec4899' }
])
const latencyOptions = useChartTheme(() => ({
  chart: { type: 'line', toolbar: { show: false } },
  dataLabels: { enabled: false },
  stroke: { curve: 'smooth', width: 2 },
  xaxis: { type: 'datetime', labels: { datetimeUTC: true, formatter: (value, timestamp) => formatSystemClock(timestamp ?? value) } },
  yaxis: { labels: { formatter: (value) => `${Number(value).toFixed(0)} ms` } },
  legend: { position: 'top' },
  tooltip: { shared: true, intersect: false, y: { formatter: (value) => value == null ? '--' : `${Number(value).toFixed(1)} ms` } }
}))

const sourceSeries = computed(() => Object.keys(sourceLabels).map((key) => ({
  get name() { return sourceLabels[key] },
  data: trend.value.map((point) => ({ x: point.bucket, y: Number(point.by_source?.[key] || 0) })),
  color: sourceColors[key]
})))
const sourceOptions = useChartTheme(() => ({
  chart: { type: 'area', toolbar: { show: false }, stacked: true },
  dataLabels: { enabled: false },
  stroke: { curve: 'smooth', width: 1 },
  fill: { opacity: 0.35 },
  xaxis: { type: 'datetime', labels: { datetimeUTC: true, formatter: (value, timestamp) => formatSystemClock(timestamp ?? value) } },
  yaxis: { labels: { formatter: (value) => Number(value).toLocaleString('zh-CN') } },
  legend: { position: 'top' },
  tooltip: { shared: true, intersect: false }
}))

function statsTooltipRows(point) {
  return [
    { label: tr("已发送"), value: Number(point.sent).toLocaleString('zh-CN'), color: '#3b82f6' },
    { label: tr("失败"), value: Number(point.failed).toLocaleString('zh-CN'), color: '#ef4444' },
    { label: tr("丢弃"), value: Number(point.dropped).toLocaleString('zh-CN'), color: '#f59e0b' }
  ]
}
const volumeTooltipOptions = useChartTheme(() => ({
  ...volumeOptions.value,
  tooltip: {
    shared: true,
    intersect: false,
    custom({ dataPointIndex }) {
      const point = trend.value[dataPointIndex]
      if (!point) return ''
      return renderChartTooltip({ title: formatTime(point.bucket), rows: statsTooltipRows(point) })
    }
  }
}))

// ---- 历史日志回填 ----

const backfillMode = ref('days')
const backfillDays = ref(7)
const backfillStart = ref('')
const backfillEnd = ref('')
const backfillJobs = ref([])
const backfillCreating = ref(false)
const backfillCanceling = ref('')

const backfillStatusLabels = {
  get queued() { return { text: tr("排队中"), class: 'badge-warning' } },
  get running() { return { text: tr("执行中"), class: 'badge-info' } },
  get succeeded() { return { text: tr("已完成"), class: 'badge-success' } },
  get failed() { return { text: tr("失败"), class: 'badge-error' } },
  get cancelled() { return { text: tr("已取消"), class: 'badge-ghost' } }
}

async function loadJobs() {
  try {
    const response = await http.get('/api/syslog/backfill')
    if (response.data?.success === true) backfillJobs.value = response.data.data || []
  } catch (error) {
    console.error('load syslog backfill jobs failed', error)
  }
}

async function createBackfill() {
  if (backfillCreating.value) return
  const payload = {}
  if (backfillMode.value === 'days') {
    payload.days = backfillDays.value
  } else {
    if (!backfillStart.value || !backfillEnd.value) {
      pushAlert('error', tr("无法下发回填"), tr("自定义时间段必须填写开始与结束时间。"))
      return
    }
    try {
      payload.start = localToIso(backfillStart.value)
      payload.end = localToIso(backfillEnd.value)
    } catch (error) {
      pushAlert('error', tr("无法下发回填"), error.message || tr("时间格式无效。"))
      return
    }
  }
  backfillCreating.value = true
  try {
    const response = await http.post('/api/syslog/backfill', payload)
    if (response.data?.success === true) {
      pushAlert('success', tr("回填任务已下发"), tr("任务将由服务端后台执行，可在下方查看进度。"))
      loadJobs()
    } else {
      pushAlert('error', tr("回填任务下发失败"), response.data?.message || tr("请稍后重试。"))
    }
  } catch (error) {
    pushAlert('error', tr("回填任务下发失败"), error.response?.data?.message || tr("请检查网络连接后重试。"))
  } finally {
    backfillCreating.value = false
  }
}

async function cancelBackfill(job) {
  if (backfillCanceling.value) return
  if (!window.confirm(tr("确定取消该回填任务？"))) return
  backfillCanceling.value = job.id
  try {
    const response = await http.post(`/api/syslog/backfill/${job.id}/cancel`)
    if (response.data?.success === true) {
      pushAlert('success', tr("已请求取消"), tr("执行中的任务会在当前批次结束后停止。"))
      loadJobs()
    } else {
      pushAlert('error', tr("取消失败"), response.data?.message || tr("任务可能已结束。"))
    }
  } catch (error) {
    pushAlert('error', tr("取消失败"), error.response?.data?.message || tr("请检查网络连接后重试。"))
  } finally {
    backfillCanceling.value = ''
  }
}

onMounted(() => {
  load()
  loadStatus()
  loadStats()
  loadJobs()
  statusTimer = setInterval(() => {
    loadStatus({ silent: true })
    loadJobs()
  }, 10000)
})
onBeforeUnmount(() => {
  if (statusTimer) clearInterval(statusTimer)
})
</script>

<template>
  <div class="pointer-events-none fixed right-4 top-20 z-50 flex w-[calc(100vw-2rem)] flex-col items-end gap-2 sm:w-auto">
    <AppAlert
      v-for="alert in alerts"
      :key="alert.id"
      class="pointer-events-auto"
      :type="alert.type"
      :title="alert.title"
      :description="alert.description"
      :timeout="alert.timeout"
      @close="closeAlert(alert.id)"
    />
  </div>

  <main class="page-shell">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="page-title">{{ tr("Syslog 转发") }}</h1>
        <p class="mt-1 text-sm text-base-content/60">{{ tr("把系统日志、审计事件、IP 访问日志与扫描器诊断以 RFC 5424 转发到远程 syslog 服务器。") }}</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="badge badge-ghost badge-sm shrink-0">{{ tr("已保存版本 #") }}{{ revision || '—' }}</span>
        <button type="button" class="btn btn-ghost btn-sm" :disabled="loading" @click="load">{{ tr("重新加载") }}</button>
      </div>
    </div>

    <div v-if="loading" class="grid min-h-80 place-items-center"><span class="loading loading-spinner loading-lg" /></div>
    <EmptyState
      v-else-if="loadFailed"
      type="error"
      :title="tr(&quot;Syslog 配置加载失败&quot;)"
      :message="tr(&quot;请检查网络连接后点击“重新加载”。&quot;)"
    />

    <template v-else-if="revision">
      <!-- Syslog 设置 + 网络代理 + 服务器列表 + 通知策略（同一卡片，分割线分隔） -->
      <section class="card border border-base-300 bg-base-100 p-5 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="font-semibold">{{ tr("Syslog 设置") }}</h2>
          <label class="label cursor-pointer gap-2">
            <span class="label-text">{{ tr("启用转发") }}</span>
            <input v-model="settings.enabled" type="checkbox" class="toggle toggle-neutral" />
          </label>
        </div>
        <div class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <fieldset class="fieldset w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-facility`">{{ tr("Facility") }}</label></legend>
            <select :id="`${formFieldId}-facility`" v-model="settings.facility" class="select select-bordered w-full">
              <option v-for="item in facilityOptions" :key="item" :value="item">{{ item }}</option>
            </select>
          </fieldset>
          <fieldset class="fieldset w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-app-name`">{{ tr("应用名") }}</label></legend>
            <input :id="`${formFieldId}-app-name`" v-model="settings.appName" type="text" maxlength="48" class="input input-bordered w-full" />
          </fieldset>
          <fieldset class="fieldset w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-min-level`">{{ tr("系统日志最低级别") }}</label></legend>
            <select :id="`${formFieldId}-min-level`" v-model="settings.minLevel" class="select select-bordered w-full">
              <option v-for="item in levelOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </fieldset>
          <fieldset class="fieldset w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-queue-capacity`">{{ tr("队列容量") }}</label></legend>
            <input :id="`${formFieldId}-queue-capacity`" v-model.number="settings.queueCapacity" type="number" min="1024" max="100000" class="input input-bordered w-full" />
          </fieldset>
        </div>
        <div class="mt-4 flex flex-wrap gap-x-8 gap-y-3">
          <label class="label cursor-pointer gap-2">
            <input v-model="settings.forwardAuditEvents" type="checkbox" class="toggle toggle-sm" />
            <span class="label-text">{{ tr("转发审计事件") }}</span>
          </label>
          <label class="label cursor-pointer gap-2">
            <input v-model="settings.forwardAccessLogs" type="checkbox" class="toggle toggle-sm" />
            <span class="label-text">{{ tr("转发 IP 访问日志") }}</span>
          </label>
          <label class="label cursor-pointer gap-2">
            <input v-model="settings.forwardScannerDiagnostics" type="checkbox" class="toggle toggle-sm" />
            <span class="label-text">{{ tr("转发扫描器诊断事件") }}</span>
          </label>
          <label class="label cursor-pointer gap-2">
            <span class="label-text">{{ tr("指标保留天数") }}</span>
            <input v-model.number="settings.metricsRetentionDays" type="number" min="1" max="365" class="input input-bordered input-sm w-24" />
          </label>
        </div>
        <p class="mt-3 text-xs text-base-content/60">{{ tr("队列满时新消息被丢弃并计数，不会阻塞业务请求；转发失败不影响本地日志与审计。") }}</p>

        <div class="divider"></div>

        <!-- 网络代理：syslog 跟随该全局设置，仅 SOCKS5 生效 -->
        <NetworkProxySettings />

        <div class="divider"></div>

        <!-- 服务器列表 -->
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="font-semibold">{{ tr("Syslog 服务器") }}</h2>
            <p class="mt-1 text-xs text-base-content/60">
              {{ tr("最多 10 个目标，各自独立选择协议与端口。状态每 10 秒刷新；UDP 为无连接协议，状态反映最近发送结果。") }}
            </p>
            <p class="mt-2 text-xs">
              <span class="badge badge-outline badge-sm mr-1">{{ tr("代理") }}</span>
              <template v-if="status.proxy?.mode === 'socks5'">SOCKS5 {{ status.proxy.endpoint }}{{ status.proxy.remoteDns ? tr("（代理侧解析域名）") : "" }} · {{ tr("TCP/TLS/UDP 均生效") }}</template>
              <template v-else>{{ tr("直连（全局代理非 SOCKS5 或未配置，已自动回退）") }}</template>
            </p>
            <p class="mt-1 text-xs text-base-content/60">{{ tr("跟随上方网络代理设置，仅 SOCKS5（socks5/socks5h）生效，其余自动回退直连；UDP 经 SOCKS5 UDP ASSOCIATE 中继转发。") }}</p>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="statusLoading" class="loading loading-spinner loading-sm" />
            <button type="button" class="btn btn-neutral btn-sm" @click="openAddTarget">{{ tr("添加服务器") }}</button>
          </div>
        </div>
        <EmptyState v-if="!settings.targets.length" class="mt-4" :title="tr(&quot;尚未配置服务器&quot;)" :message="tr(&quot;点击“添加服务器”配置第一台远程 syslog 服务器。&quot;)" />
        <div v-else class="mt-4 overflow-x-auto">
          <table class="table table-zebra">
            <thead>
              <tr>
                <th>{{ tr("名称") }}</th>
                <th>{{ tr("地址") }}</th>
                <th>{{ tr("协议") }}</th>
                <th>{{ tr("日志类型") }}</th>
                <th>{{ tr("状态") }}</th>
                <th>{{ tr("已发送 / 失败 / 丢弃") }}</th>
                <th>{{ tr("最近成功") }}</th>
                <th>{{ tr("最近错误") }}</th>
                <th class="text-right">{{ tr("操作") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(target, index) in settings.targets" :key="target.id">
                <td class="font-medium">
                  {{ target.name }}
                  <span v-if="!target.enabled" class="badge badge-ghost badge-sm ml-1">{{ tr("已停用") }}</span>
                </td>
                <td class="whitespace-nowrap font-mono text-sm">{{ target.host }}:{{ target.port }}</td>
                <td><span class="badge badge-outline uppercase">{{ target.protocol }}</span></td>
                <td class="max-w-44 text-sm">{{ sourcesLabel(target) }}</td>
                <td><span class="badge" :class="stateBadge(target).class">{{ stateBadge(target).text }}</span></td>
                <td class="whitespace-nowrap text-sm">
                  {{ statusById[target.id]?.sent ?? 0 }} /
                  <span :class="{ 'text-error': (statusById[target.id]?.failed ?? 0) > 0 }">{{ statusById[target.id]?.failed ?? 0 }}</span> /
                  <span :class="{ 'text-warning': (statusById[target.id]?.dropped ?? 0) > 0 }">{{ statusById[target.id]?.dropped ?? 0 }}</span>
                </td>
                <td class="whitespace-nowrap text-sm">{{ formatTime(statusById[target.id]?.lastSuccessAt) }}</td>
                <td class="max-w-56 text-sm">
                  <span class="block truncate" :title="statusById[target.id]?.lastError || ''">{{ statusById[target.id]?.lastError || '--' }}</span>
                  <span class="text-xs text-base-content/50">{{ formatTime(statusById[target.id]?.lastErrorAt) }}</span>
                </td>
                <td class="whitespace-nowrap text-right">
                  <button type="button" class="btn btn-ghost btn-xs" :disabled="!!testingId || !target.enabled" @click="testTarget(target)">
                    <span v-if="testingId === target.id" class="loading loading-spinner loading-xs" />
                    {{ tr("测试") }}
                  </button>
                  <button type="button" class="btn btn-ghost btn-xs" @click="openEditTarget(index)">{{ tr("编辑") }}</button>
                  <button type="button" class="btn btn-ghost btn-xs text-error" @click="removeTarget(index)">{{ tr("删除") }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="status.queue.enqueueDrops > 0" class="mt-3 text-xs text-warning">
          {{ tr("入队丢弃累计：{0}（队列容量 {1}）", [status.queue.enqueueDrops, status.queue.capacity]) }}
        </p>

        <div class="divider"></div>

        <!-- 通知策略 -->
        <h2 class="font-semibold">{{ tr("通知策略") }}</h2>
        <p class="mt-1 text-xs text-base-content/60">{{ tr("三条规则可独立开启；命中后经健康告警渠道通知管理员（邮件与已配置的通知渠道）。") }}</p>
        <div class="mt-4 grid gap-4 sm:grid-cols-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-alert-window`">{{ tr("统计窗口（分钟）") }}</label></legend>
            <input :id="`${formFieldId}-alert-window`" v-model.number="settings.alerts.windowMinutes" type="number" min="1" max="60" class="input input-bordered w-full" />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-alert-cooldown`">{{ tr("告警冷却（秒）") }}</label></legend>
            <input :id="`${formFieldId}-alert-cooldown`" v-model.number="settings.alerts.cooldownSeconds" type="number" min="60" max="604800" class="input input-bordered w-full" />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-alert-min-samples`">{{ tr("失败率最小样本数") }}</label></legend>
            <input :id="`${formFieldId}-alert-min-samples`" v-model.number="settings.alerts.failureRate.minSamples" type="number" min="1" max="100000" class="input input-bordered w-full" />
          </fieldset>
        </div>
        <div class="mt-4 space-y-3">
          <div class="flex flex-wrap items-center gap-3 rounded-box border border-base-300 p-3">
            <label class="label cursor-pointer gap-2">
              <input v-model="settings.alerts.failureRate.enabled" type="checkbox" class="toggle toggle-sm toggle-neutral" />
              <span class="label-text font-medium">{{ tr("整体失败率") }}</span>
            </label>
            <label class="label gap-2">
              <span class="label-text text-xs">{{ tr("警告 %") }}</span>
              <input v-model.number="settings.alerts.failureRate.warningPercent" type="number" min="0" max="100" step="0.1" class="input input-bordered input-sm w-24" />
            </label>
            <label class="label gap-2">
              <span class="label-text text-xs">{{ tr("严重 %") }}</span>
              <input v-model.number="settings.alerts.failureRate.criticalPercent" type="number" min="0" max="100" step="0.1" class="input input-bordered input-sm w-24" />
            </label>
          </div>
          <div class="flex flex-wrap items-center gap-3 rounded-box border border-base-300 p-3">
            <label class="label cursor-pointer gap-2">
              <input v-model="settings.alerts.latencyP95.enabled" type="checkbox" class="toggle toggle-sm toggle-neutral" />
              <span class="label-text font-medium">{{ tr("发送耗时 P95") }}</span>
            </label>
            <label class="label gap-2">
              <span class="label-text text-xs">{{ tr("警告 ms") }}</span>
              <input v-model.number="settings.alerts.latencyP95.warningMs" type="number" min="1" class="input input-bordered input-sm w-28" />
            </label>
            <label class="label gap-2">
              <span class="label-text text-xs">{{ tr("严重 ms") }}</span>
              <input v-model.number="settings.alerts.latencyP95.criticalMs" type="number" min="1" class="input input-bordered input-sm w-28" />
            </label>
          </div>
          <div class="flex flex-wrap items-center gap-3 rounded-box border border-base-300 p-3">
            <label class="label cursor-pointer gap-2">
              <input v-model="settings.alerts.latencyP99.enabled" type="checkbox" class="toggle toggle-sm toggle-neutral" />
              <span class="label-text font-medium">{{ tr("发送耗时 P99") }}</span>
            </label>
            <label class="label gap-2">
              <span class="label-text text-xs">{{ tr("警告 ms") }}</span>
              <input v-model.number="settings.alerts.latencyP99.warningMs" type="number" min="1" class="input input-bordered input-sm w-28" />
            </label>
            <label class="label gap-2">
              <span class="label-text text-xs">{{ tr("严重 ms") }}</span>
              <input v-model.number="settings.alerts.latencyP99.criticalMs" type="number" min="1" class="input input-bordered input-sm w-28" />
            </label>
          </div>
        </div>

        <div class="divider"></div>

        <!-- 保存 -->
        <div class="flex flex-wrap items-start gap-3">
          <fieldset class="fieldset grow">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-change-reason`">{{ tr("变更原因（可选）") }}</label></legend>
            <input :id="`${formFieldId}-change-reason`" v-model="changeReason" type="text" maxlength="500" class="input input-bordered w-full" :placeholder="tr(&quot;例如：接入主 SIEM 平台&quot;)" />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend invisible" aria-hidden="true">{{ tr("变更原因（可选）") }}</legend>
            <button type="button" class="btn btn-neutral" :disabled="saving || !dirty" @click="save">
              <span v-if="saving" class="loading loading-spinner loading-sm" />
              {{ tr("保存配置") }}
            </button>
          </fieldset>
        </div>
        <p class="mt-2 text-xs text-base-content/60">{{ tr("保存将应用本页全部修改：Syslog 设置、服务器列表与通知策略；网络代理在其面板内单独保存。") }}</p>
        <p v-if="dirty" class="mt-1 text-xs text-warning">{{ tr("有未保存的修改。") }}</p>
      </section>

      <!-- 统计 -->
      <section class="card mt-5 border border-base-300 bg-base-100 p-5 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="font-semibold">{{ tr("转发统计") }}</h2>
            <p class="mt-1 text-xs text-base-content/60">{{ tr("百分位为区间内最差分钟值；发送耗时指本地写入完成耗时。") }}</p>
          </div>
          <div class="flex flex-wrap items-end justify-end gap-2">
            <fieldset class="fieldset min-w-0 w-36">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-stats-window`">{{ tr("时间范围") }}</label></legend>
              <select :id="`${formFieldId}-stats-window`" v-model="statsWindow" class="select select-bordered select-sm w-full" @change="loadStats">
                <option v-for="item in windowOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </fieldset>
            <fieldset class="fieldset min-w-0 w-32">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-stats-granularity`">{{ tr("时间粒度") }}</label></legend>
              <select :id="`${formFieldId}-stats-granularity`" v-model="statsGranularity" class="select select-bordered select-sm w-full" @change="loadStats">
                <option v-for="item in granularityOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </fieldset>
            <fieldset class="fieldset min-w-0 w-40">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-stats-target`">{{ tr("目标") }}</label></legend>
              <select :id="`${formFieldId}-stats-target`" v-model="statsTarget" class="select select-bordered select-sm w-full" @change="loadStats">
                <option value="">{{ tr("全部目标") }}</option>
                <option v-for="target in settings.targets" :key="target.id" :value="target.id">{{ target.name }}</option>
              </select>
            </fieldset>
            <span v-if="statsLoading" class="loading loading-spinner loading-sm mb-2" />
          </div>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
          <div class="stat rounded-box border border-base-300 bg-base-100">
            <div class="stat-title">{{ tr("已发送") }}</div>
            <div class="stat-value text-2xl">{{ Number(summary.sent).toLocaleString('zh-CN') }}</div>
          </div>
          <div class="stat rounded-box border border-base-300 bg-base-100">
            <div class="stat-title">{{ tr("失败率") }}</div>
            <div class="stat-value text-2xl" :class="{ 'text-error': Number(summary.failure_rate) > 0.05 }">{{ failureRatePercent }}%</div>
          </div>
          <div class="stat rounded-box border border-base-300 bg-base-100">
            <div class="stat-title">{{ tr("P95 耗时") }}</div>
            <div class="stat-value text-2xl">{{ summary.p95_ms == null ? '--' : `${Number(summary.p95_ms).toFixed(1)} ms` }}</div>
          </div>
          <div class="stat rounded-box border border-base-300 bg-base-100">
            <div class="stat-title">{{ tr("P99 耗时") }}</div>
            <div class="stat-value text-2xl">{{ summary.p99_ms == null ? '--' : `${Number(summary.p99_ms).toFixed(1)} ms` }}</div>
          </div>
        </div>

        <EmptyState v-if="statsFailed" class="mt-4" type="error" :title="tr(&quot;统计加载失败&quot;)" :message="tr(&quot;请稍后重试。&quot;)" />
        <template v-else>
          <div class="mt-5">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-sm font-semibold">{{ tr("转发量趋势") }}</h3>
              <ChartCsvExport filename="syslog-volume" :series="volumeSeries" :options="volumeOptions" :disabled="statsLoading || !trend.length" />
            </div>
            <EmptyState v-if="!trend.length" class="mt-3" :title="tr(&quot;暂无转发数据&quot;)" :message="tr(&quot;启用转发并产生日志后此处会显示趋势。&quot;)" />
            <ApexChart v-else type="line" height="280" :options="volumeTooltipOptions" :series="volumeSeries" />
          </div>
          <div class="mt-5 grid gap-5 xl:grid-cols-2">
            <div>
              <div class="flex items-center justify-between gap-2">
                <h3 class="text-sm font-semibold">{{ tr("失败率趋势") }}</h3>
                <ChartCsvExport filename="syslog-failure-rate" :series="failureSeries" :options="failureOptions" unit="%" :disabled="statsLoading || !trend.length" />
              </div>
              <ApexChart v-if="trend.length" type="area" height="240" :options="failureOptions" :series="failureSeries" />
            </div>
            <div>
              <div class="flex items-center justify-between gap-2">
                <h3 class="text-sm font-semibold">{{ tr("发送耗时分位趋势") }}</h3>
                <ChartCsvExport filename="syslog-latency" :series="latencySeries" :options="latencyOptions" unit="ms" :disabled="statsLoading || !trend.length" />
              </div>
              <ApexChart v-if="trend.length" type="line" height="240" :options="latencyOptions" :series="latencySeries" />
            </div>
          </div>
          <div class="mt-5">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-sm font-semibold">{{ tr("按转发源构成") }}</h3>
              <ChartCsvExport filename="syslog-sources" :series="sourceSeries" :options="sourceOptions" :disabled="statsLoading || !trend.length" />
            </div>
            <ApexChart v-if="trend.length" type="area" height="240" :options="sourceOptions" :series="sourceSeries" />
          </div>
        </template>
      </section>

      <!-- 历史日志回填 -->
      <section class="card mt-5 border border-base-300 bg-base-100 p-5 shadow-sm">
        <h2 class="font-semibold">{{ tr("历史日志回填") }}</h2>
        <p class="mt-1 text-xs text-base-content/60">
          {{ tr("手动下发任务，把数据库留存的审计事件、IP 访问日志与扫描器诊断重发到已启用的目标；默认最近 7 天，最长 31 天。需先启用转发；回填不计入实时统计。") }}
        </p>
        <div class="mt-4 flex flex-wrap items-start gap-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-backfill-mode`">{{ tr("范围方式") }}</label></legend>
            <select :id="`${formFieldId}-backfill-mode`" v-model="backfillMode" class="select select-bordered">
              <option value="days">{{ tr("最近 N 天") }}</option>
              <option value="range">{{ tr("自定义时间段") }}</option>
            </select>
          </fieldset>
          <fieldset v-if="backfillMode === 'days'" class="fieldset">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-backfill-days`">{{ tr("天数") }}</label></legend>
            <input :id="`${formFieldId}-backfill-days`" v-model.number="backfillDays" type="number" min="1" max="31" class="input input-bordered w-28" />
          </fieldset>
          <template v-else>
            <fieldset class="fieldset">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-backfill-start`">{{ tr("开始时间") }}</label></legend>
              <SystemDateTimeInput :id="`${formFieldId}-backfill-start`" v-model="backfillStart" class="input input-bordered" :aria-label="tr(&quot;开始时间&quot;)" />
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-backfill-end`">{{ tr("结束时间") }}</label></legend>
              <SystemDateTimeInput :id="`${formFieldId}-backfill-end`" v-model="backfillEnd" class="input input-bordered" :aria-label="tr(&quot;结束时间&quot;)" />
            </fieldset>
          </template>
          <fieldset class="fieldset ml-auto">
            <legend class="fieldset-legend invisible" aria-hidden="true">{{ tr("范围方式") }}</legend>
            <button type="button" class="btn btn-neutral" :disabled="backfillCreating || !settings.enabled" @click="createBackfill">
              <span v-if="backfillCreating" class="loading loading-spinner loading-sm" />
              {{ tr("下发回填任务") }}
            </button>
          </fieldset>
        </div>
        <p v-if="!settings.enabled" class="mt-2 text-xs text-warning">{{ tr("转发未启用，启用后才能下发回填任务。") }}</p>
        <EmptyState v-if="!backfillJobs.length" class="mt-4" :title="tr(&quot;暂无回填任务&quot;)" :message="tr(&quot;下发任务后此处会显示执行进度。&quot;)" />
        <div v-else class="mt-4 overflow-x-auto">
          <table class="table table-zebra">
            <thead>
              <tr>
                <th>{{ tr("下发时间") }}</th>
                <th>{{ tr("范围") }}</th>
                <th>{{ tr("状态") }}</th>
                <th>{{ tr("处理 / 发送 / 失败") }}</th>
                <th>{{ tr("错误") }}</th>
                <th class="text-right">{{ tr("操作") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="job in backfillJobs" :key="job.id">
                <td class="whitespace-nowrap text-sm">{{ formatTime(job.createdAt) }}</td>
                <td class="whitespace-nowrap text-sm">{{ formatTime(job.rangeStart) }} ～ {{ formatTime(job.rangeEnd) }}</td>
                <td><span class="badge" :class="(backfillStatusLabels[job.status] || {}).class">{{ (backfillStatusLabels[job.status] || { text: job.status }).text }}</span></td>
                <td class="whitespace-nowrap text-sm">{{ job.processedCount }} / {{ job.sentCount }} / <span :class="{ 'text-error': job.failedCount > 0 }">{{ job.failedCount }}</span></td>
                <td class="max-w-56 text-sm"><span class="block truncate" :title="job.lastError || ''">{{ job.lastError || '--' }}</span></td>
                <td class="text-right">
                  <button
                    v-if="job.status === 'queued' || job.status === 'running'"
                    type="button"
                    class="btn btn-ghost btn-xs text-error"
                    :disabled="!!backfillCanceling"
                    @click="cancelBackfill(job)"
                  >{{ tr("取消") }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <!-- 添加/编辑服务器对话框 -->
    <dialog ref="targetDialog" class="modal">
      <div class="modal-box w-[calc(100vw-2rem)] max-w-lg">
        <h3 class="text-lg font-bold">{{ targetDraftIndex === -1 ? tr("添加服务器") : tr("编辑服务器") }}</h3>
        <div v-if="targetDraft" class="mt-4 space-y-4">
          <fieldset class="fieldset w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-target-name`">{{ tr("名称") }}</label></legend>
            <input :id="`${formFieldId}-target-name`" v-model="targetDraft.name" type="text" maxlength="64" class="input input-bordered w-full" :placeholder="tr(&quot;例如：主 SIEM&quot;)" />
          </fieldset>
          <div class="grid gap-4 sm:grid-cols-3">
            <fieldset class="fieldset sm:col-span-2">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-target-host`">{{ tr("地址（IP 或主机名）") }}</label></legend>
              <input :id="`${formFieldId}-target-host`" v-model="targetDraft.host" type="text" class="input input-bordered w-full" placeholder="10.0.0.5" />
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-target-port`">{{ tr("端口") }}</label></legend>
              <input :id="`${formFieldId}-target-port`" v-model.number="targetDraft.port" type="number" min="1" max="65535" class="input input-bordered w-full" />
            </fieldset>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <fieldset class="fieldset w-full">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-target-protocol`">{{ tr("协议") }}</label></legend>
              <select :id="`${formFieldId}-target-protocol`" v-model="targetDraft.protocol" class="select select-bordered w-full" @change="onDraftProtocolChange">
                <option v-for="item in protocolOptions" :key="item.value" :value="item.value">{{ item.label }}（{{ tr("默认端口") }} {{ item.defaultPort }}）</option>
              </select>
            </fieldset>
            <label class="label cursor-pointer justify-start gap-2 self-end pb-3">
              <input v-model="targetDraft.enabled" type="checkbox" class="toggle toggle-sm toggle-neutral" />
              <span class="label-text">{{ tr("启用该目标") }}</span>
            </label>
          </div>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">{{ tr("日志类型") }}</legend>
            <div class="flex flex-wrap gap-x-5 gap-y-2">
              <label v-for="key in ['system', 'audit', 'access', 'scanner']" :key="key" class="label cursor-pointer gap-2">
                <input type="checkbox" class="checkbox checkbox-sm" :checked="targetDraft.sources.includes(key)" @change="toggleDraftSource(key)" />
                <span class="label-text">{{ sourceLabels[key] }}</span>
              </label>
            </div>
            <p class="text-xs text-base-content/50">{{ tr("默认全部；取消勾选的类型不会发往该服务器。") }}</p>
          </fieldset>
          <template v-if="targetDraft.protocol === 'tls'">
            <fieldset class="fieldset w-full">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-target-ca`">{{ tr("自定义 CA 文件（可选，PEM/DER）") }}</label></legend>
              <input :id="`${formFieldId}-target-ca`" v-model="targetDraft.tls.caFile" type="text" class="input input-bordered w-full" :placeholder="tr(&quot;留空使用系统根证书&quot;)" />
            </fieldset>
            <div class="grid gap-4 sm:grid-cols-2">
              <fieldset class="fieldset w-full">
                <legend class="fieldset-legend"><label :for="`${formFieldId}-target-tls-name`">{{ tr("TLS 服务器名（可选）") }}</label></legend>
                <input :id="`${formFieldId}-target-tls-name`" v-model="targetDraft.tls.serverName" type="text" class="input input-bordered w-full" />
              </fieldset>
              <label class="label cursor-pointer justify-start gap-2 self-end pb-3">
                <input v-model="targetDraft.tls.verify" type="checkbox" class="toggle toggle-sm" />
                <span class="label-text">{{ tr("校验证书") }}</span>
              </label>
            </div>
            <p v-if="!targetDraft.tls.verify" class="text-xs text-warning">{{ tr("关闭证书校验会降低安全性，仅建议在受控网络中使用。") }}</p>
          </template>
        </div>
        <div class="modal-action">
          <button v-if="targetDraft" type="button" class="btn btn-outline mr-auto" :disabled="!!testingId" @click="testTarget(targetDraft)">
            <span v-if="testingId === targetDraft.id" class="loading loading-spinner loading-xs" />
            {{ tr("测试连接") }}
          </button>
          <form method="dialog"><button class="btn btn-ghost">{{ tr("取消") }}</button></form>
          <button type="button" class="btn btn-neutral" @click="confirmTarget">{{ tr("确定") }}</button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button>close</button></form>
    </dialog>
  </main>
</template>