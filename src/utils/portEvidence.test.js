import assert from 'node:assert/strict'
import test from 'node:test'
import { evidenceBlocks, httpFields, scalarFields, serviceEnvelope, tlsSummary } from './portEvidence.js'

test('scalarFields keeps scalars and string lists, drops bodies and secrets', () => {
  const fields = scalarFields({
    server_version: '5.7.40-log',
    protocol_version: 10,
    authenticated: false,
    capability_flags: ['CLIENT_SSL', 'CLIENT_TRANSACTIONS'],
    body: '<html>…</html>',
    key_material: { master_secret: 'x' },
    empty: '',
  })
  assert.deepEqual(fields.map((f) => f.key), ['server_version', 'protocol_version', 'authenticated', 'capability_flags'])
  assert.equal(fields.find((f) => f.key === 'capability_flags').kind, 'list')
  assert.equal(fields.find((f) => f.key === 'authenticated').value, false)
})

test('httpFields curates status, request and headers without the body', () => {
  const fields = httpFields({
    status_line: '200 OK',
    protocol: 'HTTP/2.0',
    content_length: -1,
    body_truncated: true,
    body: '<html>…</html>',
    headers: { server: 'nginx', content_type: 'text/html' },
    request: { method: 'GET', url: 'https://example.invalid/' },
  })
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f.value]))
  assert.equal(byKey.status_line, '200 OK')
  assert.equal(byKey.request, 'GET https://example.invalid/')
  assert.equal(byKey.server, 'nginx')
  assert.equal(byKey.body_truncated, true)
  assert.equal('content_length' in byKey, false)
  assert.equal('body' in byKey, false)
})

test('tlsSummary finds native and https logs and tolerates missing certificates', () => {
  const native = { data: { evidence: [{ module: 'mysql', result: { tls: { handshake_completed_successfully: true, ja3s: 'abc', handshake_log: { server_hello: { cipher_suite: 'TLS_AES_128_GCM_SHA256', version: 'TLSv1.3' }, server_certificates: [] } } } }] } }
  const summary = tlsSummary(native)
  assert.equal(summary.completed, true)
  assert.equal(summary.ja3s, 'abc')
  assert.deepEqual(summary.helloFields.map((f) => f.key), ['cipher_suite', 'version'])
  assert.deepEqual(summary.certFields, [])
  const https = { data: { evidence: [{ module: 'https', result: { response: { request: { tls_log: { handshake_completed_successfully: false, handshake_log: { server_hello: {}, server_certificates: [{ certificate: { subject: 'CN=example.invalid', self_signed: true }, validation: { verified: false } }] } } } } } }] } }
  const httpsSummary = tlsSummary(https)
  assert.equal(httpsSummary.completed, false)
  assert.equal(httpsSummary.certFields.find((f) => f.key === 'subject').value, 'CN=example.invalid')
  assert.equal(httpsSummary.validationFields.find((f) => f.key === 'verified').value, false)
  assert.equal(tlsSummary({ data: null }), null)
  assert.equal(tlsSummary({}), null)
})

test('evidenceBlocks and serviceEnvelope parse the identification envelope', () => {
  const port = { data: { schema_version: 2, selected_probe: 'mysql', selection_reason: 'protocol_handshake', confidence: 100, attempt_count: 5, evidence: [{ module: 'mysql', result: { server_version: '5.7.40-log' } }, { module: 'http', result: { response: { status_code: 200 } } }, { module: 'x', result: null }] } }
  const blocks = evidenceBlocks(port)
  assert.deepEqual(blocks.map((b) => b.module), ['mysql', 'http'])
  assert.equal(blocks[0].fields[0].value, '5.7.40-log')
  assert.equal(blocks[1].fields[0].key, 'status_line')
  assert.deepEqual(serviceEnvelope(port), { probe: 'mysql', reason: 'protocol_handshake', confidence: 100, attempts: 5 })
  assert.equal(serviceEnvelope({}), null)
})

test('null or empty evidence counters stay unknown instead of becoming zero', () => {
  const envelope = serviceEnvelope({ data: { selected_probe: 'http', confidence: null, attempt_count: null } })
  assert.equal(envelope.confidence, null)
  assert.equal(envelope.attempts, null)
  const empty = serviceEnvelope({ data: { confidence: '', attempt_count: '' } })
  assert.equal(empty.confidence, null)
  assert.equal(empty.attempts, null)
  const zero = serviceEnvelope({ data: { confidence: 0, attempt_count: 0 } })
  assert.equal(zero.confidence, 0)
  assert.equal(zero.attempts, 0)
})