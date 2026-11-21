<script setup>
import { tr } from '../i18n/index.js'

import { formatDateTime as formatSystemDateTime, localToIso } from '../i18n/time.js'
import { computed, onMounted, ref, useId } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import EmptyState from '@/components/EmptyState.vue'
import http from '@/utils/http'
import { loadSystemTaskVisibility, saveSystemTaskVisibility } from '@/utils/systemTaskVisibility'

const formFieldId = useId()
const alerts = ref([])
const expandedRow = ref(null)
const currentPage = ref(1)
const isLoadingData = ref(false)
const initialLoadFailed = ref(false)
const hasLoadedTasks = ref(false)
const selectedCount = ref('20')
// 默认不显示系统任务；偏好自上次变更起记忆一个月（见 systemTaskVisibility）。
const includeSystemTasks = ref(loadSystemTaskVisibility())
function getDefaultFilters() {
  return {
    taskId: '',
    target: '',
    status: '',
    operator: '',
    startTime: '',
    endTime: '',
    scannerId: ''
  }
}

const draftFilters = ref(getDefaultFilters())
const appliedFilters = ref(getDefaultFilters())

const taskItems = ref([])
const totalCount = ref(0)
const nextCursor = ref(null)
const hasMore = ref(false)
const pageCursorHistory = ref([null])
let latestRequestId = 0

const stateConfig = {
  pending: { class: 'badge-warning', get text() { return tr("待扫描") } },
  running: { class: 'badge-info', get text() { return tr("扫描中") } },
  succeeded: { class: 'badge-success', get text() { return tr("扫描完成") } },
  failed: { class: 'badge-error', get text() { return tr("扫描失败") } },
  cancelled: { class: 'badge-ghost', get text() { return tr("已取消") } },
  partial: { class: 'badge-warning', get text() { return tr("部分完成") } }
}

function formatUnixMs(value) {
  return value == null ? '-' : formatSystemDateTime(Number(value))
}

function resolveStatus(status) {
  return stateConfig[status] ? status : 'pending'
}

function normalizeTask(item) {
  const targets = Array.isArray(item.task_target) ? item.task_target.join(', ') : '-'
  const createTimeMs = Number(item.task_create_time)
  const isDnsTask = item.task_kind === 'dns'
  return {
    taskId: item.task_id || '-',
    source: item.task_source,
    scannerId: item.scanner_id || '-',
    target: targets,
    taskKind: isDnsTask ? 'dns' : 'ip',
    addressFamily: isDnsTask ? 'DNS' : item.address_family === 'ipv6' ? 'IPv6' : 'IPv4',
    port: isDnsTask ? tr("DNS 记录") : item.task_port || '-',
    operator: item.task_initiator || '-',
    createTimeMs: Number.isFinite(createTimeMs) ? createTimeMs : null,
    statusKey: resolveStatus(item.task_status),
    remark: item.remarks || '-',
    attemptCount: Number(item.attempt_count) || 0,
    failureReason: item.failure_reason || ''
  }
}

const pageSize = computed(() => Number(selectedCount.value) || 20)
const itemCount = computed(() => taskItems.value.length)
const hasActiveFilters = computed(() => Object.values(appliedFilters.value).some((value) => value !== ''))

const isServerEmpty = computed(() => {
  return !initialLoadFailed.value && hasLoadedTasks.value && taskItems.value.length === 0
})

const totalPages = computed(() => {
  const pages = Math.ceil(totalCount.value / pageSize.value)
  return pages > 0 ? pages : 1
})

const hasPrevPage = computed(() => currentPage.value > 1)
const hasNextPage = computed(() => hasMore.value)

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

