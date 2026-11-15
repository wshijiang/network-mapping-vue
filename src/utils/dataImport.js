// Pure helpers for the data-import task list and controls. Kept free of Vue/i18n
// so they can be unit tested with `node --test`. Label keys are the Chinese source
// strings passed through tr() by the view (DATA_IMPORT_PLAN.md §6 / §9.3).

export const IMPORT_STATUSES = ['pending', 'validating', 'type_checking', 'importing', 'paused', 'completed', 'error', 'cancelled']
export const ACTIVE_STATUSES = ['pending', 'validating', 'type_checking', 'importing']
export const TERMINAL_STATUSES = ['completed', 'error', 'cancelled']

const STATUS_META = {
  pending: { labelKey: '未开始', badgeClass: 'badge-ghost' },
  validating: { labelKey: '数据完整性校验', badgeClass: 'badge-info' },
  type_checking: { labelKey: '数据类型检查', badgeClass: 'badge-info' },
  importing: { labelKey: '导入中', badgeClass: 'badge-primary' },
  paused: { labelKey: '暂停', badgeClass: 'badge-warning' },
  completed: { labelKey: '已完成', badgeClass: 'badge-success' },
  error: { labelKey: '错误', badgeClass: 'badge-error' },
  cancelled: { labelKey: '已取消', badgeClass: 'badge-neutral' },
}

const UNKNOWN_STATUS = { labelKey: '未知状态', badgeClass: 'badge-ghost' }

export function statusMeta(status) {
  return STATUS_META[status] || UNKNOWN_STATUS
}

export function isActiveStatus(status) {
  return ACTIVE_STATUSES.includes(status)
}

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status)
}

export function canPause(status) {
  return isActiveStatus(status)
}

export function canResume(status) {
  return status === 'paused'
}

export function canCancel(status) {
  return isActiveStatus(status) || status === 'paused' || status === 'error'
}

export function canDelete(status) {
  return isTerminalStatus(status)
}

// processed/total as a 0..100 integer. Returns null when the total is not yet
// known (validating phase) so the UI can show "统计中" instead of a fake bar.
export function progressPercent(processed, total) {
  const totalCount = Number(total)
  if (!Number.isFinite(totalCount) || totalCount <= 0) return null
  const processedCount = Number(processed)
  if (!Number.isFinite(processedCount) || processedCount <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((processedCount / totalCount) * 100)))
}

export function formatCount(value) {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

// Row counters for the task table. total stays null when unknown (vs 0 for an
// empty file) so progress and labels can distinguish the two.
export function formatRowStats(task) {
  const source = task && typeof task === 'object' ? task : {}
  return {
    imported: formatCount(source.imported_rows),
    invalid: formatCount(source.invalid_rows),
    duplicate: formatCount(source.duplicate_rows),
    conflict: formatCount(source.conflict_rows),
    processed: formatCount(source.processed_rows),
    total: source.total_rows === null || source.total_rows === undefined ? null : formatCount(source.total_rows),
  }
}

function positiveLimit(value, fallback) {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : fallback
}

// Validate the optional resume body { batch_size?, concurrency? }. Empty/absent
// fields are omitted (resume without changes). Errors carry an i18n template key
// plus interpolation values so the pure helper never calls tr() itself.
export function validateResumePayload(input = {}, limits = {}) {
  const maxBatch = positiveLimit(limits.max_batch_size, 50000)
  const maxConcurrency = positiveLimit(limits.max_concurrency, 8)
  const source = input && typeof input === 'object' ? input : {}
  const errors = {}
  const payload = {}
  for (const [field, max, key] of [
    ['batch_size', maxBatch, '批次大小需为 1-{0} 的整数'],
    ['concurrency', maxConcurrency, '并发需为 1-{0} 的整数'],
  ]) {
    const raw = source[field]
    if (raw === undefined || raw === null || raw === '') continue
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 1 || value > max) {
      errors[field] = { key, values: [max] }
    } else {
      payload[field] = value
    }
  }
  return { valid: Object.keys(errors).length === 0, errors, payload }
}