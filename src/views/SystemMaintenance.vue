<script setup>
import { tr } from '../i18n/index.js'

import { formatDateTime as formatSystemDateTime, toLocalInputValue as systemInputValue, parseSystemDate } from '../i18n/time.js'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import http from '@/utils/http'

const confirmDialog = ref(null)
const alerts = ref([])
const loading = ref(false)
const submitting = ref(false)
const historyLoading = ref(false)
const historyError = ref('')
const historyItems = ref([])
const historyTotal = ref(0)
const historyOffset = ref(0)
const status = ref({
  enabled: false,
  phase: 'off',
  message: '',
  expected_end_at: null,
  started_at: null,
  updated_at: null,
  retry_after_seconds: 600,
  revision: 0
})
const runningTasks = ref(0)
const heldTasks = ref(0)
const form = ref({ message: '', expectedEndAt: '' })
const formRevision = ref(0)
let refreshTimer = null

const HISTORY_PAGE_SIZE = 20

const phaseLabel = computed(() => {
  if (status.value.phase === 'draining') return tr("正在通知")
  if (status.value.phase === 'active') return tr("维护中")
  return tr("正常运行")
})
const phaseBadge = computed(() => {
  if (status.value.phase === 'draining') return 'badge-warning'
  if (status.value.phase === 'active') return 'badge-error'
  return 'badge-success'
})
const expectedEndOverdue = computed(() => (
  status.value.enabled
  && status.value.expected_end_at
  && new Date(status.value.expected_end_at).getTime() < Date.now()
))
const historyPage = computed(() => Math.floor(historyOffset.value / HISTORY_PAGE_SIZE) + 1)
const historyPages = computed(() => Math.max(1, Math.ceil(historyTotal.value / HISTORY_PAGE_SIZE)))

function pushAlert(type, title, description = '') {
  alerts.value.unshift({ id: crypto.randomUUID(), type, title, description, timeout: 7000 })
}

function closeAlert(id) {
  alerts.value = alerts.value.filter((alert) => alert.id !== id)
}

function formatTime(value) {
  if (!value) return tr("未设置")
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : formatSystemDateTime(date)
}

function formatDuration(seconds) {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) < 0) return '—'
  const total = Math.floor(Number(seconds))
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const remainSeconds = total % 60
  if (days > 0) return tr("{0} 天 {1} 小时 {2} 分钟", [days, hours, minutes])
  if (hours > 0) return tr("{0} 小时 {1} 分钟", [hours, minutes])
  if (minutes > 0) return tr("{0} 分钟 {1} 秒", [minutes, remainSeconds])
  return tr("{0} 秒", [remainSeconds])
}

function toLocalDateTime(value) {
  return value ? systemInputValue(value) : ''
}

function applyResponse(data, { syncForm = true } = {}) {
  if (!data?.data) throw new Error(tr("服务器未返回有效维护状态"))
  status.value = data.data
  runningTasks.value = Number(data.running_tasks) || 0
  heldTasks.value = Number(data.held_tasks) || 0
  if (syncForm) {
    form.value = {
      message: data.data.message || '',
      expectedEndAt: toLocalDateTime(data.data.expected_end_at)
    }
    formRevision.value = data.data.revision
  }
}

function requestPayload() {
  return {
    message: form.value.message.trim(),
    expectedEndAt: form.value.expectedEndAt
      ? parseSystemDate(form.value.expectedEndAt).toISOString()
      : null
  }
}

async function loadStatus({ silent = false } = {}) {
  if (!silent) loading.value = true
  try {
    const response = await http.get('/api/admin/system-maintenance')
    applyResponse(response.data, { syncForm: !silent })
  } catch (error) {
    console.error('load system maintenance failed', error)
    if (!silent) pushAlert('error', tr("维护状态加载失败"), error?.response?.data?.message || tr("请稍后重试。"))
  } finally {
    if (!silent) loading.value = false
  }
}

async function loadHistory(offset = 0) {
  historyLoading.value = true
  historyError.value = ''
  try {
    const response = await http.get('/api/admin/system-maintenance/history', {
      params: { limit: HISTORY_PAGE_SIZE, offset }
    })
    const data = response.data?.data || {}
    historyItems.value = Array.isArray(data.items) ? data.items : []
    historyTotal.value = Number(data.total) || 0
    historyOffset.value = offset
  } catch (error) {
    historyItems.value = []
    historyTotal.value = 0
    historyError.value = error?.response?.data?.message || tr("请稍后重试。")
  } finally {
    historyLoading.value = false
  }
}

function refreshMaintenance() {
  return Promise.all([loadStatus(), loadHistory(historyOffset.value)])
}

