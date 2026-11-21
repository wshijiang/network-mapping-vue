<script setup>
import { tr } from '../i18n/index.js'

import ServiceLabel from '@/components/ServiceLabel.vue'
import { formatDateTime as formatSystemDateTime } from '../i18n/time.js'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import http from '@/utils/http'
import WebTechnologies from '@/components/WebTechnologies.vue'
import AssetFavicon from '@/components/AssetFavicon.vue'
import OsFingerprint from '@/components/OsFingerprint.vue'
import CellText from '@/components/CellText.vue'
import ClampText from '@/components/ClampText.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import TablePagination from '@/components/TablePagination.vue'
import AutoTooltip from '@/components/AutoTooltip.vue'
import { aggregateIpIntel } from '@/utils/ipAggregation'
import { ChevronDown, ChevronsUpDown, ChevronUp, Files } from '@lucide/vue'
import { compareItems } from '@/utils/tableSort'
import { formatLocation } from '@/utils/location'
import { routingLocation, routingSummary } from '@/utils/scanRouting'
import { isProjectionPending, projectionMessage } from '@/utils/projectionStatus'

const route = useRoute()
const router = useRouter()
const taskId = computed(() => String(route.params.taskid || ''))
const task = ref(null)
const loading = ref(false)
const errorMessage = ref('')
const actionMessage = ref('')
const actionLoading = ref(false)
const page = ref(1)
const selectedExecutionId = ref('')
const dnsComparison = ref([])
const dnsComparisonLoading = ref(false)
const dnsComparisonError = ref('')
const confirmDialog = ref(null)
let refreshTimer
let isUnmounted = false
const refreshableStatuses = new Set(['pending', 'running'])

// UUID 标题按可用宽度截断：宽度足够时完整显示，不足时 CSS 截断并挂
// daisyUI tooltip。截断状态用 ResizeObserver 实测，随窗口/语言变化更新。
const uuidTextRef = ref(null)
const uuidTruncated = ref(false)
let uuidObserver
function measureUuidTruncation() {
  const el = uuidTextRef.value
  uuidTruncated.value = Boolean(el && el.scrollWidth > el.clientWidth)
}
watch(uuidTextRef, (el) => {
  uuidObserver?.disconnect()
  uuidObserver = undefined
  if (!el) return
  measureUuidTruncation()
  if (typeof ResizeObserver !== 'undefined') {
    uuidObserver = new ResizeObserver(measureUuidTruncation)
    uuidObserver.observe(el)
  }
})

const statusText = {
  get pending() { return tr("待扫描") }, get running() { return tr("扫描中") }, get succeeded() { return tr("扫描完成") }, get failed() { return tr("扫描失败") }, get cancelled() { return tr("已取消") }, get partial() { return tr("部分完成") }
}

function formatTime(value) {
  if (value === null || value === undefined) return '-'
  const date = new Date(Number(value))
  return Number.isNaN(date.getTime()) ? '-' : formatSystemDateTime(date)
}

function formatDuration(start, end) {
  if (start == null || end == null || Number(end) < Number(start)) return '-'
  const seconds = Math.floor((Number(end) - Number(start)) / 1000)
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? tr("{0} 分 {1} 秒", [minutes, seconds % 60]) : tr("{0} 秒", [seconds])
}

function formatNetworkOwner(item) {
  const asn = item.asn ? (/^AS/i.test(item.asn) ? item.asn : `AS${item.asn}`) : ''
  return [asn, item.as_org || item.isp].filter(Boolean).join(' · ') || '-'
}

function formatDnsAnswer(answer) {
  const fields = [`${answer.type} ${answer.value}`]
  if (answer.priority != null) fields.push(tr("优先级 {0}", [answer.priority]))
  if (answer.weight != null) fields.push(tr("权重 {0}", [answer.weight]))
  if (answer.port != null) fields.push(tr("端口 {0}", [answer.port]))
  fields.push(`TTL ${answer.ttl}`)
  return fields.join(' · ')
}

