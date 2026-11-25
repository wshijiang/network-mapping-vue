import { tr, i18n } from '../i18n/index.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { computed, ref, watch, nextTick } from 'vue'
import { parse, compileScript } from 'vue/compiler-sfc'
import * as services from '../utils/serviceDetection.js'
import * as targets from '../utils/scanTargets.js'

const { descriptor } = parse(readFileSync(new URL('./createscan.vue', import.meta.url), 'utf8'))
const compiled = compileScript(descriptor, { id: 'automatic-service-test' })
const source = compiled.scriptSetupAst.filter(n => n.type === 'ImportDeclaration').reverse()
  .reduce((text, n) => text.slice(0, n.start) + text.slice(n.end), descriptor.scriptSetup.content)

function page() {
  const requests = []
  const state = localizedVm(`${source}\n;({scanProfile, targetInput, port, scanSettingsLoading,
    targetInputRef, portInputRef, probeServerName, modbusUnitId, requiredServices,
    serviceProbeOptions, previewPlacement, submitTask})`, {
    ...services, ...targets, computed, ref, watch, inject: () => ref(null), useId: () => 'scan-form',
    onMounted: () => {}, useUnsavedChanges: () => {}, console,
    crypto: { randomUUID: () => 'test-id' },
    http: { post: async (url, payload) => {
      requests.push({url, payload: JSON.parse(JSON.stringify(payload))})
      return {status: 200, data: {data: {candidates: []}}}
    } }
  })
  state.scanSettingsLoading.value = false
  state.targetInput.value = '192.0.2.1'
  state.targetInputRef.value = state.portInputRef.value = {reportValidity: () => true}
  return {...state, requests}
}

test('TCP preview and creation retain automatic identification with advanced parameters', async () => {
  const p = page()
  p.scanProfile.value = 'service_inventory'
  await nextTick()
  p.port.value = '502'
  p.modbusUnitId.value = 7
  p.probeServerName.value = 'probe.internal'
  await p.previewPlacement()
  assert.equal(await p.submitTask(), true)
  assert.equal(p.requests.length, 2)
  for (const {payload} of p.requests) {
    assert.deepEqual(payload.required_services, [])
    assert.deepEqual(payload.service_probe_options, {server_name: 'probe.internal', modbus_unit_id: 7})
  }
})

test('UDP preview and creation select the full transport protocol set automatically', async () => {
  const p = page()
  p.scanProfile.value = 'udp_inventory'
  await nextTick()
  p.port.value = '53,44818,47808'
  await p.previewPlacement()
  assert.equal(await p.submitTask(), true)
  assert.equal(p.requests.length, 2)
  for (const {payload} of p.requests) {
    assert.deepEqual(payload.required_services, ['dns_udp', 'enip_udp', 'bacnet'])
    assert.deepEqual(payload.service_probe_options, {})
  }
})

// Existing business fixtures select Chinese explicitly; locale behavior has its own tests.
function localizedVm(code, context, options) {
  i18n.global.locale.value = 'zh-CN'
  return vm.runInNewContext(code, { tr, ...context }, options)
}
