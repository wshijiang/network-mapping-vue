import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, reactive, ref } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { tr } from '../i18n/index.js'

const { descriptor } = parse(readFileSync(new URL('./ScannerConfiguration.vue', import.meta.url), 'utf8'))
const compiled = compileScript(descriptor, { id: 'scanner-configuration-test' })
const source = compiled.scriptSetupAst.filter(node => node.type === 'ImportDeclaration').reverse()
  .reduce((code, node) => code.slice(0, node.start) + code.slice(node.end), descriptor.scriptSetup.content)
const copy = value => JSON.parse(JSON.stringify(value))
function page(http = {}) {
  return vm.runInNewContext(`${source}\n;({ form, applyData, saveConfiguration, isDirty, revision, saving, changeReason, alerts })`, {
    tr, computed, reactive, ref, http, crypto: globalThis.crypto,
    useId: () => 'scanner-config', useRoute: () => ({ params: { id: 'scanner-id' } }),
    onMounted: () => {}, useUnsavedChanges: () => {},
  })
}

test('web configuration publishes every JARM field with revision control and preserves other settings', async () => {
  const calls = []
  let stored
  const view = page({
    put: async (url, payload) => {
      calls.push({ url, payload: copy(payload) })
      stored = { document: payload.document, revision: 4 }
      return { data: { success: true, data: stored } }
    },
    get: async () => ({ data: { success: true, data: stored } }),
  })
  const document = copy(view.form)
  document.masscan.rate = 1234
  document.service_detection.web_content.enabled = false
  view.applyData({ document, revision: 3 })
  assert.equal(view.isDirty.value, false)
  Object.assign(view.form.service_detection.jarm, { enabled: true, concurrency: 8, probe_timeout_seconds: 5, max_stage_seconds: 90 })
  view.changeReason.value = '  authorized inventory  '
  assert.equal(view.isDirty.value, true)
  assert.equal(await view.saveConfiguration(), true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/scanner/scanner-id/configuration')
  assert.equal(calls[0].payload.expectedRevision, 3)
  assert.equal(calls[0].payload.changeReason, 'authorized inventory')
  assert.deepEqual(calls[0].payload.document.service_detection.jarm, { enabled: true, concurrency: 8, probe_timeout_seconds: 5, max_stage_seconds: 90 })
  assert.equal(calls[0].payload.document.masscan.rate, 1234)
  assert.equal(calls[0].payload.document.service_detection.web_content.enabled, false)
  assert.equal(view.revision.value, 4)
  assert.equal(view.isDirty.value, false)
  view.form.service_detection.jarm.enabled = false
  assert.equal(await view.saveConfiguration(), true)
  assert.equal(calls[1].payload.document.service_detection.jarm.enabled, false)
})

test('loading an older document cannot retain a previously enabled JARM switch', () => {
  const view = page()
  const document = copy(view.form)
  Object.assign(view.form.service_detection.jarm, { enabled: true, concurrency: 24 })
  delete document.service_detection.jarm
  view.applyData({ document, revision: 2 })
  assert.deepEqual(copy(view.form.service_detection.jarm), { enabled: false, concurrency: 4, probe_timeout_seconds: 3, max_stage_seconds: 60 })
  assert.equal(view.isDirty.value, false)
  document.service_detection.jarm = { enabled: true }
  view.applyData({ document, revision: 3 })
  assert.equal(view.form.service_detection.jarm.concurrency, 4)
})

test('revision conflicts reload the published JARM configuration without retrying stale edits', async () => {
  let writes = 0
  const view = page({
    put: async () => { writes += 1; throw { response: { status: 409 } } },
    get: async () => ({ data: { success: true, data: { document, revision: 8 } } }),
  })
  const document = copy(view.form)
  view.applyData({ document, revision: 7 })
  view.form.service_detection.jarm.enabled = true
  assert.equal(await view.saveConfiguration(), false)
  assert.equal(writes, 1)
  assert.equal(view.revision.value, 8)
  assert.equal(view.form.service_detection.jarm.enabled, false)
  assert.equal(view.isDirty.value, false)
  assert.equal(view.saving.value, false)
  assert.equal(view.alerts.value[0].type, 'warning')
})
