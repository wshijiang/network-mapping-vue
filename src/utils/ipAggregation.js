// IP intel aggregation: consecutive result rows that share the same ASN,
// organization, ISP and location collapse into the smallest IPv4 CIDR that
// covers them, so a long list of same-owner addresses reads as one network
// segment. IPv6 rows and singletons stay unchanged. Pure helpers, unit-tested.
import { formatLocation } from './location.js'

function ipv4ToNumber(ip) {
  const parts = String(ip ?? '').trim().split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = value * 256 + octet
  }
  return value
}

function numberToIpv4(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.')
}

// Smallest aligned CIDR covering every address. Returns null when any input
// is not IPv4. A single address yields /32; the full space yields /0.
export function coveringCidr(ips) {
  const numbers = ips.map(ipv4ToNumber)
  if (!numbers.length || numbers.some((number) => number === null)) return null
  const min = Math.min(...numbers)
  const max = Math.max(...numbers)
  const diff = (min ^ max) >>> 0
  let bits = 0
  while (bits < 32 && (diff >>> bits) !== 0) bits += 1
  const prefix = 32 - bits
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << bits) >>> 0
  return `${numberToIpv4((min & mask) >>> 0)}/${prefix}`
}

function attributionKey(row) {
  return ['asn', 'as_org', 'isp', 'country_code', 'country_name', 'region_name', 'city_name']
    .map((field) => String(row[field] ?? '').trim())
    .join('|')
}

// rows: raw task result items ({ ip, asn, as_org, isp, country_*, ... }).
// Returns display entries in original order:
// { index, count, cidr, ips, asn, asOrg, location } — cidr is null for
// singletons / IPv6, index is the 1-based position of the first member.
export function aggregateIpIntel(rows) {
  const groups = []
  for (const row of rows || []) {
    const ipv4 = ipv4ToNumber(row.ip) !== null
    const key = attributionKey(row)
    const last = groups[groups.length - 1]
    if (last && last.ipv4 && ipv4 && last.key === key) {
      last.items.push(row)
    } else {
      groups.push({ key, ipv4, items: [row] })
    }
  }
  let index = 1
  return groups.map((group) => {
    const first = group.items[0]
    const entry = {
      index,
      count: group.items.length,
      cidr: group.items.length > 1 ? coveringCidr(group.items.map((item) => item.ip)) : null,
      ips: group.items.map((item) => item.ip),
      asn: first.asn ? (/^AS/i.test(first.asn) ? first.asn : `AS${first.asn}`) : '-',
      asOrg: first.as_org || first.isp || '-',
      location: formatLocation(first),
    }
    index += group.items.length
    return entry
  })
}