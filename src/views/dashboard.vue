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

  <div class="page-shell grid grid-cols-1 xl:grid-cols-2 gap-5">
    <h1 class="page-title -mb-1 xl:col-span-2">{{ tr("仪表盘") }}</h1>
    <div class="card bg-base-100 card-border border-base-300 p-4">
      <div class="mb-3">
        <h3 class="font-semibold">{{ tr("服务器资源利用状态") }}</h3>
        <p class="text-xs opacity-60">{{ tr("使用率 / 空闲率（100% 堆叠）") }}</p>
      </div>
      <div v-if="isFirstLoad" class="skeleton h-64 w-full rounded-box"></div>
      <ApexChart v-else type="bar" height="320" :options="resourceChartOptions" :series="resourceChartSeries" />
    </div>

    <div class="card bg-base-100 card-border border-base-300 p-4">
      <div class="mb-3">
        <h3 class="font-semibold">{{ tr("最近 7 天扫描情况") }}</h3>
        <p class="text-xs opacity-60">{{ tr("按扫描器统计") }}</p>
      </div>
      <div v-if="isFirstLoad" class="skeleton h-64 w-full rounded-box"></div>
      <ApexChart v-else type="bar" height="320" :options="scanChartOptions" :series="scanChartSeries" />
    </div>
  </div>

  <div class="px-5">
    <SystemHistoryPanel @error="handleResourceHistoryError" />
  </div>

  <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 p-5">
    <div v-for="item in overviewCards" :key="item.title" class="stats shadow border border-base-300 bg-base-100">
      <div class="stat">
        <div class="stat-title">{{ item.title }}</div>
        <div class="stat-value text-2xl" :class="item.class">{{ item.value }}</div>
        <div class="stat-desc">{{ item.description }}</div>
      </div>
    </div>
  </div>   
  <!-- 资源卡片结束 -->

  <!-- 系统信息及扫描日志卡片 -->
  <div class="grid grid-cols-1 xl:grid-cols-2 gap-5 p-5">
    <div class="card bg-base-100 card-border border-base-300 p-4">
      <div class="mb-3">
        <h3 class="font-semibold">{{ tr("系统详细信息") }}</h3>
        <p class="text-xs opacity-60">{{ tr("主机、操作系统与网络接口") }}</p>
      </div>

      <div v-if="isFirstLoad" class="skeleton h-64 w-full rounded-box"></div>

      <div v-else class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center justify-between gap-2 rounded-box border border-base-300 bg-base-200/40 px-4 py-3">
          <span class="text-sm font-medium">{{ tr("系统运行状态") }}</span>
          <span class="flex items-center gap-2 text-sm">
            <span :aria-label="tr(&quot;运行中&quot;)" class="status status-success"></span>
            <span>{{ tr("运行中") }}</span>
            <span class="text-xs opacity-60">{{ uptime }}</span>
          </span>
        </div>

        <dl class="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <div v-for="item in systemDetailItems" :key="item.label" class="flex min-w-0 justify-between gap-4 border-b border-base-300 py-2.5">
            <dt class="shrink-0 text-xs opacity-60">{{ item.label }}</dt>
            <dd class="min-w-0 truncate text-right text-sm" :title="item.value">{{ item.value }}</dd>
          </div>
        </dl>

        <div class="rounded-box border border-base-300">
          <div class="flex items-center justify-between border-b border-base-300 px-4 py-2.5">
            <span class="text-sm font-medium">{{ tr("网络接口") }}</span>
            <span class="text-xs opacity-60">{{ tr("系统启动以来累计流量") }}</span>
          </div>
          <div class="max-h-64 divide-y divide-base-300 overflow-y-auto">
            <div v-for="iface in networkInterfaces" :key="iface.name" class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5 text-sm">
              <span class="truncate font-mono text-xs" :title="iface.name">{{ iface.name }}</span>
              <span class="text-right text-xs opacity-70">
                ↑ {{ iface.send }}
                <span class="mx-1 opacity-40">/</span>
                ↓ {{ iface.receive }}
              </span>
            </div>
            <div v-if="networkInterfaces.length === 0" class="px-4 py-6 text-center text-sm opacity-50"> {{ tr("暂无网络接口数据") }} </div>
          </div>
        </div>
      </div>
    </div>
    <!-- 系统信息卡片结束 -->

    <!-- 当前任务卡片 -->
    <div class="big_card">
      <div v-if="isFirstLoad" class="skeleton h-56 w-full rounded-box"></div>

      <div v-else class="overflow-x-auto">
        <table class="table table-fixed min-w-[600px]">
          <!-- head -->
          <thead>
            <tr>
              <th class="w-8"></th>
              <th class="w-20">{{ tr("任务") }}</th>
              <th class="w-24 truncate">{{ tr("扫描器") }}</th>
              <th class="w-36 max-w-36">{{ tr("目标") }}</th>
              <th class="w-20">{{ tr("发起人") }}</th>
              <th class="w-24">{{ tr("状态") }}</th>
              <th class="max-w-36">{{ tr("备注") }}</th>
            </tr>
          </thead>
          <!-- tbody -->
          <tbody class="">
            <!-- row start -->
            <!-- <tr>
              <th class="w-10">1</th>
              <th>121212</th>
              <th class="w-28 truncate">sadfeadsf</th>
              <th class="w-36 truncate">221.233.151.58/24</th>
              <th>System</th>
              <th>Today</th>
              <th class="w-24"><span class="scan_status scan_faild">错误</span></th>
              <th></th>
            </tr> -->

            <transition-group name="tasktable">
              <tr v-for="(taskitem, index) in taskList" :key="taskitem.taskid" class="hover:bg-base-300">
                <td class="w-8">{{ index + 1}}</td>
                <td class="w-20 truncate">{{ taskitem.taskid }}</td>
                <td class="w-24 truncate">{{ taskitem.scannerId }}</td>
                <td class="w-36 max-w-36 truncate">{{ taskitem.target }}</td>
                <td class="w-20">{{ taskitem.operationPerson }}</td>
                <td class="w-24"><span class="scan_status w-full" :class="stateConfig[taskitem.status].class">{{ stateConfig[taskitem.status].text }}</span></td>
                <td class="max-w-36 truncate">{{ taskitem.remark }}</td>
              </tr>
            </transition-group>
          </tbody>

        </table>
      </div>

    </div>
    <!-- 当前任务卡片结束 -->

  </div>


