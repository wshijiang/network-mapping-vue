import { tr, i18n } from '../i18n/index.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { ref, watch } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { inboxCategories, inboxCategoryLabel, inboxSeverityClass } from '../utils/inbox.js'
import { formatDateTime, formatRelativeTime } from '../i18n/time.js'


const plain = value => JSON.parse(JSON.stringify(value))

const { descriptor } = parse(readFileSync(new URL('./NotificationInbox.vue', import.meta.url), 'utf8'))
const compiled = compileScript(descriptor, { id: 'notification-inbox-test' })
const source = compiled.scriptSetupAst.filter(node => node.type === 'ImportDeclaration')
  .reverse().reduce((code, node) => code.slice(0, node.start) + code.slice(node.end), descriptor.scriptSetup.content)

const fixtureItems = [
  { id: 'n1', category: 'task', severity: 'info', title: '扫描任务完成', body: '任务 ID：t1', link: '/task/t1', read_at: null, created_at: new Date().toISOString() },
  { id: 'n2', category: 'alert', severity: 'warning', title: '健康告警', body: '慢请求', link: '/health', read_at: '2026-01-01T00:00:00Z', created_at: new Date().toISOString() },
]

function createPage() {
  i18n.global.locale.value = 'zh-CN'
  const requests = [], reads = [], dismissals = [], pushes = [], savedPrefs = []
  let mount, dispose
  const inbox = {
    byCategory: ref({ task: 1, monitor: 0, alert: 0, security: 0, report: 0 }),
    unreadCount: ref(1),
    prefs: ref({ task: true, monitor: true, alert: true, security: true, report: true }),
    markRead: async payload => { reads.push(payload); return { updated: 1 } },
    dismiss: async id => { dismissals.push(id) },
    loadPrefs: async () => inbox.prefs.value,
    savePrefs: async next => { savedPrefs.push(next); inbox.prefs.value = { ...next }; return next },
    refreshCounts: async () => {},
  }
  const http = {
    get: async (url, options) => {
      requests.push({ url, params: options?.params })
      return { data: { success: true, data: { items: fixtureItems.map(item => ({ ...item })), next_before: null } } }
    },
  }
  const sandbox = {
    tr, ref, watch,
    onMounted: callback => { mount = callback },
    onBeforeUnmount: callback => { dispose = callback },
    useId: () => 'inbox-test-field',
    useRouter: () => ({ push: path => pushes.push(path) }),
    inboxNotifications: inbox,
    inboxCategories, inboxCategoryLabel, inboxSeverityClass,
    formatDateTime, formatRelativeTime,
    http, AbortController, crypto: globalThis.crypto,
  }
  const page = vm.runInNewContext(`${source}\n;({ items, category, unreadOnly, failed, loading, nextBefore, prefsDraft, loadList, openItem, removeItem, readAll, openPrefs, savePreferences })`, sandbox)
  return { ...page, inbox, requests, reads, dismissals, pushes, savedPrefs, mount: () => mount(), dispose: () => dispose() }
}

test('mount loads the list and filters pass category and unread parameters', async () => {
  const page = createPage()
  await page.mount()
  assert.equal(page.items.value.length, 2)
  assert.equal(page.requests[0].url, '/api/inbox/notifications')
  page.category.value = 'task'
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(page.requests.at(-1).params.category, 'task')
  page.unreadOnly.value = true
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(page.requests.at(-1).params.unread, true)
  page.dispose()
})

test('clicking an unread item marks it read and navigates; read items only navigate', async () => {
  const page = createPage()
  await page.mount()
  await page.openItem(page.items.value[0])
  assert.deepEqual(plain(page.reads), [{ ids: ['n1'] }])
  assert.ok(page.items.value[0].read_at)
  assert.deepEqual(plain(page.pushes), ['/task/t1'])
  await page.openItem(page.items.value[1])
  assert.equal(page.reads.length, 1)
  assert.deepEqual(plain(page.pushes), ['/task/t1', '/health'])
  page.dispose()
})

test('dismiss removes the item and read-all respects the active category', async () => {
  const page = createPage()
  await page.mount()
  await page.removeItem(page.items.value[0])
  assert.deepEqual(plain(page.dismissals), ['n1'])
  assert.equal(page.items.value.length, 1)
  page.category.value = 'alert'
  await page.readAll()
  assert.deepEqual(plain(page.reads.at(-1)), { all: true, category: 'alert' })
  page.dispose()
})

test('receiving settings draft saves through the shared inbox preferences', async () => {
  const page = createPage()
  await page.mount()
  page.openPrefs()
  assert.equal(page.prefsDraft.value.task, true)
  page.prefsDraft.value.task = false
  await page.savePreferences()
  assert.deepEqual(plain(page.savedPrefs), [{ task: false, monitor: true, alert: true, security: true, report: true }])
  assert.equal(page.inbox.prefs.value.task, false)
  page.dispose()
})
