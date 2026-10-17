import test from 'node:test'
import assert from 'node:assert/strict'
import { osLabel, osConfidence, osCsvHeaders, osCsvValues } from './osDetection.js'

test('pending and conflicting evidence are not displayed as an identified system', () => {
  for (const [status, label] of [['pending', '识别中'], ['conflict', '证据冲突'], ['unknown', '未知']]) {
    const os = { status, family: 'windows', confidence: 'high' }
    assert.equal(osLabel(os), label)
    assert.equal(osConfidence(os), '')
    assert.deepEqual(osCsvValues(os, String).slice(0, 3), ['', '', ''])
  }
})

test('old servers and unscanned endpoints have an explicit empty state', () => {
  assert.equal(osLabel(null), '暂无识别结果')
  assert.equal(osCsvValues(null, String).length, osCsvHeaders.length)
  assert.ok(osCsvValues(null, String).every((value) => value === ''))
})

test('exports retain evidence time, scope and staleness independently of labels', () => {
  const os = { status: 'identified', family: 'linux', distribution: 'ubuntu', version: null, confidence: 'medium', inference_scope: 'service_environment', observed_at: 123, stale: true }
  assert.equal(osLabel(os), 'Linux · Ubuntu')
  assert.equal(osConfidence(os), '中')
  assert.deepEqual(osCsvValues(os, (time) => `time:${time}`), ['linux', 'ubuntu', '', 'identified', 'medium', 'service_environment', 'time:123', '是'])
})
