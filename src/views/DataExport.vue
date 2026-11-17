<script setup>
import { tr } from '../i18n/index.js'

import { formatDateTime } from '../i18n/time.js'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import EmptyState from '@/components/EmptyState.vue'
import SearchExportDialog from '@/components/SearchExportDialog.vue'
import http from '@/utils/http'
import {
  EXPORT_STATUSES,
  canCancel,
  canDelete,
  canDownload,
  formatRowStats,
  isActiveStatus,
  progressPercent,
  statusMeta,
} from '@/utils/dataExport.js'

const alerts = ref([])

function pushAlert(type, title, description = '', timeout = 7000) {
  alerts.value.unshift({ id: crypto.randomUUID(), type, title, description, timeout })
}

function closeAlert(id) {
  alerts.value = alerts.value.filter((alert) => alert.id !== id)
}

// Timestamps arrive as epoch milliseconds; normalize defensively.
function formatDate(value) {
  if (value === null || value === undefined || value === '') return '-'
  const normalized = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return '-'
  return formatDateTime(date)
}

function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1 }
  return `${size >= 100 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || fallback
}

// ---- New export dialog ----
const exportDialogRef = ref(null)

function openCreate() {
  exportDialogRef.value?.open({ query: '', queryEditable: true })
}

function onSubmitted() {
  pushAlert('success', tr('导出任务已创建'), tr('后台执行中，完成后可在本页下载。'))
  page.value = 1
  loadTasks()
}

// ---- Task list ----
const tasks = ref([])
const total = ref(0)
const listLoading = ref(false)
const initialLoadFailed = ref(false)
const page = ref(1)
const pageSize = ref(20)
const statusFilter = ref('')
let refreshTimer = null
let listRequestSeq = 0

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const pageNumbers = computed(() => Array.from({ length: totalPages.value }, (_, index) => index + 1))
const hasActiveTask = computed(() => tasks.value.some((task) => isActiveStatus(task.status)))

function schedulePolling() {
  if (hasActiveTask.value && !refreshTimer) {
    refreshTimer = window.setInterval(() => loadTasks({ silent: true }), 2000)
  } else if (!hasActiveTask.value && refreshTimer) {
    window.clearInterval(refreshTimer)
    refreshTimer = null
  }
}

async function loadTasks({ silent = false } = {}) {
  // 背景轮询不与在途请求叠加；用户发起的刷新以序号取代旧请求（同 DataImport）。
  if (silent && listLoading.value) return
  const seq = ++listRequestSeq
  listLoading.value = true
  try {
    const params = { limit: pageSize.value, offset: (page.value - 1) * pageSize.value }
    if (statusFilter.value) params.status = statusFilter.value
    const response = await http.get('/api/data-export/tasks', { params })
    if (seq !== listRequestSeq) return
    const data = response.data?.data
    if (response.data?.success !== true || !Array.isArray(data?.items)) {
      throw new Error(tr('服务器未返回有效数据，请稍后重试。'))
    }
    total.value = Number(data.total) || 0
    if (page.value > totalPages.value) {
      page.value = totalPages.value
      listLoading.value = false
      return loadTasks({ silent })
    }
    tasks.value = data.items
    initialLoadFailed.value = false
  } catch (error) {
    if (seq !== listRequestSeq) return
    console.error('load data-export tasks failed', error)
    initialLoadFailed.value = tasks.value.length === 0
    if (!silent) pushAlert('error', tr('加载导出任务失败'), errorMessage(error, tr('请稍后重试。')))
  } finally {
    if (seq === listRequestSeq) {
      listLoading.value = false
      schedulePolling()
    }
  }
}

function changePage(nextPage) {
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value) return
  page.value = nextPage
  loadTasks()
}

function changeStatusFilter() {
  page.value = 1
  loadTasks()
}

function taskProgress(task) {
  const stats = formatRowStats(task)
  return progressPercent(stats.exported, stats.total)
}

function scopeLabel(task) {
  return task.scope === 'page' ? tr('本页') : tr('全部')
}

function fieldCount(task) {
  return Array.isArray(task.fields) ? task.fields.length : 0
}

async function downloadTask(task) {
  try {
    const response = await http.get(`/api/data-export/tasks/${task.id}/download`, { responseType: 'blob' })
    const disposition = response.headers?.['content-disposition'] || ''
    const match = disposition.match(/filename="?([^";]+)"?/)
    const url = URL.createObjectURL(response.data)
    const link = document.createElement('a')
    link.href = url
    link.download = match ? match[1] : `network-mapping-export-${task.id}.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error) {
    console.error('download data-export file failed', error)
    pushAlert('error', tr('导出文件下载失败'), errorMessage(error, tr('请检查网络连接后重试。')))
  }
}

async function cancelTask(task) {
  try {
    const response = await http.post(`/api/data-export/tasks/${task.id}/cancel`)
    if (response.data?.success === true) {
      pushAlert('success', tr('任务已取消'))
      await loadTasks({ silent: true })
    } else {
      pushAlert('error', tr('操作失败'), response.data?.message || tr('服务器未返回有效数据，请稍后重试。'))
    }
  } catch (error) {
    console.error('cancel data-export task failed', error)
    pushAlert('error', tr('操作失败'), errorMessage(error, tr('请检查网络连接后重试。')))
  }
}

