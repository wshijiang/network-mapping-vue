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

function page(access = null) {
  const requests = []
  const state = localizedVm(`${source}\n;({scanProfile, targetInput, port, scanSettingsLoading,
    targetInputRef, portInputRef, probeServerName, modbusUnitId, requiredServices,
    serviceProbeOptions, previewPlacement, submitTask, hasUnsavedChanges, scannerIds, webContentEnabled})`, {
    ...services, ...targets, computed, ref, watch, inject: () => ref(access), useId: () => 'scan-form',
    onMounted: () => {}, useUnsavedChanges: () => {}, console,
    crypto: { randomUUID: () => 'test-id' },
    http: { post: async (url, payload) => {
      requests.push({url, payload: JSON.parse(JSON.stringify(payload))})
      return {status: 200, data: {data: {candidates: []}}}
    } }
  })
  state.scanSettingsLoading.value = false
  if (!access) state.targetInput.value = '192.0.2.1'
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

test('a scoped form starts clean and clears its dirty flag after a successful submission', async () => {
  const p = page({
    role: 2, legacy_user: false, max_priority: 1, profiles: ['port_only'],
  })
  assert.equal(p.scanProfile.value, 'port_only')
  assert.equal(p.hasUnsavedChanges.value, false)

  p.targetInput.value = '192.0.2.1'
  await nextTick()
  p.port.value = '80'
  p.scannerIds.value = ['permitted-scanner']
  assert.equal(p.hasUnsavedChanges.value, true)

  assert.equal(await p.submitTask(), true)
  await nextTick()
  assert.equal(p.requests[0].payload.scan_profile, 'port_only')
  assert.equal(p.scanProfile.value, 'port_only')
  assert.equal(p.hasUnsavedChanges.value, false)
})

test('a scoped form with multiple allowed profiles starts at its clean default', () => {
  const p = page({
    role: 2, legacy_user: false, max_priority: 1, profiles: ['udp_inventory', 'vulnerability_scan'],
  })
  assert.equal(p.scanProfile.value, 'udp_inventory')
  assert.equal(p.hasUnsavedChanges.value, false)
})

test('changing web enrichment marks the form dirty and submission restores its default', async () => {
  const p = page({
    role: 2, legacy_user: false, max_priority: 1, profiles: ['service_inventory'],
  })
  p.webContentEnabled.value = false
  assert.equal(p.hasUnsavedChanges.value, true)

  p.targetInput.value = '192.0.2.1'
  await nextTick()
  p.port.value = '443'
  p.scannerIds.value = ['permitted-scanner']
  assert.equal(await p.submitTask(), true)
  await nextTick()

  assert.equal(p.requests[0].payload.web_content_enabled, false)
  assert.equal(p.webContentEnabled.value, true)
  assert.equal(p.hasUnsavedChanges.value, false)
})

// Existing business fixtures select Chinese explicitly; locale behavior has its own tests.
function localizedVm(code, context, options) {
  i18n.global.locale.value = 'zh-CN'
  return vm.runInNewContext(code, { tr, ...context }, options)
}
