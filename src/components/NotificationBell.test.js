import { tr, i18n } from '../i18n/index.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { ref, watch } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { inboxCategoryLabel, inboxSeverityClass, unreadBadge } from '../utils/inbox.js'
import { formatRelativeTime } from '../i18n/time.js'


const plain = value => JSON.parse(JSON.stringify(value))

const { descriptor } = parse(readFileSync(new URL('./NotificationBell.vue', import.meta.url), 'utf8'))
const compiled = compileScript(descriptor, { id: 'notification-bell-test' })
const source = compiled.scriptSetupAst.filter(node => node.type === 'ImportDeclaration')
  .reverse().reduce((code, node) => code.slice(0, node.start) + code.slice(node.end), descriptor.scriptSetup.content)

function createBell() {
  i18n.global.locale.value = 'zh-CN'
  const timers = new Map()
  let nextTimer = 0
  const reads = [], pushes = []
  let recentLoads = 0
  const inbox = {
    unreadCount: ref(0),
    recent: ref([{ id: 'n1', title: '任务完成', category: 'task', severity: 'info', read_at: null, link: '/task/t1', created_at: new Date().toISOString() }]),
    recentLoading: ref(false),
    loadRecent: async () => { recentLoads += 1 },
    markRead: async payload => { reads.push(payload) },
  }
  let dispose
  const sandbox = {
    tr, ref, watch,
    onBeforeUnmount: callback => { dispose = callback },
    useRouter: () => ({ push: path => pushes.push(path) }),
    inboxNotifications: inbox,
    inboxCategoryLabel, inboxSeverityClass, unreadBadge, formatRelativeTime,
    setTimeout: (callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, ms }); return id },
    clearTimeout: id => timers.delete(id),
    setInterval: (callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, ms, interval: true }); return id },
    clearInterval: id => timers.delete(id),
    addEventListener() {}, removeEventListener() {},
  }
  const page = vm.runInNewContext(`${source}\n;({ open, shaking, toggle, openItem, readAll, viewAll, unreadCount })`, sandbox)
  return { ...page, inbox, reads, pushes, timers, recentLoads: () => recentLoads, dispose: () => dispose() }
}

test('unread increase shakes the bell and the shake settles after 900ms', async () => {
  const bell = createBell()
  assert.equal(bell.shaking.value, false)
  bell.inbox.unreadCount.value = 2
  await Promise.resolve()
  assert.equal(bell.shaking.value, true)
  const shake = [...bell.timers.values()].find(timer => timer.ms === 900)
  assert.ok(shake)
  shake.callback()
  assert.equal(bell.shaking.value, false)
  bell.dispose()
  assert.equal(bell.timers.size, 0)
})

test('opening the panel loads recent items and clicking marks read then navigates', async () => {
  const bell = createBell()
  await bell.toggle()
  assert.equal(bell.open.value, true)
  assert.equal(bell.recentLoads(), 1)
  await bell.openItem(bell.inbox.recent.value[0])
  assert.deepEqual(plain(bell.reads), [{ ids: ['n1'] }])
  assert.deepEqual(plain(bell.pushes), ['/task/t1'])
  assert.equal(bell.open.value, false)
  bell.dispose()
})

test('read-all and view-all use the shared inbox actions', async () => {
  const bell = createBell()
  bell.inbox.unreadCount.value = 4
  await bell.readAll()
  assert.deepEqual(plain(bell.reads), [{ all: true }])
  bell.viewAll()
  assert.deepEqual(plain(bell.pushes), ['/notifications'])
  bell.dispose()
})
