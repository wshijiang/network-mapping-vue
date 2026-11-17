import test from 'node:test'
import assert from 'node:assert/strict'
import {
  runStatusMeta,
  isRunActive,
  windowLabel,
  quotaSummary,
  validateSourceForm,
  federationMessage,
  originLabel,
  sourceStatusMeta,
  sourceErrorLabel,
  unsupportedReason,
} from './federation.js'

test('run status meta and active detection', () => {
  assert.equal(runStatusMeta('running').labelKey, '联测中')
  assert.equal(runStatusMeta('partial').badgeClass, 'badge-warning')
  assert.equal(runStatusMeta('whatever').labelKey, '未知状态')
  assert.ok(isRunActive('pending'))
  assert.ok(isRunActive('running'))
  assert.ok(!isRunActive('completed'))
})

test('window label follows mode', () => {
  assert.equal(windowLabel({ window_mode: 'none' }, 30), '不指定')
  assert.equal(windowLabel({ window_mode: 'follow', window_days: 7 }, 30), '30 天')
  assert.equal(windowLabel({ window_mode: 'custom', window_days: 7 }, 30), '7 天')
  assert.equal(windowLabel(null, 30), '-')
})

test('quota summary per platform', () => {
  // Hunter API 消耗权益积分：只展示权益积分，免费积分不再参与展示。
  const hunter = quotaSummary('hunter', { rest_free_point: 499, day_free_point: 500, rest_equity_point: 1000, type: '个人账号' })
  assert.equal(hunter.primary, '权益积分 1000')
  assert.ok(!hunter.low)
  assert.deepEqual(hunter.details, [])
  assert.ok(quotaSummary('hunter', { rest_equity_point: 10 }).low)
  assert.equal(quotaSummary('hunter', { rest_free_point: 10 }).primary, '未知')
  const quake = quotaSummary('quake', { credit: 5000, persistent_credit: 1000, role: [{ fullname: '高级会员' }] })
  assert.equal(quake.primary, '月度积分 5000')
  assert.ok(quake.details.includes('高级会员'))
  const fofa = quotaSummary('fofa', { remain_api_query: 49992, remain_api_data: 499398, fofa_point: 49200, vip_level: 12 })
  assert.equal(fofa.primary, 'API 余 49992 次')
  assert.ok(!fofa.low)
  assert.ok(quotaSummary('fofa', { remain_api_query: 5 }).low)
  const shodan = quotaSummary('shodan', { query_credits: 100, plan: 'dev' })
  assert.equal(shodan.primary, 'Credits 100')
  assert.ok(quotaSummary('shodan', { query_credits: 3 }).low)
  assert.equal(quotaSummary('shodan', null).primary, '未知')
  // -1 视为无限制/未知，不误报
  assert.equal(quotaSummary('quake', { credit: -1 }).primary, '未知')
})

test('source form validation', () => {
  const base = {
    kind: 'hunter', name: '测试源', proxy_mode: 'system', fields: ['ip', 'port', 'service'],
    page_size: 100, max_pages: 5, window_mode: 'follow', window_days: 30,
    timeout_seconds: 15, rate_limit_qps: 0.5,
  }
  assert.ok(validateSourceForm(base).valid)
  assert.ok(!validateSourceForm({ ...base, name: '' }).valid)
  assert.ok(!validateSourceForm({ ...base, proxy_mode: 'custom', proxy_url: '' }).valid)
  assert.ok(validateSourceForm({ ...base, proxy_mode: 'custom', proxy_url: '', proxy_configured: true }).valid)
  assert.ok(validateSourceForm({ ...base, proxy_mode: 'custom', proxy_url: 'socks5h://127.0.0.1:1080', proxy_configured: true }).valid)
  assert.ok(!validateSourceForm({ ...base, page_size: 0 }).valid)
  assert.ok(!validateSourceForm({ ...base, window_mode: 'custom', window_days: 61 }).valid)
  assert.ok(validateSourceForm({ ...base, window_mode: 'none', window_days: 61 }).valid) // none 不校验天数
  assert.ok(!validateSourceForm({ ...base, rate_limit_qps: 0 }).valid)
  assert.ok(!validateSourceForm({ ...base, fields: [] }).valid)
})

test('search federation message', () => {
  assert.equal(federationMessage(null), '')
  assert.match(federationMessage({ status: 'pending' }), /排队/)
  assert.match(federationMessage({ status: 'running' }), /联测进行中/)
  assert.match(federationMessage({ status: 'completed', merged_new: 3 }), /新增 3 个端点/)
  assert.match(federationMessage({ status: 'completed', merged_new: 0 }), /无新增/)
  assert.match(federationMessage({ status: 'cached' }), /缓存/)
  assert.match(federationMessage({ status: 'timeout' }), /超时/)
})

test('unsupported is not-query, not error', () => {
  assert.equal(runStatusMeta('unsupported').labelKey, '未查询')
  assert.equal(runStatusMeta('unsupported').badgeClass, 'badge-ghost')
  assert.ok(!isRunActive('unsupported'))
  assert.equal(sourceStatusMeta('unsupported').labelKey, '未查询')
  assert.equal(sourceStatusMeta('completed').labelKey, '已查询')
  assert.equal(sourceStatusMeta('error').badgeClass, 'badge-error')
  assert.match(federationMessage({ status: 'unsupported' }), /未发起联测/)
  assert.equal(unsupportedReason('unsupported: hunter Title NotEq'), 'hunter Title NotEq')
  assert.equal(unsupportedReason(''), '')
})

test('source error codes map to readable labels', () => {
  assert.equal(sourceErrorLabel('auth_failed'), '凭据无效或已过期')
  assert.equal(sourceErrorLabel('rate_limited'), '平台限速，重试后仍失败')
  assert.equal(sourceErrorLabel('unknown_code'), 'unknown_code')
})

test('origin label', () => {
  assert.equal(originLabel({ data_origin: 'federation' }), '联测')
  assert.equal(originLabel({ data_origin: 'merged' }), '本地+联测')
  assert.equal(originLabel({}), '')
})