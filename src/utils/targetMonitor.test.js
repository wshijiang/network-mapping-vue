import { i18n } from '../i18n/index.js'
i18n.global.locale.value = 'zh-CN'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  changeDetailRows, changeKindLabel, intervalLabel, intervalPresets, monitorProfiles,
  profileLabel, ruleForm, rulePayload, runStatuses, skipReasonLabel, targetsSummary, validateRule,
} from './targetMonitor.js'

function form(overrides = {}) {
  return { ...ruleForm(), name: '核心网段', targets_text: '192.0.2.0/24', ...overrides }
}

test('change kinds, run statuses, intervals and profiles expose localized labels', () => {
  assert.equal(changeKindLabel('port_opened'), '端口开放')
  assert.equal(changeKindLabel('dns_changed'), '解析变化')
  assert.equal(changeKindLabel('unknown_kind'), 'unknown_kind')
  assert.equal(runStatuses.skipped, '已跳过')
  assert.equal(skipReasonLabel('no_scanner'), '没有可用扫描器')
  assert.equal(skipReasonLabel(''), '')
  assert.deepEqual(intervalPresets.map(preset => preset.value), [3600, 21600, 43200, 86400, 604800])
  assert.equal(intervalLabel(86400), '每天')
  assert.equal(intervalLabel(7200), '每 2 小时')
  assert.equal(profileLabel('dns_records'), '仅 DNS')
  assert.equal(profileLabel('service_inventory'), '服务识别')
  assert.deepEqual(monitorProfiles.map(profile => profile.value), ['port_only', 'service_inventory', 'vulnerability_scan'])
})

test('rule validation enforces name, targets, interval and profile boundaries', () => {
  assert.equal(validateRule(form()), '')
  assert.notEqual(validateRule(form({ name: '' })), '')
  assert.notEqual(validateRule(form({ name: '长'.repeat(81) })), '')
  assert.notEqual(validateRule(form({ targets_text: '' })), '')
  assert.notEqual(validateRule(form({ targets_text: Array.from({ length: 65 }, (_, i) => `192.0.2.${i}`).join('\n') })), '')
  assert.notEqual(validateRule(form({ targets_text: 'not-an-ip' })), '')
  assert.notEqual(validateRule(form({ targets_text: '192.0.2.1\n2001:db8::1' })), '')
  assert.notEqual(validateRule(form({ targets_text: 'example.com' })), '')
  assert.equal(validateRule(form({ target_type: 'domain', targets_text: 'example.com\nsub.example.org' })), '')
  assert.notEqual(validateRule(form({ target_type: 'domain', targets_text: 'bad_domain' })), '')
  assert.notEqual(validateRule(form({ interval_seconds: 3599 })), '')
  assert.equal(validateRule(form({ interval_seconds: 3600 })), '')
  assert.equal(validateRule(form({ interval_seconds: 2592000 })), '')
  assert.notEqual(validateRule(form({ interval_seconds: 2592001 })), '')
  assert.notEqual(validateRule(form({ interval_seconds: 3600.5 })), '')
  assert.notEqual(validateRule(form({ scan_profile: 'bogus' })), '')
  assert.equal(validateRule(form({ target_type: 'domain', targets_text: 'example.com', scan_profile: 'dns_records' })), '')
  // 域名规则忽略残留的 IP profile，界面与 payload 都固定为 dns_records。
  assert.equal(validateRule(form({ target_type: 'domain', targets_text: 'example.com', scan_profile: 'service_inventory' })), '')
})

test('rule payload normalizes targets and pins domain rules to dns_records', () => {
  const created = rulePayload(form({ targets_text: '192.0.2.1, 192.0.2.2' }))
  assert.deepEqual(created.targets, ['192.0.2.1', '192.0.2.2'])
  assert.equal(created.scan_profile, 'service_inventory')
  assert.equal('expected_revision' in created, false)
  const domain = rulePayload(form({ target_type: 'domain', targets_text: 'Example.COM.\nsub.example.org', ports: '443', scan_profile: 'service_inventory' }))
  assert.deepEqual(domain.targets, ['example.com', 'sub.example.org'])
  assert.equal(domain.scan_profile, 'dns_records')
  assert.equal(domain.ports, '')
  const edited = rulePayload(form({ id: 'rule-1', expected_revision: 4 }))
  assert.equal(edited.expected_revision, 4)
})

test('change detail rows union before/after fields and format values', () => {
  const rows = changeDetailRows({ before: { service: 'http', title: '旧' }, after: { service: 'https', version: '1.2' } })
  assert.deepEqual(rows.map(row => row.key), ['service', 'title', 'version'])
  assert.equal(rows[0].before, 'http')
  assert.equal(rows[0].after, 'https')
  assert.equal(rows[1].after, '—')
  const dns = changeDetailRows({ before: { addresses: ['192.0.2.1'] }, after: { addresses: ['192.0.2.1', '192.0.2.2'] } })
  assert.equal(dns[0].label, '解析地址')
  assert.equal(dns[0].after, '192.0.2.1、192.0.2.2')
  assert.deepEqual(changeDetailRows(null), [])
})

test('targets summary truncates long target lists', () => {
  assert.equal(targetsSummary({ targets: ['192.0.2.1'] }), '192.0.2.1')
  assert.equal(targetsSummary({ targets: ['a', 'b', 'c', 'd'] }), 'a、b、c 等 4 个目标')
  assert.equal(targetsSummary(null), '—')
})

test('new monitor rules use task defaults and retain explicit existing ports', () => {
  assert.match(ruleForm().ports, /^1-11000,11211,/)
  assert.ok(ruleForm().ports.endsWith(',62078,64738'))
  assert.equal(ruleForm({ ports: '1-65535' }).ports, '1-65535')
  assert.equal(ruleForm({ ports: '12345' }).ports, '12345')
})
