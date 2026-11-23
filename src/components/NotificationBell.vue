<script setup>
import { tr } from '../i18n/index.js'

import { onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, BellRing } from '@lucide/vue'
import { inboxNotifications } from '@/composables/useInboxNotifications'
import { inboxCategoryLabel, inboxSeverityClass, unreadBadge } from '@/utils/inbox'
import { formatRelativeTime } from '../i18n/time.js'

const { unreadCount, recent, recentLoading, loadRecent, markRead } = inboxNotifications
const router = useRouter()
const open = ref(false)
const shaking = ref(false)
let shakeTimer = null

function triggerShake() {
  shaking.value = true
  globalThis.clearTimeout(shakeTimer)
  shakeTimer = globalThis.setTimeout(() => { shaking.value = false }, 900)
}

// 未读增加立即摇晃；存在未读期间每 8 秒轻摇一次提醒。
watch(unreadCount, (next, previous) => {
  if (next > previous) triggerShake()
})
const periodicTimer = globalThis.setInterval(() => {
  if (unreadCount.value > 0) triggerShake()
}, 8000)

function onKeydown(event) {
  if (event.key === 'Escape') open.value = false
}
watch(open, value => {
  if (value) globalThis.addEventListener?.('keydown', onKeydown)
  else globalThis.removeEventListener?.('keydown', onKeydown)
})

onBeforeUnmount(() => {
  globalThis.clearInterval(periodicTimer)
  globalThis.clearTimeout(shakeTimer)
  globalThis.removeEventListener?.('keydown', onKeydown)
})

async function toggle() {
  open.value = !open.value
  if (open.value) await loadRecent()
}
async function openItem(item) {
  if (!item.read_at) await markRead({ ids: [item.id] })
  open.value = false
  if (item.link) router.push(item.link)
}
async function readAll() {
  await markRead({ all: true })
}
function viewAll() {
  open.value = false
  router.push('/notifications')
}
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="btn btn-ghost btn-square relative"
      :aria-label="tr('站内通知')"
      :aria-expanded="open"
      @click="toggle"
    >
      <BellRing v-if="unreadCount > 0" class="size-5" :class="{ 'bell-shake': shaking }" aria-hidden="true" />
      <Bell v-else class="size-5" aria-hidden="true" />
      <span v-if="unreadCount > 0" class="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-error px-1 text-center text-[10px] font-semibold leading-4 text-error-content">{{ unreadBadge(unreadCount) }}</span>
    </button>
    <template v-if="open">
      <div class="fixed inset-0 z-40" aria-hidden="true" @click="open = false"></div>
      <div class="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-box border border-base-300 bg-base-100 shadow-xl" role="dialog" :aria-label="tr('站内通知')">
        <div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
          <h2 class="text-sm font-semibold">{{ tr("站内通知") }}</h2>
          <button type="button" class="btn btn-ghost btn-xs" :disabled="unreadCount === 0" @click="readAll">{{ tr("全部已读") }}</button>
        </div>
        <p v-if="recentLoading" class="px-4 py-6 text-sm opacity-60" role="status">{{ tr("正在加载…") }}</p>
        <p v-else-if="!recent.length" class="px-4 py-8 text-center text-sm opacity-60">{{ tr("暂无站内通知") }}</p>
        <ul v-else class="max-h-96 overflow-y-auto py-1">
          <li v-for="item in recent" :key="item.id">
            <button type="button" class="flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-base-200" @click="openItem(item)">
              <span class="mt-1.5 size-2 shrink-0 rounded-full" :class="item.read_at ? 'bg-base-300' : inboxSeverityClass(item.severity)" aria-hidden="true"></span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm" :class="{ 'font-semibold': !item.read_at }">{{ item.title }}</span>
                <span class="mt-0.5 block text-xs opacity-60">{{ inboxCategoryLabel(item.category) }} · {{ formatRelativeTime(item.created_at) }}</span>
              </span>
            </button>
          </li>
        </ul>
        <div class="border-t border-base-300 px-4 py-2">
          <button type="button" class="btn btn-ghost btn-sm w-full" @click="viewAll">{{ tr("查看全部") }}</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
@keyframes bell-shake {
  0%, 100% { transform: rotate(0); }
  15% { transform: rotate(14deg); }
  30% { transform: rotate(-12deg); }
  45% { transform: rotate(10deg); }
  60% { transform: rotate(-8deg); }
  75% { transform: rotate(4deg); }
}
.bell-shake {
  animation: bell-shake 0.9s ease-in-out;
  transform-origin: top center;
}
@media (prefers-reduced-motion: reduce) {
  .bell-shake { animation: none; }
}
</style>
