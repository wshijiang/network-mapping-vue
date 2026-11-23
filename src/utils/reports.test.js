import { i18n } from '../i18n/index.js'
i18n.global.locale.value = 'zh-CN'
import assert from 'node:assert/strict'
import test from 'node:test'
import { csvCell, defaultReportSubscriptions, reportCsv, reportDate, reportPeriodTypes, reportSubscriptionPayload } from './reports.js'

test('CSV cells preserve quotes and prevent spreadsheet formula interpretation', () => {
  assert.equal(csvCell('https "v2"'), '"https ""v2"""')
  for (const value of ['=1+1', '+cmd', '-1+1', '@sum(A1)', '  =1+1', '\tcmd']) {
    assert.ok(csvCell(value).startsWith('"\''))
  }
})

test('export uses archived numbers and includes scope notes', () => {
  const csv = reportCsv({ period_type: 'weekly', revision: 2, period_start: '2026-09-20T16:00:00Z', period_end: '2026-09-27T16:00:00Z',
    payload: { tasks: { created: 12, succeeded: 8, failed: 1, partial: 1, cancelled: 2, success_rate: 80 },
      scan_output: { unique_ips: 3, port_observations: 10, service_observations: 4, ports: [{ name: '443', count: 10 }], services: [{ name: '=1+1', count: 4 }] },
      notes: ['端口观测次数不是资产存量'], trend: [{ day: '2026-09-21', succeeded: 8, failed: 1, partial: 1, cancelled: 2 }] } })
  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.includes('"成功执行发现的去重 IP","3"'))
  assert.ok(csv.includes('"服务","\'=1+1","4"'))
  assert.ok(csv.includes('不是资产存量'))
  assert.ok(csv.includes('"任务成功率（%）","80"'))
})

test('report dates use Shanghai time regardless of the browser timezone', () => {
  assert.equal(reportDate('2026-09-20T16:00:00Z'), '2026-09-21')
  assert.equal(reportDate(null), '-')
  assert.equal(reportDate('invalid'), '-')
})

test('report subscription defaults cover every period and normalize booleans', () => {
  assert.deepEqual(defaultReportSubscriptions(), { daily: false, weekly: false, monthly: false })
  assert.deepEqual(reportPeriodTypes.map(type => type.value), ['daily', 'weekly', 'monthly'])
  assert.deepEqual(reportSubscriptionPayload({ daily: 1, weekly: null, monthly: undefined }), { daily: true, weekly: false, monthly: false })
  assert.deepEqual(reportSubscriptionPayload(undefined), { daily: false, weekly: false, monthly: false })
})
