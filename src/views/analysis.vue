<script setup>
import { tr } from '../i18n/index.js'

import { useChartTheme } from '@/composables/useChartTheme'
import ChartCsvExport from '@/components/ChartCsvExport.vue'
import { useTheme } from '@/composables/useTheme'
import { formatDateTime as formatSystemDateTime, formatTime as formatSystemClock } from '../i18n/time.js'
import { calendarDate, mondayDate, addCalendarDays, calendarMidnight, timeSettings } from '../i18n/time.js'
import axios from 'axios'
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch, useId } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import EmptyState from '@/components/EmptyState.vue'
import { renderChartTooltip } from '@/utils/chartTooltip'
import http from '@/utils/http'

const formFieldId = useId()
const { isDark } = useTheme()
const ApexChart = defineAsyncComponent(() => import('vue3-apexcharts/core'))

const weekOptions = [4, 8, 12]
const topOptions = [5, 7, 10]
const weekdayRows = [tr("周一"), tr("周二"), tr("周三"), tr("周四"), tr("周五"), tr("周六"), tr("周日")]

const filters = ref({
  weeks: 12,
  scannerId: '',
  taskSource: '',
  dimension: 'service',
  topN: 5
})
const activeFilters = ref({ ...filters.value })
const scannerList = ref([])
const scannerLoading = ref(false)
const alerts = ref([])
function chartState(empty) {
  return { empty, data: ref(empty), request: null, loading: ref(false), loaded: ref(false), error: ref(''), asOf: ref(null), updatedAt: ref(null) }
}
const distribution = chartState({ items: [], other_count: 0, total: 0 })
const heatmap = chartState([])
const { data: distributionData, loading: distributionLoading, loaded: hasLoadedDistribution, error: distributionError } = distribution
const { data: heatmapItems, loading: heatmapLoading, loaded: hasLoadedHeatmap, error: heatmapError } = heatmap
const heatmapChartContainer = ref(null)
const heatmapChartHeight = ref(380)
const hoveredHeatmapValue = ref(null)

let lastCommonKey = null
let scannerController = null
let heatmapResizeObserver = null
let heatmapResizeFrame = null

const isLoading = computed(() => distributionLoading.value || heatmapLoading.value)

function pushAlert(type, title, description = '', timeout = 7000) {
  alerts.value.unshift({
    id: crypto.randomUUID(),
    type,
    title,
    description,
    timeout
  })
}

function closeAlert(id) {
  alerts.value = alerts.value.filter((alert) => alert.id !== id)
}

function startOfWeekMonday(date) {
  return new Date(`${mondayDate(date)}T00:00:00Z`)
}

