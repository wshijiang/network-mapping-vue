// 联测（多源联合查询）前端辅助函数：状态徽标、额度摘要、表单校验、搜索状态文案。

export const RUN_ACTIVE_STATUSES = ['pending', 'running']
export const RUN_TERMINAL_STATUSES = ['completed', 'partial', 'failed', 'cancelled']

const RUN_STATUS_META = {
  pending: { labelKey: '等待执行', badgeClass: 'badge-ghost' },
  running: { labelKey: '联测中', badgeClass: 'badge-info' },
  completed: { labelKey: '已完成', badgeClass: 'badge-success' },
  partial: { labelKey: '部分完成', badgeClass: 'badge-warning' },
  failed: { labelKey: '失败', badgeClass: 'badge-error' },
  cancelled: { labelKey: '已取消', badgeClass: 'badge-neutral' },
}

const UNKNOWN_RUN_STATUS = { labelKey: '未知状态', badgeClass: 'badge-ghost' }

export function runStatusMeta(status) {
  return RUN_STATUS_META[status] || UNKNOWN_RUN_STATUS
}

export function isRunActive(status) {
  return RUN_ACTIVE_STATUSES.includes(status)
}

export const KIND_NAMES = {
  hunter: 'Hunter 鹰图',
  quake: '360 Quake',
  fofa: 'FOFA',
  shodan: 'Shodan',
}

export const FIELD_LABELS = {
  ip: 'IP',
  domain: '域名',
  port: '端口',
  service: '服务',
  tech: 'Web 技术',
  title: '标题',
  banner: 'Banner',
}

export const WINDOW_MODES = [
  { value: 'follow', labelKey: '跟随策略' },
  { value: 'none', labelKey: '不指定（平台默认）' },
  { value: 'custom', labelKey: '单独设置' },
]

export function windowLabel(source, policyWindowDays) {
  if (!source) return '-'
  if (source.window_mode === 'none') return '不指定'
  const days = source.window_mode === 'custom' ? source.window_days : policyWindowDays
  return `${days} 天`
}

// 额度摘要（§11.4）：primary 主数字 + details 明细 + low 低额度告警。
export function quotaSummary(kind, capabilities) {
  if (!capabilities) return { primary: '未知', details: [], low: false, updatedAt: null }
  const num = (value) => (typeof value === 'number' && value >= 0 ? value : null)
  const updatedAt = capabilities.quota_updated_at || null
  let primary = '未知'
  let low = false
  const details = []
  if (kind === 'hunter') {
    const free = num(capabilities.rest_free_point)
    const day = num(capabilities.day_free_point)
    const equity = num(capabilities.rest_equity_point)
    if (free !== null) {
      primary = day !== null ? `今日免费 ${free}/${day}` : `今日免费 ${free}`
      low = free < 50
    }
    if (equity !== null) details.push(`权益积分 ${equity}`)
    if (capabilities.type) details.push(String(capabilities.type))
  } else if (kind === 'quake') {
    const credit = num(capabilities.credit)
    const persistent = num(capabilities.persistent_credit)
    if (credit !== null) {
      primary = `月度积分 ${credit}`
      low = credit < 100
    }
    if (persistent !== null) details.push(`长效积分 ${persistent}`)
    const role = Array.isArray(capabilities.role) ? capabilities.role[0]?.fullname : null
    if (role) details.push(String(role))
    if (capabilities.personal_information_status === false) details.push('未实名')
  } else if (kind === 'fofa') {
    const query = num(capabilities.remain_api_query)
    const data = num(capabilities.remain_api_data)
    const point = num(capabilities.fofa_point)
    if (query !== null) {
      primary = `API 余 ${query} 次`
      low = query < 100
    }
    if (data !== null) details.push(`月度余 ${data} 条`)
    if (point !== null) {
      details.push(`F 点 ${point}`)
      low = low || point < 100
    }
    if (capabilities.vip_level !== undefined) details.push(`VIP ${capabilities.vip_level}`)
  } else if (kind === 'shodan') {
    const credits = num(capabilities.query_credits)
    if (credits !== null) {
      primary = `Credits ${credits}`
      low = credits < 10
    }
    if (capabilities.plan) details.push(String(capabilities.plan))
  }
  return { primary, details, low, updatedAt }
}

// 数据源表单校验（与后端 SourceInput::validate 对齐）。
export function validateSourceForm(form, limits = {}) {
  const errors = []
  const name = (form.name || '').trim()
  if (!name || name.length > 64) errors.push('名称须为 1..64 字符')
  if (!['hunter', 'quake', 'fofa', 'shodan'].includes(form.kind)) errors.push('平台无效')
  if (form.proxy_mode === 'custom' && !(form.proxy_url || '').trim() && !form.proxy_configured) errors.push('自定义代理须填写 URL')
  const fields = form.fields || []
  if (!fields.length) errors.push('至少选择一个字段')
  const pageSize = Number(form.page_size)
  const maxPages = Number(form.max_pages)
  const windowDays = Number(form.window_days)
  const timeout = Number(form.timeout_seconds)
  const qps = Number(form.rate_limit_qps)
  const [psMin, psMax] = limits.page_size || [1, 1000]
  const [mpMin, mpMax] = limits.max_pages || [1, 50]
  const [wdMin, wdMax] = limits.window_days || [1, 60]
  const [toMin, toMax] = limits.timeout_seconds || [3, 120]
  if (!Number.isInteger(pageSize) || pageSize < psMin || pageSize > psMax) errors.push(`每页条数须在 ${psMin}..${psMax}`)
  if (!Number.isInteger(maxPages) || maxPages < mpMin || maxPages > mpMax) errors.push(`最大页数须在 ${mpMin}..${mpMax}`)
  if (form.window_mode === 'custom' && (!Number.isInteger(windowDays) || windowDays < wdMin || windowDays > wdMax)) {
    errors.push(`时间窗须在 ${wdMin}..${wdMax} 天`)
  }
  if (!Number.isInteger(timeout) || timeout < toMin || timeout > toMax) errors.push(`超时须在 ${toMin}..${toMax} 秒`)
  if (!(qps > 0 && qps <= 10)) errors.push('QPS 须在 (0, 10]')
  return { valid: errors.length === 0, errors }
}

// 搜索页联测状态文案（沿用 generationMessage 模式）。
export function federationMessage(federation) {
  if (!federation) return ''
  const status = federation.status
  if (status === 'running') return '联测进行中，完成后将自动入库…'
  if (status === 'cached') return '联测结果来自冷却缓存'
  if (status === 'completed' || status === 'partial') {
    const added = federation.merged_new || 0
    return added > 0 ? `联测完成，新增 ${added} 个端点` : '联测完成，无新增端点'
  }
  if (status === 'timeout') return '联测等待超时，后台继续执行'
  if (status === 'failed') return '联测失败，请查看联测记录'
  return ''
}

export function originLabel(item) {
  if (item.data_origin === 'federation') return '联测'
  if (item.data_origin === 'merged') return '本地+联测'
  return ''
}