import { DEFAULT_SCAN_PORTS } from './scanDefaults.js'
import { tr } from '../i18n/index.js'
import { isDomainTarget, parseScanTargets } from './scanTargets.js'

export const changeKindLabels = {
  get port_opened() { return tr("端口开放") },
  get port_closed() { return tr("端口关闭") },
  get service_changed() { return tr("服务变化") },
  get title_changed() { return tr("标题变化") },
  get cert_changed() { return tr("证书变化") },
  get cert_expiring() { return tr("证书即将到期") },
  get target_down() { return tr("目标离线") },
  get target_up() { return tr("目标恢复") },
  get dns_changed() { return tr("解析变化") },
}
export function changeKindLabel(value) { return changeKindLabels[value] || value }

export const runStatuses = {
  get pending() { return tr("排队中") },
  get running() { return tr("扫描中") },
  get succeeded() { return tr("已完成") },
  get failed() { return tr("失败") },
  get cancelled() { return tr("已取消") },
  get skipped() { return tr("已跳过") },
}

const skipReasons = {
  get no_scanner() { return tr("没有可用扫描器") },
  get es_unavailable() { return tr("Elasticsearch 不可用，未执行变化比对") },
  get out_of_scope() { return tr("目标不在授权范围") },
}
export function skipReasonLabel(value) { return skipReasons[value] || value || '' }

export const intervalPresets = [
  { value: 3600, get label() { return tr("每小时") } },
  { value: 21600, get label() { return tr("每 6 小时") } },
  { value: 43200, get label() { return tr("每 12 小时") } },
  { value: 86400, get label() { return tr("每天") } },
  { value: 604800, get label() { return tr("每周") } },
]
export function intervalLabel(seconds) {
  return intervalPresets.find(preset => preset.value === seconds)?.label || tr("每 {0} 小时", [Math.round(seconds / 3600)])
}

export const monitorProfiles = [
  { value: 'port_only', get label() { return tr("仅端口") } },
  { value: 'service_inventory', get label() { return tr("服务识别") } },
  { value: 'vulnerability_scan', get label() { return tr("全部") } },
]
export function profileLabel(value) {
  if (value === 'dns_records') return tr("仅 DNS")
  return monitorProfiles.find(profile => profile.value === value)?.label || value
}

export function targetsSummary(rule) {
  const targets = rule?.targets || []
  if (!targets.length) return '—'
  const head = targets.slice(0, 3).join('、')
  return targets.length > 3 ? tr("{0} 等 {1} 个目标", [head, targets.length]) : head
}

export function ruleForm(rule) {
  return {
    id: rule?.id || null,
    name: rule?.name || '',
    target_type: rule?.target_type || 'ip',
    targets_text: (rule?.targets || []).join('\n'),
    ports: rule?.ports || DEFAULT_SCAN_PORTS,
    scan_profile: rule?.scan_profile || 'service_inventory',
    interval_seconds: rule?.interval_seconds ?? 86400,
    recipient_ids: [...(rule?.recipient_ids || [])],
    enabled: rule?.enabled ?? true,
    expected_revision: rule?.revision ?? null,
  }
}

function targetLines(form) {
  return String(form.targets_text || '').split(/[\n,]+/).map(value => value.trim()).filter(Boolean)
}

export function validateRule(form) {
  const name = String(form.name || '').trim()
  if (!name || [...name].length > 80) return tr("请输入 1 至 80 个字符的规则名称。")
  const lines = targetLines(form)
  if (!lines.length) return tr("请输入至少一个监控目标。")
  if (lines.length > 64) return tr("单个规则最多 64 个目标。")
  if (form.target_type === 'domain') {
    const invalid = lines.find(value => !isDomainTarget(value))
    if (invalid) return tr("域名“{0}”格式不合法。", [invalid])
  } else {
    const parsed = parseScanTargets(lines.join('\n'))
    if (!parsed.valid) return parsed.message
    if (parsed.type === 'domain') return tr("IP 规则不能包含域名，请切换目标类型。")
  }
  if (!Number.isInteger(form.interval_seconds) || form.interval_seconds < 3600 || form.interval_seconds > 2592000) return tr("监控周期须在 1 小时至 30 天之间。")
  // 域名规则的扫描模式由界面固定为 dns_records，与 rulePayload 保持一致。
  const effectiveProfile = form.target_type === 'domain' ? 'dns_records' : form.scan_profile
  const profiles = form.target_type === 'domain' ? ['dns_records'] : monitorProfiles.map(profile => profile.value)
  if (!profiles.includes(effectiveProfile)) return tr("请选择有效的扫描模式。")
  return ''
}

export function rulePayload(form) {
  const lines = targetLines(form)
  let targets = lines
  if (form.target_type === 'domain') {
    targets = lines.map(value => value.replace(/\.$/, '').toLowerCase())
  } else {
    const parsed = parseScanTargets(lines.join('\n'))
    if (parsed.valid) targets = parsed.targets
  }
  return {
    name: String(form.name || '').trim(),
    target_type: form.target_type,
    targets,
    ports: form.target_type === 'domain' ? '' : String(form.ports || '').trim(),
    scan_profile: form.target_type === 'domain' ? 'dns_records' : form.scan_profile,
    interval_seconds: Number(form.interval_seconds),
    recipient_ids: [...(form.recipient_ids || [])],
    enabled: Boolean(form.enabled),
    ...(form.id ? { expected_revision: form.expected_revision } : {}),
  }
}

const changeFieldLabels = {
  get service() { return tr("服务") },
  get product() { return tr("产品") },
  get version() { return tr("版本") },
  get title() { return tr("标题") },
  get cert_sha256() { return tr("证书指纹") },
  get not_after() { return tr("证书到期") },
  get addresses() { return tr("解析地址") },
  get port() { return tr("端口") },
}
export function changeFieldLabel(key) { return changeFieldLabels[key] || key }

function displayValue(value) {
  if (value == null) return '—'
  if (Array.isArray(value)) return value.join('、')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function changeDetailRows(detail) {
  const before = detail?.before ?? {}
  const after = detail?.after ?? {}
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  return keys.map(key => ({ key, label: changeFieldLabel(key), before: displayValue(before[key]), after: displayValue(after[key]) }))
}
