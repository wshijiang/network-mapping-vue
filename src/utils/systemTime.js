import { reactive } from 'vue'

export const timeSettings = reactive({ timezone: 'Asia/Shanghai', hourCycle: '24', dateFormat: 'YYYY-MM-DD', revision: 0 })

export function applyTimeSettings(data) {
  if (!data?.document || !Number.isInteger(data.revision)) throw new Error('系统时间设置无效')
  const { timezone, hourCycle, dateFormat } = data.document
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format()
  if (!['12', '24'].includes(hourCycle) || !['YYYY-MM-DD', 'YYYY/MM/DD', 'DD/MM/YYYY'].includes(dateFormat)) throw new Error('系统时间格式无效')
  if (data.revision < timeSettings.revision) return
  Object.assign(timeSettings, { timezone, hourCycle, dateFormat, revision: data.revision })
}

function parts(value, timezone = timeSettings.timezone) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map(({ type, value }) => [type, value]))
}

export function calendarDate(value = Date.now(), timezone = timeSettings.timezone) {
  const p = parts(value, timezone)
  return p ? `${p.year}-${p.month}-${p.day}` : ''
}

export function formatDate(value, timezone = timeSettings.timezone) {
  // Calendar dates are labels, not instants; never shift a YYYY-MM-DD string.
  const key = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : calendarDate(value, timezone)
  if (!key) return '-'
  const [year, month, day] = key.split('-')
  if (timeSettings.dateFormat === 'DD/MM/YYYY') return `${day}/${month}/${year}`
  return timeSettings.dateFormat === 'YYYY/MM/DD' ? `${year}/${month}/${day}` : key
}

export function formatTime(value, timezone = timeSettings.timezone, displayLocale = 'zh-CN') {
  if (!parts(value, timezone)) return '-'
  return new Intl.DateTimeFormat(displayLocale, {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: timeSettings.hourCycle === '12' ? 'h12' : 'h23'
  }).format(new Date(value))
}

export function formatDateTime(value, timezone = timeSettings.timezone, displayLocale = 'zh-CN') {
  if (value === null || value === undefined || value === '') return '-'
  if (!parts(value, timezone)) return '-'
  return `${formatDate(value, timezone)} ${formatTime(value, timezone, displayLocale)}`
}

export function localTimeCandidates(value, timezone = timeSettings.timezone) {
  const local = String(value || '').split('@')[0]
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(local)) return []
  const target = new Date(`${local}Z`).getTime()
  if (!Number.isFinite(target)) return []
  const expected = local.length === 16 ? `${local}:00` : local
  const offsets = new Set()
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const instant = target + hours * 3600_000
    const p = parts(instant, timezone)
    offsets.add(new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`).getTime() - instant)
  }
  return [...offsets].map((offset) => ({ timestamp: target - offset, offset }))
    .filter(({ timestamp }) => {
      const p = parts(timestamp, timezone)
      return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}` === expected
    }).sort((a, b) => a.timestamp - b.timestamp)
}

export function localToIso(value, timezone = timeSettings.timezone) {
  const candidates = localTimeCandidates(value, timezone)
  if (!candidates.length) throw new Error(`该时间在 ${timezone} 中不存在，请选择有效时间。`)
  const choice = String(value).split('@')[1]
  const selected = choice ? candidates.find((item) => item.timestamp === Number(choice)) : (candidates.length === 1 ? candidates[0] : null)
  if (!selected) throw new Error('该当地时间出现两次，请选择对应的 UTC 偏移。')
  return new Date(selected.timestamp).toISOString()
}

export function parseSystemDate(value) {
  try { return new Date(localToIso(value)) } catch { return new Date(NaN) }
}

export function toLocalInputValue(value) {
  const p = parts(value)
  if (!p) return ''
  const local = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
  const candidates = localTimeCandidates(local)
  if (candidates.length === 2) {
    const minute = Math.floor(new Date(value).getTime() / 60_000) * 60_000
    return `${local}@${minute}`
  }
  return local
}

export function offsetLabel(offsetMilliseconds) {
  const minutes = Math.abs(Math.round(offsetMilliseconds / 60_000))
  return `UTC${offsetMilliseconds >= 0 ? '+' : '-'}${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

// Short UTC offset label for an instant in a named zone (e.g. "UTC+8",
// "UTC-5", "UTC+5:45"). The offset is evaluated at the given instant so DST
// transitions are respected; whole hours omit the minutes part.
export function timezoneOffsetLabel(value = Date.now(), timezone = timeSettings.timezone) {
  if (value === null || value === undefined || value === '') return ''
  const p = parts(value, timezone)
  if (!p) return ''
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  const offsetMinutes = Math.round((asUtc - new Date(value).getTime()) / 60_000)
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const hours = Math.floor(abs / 60)
  const minutes = abs % 60
  return `UTC${sign}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`
}

export function addCalendarDays(key, days) {
  const date = new Date(`${key}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function mondayDate(value = Date.now()) {
  const key = calendarDate(value)
  const day = new Date(`${key}T12:00:00Z`).getUTCDay()
  return addCalendarDays(key, day === 0 ? -6 : 1 - day)
}

export function calendarMidnight(key) {
  // Calendar boundaries use the first valid local instant, including midnight gaps.
  for (let minute = 0; minute <= 1440; minute++) {
    const local = new Date(new Date(`${key}T00:00:00Z`).getTime() + minute * 60_000).toISOString().slice(0, 16)
    const candidates = localTimeCandidates(local)
    if (candidates.length) return new Date(candidates[0].timestamp).toISOString()
  }
  throw new Error('无法计算所选时区的日期边界')
}
