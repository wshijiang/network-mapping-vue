import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EXPORT_STATUSES,
  canCancel,
  canDelete,
  canDownload,
  formatRowStats,
  groupFields,
  isActiveStatus,
  isTerminalStatus,
  progressPercent,
  statusMeta,
  validateExportPayload,
} from './dataExport.js'

test('status helpers cover the five export states', () => {
  assert.deepEqual(EXPORT_STATUSES, ['pending', 'running', 'completed', 'error', 'cancelled'])
  for (const status of EXPORT_STATUSES) assert.ok(statusMeta(status).labelKey)
  assert.equal(statusMeta('nope').labelKey, '未知状态')
  assert.ok(isActiveStatus('pending') && isActiveStatus('running'))
  assert.ok(!isActiveStatus('completed'))
  assert.ok(isTerminalStatus('completed') && isTerminalStatus('error') && isTerminalStatus('cancelled'))
  assert.ok(canCancel('running') && !canCancel('completed'))
  assert.ok(canDelete('error') && !canDelete('running'))
  assert.ok(canDownload('completed') && !canDownload('running'))
})

test('progress stays null until the total is known', () => {
  assert.equal(progressPercent(10, null), null)
  assert.equal(progressPercent(10, 0), null)
  assert.equal(progressPercent(0, 100), 0)
  assert.equal(progressPercent(50, 200), 25)
  assert.equal(progressPercent(300, 200), 100)
  assert.deepEqual(formatRowStats({ exported_rows: 5, matched_total: null }), { exported: 5, total: null })
  assert.deepEqual(formatRowStats({ exported_rows: 0, matched_total: 10 }), { exported: 0, total: 10 })
  assert.deepEqual(formatRowStats(null), { exported: 0, total: null })
})

test('groupFields preserves catalog order and skips malformed entries', () => {
  const groups = groupFields([
    { key: 'ip', label: 'IP', group: '基础' },
    { key: 'os_family', label: '系统家族', group: '系统' },
    { key: 'port', label: '端口', group: '基础' },
    null,
    { label: 'no key' },
  ])
  assert.deepEqual(groups.map((g) => g.group), ['基础', '系统'])
  assert.deepEqual(groups[0].fields.map((f) => f.key), ['ip', 'port'])
  assert.deepEqual(groupFields(null), [])
})

test('validateExportPayload accepts a minimal all-scope request', () => {
  const result = validateExportPayload({ query: ' port = 443 ', scope: 'all', fields: ['ip', 'port'] })
  assert.ok(result.valid)
  assert.deepEqual(result.payload, { query: 'port = 443', scope: 'all', fields: ['ip', 'port'] })
})

test('validateExportPayload rejects empty query, bad scope and empty fields', () => {
  const result = validateExportPayload({ query: '  ', scope: 'weird', fields: [] })
  assert.ok(!result.valid)
  assert.ok(result.errors.query && result.errors.scope && result.errors.fields)
})

test('validateExportPayload enforces the page window', () => {
  const base = { query: 'port = 80', scope: 'page', fields: ['ip'] }
  assert.ok(validateExportPayload({ ...base, offset: 0, limit: 50 }).valid)
  assert.ok(validateExportPayload({ ...base, offset: 9950, limit: 50 }).valid)
  assert.ok(!validateExportPayload({ ...base, offset: 9951, limit: 50 }).valid)
  assert.ok(!validateExportPayload({ ...base, offset: -1, limit: 50 }).valid)
  assert.ok(!validateExportPayload({ ...base, offset: 0, limit: 101 }).valid)
  assert.ok(!validateExportPayload({ ...base, offset: 0, limit: 0 }).valid)
  const ok = validateExportPayload({ ...base, offset: 100, limit: 50, sort_field: 'ip', sort_order: 'asc' })
  assert.equal(ok.payload.offset, 100)
  assert.equal(ok.payload.sort_field, 'ip')
})

test('validateExportPayload flags matched totals over the configured cap', () => {
  const base = { query: 'port = 80', scope: 'all', fields: ['ip'], matched_total: 2000000 }
  const result = validateExportPayload(base, { max_rows: 1000000 })
  assert.ok(!result.valid)
  assert.deepEqual(result.errors.matched.values, [2000000, 1000000])
  assert.ok(validateExportPayload({ ...base, matched_total: 10 }, { max_rows: 1000000 }).valid)
  assert.ok(validateExportPayload(base, {}).valid)
})