</template>

<style scoped>
  .tasktable-enter-active,.tasktable-leave-active {
    transition: all 0.5s ease;
  }
  .tasktable-enter-form,.tasktable-leave-to {
    opacity: 0;
    transform: translateX(30px);
  }
</style>

<script setup>
import { tr } from '../i18n/index.js'

import { useChartTheme } from '@/composables/useChartTheme'
import { formatDate as formatSystemDate, timeSettings } from '../i18n/time.js'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import SystemHistoryPanel from '@/components/SystemHistoryPanel.vue'
import { renderChartTooltip } from '@/utils/chartTooltip'
import http from '@/utils/http'

const ApexChart = defineAsyncComponent(() => import('vue3-apexcharts/core'))

const alerts = ref([])

const systemData = ref(null)
const dashboardData = ref(null)
const systemDataErrorVisible = ref(false)
const isFirstLoad = ref(true)
const percentFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
let refreshTimer = null
let dashboardTimer = null

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

function handleResourceHistoryError(error) {
  pushAlert('error', error.title, error.description)
}

function normalizePercent(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.min(100, Math.max(0, Math.round(numeric * 100) / 100))
}

function formatPercent(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${percentFormatter.format(numeric)}%` : '--'
}

async function fetchSystemData() {
  try {
    const response = await http.get('/api/data/system-data')
    if (response.data) {
      systemData.value = response.data
      systemDataErrorVisible.value = false
      isFirstLoad.value = false
    }
  } catch (error) {
    console.error('fetch system data failed', error)
    if (!systemDataErrorVisible.value) {
      systemDataErrorVisible.value = true
      pushAlert('error', tr("系统数据获取失败"), tr("已保留上一次可用数据。"), 7000)
    }
  }
}

async function fetchDashboardData() {
  try {
    const response = await http.get('/api/dashboard/overview')
    if (response.data?.success === true) {
      dashboardData.value = response.data.data
    }
  } catch (error) {
    console.error('fetch dashboard data failed', error)
  }
}

const overviewCards = computed(() => {
  const tasks = dashboardData.value?.tasks || {}
  const finished = Number(tasks.succeeded || 0) + Number(tasks.failed || 0) + Number(tasks.cancelled || 0)
  const successRate = finished > 0 ? `${Math.round((Number(tasks.succeeded || 0) / finished) * 100)}%` : '0%'
  const averageSeconds = Math.round(Number(dashboardData.value?.avg_duration_ms || 0) / 1000)
  return [
    { get title() { return tr("在线扫描器") }, value: dashboardData.value?.online_scanners ?? 0, get description() { return tr("在配置的在线判定时间内存在心跳") }, class: 'text-success' },
    { get title() { return tr("执行中任务") }, value: tasks.running ?? 0, description: tr("等待 {0} 个", [tasks.pending ?? 0]), class: 'text-info' },
    { get title() { return tr("任务成功率") }, value: successRate, description: tr("已完成 {0} 个", [finished]), class: '' },
    { get title() { return tr("平均耗时") }, value: `${averageSeconds} 秒`, get description() { return tr("成功任务平均值") }, class: '' }
  ]
})

const resourceChartSeries = computed(() => {
  const status = systemData.value?.status_item?.[0]
  const hasSwap = Number(status?.ram?.total_swap) > 0
  const categories = hasSwap ? ['CPU', 'RAM', 'Swap', 'Disk'] : ['CPU', 'RAM', 'Disk']
  if (!status) {
    return [
      { rawName: "使用", get name() { return tr("使用") }, data: categories.map(() => 0) },
      { rawName: "空闲", get name() { return tr("空闲") }, data: categories.map(() => 100) }
    ]
  }

  const cpuUsage = normalizePercent(status.cpu?.cpu_usage)
  const ramUsage = status.ram?.total_ram
    ? normalizePercent((Number(status.ram.used_ram) / Number(status.ram.total_ram)) * 100)
    : 0
  const diskUsage = status.disk?.disk_total_space
    ? normalizePercent((Number(status.disk.disk_total_usage) / Number(status.disk.disk_total_space)) * 100)
    : 0
  const swapUsage = hasSwap
    ? normalizePercent((Number(status.ram?.use_swap || 0) / Number(status.ram.total_swap)) * 100)
    : null
  const usages = hasSwap ? [cpuUsage, ramUsage, swapUsage, diskUsage] : [cpuUsage, ramUsage, diskUsage]

  return [
    { rawName: "使用", get name() { return tr("使用") }, data: usages },
    { rawName: "空闲", get name() { return tr("空闲") }, data: usages.map((usage) => normalizePercent(100 - usage)) }
  ]
})

const resourceChartOptions = useChartTheme(() => ({
  chart: {
    type: 'bar',
    height: 320,
    stacked: true
  },
  responsive: [
    {
      breakpoint: 480,
      options: {
        legend: {
          position: 'bottom',
          offsetX: -10,
          offsetY: 0
        }
      }
    }
  ],
  xaxis: {
    categories: Number(systemData.value?.status_item?.[0]?.ram?.total_swap) > 0
      ? ['CPU', 'RAM', 'Swap', 'Disk']
      : ['CPU', 'RAM', 'Disk']
  },
  yaxis: {
    min: 0,
    max: 100,
    tickAmount: 5,
    labels: {
      formatter: formatPercent
    }
  },
  fill: {
    opacity: 1
  },
  legend: {
    position: 'right',
    offsetX: 0,
    offsetY: 40
  },
  tooltip: {
    shared: true,
    intersect: false,
    custom({ series, dataPointIndex, w }) {
      return renderChartTooltip({
        title: w.globals.labels[dataPointIndex],
        rows: series.map((values, index) => ({
          label: w.globals.seriesNames[index],
          value: formatPercent(values[dataPointIndex]),
          color: w.globals.colors[index]
        }))
      })
    }
  }
}))

const trendDays = computed(() => [...new Set((dashboardData.value?.trend || []).map((item) => item.day))])
const scanChartSeries = computed(() => {
  const trend = dashboardData.value?.trend || []
  const scanners = [...new Set(trend.map((item) => item.scanner))]
  return scanners.map((scanner) => ({
    name: scanner,
    data: trendDays.value.map((day) => trend.find((item) => item.day === day && item.scanner === scanner)?.count || 0)
  }))
})

const scanChartOptions = useChartTheme(() => ({
  chart: {
    type: 'bar',
    height: 320,
    stacked: true,
    toolbar: {
      show: true
    },
    zoom: {
      enabled: true
    }
  },
  responsive: [
    {
      breakpoint: 480,
      options: {
        legend: {
          position: 'bottom',
          offsetX: -10,
          offsetY: 0
        }
      }
    }
  ],
  plotOptions: {
    bar: {
      horizontal: false,
      borderRadius: 10,
      borderRadiusApplication: 'end',
      borderRadiusWhenStacked: 'last',
      dataLabels: {
        total: {
          enabled: true,
          style: {
            fontSize: '13px',
            fontWeight: 900
          }
        }
      }
    }
  },
  xaxis: {
    type: 'category',
    categories: trendDays.value,
    labels: { formatter: (value) => formatSystemDate(value) }
  },
  legend: {
    position: 'right',
    offsetY: 40
  },
  fill: {
    opacity: 1
  },
  tooltip: {
    shared: true,
    intersect: false,
    custom({ series, dataPointIndex, w }) {
      return renderChartTooltip({
        title: formatSystemDate(trendDays.value[dataPointIndex]),
        rows: series.map((values, index) => ({
          label: w.globals.seriesNames[index],
          value: Number(values[dataPointIndex]).toLocaleString('zh-CN'),
          color: w.globals.colors[index]
        }))
      })
    }
  }
}))

// 仪表盘中任务表最大显示10行
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const parts = []
  if (d > 0) parts.push(tr("{0}天", [d]))
  if (h > 0) parts.push(tr("{0}小时", [h]))
  if (m > 0 || parts.length === 0) parts.push(tr("{0}分钟", [m]))
  return parts.join(' ')
}

const uptime = computed(() => {
  const s = systemData.value?.status_item?.[0]?.server_run_time
  return s !== undefined ? formatUptime(s) : '--'
})

const systemDetailItems = computed(() => {
  const status = systemData.value?.status_item?.[0]
  const info = systemData.value?.system_info || {}
  const cpuFrequency = Number(info.cpu_frequency_mhz)
  const cpuParts = [info.cpu_model || info.cpu_vendor]
  if (Number.isFinite(cpuFrequency) && cpuFrequency > 0) cpuParts.push(`${cpuFrequency.toLocaleString('zh-CN')} MHz`)

  return [
    { get label() { return tr("主机名") }, value: info.host_name || '--' },
    { get label() { return tr("操作系统") }, value: info.os_version || info.os_name || '--' },
    { get label() { return tr("内核版本") }, value: info.kernel_version || '--' },
    { get label() { return tr("系统架构") }, value: info.architecture || '--' },
    { label: 'CPU', value: cpuParts.filter(Boolean).join(' · ') || '--' },
    {
      get label() { return tr("CPU 核心") },
      value: `${info.physical_core_count ?? '--'} 物理 / ${info.logical_cpu_count ?? '--'} 逻辑`
    },
    {
      get label() { return tr("内存 / Swap") },
      value: `${formatBytes(status?.ram?.total_ram)} / ${formatBytes(status?.ram?.total_swap)}`
    },
    {
      get label() { return tr("磁盘容量") },
      value: `${formatBytes(status?.disk?.disk_total_space)} · ${Object.keys(status?.disk?.disk || {}).length} 个挂载点`
    }
  ]
})

const networkInterfaces = computed(() => {
  const net = systemData.value?.status_item?.[0]?.network?.net
  if (!net) return []
  return Object.entries(net)
    .sort(([left], [right]) => left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' }))
    .map(([name, info]) => ({
      name,
      send: formatBytes(Number(info.send)),
      receive: formatBytes(Number(info.receive)),
    }))
})

function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return '--'
  if (value === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const formatted = (value / (1024 ** unitIndex)).toFixed(unitIndex === 0 ? 0 : 1)
  return `${formatted} ${units[unitIndex]}`
}

watch(() => timeSettings.timezone, fetchDashboardData)

onMounted(() => {
  fetchSystemData()
  fetchDashboardData()
  refreshTimer = setInterval(fetchSystemData, 5000)
  dashboardTimer = setInterval(fetchDashboardData, 30000)
})

onBeforeUnmount(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
  if (dashboardTimer) clearInterval(dashboardTimer)
})

// status: 0 => 扫描中 、1 => 扫描结束 、2 => 待扫描 、3 => 出现错误
const taskList = computed(() => (dashboardData.value?.current_tasks || []).map((task) => ({
  taskid: task.task_id,
  scannerId: task.scanner || tr("未分配"),
  target: task.target?.join(', ') || '-',
  operationPerson: task.initiator,
  status: task.status,
  remark: task.remark || '-'
})))

const stateConfig = {
  running: { class: 'scan_open', get text() { return tr("扫描中") } },
  pending: { class: 'scan_wait', get text() { return tr("等待") } },
  succeeded: { class: 'scan_success', get text() { return tr("成功") } },
  failed: { class: 'scan_faild', get text() { return tr("错误") } },
  cancelled: { class: 'scan_faild', get text() { return tr("已取消") } }
}
</script>
