<script setup>
import { formatDateTime as formatSystemDateTime } from '@/utils/systemTime'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import http from '@/utils/http'
import OsFingerprint from '@/components/OsFingerprint.vue'
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
let refreshTimer
let isUnmounted = false
const refreshableStatuses = new Set(['pending', 'running'])

const displayTaskId = computed(() => taskId.value.length <= 34
  ? taskId.value
  : `${taskId.value.slice(0, 18)}...${taskId.value.slice(-8)}`)

const statusText = {
  pending: '待扫描', running: '扫描中', succeeded: '扫描完成', failed: '扫描失败', cancelled: '已取消', partial: '部分完成'
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
  return minutes > 0 ? `${minutes} 分 ${seconds % 60} 秒` : `${seconds} 秒`
}

function formatNetworkOwner(item) {
  const asn = item.asn ? (/^AS/i.test(item.asn) ? item.asn : `AS${item.asn}`) : ''
  return [asn, item.as_org || item.isp].filter(Boolean).join(' · ') || '-'
}

function formatDnsAnswer(answer) {
  const fields = [`${answer.type} ${answer.value}`]
  if (answer.priority != null) fields.push(`优先级 ${answer.priority}`)
  if (answer.weight != null) fields.push(`权重 ${answer.weight}`)
  if (answer.port != null) fields.push(`端口 ${answer.port}`)
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
      vulnerability_scan: '域名解析 + 全部扫描',
      port_only: '域名解析 + 仅端口',
      service_inventory: '域名解析 + 服务识别',
      dns_records: '仅 DNS'
    }[profile] || 'DNS 记录查询'
  }
  return {
    vulnerability_scan: 'Nuclei 漏洞扫描',
    service_inventory: '服务识别',
    port_only: '仅端口',
    legacy: '兼容模式'
  }[profile] || '端口扫描'
})
const currentExecution = computed(() => task.value?.executions?.find(
  (execution) => execution.execution_id === task.value?.selected_execution_id
) || null)
const projectionStatus = computed(() => currentExecution.value?.projection_status || task.value?.projection_status)
const projectionNotice = computed(() => projectionMessage(projectionStatus.value))
const taskMeta = computed(() => ({
  status: statusText[currentExecution.value?.status] || '未知',
  priority: task.value?.task_level ?? '-',
  attemptCount: task.value?.attempt_count ?? 0,
  failureReason: task.value?.failure_reason || ''
}))
const summaryStats = computed(() => {
  const stats = [
    { title: isDnsTask.value ? '目标域名数' : '发现 IP 数', value: isDnsTask.value ? task.value?.task_target?.length ?? 0 : task.value?.summary?.ip_count ?? 0, desc: '' },
    { title: isDnsTask.value ? '查询内容' : '开放端口数', value: isDnsTask.value ? 'DNS 记录' : task.value?.summary?.port_count ?? 0, desc: '' }
  ]
  if (isVulnerabilityTask.value) stats.push({ title: '漏洞数', value: vulnerabilitiesAvailable.value ? task.value?.summary?.vulnerability_count ?? 0 : '-', desc: 'Nuclei 有效匹配' })
  stats.push(
    { title: '观察记录数', value: task.value?.summary?.result_count ?? 0, desc: isDnsTask.value ? 'DNS 查询观察' : '端口、服务与漏洞观察' },
    { title: '扫描耗时', value: formatDuration(task.value?.task_start_time, task.value?.task_end_time), desc: '总耗时' }
  )
  return stats
})
const taskDetail = computed(() => ({
  target: task.value?.task_target?.join(', ') || '-',
  targetLabel: isDnsTask.value ? '目标域名' : '目标 IP',
  addressFamily: isDnsTask.value ? 'DNS' : task.value?.address_family === 'ipv6' ? 'IPv6' : 'IPv4',
  port: isDnsTask.value ? '扫描器配置的记录类型' : task.value?.task_port || '-',
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
const timelineSteps = computed(() => {
  if (!task.value) return []
  const steps = [{ time: formatTime(task.value.task_create_time), label: '创建扫描任务' }]
  if (task.value.task_start_time) steps.push({ time: formatTime(task.value.task_start_time), label: '扫描器开始执行' })
  if (task.value.task_end_time) steps.push({
    time: formatTime(task.value.task_end_time),
    label: currentExecution.value?.status === 'failed' ? `扫描失败：${task.value.failure_reason || '未知原因'}` : '扫描结束'
  })
  return steps
})
const activeStepIndex = computed(() => timelineSteps.value.length - 1)
const ipIntelRows = computed(() => (task.value?.results || []).map((item, index) => ({
  index: index + 1,
  ipCidr: item.ip,
  asn: item.asn ? (/^AS/i.test(item.asn) ? item.asn : `AS${item.asn}`) : '-',
  asOrg: item.as_org || item.isp || '-',
  location: formatLocation(item)
})))

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
  const osPending = resultByIp.value.some((row) => row.ports.some((port) => port.os?.status === 'pending'))
  if (isUnmounted || (!refreshableStatuses.has(currentExecution.value?.status) && !isProjectionPending(projectionStatus.value) && !osPending)) return
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
    if (response.data?.success !== true || !response.data?.data) throw new Error('服务器未返回有效任务数据')
    task.value = response.data.data
    selectedExecutionId.value = response.data.data.selected_execution_id || ''
    if (response.data.data.task_kind === 'dns') await loadDnsComparison()
    else dnsComparison.value = []
    errorMessage.value = ''
  } catch (error) {
    console.error('load task detail failed', error)
    if (!silent) errorMessage.value = error?.response?.status === 404 ? '任务不存在或无权查看' : '任务详情加载失败'
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
    dnsComparisonError.value = 'DNS 对比结果暂不可用。'
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
  if (!window.confirm('确定取消该任务吗？运行中的扫描将在扫描器下一次心跳后终止。')) return
  actionLoading.value = true
  actionMessage.value = ''
  try {
    await http.post(`/api/task/${taskId.value}/cancel`)
    actionMessage.value = '取消请求已提交'
    await loadTask({ silent: true })
  } catch (error) {
    actionMessage.value = error?.response?.status === 409 ? '该任务已结束，无法取消' : '取消任务失败'
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
    if (!newTaskId) throw new Error('服务器未返回新任务 ID')
    await router.push(`/task/${newTaskId}`)
  } catch (error) {
    console.error('retry task failed', error)
    actionMessage.value = '创建重试任务失败'
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
    actionMessage.value = '导出任务结果失败'
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
})
</script>

<template>
  <div class="p-5">
    <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-2">
      <div class="min-w-0 flex items-center gap-2">
        <h2 class="text-lg font-semibold truncate text-left" :title="taskId">
          任务 UUID：{{ displayTaskId }}
        </h2>
        <div class="tooltip tooltip-bottom" :data-tip="taskId">
          <button class="btn btn-ghost btn-xs gap-1" @click="copyTaskId">
            UUID
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-files-icon lucide-files size-3.5"><path d="M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"/><path d="M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z"/><path d="M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1"/></svg>
          </button>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-start md:justify-end gap-2">
        <button v-if="['pending', 'running'].includes(task?.task_status)" class="btn btn-error btn-outline btn-sm" :disabled="actionLoading || task?.cancel_requested" @click="cancelTask">
          {{ task?.cancel_requested ? '正在取消' : '取消任务' }}
        </button>
        <button v-if="['succeeded', 'failed', 'cancelled', 'partial'].includes(task?.task_status)" class="btn btn-outline btn-sm" :disabled="actionLoading" @click="retryTask">重新执行</button>
        <div v-if="!isDnsTask && ['succeeded', 'partial'].includes(task?.task_status)" class="dropdown dropdown-end">
          <button tabindex="0" class="btn btn-outline btn-sm">导出结果</button>
          <ul tabindex="0" class="dropdown-content menu z-10 mt-2 w-36 rounded-box border border-base-300 bg-base-100 p-2 shadow">
            <li><button @click="exportTask('csv')">CSV</button></li>
            <li><button @click="exportTask('json')">JSON</button></li>
          </ul>
        </div>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadTask()">刷新</button>
        <router-link to="/task" class="btn btn-ghost btn-sm">返回列表</router-link>
      </div>
    </div>

    <div v-if="loading && !task" class="grid min-h-80 place-items-center rounded-lg bg-base-200/60">
      <span class="loading loading-spinner loading-md"></span>
    </div>
    <div v-else-if="errorMessage" role="alert" class="alert alert-error"><span>{{ errorMessage }}</span></div>
    <template v-else-if="task">
    <div v-if="actionMessage" role="alert" class="alert alert-info mb-4"><span>{{ actionMessage }}</span></div>
    <div v-if="hasUnavailableResults" role="alert" class="alert alert-warning mb-4">
      <span>任务信息已加载，但部分扫描结果索引暂不可用，请稍后刷新。</span>
    </div>
    <div v-if="projectionNotice" role="status" class="alert mb-4" :class="projectionStatus === 'retrying' ? 'alert-warning' : 'alert-info'">
      <span>{{ projectionNotice }}</span>
    </div>
    <p class="text-sm opacity-70 mb-4 break-words"><span v-if="task.task_source === 'search'" class="badge badge-info badge-soft badge-sm mr-2">搜索生成</span>备注：{{ taskRemark }}</p>

    <div class="card mb-5 border border-base-300 bg-base-100 p-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 class="font-semibold">扫描器执行结果</h3>
        <span class="text-xs opacity-60">共 {{ task.executions?.length || 0 }} 个执行实例</span>
      </div>
      <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        <button
          v-for="execution in task.executions"
          :key="execution.execution_id"
          class="rounded-lg border p-3 text-left transition-colors"
          :class="execution.execution_id === task.selected_execution_id ? 'border-base-content/60 bg-base-content/10' : 'border-base-300 bg-base-200/40 hover:border-base-content/30'"
          @click="changeExecution(execution.execution_id)"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="truncate font-medium">{{ execution.scanner_name || execution.requested_scanner_id || '自动分配（待领取）' }}</span>
            <span class="badge badge-sm" :class="execution.status === 'succeeded' ? 'badge-success' : execution.status === 'failed' ? 'badge-error' : execution.status === 'running' ? 'badge-info' : 'badge-ghost'">{{ statusText[execution.status] || execution.status }}</span>
          </div>
          <div class="mt-1 truncate text-xs opacity-60">{{ execution.scanner_location || '未设置位置' }} · {{ execution.scanner_id || execution.requested_scanner_id || '尚未领取' }}</div>
          <div class="mt-2 flex gap-3 text-xs opacity-70"><span>IP {{ execution.summary.ip_count }}</span><span>端口 {{ execution.summary.port_count }}</span><span>观察 {{ execution.summary.result_count }}</span></div>
          <div v-if="execution.failure_reason" class="mt-2 line-clamp-2 text-xs text-error" :title="execution.failure_reason">{{ execution.failure_reason }}</div>
        </button>
      </div>
    </div>

    <div v-if="task.task_group?.length > 1" class="card bg-base-100 card-border border-base-300 p-4 mb-5 text-sm"><h3 class="font-semibold mb-2">扫描任务组</h3><p class="mb-2 opacity-70">共 {{ task.task_group.length }} 个独立任务，已完成 {{ task.task_group.filter(t => t.status === 'succeeded').length }} 个。</p><div class="flex flex-wrap gap-2"><router-link v-for="child in task.task_group" :key="child.task_id" :to="`/task/${child.task_id}`" class="btn btn-outline btn-xs">{{ child.target_count }} 个目标 · {{ statusText[child.status] || child.status }}</router-link></div></div>
    <div v-if="task.routing || currentExecution?.routing_decision || currentExecution?.performance" class="card bg-base-100 card-border border-base-300 p-4 mb-5 text-sm">
      <h3 class="font-semibold mb-2">扫描器分配</h3>
      <p v-if="task.routing || currentExecution?.routing_decision">{{ routingSummary(currentExecution?.routing_decision || task.routing) }}</p>
      <p class="mt-1 opacity-70">目标地域：{{ routingLocation((currentExecution?.routing_decision || task.routing)?.target_geo) }}</p>
      <p v-if="currentExecution?.performance" class="mt-1 opacity-70">执行耗时：{{ (currentExecution.performance.elapsed_ms / 1000).toFixed(1) }} 秒 · 目标连接样本：{{ currentExecution.performance.connections?.length || 0 }}</p>
      <div v-if="currentExecution?.performance?.connections?.length" class="overflow-x-auto mt-2"><table class="table table-sm"><thead><tr><th>目标</th><th>连接耗时</th><th>结果</th></tr></thead><tbody><tr v-for="sample in currentExecution.performance.connections" :key="`${sample.ip}:${sample.port}`"><td>{{ sample.ip }}:{{ sample.port }}</td><td>{{ sample.elapsed_ms }} ms</td><td>{{ ({connected: '连接成功', refused: '连接被拒绝', timeout: '超时', route_error: '路由错误', other_error: '连接异常'})[sample.outcome] || '未知' }}</td></tr></tbody></table></div>
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
            <h3 class="font-semibold">漏洞结果</h3>
            <span class="text-xs opacity-60">最多展示最近 500 条，共 {{ vulnerabilitiesAvailable ? task.summary?.vulnerability_count || 0 : '-' }} 条</span>
          </div>
          <div v-if="!vulnerabilitiesAvailable" class="rounded-lg bg-warning/10 p-4 text-sm text-warning">
            漏洞结果索引暂不可用，请稍后刷新。
          </div>
          <div v-else-if="!task.vulnerabilities?.length" class="rounded-lg bg-base-200/60 p-6 text-center text-sm opacity-70">
            暂未发现符合当前 Nuclei 策略的漏洞。
          </div>
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
                <div><span class="opacity-60">模板：</span><code>{{ finding.template_id }}</code><span v-if="finding.matcher_name"> / {{ finding.matcher_name }}</span></div>
                <div class="break-all"><span class="opacity-60">匹配位置：</span>{{ finding.matched_at }}</div>
                <div v-if="finding.description" class="whitespace-pre-wrap"><span class="opacity-60">说明：</span>{{ finding.description }}</div>
                <div v-if="finding.remediation" class="whitespace-pre-wrap"><span class="opacity-60">修复建议：</span>{{ finding.remediation }}</div>
                <div v-if="finding.tags?.length" class="flex flex-wrap gap-1"><span v-for="tag in finding.tags" :key="tag" class="badge badge-ghost badge-sm">{{ tag }}</span></div>
                <div v-if="finding.extracted_results?.length"><span class="opacity-60">提取结果：</span><span class="break-all">{{ finding.extracted_results.join('；') }}</span></div>
                <div v-if="finding.references?.length" class="flex flex-col gap-1">
                  <a v-for="reference in finding.references" :key="reference" class="link link-neutral break-all" :href="reference" target="_blank" rel="noopener noreferrer">{{ reference }}</a>
                </div>
                <div class="text-xs opacity-60">发现时间：{{ formatTime(finding.observed_at) }}</div>
              </div>
            </details>
          </div>
        </div>

        <div class="card bg-base-100 card-border border-base-300 p-4">
          <h3 class="font-semibold mb-3">任务细节</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div class="rounded-lg bg-base-200/50 p-3"><span class="opacity-60">{{ taskDetail.targetLabel }}：</span>{{ taskDetail.target }}</div>
            <div class="rounded-lg bg-base-200/50 p-3"><span class="opacity-60">{{ isDnsTask ? '查询类型' : 'Port' }}：</span>{{ taskDetail.port }}</div>
            <div class="rounded-lg bg-base-200/50 p-3"><span class="opacity-60">地址协议：</span>{{ taskDetail.addressFamily }}</div>
            <div class="rounded-lg bg-base-200/50 p-3"><span class="opacity-60">扫描类型：</span>{{ taskDetail.scanType }}</div>
            <div class="rounded-lg bg-base-200/50 p-3"><span class="opacity-60">扫描发起人：</span>{{ taskDetail.starter }}</div>
            <div class="rounded-lg bg-base-200/50 p-3"><span class="opacity-60">开始时间：</span>{{ taskDetail.startTime }}</div>
            <div class="rounded-lg bg-base-200/50 p-3"><span class="opacity-60">结束时间：</span>{{ taskDetail.endTime }}</div>
            <div class="rounded-lg bg-base-200/50 p-3 md:col-span-2"><span class="opacity-60">执行扫描器：</span>{{ taskDetail.scanner }}</div>
            <div v-if="isDnsTask" class="rounded-lg bg-base-200/50 p-3 md:col-span-2"><span class="opacity-60">解析服务器：</span><span v-if="task.dns_resolvers?.length">{{ task.dns_resolvers.map((resolver) => `${resolver.label} (${resolver.ip}:${resolver.port}/${resolver.transport})`).join('；') }}</span><span v-else>扫描器系统 DNS</span></div>
          </div>
        </div>

        <div class="card bg-base-100 card-border border-base-300 p-4">
          <h3 class="font-semibold mb-3">结果展示</h3>
          <div v-if="isDnsTask" class="flex flex-col gap-3">
            <div v-if="dnsComparisonLoading" class="rounded-lg bg-base-200/60 p-6 text-center text-sm opacity-70"><span class="loading loading-spinner loading-xs mr-2"></span>正在加载 DNS 对比结果...</div>
            <div v-else-if="dnsComparisonError" class="rounded-lg bg-warning/10 p-4 text-sm text-warning">{{ dnsComparisonError }}</div>
            <div v-else-if="dnsComparison.length === 0" class="rounded-lg bg-base-200/60 p-6 text-center text-sm opacity-70">暂无 DNS 查询观察。</div>
            <template v-else>
            <div v-for="record in dnsComparison" :key="`${record.name}-${record.record_type}`" class="overflow-hidden rounded-lg border border-base-300 bg-base-100 text-sm">
              <div class="flex flex-wrap items-center justify-between gap-2 bg-base-200/60 px-3 py-2"><span class="font-medium break-all">{{ record.name }}</span><span class="badge badge-outline">{{ record.record_type }}</span></div>
              <div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead><tr><th>DNS 服务器</th><th>响应</th><th>延迟</th><th>返回记录</th></tr></thead>
                  <tbody><tr v-for="resolver in record.resolvers" :key="resolver.id"><td>{{ resolver.label }}<div class="text-xs opacity-60">{{ resolver.ip || '系统 DNS' }}{{ resolver.port ? `:${resolver.port}` : '' }} · {{ resolver.transport || '-' }}</div></td><td><span class="badge badge-sm" :class="resolver.response_code === 'NOERROR' ? 'badge-success' : 'badge-warning'">{{ resolver.response_code }}</span></td><td>{{ resolver.latency_ms == null ? '-' : `${resolver.latency_ms} ms` }}</td><td class="max-w-xl break-all">{{ resolver.answers?.map(formatDnsAnswer).join('；') || '-' }}</td></tr></tbody>
                </table>
              </div>
              <div v-if="record.differences?.length || record.response_code_difference" class="border-t border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning">差异：<span v-if="record.response_code_difference" class="mr-2">响应码不同；</span><span v-for="(difference, index) in record.differences" :key="index" class="mr-2">{{ difference.answer?.type }} {{ difference.answer?.value }}（{{ difference.resolver_ids?.join('、') }}）</span></div>
              <div v-else-if="record.resolvers.length > 1" class="border-t border-success/20 bg-success/10 px-3 py-2 text-xs text-success">各 DNS 服务器返回的记录一致。</div>
            </div>
            </template>
          </div>
          <div v-else class="flex flex-col gap-2">
            <div v-if="!endpointResultsAvailable" class="rounded-lg bg-warning/10 p-4 text-sm text-warning">扫描结果索引暂不可用，请稍后刷新。</div>
            <div v-else-if="resultByIp.length === 0" class="rounded-lg bg-base-200/60 p-6 text-center text-sm opacity-70">暂无扫描结果</div>
            <div v-for="row in resultByIp" :key="row.ip" class="overflow-hidden rounded-lg border border-base-300 bg-base-100 text-sm">
              <div class="flex flex-wrap items-center justify-between gap-2 bg-base-200/60 px-3 py-2">
                <span class="font-medium">{{ row.ip }}</span>
                <div class="text-right text-xs opacity-70">
                  <div>{{ formatNetworkOwner(row) }}</div>
                  <div>{{ formatLocation(row) }}</div>
                </div>
              </div>
              <div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead><tr><th>端口</th><th>协议</th><th>服务</th><th>Banner</th><th>系统线索</th><th>扫描时间</th></tr></thead>
                  <tbody>
                    <tr v-for="port in row.ports" :key="port.port">
                      <td>{{ port.port }}</td>
                      <td>{{ port.protocol || '-' }}</td>
                      <td>{{ port.service || '-' }}</td>
                      <td class="max-w-72 truncate" :title="port.banner || ''">{{ port.banner || '-' }}</td>
                      <td><OsFingerprint :value="port.os" /></td>
                      <td class="whitespace-nowrap">{{ formatTime(port.scan_time) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div v-if="!isDnsTask && endpointResultsAvailable && task.pagination.total_pages > 1" class="mt-4 flex items-center justify-between">
            <span class="text-sm opacity-70">第 {{ task.pagination.page }} / {{ task.pagination.total_pages }} 页</span>
            <div class="join">
              <button class="join-item btn btn-sm" :disabled="page <= 1 || loading" @click="changePage(page - 1)">上一页</button>
              <button class="join-item btn btn-sm" :disabled="page >= task.pagination.total_pages || loading" @click="changePage(page + 1)">下一页</button>
            </div>
          </div>
        </div>
      </div>

      <div class="xl:col-span-1 flex flex-col gap-5">
        <div class="card bg-base-100 card-border border-base-300 p-4">
          <h3 class="font-semibold mb-3">执行状态</h3>
          <div class="flex w-full flex-col text-sm">
            <div class="card bg-base-200 rounded-box px-3 py-2">当前扫描器状态：{{ taskMeta.status }}</div>
            <div class="card bg-base-200 rounded-box px-3 py-2 mt-2">任务总体状态：{{ statusText[task.task_status] || task.task_status }}</div>
            <div class="card bg-base-200 rounded-box px-3 py-2 mt-2">优先级：{{ taskMeta.priority }}</div>
            <div class="card bg-base-200 rounded-box px-3 py-2 mt-2">领取次数：{{ taskMeta.attemptCount }}</div>
            <div v-if="taskMeta.failureReason" class="card bg-error/10 rounded-box px-3 py-2 mt-2 text-error">失败原因：{{ taskMeta.failureReason }}</div>
          </div>

          <div class="divider my-3">Timeline</div>

          <div>
            <ul class="timeline timeline-vertical">
              <li v-for="(step, index) in timelineSteps" :key="step.label">
                <hr v-if="index > 0" :class="isPrevLineActive(index) ? 'bg-base-content' : ''" />
                <div class="timeline-start text-xs opacity-70">{{ step.time }}</div>
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
                <div class="timeline-end timeline-box text-sm">{{ step.label }}</div>
                <hr v-if="index < timelineSteps.length - 1" :class="isNextLineActive(index) ? 'bg-base-content' : ''" />
              </li>
            </ul>
          </div>
        </div>

        <div v-if="!isDnsTask" class="card bg-base-100 card-border border-base-300 p-4">
          <h3 class="font-semibold mb-3">IP 情报</h3>
          <div v-if="!endpointResultsAvailable" class="rounded-lg bg-warning/10 p-4 text-sm text-warning">IP 情报依赖扫描结果索引，暂时无法显示。</div>
          <div v-else class="overflow-x-auto rounded-box border border-base-300">
            <table class="table table-sm">
              <thead>
                <tr>
                  <th></th>
                  <th>IP/CIDR</th>
                  <th>ASN</th>
                  <th>AS 组织</th>
                  <th>位置</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in ipIntelRows" :key="`${row.index}-${row.ipCidr}`">
                  <td>{{ row.index }}</td>
                  <td>{{ row.ipCidr }}</td>
                  <td>{{ row.asn }}</td>
                  <td>{{ row.asOrg }}</td>
                  <td>{{ row.location }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    </template>
  </div>
</template>