async function enterMaintenance() {
  if (!form.value.message.trim()) {
    pushAlert('warning', tr("请输入维护说明"))
    return
  }
  if (!await confirmDialog.value.ask({ message: tr("进入后将停止分配新任务，并通知活动 Scanner 继续在本地完成扫描。约 60 秒后即可关闭服务端，结果将在退出维护后补传。确认继续吗？"), confirmText: tr("进入维护"), danger: true })) return
  submitting.value = true
  try {
    const response = await http.post('/api/admin/system-maintenance/enter', requestPayload())
    applyResponse(response.data)
    await loadHistory(historyOffset.value)
    pushAlert('success', tr("已开始进入维护模式"), heldTasks.value > 0 ? tr("正在通知 {0} 个活动任务，任务不会阻塞服务端维护。", [heldTasks.value]) : tr("当前没有活动任务。"))
  } catch (error) {
    pushAlert('error', tr("进入维护模式失败"), error?.response?.data?.message || tr("请稍后重试。"))
  } finally {
    submitting.value = false
  }
}

async function updateMaintenance() {
  if (!form.value.message.trim()) {
    pushAlert('warning', tr("请输入维护说明"))
    return
  }
  submitting.value = true
  try {
    const response = await http.patch('/api/admin/system-maintenance', {
      ...requestPayload(),
      revision: formRevision.value
    })
    applyResponse(response.data)
    await loadHistory(historyOffset.value)
    pushAlert('success', tr("维护信息已更新"))
  } catch (error) {
    pushAlert('error', tr("维护信息更新失败"), error?.response?.data?.message || tr("状态可能已变化，请刷新后重试。"))
  } finally {
    submitting.value = false
  }
}

async function exitMaintenance() {
  if (!await confirmDialog.value.ask({ message: tr("确认手动退出维护模式吗？Scanner 将在下一次探测后恢复，最长约 10 分钟。"), confirmText: tr("退出维护") })) return
  submitting.value = true
  try {
    const response = await http.post('/api/admin/system-maintenance/exit', {
      revision: status.value.revision
    })
    applyResponse(response.data)
    await loadHistory(historyOffset.value)
    pushAlert('success', tr("已退出维护模式"), tr("Scanner 将在下一次维护探测后恢复运行。"))
  } catch (error) {
    pushAlert('error', tr("退出维护模式失败"), error?.response?.data?.message || tr("状态可能已变化，请刷新后重试。"))
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  loadStatus()
  loadHistory()
  refreshTimer = window.setInterval(() => loadStatus({ silent: true }), 5000)
})

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
})
</script>