const taskRemark = computed(() => task.value?.remarks || '-')
const isDnsTask = computed(() => task.value?.task_kind === 'dns')
const isVulnerabilityTask = computed(() => !isDnsTask.value && task.value?.scan_profile === 'vulnerability_scan')
const endpointResultsAvailable = computed(() => task.value?.result_availability?.endpoints !== false)
const vulnerabilitiesAvailable = computed(() => task.value?.result_availability?.vulnerabilities !== false)
const hasUnavailableResults = computed(() => !endpointResultsAvailable.value || !vulnerabilitiesAvailable.value)
const scanTypeLabel = computed(() => {
  const profile = task.value?.scan_profile
  if (isDnsTask.value) {
    return {
      get vulnerability_scan() { return tr("域名解析 + 全部扫描") },
      get port_only() { return tr("域名解析 + 仅端口") },
      get service_inventory() { return tr("域名解析 + 服务识别") },
      get dns_records() { return tr("仅 DNS") }
    }[profile] || tr("DNS 记录查询")
  }
  return {
    get vulnerability_scan() { return tr("Nuclei 漏洞扫描") },
    get service_inventory() { return tr("服务识别") },
    get udp_inventory() { return tr("UDP 服务识别") },
    get udp_passive() { return tr("UDP 被动识别") },
    get port_only() { return tr("仅端口") },
    get legacy() { return tr("兼容模式") }
  }[profile] || tr("端口扫描")
})
const currentExecution = computed(() => task.value?.executions?.find(
  (execution) => execution.execution_id === task.value?.selected_execution_id
) || null)
const projectionStatus = computed(() => currentExecution.value?.projection_status || task.value?.projection_status)
const projectionNotice = computed(() => projectionMessage(projectionStatus.value))
const taskMeta = computed(() => ({
  status: statusText[currentExecution.value?.status] || tr("未知"),
  priority: task.value?.task_level ?? '-',
  attemptCount: task.value?.attempt_count ?? 0,
  failureReason: task.value?.failure_reason || ''
}))
const summaryStats = computed(() => {
  const stats = [
    { title: isDnsTask.value ? tr("目标域名数") : tr("发现 IP 数"), value: isDnsTask.value ? task.value?.task_target?.length ?? 0 : task.value?.summary?.ip_count ?? 0, desc: '' },
    { title: isDnsTask.value ? tr("查询内容") : tr("已观察端点数"), value: isDnsTask.value ? 'DNS 记录' : task.value?.summary?.port_count ?? 0, desc: '' }
  ]
  if (isVulnerabilityTask.value) stats.push({ get title() { return tr("漏洞数") }, value: vulnerabilitiesAvailable.value ? task.value?.summary?.vulnerability_count ?? 0 : '-', get desc() { return tr("Nuclei 有效匹配") } })
  stats.push(
    { get title() { return tr("观察记录数") }, value: task.value?.summary?.result_count ?? 0, desc: isDnsTask.value ? tr("DNS 查询观察") : tr("端口、服务与漏洞观察") },
    { get title() { return tr("扫描耗时") }, value: formatDuration(task.value?.task_start_time, task.value?.task_end_time), get desc() { return tr("总耗时") } }
  )
  return stats
})
const taskDetail = computed(() => ({
  target: task.value?.task_target?.join(', ') || '-',
  targetLabel: isDnsTask.value ? tr("目标域名") : tr("目标 IP"),
  addressFamily: isDnsTask.value ? 'DNS' : task.value?.address_family === 'ipv6' ? 'IPv6' : 'IPv4',
  port: isDnsTask.value ? tr("扫描器配置的记录类型") : task.value?.task_port || '-',
  scanType: scanTypeLabel.value,
  startTime: formatTime(task.value?.task_start_time),
  endTime: formatTime(task.value?.task_end_time),
  starter: task.value?.task_initiator || '-',
  scanner: task.value?.scanner_name || task.value?.scanner_id || '-'
}))
const resultByIp = computed(() => (task.value?.results || []).map((item) => ({
  ip: item.ip,
  ports: item.ports,
  asn: item.asn,
  isp: item.isp,
  as_org: item.as_org,
  country_code: item.country_code,
  country_name: item.country_name,
  region_name: item.region_name,
  city_name: item.city_name
})))

// 各 IP 分组端口子表的前端排序，复用搜索结果的 sortKeys 语义（空值恒排末尾，
// 循环 无→升→降→无）。仅排当前已加载页，不重新请求服务端。
// computed 而非 setup 常量：tr() 读取响应式 locale，语言切换时表头随页面更新。
const portColumns = computed(() => [
  { key: 'port', label: tr("端口") },
  { key: 'protocol', label: tr("协议") },
  { key: 'service', label: tr("服务") },
  { key: 'banner', label: 'Banner' },
  { key: 'os', label: tr("系统线索") },
  { key: 'tech', label: tr("技术栈") },
  { key: 'scan_time', label: tr("扫描时间") },
])
const portSort = ref({})
watch(resultByIp, () => { portSort.value = {} })

function togglePortSort(ip, key) {
  const current = portSort.value[ip]
  const next = !current || current.key !== key ? { key, direction: 1 }
    : current.direction === 1 ? { key, direction: -1 } : null
  portSort.value = { ...portSort.value, [ip]: next }
}
function sortedPorts(row) {
  const state = portSort.value[row.ip]
  if (!state?.key) return row.ports
  return [...row.ports].sort((a, b) => compareItems(state.key, state.direction, a, b))
}
function portSortIcon(ip, key) {
  const state = portSort.value[ip]
  if (!state || state.key !== key) return ChevronsUpDown
  return state.direction === 1 ? ChevronUp : ChevronDown
}
function portSortState(ip, key) {
  const state = portSort.value[ip]
  if (!state || state.key !== key) return 'none'
  return state.direction === 1 ? 'asc' : 'desc'
}
function portAriaSort(ip, key) {
  const state = portSort.value[ip]
  if (!state || state.key !== key) return 'none'
  return state.direction === 1 ? 'ascending' : 'descending'
}
const timelineSteps = computed(() => {
  if (!task.value) return []
  const steps = [{ time: formatTime(task.value.task_create_time), get label() { return tr("创建扫描任务") } }]
  if (task.value.task_start_time) steps.push({ time: formatTime(task.value.task_start_time), get label() { return tr("扫描器开始执行") } })
  if (task.value.task_end_time) steps.push({
    time: formatTime(task.value.task_end_time),
    label: currentExecution.value?.status === 'failed' ? tr("扫描失败：{0}", [task.value.failure_reason || '未知原因']) : tr("扫描结束")
  })
  return steps
})
const activeStepIndex = computed(() => timelineSteps.value.length - 1)
// IP 情报：连续且 ASN/组织/ISP/地区完全相同的 IPv4 行合并为最小覆盖网段。
const ipIntelRows = computed(() => aggregateIpIntel(task.value?.results || []))
const INTEL_PAGE_SIZE = 10
const intelPage = ref(1)
const intelPages = computed(() => Math.max(1, Math.ceil(ipIntelRows.value.length / INTEL_PAGE_SIZE)))
const pagedIntelRows = computed(() => {
  const current = Math.min(intelPage.value, intelPages.value)
  return ipIntelRows.value.slice((current - 1) * INTEL_PAGE_SIZE, current * INTEL_PAGE_SIZE)
})
watch([taskId, page, selectedExecutionId], () => { intelPage.value = 1 })

