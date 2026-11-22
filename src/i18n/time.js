import { locale, tr } from './index.js'
import { formatDateTime as fixedDateTime, formatTime as fixedTime } from '../utils/systemTime.js'

export * from '../utils/systemTime.js'
// Only presentation uses the UI language. Calendar calculations and default
// formatters used by established CSV exports retain their original contract.
export const formatDateTime = (value, timezone) => fixedDateTime(value, timezone, locale.value)
export const formatTime = (value, timezone) => fixedTime(value, timezone, locale.value)

// 站内通知等紧凑列表使用的相对时间；超过 7 天回退到系统时区绝对时间。
export function formatRelativeTime(value, now = Date.now()) {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return '—'
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 60) return tr("刚刚")
  if (seconds < 3600) return tr("{0} 分钟前", [Math.floor(seconds / 60)])
  if (seconds < 86400) return tr("{0} 小时前", [Math.floor(seconds / 3600)])
  if (seconds < 604800) return tr("{0} 天前", [Math.floor(seconds / 86400)])
  return formatDateTime(timestamp)
}
