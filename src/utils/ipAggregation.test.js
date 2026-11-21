import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateIpIntel, coveringCidr } from './ipAggregation.js'

test('coveringCidr computes the smallest aligned prefix', () => {
  assert.equal(coveringCidr(['1.252.228.25', '1.252.228.66', '1.252.228.97', '1.252.228.101']), '1.252.228.0/25')
  assert.equal(coveringCidr(['192.0.2.7']), '192.0.2.7/32')
  assert.equal(coveringCidr(['10.0.0.0', '10.0.0.255']), '10.0.0.0/24')
  assert.equal(coveringCidr(['0.0.0.0', '255.255.255.255']), '0.0.0.0/0')
  assert.equal(coveringCidr(['192.0.2.1', '192.0.3.1']), '192.0.2.0/23')
  assert.equal(coveringCidr(['2001:db8::1']), null)
  assert.equal(coveringCidr([]), null)
  assert.equal(coveringCidr(['999.1.1.1']), null)
})

const kr = { asn: '9318', as_org: 'SK Broadband Co Ltd', isp: 'SK Broadband', country_code: 'KR', country_name: 'South Korea', region_name: 'Busan', city_name: 'Buk-gu' }

test('consecutive same-owner IPv4 rows collapse into one CIDR entry', () => {
  const rows = ['1.252.228.25', '1.252.228.66', '1.252.228.97', '1.252.228.101'].map((ip) => ({ ip, ...kr }))
  const entries = aggregateIpIntel(rows)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].cidr, '1.252.228.0/25')
  assert.equal(entries[0].count, 4)
  assert.equal(entries[0].index, 1)
  assert.deepEqual(entries[0].ips, rows.map((row) => row.ip))
  assert.equal(entries[0].asn, 'AS9318')
  assert.equal(entries[0].asOrg, 'SK Broadband Co Ltd')
  assert.equal(entries[0].location, 'South Korea (KR) · Busan · Buk-gu')
})

test('a different attribution or an IPv6 row breaks the run', () => {
  const rows = [
    { ip: '1.252.228.25', ...kr },
    { ip: '1.252.228.66', ...kr, asn: '4134' },
    { ip: '1.252.228.97', ...kr },
    { ip: '2001:db8::1', ...kr },
    { ip: '2001:db8::2', ...kr },
  ]
  const entries = aggregateIpIntel(rows)
  assert.equal(entries.length, 5)
  assert.ok(entries.every((entry) => entry.cidr === null))
  assert.deepEqual(entries.map((entry) => entry.index), [1, 2, 3, 4, 5])
})

test('non-consecutive same-owner rows are not merged across other owners', () => {
  const rows = [
    { ip: '1.252.228.25', ...kr },
    { ip: '192.0.2.1', asn: '4134', as_org: 'Chinanet', country_code: 'CN' },
    { ip: '1.252.228.66', ...kr },
  ]
  const entries = aggregateIpIntel(rows)
  assert.equal(entries.length, 3)
  assert.deepEqual(entries.map((entry) => entry.index), [1, 2, 3])
})

test('empty and missing input produce no entries', () => {
  assert.deepEqual(aggregateIpIntel([]), [])
  assert.deepEqual(aggregateIpIntel(undefined), [])
})