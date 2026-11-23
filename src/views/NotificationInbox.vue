<script setup>
import { tr } from '../i18n/index.js'

import { onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppAlert from '@/components/AppAlert.vue'
import { inboxNotifications } from '@/composables/useInboxNotifications'
import { inboxCategories, inboxCategoryLabel, inboxSeverityClass } from '@/utils/inbox'
import { formatDateTime, formatRelativeTime } from '../i18n/time.js'
import http from '@/utils/http'

const formFieldId = useId()
const router = useRouter()
const { byCategory, unreadCount, markRead, dismiss, prefs, loadPrefs, savePrefs, refreshCounts } = inboxNotifications
const items = ref([]), nextBefore = ref(null), alerts = ref([])
const loading = ref(false), failed = ref(false), busy = ref(false)
const category = ref(''), unreadOnly = ref(false)
const prefsDialog = ref(null), prefsDraft = ref({ ...prefs.value }), prefsSaving = ref(false)
let sequence = 0, controller = null, disposed = false

function notify(type, title, description = '') {
  alerts.value.unshift({ id: crypto.randomUUID(), type, title, description, timeout: 7000 })
}
function errorText(error) { return error.response?.data?.message || tr("操作失败，请检查网络连接后重试。") }

async function loadList(append = false) {
  if (disposed) return
  controller?.abort()
  controller = new AbortController()
  const request = ++sequence
  loading.value = true
  const params = {}
  if (category.value) params.category = category.value
  if (unreadOnly.value) params.unread = true
  if (append && nextBefore.value) params.before = nextBefore.value
  try {
    const response = await http.get('/api/inbox/notifications', { params, signal: controller.signal })
    if (disposed || request !== sequence) return
    const data = response.data?.data
    if (response.data?.success !== true || !Array.isArray(data?.items)) throw new Error(tr("站内通知响应无效"))
    items.value = append ? [...items.value, ...data.items] : data.items
    nextBefore.value = data.next_before
    failed.value = false
  } catch (error) {
    if (disposed || request !== sequence || controller.signal.aborted) return
    failed.value = true
  } finally {
    if (!disposed && request === sequence) loading.value = false
  }
}

watch([category, unreadOnly], () => loadList())

async function openItem(item) {
  if (busy.value) return
  busy.value = true
  try {
    if (!item.read_at) {
      await markRead({ ids: [item.id] })
      item.read_at = new Date().toISOString()
      // 仅未读视图下，标记已读（含无深链的通知）后立即移出列表。
      if (unreadOnly.value) items.value = items.value.filter(value => value.id !== item.id)
    }
    if (item.link) router.push(item.link)
  } catch (error) { notify('error', tr("标记已读失败"), errorText(error)) }
  finally { busy.value = false }
}

async function removeItem(item) {
  if (busy.value) return
  busy.value = true
  try {
    await dismiss(item.id)
    items.value = items.value.filter(value => value.id !== item.id)
  } catch (error) { notify('error', tr("删除失败"), errorText(error)) }
  finally { busy.value = false }
}

async function readAll() {
  if (busy.value || unreadCount.value === 0) return
  busy.value = true
  try {
    await markRead({ all: true, ...(category.value ? { category: category.value } : {}) })
    const now = new Date().toISOString()
    items.value = items.value.map(item => (
      category.value && item.category !== category.value ? item : { ...item, read_at: item.read_at || now }
    ))
    if (unreadOnly.value) await loadList()
    notify('success', tr("已全部标记为已读"))
  } catch (error) { notify('error', tr("标记已读失败"), errorText(error)) }
  finally { busy.value = false }
}

function openPrefs() {
  prefsDraft.value = { ...prefs.value }
  prefsDialog.value?.showModal()
}
async function savePreferences() {
  if (prefsSaving.value) return
  prefsSaving.value = true
  try {
    await savePrefs(prefsDraft.value)
    prefsDialog.value?.close()
    notify('success', tr("接收设置已保存"), tr("关闭的类别不再接收新的站内通知，已有通知不受影响。"))
  } catch (error) { notify('error', tr("保存失败"), errorText(error)) }
  finally { prefsSaving.value = false }
}

onMounted(async () => {
  await Promise.all([loadList(), refreshCounts()])
  try { await loadPrefs() } catch { /* 偏好加载失败不阻塞列表，设置弹窗打开时重试 */ }
})
onBeforeUnmount(() => {
  disposed = true
  ++sequence
  controller?.abort()
})
</script>

<template>
  <div class="page-shell space-y-6">
    <AppAlert v-for="item in alerts" :key="item.id" v-bind="item" @close="alerts = alerts.filter(value => value.id !== item.id)" />
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h1 class="page-title">{{ tr("站内通知") }}</h1><p class="mt-2 text-sm opacity-60">{{ tr("接收任务、监控、告警、安全与报告通知。点击通知跳转详情并标记已读；外部推送由管理员在通知渠道配置。") }}</p></div>
      <div class="flex gap-2">
        <button class="btn btn-sm" :disabled="busy || unreadCount === 0" @click="readAll">{{ tr("全部已读") }}</button>
        <button class="btn btn-neutral btn-sm" @click="openPrefs">{{ tr("接收设置") }}</button>
      </div>
    </div>
    <section class="rounded-xl bg-base-100 p-4 md:p-6">
      <div class="flex flex-wrap items-center gap-2">
        <button class="btn btn-sm" :class="category === '' ? 'btn-neutral' : 'btn-ghost'" @click="category = ''">
          {{ tr("全部") }}<span v-if="unreadCount > 0" class="badge badge-error badge-xs ml-1">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
        </button>
        <button v-for="item in inboxCategories" :key="item.value" class="btn btn-sm" :class="category === item.value ? 'btn-neutral' : 'btn-ghost'" @click="category = item.value">
          {{ item.label }}<span v-if="byCategory[item.value] > 0" class="badge badge-error badge-xs ml-1">{{ byCategory[item.value] > 99 ? '99+' : byCategory[item.value] }}</span>
        </button>
        <label class="ml-auto flex items-center gap-2 text-sm"><input v-model="unreadOnly" type="checkbox" class="checkbox checkbox-sm" />{{ tr("仅未读") }}</label>
      </div>
      <div v-if="failed" class="alert alert-warning mt-4" role="alert"><span>{{ tr("站内通知加载失败。") }}</span><button class="btn btn-sm" @click="loadList()">{{ tr("重试") }}</button></div>
      <p v-if="loading && !items.length" class="py-8 text-center text-sm opacity-60" role="status">{{ tr("正在加载…") }}</p>
      <p v-else-if="!items.length && !failed" class="py-10 text-center text-sm opacity-60">{{ unreadOnly ? tr("没有未读通知。") : tr("暂无站内通知。完成任务、触发告警或监控变化后会在这里收到通知。") }}</p>
      <ul v-else class="mt-4 divide-y divide-base-300">
        <li v-for="item in items" :key="item.id" class="flex items-start gap-3 py-3">
          <span class="mt-1.5 size-2.5 shrink-0 rounded-full" :class="item.read_at ? 'bg-base-300' : inboxSeverityClass(item.severity)" aria-hidden="true"></span>
          <button type="button" class="min-w-0 flex-1 text-left" @click="openItem(item)">
            <span class="flex flex-wrap items-center gap-2">
              <span class="text-sm" :class="{ 'font-semibold': !item.read_at }">{{ item.title }}</span>
              <span class="badge badge-outline badge-xs">{{ inboxCategoryLabel(item.category) }}</span>
            </span>
            <span class="mt-1 block truncate text-xs opacity-60">{{ item.body }}</span>
            <span class="mt-1 block text-xs opacity-60" :title="formatDateTime(item.created_at)">{{ formatRelativeTime(item.created_at) }}</span>
          </button>
          <button type="button" class="btn btn-ghost btn-xs text-error shrink-0" :disabled="busy" :aria-label="tr('删除通知')" @click="removeItem(item)">{{ tr("删除") }}</button>
        </li>
      </ul>
      <div class="mt-4 flex justify-center">
        <button v-if="nextBefore" class="btn btn-sm" :disabled="loading" @click="loadList(true)">{{ loading ? tr("正在加载…") : tr("加载更多") }}</button>
      </div>
    </section>
    <dialog ref="prefsDialog" class="modal" @cancel.prevent="prefsDialog?.close()">
      <form class="modal-box space-y-4" @submit.prevent="savePreferences">
        <h2 class="text-lg font-semibold">{{ tr("接收设置") }}</h2>
        <p class="text-sm opacity-60">{{ tr("选择希望接收的站内通知类别。关闭后不再接收该类别的新通知；管理员配置的外部渠道推送不受此设置影响。") }}</p>
        <label v-for="item in inboxCategories" :key="item.value" class="flex items-center justify-between gap-3 text-sm">
          <span>{{ item.label }}</span>
          <input v-model="prefsDraft[item.value]" type="checkbox" class="toggle toggle-neutral toggle-sm" />
        </label>
        <div class="modal-action">
          <button type="button" class="btn btn-sm" :disabled="prefsSaving" @click="prefsDialog?.close()">{{ tr("取消") }}</button>
          <button class="btn btn-neutral btn-sm" :disabled="prefsSaving">{{ prefsSaving ? tr("正在保存…") : tr("保存设置") }}</button>
        </div>
      </form>
    </dialog>
  </div>
</template>
