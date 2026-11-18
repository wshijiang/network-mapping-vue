<script setup>
import { tr } from '../i18n/index.js'

import { useChartTheme } from '@/composables/useChartTheme'
import ChartCsvExport from '@/components/ChartCsvExport.vue'
import { formatDateTime as formatSystemDateTime, formatTime as formatSystemClock } from '../i18n/time.js'
import { computed, onMounted, ref, useId } from 'vue'
import { defineAsyncComponent } from 'vue'
import { useRoute } from 'vue-router'
import AppAlert from '@/components/AppAlert.vue'
import EmptyState from '@/components/EmptyState.vue'
import SystemMaintenanceTooltip from '@/components/SystemMaintenanceTooltip.vue'
import { renderChartTooltip } from '@/utils/chartTooltip'
import http from '@/utils/http'
import { buildSystemMaintenanceAnnotations, loadSystemMaintenanceHistory, useSystemMaintenanceAnnotations } from '@/utils/systemMaintenanceAnnotations'

const formFieldId = useId()
const ApexChart = defineAsyncComponent(() => import('vue3-apexcharts/core'))
const route = useRoute()

const alerts = ref([])
const items = ref([])
const loading = ref(false)
const initialLoadFailed = ref(false)
const hasLoaded = ref(false)
const page = ref(1)
const pageSize = 25
const total = ref(0)
const summary = ref({
  total: 0,
  errors: 0,
  client_errors: 0,
  server_errors: 0,
  error_rate: 0,
  p95_ms: null,
  p99_ms: null,
  error_types: [],
  trend: []
})
const summaryLoading = ref(false)
const { maintenanceAnnotations, maintenanceChartRef, maintenanceTooltip, showMaintenanceTooltip, hideMaintenanceTooltip, applyMaintenanceAnnotations } = useSystemMaintenanceAnnotations()

const windowOptions = [
  { value: '', get label() { return tr("全部时间") } },
  { value: '1h', get label() { return tr("最近 1 小时") } },
  { value: '24h', get label() { return tr("最近 24 小时") } },
  { value: '7d', get label() { return tr("最近 7 天") } }
]

const methodOptions = ['', 'GET', 'POST', 'PUT', 'DELETE', 'HEAD']

const granularityOptions = [
  { value: 'auto', get label() { return tr("自动") }, seconds: null },
  { value: '1m', get label() { return tr("1 分钟") }, seconds: 60 },
  { value: '5m', get label() { return tr("5 分钟") }, seconds: 300 },
  { value: '15m', get label() { return tr("15 分钟") }, seconds: 900 },
  { value: '30m', get label() { return tr("30 分钟") }, seconds: 1800 },
  { value: '1h', get label() { return tr("1 小时") }, seconds: 3600 },
  { value: '2h', get label() { return tr("2 小时") }, seconds: 7200 },
  { value: '6h', get label() { return tr("6 小时") }, seconds: 21600 }
]

const errorTypeLabels = {
  get bad_request() { return tr("错误请求") },
  get unauthorized() { return tr("未授权") },
  get forbidden() { return tr("禁止访问") },
  get not_found() { return tr("未找到") },
  get timeout() { return tr("超时") },
  get conflict() { return tr("冲突") },
  get validation() { return tr("校验失败") },
  get rate_limited() { return tr("限流") },
  get client_error() { return tr("客户端错误") },
  get server_error() { return tr("服务器错误") }
}

// 趋势图错误状态码细分：按总量取前 N 个状态码各画一条线，其余归入「其他」。
const MAX_STATUS_SERIES = 8

const STATUS_COLORS = {
  400: '#fbbf24',
  401: '#f59e0b',
  403: '#f97316',
  404: '#fb923c',
  408: '#facc15',
  409: '#eab308',
  422: '#ca8a04',
  429: '#a16207',
  500: '#ef4444',
  502: '#dc2626',
  503: '#b91c1c',
  504: '#991b1b'
}

const FALLBACK_COLORS = ['#10b981', '#06b6d4', '#8b5cf6', '#ec4899', '#f43f5e', '#84cc16', '#14b8a6', '#6366f1']

function statusColor(code) {
  return STATUS_COLORS[code] || FALLBACK_COLORS[Number(code) % FALLBACK_COLORS.length]
}

function queryString(value) {
  return typeof value === 'string' ? value : ''
}

