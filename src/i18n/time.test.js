import assert from 'node:assert/strict'
import test from 'node:test'
import { i18n } from './index.js'
import { formatRelativeTime } from './time.js'

test('relative time uses minute/hour/day buckets and falls back to absolute time', () => {
  i18n.global.locale.value = 'zh-CN'
  const now = Date.now()
  assert.equal(formatRelativeTime(now - 30_000, now), '刚刚')
  assert.equal(formatRelativeTime(now - 5 * 60_000, now), '5 分钟前')
  assert.equal(formatRelativeTime(now - 3 * 3_600_000, now), '3 小时前')
  assert.equal(formatRelativeTime(now - 2 * 86_400_000, now), '2 天前')
  const absolute = formatRelativeTime(now - 10 * 86_400_000, now)
  assert.ok(absolute && !absolute.endsWith('天前'))
  assert.equal(formatRelativeTime('invalid', now), '—')
  assert.equal(formatRelativeTime(now + 60_000, now), '刚刚')
  i18n.global.locale.value = 'en'
  assert.equal(formatRelativeTime(now - 5 * 60_000, now), '5 min ago')
  i18n.global.locale.value = 'zh-CN'
})
