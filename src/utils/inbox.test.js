import { i18n } from '../i18n/index.js'
i18n.global.locale.value = 'zh-CN'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inboxCategories, inboxCategoryLabel, inboxSeverityClass, unreadBadge } from './inbox.js'

test('inbox categories cover the five server categories with localized labels', () => {
  assert.deepEqual(inboxCategories.map(item => item.value), ['task', 'monitor', 'alert', 'security', 'report'])
  assert.equal(inboxCategoryLabel('task'), '任务')
  assert.equal(inboxCategoryLabel('unknown'), 'unknown')
  i18n.global.locale.value = 'en'
  assert.equal(inboxCategoryLabel('monitor'), 'Monitor')
  i18n.global.locale.value = 'zh-CN'
})

test('severity dots and unread badges follow the shared presentation rules', () => {
  assert.equal(inboxSeverityClass('critical'), 'bg-error')
  assert.equal(inboxSeverityClass('warning'), 'bg-warning')
  assert.equal(inboxSeverityClass('info'), 'bg-info')
  assert.equal(unreadBadge(0), '0')
  assert.equal(unreadBadge(99), '99')
  assert.equal(unreadBadge(100), '99+')
})