const requestedWindow = queryString(route.query.window)
const hasWindowQuery = typeof route.query.window === 'string'
const filters = ref({
  window: hasWindowQuery && windowOptions.some((option) => option.value === requestedWindow) ? requestedWindow : '1h',
  method: queryString(route.query.method).toUpperCase(),
  path: queryString(route.query.path),
  status: '',
  error_type: '',
  reason_code: '',
  only_errors: false,
  request_id: ''
})

const granularity = ref('auto')

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

const errorRatePercent = computed(() => (Number(summary.value.error_rate) * 100).toFixed(2))

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

function formatDuration(ms) {
  if (ms === null || ms === undefined) return '--'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function statusClass(status) {
  if (status >= 500) return 'badge-error'
  if (status >= 400) return 'badge-warning'
  if (status >= 300) return 'badge-neutral'
  return 'badge-success'
}

function errorTypeLabel(value) {
  return errorTypeLabels[value] || value
}

function windowRange(window) {
  const end = new Date()
  const now = end.getTime()
  if (window === '1h') return { start: new Date(now - 3600_000).toISOString(), end: end.toISOString() }
  if (window === '24h') return { start: new Date(now - 24 * 3600_000).toISOString(), end: end.toISOString() }
  if (window === '7d') return { start: new Date(now - 7 * 24 * 3600_000).toISOString(), end: end.toISOString() }
  return null
}

function trendRangeMilliseconds() {
  const range = windowRange(filters.value.window)
  if (range) return new Date(range.end).getTime() - new Date(range.start).getTime()
  return 30 * 24 * 3600 * 1000 // 「全部时间」按 30 天估算，与后端一致
}

function granularityDisabled(option) {
  if (option.value === 'auto') return false
  const duration = trendRangeMilliseconds()
  if (!duration || duration <= 0) return false
  return Math.ceil(duration / (option.seconds * 1000)) > 1500
}

function ensureValidGranularity() {
  const selected = granularityOptions.find((item) => item.value === granularity.value)
  if (selected && granularityDisabled(selected)) granularity.value = 'auto'
}

function buildParams(includePagination = true, includeWindow = false) {
  const params = {}
  for (const key of ['method', 'path', 'status', 'error_type', 'reason_code', 'request_id']) {
    if (filters.value[key]) params[key] = filters.value[key]
  }
  if (filters.value.only_errors) params.only_errors = true
  const range = windowRange(filters.value.window)
  if (range) {
    params.start = range.start
    params.end = range.end
  }
  if (includeWindow) {
    if (filters.value.window) params.window = filters.value.window
    if (granularity.value) params.granularity = granularity.value
  }
  if (includePagination) {
    params.page = page.value
    params.page_size = pageSize
  }
  return params
}

async function loadSummary() {
  summaryLoading.value = true
  try {
    const response = await http.get('/api/requests/summary', { params: buildParams(false, true) })
    if (response.data?.success === true && response.data?.summary) {
      summary.value = response.data.summary
      const trend = summary.value.trend || []
      const range = windowRange(filters.value.window)
      const history = await loadSystemMaintenanceHistory()
      maintenanceAnnotations.value = buildSystemMaintenanceAnnotations(history, {
        startAt: range?.start || trend.at(0)?.bucket,
        endAt: range?.end || trend.at(-1)?.bucket,
        onLabelMouseEnter: showMaintenanceTooltip,
        onLabelMouseLeave: hideMaintenanceTooltip
      })
    }
  } catch (error) {
    console.error('load request summary failed', error)
  } finally {
    summaryLoading.value = false
  }
}

async function loadItems() {
  loading.value = true
  try {
    const response = await http.get('/api/requests', { params: buildParams(true, false) })
    items.value = response.data?.items || []
    total.value = Number(response.data?.pagination?.total) || 0
    initialLoadFailed.value = false
    hasLoaded.value = true
  } catch (error) {
    console.error('load requests failed', error)
    if (!hasLoaded.value) {
      items.value = []
      total.value = 0
      initialLoadFailed.value = true
    }
    if (error.response?.status === 403) {
      pushAlert('error', tr("请求日志加载失败"), tr("只有管理员可以查看请求日志。"))
    } else {
      pushAlert('error', tr("请求日志加载失败"), tr("请检查网络连接或服务器运行状态。"))
    }
  } finally {
    loading.value = false
  }
}

async function loadAll() {
  await Promise.all([loadSummary(), loadItems()])
}

function applyFilters() {
  page.value = 1
  loadAll()
}

function resetFilters() {
  filters.value = { window: '1h', method: '', path: '', status: '', error_type: '', reason_code: '', only_errors: false, request_id: '' }
  granularity.value = 'auto'
  page.value = 1
  loadAll()
}

function changePage(nextPage) {
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value) return
  page.value = nextPage
  loadItems()
}