async function deleteTask(task) {
  if (!window.confirm(tr('删除后任务记录与导出文件将被移除。确定删除？'))) return
  try {
    const response = await http.delete(`/api/data-export/tasks/${task.id}`)
    if (response.data?.success === true) {
      pushAlert('success', tr('任务已删除'))
      await loadTasks({ silent: true })
    } else {
      pushAlert('error', tr('操作失败'), response.data?.message || tr('服务器未返回有效数据，请稍后重试。'))
    }
  } catch (error) {
    console.error('delete data-export task failed', error)
    pushAlert('error', tr('操作失败'), errorMessage(error, tr('请检查网络连接后重试。')))
  }
}

onMounted(loadTasks)

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
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

  <div class="space-y-4">
    <div class="card bg-base-100 card-border border-base-300 p-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="font-semibold">{{ tr("后台导出") }}</h2>
          <p class="mt-1 text-xs opacity-70">{{ tr("按搜索语句匹配资产数据，后台生成 CSV 文件后在此下载。") }}</p>
        </div>
        <button class="btn btn-neutral btn-sm" @click="openCreate">{{ tr("新建导出") }}</button>
      </div>
    </div>

    <div class="card bg-base-100 card-border border-base-300 p-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 class="font-semibold">{{ tr("导出任务") }}</h3>
        <div class="flex items-center gap-2">
          <select v-model="statusFilter" class="select select-bordered select-sm" :aria-label="tr(&quot;状态&quot;)" @change="changeStatusFilter">
            <option value="">{{ tr("全部状态") }}</option>
            <option v-for="status in EXPORT_STATUSES" :key="status" :value="status">{{ tr(statusMeta(status).labelKey) }}</option>
          </select>
          <button class="btn btn-ghost btn-xs" :disabled="listLoading" @click="loadTasks()">
            {{ listLoading ? tr("加载中...") : tr("刷新") }}
          </button>
        </div>
      </div>

      <div v-if="listLoading && tasks.length === 0" class="grid min-h-64 place-items-center rounded-lg bg-base-200/60">
        <span class="loading loading-spinner loading-md"></span>
      </div>

      <EmptyState
        v-else-if="initialLoadFailed"
        type="error"
        :title="tr(&quot;导出任务加载失败&quot;)"
        :message="tr(&quot;无法从服务器获取导出任务，请稍后重试。&quot;)"
      />

      <EmptyState
        v-else-if="tasks.length === 0"
        :title="tr(&quot;暂无导出任务&quot;)"
        :message="tr(&quot;点击「新建导出」，或在搜索页结果区点击「导出」创建第一个任务。&quot;)"
      />

      <div v-else class="overflow-x-auto rounded-box border border-base-300">
        <table class="table table-sm whitespace-nowrap">
          <thead>
            <tr>
              <th>{{ tr("搜索语句") }}</th>
              <th>{{ tr("状态") }}</th>
              <th>{{ tr("范围") }}</th>
              <th>{{ tr("进度") }}</th>
              <th>{{ tr("字段数") }}</th>
              <th>{{ tr("文件大小") }}</th>
              <th>{{ tr("创建时间") }}</th>
              <th>{{ tr("操作") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="task in tasks" :key="task.id">
              <td>
                <div class="max-w-64 truncate font-mono text-xs" :title="task.query">{{ task.query }}</div>
                <div v-if="task.status === 'error' && task.error_message" class="max-w-64 truncate text-xs text-error" :title="task.error_message">{{ task.error_message }}</div>
              </td>
              <td>
                <span class="badge badge-sm" :class="statusMeta(task.status).badgeClass">{{ tr(statusMeta(task.status).labelKey) }}</span>
              </td>
              <td>
                <span class="badge badge-ghost badge-xs">{{ scopeLabel(task) }}</span>
              </td>
              <td>
                <div v-if="taskProgress(task) === null" class="text-xs opacity-60">{{ tr("统计中") }}</div>
                <div v-else class="flex items-center gap-2">
                  <progress class="progress progress-primary w-24" :value="taskProgress(task)" max="100" :aria-label="tr(&quot;进度&quot;)"></progress>
                  <span class="text-xs opacity-70">{{ taskProgress(task) }}%</span>
                </div>
                <div class="text-xs opacity-50">{{ formatRowStats(task).exported }} / {{ formatRowStats(task).total === null ? '?' : formatRowStats(task).total }}</div>
              </td>
              <td class="text-xs">{{ fieldCount(task) }}</td>
              <td class="text-xs">{{ formatBytes(task.file_size) }}</td>
              <td class="whitespace-nowrap">{{ formatDate(task.created_at) }}</td>
              <td>
                <div class="flex flex-wrap gap-1">
                  <button v-if="canDownload(task.status)" class="btn btn-ghost btn-xs" @click="downloadTask(task)">{{ tr("下载") }}</button>
                  <button v-if="canCancel(task.status)" class="btn btn-ghost btn-xs" @click="cancelTask(task)">{{ tr("取消") }}</button>
                  <button v-if="canDelete(task.status)" class="btn btn-ghost btn-xs text-error" @click="deleteTask(task)">{{ tr("删除") }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="total > pageSize" class="mt-4 flex flex-wrap items-center justify-end gap-2">
        <span class="mr-auto text-xs opacity-60">{{ tr("共") }} {{ total }} {{ tr("个任务") }}</span>
        <button class="btn btn-sm" :disabled="listLoading || page === 1" @click="changePage(page - 1)">{{ tr("上一页") }}</button>
        <span class="text-sm">{{ page }} / {{ totalPages }}</span>
        <button class="btn btn-sm" :disabled="listLoading || page === totalPages" @click="changePage(page + 1)">{{ tr("下一页") }}</button>
      </div>
    </div>
  </div>

  <SearchExportDialog ref="exportDialogRef" @submitted="onSubmitted" />
</template>