function filterTimestamp(value) {
  if (!value) return null
  const timestamp = new Date(localToIso(value)).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function taskQueryParams(cursor) {
  const filters = appliedFilters.value
  const params = {
    limit: pageSize.value,
    include_system: includeSystemTasks.value,
  }
  if (typeof cursor === 'number') params.cursor = cursor
  if (filters.taskId.trim()) params.task_id = filters.taskId.trim()
  if (filters.target.trim()) params.target = filters.target.trim()
  if (filters.status) params.status = filters.status
  if (filters.operator.trim()) params.operator = filters.operator.trim()
  if (filters.scannerId.trim()) params.scanner_id = filters.scannerId.trim()
  const startTime = filterTimestamp(filters.startTime)
  const endTime = filterTimestamp(filters.endTime)
  if (startTime !== null) params.start_time = startTime
  if (endTime !== null) params.end_time = endTime
  return params
}

async function fetchTasks({ cursor = null } = {}) {
  const requestId = ++latestRequestId
  try {
    isLoadingData.value = true
    const response = await http.get('/api/task/all', {
      params: taskQueryParams(cursor),
    })
    if (requestId !== latestRequestId) return false
    const data = response?.data || {}
    totalCount.value = Number(data.total) || 0
    nextCursor.value = typeof data.next_cursor === 'number' ? data.next_cursor : null
    hasMore.value = data.has_more === true
    taskItems.value = Array.isArray(data.items) ? data.items.map(normalizeTask) : []
    initialLoadFailed.value = false
    hasLoadedTasks.value = true
    expandedRow.value = null
    return true
  } catch (error) {
    if (requestId !== latestRequestId) return false
    console.error('fetch tasks failed', error)
    if (!hasLoadedTasks.value) {
      taskItems.value = []
      totalCount.value = 0
      nextCursor.value = null
      hasMore.value = false
      initialLoadFailed.value = true
    }
    pushAlert(
      'error',
      tr("任务数据加载失败"),
      error.response?.data?.message || tr("请检查网络连接或服务器运行状态。"),
      7000
    )
    return false
  } finally {
    if (requestId === latestRequestId) isLoadingData.value = false
  }
}

async function toNextPage() {
  if (isLoadingData.value || !hasNextPage.value) return
  const cursor = nextCursor.value
  const ok = await fetchTasks({ cursor })
  if (!ok) return
  if (itemCount.value <= 0) return
  currentPage.value += 1
  pageCursorHistory.value[currentPage.value - 1] = cursor
}

async function toPrevPage() {
  if (isLoadingData.value || !hasPrevPage.value) return
  const prevPage = currentPage.value - 1
  const cursor = pageCursorHistory.value[prevPage - 1]
  const ok = await fetchTasks({ cursor })
  if (!ok) return
  currentPage.value = prevPage
}

function resetPagination() {
  currentPage.value = 1
  nextCursor.value = null
  hasMore.value = false
  pageCursorHistory.value = [null]
}

async function reloadFromFirstPage() {
  resetPagination()
  await fetchTasks()
}

async function refreshWithCount() {
  if (isLoadingData.value) return
  await reloadFromFirstPage()
}

async function refreshSystemTaskVisibility() {
  saveSystemTaskVisibility(includeSystemTasks.value)
  if (isLoadingData.value) return
  await reloadFromFirstPage()
}

async function applySearch() {
  if (isLoadingData.value) return
  try {
    if (draftFilters.value.startTime) localToIso(draftFilters.value.startTime)
    if (draftFilters.value.endTime) localToIso(draftFilters.value.endTime)
  } catch (e) {
    pushAlert('warning', tr("时间筛选无效"), e.message)
    return
  }
  appliedFilters.value = { ...draftFilters.value }
  expandedRow.value = null
  await reloadFromFirstPage()
}

async function resetFilters() {
  if (isLoadingData.value) return
  const defaults = getDefaultFilters()
  draftFilters.value = { ...defaults }
  appliedFilters.value = { ...defaults }
  expandedRow.value = null
  await reloadFromFirstPage()
}

function toggleRow(taskId) {
  if (isLoadingData.value) return
  expandedRow.value = expandedRow.value === taskId ? null : taskId
}

onMounted(async () => {
  await reloadFromFirstPage()
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
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="page-title">{{ tr("任务") }}</h1>
          <p class="mt-1 text-sm text-base-content/60">{{ tr("查看扫描任务、执行状态及调度信息。") }}</p>
        </div>
        <button class="btn btn-outline btn-sm" :disabled="isLoadingData" @click="reloadFromFirstPage">
          <span v-if="isLoadingData" class="loading loading-spinner loading-xs"></span>
          {{ isLoadingData ? tr("刷新中…") : tr("刷新") }}
        </button>
      </div>

      <section class="card border border-base-300 bg-base-100 shadow-sm">
        <div class="card-body gap-4 p-4">
          <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <fieldset class="fieldset min-w-0 w-full">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-1`">{{ tr("任务 ID") }}</label></legend>
              <input :id="`${formFieldId}-1`" v-model="draftFilters.taskId" type="text" class="input input-bordered w-full" :placeholder="tr(&quot;输入任务 ID&quot;)" :disabled="isLoadingData" @keyup.enter="applySearch" />
            </fieldset>

            <fieldset class="fieldset min-w-0 w-full">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-2`">{{ tr("目标") }}</label></legend>
              <input :id="`${formFieldId}-2`" v-model="draftFilters.target" type="text" class="input input-bordered w-full" :placeholder="tr(&quot;IP、网段或域名&quot;)" :disabled="isLoadingData" @keyup.enter="applySearch" />
            </fieldset>

            <fieldset class="fieldset min-w-0 w-full">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-3`">{{ tr("状态") }}</label></legend>
              <select :id="`${formFieldId}-3`" v-model="draftFilters.status" class="select select-bordered w-full" :disabled="isLoadingData">
                <option value="">{{ tr("全部") }}</option>
                <option value="pending">{{ tr("待扫描") }}</option>
                <option value="running">{{ tr("扫描中") }}</option>
                <option value="succeeded">{{ tr("扫描完成") }}</option>
                <option value="failed">{{ tr("扫描失败") }}</option>
                <option value="cancelled">{{ tr("已取消") }}</option>
                <option value="partial">{{ tr("部分完成") }}</option>
              </select>
            </fieldset>

            <fieldset class="fieldset min-w-0 w-full">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-4`">{{ tr("操作者") }}</label></legend>
              <input :id="`${formFieldId}-4`" v-model="draftFilters.operator" type="text" class="input input-bordered w-full" :placeholder="tr(&quot;输入操作者&quot;)" :disabled="isLoadingData" @keyup.enter="applySearch" />
            </fieldset>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-3">
            <label class="label cursor-pointer gap-2 py-0">
              <input
                v-model="includeSystemTasks"
                type="checkbox"
                class="checkbox checkbox-sm"
                :disabled="isLoadingData"
                @change="refreshSystemTaskVisibility"
              />
              <span class="label-text">{{ tr("显示系统任务") }}</span>
            </label>
            <div class="flex gap-2">
              <button class="btn btn-ghost btn-sm" :disabled="isLoadingData" @click="resetFilters">{{ tr("重置") }}</button>
              <button class="btn btn-neutral btn-sm" :disabled="isLoadingData" @click="applySearch">{{ tr("查询") }}</button>
            </div>
          </div>

          <details class="collapse collapse-arrow rounded-lg bg-base-200/40">
            <summary class="collapse-title min-h-0 py-3 text-sm font-semibold">{{ tr("高级筛选") }}</summary>
            <div class="collapse-content">
              <div class="grid gap-3 pt-1 md:grid-cols-2 xl:grid-cols-4">
                <fieldset class="fieldset min-w-0 w-full">
                  <legend class="fieldset-legend"><label :for="`${formFieldId}-5`">{{ tr("开始时间") }}</label></legend>
                  <SystemDateTimeInput :id="`${formFieldId}-5`" v-model="draftFilters.startTime" class="input input-bordered w-full" :disabled="isLoadingData" />
                </fieldset>

                <fieldset class="fieldset min-w-0 w-full">
                  <legend class="fieldset-legend"><label :for="`${formFieldId}-6`">{{ tr("结束时间") }}</label></legend>
                  <SystemDateTimeInput :id="`${formFieldId}-6`" v-model="draftFilters.endTime" class="input input-bordered w-full" :disabled="isLoadingData" />
                </fieldset>

                <fieldset class="fieldset min-w-0 w-full">
                  <legend class="fieldset-legend"><label :for="`${formFieldId}-7`">{{ tr("扫描器 ID") }}</label></legend>
                  <input :id="`${formFieldId}-7`" v-model="draftFilters.scannerId" class="input input-bordered w-full" :placeholder="tr(&quot;输入扫描器 ID&quot;)" :disabled="isLoadingData" @keyup.enter="applySearch" />
                </fieldset>

                <fieldset class="fieldset min-w-0 w-full">
                  <legend class="fieldset-legend"><label :for="`${formFieldId}-8`">{{ tr("每页数量") }}</label></legend>
                  <select :id="`${formFieldId}-8`" v-model="selectedCount" class="select select-bordered w-full" :disabled="isLoadingData" @change="refreshWithCount">
                    <option value="10">10</option>
                    <option value="20">20</option>
                    <option value="50">50</option>
                  </select>
                </fieldset>
              </div>
              <p class="mt-3 text-xs text-base-content/60"> {{ tr("匹配任务") }} {{ totalCount }} {{ tr("条，本页加载") }} {{ itemCount }} {{ tr("条") }} </p>
            </div>
          </details>
        </div>
      </section>

      <section class="overflow-hidden rounded-box border border-base-300 bg-base-100">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 px-4 py-3">
          <div>
            <h2 class="font-semibold">{{ tr("任务列表") }}</h2>
            <p class="mt-0.5 text-xs text-base-content/50">{{ tr("点击任务行可展开调度与失败信息") }}</p>
          </div>
          <span class="text-sm text-base-content/60">{{ tr("共") }} {{ totalCount }} {{ tr("条") }}</span>
        </div>

        <div v-if="isLoadingData" class="space-y-3 p-5">
          <div class="skeleton h-72 w-full rounded-box"></div>
          <div class="skeleton h-4 w-52"></div>
        </div>

        <template v-else>
          <EmptyState
            v-if="initialLoadFailed"
            type="error"
            :title="tr(&quot;加载数据失败&quot;)"
            :message="tr(&quot;这通常是由于客户端与服务器的网络不可达或服务器崩溃了\n请检查您的网络，并测试是否可以正常访问服务器，如果上述一切正常，请联系系统管理员&quot;)"
          />

          <EmptyState
            v-else-if="isServerEmpty"
            :title="hasActiveFilters ? tr(&quot;没有匹配的任务&quot;) : tr(&quot;暂无任务&quot;)"
            :message="hasActiveFilters ? tr(&quot;请调整筛选条件后重试。&quot;) : tr(&quot;当前还没有可显示的扫描任务。&quot;)"
          />

          <div v-else class="overflow-x-auto">
            <table class="table table-zebra min-w-[1050px]">
              <thead>
                <tr>
                  <th class="w-14">#</th>
                  <th>{{ tr("任务 ID") }}</th>
                  <th>{{ tr("扫描器") }}</th>
                  <th>{{ tr("目标") }}</th>
                  <th>{{ tr("协议") }}</th>
                  <th>{{ tr("端口") }}</th>
                  <th>{{ tr("操作者") }}</th>
                  <th>{{ tr("状态") }}</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="(taskItem, index) in taskItems" :key="taskItem.taskId">
                  <tr class="cursor-pointer" :class="{ 'bg-base-200': expandedRow === taskItem.taskId }" @click="toggleRow(taskItem.taskId)">
                    <td class="text-xs text-base-content/50">{{ (currentPage - 1) * pageSize + index + 1 }}</td>
                    <td class="max-w-48">
                      <router-link class="link block truncate font-mono text-xs" :to="`/task/${taskItem.taskId}`" :title="taskItem.taskId" @click.stop>
                        {{ taskItem.taskId }}
                      </router-link>
                      <span v-if="taskItem.source === 'search'" class="badge badge-info badge-soft badge-xs mt-1">{{ tr("搜索生成") }}</span>
                    </td>
                    <td class="max-w-32 truncate font-mono text-xs" :title="taskItem.scannerId">{{ taskItem.scannerId }}</td>
                    <td class="max-w-60 truncate" :title="taskItem.target">
                      <span class="mr-1 badge badge-outline badge-xs">{{ taskItem.taskKind === 'dns' ? 'DNS' : 'IP' }}</span>{{ taskItem.target }}
                    </td>
                    <td><span class="badge badge-outline badge-xs">{{ taskItem.addressFamily }}</span></td>
                    <td class="max-w-32 truncate font-mono text-xs" :title="taskItem.port">{{ taskItem.port }}</td>
                    <td class="max-w-32 truncate" :title="taskItem.operator">{{ taskItem.operator }}</td>
                    <td>
                      <span class="badge badge-sm whitespace-nowrap" :class="stateConfig[taskItem.statusKey].class">
                        {{ stateConfig[taskItem.statusKey].text }}
                      </span>
                    </td>
                  </tr>
                  <tr v-if="expandedRow === taskItem.taskId" class="bg-base-200/60">
                    <td></td>
                    <td colspan="7" class="p-4">
                      <dl class="grid gap-4 text-sm md:grid-cols-3">
                        <div><dt class="text-xs text-base-content/50">{{ tr("创建时间") }}</dt><dd class="mt-1">{{ formatUnixMs(taskItem.createTimeMs) }}</dd></div>
                        <div><dt class="text-xs text-base-content/50">{{ tr("领取次数") }}</dt><dd class="mt-1">{{ taskItem.attemptCount }}</dd></div>
                        <div><dt class="text-xs text-base-content/50">{{ tr("备注") }}</dt><dd class="mt-1 break-words">{{ taskItem.remark }}</dd></div>
                        <div v-if="taskItem.failureReason" class="md:col-span-3">
                          <dt class="text-xs text-error/70">{{ tr("失败原因") }}</dt>
                          <dd class="mt-1 break-words text-error">{{ taskItem.failureReason }}</dd>
                        </div>
                      </dl>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <div v-if="!initialLoadFailed && !isServerEmpty" class="flex flex-col gap-3 border-t border-base-300 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="text-sm text-base-content/60"> {{ tr("本页") }} {{ itemCount }} {{ tr("条，共") }} {{ totalCount }} {{ tr("条") }} </div>
            <div class="join">
              <button class="join-item btn btn-sm" :disabled="!hasPrevPage || isLoadingData" @click="toPrevPage">{{ tr("上一页") }}</button>
              <button class="join-item btn btn-sm btn-disabled">{{ currentPage }} / {{ totalPages }}</button>
              <button class="join-item btn btn-sm" :disabled="!hasNextPage || isLoadingData" @click="toNextPage">{{ tr("下一页") }}</button>
            </div>
          </div>
        </template>
      </section>
    </div>
  </main>
</template>
