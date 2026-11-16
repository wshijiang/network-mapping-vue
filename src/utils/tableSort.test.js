import test from 'node:test'
import assert from 'node:assert/strict'
import { i18n } from '../i18n/index.js'
import { compareItems, ipSortKey, sortKeys } from './tableSort.js'

i18n.global.locale.value = 'zh-CN'

test('ipSortKey orders IPv4 octets and IPv6 groups numerically', () => {
  assert.equal(ipSortKey('192.168.1.9'), '192.168.001.009')
  assert.equal(ipSortKey('::1'), '0000:0000:0000:0000:0000:0000:0000:0001')
  assert.equal(ipSortKey('2001:db8::1'), '2001:0db8:0000:0000:0000:0000:0000:0001')
  assert.ok(ipSortKey('192.168.1.9') < ipSortKey('192.168.1.10'))
  assert.ok(ipSortKey('::1') < ipSortKey('2001:db8::1'))
  assert.ok(ipSortKey('2001:db8::2') < ipSortKey('2001:db8::10'))
  assert.equal(ipSortKey(''), '')
})

test('numeric columns sort by value, not lexicographically', () => {
  const rows = [{ port: 8080 }, { port: 80 }, { port: 443 }]
  const asc = [...rows].sort((a, b) => compareItems('port', 1, a, b)).map((r) => r.port)
  assert.deepEqual(asc, [80, 443, 8080])
  const desc = [...rows].sort((a, b) => compareItems('port', -1, a, b)).map((r) => r.port)
  assert.deepEqual(desc, [8080, 443, 80])
  const times = [{ scan_time: '2026-01-02T00:00:00Z' }, { scan_time: '2026-01-01T00:00:00Z' }]
  assert.deepEqual([...times].sort((a, b) => compareItems('scan_time', 1, a, b)).map((r) => r.scan_time),
    ['2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'])
})

test('missing values sort last in both directions', () => {
  const rows = [{ port: 80 }, { port: null }, { port: 443 }, {}]
  for (const direction of [1, -1]) {
    const sorted = [...rows].sort((a, b) => compareItems('port', direction, a, b))
    assert.equal(sorted[2].port ?? null, null)
    assert.equal(sorted[3].port ?? null, null)
  }
  const ips = [{ ip_address: '10.0.0.2' }, {}, { ip_address: '10.0.0.1' }]
  const sorted = [...ips].sort((a, b) => compareItems('ip', 1, a, b))
  assert.deepEqual(sorted.map((r) => r.ip_address ?? null), ['10.0.0.1', '10.0.0.2', null])
})

test('tech column sorts by count then first name; unidentified rows last', () => {
  const tech = (names) => ({ web: { status: 'identified', technologies: names.map((name, i) => ({ id: `t${i}`, name })) } })
  const rows = [tech(['nginx', 'jquery', 'vue', 'react', 'bootstrap']), tech(['nginx']), { web: { status: 'not_web' } }, tech(['apache', 'php'])]
  const sorted = [...rows].sort((a, b) => compareItems('tech', 1, a, b))
  assert.equal(sortKeys.tech(sorted[0]).startsWith('0001'), true) // 1 tech
  assert.equal(sortKeys.tech(sorted[1]).startsWith('0002'), true) // 2 techs
  assert.equal(sortKeys.tech(sorted[2]).startsWith('0005'), true) // 5 techs
  assert.equal(sortKeys.tech(sorted[3]), null) // not_web last
})

test('ASN sorts numerically ignoring the AS prefix', () => {
  const rows = [{ asn: 'AS4134' }, { asn: 'AS13335' }, { asn: '9808' }]
  const sorted = [...rows].sort((a, b) => compareItems('asn', 1, a, b))
  assert.deepEqual(sorted.map((r) => r.asn), ['AS4134', '9808', 'AS13335'])
})

test('unknown column key is a no-op comparator', () => {
  assert.equal(compareItems('nope', 1, { port: 1 }, { port: 2 }), 0)
})