<script setup>
import { tr } from '../i18n/index.js'

import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import EmptyState from '@/components/EmptyState.vue'
import ChartCsvExport from '@/components/ChartCsvExport.vue'
import { useChartTheme } from '@/composables/useChartTheme'
import { renderChartTooltip } from '@/utils/chartTooltip'
import { formatDateTime as formatSystemDateTime, formatTime as formatSystemClock } from '../i18n/time.js'
import http from '@/utils/http'

const ApexChart = defineAsyncComponent(() => import('vue3-apexcharts/core'))

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
    tls: { caFile: '', verify: true, serverName: '' }
  }
  targetDialog.value?.showModal()
}

function openEditTarget(index) {
  targetDraftIndex.value = index
  targetDraft.value = JSON.parse(JSON.stringify(settings.value.targets[index]))
  targetDialog.value?.showModal()
}

function onDraftProtocolChange() {
  const option = protocolOptions.find((item) => item.value === targetDraft.value.protocol)
  if (option) targetDraft.value.port = option.defaultPort
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

const status = ref({ enabled: false, queue: { capacity: 0, enqueueDrops: 0 }, targets: [] })
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
    const response = await http.post('/api/syslog/test', { targetId: target.id })
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

onMounted(() => {
  load()
  loadStatus()
  loadStats()
  statusTimer = setInterval(() => loadStatus({ silent: true }), 10000)
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
      <!-- 全局设置 -->
      <section class="card border border-base-300 bg-base-100 p-5 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="font-semibold">{{ tr("全局设置") }}</h2>
          <label class="label cursor-pointer gap-2">
            <span class="label-text">{{ tr("启用转发") }}</span>
            <input v-model="settings.enabled" type="checkbox" class="toggle toggle-primary" />
          </label>
        </div>
        <div class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <label class="form-control w-full">
            <div class="label py-1"><span class="label-text">{{ tr("Facility") }}</span></div>
            <select v-model="settings.facility" class="select select-bordered w-full">
              <option v-for="item in facilityOptions" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
          <label class="form-control w-full">
            <div class="label py-1"><span class="label-text">{{ tr("应用名") }}</span></div>
            <input v-model="settings.appName" type="text" maxlength="48" class="input input-bordered w-full" />
          </label>
          <label class="form-control w-full">
            <div class="label py-1"><span class="label-text">{{ tr("系统日志最低级别") }}</span></div>
            <select v-model="settings.minLevel" class="select select-bordered w-full">
              <option v-for="item in levelOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </label>
          <label class="form-control w-full">
            <div class="label py-1"><span class="label-text">{{ tr("队列容量") }}</span></div>
            <input v-model.number="settings.queueCapacity" type="number" min="1024" max="100000" class="input input-bordered w-full" />
          </label>
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
      </section>

      <!-- 服务器列表 -->
      <section class="card mt-5 border border-base-300 bg-base-100 p-5 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="font-semibold">{{ tr("Syslog 服务器") }}</h2>
            <p class="mt-1 text-xs text-base-content/60">
              {{ tr("最多 10 个目标，各自独立选择协议与端口。状态每 10 秒刷新；UDP 为无连接协议，状态反映最近发送结果。") }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="statusLoading" class="loading loading-spinner loading-sm" />
            <button type="button" class="btn btn-primary btn-sm" @click="openAddTarget">{{ tr("添加服务器") }}</button>
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
      </section>

      <!-- 通知策略 -->
      <section class="card mt-5 border border-base-300 bg-base-100 p-5 shadow-sm">
        <h2 class="font-semibold">{{ tr("通知策略") }}</h2>
        <p class="mt-1 text-xs text-base-content/60">{{ tr("三条规则可独立开启；命中后经健康告警渠道通知管理员（邮件与已配置的通知渠道）。") }}</p>
        <div class="mt-4 grid gap-4 sm:grid-cols-3">
          <label class="form-control">
            <div class="label py-1"><span class="label-text">{{ tr("统计窗口（分钟）") }}</span></div>
            <input v-model.number="settings.alerts.windowMinutes" type="number" min="1" max="60" class="input input-bordered" />
          </label>
          <label class="form-control">
            <div class="label py-1"><span class="label-text">{{ tr("告警冷却（秒）") }}</span></div>
            <input v-model.number="settings.alerts.cooldownSeconds" type="number" min="60" max="604800" class="input input-bordered" />
          </label>
          <label class="form-control">
            <div class="label py-1"><span class="label-text">{{ tr("失败率最小样本数") }}</span></div>
            <input v-model.number="settings.alerts.failureRate.minSamples" type="number" min="1" max="100000" class="input input-bordered" />
          </label>
        </div>
        <div class="mt-4 space-y-3">
          <div class="flex flex-wrap items-center gap-3 rounded-box border border-base-300 p-3">
            <label class="label cursor-pointer gap-2">
              <input v-model="settings.alerts.failureRate.enabled" type="checkbox" class="toggle toggle-sm toggle-primary" />
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
              <input v-model="settings.alerts.latencyP95.enabled" type="checkbox" class="toggle toggle-sm toggle-primary" />
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
              <input v-model="settings.alerts.latencyP99.enabled" type="checkbox" class="toggle toggle-sm toggle-primary" />
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
      </section>

      <!-- 保存栏 -->
      <section class="card mt-5 border border-base-300 bg-base-100 p-5 shadow-sm">
        <div class="flex flex-wrap items-end gap-3">
          <label class="form-control grow">
            <div class="label py-1"><span class="label-text">{{ tr("变更原因（可选）") }}</span></div>
            <input v-model="changeReason" type="text" maxlength="500" class="input input-bordered w-full" :placeholder="tr(&quot;例如：接入主 SIEM 平台&quot;)" />
          </label>
          <button type="button" class="btn btn-primary" :disabled="saving || !dirty" @click="save">
            <span v-if="saving" class="loading loading-spinner loading-sm" />
            {{ tr("保存配置") }}
          </button>
        </div>
        <p v-if="dirty" class="mt-2 text-xs text-warning">{{ tr("有未保存的修改。") }}</p>
      </section>

      <!-- 统计 -->
      <section class="card mt-5 border border-base-300 bg-base-100 p-5 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="font-semibold">{{ tr("转发统计") }}</h2>
            <p class="mt-1 text-xs text-base-content/60">{{ tr("百分位为区间内最差分钟值；发送耗时指本地写入完成耗时。") }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <select v-model="statsWindow" class="select select-bordered select-sm" @change="loadStats">
              <option v-for="item in windowOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
            <select v-model="statsGranularity" class="select select-bordered select-sm" @change="loadStats">
              <option v-for="item in granularityOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
            <select v-model="statsTarget" class="select select-bordered select-sm" @change="loadStats">
              <option value="">{{ tr("全部目标") }}</option>
              <option v-for="target in settings.targets" :key="target.id" :value="target.id">{{ target.name }}</option>
            </select>
            <span v-if="statsLoading" class="loading loading-spinner loading-sm" />
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
    </template>

    <!-- 添加/编辑服务器对话框 -->
    <dialog ref="targetDialog" class="modal">
      <div class="modal-box w-[calc(100vw-2rem)] max-w-lg">
        <h3 class="text-lg font-bold">{{ targetDraftIndex === -1 ? tr("添加服务器") : tr("编辑服务器") }}</h3>
        <div v-if="targetDraft" class="mt-4 space-y-4">
          <label class="form-control w-full">
            <div class="label py-1"><span class="label-text">{{ tr("名称") }}</span></div>
            <input v-model="targetDraft.name" type="text" maxlength="64" class="input input-bordered w-full" :placeholder="tr(&quot;例如：主 SIEM&quot;)" />
          </label>
          <div class="grid gap-4 sm:grid-cols-3">
            <label class="form-control sm:col-span-2">
              <div class="label py-1"><span class="label-text">{{ tr("地址（IP 或主机名）") }}</span></div>
              <input v-model="targetDraft.host" type="text" class="input input-bordered w-full" placeholder="10.0.0.5" />
            </label>
            <label class="form-control">
              <div class="label py-1"><span class="label-text">{{ tr("端口") }}</span></div>
              <input v-model.number="targetDraft.port" type="number" min="1" max="65535" class="input input-bordered w-full" />
            </label>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="form-control w-full">
              <div class="label py-1"><span class="label-text">{{ tr("协议") }}</span></div>
              <select v-model="targetDraft.protocol" class="select select-bordered w-full" @change="onDraftProtocolChange">
                <option v-for="item in protocolOptions" :key="item.value" :value="item.value">{{ item.label }}（{{ tr("默认端口") }} {{ item.defaultPort }}）</option>
              </select>
            </label>
            <label class="label cursor-pointer justify-start gap-2 self-end pb-3">
              <input v-model="targetDraft.enabled" type="checkbox" class="toggle toggle-sm toggle-primary" />
              <span class="label-text">{{ tr("启用该目标") }}</span>
            </label>
          </div>
          <template v-if="targetDraft.protocol === 'tls'">
            <label class="form-control w-full">
              <div class="label py-1"><span class="label-text">{{ tr("自定义 CA 文件（可选，PEM/DER）") }}</span></div>
              <input v-model="targetDraft.tls.caFile" type="text" class="input input-bordered w-full" :placeholder="tr(&quot;留空使用系统根证书&quot;)" />
            </label>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="form-control w-full">
                <div class="label py-1"><span class="label-text">{{ tr("TLS 服务器名（可选）") }}</span></div>
                <input v-model="targetDraft.tls.serverName" type="text" class="input input-bordered w-full" />
              </label>
              <label class="label cursor-pointer justify-start gap-2 self-end pb-3">
                <input v-model="targetDraft.tls.verify" type="checkbox" class="toggle toggle-sm" />
                <span class="label-text">{{ tr("校验证书") }}</span>
              </label>
            </div>
            <p v-if="!targetDraft.tls.verify" class="text-xs text-warning">{{ tr("关闭证书校验会降低安全性，仅建议在受控网络中使用。") }}</p>
          </template>
        </div>
        <div class="modal-action">
          <form method="dialog"><button class="btn btn-ghost">{{ tr("取消") }}</button></form>
          <button type="button" class="btn btn-primary" @click="confirmTarget">{{ tr("确定") }}</button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button>close</button></form>
    </dialog>
  </main>
</template>