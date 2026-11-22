import { tr, i18n } from '../i18n/index.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, ref } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { channelForm, channelPayload, defaultNotificationPrefs, validateChannel, validateNotificationPrefs } from '../utils/notifications.js'

const { descriptor } = parse(readFileSync(new URL('./Notifications.vue', import.meta.url), 'utf8'))
const compiled = compileScript(descriptor, { id: 'notification-lifecycle-test' })
const source = compiled.scriptSetupAst.filter((node) => node.type === 'ImportDeclaration')
  .reverse().reduce((code, node) => code.slice(0, node.start) + code.slice(node.end), descriptor.scriptSetup.content)

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
function createPage(get, request = async () => ({ data: { success: true, data: {} } })) {
  let mount, dispose
  const timers = new Map()
  let nextTimer = 0
  const page = localizedVm(`${source}\n;({ loadChannels, loadHistory, channels, deliveries, loadFailed, historyFailed, form, save, bindingDialog, bindingCode, bindingStatus, startBinding, closeBinding, prefs, prefsDirty, prefsFailed, loadPrefs, savePrefs })`, {
    computed, ref, useId: () => 'notification-test-field', channelForm, channelPayload, defaultNotificationPrefs, validateChannel, validateNotificationPrefs, AbortController, crypto: globalThis.crypto,
    http: Object.assign(request, { get }), useUnsavedChanges: () => {},
    onMounted: (callback) => { mount = callback },
    onBeforeUnmount: (callback) => { dispose = callback },
    document: { hidden: false },
    window: {
      setInterval: (callback) => { const id = ++nextTimer; timers.set(id, callback); return id },
      clearInterval: (id) => { timers.delete(id) },
      setTimeout: (callback) => { const id = ++nextTimer; timers.set(id, callback); return id },
      clearTimeout: (id) => { timers.delete(id) },
    },
  })
  return { ...page, timers, mount: () => mount(), dispose: () => dispose() }
}
const channels = { data: { success: true, data: [{ id: 'channel' }] } }
const history = { data: { success: true, data: { items: [{ id: 'delivery' }], next_before: null } } }

test('unmount during initial channel load aborts it and prevents late polling or history requests', async () => {
  const pending = deferred(), requests = []
  const page = createPage((url, options) => { requests.push({ url, options }); return pending.promise })
  const mounted = page.mount()
  page.dispose()
  // A late response is intentional: clients and mocks may still settle after cancellation.
  pending.resolve(channels)
  await mounted
  assert.equal(page.timers.size, 0)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].options?.signal.aborted, true)
  assert.equal(page.channels.value.length, 0)
})

test('unmount during history loading discards late results and does not create a timer', async () => {
  const pending = deferred(), started = deferred()
  let signal
  const page = createPage((url, options) => {
    if (url.endsWith('/channels')) return Promise.resolve(channels)
    signal = options.signal
    started.resolve()
    return pending.promise
  })
  const mounted = page.mount()
  await started.promise
  page.dispose()
  pending.resolve(history)
  await mounted
  assert.equal(signal?.aborted, true)
  assert.equal(page.deliveries.value.length, 0)
  assert.equal(page.timers.size, 0)
})

test('normal polling is removed on unmount and an already queued callback cannot make requests', async () => {
  const requests = []
  const page = createPage(async (url) => { requests.push(url); return url.endsWith('/channels') ? channels : history })
  await page.mount()
  assert.equal(page.channels.value.length, 1)
  assert.equal(page.deliveries.value.length, 1)
  assert.equal(page.timers.size, 1)
  const callback = [...page.timers.values()][0]
  page.dispose()
  callback()
  assert.equal(page.timers.size, 0)
  assert.equal(requests.length, 3)
})

test('a cancelled initial request does not set an error after unmount', async () => {
  const page = createPage((_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'ERR_CANCELED' })))
  }))
  const mounted = page.mount()
  page.dispose()
  await mounted
  assert.equal(page.loadFailed.value, false)
  assert.equal(page.historyFailed.value, false)
  assert.equal(page.timers.size, 0)
})

test('the same page saves each provider with independent common event subscriptions', async () => {
  const requests = []
  const page = createPage(async url => url.endsWith('/channels') ? channels : history,
    async config => { requests.push(config); return { data: { success: true, data: {} } } })
  for (const provider of ['email', 'feishu', 'telegram']) {
    const form = channelForm()
    Object.assign(form, { provider, name: provider, webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/00000000-0000-4000-8000-000000000001',
      bot_token: '123456:abcdefghijklmnopqrstuvwxyz_ABC-123', smtp_password: 'password' })
    Object.assign(form.settings, { smtp_host: 'smtp.example.com', smtp_sender: 'sender@example.com', chat_id: '-1001234567890' })
    page.form.value = form
    await page.save()
  }
  assert.equal(requests.length, 3)
  assert.deepEqual(requests.map(config => config.data.provider), ['email', 'feishu', 'telegram'])
  assert(requests.every(config => config.data.enabled && config.data.event_types.includes('health.alert') && config.data.event_types.includes('user.login')))
  assert(requests.every(config => config.url === '/api/notifications/channels' && config.method === 'POST'))
  page.dispose()
})

