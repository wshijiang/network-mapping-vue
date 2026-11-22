import { tr } from '../i18n/index.js'

export const inboxCategories = [
  { value: 'task', get label() { return tr("任务") } },
  { value: 'monitor', get label() { return tr("监控") } },
  { value: 'alert', get label() { return tr("告警") } },
  { value: 'security', get label() { return tr("安全") } },
  { value: 'report', get label() { return tr("报告") } },
]

export function inboxCategoryLabel(value) {
  return inboxCategories.find(item => item.value === value)?.label || value
}

export function inboxSeverityClass(severity) {
  if (severity === 'critical') return 'bg-error'
  if (severity === 'warning') return 'bg-warning'
  return 'bg-info'
}

export function unreadBadge(count) {
  return count > 99 ? '99+' : String(count)
}