const granularityLabel = computed(() => {
  const value = summary.value.granularity
  if (!value) return ''
  return granularityOptions.find((item) => item.value === value)?.label || value
})
// 汇总整个时间范围内每个错误状态码的总量，用于决定 Top-N 与「其他」。
const statusTotals = computed(() => {
  const totals = new Map()
  for (const point of summary.value.trend || []) {
    for (const [code, count] of Object.entries(point.status_codes || {})) {
      totals.set(code, (totals.get(code) || 0) + Number(count || 0))
    }
  }
  return totals
})

const topStatusCodes = computed(() => [...statusTotals.value.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, MAX_STATUS_SERIES)
  .map(([code]) => code))

const hasRestStatusCodes = computed(() => statusTotals.value.size > MAX_STATUS_SERIES)

function statusCountAt(point, code) {
  return Number(point?.status_codes?.[code]) || 0
}

const trendSeries = computed(() => {
  const trend = summary.value.trend || []
  const series = [
    { rawName: "请求数", get name() { return tr("请求数") }, data: trend.map((point) => ({ x: point.bucket, y: point.total })), color: '#3b82f6' },
    { rawName: "4xx 客户端错误", get name() { return tr("4xx 客户端错误") }, data: trend.map((point) => ({ x: point.bucket, y: point.client_errors })), color: '#f59e0b' },
    { rawName: "5xx 服务端错误", get name() { return tr("5xx 服务端错误") }, data: trend.map((point) => ({ x: point.bucket, y: point.server_errors })), color: '#ef4444' }
  ]
  for (const code of topStatusCodes.value) {
    series.push({
      name: `HTTP ${code}`,
      data: trend.map((point) => ({ x: point.bucket, y: statusCountAt(point, code) })),
      color: statusColor(code)
    })
  }
  if (hasRestStatusCodes.value) {
    series.push({
      rawName: "其他错误", get name() { return tr("其他错误") },
      data: trend.map((point) => {
        let rest = 0
        for (const [code, count] of Object.entries(point.status_codes || {})) {
          if (!topStatusCodes.value.includes(code)) rest += Number(count || 0)
        }
        return { x: point.bucket, y: rest }
      }),
      color: '#94a3b8'
    })
  }
  return series
})
const trendOptions = useChartTheme(() => ({
  chart: { type: 'area', toolbar: { show: false }, stacked: false },
  dataLabels: { enabled: false },
  stroke: { curve: 'smooth', width: 2 },
  xaxis: { type: 'datetime', labels: { datetimeUTC: true, formatter: (value, timestamp) => formatSystemClock(timestamp ?? value) } },
  yaxis: { labels: { formatter: (value) => Number(value).toLocaleString('zh-CN') } },
  legend: { position: 'top' },
  tooltip: {
    shared: true,
    intersect: false,
    custom({ dataPointIndex }) {
      const point = summary.value.trend[dataPointIndex]
      if (!point) return ''
      const rows = [
        [tr("请求数"), point.total, '#3b82f6'],
        [tr("4xx 客户端错误"), point.client_errors, '#f59e0b'],
        [tr("5xx 服务端错误"), point.server_errors, '#ef4444']
      ]
      for (const code of topStatusCodes.value) {
        const value = statusCountAt(point, code)
        if (value > 0) rows.push([`HTTP ${code}`, value, statusColor(code)])
      }
      if (hasRestStatusCodes.value) {
        let rest = 0
        for (const [code, count] of Object.entries(point.status_codes || {})) {
          if (!topStatusCodes.value.includes(code)) rest += Number(count || 0)
        }
        if (rest > 0) rows.push([tr("其他错误"), rest, '#94a3b8'])
      }
      return renderChartTooltip({
        title: formatTime(point.bucket),
        rows: rows.map(([label, value, color]) => ({
          label,
          value: Number(value).toLocaleString('zh-CN'),
          color
        }))
      })
    }
  }
}))

