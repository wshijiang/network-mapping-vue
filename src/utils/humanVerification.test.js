import assert from 'node:assert/strict'
import test from 'node:test'
import { loginProof, parseHumanVerificationConfig, verificationAdapter } from './humanVerification.js'
import { createTurnstileLoader, createTurnstileWidget } from './humanVerification/turnstile.js'

const disabled = { schema_version: 1, provider: 'none', actions: [], widget: null }
const enabled = { schema_version: 1, provider: 'turnstile', actions: ['login'], widget: { site_key: 'public-fixture' } }

test('only an explicit supported policy allows login; failed or unknown policy cannot disable protection', () => {
  assert.deepEqual(parseHumanVerificationConfig(disabled), disabled)
  assert.deepEqual(loginProof(disabled, ''), {})
  for (const value of [null, {}, { ...disabled, schema_version: 2 }, { ...disabled, provider: 'unknown' },
    { ...enabled, actions: [] }, { ...enabled, actions: ['login', 'signup'] }, { ...enabled, widget: { site_key: '' } }]) {
    assert.throws(() => parseHumanVerificationConfig(value))
    assert.throws(() => loginProof(value, 'proof'))
  }
  assert.throws(() => loginProof(enabled, ' '))
  assert.deepEqual(loginProof(enabled, 'opaque-proof'), { human_verification: { token: 'opaque-proof' } })
  assert.equal(verificationAdapter(enabled), createTurnstileWidget)
})

function fakeDocument() {
  const scripts = []
  return {
    scripts,
    createElement() { return { remove() { this.removed = true } } },
    head: { appendChild(script) { scripts.push(script) } },
  }
}

const sdk = () => ({ render() {}, reset() {}, remove() {} })

test('loader shares one script, loads only the official URL, and reuses the initialized SDK', async () => {
  const windowObject = {}
  const documentObject = fakeDocument()
  const load = createTurnstileLoader(windowObject, documentObject)
  const first = load()
  const second = load()
  assert.equal(first, second)
  assert.equal(documentObject.scripts.length, 1)
  assert.equal(documentObject.scripts[0].src, 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')
  windowObject.turnstile = sdk()
  documentObject.scripts[0].onload()
  assert.equal(await first, windowObject.turnstile)
  assert.equal(await load(), windowObject.turnstile)
  assert.equal(documentObject.scripts.length, 1)
})

test('script errors and missing SDK remove failed scripts and permit an explicit retry', async () => {
  for (const failure of ['onerror', 'onload']) {
    const windowObject = {}
    const documentObject = fakeDocument()
    const load = createTurnstileLoader(windowObject, documentObject)
    const failed = load()
    documentObject.scripts[0][failure]()
    await assert.rejects(failed, /加载失败/)
    assert.equal(documentObject.scripts[0].removed, true)
    const retried = load()
    assert.equal(documentObject.scripts.length, 2)
    windowObject.turnstile = sdk()
    documentObject.scripts[1].onload()
    assert.equal(await retried, windowObject.turnstile)
  }
})

test('a stalled script has a bounded wait and is removed', async () => {
  const documentObject = fakeDocument()
  const load = createTurnstileLoader({}, documentObject, 5)
  await assert.rejects(load(), /加载失败/)
  assert.equal(documentObject.scripts[0].removed, true)
})

test('unmounted or superseded widget never renders after asynchronous script loading', async () => {
  let active = true
  let loaded
  let renders = 0
  const promise = createTurnstileWidget({}, {}, {}, () => active,
    () => new Promise((resolve) => { loaded = resolve }))
  active = false
  loaded({ render() { renders += 1 } })
  assert.equal(await promise, null)
  assert.equal(renders, 0)
})

test('widget expiration refreshes proof, removed callbacks are ignored, and JSON handling owns the token', async () => {
  const events = []
  let callbacks
  let resets = 0
  let removals = 0
  const mockSdk = {
    render(container, options) { callbacks = options; return 'widget-1' },
    reset(id) { assert.equal(id, 'widget-1'); resets += 1 },
    remove(id) { assert.equal(id, 'widget-1'); removals += 1 },
  }
  const controller = await createTurnstileWidget({}, {
    siteKey: 'public-fixture', action: 'login', theme: 'dark', size: 'flexible',
  }, {
    token: (token) => events.push(['token', token]),
    invalidated: (reason) => events.push(['invalidated', reason]),
    error: (message) => events.push(['error', message]),
  }, () => true, async () => mockSdk)
  assert.equal(callbacks['response-field'], false)
  assert.equal(callbacks.action, 'login')
  assert.equal(callbacks.theme, 'dark')
  callbacks.callback('first-proof')
  callbacks['expired-callback']()
  assert.equal(resets, 1)
  assert.deepEqual(events.at(-1), ['invalidated', 'expired'])
  callbacks.callback('second-proof')
  controller.reset()
  assert.equal(resets, 2)
  assert.deepEqual(events.at(-1), ['invalidated', 'reset'])
  controller.remove()
  controller.remove()
  const count = events.length
  callbacks.callback('stale-proof')
  callbacks['error-callback']()
  callbacks['expired-callback']()
  assert.equal(events.length, count)
  assert.equal(removals, 1)
  assert.equal(resets, 2)
})