function severityBadge(severity) {
  return {
    critical: 'badge-error',
    high: 'badge-error badge-outline',
    medium: 'badge-warning',
    low: 'badge-info',
    info: 'badge-ghost'
  }[String(severity || '').toLowerCase()] || 'badge-ghost'
}

function scheduleRefresh() {
  window.clearTimeout(refreshTimer)
  refreshTimer = undefined
  const inferencePending = resultByIp.value.some((row) => row.ports.some((port) => port.os?.status === 'pending' || port.web?.status === 'pending'))
  if (isUnmounted || (!refreshableStatuses.has(currentExecution.value?.status) && !isProjectionPending(projectionStatus.value) && !inferencePending)) return
  refreshTimer = window.setTimeout(() => loadTask({ silent: true }), 30000)
}

async function loadTask({ silent = false } = {}) {
  if (!silent) loading.value = true
  try {
    const response = await http.get(`/api/task/${taskId.value}`, { params: {
      page: page.value,
      page_size: 20,
      execution_id: selectedExecutionId.value || undefined
    } })
    if (response.data?.success !== true || !response.data?.data) throw new Error(tr("服务器未返回有效任务数据"))
    task.value = response.data.data
    selectedExecutionId.value = response.data.data.selected_execution_id || ''
    if (response.data.data.task_kind === 'dns') await loadDnsComparison()
    else dnsComparison.value = []
    errorMessage.value = ''
  } catch (error) {
    console.error('load task detail failed', error)
    if (!silent) errorMessage.value = error?.response?.status === 404 ? tr("任务不存在或无权查看") : tr("任务详情加载失败")
  } finally {
    loading.value = false
    scheduleRefresh()
  }
}

async function loadDnsComparison() {
  dnsComparisonLoading.value = true
  dnsComparisonError.value = ''
  try {
    const response = await http.get(`/api/task/${taskId.value}/dns-comparison`)
    if (response.data?.success !== true || !Array.isArray(response.data?.data?.records)) throw new Error('invalid DNS comparison')
    dnsComparison.value = response.data.data.records
  } catch (error) {
    console.error('load DNS comparison failed', error)
    dnsComparison.value = []
    dnsComparisonError.value = tr("DNS 对比结果暂不可用。")
  } finally {
    dnsComparisonLoading.value = false
  }
}

async function changeExecution(executionId) {
  if (!executionId || executionId === task.value?.selected_execution_id) return
  selectedExecutionId.value = executionId
  page.value = 1
  await loadTask()
}

async function changePage(nextPage) {
  const totalPages = task.value?.pagination?.total_pages || 1
  if (nextPage < 1 || nextPage > totalPages || loading.value) return
  page.value = nextPage
  await loadTask()
}

function isNodeActive(index) {
  return index <= activeStepIndex.value
}

function isPrevLineActive(index) {
  return index > 0 && index <= activeStepIndex.value
}

function isNextLineActive(index) {
  return index < timelineSteps.value.length - 1 && index < activeStepIndex.value
}

async function copyTaskId() {
  const text = taskId.value
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch (error) {
    const textArea = document.createElement('textarea')
    textArea.value = text
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
  }
}

async function cancelTask() {
  if (!await confirmDialog.value.ask({ message: tr("确定取消该任务吗？运行中的扫描将在扫描器下一次心跳后终止。"), confirmText: tr("取消任务"), danger: true })) return
  actionLoading.value = true
  actionMessage.value = ''
  try {
    await http.post(`/api/task/${taskId.value}/cancel`)
    actionMessage.value = tr("取消请求已提交")
    await loadTask({ silent: true })
  } catch (error) {
    actionMessage.value = error?.response?.status === 409 ? tr("该任务已结束，无法取消") : tr("取消任务失败")
  } finally {
    actionLoading.value = false
  }
}