onMounted(loadAll)
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
        <h1 class="page-title">{{ tr("请求日志") }}</h1>
        <p class="mt-1 text-sm text-base-content/60">{{ tr("查看每一个业务请求，自动识别 4xx / 5xx 错误。") }}</p>
      </div>
    </div>

    <div class="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
      <div class="stat rounded-box border border-base-300 bg-base-100">
        <div class="stat-title">{{ tr("总请求数") }}</div>
        <div class="stat-value text-2xl">{{ Number(summary.total).toLocaleString('zh-CN') }}</div>
      </div>
      <div class="stat rounded-box border border-base-300 bg-base-100">
        <div class="stat-title">{{ tr("错误率") }}</div>
        <div class="stat-value text-2xl" :class="{ 'text-error': Number(summary.error_rate) > 0.05 }">{{ errorRatePercent }}%</div>
        <div class="stat-desc text-xs">{{ tr("错误") }} {{ Number(summary.errors).toLocaleString('zh-CN') }} {{ tr("次") }}</div>
      </div>
      <div class="stat rounded-box border border-base-300 bg-base-100">
        <div class="stat-title">{{ tr("P95 耗时") }}</div>
        <div class="stat-value text-2xl">{{ summary.p95_ms === null ? '--' : `${Math.round(summary.p95_ms)} ms` }}</div>
        <div class="stat-desc text-xs">P99 {{ summary.p99_ms === null ? '--' : `${Math.round(summary.p99_ms)} ms` }}</div>
      </div>
      <div class="stat rounded-box border border-base-300 bg-base-100">
        <div class="stat-title">{{ tr("5xx 服务端错误") }}</div>
        <div class="stat-value text-2xl text-error">{{ Number(summary.server_errors).toLocaleString('zh-CN') }}</div>
      </div>
    </div>

    <div class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body gap-4 p-4">
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-8">
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-1`">{{ tr("时间范围") }}</label></legend>
            <select :id="`${formFieldId}-1`" v-model="filters.window" class="select select-bordered w-full" @change="ensureValidGranularity">
              <option v-for="option in windowOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </fieldset>
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-2`">{{ tr("时间粒度") }}</label></legend>
            <select :id="`${formFieldId}-2`" v-model="granularity" class="select select-bordered w-full">
              <option v-for="option in granularityOptions" :key="option.value" :value="option.value" :disabled="granularityDisabled(option)">
                {{ option.label }}
              </option>
            </select>
          </fieldset>
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-3`">{{ tr("方法") }}</label></legend>
            <select :id="`${formFieldId}-3`" v-model="filters.method" class="select select-bordered w-full">
              <option v-for="method in methodOptions" :key="method" :value="method">{{ method || tr("全部方法") }}</option>
            </select>
          </fieldset>
          <input v-model.trim="filters.path" class="input input-bordered w-full self-end mb-1" :placeholder="tr(&quot;路径（模糊匹配）&quot;)" @keyup.enter="applyFilters" />
          <input v-model.trim="filters.status" type="number" class="input input-bordered w-full self-end mb-1" :placeholder="tr(&quot;状态码&quot;)" @keyup.enter="applyFilters" />
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-4`">{{ tr("错误类型") }}</label></legend>
            <select :id="`${formFieldId}-4`" v-model="filters.error_type" class="select select-bordered w-full">
              <option value="">{{ tr("全部类型") }}</option>
              <option v-for="(label, value) in errorTypeLabels" :key="value" :value="value">{{ label }}</option>
            </select>
          </fieldset>
          <input v-model.trim="filters.reason_code" class="input input-bordered w-full self-end mb-1" :placeholder="tr(&quot;具体原因代码&quot;)" @keyup.enter="applyFilters" />
          <input v-model.trim="filters.request_id" class="input input-bordered w-full self-end mb-1" :placeholder="tr(&quot;请求 ID (UUID)&quot;)" @keyup.enter="applyFilters" />
          <label class="flex cursor-pointer items-center gap-2 self-end pb-3">
            <input v-model="filters.only_errors" type="checkbox" class="checkbox checkbox-sm" />
            <span class="text-sm">{{ tr("仅看错误") }}</span>
          </label>
        </div>
        <div class="flex justify-end gap-2">
          <button class="btn btn-ghost btn-sm" :disabled="loading || summaryLoading" @click="resetFilters">{{ tr("重置") }}</button>
          <button class="btn btn-neutral btn-sm" :disabled="loading || summaryLoading" @click="applyFilters">{{ tr("查询") }}</button>
        </div>
      </div>
    </div>

    <section class="card mt-5 border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="font-semibold">{{ tr("请求与错误趋势") }} <span v-if="granularityLabel" class="badge badge-ghost badge-sm align-middle">{{ granularityLabel }}</span></h2>
            <p class="mt-1 text-xs text-base-content/60">{{ tr("按时间分桶统计请求量，展示 4xx / 5xx 汇总，并将高频错误状态码细分为独立曲线。") }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <span v-if="summaryLoading" class="loading loading-spinner loading-sm"></span>
            <ChartCsvExport
              filename="request-trend"
              :series="trendSeries"
              :options="trendOptions"
              unit="个请求"
              :disabled="summaryLoading"
            />
          </div>
        </div>
        <div v-if="summaryLoading && !summary.trend.length" class="mt-4 skeleton h-72 w-full rounded-box"></div>
        <EmptyState v-else-if="!summary.trend.length" class="mt-4" :title="tr(&quot;暂无趋势数据&quot;)" :message="tr(&quot;当前筛选范围内没有请求记录。&quot;)" />
        <div v-else class="relative mt-2">
          <ApexChart ref="maintenanceChartRef" type="area" height="300" :options="trendOptions" :series="trendSeries" @mounted="applyMaintenanceAnnotations" />
          <SystemMaintenanceTooltip :tooltip="maintenanceTooltip" />
        </div>
      </div>
    </section>

    <div class="mt-4 overflow-hidden rounded-box border border-base-300 bg-base-100">
      <div v-if="loading" class="space-y-3 p-5">
        <div class="skeleton h-72 w-full rounded-box"></div>
        <div class="skeleton h-4 w-52"></div>
      </div>
      <EmptyState
        v-else-if="initialLoadFailed"
        type="error"
        :title="tr(&quot;加载数据失败&quot;)"
        :message="tr(&quot;这通常是由于客户端与服务器的网络不可达或服务器崩溃了\n请检查您的网络，并测试是否可以正常访问服务器，如果上述一切正常，请联系系统管理员&quot;)"
      />
      <EmptyState v-else-if="items.length === 0" :title="tr(&quot;暂无请求记录&quot;)" :message="tr(&quot;当前筛选条件下没有可显示的记录。&quot;)" />
      <div v-else-if="items.length" class="overflow-x-auto">
        <table class="table table-zebra">
          <thead>
            <tr>
              <th>{{ tr("时间") }}</th>
              <th>{{ tr("方法") }}</th>
              <th>{{ tr("路径") }}</th>
              <th>{{ tr("状态") }}</th>
              <th>{{ tr("耗时") }}</th>
              <th>{{ tr("来源 IP") }}</th>
              <th>{{ tr("操作者") }}</th>
              <th>{{ tr("请求 ID") }}</th>
              <th>{{ tr("错误类型") }}</th>
              <th>{{ tr("具体原因") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id">
              <td class="whitespace-nowrap text-xs">{{ formatTime(item.occurred_at) }}</td>
              <td><span class="badge badge-outline badge-sm font-mono">{{ item.http_method }}</span></td>
              <td class="max-w-64 truncate" :title="item.request_path">{{ item.request_path }}</td>
              <td><span class="badge badge-sm" :class="statusClass(item.status_code)">{{ item.status_code }}</span></td>
              <td class="font-mono text-xs">{{ formatDuration(item.duration_ms) }}</td>
              <td class="font-mono text-xs">{{ item.client_ip || '--' }}</td>
              <td>{{ item.actor_name || '--' }}</td>
              <td class="max-w-48">
                <span class="truncate font-mono text-xs" :title="item.request_id">{{ item.request_id }}</span>
              </td>
              <td>
                <span v-if="item.error_type" class="badge badge-sm" :class="{ 'badge-error': item.error_level === 'server_error', 'badge-warning': item.error_level === 'client_error' }">
                  {{ errorTypeLabel(item.error_type) }}
                </span>
                <span v-else class="text-base-content/40">--</span>
              </td>
              <td class="max-w-64">
                <span v-if="item.reason_code" class="block truncate font-mono text-xs" :title="item.reason_code">{{ item.reason_code }}</span>
                <span v-else class="text-base-content/40">--</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="items.length" class="mt-4 flex items-center justify-between text-sm">
      <span class="text-base-content/60">{{ tr("共") }} {{ total }} {{ tr("条，第") }} {{ page }} / {{ totalPages }} {{ tr("页") }}</span>
      <div class="join">
        <button class="btn btn-sm join-item" :disabled="page <= 1 || loading" @click="changePage(page - 1)">{{ tr("上一页") }}</button>
        <button class="btn btn-sm join-item" :disabled="page >= totalPages || loading" @click="changePage(page + 1)">{{ tr("下一页") }}</button>
      </div>
    </div>
  </main>
</template>
