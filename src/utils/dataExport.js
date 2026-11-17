// Pure helpers for the data-export task list and the export dialog. Kept free of
// Vue/i18n so they can be unit tested with `node --test`. Label keys are the
// Chinese source strings passed through tr() by the views (DATA_EXPORT_PLAN.md §6).

export const EXPORT_STATUSES = ['pending', 'running', 'completed', 'error', 'cancelled']
export const ACTIVE_STATUSES = ['pending', 'running']
export const TERMINAL_STATUSES = ['completed', 'error', 'cancelled']

const STATUS_META = {
  pending: { labelKey: '未开始', badgeClass: 'badge-ghost' },
  running: { labelKey: '导出中', badgeClass: 'badge-primary' },
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

export function canCancel(status) {
  return isActiveStatus(status)
}

export function canDelete(status) {
  return isTerminalStatus(status)
}

export function canDownload(status) {
  return status === 'completed'
}

// exported/total as a 0..100 integer; null while the total is unknown (CLI-created
// tasks before the worker's first batch) so the UI shows "统计中" not a fake bar.
export function progressPercent(exported, total) {
  const totalCount = Number(total)
  if (!Number.isFinite(totalCount) || totalCount <= 0) return null
  const exportedCount = Number(exported)
  if (!Number.isFinite(exportedCount) || exportedCount <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((exportedCount / totalCount) * 100)))
}

export function formatRowStats(task) {
  const source = task && typeof task === 'object' ? task : {}
  const exported = Number(source.exported_rows)
  return {
    exported: Number.isFinite(exported) && exported > 0 ? Math.floor(exported) : 0,
    total: source.matched_total === null || source.matched_total === undefined ? null : Math.max(0, Math.floor(Number(source.matched_total) || 0)),
  }
}

// Group the backend field catalog for the dialog checkboxes, preserving catalog
// order within each group and first-appearance order across groups.
export function groupFields(catalog) {
  const groups = []
  const byName = new Map()
  for (const field of Array.isArray(catalog) ? catalog : []) {
    if (!field || typeof field.key !== 'string') continue
    const name = field.group || ''
    if (!byName.has(name)) {
      const group = { group: name, fields: [] }
      byName.set(name, group)
      groups.push(group)
    }
    byName.get(name).fields.push(field)
  }
  return groups
}

// Validate the create-task payload. Errors carry i18n template keys plus
// interpolation values so the pure helper never calls tr() itself.
export function validateExportPayload(input = {}, limits = {}) {
  const source = input && typeof input === 'object' ? input : {}
  const errors = {}
  const query = typeof source.query === 'string' ? source.query.trim() : ''
  if (!query) errors.query = { key: '请输入搜索语句', values: [] }
  const scope = source.scope === 'page' ? 'page' : source.scope === 'all' ? 'all' : null
  if (!scope) errors.scope = { key: '导出范围必须是本页或全部', values: [] }
  const fields = Array.isArray(source.fields) ? source.fields.filter((key) => typeof key === 'string' && key) : []
  if (fields.length === 0) errors.fields = { key: '至少选择一个导出字段', values: [] }
  const payload = { query, scope: scope || 'all', fields }
  if (typeof source.sort_field === 'string' && source.sort_field) payload.sort_field = source.sort_field
  if (typeof source.sort_order === 'string' && source.sort_order) payload.sort_order = source.sort_order
  if (scope === 'page') {
    const offset = Number(source.offset)
    const limit = Number(source.limit)
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100 || offset + limit > 10000) {
      errors.window = { key: '本页导出要求 offset ≥ 0、limit 1-100 且 offset + limit ≤ 10000', values: [] }
    } else {
      payload.offset = offset
      payload.limit = limit
    }
  }
  const maxRows = Number(limits.max_rows)
  if (scope === 'all' && Number.isFinite(maxRows) && maxRows > 0 && Number.isFinite(Number(source.matched_total)) && Number(source.matched_total) > maxRows) {
    errors.matched = { key: '匹配 {0} 条，超过单任务导出上限 {1} 条，请缩小查询范围', values: [Number(source.matched_total), maxRows] }
  }
  return { valid: Object.keys(errors).length === 0, errors, payload }
}