async function retryTask() {
  actionLoading.value = true
  actionMessage.value = ''
  try {
    const response = await http.post(`/api/task/${taskId.value}/retry`)
    const newTaskId = response.data?.data?.task_id
    if (!newTaskId) throw new Error(tr("服务器未返回新任务 ID"))
    await router.push(`/task/${newTaskId}`)
  } catch (error) {
    console.error('retry task failed', error)
    actionMessage.value = tr("创建重试任务失败")
  } finally {
    actionLoading.value = false
  }
}

async function exportTask(format) {
  try {
    const response = await http.get(`/api/task/${taskId.value}/export`, {
      params: { format },
      responseType: 'blob'
    })
    const url = URL.createObjectURL(response.data)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `task-${taskId.value}.${format}`
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('export task failed', error)
    actionMessage.value = tr("导出任务结果失败")
  }
}

watch(taskId, () => {
  page.value = 1
  task.value = null
  selectedExecutionId.value = ''
  window.clearTimeout(refreshTimer)
  loadTask()
}, { immediate: true })

onBeforeUnmount(() => {
  isUnmounted = true
  window.clearTimeout(refreshTimer)
  uuidObserver?.disconnect()
})
</script>

<template>
  <div class="page-shell">
    <ConfirmDialog ref="confirmDialog" />
    <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-4">
      <div class="min-w-0 flex items-center gap-2">
        <h1 class="page-title flex min-w-0 items-center gap-1 text-left">
          <span class="shrink-0">{{ tr("任务 UUID：") }}</span>
          <span
            ref="uuidTextRef"
            class="min-w-0 truncate font-mono"
            :class="uuidTruncated ? 'tooltip tooltip-bottom' : ''"
            :data-tip="uuidTruncated ? taskId : undefined"
          >{{ taskId }}</span>
          <button class="btn btn-ghost btn-xs shrink-0" :aria-label="tr(&quot;复制任务 UUID&quot;)" @click="copyTaskId">
            <Files class="size-3.5" aria-hidden="true" />
          </button>
        </h1>
      </div>

      <div class="flex flex-wrap items-center justify-start md:justify-end gap-2">
        <button v-if="['pending', 'running'].includes(task?.task_status)" class="btn btn-error btn-outline btn-sm" :disabled="actionLoading || task?.cancel_requested" @click="cancelTask">
          {{ task?.cancel_requested ? tr("正在取消") : tr("取消任务") }}
        </button>
        <button v-if="['succeeded', 'failed', 'cancelled', 'partial'].includes(task?.task_status)" class="btn btn-outline btn-sm" :disabled="actionLoading" @click="retryTask">{{ tr("重新执行") }}</button>
        <div v-if="!isDnsTask && ['succeeded', 'partial'].includes(task?.task_status)" class="dropdown dropdown-end">
          <button tabindex="0" class="btn btn-outline btn-sm">{{ tr("导出结果") }}</button>
          <ul tabindex="0" class="dropdown-content menu z-10 mt-2 w-36 rounded-box border border-base-300 bg-base-100 p-2 shadow">
            <li><button @click="exportTask('csv')">CSV</button></li>
            <li><button @click="exportTask('json')">JSON</button></li>
          </ul>
        </div>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadTask()">{{ tr("刷新") }}</button>
        <router-link to="/task" class="btn btn-ghost btn-sm">{{ tr("返回列表") }}</router-link>
      </div>
    </div>

    <div v-if="loading && !task" class="grid min-h-80 place-items-center rounded-lg bg-base-200/60">
      <span class="loading loading-spinner loading-md"></span>
    </div>
    <div v-else-if="errorMessage" role="alert" class="alert alert-error"><span>{{ errorMessage }}</span></div>
    <template v-else-if="task">
    <div v-if="actionMessage" role="alert" class="alert alert-info mb-4"><span>{{ actionMessage }}</span></div>
    <div v-if="hasUnavailableResults" role="alert" class="alert alert-warning mb-4">
      <span>{{ tr("任务信息已加载，但部分扫描结果索引暂不可用，请稍后刷新。") }}</span>
    </div>
    <div v-if="projectionNotice" role="status" class="alert mb-4" :class="projectionStatus === 'retrying' ? 'alert-warning' : 'alert-info'">
      <span>{{ projectionNotice }}</span>
    </div>
    <p class="text-sm opacity-70 mb-4 break-words"><span v-if="task.task_source === 'search'" class="badge badge-info badge-soft badge-sm mr-2">{{ tr("搜索生成") }}</span>{{ tr("备注：") }}{{ taskRemark }}</p>

    <div class="card mb-5 border border-base-300 bg-base-100 p-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 class="font-semibold">{{ tr("扫描器执行结果") }}</h3>
        <span class="text-xs opacity-60">{{ tr("共") }} {{ task.executions?.length || 0 }} {{ tr("个执行实例") }}</span>
      </div>
      <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        <button
          v-for="execution in task.executions"
          :key="execution.execution_id"
          class="min-w-0 rounded-lg border p-3 text-left transition-colors"
          :class="execution.execution_id === task.selected_execution_id ? 'border-base-content/60 bg-base-content/10' : 'border-base-300 bg-base-200/40 hover:border-base-content/30'"
          @click="changeExecution(execution.execution_id)"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="min-w-0 flex-1 truncate font-medium">{{ execution.scanner_name || execution.requested_scanner_id || tr("自动分配（待领取）") }}</span>
            <span class="badge badge-sm shrink-0" :class="execution.status === 'succeeded' ? 'badge-success' : execution.status === 'failed' ? 'badge-error' : execution.status === 'running' ? 'badge-info' : 'badge-ghost'">{{ statusText[execution.status] || execution.status }}</span>
          </div>
          <div class="mt-1 truncate text-xs opacity-60">{{ execution.scanner_location || tr("未设置位置") }} · {{ execution.scanner_id || execution.requested_scanner_id || tr("尚未领取") }}</div>
          <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs opacity-70"><span>IP {{ execution.summary.ip_count }}</span><span>{{ tr("端口") }} {{ execution.summary.port_count }}</span><span>{{ tr("观察") }} {{ execution.summary.result_count }}</span></div>
          <div v-if="execution.failure_reason" class="mt-2 line-clamp-2 break-words text-xs text-error" :title="execution.failure_reason">{{ execution.failure_reason }}</div>
        </button>
      </div>
    </div>

    <div v-if="task.task_group?.length > 1" class="card bg-base-100 card-border border-base-300 p-4 mb-5 text-sm"><h3 class="font-semibold mb-2">{{ tr("扫描任务组") }}</h3><p class="mb-2 opacity-70">{{ tr("共") }} {{ task.task_group.length }} {{ tr("个独立任务，已完成") }} {{ task.task_group.filter(t => t.status === 'succeeded').length }} {{ tr("个。") }}</p><div class="flex flex-wrap gap-2"><router-link v-for="child in task.task_group" :key="child.task_id" :to="`/task/${child.task_id}`" class="btn btn-outline btn-xs">{{ child.target_count }} {{ tr("个目标 ·") }} {{ statusText[child.status] || child.status }}</router-link></div></div>
    <div v-if="task.routing || currentExecution?.routing_decision || currentExecution?.performance" class="card bg-base-100 card-border border-base-300 p-4 mb-5 text-sm">
      <h3 class="font-semibold mb-2">{{ tr("扫描器分配") }}</h3>
      <p v-if="task.routing || currentExecution?.routing_decision">{{ routingSummary(currentExecution?.routing_decision || task.routing) }}</p>
      <p class="mt-1 opacity-70">{{ tr("目标地域：") }}{{ routingLocation((currentExecution?.routing_decision || task.routing)?.target_geo) }}</p>
      <p v-if="currentExecution?.performance" class="mt-1 opacity-70">{{ tr("执行耗时：") }}{{ (currentExecution.performance.elapsed_ms / 1000).toFixed(1) }} {{ tr("秒 · 目标连接样本：") }}{{ currentExecution.performance.connections?.length || 0 }}</p>
      <div v-if="currentExecution?.performance?.connections?.length" class="overflow-x-auto mt-2"><table class="table table-sm"><thead><tr><th>{{ tr("目标") }}</th><th>{{ tr("连接耗时") }}</th><th>{{ tr("结果") }}</th></tr></thead><tbody><tr v-for="sample in currentExecution.performance.connections" :key="`${sample.ip}:${sample.port}`"><td>{{ sample.ip }}:{{ sample.port }}</td><td>{{ sample.elapsed_ms }} ms</td><td>{{ ({connected: tr("连接成功"), refused: tr("连接被拒绝"), timeout: tr("超时"), route_error: tr("路由错误"), other_error: tr("连接异常")})[sample.outcome] || tr("未知") }}</td></tr></tbody></table></div>
    </div>
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
      <div class="xl:col-span-2 flex flex-col gap-5">
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          <div v-for="item in summaryStats" :key="item.title" class="stats shadow border border-base-300 bg-base-100">
            <div class="stat">
              <div class="stat-title">{{ item.title }}</div>
              <div class="stat-value text-2xl">{{ item.value }}</div>
              <div class="stat-desc">{{ item.desc }}</div>
            </div>
          </div>
        </div>

        <div v-if="isVulnerabilityTask" class="card bg-base-100 card-border border-base-300 p-4">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 class="font-semibold">{{ tr("漏洞结果") }}</h3>
            <span class="text-xs opacity-60">{{ tr("最多展示最近 500 条，共") }} {{ vulnerabilitiesAvailable ? task.summary?.vulnerability_count || 0 : '-' }} {{ tr("条") }}</span>
          </div>
          <div v-if="!vulnerabilitiesAvailable" class="rounded-lg bg-warning/10 p-4 text-sm text-warning"> {{ tr("漏洞结果索引暂不可用，请稍后刷新。") }} </div>
          <div v-else-if="!task.vulnerabilities?.length" class="rounded-lg bg-base-200/60 p-6 text-center text-sm opacity-70"> {{ tr("暂未发现符合当前 Nuclei 策略的漏洞。") }} </div>
          <div v-else class="flex flex-col gap-3">
            <details v-for="finding in task.vulnerabilities" :key="`${finding.template_id}-${finding.matched_at}-${finding.matcher_name || ''}`" class="collapse collapse-arrow border border-base-300 bg-base-100">
              <summary class="collapse-title min-h-0 py-3">
                <div class="flex flex-wrap items-center gap-2 pr-6">
                  <span class="badge badge-sm uppercase" :class="severityBadge(finding.severity)">{{ finding.severity || 'unknown' }}</span>
                  <span class="font-medium">{{ finding.name || finding.template_id }}</span>
                  <span class="text-xs opacity-60">{{ finding.ip }}:{{ finding.port }}</span>
                </div>
              </summary>
              <div class="collapse-content grid gap-2 text-sm">
                <div><span class="opacity-60">{{ tr("模板：") }}</span><code>{{ finding.template_id }}</code><span v-if="finding.matcher_name"> / {{ finding.matcher_name }}</span></div>
                <div class="break-all"><span class="opacity-60">{{ tr("匹配位置：") }}</span>{{ finding.matched_at }}</div>
                <div v-if="finding.description" class="whitespace-pre-wrap"><span class="opacity-60">{{ tr("说明：") }}</span>{{ finding.description }}</div>
                <div v-if="finding.remediation" class="whitespace-pre-wrap"><span class="opacity-60">{{ tr("修复建议：") }}</span>{{ finding.remediation }}</div>
                <div v-if="finding.tags?.length" class="flex flex-wrap gap-1"><span v-for="tag in finding.tags" :key="tag" class="badge badge-ghost badge-sm">{{ tag }}</span></div>
                <div v-if="finding.extracted_results?.length"><span class="opacity-60">{{ tr("提取结果：") }}</span><span class="break-all">{{ finding.extracted_results.join('；') }}</span></div>
                <div v-if="finding.references?.length" class="flex flex-col gap-1">
                  <a v-for="reference in finding.references" :key="reference" class="link link-neutral break-all" :href="reference" target="_blank" rel="noopener noreferrer">{{ reference }}</a>
                </div>
                <div class="text-xs opacity-60">{{ tr("发现时间：") }}{{ formatTime(finding.observed_at) }}</div>
              </div>
            </details>
          </div>
        </div>

        <div class="card bg-base-100 card-border border-base-300 p-4">
          <h3 class="font-semibold mb-3">{{ tr("任务细节") }}</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div class="min-w-0 rounded-lg bg-base-200/50 p-3"><div class="text-xs opacity-60">{{ taskDetail.targetLabel }}</div><ClampText class="mt-1" :text="taskDetail.target" /></div>
            <div class="min-w-0 rounded-lg bg-base-200/50 p-3"><div class="text-xs opacity-60">{{ isDnsTask ? tr("查询类型") : 'Port' }}</div><ClampText class="mt-1" :text="taskDetail.port" /></div>
            <div class="min-w-0 rounded-lg bg-base-200/50 p-3"><div class="text-xs opacity-60">{{ tr("地址协议") }}</div><div class="mt-1 break-words">{{ taskDetail.addressFamily }}</div></div>
            <div class="min-w-0 rounded-lg bg-base-200/50 p-3"><div class="text-xs opacity-60">{{ tr("扫描类型") }}</div><div class="mt-1 break-words">{{ taskDetail.scanType }}</div></div>
            <div class="min-w-0 rounded-lg bg-base-200/50 p-3"><div class="text-xs opacity-60">{{ tr("扫描发起人") }}</div><ClampText class="mt-1" :text="taskDetail.starter" /></div>
            <div class="min-w-0 rounded-lg bg-base-200/50 p-3"><div class="text-xs opacity-60">{{ tr("开始时间") }}</div><div class="mt-1 break-words">{{ taskDetail.startTime }}</div></div>
            <div class="min-w-0 rounded-lg bg-base-200/50 p-3"><div class="text-xs opacity-60">{{ tr("结束时间") }}</div><div class="mt-1 break-words">{{ taskDetail.endTime }}</div></div>
            <div class="min-w-0 rounded-lg bg-base-200/50 p-3 md:col-span-2"><div class="text-xs opacity-60">{{ tr("执行扫描器") }}</div><ClampText class="mt-1" :text="taskDetail.scanner" /></div>
            <div v-if="isDnsTask" class="min-w-0 rounded-lg bg-base-200/50 p-3 md:col-span-2"><div class="text-xs opacity-60">{{ tr("解析服务器") }}</div><ClampText class="mt-1" :text="task.dns_resolvers?.length ? task.dns_resolvers.map((resolver) => `${resolver.label} (${resolver.ip}:${resolver.port}/${resolver.transport})`).join('；') : tr(&quot;扫描器系统 DNS&quot;)" /></div>
          </div>
        </div>

        <div class="card bg-base-100 card-border border-base-300 p-4 flex max-h-[100dvh] flex-col">
          <h3 class="font-semibold mb-3 shrink-0">{{ tr("结果展示") }}</h3>
          <div class="min-h-0 flex-1 overflow-y-auto">
          <div v-if="isDnsTask" class="flex flex-col gap-3">
            <div v-if="dnsComparisonLoading" class="rounded-lg bg-base-200/60 p-6 text-center text-sm opacity-70"><span class="loading loading-spinner loading-xs mr-2"></span>{{ tr("正在加载 DNS 对比结果...") }}</div>
            <div v-else-if="dnsComparisonError" class="rounded-lg bg-warning/10 p-4 text-sm text-warning">{{ dnsComparisonError }}</div>
            <div v-else-if="dnsComparison.length === 0" class="rounded-lg bg-base-200/60 p-6 text-center text-sm opacity-70">{{ tr("暂无 DNS 查询观察。") }}</div>
            <template v-else>
            <div v-for="record in dnsComparison" :key="`${record.name}-${record.record_type}`" class="overflow-hidden rounded-lg border border-base-300 bg-base-100 text-sm">
              <div class="flex flex-wrap items-center justify-between gap-2 bg-base-200/60 px-3 py-2"><span class="font-medium break-all">{{ record.name }}</span><span class="badge badge-outline">{{ record.record_type }}</span></div>
              <div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead><tr><th>{{ tr("DNS 服务器") }}</th><th>{{ tr("响应") }}</th><th>{{ tr("延迟") }}</th><th>{{ tr("返回记录") }}</th></tr></thead>
                  <tbody><tr v-for="resolver in record.resolvers" :key="resolver.id"><td>{{ resolver.label }}<div class="text-xs opacity-60">{{ resolver.ip || tr("系统 DNS") }}{{ resolver.port ? `:${resolver.port}` : '' }} · {{ resolver.transport || '-' }}</div></td><td><span class="badge badge-sm" :class="resolver.response_code === 'NOERROR' ? 'badge-success' : 'badge-warning'">{{ resolver.response_code }}</span></td><td>{{ resolver.latency_ms == null ? '-' : `${resolver.latency_ms} ms` }}</td><td class="max-w-xl break-all">{{ resolver.answers?.map(formatDnsAnswer).join('；') || '-' }}</td></tr></tbody>
                </table>
              </div>
              <div v-if="record.differences?.length || record.response_code_difference" class="border-t border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning">{{ tr("差异：") }}<span v-if="record.response_code_difference" class="mr-2">{{ tr("响应码不同；") }}</span><span v-for="(difference, index) in record.differences" :key="index" class="mr-2">{{ difference.answer?.type }} {{ difference.answer?.value }}（{{ difference.resolver_ids?.join('、') }}）</span></div>
              <div v-else-if="record.resolvers.length > 1" class="border-t border-success/20 bg-success/10 px-3 py-2 text-xs text-success">{{ tr("各 DNS 服务器返回的记录一致。") }}</div>
            </div>
            </template>
          </div>
          <div v-else class="flex flex-col gap-2">
            <div v-if="!endpointResultsAvailable" class="rounded-lg bg-warning/10 p-4 text-sm text-warning">{{ tr("扫描结果索引暂不可用，请稍后刷新。") }}</div>
            <div v-else-if="resultByIp.length === 0" class="rounded-lg bg-base-200/60 p-6 text-center text-sm opacity-70">{{ tr("暂无扫描结果") }}</div>
            <div v-for="row in resultByIp" :key="row.ip" class="overflow-hidden rounded-lg border border-base-300 bg-base-100 text-sm">
              <div class="flex flex-wrap items-center justify-between gap-2 bg-base-200/60 px-3 py-2">
                <span class="min-w-0 break-all font-medium">{{ row.ip }}</span>
                <div class="min-w-0 text-right text-xs opacity-70">
                  <div class="break-words">{{ formatNetworkOwner(row) }}</div>
                  <div class="break-words">{{ formatLocation(row) }}</div>
                </div>
              </div>
              <div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead><tr><th v-for="column in portColumns" :key="column.key" :aria-sort="portAriaSort(row.ip, column.key)"><button type="button" class="flex w-full items-center gap-1 overflow-hidden" @click="togglePortSort(row.ip, column.key)"><span class="truncate">{{ column.label }}</span><Transition name="sort-chevron" mode="out-in"><component :is="portSortIcon(row.ip, column.key)" :key="portSortState(row.ip, column.key)" class="size-3.5 shrink-0" aria-hidden="true" /></Transition></button></th></tr></thead>
                  <tbody>
                    <tr v-for="port in sortedPorts(row)" :key="`${port.protocol || 'unknown'}:${port.port}`">
                      <td><span class="font-mono font-semibold">{{ port.port }}</span></td>
                      <td>{{ port.protocol || '-' }}</td>
                      <td><div class="flex items-center gap-1.5"><AssetFavicon v-if="port.favicon" :ip="row.ip" :port="port.port" :protocol="port.protocol" :icon-md5="port.icon_md5" :size="16" /><ServiceLabel :service="port.service" :data="port.data" /></div></td>
                      <td class="max-w-xs"><CellText :text="port.banner || '-'" /></td>
                      <td><OsFingerprint compact :value="port.os" /></td>
                      <td><WebTechnologies compact :value="port.web" /></td>
                      <td class="whitespace-nowrap">{{ formatTime(port.scan_time) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          </div>
          <div v-if="!isDnsTask && endpointResultsAvailable && task.pagination.total_pages > 1" class="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-base-300 pt-3">
            <span class="text-sm opacity-70">{{ tr("第") }} {{ task.pagination.page }} / {{ task.pagination.total_pages }} {{ tr("页") }}</span>
            <TablePagination :page="task.pagination.page" :total-pages="task.pagination.total_pages" :disabled="loading" @change="changePage" />
          </div>
        </div>
      </div>

      <div class="xl:col-span-1 flex flex-col gap-5">
        <div class="card bg-base-100 card-border border-base-300 p-4">
          <h3 class="font-semibold mb-3">{{ tr("执行状态") }}</h3>
          <div class="flex w-full flex-col text-sm">
            <div class="card bg-base-200 rounded-box px-3 py-2">{{ tr("当前扫描器状态：") }}{{ taskMeta.status }}</div>
            <div class="card bg-base-200 rounded-box px-3 py-2 mt-2">{{ tr("任务总体状态：") }}{{ statusText[task.task_status] || task.task_status }}</div>
            <div class="card bg-base-200 rounded-box px-3 py-2 mt-2">{{ tr("优先级：") }}{{ taskMeta.priority }}</div>
            <div class="card bg-base-200 rounded-box px-3 py-2 mt-2">{{ tr("领取次数：") }}{{ taskMeta.attemptCount }}</div>
            <div v-if="taskMeta.failureReason" class="card bg-error/10 rounded-box px-3 py-2 mt-2 text-error">{{ tr("失败原因：") }}{{ taskMeta.failureReason }}</div>
          </div>

          <div class="divider my-3">Timeline</div>

          <div class="min-w-0">
            <ul class="timeline timeline-vertical w-full [&>li]:min-w-0 [&>li]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <li v-for="(step, index) in timelineSteps" :key="step.label">
                <hr v-if="index > 0" :class="isPrevLineActive(index) ? 'bg-base-content' : ''" />
                <div class="timeline-start min-w-0 text-xs opacity-70">{{ step.time }}</div>
                <div class="timeline-middle">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    class="h-5 w-5"
                    :class="isNodeActive(index) ? 'text-base-content' : 'opacity-40'"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </div>
                <div class="timeline-end timeline-box min-w-0 break-words text-sm">{{ step.label }}</div>
                <hr v-if="index < timelineSteps.length - 1" :class="isNextLineActive(index) ? 'bg-base-content' : ''" />
              </li>
            </ul>
          </div>
        </div>

        <div v-if="!isDnsTask" class="card bg-base-100 card-border border-base-300 p-4 flex max-h-[100dvh] flex-col">
          <h3 class="font-semibold mb-3 shrink-0">{{ tr("IP 情报") }}</h3>
          <div v-if="!endpointResultsAvailable" class="rounded-lg bg-warning/10 p-4 text-sm text-warning">{{ tr("IP 情报依赖扫描结果索引，暂时无法显示。") }}</div>
          <div v-else-if="ipIntelRows.length === 0" class="rounded-lg bg-base-200/60 p-6 text-center text-sm opacity-70">{{ tr("暂无 IP 情报") }}</div>
          <template v-else>
            <div class="min-h-0 flex-1 overflow-auto rounded-box border border-base-300">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th></th>
                    <th>IP/CIDR</th>
                    <th>ASN</th>
                    <th>{{ tr("AS 组织") }}</th>
                    <th>{{ tr("位置") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in pagedIntelRows" :key="`${row.index}-${row.ips[0]}`">
                    <td class="align-top">{{ row.index }}</td>
                    <td class="max-w-44">
                      <div class="flex flex-wrap items-center gap-1">
                        <AutoTooltip v-if="row.cidr" :copy-text="row.ips.join('\n')">
                          <span class="block truncate font-mono">{{ row.cidr }}</span>
                          <template #content><div class="space-y-0.5 font-mono"><div v-for="ip in row.ips" :key="ip">{{ ip }}</div></div></template>
                        </AutoTooltip>
                        <span v-else class="block truncate font-mono">{{ row.ips[0] }}</span>
                        <span v-if="row.count > 1" class="badge badge-ghost badge-xs shrink-0">{{ row.count }} {{ tr("个 IP") }}</span>
                      </div>
                    </td>
                    <td class="whitespace-nowrap align-top">{{ row.asn }}</td>
                    <td class="max-w-40 align-top"><CellText :text="row.asOrg" /></td>
                    <td class="max-w-44 align-top"><CellText :text="row.location" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="intelPages > 1" class="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-base-300 pt-3">
              <span class="text-xs opacity-70">{{ tr("共") }} {{ ipIntelRows.length }} {{ tr("条") }}</span>
              <TablePagination :page="intelPage" :total-pages="intelPages" @change="intelPage = $event" />
            </div>
          </template>
        </div>
      </div>
    </div>
    </template>
  </div>
</template>

<style scoped>
.sort-chevron-enter-active,
.sort-chevron-leave-active {
  transition: opacity 150ms ease, transform 150ms ease;
}
.sort-chevron-enter-from {
  opacity: 0;
  transform: translateY(2px);
}
.sort-chevron-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}
@media (prefers-reduced-motion: reduce) {
  .sort-chevron-enter-active,
  .sort-chevron-leave-active {
    transition: none;
  }
}
</style>
