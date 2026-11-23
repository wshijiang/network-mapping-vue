import { ref } from 'vue'
import http from '../utils/http.js'

const POLL_MS = 30000
const MAX_BACKOFF_MS = 120000
const ZERO_CATEGORIES = { task: 0, monitor: 0, alert: 0, security: 0, report: 0 }

// 工厂便于注入 http/定时器/文档做单元测试；应用使用下方模块级单例，
// 铃铛与收件箱页共享同一份未读状态与轮询。
export function createInboxNotifications({
  httpClient = http,
  timers = globalThis,
  visibility = typeof document !== 'undefined' ? document : null,
} = {}) {
  const unreadCount = ref(0)
  const byCategory = ref({ ...ZERO_CATEGORIES })
  const recent = ref([])
  const recentLoading = ref(false)
  const prefs = ref({ task: true, monitor: true, alert: true, security: true, report: true })
  let timer = null
  let delay = POLL_MS
  let running = false
  let countController = null
  let recentController = null

  async function refreshCounts() {
    countController?.abort()
    const controller = new AbortController()
    countController = controller
    try {
      const response = await httpClient.get('/api/inbox/unread-count', { signal: controller.signal })
      if (controller.signal.aborted) return
      const data = response.data?.data
      if (response.data?.success !== true || !data) throw new Error('invalid inbox count response')
      unreadCount.value = Number(data.count) || 0
      byCategory.value = { ...ZERO_CATEGORIES, ...data.by_category }
      delay = POLL_MS
    } catch {
      if (controller.signal.aborted) return
      delay = Math.min(delay * 2, MAX_BACKOFF_MS)
    }
  }

  function schedule() {
    if (!running) return
    timers.clearTimeout(timer)
    timer = timers.setTimeout(async () => {
      if (!running) return
      if (!visibility?.hidden) await refreshCounts()
      schedule()
    }, delay)
  }

  async function start() {
    if (running) return
    running = true
    await refreshCounts()
    schedule()
  }

  function stop() {
    running = false
    timers.clearTimeout(timer)
    countController?.abort()
    recentController?.abort()
    unreadCount.value = 0
    byCategory.value = { ...ZERO_CATEGORIES }
    recent.value = []
  }

  async function loadRecent() {
    recentController?.abort()
    const controller = new AbortController()
    recentController = controller
    recentLoading.value = true
    try {
      const response = await httpClient.get('/api/inbox/notifications', { signal: controller.signal })
      if (controller.signal.aborted) return
      const data = response.data?.data
      if (response.data?.success !== true || !Array.isArray(data?.items)) throw new Error('invalid inbox list response')
      recent.value = data.items.slice(0, 8)
    } catch {
      if (!controller.signal.aborted) recent.value = []
    } finally {
      if (!controller.signal.aborted) recentLoading.value = false
    }
  }

  async function markRead(payload) {
    const response = await httpClient.post('/api/inbox/read', payload)
    if (response.data?.success !== true) throw new Error('invalid inbox read response')
    const now = new Date().toISOString()
    if (payload.all) {
      recent.value = recent.value.map(item => (
        payload.category && item.category !== payload.category ? item : { ...item, read_at: item.read_at || now }
      ))
    } else {
      const ids = new Set(payload.ids || [])
      recent.value = recent.value.map(item => (ids.has(item.id) ? { ...item, read_at: item.read_at || now } : item))
    }
    await refreshCounts()
    return response.data.data
  }

  async function dismiss(id) {
    const response = await httpClient.delete(`/api/inbox/notifications/${id}`)
    if (response.data?.success !== true) throw new Error('invalid inbox dismiss response')
    recent.value = recent.value.filter(item => item.id !== id)
    await refreshCounts()
  }

  async function loadPrefs() {
    const response = await httpClient.get('/api/inbox/preferences')
    const data = response.data?.data
    if (response.data?.success !== true || !data) throw new Error('invalid inbox preferences response')
    prefs.value = { task: true, monitor: true, alert: true, security: true, report: true, ...data }
    return prefs.value
  }

  async function savePrefs(next) {
    const response = await httpClient.put('/api/inbox/preferences', next)
    const data = response.data?.data
    if (response.data?.success !== true || !data) throw new Error('invalid inbox preferences response')
    prefs.value = { task: true, monitor: true, alert: true, security: true, report: true, ...data }
    return prefs.value
  }

  function onVisibilityChange() {
    if (running && !visibility?.hidden) refreshCounts().then(schedule)
  }
  visibility?.addEventListener?.('visibilitychange', onVisibilityChange)

  function dispose() {
    stop()
    visibility?.removeEventListener?.('visibilitychange', onVisibilityChange)
  }

  return {
    unreadCount, byCategory, recent, recentLoading, prefs,
    start, stop, dispose, refreshCounts, loadRecent, markRead, dismiss, loadPrefs, savePrefs,
  }
}

export const inboxNotifications = createInboxNotifications()