<template>
  <main class="page-shell">
    <ConfirmDialog ref="confirmDialog" />
    <div class="fixed right-4 top-20 z-50 flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-2">
      <AppAlert
        v-for="alert in alerts"
        :key="alert.id"
        v-bind="alert"
        @close="closeAlert(alert.id)"
      />
    </div>

    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="page-title">{{ tr("系统维护") }}</h1>
        <p class="mt-1 text-sm text-base-content/60">{{ tr("进入系统维护后暂停 Scanner 任务流，活动扫描在本地完成并于维护结束后补传。") }}</p>
      </div>
      <button class="btn btn-ghost btn-sm" :disabled="loading || historyLoading" @click="refreshMaintenance()">
        {{ loading ? tr("刷新中…") : tr("刷新状态") }}
      </button>
    </div>

    <div v-if="expectedEndOverdue" role="alert" class="alert alert-warning mb-4">
      <span>{{ tr("已超过预计结束时间，维护模式不会自动退出，请确认维护进度并手动退出。") }}</span>
    </div>

    <section class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body gap-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <h2 class="card-title">{{ tr("当前状态") }}</h2>
            <span class="badge" :class="phaseBadge">{{ phaseLabel }}</span>
          </div>
          <div v-if="status.enabled" class="text-sm text-base-content/70"> {{ tr("Scanner 每约") }} {{ Math.round(status.retry_after_seconds / 60) }} {{ tr("分钟探测一次") }} </div>
        </div>

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div class="rounded-box bg-base-200 p-4">
            <div class="text-xs text-base-content/60">{{ tr("运行中任务") }}</div>
            <div class="mt-1 text-2xl font-semibold">{{ runningTasks }}</div>
          </div>
          <div class="rounded-box bg-base-200 p-4">
            <div class="text-xs text-base-content/60">{{ tr("维护冻结任务") }}</div>
            <div class="mt-1 text-2xl font-semibold">{{ heldTasks }}</div>
          </div>
          <div class="rounded-box bg-base-200 p-4">
            <div class="text-xs text-base-content/60">{{ tr("开始时间") }}</div>
            <div class="mt-1 text-sm font-medium">{{ formatTime(status.started_at) }}</div>
          </div>
          <div class="rounded-box bg-base-200 p-4">
            <div class="text-xs text-base-content/60">{{ tr("预计结束") }}</div>
            <div class="mt-1 text-sm font-medium">{{ formatTime(status.expected_end_at) }}</div>
          </div>
          <div class="rounded-box bg-base-200 p-4">
            <div class="text-xs text-base-content/60">{{ tr("状态版本") }}</div>
            <div class="mt-1 text-sm font-medium">{{ status.revision }}</div>
          </div>
        </div>

        <div v-if="status.phase === 'draining'" role="alert" class="alert alert-warning">
          <span>{{ tr("已冻结活动任务租约并通过心跳通知 Scanner。通知窗口最多约") }} {{ status.notification_grace_seconds || 60 }} {{ tr("秒，任务无需完成也不会阻塞正式维护。") }}</span>
        </div>
        <div v-else-if="status.phase === 'active'" role="alert" class="alert alert-error">
          <span>{{ tr("系统可安全停机。Scanner 会在本地完成活动扫描并缓存结果；手动退出维护后有") }} {{ status.result_upload_grace_hours || 24 }} {{ tr("小时补传，随后未完成任务才会重新排队。") }}</span>
        </div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">{{ tr("维护说明") }}</legend>
          <textarea
            v-model="form.message"
            class="textarea textarea-bordered min-h-28 w-full"
            maxlength="500"
            :placeholder="tr(&quot;例如：数据库升级与索引维护&quot;)"
          ></textarea>
          <div class="label text-xs text-base-content/60">{{ tr("该说明会返回给 Scanner，请勿填写凭据、内部地址等敏感信息。") }}</div>
        </fieldset>

        <fieldset class="fieldset max-w-md">
          <legend class="fieldset-legend">{{ tr("预计结束时间（可选）") }}</legend>
          <SystemDateTimeInput v-model="form.expectedEndAt" class="input input-bordered w-full" />
          <div class="label text-xs text-base-content/60">{{ tr("到达该时间不会自动退出维护模式。") }}</div>
        </fieldset>

        <div class="card-actions justify-end">
          <button
            v-if="!status.enabled"
            class="btn btn-warning"
            :disabled="submitting || !form.message.trim()"
            @click="enterMaintenance"
          >
            {{ submitting ? tr("处理中…") : tr("进入维护模式") }}
          </button>
          <template v-else>
            <button class="btn btn-outline" :disabled="submitting || !form.message.trim()" @click="updateMaintenance"> {{ tr("更新维护信息") }} </button>
            <button class="btn btn-error" :disabled="submitting" @click="exitMaintenance"> {{ tr("手动退出维护模式") }} </button>
          </template>
        </div>
      </div>
    </section>

    <section class="mt-6 rounded-xl border border-base-300 bg-base-100 shadow-sm">
      <div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
        <h2 class="font-semibold">{{ tr("维护历史") }}</h2>
        <span class="text-sm text-base-content/60">{{ tr("共") }} {{ historyTotal }} {{ tr("条") }}</span>
      </div>
      <div v-if="historyLoading" class="flex justify-center py-16"><span class="loading loading-spinner loading-lg"></span></div>
      <div v-else-if="historyError" role="alert" class="alert alert-error m-4"><span>{{ tr("维护历史加载失败：") }}{{ historyError }}</span></div>
      <div v-else-if="historyItems.length === 0" class="py-16 text-center text-base-content/60">{{ tr("暂无维护历史。") }}</div>
      <div v-else class="overflow-x-auto">
        <table class="table table-zebra">
          <thead>
            <tr><th>{{ tr("维护开始时间") }}</th><th>{{ tr("维护结束时间") }}</th><th>{{ tr("预计结束时间") }}</th><th>{{ tr("实际维护时长") }}</th><th>{{ tr("维护说明") }}</th><th>{{ tr("操作者") }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in historyItems" :key="item.maintenance_id">
              <td class="whitespace-nowrap">{{ formatTime(item.started_at) }}</td>
              <td class="whitespace-nowrap">{{ item.in_progress ? tr("进行中") : formatTime(item.ended_at) }}</td>
              <td class="whitespace-nowrap">{{ formatTime(item.expected_end_at) }}</td>
              <td class="whitespace-nowrap">{{ formatDuration(item.actual_duration_seconds) }}</td>
              <td class="max-w-sm whitespace-pre-wrap break-words">{{ item.message || '—' }}</td>
              <td>{{ item.operator_username || tr("未知操作者") }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="historyTotal > HISTORY_PAGE_SIZE" class="flex items-center justify-end gap-3 border-t border-base-300 px-4 py-3">
        <span class="text-sm text-base-content/60">{{ tr("第") }} {{ historyPage }} / {{ historyPages }} {{ tr("页") }}</span>
        <button class="btn btn-sm" :disabled="historyLoading || historyOffset === 0" @click="loadHistory(Math.max(0, historyOffset - HISTORY_PAGE_SIZE))">{{ tr("上一页") }}</button>
        <button class="btn btn-sm" :disabled="historyLoading || historyOffset + HISTORY_PAGE_SIZE >= historyTotal" @click="loadHistory(historyOffset + HISTORY_PAGE_SIZE)">{{ tr("下一页") }}</button>
      </div>
    </section>
  </main>
</template>
