import { tr, i18n } from '../i18n/index.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, nextTick, reactive, ref } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { notificationProviders } from '../utils/notifications.js'

const { descriptor } = parse(readFileSync(new URL('./NotificationTemplates.vue', import.meta.url), 'utf8'))
const compiled = compileScript(descriptor, { id: 'notification-template-navigation' })
const code = compiled.scriptSetupAst.filter(node => node.type === 'ImportDeclaration').reverse()
  .reduce((text, node) => text.slice(0, node.start) + text.slice(node.end), descriptor.scriptSetup.content)
function createPage(confirm = () => true) {
  const page = localizedVm(`${code}\n;({provider,editor,mailTemplates,selectedEvent,events,initialBotEvent,botVariants,navigationDisabled,historyVersions,historyLoading,restoreVersion,syncSelection,selectProvider,selectEvent,selectProviderFromDropdown,selectEventFromDropdown,confirmDialog})`, {
    computed, nextTick, reactive, ref, notificationProviders, window: { confirm },
  })
  page.confirmDialog.value = { ask: async () => confirm() }
  return page
}

test('history follows the active editor and only restores its non-draft versions', async () => {
  const page = createPage()
  const calls = []
  let finish
  page.editor.value = {versions:[{version:1,status:'archived'},{version:2,status:'draft'}],restoreVersion:version => {
    calls.push(version)
    return new Promise(resolve => { finish = resolve })
  }}
  assert.equal(page.historyVersions.value.length, 2)
  await page.restoreVersion(2)
  await page.restoreVersion(99)
  assert.equal(calls.length, 0)
  const pending = page.restoreVersion(1)
  assert.equal(page.historyLoading.value, true)
  assert.equal(page.navigationDisabled.value, true)
  await page.selectProvider('feishu')
  assert.equal(page.provider.value, 'email')
  finish()
  await pending
  assert.deepEqual(calls, [1])
  page.editor.value = {versions:[],loading:true}
  assert.equal(page.historyVersions.value.length, 0)
  assert.equal(page.historyLoading.value, true)
})

test('all providers use the five mail event categories and catalogue labels', async () => {
  const page = createPage()
  page.mailTemplates.value = [{templateKey:'login_success',displayName:'邮件登录成功',hasDraft:true}]
  const keys = ['login_success','health_alert','scanner_outage','report_weekly','report_monthly']
  assert.deepEqual(Array.from(page.events.value, item => item.value), keys)
  assert.equal(page.events.value[0].label, '邮件登录成功')
  assert.equal(page.events.value[0].hasDraft, true)
  for (const provider of ['feishu','telegram']) {
    await page.selectProvider(provider)
    assert.deepEqual(Array.from(page.events.value, item => item.value), keys)
    assert.equal(page.events.value[0].label, '邮件登录成功')
    assert.equal(page.events.value[0].hasDraft, false)
  }
})

test('event selection uses the current editor and preserves the category when changing provider', async () => {
  const page = createPage()
  const calls = []
  page.editor.value = {selectTemplate: async key => { calls.push(key); page.syncSelection(key) }}
  await page.selectEvent('health_alert')
  assert.equal(page.provider.value, 'email')
  assert.equal(page.selectedEvent.value, 'health_alert')
  await page.selectEvent('health_alert')
  assert.deepEqual(calls, ['health_alert'])
  await page.selectProvider('feishu')
  assert.equal(page.initialBotEvent.value, 'health.alert')
  page.editor.value = {selectEvent: async key => { calls.push(key); page.syncSelection(key) }}
  await page.selectEvent('report_monthly')
  assert.equal(page.selectedEvent.value, 'report_monthly')
  assert.equal(calls.at(-1), 'report.monthly')
  await page.selectProvider('email')
  assert.equal(page.selectedEvent.value, 'report_monthly')
})

test('scanner outage and recovery share one category while keeping their existing bot templates', async () => {
  const page = createPage()
  await page.selectProvider('feishu')
  page.syncSelection('scanner.recovered')
  assert.equal(page.selectedEvent.value, 'scanner_outage')
  assert.equal(page.initialBotEvent.value, 'scanner.recovered')
  assert.deepEqual(Array.from(page.botVariants.value, item => item.value), ['scanner.offline','scanner.recovered'])
  await page.selectProvider('telegram')
  assert.equal(page.selectedEvent.value, 'scanner_outage')
  assert.equal(page.initialBotEvent.value, 'scanner.offline')
  await page.selectProvider('feishu')
  assert.equal(page.initialBotEvent.value, 'scanner.recovered')
})

test('cancelling provider or event navigation restores the corresponding mobile select', async () => {
  const page = createPage(() => false)
  page.editor.value = {hasUnsavedChanges:true,selectTemplate:async () => {}}
  const providerEvent = {target:{value:'telegram'}}
  await page.selectProviderFromDropdown(providerEvent)
  assert.equal(page.provider.value, 'email')
  assert.equal(providerEvent.target.value, 'email')
  const event = {target:{value:'health_alert'}}
  await page.selectEventFromDropdown(event)
  assert.equal(page.selectedEvent.value, 'login_success')
  assert.equal(event.target.value, 'login_success')
})

test('busy editors, pending navigation and unknown options cannot start competing switches', async () => {
  const page = createPage()
  page.editor.value = {busy:true}
  await page.selectProvider('telegram')
  assert.equal(page.provider.value, 'email')
  page.editor.value = {}
  await page.selectProvider('invalid')
  await page.selectEvent('invalid')
  assert.equal(page.selectedEvent.value, 'login_success')
  assert.equal(page.provider.value, 'email')
  let finish
  page.editor.value = {selectTemplate: () => new Promise(resolve => { finish = resolve })}
  const pending = page.selectEvent('health_alert')
  assert.equal(page.navigationDisabled.value, true)
  await page.selectProvider('feishu')
  assert.equal(page.provider.value, 'email')
  finish()
  await pending
  assert.equal(page.navigationDisabled.value, false)
})

test('mail navigation remains available if loading the mail catalogue fails', async () => {
  const page = createPage()
  await page.selectProvider('telegram')
  page.syncSelection('report.weekly')
  await page.selectProvider('email')
  assert.equal(page.provider.value, 'email')
  assert.equal(page.selectedEvent.value, 'report_weekly')
  assert.equal(page.events.value.length, 5)
})

// Existing business fixtures select Chinese explicitly; locale behavior has its own tests.
function localizedVm(code, context, options) {
  i18n.global.locale.value = 'zh-CN'
  return vm.runInNewContext(code, { tr, ...context }, options)
}