test('saving an application bot with a personal target sends its Open ID', async () => {
  const requests = []
  const page = createPage(async url => url.endsWith('/channels') ? channels : history,
    async config => { requests.push(config); return { data: { success: true, data: {} } } })
  const form = channelForm()
  Object.assign(form, { provider: 'feishu', name: 'personal', feishu_app_secret: 'secret' })
  Object.assign(form.settings, { feishu_bot_type: 'app', feishu_target_type: 'user', feishu_app_id: 'cli_app', feishu_open_id: 'ou_user' })
  page.form.value = form
  await page.save()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].data.settings.feishu_target_type, 'user')
  assert.equal(requests[0].data.settings.feishu_open_id, 'ou_user')
  assert.equal(requests[0].data.settings.feishu_chat_id, '')
  page.dispose()
})

test('a new personal channel is saved disabled until a recipient binds', async () => {
  const requests = []
  const page = createPage(async url => url.endsWith('/channels') ? channels : history,
    async config => { requests.push(config); return { data: { success: true, data: {} } } })
  const form = channelForm()
  Object.assign(form, { provider: 'feishu', name: 'personal', feishu_app_secret: 'secret' })
  Object.assign(form.settings, { feishu_bot_type: 'app', feishu_target_type: 'user', feishu_app_id: 'cli_app' })
  page.form.value = form
  await page.save()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].data.enabled, false)
  assert.equal(requests[0].data.settings.feishu_open_id, '')
  page.dispose()
})

test('changing the application clears its old personal recipient and disables delivery', async () => {
  const requests = []
  const page = createPage(async url => url.endsWith('/channels') ? channels : history,
    async config => { requests.push(config); return { data: { success: true, data: {} } } })
  const form = channelForm({ id: 'channel', revision: 3, provider: 'feishu', name: 'personal', enabled: true, event_types: ['health.alert'], feishu_app_secret_configured: true, settings: { feishu_bot_type: 'app', feishu_target_type: 'user', feishu_app_id: 'cli_old', feishu_open_id: 'ou_old' } })
  form.settings.feishu_app_id = 'cli_new'
  form.feishu_app_secret = 'new-secret'
  page.form.value = form
  await page.save()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].data.enabled, false)
  assert.equal(requests[0].data.settings.feishu_open_id, '')
  page.dispose()
})

test('binding shows the one-time command, polls status and stops polling when closed', async () => {
  const requests = []
  const request = async () => ({ data: { success: true, data: {} } })
  request.post = async (url, body) => { requests.push({ url, body }); return { data: { success: true, data: { code: 'ABC123', expires_at: 'later' } } } }
  const page = createPage(async url => { requests.push({ url }); return { data: { success: true, data: { binding_status: 'pending', connection_status: 'connected' } } } }, request)
  const dialog = { open: false, showModal() { this.open = true }, close() { this.open = false } }
  page.bindingDialog.value = dialog
  await page.startBinding({ id: 'channel', revision: 7 })
  assert.equal(requests[0].body.expected_revision, 7)
  assert.equal(page.bindingCode.value, 'ABC123')
  assert.equal(page.bindingStatus.value.connection_status, 'connected')
  assert.equal(page.timers.size, 1)
  page.closeBinding()
  assert.equal(page.bindingCode.value, '')
  assert.equal(page.timers.size, 0)
  page.dispose()
})

// Existing business fixtures select Chinese explicitly; locale behavior has its own tests.
function localizedVm(code, context, options) {
  i18n.global.locale.value = 'zh-CN'
  return vm.runInNewContext(code, { tr, ...context }, options)
}

test('global preferences load, validate and save independently of channels', async () => {
  const puts = []
  const request = async config => ({ data: { success: true, data: config.data } })
  request.put = async (url, data) => { puts.push({ url, data }); return { data: { success: true, data } } }
  const page = createPage(async url => {
    if (url.endsWith('/channels')) return channels
    if (url.endsWith('/preferences')) return { data: { success: true, data: { notifyOnCancel: true, inboxRetentionDays: 30 } } }
    return history
  }, request)
  await page.mount()
  assert.equal(page.prefs.value.notifyOnCancel, true)
  assert.equal(page.prefs.value.inboxRetentionDays, 30)
  assert.equal(page.prefs.value.notifyOnComplete, true)
  assert.equal(page.prefsDirty.value, false)
  page.prefs.value.inboxRetentionDays = 3
  await page.savePrefs()
  assert.equal(puts.length, 0)
  page.prefs.value.inboxRetentionDays = 60
  await page.savePrefs()
  assert.equal(puts.length, 1)
  assert.equal(puts[0].url, '/api/notifications/preferences')
  assert.equal(puts[0].data.inboxRetentionDays, 60)
  assert.equal(page.prefsDirty.value, false)
  page.dispose()
})
