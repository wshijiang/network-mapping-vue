import { i18n } from '../i18n/index.js'
i18n.global.locale.value = 'zh-CN'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { channelForm, channelPayload, defaultNotificationPrefs, validateChannel, validateNotificationPrefs, deliveryReason } from './notifications.js'

test('editing preserves credentials and copies subscriptions without modifying the channel', () => {
  const original = { id: 'channel', revision: 3, name: '运维', enabled: true, event_types: ['health.alert'], signing_secret_configured: true }
  const form = channelForm(original)
  assert.equal(form.webhook_url, '')
  assert.equal(form.signing_secret, '')
  assert.equal(validateChannel(form), '')
  form.event_types.push('scanner.offline')
  assert.deepEqual(original.event_types, ['health.alert'])
  const payload = channelPayload(form)
  assert.equal(payload.expected_revision, 3)
  assert.equal(payload.signing_secret, '')
  assert.equal('signing_secret_configured' in payload, false)
  assert.equal('id' in payload, false)
})
test('new channels require the fixed Feishu HTTPS endpoint and a subscription', () => {
  const form = channelForm()
  form.name = '运维'
  assert.notEqual(validateChannel(form), '')
  form.webhook_url = 'https://open.feishu.cn/open-apis/bot/v2/hook/00000000-0000-4000-8000-000000000001'
  assert.equal(validateChannel(form), '')
  const good = form.webhook_url
  for (const bad of [good.replace('https:', 'http:'), good.replace('open.feishu.cn', 'evil.example'), `${good}?token=secret`, `${good}#fragment`, good.replace('open.feishu.cn', 'name@open.feishu.cn')]) {
    form.webhook_url = bad
    assert.notEqual(validateChannel(form), '')
  }
  form.webhook_url = good
  form.event_types = []
  assert.notEqual(validateChannel(form), '')
})
test('secret removal is explicit and errors never echo unknown provider text', () => {
  const form = channelForm({ id: 'channel', name: '运维', revision: 1 })
  form.signing_secret = 'replacement'
  form.clear_signing_secret = true
  assert.notEqual(validateChannel(form), '')
  assert.equal(deliveryReason('https://example.invalid/leaked-secret'), '投递异常，请检查服务状态')
})

test('Feishu report app credentials are write-only and require matching app ID', () => {
  const form = channelForm({ id: 'channel', name: 'ops', revision: 1, feishu_app_secret_configured: true, settings: { feishu_app_id: 'cli_example' } })
  assert.equal(validateChannel(form), '')
  assert.equal(channelPayload(form).feishu_app_secret, '')
  assert.equal(channelPayload(form).settings.feishu_app_id, 'cli_example')
  form.clear_feishu_app_secret = true
  assert.notEqual(validateChannel(form), '')
  form.settings.feishu_app_id = ''
  assert.equal(validateChannel(form), '')
  assert.equal(channelPayload(form).clear_feishu_app_secret, true)
})

test('Feishu application bot requires credentials and chat ID without a webhook', () => {
  const form = channelForm()
  form.name = 'ops'
  form.settings.feishu_bot_type = 'app'
  assert.ok(validateChannel(form))
  form.settings.feishu_app_id = 'cli_example'
  form.feishu_app_secret = 'secret'
  form.settings.feishu_chat_id = 'oc_example'
  assert.equal(validateChannel(form), '')
  const payload = channelPayload(form)
  assert.equal(payload.webhook_url, '')
  assert.equal(payload.settings.feishu_bot_type, 'app')
  assert.equal(payload.settings.feishu_chat_id, 'oc_example')
  const existing = channelForm({ id: 'id', provider: 'feishu', name: 'ops', revision: 1, feishu_app_secret_configured: true, settings: payload.settings })
  assert.equal(validateChannel(existing), '')
  assert.equal(channelPayload(existing).feishu_app_secret, '')
  assert.equal(channelForm({ settings: {} }).settings.feishu_bot_type, 'webhook')
})

test('Feishu app switches between a group and a personal recipient without mixing IDs', () => {
  const form = channelForm({ id: 'id', provider: 'feishu', name: 'ops', revision: 1,
    feishu_app_secret_configured: true, settings: { feishu_bot_type: 'app', feishu_app_id: 'cli_app', feishu_chat_id: 'oc_group' } })
  assert.equal(form.settings.feishu_target_type, 'group')
  form.settings.feishu_target_type = 'user'
  assert.ok(validateChannel(form))
  form.settings.feishu_open_id = 'ou_person'
  assert.equal(validateChannel(form), '')
  let payload = channelPayload(form)
  assert.equal(payload.settings.feishu_target_type, 'user')
  assert.equal(payload.settings.feishu_open_id, 'ou_person')
  assert.equal(payload.settings.feishu_chat_id, '')
  form.settings.feishu_target_type = 'group'
  payload = channelPayload(form)
  assert.equal(payload.settings.feishu_target_type, 'group')
  assert.equal(payload.settings.feishu_chat_id, 'oc_group')
  assert.equal(payload.settings.feishu_open_id, '')
  form.settings.feishu_target_type = 'user'
  form.settings.feishu_open_id = 'oc_wrong'
  assert.ok(validateChannel(form))
})

