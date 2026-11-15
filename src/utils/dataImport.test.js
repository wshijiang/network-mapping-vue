import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ACTIVE_STATUSES,
  IMPORT_STATUSES,
  TERMINAL_STATUSES,
  canCancel,
  canDelete,
  canPause,
  canResume,
  formatCount,
  formatRowStats,
  isActiveStatus,
  isTerminalStatus,
  progressPercent,
  statusMeta,
  validateResumePayload,
} from './dataImport.js'

test('every import status has label and badge metadata', () => {
  assert.equal(IMPORT_STATUSES.length, 8)
  const expected = {
    pending: ['未开始', 'badge-ghost'],
    validating: ['数据完整性校验', 'badge-info'],
    type_checking: ['数据类型检查', 'badge-info'],
    importing: ['导入中', 'badge-primary'],
    paused: ['暂停', 'badge-warning'],
    completed: ['已完成', 'badge-success'],
    error: ['错误', 'badge-error'],
    cancelled: ['已取消', 'badge-neutral'],
  }
  for (const status of IMPORT_STATUSES) {
    const meta = statusMeta(status)
    assert.equal(meta.labelKey, expected[status][0], status)
    assert.equal(meta.badgeClass, expected[status][1], status)
  }
  assert.deepEqual(statusMeta('nonsense'), { labelKey: '未知状态', badgeClass: 'badge-ghost' })
})

test('active and terminal status sets drive the control visibility', () => {
  assert.deepEqual(ACTIVE_STATUSES, ['pending', 'validating', 'type_checking', 'importing'])
  assert.deepEqual(TERMINAL_STATUSES, ['completed', 'error', 'cancelled'])
  for (const status of ACTIVE_STATUSES) {
    assert.equal(isActiveStatus(status), true, status)
    assert.equal(canPause(status), true, status)
    assert.equal(canCancel(status), true, status)
    assert.equal(canResume(status), false, status)
    assert.equal(canDelete(status), false, status)
  }
  assert.equal(canResume('paused'), true)
  assert.equal(canPause('paused'), false)
  assert.equal(canCancel('paused'), true)
  assert.equal(canDelete('paused'), false)
  assert.equal(isTerminalStatus('completed'), true)
  assert.equal(canDelete('completed'), true)
  assert.equal(canDelete('cancelled'), true)
  assert.equal(canCancel('error'), true)
  assert.equal(canDelete('error'), true)
  assert.equal(canPause('completed'), false)
  assert.equal(canResume('importing'), false)
})

test('progressPercent guards unknown totals and clamps the range', () => {
  assert.equal(progressPercent(50, 100), 50)
  assert.equal(progressPercent(0, 100), 0)
  assert.equal(progressPercent(100, 100), 100)
  assert.equal(progressPercent(150, 100), 100)
  assert.equal(progressPercent(1, 3), 33)
  assert.equal(progressPercent(10, 0), null)
  assert.equal(progressPercent(10, null), null)
  assert.equal(progressPercent(10, undefined), null)
  assert.equal(progressPercent(-5, 100), 0)
  assert.equal(progressPercent(NaN, 100), 0)
  assert.equal(progressPercent('25', '200'), 13)
})

test('formatCount coerces to a non-negative integer', () => {
  assert.equal(formatCount('12'), 12)
  assert.equal(formatCount(1.9), 1)
  assert.equal(formatCount(-3), 0)
  assert.equal(formatCount(null), 0)
  assert.equal(formatCount(undefined), 0)
  assert.equal(formatCount(NaN), 0)
})

test('formatRowStats distinguishes an unknown total from a zero total', () => {
  const stats = formatRowStats({ imported_rows: 10, invalid_rows: 2, duplicate_rows: 3, conflict_rows: 1, processed_rows: 16, total_rows: 100 })
  assert.deepEqual(stats, { imported: 10, invalid: 2, duplicate: 3, conflict: 1, processed: 16, total: 100 })
  assert.equal(formatRowStats({ total_rows: null }).total, null)
  assert.equal(formatRowStats({}).total, null)
  assert.equal(formatRowStats({ total_rows: 0 }).total, 0)
  assert.deepEqual(formatRowStats(null), { imported: 0, invalid: 0, duplicate: 0, conflict: 0, processed: 0, total: null })
})

test('validateResumePayload accepts in-range values and omits empty fields', () => {
  assert.deepEqual(validateResumePayload({ batch_size: 1000, concurrency: 2 }), { valid: true, errors: {}, payload: { batch_size: 1000, concurrency: 2 } })
  assert.deepEqual(validateResumePayload({}), { valid: true, errors: {}, payload: {} })
  assert.deepEqual(validateResumePayload({ batch_size: '', concurrency: null }), { valid: true, errors: {}, payload: {} })
  assert.deepEqual(validateResumePayload({ batch_size: '1000', concurrency: '4' }).payload, { batch_size: 1000, concurrency: 4 })
})

test('validateResumePayload rejects out-of-range and non-integer values', () => {
  assert.equal(validateResumePayload({ batch_size: 0 }).valid, false)
  assert.equal(validateResumePayload({ batch_size: 50001 }).valid, false)
  assert.equal(validateResumePayload({ batch_size: 12.5 }).valid, false)
  assert.equal(validateResumePayload({ concurrency: 0 }).valid, false)
  assert.equal(validateResumePayload({ concurrency: 9 }).valid, false)
  const result = validateResumePayload({ batch_size: 50001, concurrency: 9 })
  assert.deepEqual(result.errors.batch_size, { key: '批次大小需为 1-{0} 的整数', values: [50000] })
  assert.deepEqual(result.errors.concurrency, { key: '并发需为 1-{0} 的整数', values: [8] })
  assert.deepEqual(result.payload, {})
})

test('validateResumePayload honors schema limits and boundary values', () => {
  assert.equal(validateResumePayload({ batch_size: 50000, concurrency: 8 }).valid, true)
  assert.equal(validateResumePayload({ batch_size: 1, concurrency: 1 }).valid, true)
  const limited = validateResumePayload({ batch_size: 101, concurrency: 3 }, { max_batch_size: 100, max_concurrency: 2 })
  assert.equal(limited.valid, false)
  assert.deepEqual(limited.errors.batch_size, { key: '批次大小需为 1-{0} 的整数', values: [100] })
  assert.deepEqual(limited.errors.concurrency, { key: '并发需为 1-{0} 的整数', values: [2] })
})