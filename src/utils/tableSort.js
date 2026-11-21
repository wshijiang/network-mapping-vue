// Pure client-side sort helpers for the current search-results page.
// Missing values always sort last, independent of the sort direction.
import { osLabel } from './osDetection.js'
import { technologyLabel } from './webDetection.js'
import { formatLocation } from './location.js'
import { serviceLabel } from './serviceDetection.js'

// Lexicographic key that orders IP addresses numerically. IPv4 octets are
// zero-padded to 3 digits; IPv6 groups are expanded ("::") and padded to 4 hex
// digits so string comparison matches numeric order.
export function ipSortKey(ip) {
  const text = String(ip ?? '').trim()
  if (!text) return ''
  if (text.includes(':')) {
    const [head = '', tail = ''] = text.split('::')
    const headGroups = head ? head.split(':') : []
    const tailGroups = tail ? tail.split(':') : []
    const missing = Math.max(0, 8 - headGroups.length - tailGroups.length)
    const groups = [...headGroups, ...Array(missing).fill('0'), ...tailGroups]
    return groups.map((group) => group.padStart(4, '0')).join(':')
  }
  return text.split('.').map((octet) => octet.padStart(3, '0')).join('.')
}

function techCount(web) {
  return ['identified', 'partial'].includes(web?.status) && Array.isArray(web?.technologies) ? web.technologies.length : 0
}

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

// Each extractor returns a comparable value, or null when the row has no data
// for that column (null sorts last in both directions).
export const sortKeys = {
  ip: (item) => (item.ip_address ? ipSortKey(item.ip_address) : null),
  port: (item) => (item.port == null || item.port === '' ? null : finiteNumber(item.port)),
  protocol: (item) => item.protocol || null,
  service: (item) => (item.service ? serviceLabel(item.service) : null),
  banner: (item) => item.banner || null,
  os: (item) => (item.os?.status === 'identified' && item.os?.family ? osLabel(item.os) : null),
  tech: (item) => {
    const count = techCount(item.web)
    if (!count) return null
    const first = technologyLabel(item.web.technologies[0]).toLowerCase()
    return `${String(count).padStart(4, '0')}|${first}`
  },
  web: (item) => item.title || item.tls_subject || null,
  asn: (item) => (item.asn ? finiteNumber(String(item.asn).replace(/^AS/i, '')) : null),
  location: (item) => {
    const text = formatLocation(item)
    return text === '-' ? null : text
  },
  scan_time: (item) => {
    if (!item.scan_time) return null
    const time = new Date(item.scan_time).getTime()
    return Number.isFinite(time) ? time : null
  },
  // Asset-detail port columns (millisecond timestamps or ISO strings).
  first_seen_at: (item) => {
    if (item.first_seen_at == null || item.first_seen_at === '') return null
    const time = new Date(item.first_seen_at).getTime()
    return Number.isFinite(time) ? time : null
  },
  last_seen_at: (item) => {
    if (item.last_seen_at == null || item.last_seen_at === '') return null
    const time = new Date(item.last_seen_at).getTime()
    return Number.isFinite(time) ? time : null
  },
  source: (item) => item.source || null,
}

const numericKeys = new Set(['port', 'asn', 'scan_time', 'first_seen_at', 'last_seen_at'])

export function compareValues(key, a, b) {
  if (numericKeys.has(key)) return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

// Direction-aware comparison with null-last semantics. `direction` is 1 (asc)
// or -1 (desc); missing values stay last regardless of direction.
export function compareItems(key, direction, a, b) {
  const extract = sortKeys[key]
  if (!extract) return 0
  const va = extract(a)
  const vb = extract(b)
  if (va == null && vb == null) return 0
  if (va == null) return 1
  if (vb == null) return -1
  return direction * compareValues(key, va, vb)
}