import assert from 'node:assert/strict'
import test from 'node:test'
import { createInboxNotifications } from './useInboxNotifications.js'

function fakeTimers() {
  let next = 0
  const pending = new Map()
  return {
    setTimeout: (fn, ms) => { const id = ++next; pending.set(id, { fn, ms }); return id },
    clearTimeout: id => pending.delete(id),
    async tick() {
      const entries = [...pending.values()]
      pending.clear()
      for (const { fn } of entries) await fn()
    },
    delays: () => [...pending.values()].map(entry => entry.ms),
    size: () => pending.size,
  }
}

function fakeHttp(overrides = {}) {
  const calls = []
  const ok = data => ({ data: { success: true, data } })
  const client = {
    calls,
    get: async (url, options) => {
      calls.push({ method: 'GET', url, options })
      if (overrides.get) return overrides.get(url, options)
      if (url.endsWith('/unread-count')) return ok({ count: 3, by_category: { task: 2, alert: 1 } })
      if (url.endsWith('/notifications')) return ok({ items: Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, category: 'task', read_at: null })), next_before: null })
      if (url.endsWith('/preferences')) return ok({ task: false })
      return ok({})
    },
    post: async (url, body) => { calls.push({ method: 'POST', url, body }); return ok({ updated: 1 }) },
    put: async (url, body) => { calls.push({ method: 'PUT', url, body }); return ok(body) },
    delete: async url => { calls.push({ method: 'DELETE', url }); return ok({ dismissed: true }) },
  }
  return client
}

const visibility = { hidden: false, addEventListener() {}, removeEventListener() {} }

test('start polls unread counts, backs off on failure and stops cleanly', async () => {
  const timers = fakeTimers()
  let failures = 0
  const httpClient = fakeHttp({
    get: url => {
      if (url.endsWith('/unread-count') && failures < 3) {
        failures += 1
        throw new Error('network')
      }
      return { data: { success: true, data: { count: 5, by_category: { task: 5 } } } }
    },
  })
  const inbox = createInboxNotifications({ httpClient, timers, visibility })
  await inbox.start()
  assert.equal(inbox.unreadCount.value, 0)
  assert.deepEqual(timers.delays(), [60000])
  await timers.tick()
  assert.deepEqual(timers.delays(), [120000])
  await timers.tick()
  assert.deepEqual(timers.delays(), [120000])
  await timers.tick()
  assert.equal(inbox.unreadCount.value, 5)
  assert.equal(inbox.byCategory.value.task, 5)
  assert.deepEqual(timers.delays(), [30000])
  inbox.stop()
  assert.equal(timers.size(), 0)
  assert.equal(inbox.unreadCount.value, 0)
  assert.deepEqual(inbox.recent.value, [])
})

test('hidden document skips polling fetches until visible again', async () => {
  const timers = fakeTimers()
  const httpClient = fakeHttp()
  const hiddenVisibility = { hidden: true, addEventListener() {}, removeEventListener() {} }
  const inbox = createInboxNotifications({ httpClient, timers, visibility: hiddenVisibility })
  await inbox.start()
  const before = httpClient.calls.length
  await timers.tick()
  assert.equal(httpClient.calls.length, before)
  assert.equal(timers.size(), 1)
  inbox.stop()
})

test('recent list is capped at eight and markRead updates read state and counts', async () => {
  const timers = fakeTimers()
  const httpClient = fakeHttp()
  const inbox = createInboxNotifications({ httpClient, timers, visibility })
  await inbox.loadRecent()
  assert.equal(inbox.recent.value.length, 8)
  await inbox.markRead({ ids: ['n0'] })
  assert.ok(inbox.recent.value[0].read_at)
  assert.equal(inbox.recent.value[1].read_at, null)
  const readCall = httpClient.calls.find(call => call.method === 'POST')
  assert.equal(readCall.url, '/api/inbox/read')
  assert.deepEqual(readCall.body, { ids: ['n0'] })
  await inbox.markRead({ all: true })
  assert.ok(inbox.recent.value.every(item => item.read_at))
  await inbox.dismiss('n1')
  assert.equal(inbox.recent.value.length, 7)
  inbox.stop()
})

test('preferences load with defaults and save round-trips', async () => {
  const timers = fakeTimers()
  const httpClient = fakeHttp()
  const inbox = createInboxNotifications({ httpClient, timers, visibility })
  await inbox.loadPrefs()
  assert.equal(inbox.prefs.value.task, false)
  assert.equal(inbox.prefs.value.monitor, true)
  await inbox.savePrefs({ task: true, monitor: false, alert: true, security: true, report: true })
  assert.equal(inbox.prefs.value.monitor, false)
  const put = httpClient.calls.find(call => call.method === 'PUT')
  assert.equal(put.url, '/api/inbox/preferences')
  inbox.stop()
})