function formatDateKey(date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function buildDateRange(weeks) {
  const start = addCalendarDays(mondayDate(), -(weeks - 1) * 7)
  const end = addCalendarDays(calendarDate(), 1)
  return { startAt: calendarMidnight(start), endAt: calendarMidnight(end) }
}

function buildCommonParams(snapshot) {
  const range = buildDateRange(snapshot.weeks)
  const params = {
    start_at: range.startAt,
    end_at: range.endAt,
    page_window: true
  }
  if (snapshot.scannerId) params.scanner_id = snapshot.scannerId
  if (snapshot.taskSource) params.task_source = snapshot.taskSource
  return params
}

function parseDistribution(response) {
  const data = response.data?.data
  if (response.data?.success !== true || !data || !Array.isArray(data.items)) {
    throw new Error(tr("服务器未返回有效的分布数据"))
  }
  return {
    items: data.items,
    other_count: Number(data.other_count) || 0,
    total: Number(data.total) || 0
  }
}

function parseHeatmap(response) {
  const items = response.data?.data?.items
  if (response.data?.success !== true || !Array.isArray(items)) {
    throw new Error(tr("服务器未返回有效的热力图数据"))
  }
  return items
}

function analysisErrorMessage(error) {
  const body = error?.response?.data
  const message = typeof body?.message === 'string' ? body.message : tr("无法从服务器获取统计数据，请稍后重试。")
  if (body?.code === 'analytics_page_snapshot_pending') return tr("分析图表快照正在准备，请稍后刷新。")
  const progress = body?.progress
  if (progress?.last_error) {
    return tr("{0}\n失败执行：{1}；最近原因：{2}", [message, progress.failed_execution_id ?? '未知', progress.last_error])
  }
  return message
}

async function loadScanners() {
  scannerController?.abort()
  scannerController = new AbortController()
  scannerLoading.value = true
  try {
    const response = await http.get('/api/scanner/list', { signal: scannerController.signal })
    const items = response.data?.data
    if (response.data?.success !== true || !Array.isArray(items)) {
      throw new Error(tr("服务器未返回有效的扫描器列表"))
    }
    scannerList.value = items
      .map((item) => ({ id: item.scanner_id, name: item.name || item.scanner_id }))
      .filter((item) => item.id)
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  } catch (error) {
    if (!axios.isCancel(error)) {
      console.error('load analysis scanners failed', error)
      pushAlert('warning', tr("扫描器筛选加载失败"), tr("仍可查看全部扫描器的数据。"))
    }
  } finally {
    scannerLoading.value = false
  }
}

async function loadChart(state, path, params, parse, clear) {
  state.request?.abort()
  const request = new AbortController()
  state.request = request
  if (clear) {
    state.loaded.value = false
    state.data.value = state.empty
  }
  state.loading.value = true
  state.error.value = ''
  try {
    const response = await http.get(path, { params, signal: request.signal })
    if (request.signal.aborted) return
    state.data.value = parse(response)
    const asOf = response.data?.meta?.data_as_of
    state.asOf.value = asOf ? new Date(asOf) : null
    state.updatedAt.value = new Date()
    state.loaded.value = true
  } catch (error) {
    if (request.signal.aborted || axios.isCancel(error)) return
    state.loaded.value = false
    state.data.value = state.empty
    state.error.value = analysisErrorMessage(error)
  } finally {
    if (state.request === request) {
      state.loading.value = false
      state.request = null
    }
  }
}

function loadAnalysis() {
  const snapshot = { ...filters.value }
  const commonParams = buildCommonParams(snapshot)
  const commonKey = JSON.stringify([timeSettings.timezone, commonParams])
  const commonChanged = commonKey !== lastCommonKey
  const distributionChanged = activeFilters.value.dimension !== snapshot.dimension || activeFilters.value.topN !== snapshot.topN
  activeFilters.value = snapshot
  lastCommonKey = commonKey

  loadChart(distribution, '/api/analysis/distribution', {
    ...commonParams,
    dimension: snapshot.dimension,
    limit: snapshot.topN
  }, parseDistribution, commonChanged || distributionChanged)
  if (commonChanged || !distributionChanged) {
    loadChart(heatmap, '/api/analysis/discovery-heatmap', commonParams, parseHeatmap, commonChanged)
  }
}

const distributionSegments = computed(() => {
  const items = distributionData.value.items.map((item) => ({
    name: String(item.name),
    value: Number(item.count) || 0
  }))
  if (distributionData.value.other_count > 0) {
    items.push({ rawName: "其他", get name() { return tr("其他") }, value: distributionData.value.other_count })
  }
  return items
})

const pieSeries = computed(() => distributionSegments.value.map((item) => item.value))
const pieLabels = computed(() => distributionSegments.value.map((item) => item.name))
const pieOptions = useChartTheme(() => ({
  chart: { type: 'pie', toolbar: { show: false } },
  labels: pieLabels.value,
  legend: { position: 'bottom' },
  dataLabels: {
    enabled: true,
    formatter: (value) => `${Number(value).toFixed(1)}%`
  },
  stroke: { width: 1, colors: [isDark.value ? '#1d232a' : '#ffffff'] },
  tooltip: {
    custom({ seriesIndex, dataPointIndex, w }) {
      const index = Number.isInteger(dataPointIndex) ? dataPointIndex : seriesIndex
      return renderChartTooltip({
        title: w.globals.labels[index],
        rows: [{
          get label() { return tr("端点数") },
          value: `${Number(pieSeries.value[index]).toLocaleString('zh-CN')} 个`,
          color: w.globals.colors[index]
        }],
        footer: tr("占比 {0}%", [distributionData.value.total > 0 ? ((pieSeries.value[index] / distributionData.value.total) * 100).toFixed(1) : '0.0'])
      })
    }
  },
  responsive: [
    {
      breakpoint: 480,
      options: { chart: { height: 300 }, legend: { position: 'bottom' } }
    }
  ]
}))

const weekStarts = computed(() => {
  const currentWeekStart = startOfWeekMonday(new Date())
  return Array.from({ length: activeFilters.value.weeks }, (_, index) => {
    const date = new Date(currentWeekStart)
    date.setUTCDate(date.getUTCDate() - (activeFilters.value.weeks - 1 - index) * 7)
    return date
  })
})

const weekLabels = computed(() =>
  weekStarts.value.map((date) => `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`)
)

const heatmapCountMap = computed(() =>
  new Map(heatmapItems.value.map((item) => [String(item.date), Number(item.count) || 0]))
)

const heatmapSeries = computed(() => {
  const today = calendarDate()
  return weekdayRows.map((rowName, rowIndex) => ({
    name: rowName,
    data: weekStarts.value.map((weekStart, weekIndex) => {
      const date = new Date(weekStart)
      date.setUTCDate(date.getUTCDate() + rowIndex)
      const dateLabel = formatDateKey(date)
      return {
        x: weekLabels.value[weekIndex],
        y: dateLabel > today ? null : (heatmapCountMap.value.get(dateLabel) ?? 0),
        dateLabel
      }
    })
  }))
})

const heatmapMaximum = computed(() => Math.max(
  1,
  ...heatmapSeries.value
    .flatMap((series) => series.data.map((point) => point.y))
    .filter((value) => Number.isFinite(value))
))

const heatmapOptions = useChartTheme(() => ({
  chart: {
    type: 'heatmap',
    toolbar: { show: false },
    events: {
      dataPointMouseEnter(_, __, config) {
        const value = config.w.config.series[config.seriesIndex]?.data[config.dataPointIndex]?.y
        hoveredHeatmapValue.value = Number.isFinite(value) ? value : null
      },
      dataPointMouseLeave() {
        hoveredHeatmapValue.value = null
      }
    }
  },
  colors: ['#008ffb'],
  dataLabels: { enabled: false },
  xaxis: { type: 'category', title: { text: tr("最近 {0} 周（按周起始日）", [activeFilters.value.weeks]) } },
  yaxis: { title: { get text() { return tr("星期") } } },
  plotOptions: {
    heatmap: {
      shadeIntensity: 0.5,
      radius: 0,
      useFillColorAsStroke: false,
      colorScale: {
        min: 0,
        max: heatmapMaximum.value
      }
    }
  },
  stroke: { width: 1, colors: [isDark.value ? '#1d232a' : '#ffffff'] },
  legend: { show: false },
  tooltip: {
    custom({ series, seriesIndex, dataPointIndex, w }) {
      const point = w.config.series[seriesIndex].data[dataPointIndex]
      const value = series[seriesIndex][dataPointIndex]
      if (value === null || value === undefined) return ''
      return renderChartTooltip({
        title: point.dateLabel,
        rows: [{
          label: w.config.series[seriesIndex].name,
          value: `${Number(value).toLocaleString('zh-CN')} 个 IP`,
          color: '#008ffb'
        }]
      })
    }
  }
}))

const discoveredTotal = computed(() =>
  heatmapItems.value.reduce((total, item) => total + (Number(item.count) || 0), 0)
)

const hoveredHeatmapPosition = computed(() => {
  if (!Number.isFinite(hoveredHeatmapValue.value)) return null
  return Math.min(1, Math.max(0, hoveredHeatmapValue.value / heatmapMaximum.value))
})

function scheduleSquareHeatmapCells() {
  if (heatmapResizeFrame) cancelAnimationFrame(heatmapResizeFrame)
  heatmapResizeFrame = requestAnimationFrame(() => {
    heatmapResizeFrame = requestAnimationFrame(() => {
      heatmapResizeFrame = null
      const cell = heatmapChartContainer.value?.querySelector('.apexcharts-heatmap-rect')
      if (!cell) return

      const { width, height } = cell.getBoundingClientRect()
      const heightAdjustment = (width - height) * weekdayRows.length
      if (Math.abs(heightAdjustment) < 1) return
      heatmapChartHeight.value = Math.max(180, Math.round(heatmapChartHeight.value + heightAdjustment))
    })
  })
}

const lastUpdatedLabel = computed(() => {
  const loaded = [distribution, heatmap].filter((state) => state.loaded.value)
  const watermarks = loaded.map((state) => state.asOf.value).filter(Boolean)
  if (watermarks.length) {
    return tr("统计截至 {0}", [formatSystemDateTime(new Date(Math.min(...watermarks)))])
  }
  if (!loaded.length) return tr("尚未完成加载")
  return tr("更新于 {0}", [formatSystemClock(new Date(Math.min(...loaded.map((state) => state.updatedAt.value))))])
})

onMounted(() => {
  loadScanners()
  loadAnalysis()
  heatmapResizeObserver = new ResizeObserver(scheduleSquareHeatmapCells)
  if (heatmapChartContainer.value) heatmapResizeObserver.observe(heatmapChartContainer.value)
})

watch(() => timeSettings.timezone, () => loadAnalysis())
watch(heatmapChartContainer, (element, previous) => {
  if (previous) heatmapResizeObserver?.unobserve(previous)
  if (element) heatmapResizeObserver?.observe(element)
})

watch([heatmapSeries, heatmapChartHeight, hasLoadedHeatmap], async () => {
  await nextTick()
  scheduleSquareHeatmapCells()
}, { flush: 'post' })

onBeforeUnmount(() => {
  distribution.request?.abort()
  heatmap.request?.abort()
  scannerController?.abort()
  heatmapResizeObserver?.disconnect()
  if (heatmapResizeFrame) cancelAnimationFrame(heatmapResizeFrame)
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
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="page-title">{{ tr("扫描分析") }}</h1>
        <p class="mt-1 text-sm text-base-content/60">{{ tr("按扫描结果查看常见服务、开放端口和每日发现的 IP。") }}</p>
      </div>
      <span class="text-xs text-base-content/50">{{ lastUpdatedLabel }}</span>
    </div>

    <div class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body gap-4 p-4">
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-1`">{{ tr("时间范围") }}</label></legend>
            <select :id="`${formFieldId}-1`" v-model.number="filters.weeks" class="select select-bordered w-full">
              <option v-for="weeks in weekOptions" :key="weeks" :value="weeks">{{ tr("最近") }} {{ weeks }} {{ tr("周") }}</option>
            </select>
          </fieldset>

          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-2`">{{ tr("扫描器") }}</label></legend>
            <select :id="`${formFieldId}-2`" v-model="filters.scannerId" class="select select-bordered w-full" :disabled="scannerLoading">
              <option value="">{{ scannerLoading ? tr("加载扫描器中…") : tr("全部扫描器") }}</option>
              <option v-for="scanner in scannerList" :key="scanner.id" :value="scanner.id">{{ scanner.name }}</option>
            </select>
          </fieldset>

          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-3`">{{ tr("任务来源") }}</label></legend>
            <select :id="`${formFieldId}-3`" v-model="filters.taskSource" class="select select-bordered w-full">
              <option value="">{{ tr("全部来源") }}</option>
              <option value="manual">{{ tr("手动任务") }}</option>
              <option value="automatic">{{ tr("自动任务") }}</option>
              <option value="search">{{ tr("搜索生成") }}</option>
            </select>
          </fieldset>

          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-4`">{{ tr("分布维度") }}</label></legend>
            <select :id="`${formFieldId}-4`" v-model="filters.dimension" class="select select-bordered w-full">
              <option value="service">{{ tr("识别服务") }}</option>
              <option value="port">{{ tr("开放端口") }}</option>
            </select>
          </fieldset>

          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-5`">{{ tr("显示数量") }}</label></legend>
            <select :id="`${formFieldId}-5`" v-model.number="filters.topN" class="select select-bordered w-full">
              <option v-for="item in topOptions" :key="item" :value="item">Top {{ item }}</option>
            </select>
          </fieldset>
        </div>

        <div class="flex justify-end">
          <button class="btn btn-neutral btn-sm" :disabled="isLoading" @click="loadAnalysis">
            <span v-if="isLoading" class="loading loading-spinner loading-xs"></span>
            {{ isLoading ? tr("查询中…") : tr("应用筛选") }}
          </button>
        </div>
      </div>
    </div>

    <div class="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
      <section class="card border border-base-300 bg-base-100 shadow-sm">
        <div class="card-body p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="font-semibold">{{ tr("常见") }}{{ activeFilters.dimension === 'service' ? tr("服务") : tr("端口") }}{{ tr("分布") }}</h2>
              <p class="mt-1 text-xs text-base-content/60">{{ tr("按唯一 IP、端口和任务执行去重，Top N 之外合并为“其他”。") }}</p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="badge badge-ghost whitespace-nowrap">{{ tr("共") }} {{ distributionData.total.toLocaleString('zh-CN') }} {{ tr("个端点") }}</span>
              <ChartCsvExport
                :filename="`${activeFilters.dimension}-distribution`"
                :series="pieSeries"
                :options="pieOptions"
                :category-header="activeFilters.dimension === 'service' ? '服务' : '端口'"
                value-header="端点数"
                :disabled="distributionLoading || !hasLoadedDistribution || distributionData.total === 0"
              />
            </div>
          </div>

          <div v-if="distributionLoading && !hasLoadedDistribution" class="mt-4 skeleton h-80 w-full rounded-box"></div>
          <EmptyState
            v-else-if="distributionError && !hasLoadedDistribution"
            class="mt-4"
            type="error"
            :title="tr(&quot;服务分布加载失败&quot;)"
            :message="distributionError"
          />
          <EmptyState
            v-else-if="distributionData.total === 0"
            class="mt-4"
            :title="tr(&quot;暂无服务数据&quot;)"
            :message="tr(&quot;当前筛选范围内没有可用于统计的扫描结果。&quot;)"
          />
          <div v-else class="relative mt-2">
            <ApexChart type="pie" height="340" :options="pieOptions" :series="pieSeries" />
            <span v-if="distributionLoading" class="loading loading-spinner loading-sm absolute top-2 right-2"></span>
          </div>
        </div>
      </section>

      <section class="card border border-base-300 bg-base-100 shadow-sm">
        <div class="card-body p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="font-semibold">{{ tr("发现 IP 热力图") }}</h2>
              <p class="mt-1 text-xs text-base-content/60">{{ tr("按自然日统计去重 IP；无发现显示为 0，未来日期留空。") }}</p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="badge badge-ghost whitespace-nowrap">{{ tr("累计") }} {{ discoveredTotal.toLocaleString('zh-CN') }}</span>
              <ChartCsvExport
                filename="discovered-ip-heatmap"
                :series="heatmapSeries"
                :options="heatmapOptions"
                category-header="日期"
                value-header="发现 IP 数"
                :disabled="heatmapLoading || !hasLoadedHeatmap"
              />
            </div>
          </div>

          <div v-if="heatmapLoading && !hasLoadedHeatmap" class="mt-4 skeleton h-96 w-full rounded-box"></div>
          <EmptyState
            v-else-if="heatmapError && !hasLoadedHeatmap"
            class="mt-4"
            type="error"
            :title="tr(&quot;热力图加载失败&quot;)"
            :message="heatmapError"
          />
          <div v-else ref="heatmapChartContainer" class="relative mt-2 flex items-stretch gap-3">
            <div class="min-w-0 flex-1">
              <ApexChart type="heatmap" :height="heatmapChartHeight" :options="heatmapOptions" :series="heatmapSeries" />
            </div>
            <span v-if="heatmapLoading" class="loading loading-spinner loading-sm absolute top-2 right-2"></span>
            <div v-if="hasLoadedHeatmap" class="flex shrink-0 flex-col items-center text-xs text-base-content/60">
              <span>{{ tr("发现 IP") }}</span>
              <div class="relative mt-1 h-56 w-14">
                <span class="absolute left-0 top-0">{{ heatmapMaximum.toLocaleString('zh-CN') }}</span>
                <span class="absolute bottom-0 left-0">0</span>
                <div class="absolute inset-y-4 left-7 w-3 rounded-sm border border-base-300" style="background: linear-gradient(to top, #e0f2fe 0%, #008ffb 100%)">
                  <div
                    v-if="hoveredHeatmapPosition !== null"
                    class="absolute left-full -translate-y-1/2"
                    :style="{ top: `${(1 - hoveredHeatmapPosition) * 100}%` }"
                  >
                    <span class="block h-0 w-0 border-y-4 border-r-6 border-y-transparent border-r-base-content"></span>
                    <span class="absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap rounded bg-base-200 px-1 py-0.5 font-medium text-base-content shadow-sm">{{ hoveredHeatmapValue.toLocaleString('zh-CN') }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