test('email and Telegram share event subscriptions and preserve credentials on edit', () => {
  for (const provider of ['email', 'telegram']) {
    const form = channelForm({ id: 'channel', provider, revision: 2, name: provider, credential_configured: true,
      event_types: ['health.alert', 'user.login', 'report.weekly'],
      settings: { smtp_host: 'smtp.example.com', smtp_port: 465, smtp_sender: 'sender@example.com', recipients: ['ops@example.com'], chat_id: '-1001234567890' } })
    assert.equal(validateChannel(form), '')
    const payload = channelPayload(form)
    assert.equal(payload.provider, provider)
    assert.equal(payload.bot_token, '')
    assert.equal(payload.smtp_password, '')
    assert.deepEqual(payload.event_types, ['health.alert', 'user.login', 'report.weekly'])
    assert.deepEqual(payload.settings.recipients, ['ops@example.com'])
  }
})

test('new provider credentials and destinations are validated before saving', () => {
  const form = channelForm()
  form.name = 'email'
  form.provider = 'email'
  form.settings = { smtp_host: 'smtp.example.com', smtp_port: 465, smtp_sender: 'sender@example.com', recipients: [], chat_id: '' }
  assert.notEqual(validateChannel(form), '')
  form.smtp_password = 'password'
  form.recipients_text = 'one@example.com, two@example.com\none@example.com'
  assert.equal(validateChannel(form), '')
  assert.deepEqual(channelPayload(form).settings.recipients, ['one@example.com', 'two@example.com'])
  form.provider = 'telegram'
  form.bot_token = '123456:abcdefghijklmnopqrstuvwxyz_ABC-123'
  form.settings.chat_id = '-1001234567890'
  assert.equal(validateChannel(form), '')
  form.bot_token += '/other'
  assert.notEqual(validateChannel(form), '')
})

test('proxy credentials are write-only and saved proxies survive normal channel edits', () => {
  const form = channelForm({ id: 'channel', revision: 3, name: 'proxy', proxy_mode: 'custom', proxy_configured: true, proxy_endpoint: 'socks5h://proxy.example.com:1080' })
  assert.equal(form.proxy_url, '')
  assert.equal(validateChannel(form), '')
  assert.equal(channelPayload(form).proxy_url, '')
  assert.equal(channelPayload(form).proxy_mode, 'custom')
  assert.equal('proxy_endpoint' in channelPayload(form), false)
  for (const url of ['http://user:pass@proxy.example.com:8080', 'https://proxy.example.com', 'socks5://proxy.example.com:1080', 'socks5h://proxy.example.com:1080']) {
    form.proxy_url = url
    assert.equal(validateChannel(form), '', url)
  }
  for (const url of ['socks4://proxy.example.com:1080', 'socks5://proxy.example.com', 'http://proxy.example.com/path', 'http://u%0a:pass@proxy.example.com:8080', 'http://proxy.example.com:0']) {
    form.proxy_url = url
    assert.notEqual(validateChannel(form), '', url)
  }
  form.proxy_mode = 'direct'
  assert.equal(channelPayload(form).proxy_url, '')
  assert.equal(validateChannel(form), '')
})

test('task events are subscribable and info severity is validated', () => {
  const form = channelForm()
  assert(form.event_types.includes('task.completed'))
  assert(form.event_types.includes('task.failed'))
  assert(form.event_types.includes('task.cancelled'))
  form.name = '运维'
  form.webhook_url = 'https://open.feishu.cn/open-apis/bot/v2/hook/00000000-0000-4000-8000-000000000001'
  form.minimum_severity = 'info'
  assert.equal(validateChannel(form), '')
  form.minimum_severity = 'debug'
  assert.notEqual(validateChannel(form), '')
})
test('notification preference ranges are enforced', () => {
  const prefs = defaultNotificationPrefs()
  assert.equal(validateNotificationPrefs(prefs), '')
  prefs.inboxRetentionDays = 6
  assert.notEqual(validateNotificationPrefs(prefs), '')
  prefs.inboxRetentionDays = 90
  prefs.inboxMaxPerUser = 99
  assert.notEqual(validateNotificationPrefs(prefs), '')
  prefs.inboxMaxPerUser = 10000
  assert.equal(validateNotificationPrefs(prefs), '')
  prefs.inboxRetentionDays = 90.5
  assert.notEqual(validateNotificationPrefs(prefs), '')
})
