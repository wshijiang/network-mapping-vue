import test from 'node:test'
import assert from 'node:assert/strict'
import { automaticProbeOptions, automaticServiceRequirements, nativeEvidence, serviceLabel, supportsRequiredServices } from './serviceDetection.js'
test('service inventory is automatic and UDP requirements follow the transport profile', () => {
  assert.deepEqual(automaticServiceRequirements('service_inventory'), [])
  assert.deepEqual(automaticServiceRequirements('vulnerability_scan'), [])
  assert.deepEqual(automaticServiceRequirements('udp_inventory'), ['dns_udp', 'enip_udp', 'bacnet'])
  // The retired passive profile has no automatic requirements anymore.
  assert.deepEqual(automaticServiceRequirements('udp_passive'), [])
})
test('advanced parameters configure automatic detection without selecting protocols', () => {
  assert.deepEqual(automaticProbeOptions('service_inventory'), {})
  assert.deepEqual(automaticProbeOptions('service_inventory', {
    serverName: ' probe.internal ', dohPath: '/custom-dns', caPem: ' CA ',
    modbusUnitId: 0, s7Tsap: 512, mqttVersion: 5
  }), {server_name: 'probe.internal', tls_ca_pem: 'CA', doh_path: '/custom-dns', modbus_unit_id: 0, s7_tsap: 512, mqtt_version: 5})
  assert.deepEqual(automaticProbeOptions('udp_inventory', {mqttVersion: 5}), {})
  assert.deepEqual(automaticProbeOptions('udp_passive', {}), {})
})
test('explicit native services exclude legacy and partially capable nodes', () => {
  assert.equal(supportsRequiredServices({}, []), true)
  assert.equal(supportsRequiredServices({}, ['dns']), false)
  const node = { scan_capabilities: { service_protocols: ['dns'], max_service_probes: 1 } }
  assert.equal(supportsRequiredServices(node, ['dns']), true)
  assert.equal(supportsRequiredServices(node, ['dns', 'vnc']), false)
})
test('native evidence excludes truncated and unknown schemas', () => {
  const item = { module: 'vnc', result: { protocol_version: '003.008' } }
  assert.equal(nativeEvidence({schema_version: 99, evidence: [item]}).length, 0)
  assert.equal(nativeEvidence({schema_version: 2, evidence: [{...item, truncated: true}]}).length, 0)
  assert.deepEqual(nativeEvidence({schema_version: 2, evidence: [item]}), [item])
  assert.equal(serviceLabel('dns'), 'DNS')
  assert.equal(serviceLabel('ssh'), 'ssh')
})

test('protocol selection respects the advertised probe budget',()=>{assert.equal(supportsRequiredServices({scan_capabilities:{service_protocols:['dns','vnc'],max_service_probes:1}},['dns','vnc']),false);assert.equal(supportsRequiredServices({scan_capabilities:{service_protocols:['dot','doh'],max_service_probes:2}},['dot','doh']),true)})
