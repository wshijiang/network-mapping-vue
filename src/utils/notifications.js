import { tr } from '../i18n/index.js'
export const notificationEvents = [
  { value: 'health.alert', get label() { return tr("健康告警") } },
  { value: 'scanner.offline', get label() { return tr("Scanner 掉线") } },
  { value: 'scanner.recovered', get label() { return tr("Scanner 恢复") } },
  { value: 'user.login', get label() { return tr("用户登录") } },
  { value: 'report.daily', get label() { return tr("日报生成") } },
  { value: 'report.weekly', get label() { return tr("周报生成") } },
  { value: 'report.monthly', get label() { return tr("月报生成") } },
  { value: 'task.completed', get label() { return tr("任务完成") } },
  { value: 'task.failed', get label() { return tr("任务失败") } },
  { value: 'task.cancelled', get label() { return tr("任务取消") } },
]

export const notificationProviders = [{ value: 'email', get label() { return tr("邮件") } }, { value: 'feishu', get label() { return tr("飞书") } }, { value: 'telegram', label: 'Telegram' }]
export function providerLabel(value) { return notificationProviders.find(item => item.value === value)?.label || value }

export const deliveryStatuses = {
  get pending() { return tr("等待投递") }, get sending() { return tr("投递中") }, get sent() { return tr("发送成功") }, get failed() { return tr("发送失败") }, get cancelled() { return tr("已取消") },
}

const reasons = {
  get provider_rejected() { return tr("服务商拒绝请求，请检查渠道凭据、目标和服务商访问限制") },
  get provider_temporarily_unavailable() { return tr("服务商暂时不可用或触发限流") },
  get network_or_tls_error() { return tr("网络或 TLS 连接失败") }, get response_read_failed() { return tr("读取服务商响应失败") },
  get delivery_timeout() { return tr("投递超时") }, get invalid_destination() { return tr("Webhook 地址无效") },
  get secret_unavailable() { return tr("无法解密渠道凭据，请联系管理员检查服务密钥") },
  get signing_failed() { return tr("签名计算失败") }, get payload_too_large() { return tr("消息超过飞书长度限制") },
  get invalid_payload() { return tr("消息格式无效") }, get response_too_large() { return tr("飞书响应超过限制") },
  get channel_changed() { return tr("渠道已修改，旧投递已取消") }, get channel_deleted() { return tr("渠道已删除") },
  get scanner_recovered() { return tr("Scanner 已恢复，取消掉线通知") }, get scanner_deactivated() { return tr("Scanner 已停用") },
  get channel_or_incident_changed() { return tr("渠道订阅或 Scanner 状态已变化") },
  get event_expired() { return tr("事件超过 24 小时，已取消投递") }, get attempts_exhausted() { return tr("已达到最大尝试次数") },
  get smtp_delivery_failed() { return tr("SMTP 投递失败，请检查服务器、密钥及收件人") },
  get proxy_invalid() { return tr("代理配置无效，请重新保存渠道") }, get proxy_authentication_failed() { return tr("代理认证失败，请检查代理用户名和密码") },
  get proxy_connection_failed() { return tr("无法连接代理服务器") }, get proxy_connect_rejected() { return tr("代理拒绝连接目标服务") },
  get proxy_invalid_response() { return tr("代理返回无效响应") }, get proxy_dns_failed() { return tr("代理连接前的目标域名解析失败") },
  get proxy_tls_error() { return tr("代理服务器 TLS 验证失败") }, get smtp_tls_error() { return tr("SMTP 服务器 TLS 验证失败") },
  get smtp_permanent_error() { return tr("SMTP 服务器永久拒绝邮件") }, get smtp_client_error() { return tr("SMTP 认证或请求配置无效") },

  get no_recipients() { return tr("没有有效收件人，请配置邮箱或渠道收件人") },
  get notification_source_unavailable() { return tr("通知数据暂不可用，将重试") },
  get mail_template_disabled() { return tr("对应邮件模板已停用") }, get report_unavailable() { return tr("归档报告邮件不可用") },
  get notification_template_invalid() { return tr("通知模板渲染失败或消息超出平台限制，请检查对应渠道的已发布模板") },
  get feishu_auth_unavailable() { return tr("无法连接飞书应用认证服务") },
  get feishu_auth_failed() { return tr("飞书应用认证失败，请检查应用凭据") },
  get feishu_image_upload_failed() { return tr("飞书图片上传失败，请检查应用权限和网络") },
  get feishu_send_failed() { return tr("飞书应用消息发送失败，请检查机器人权限和接收目标") },
  get report_image_invalid() { return tr("报告趋势图生成失败，请检查归档数据") },
}

export function deliveryReason(value) { return reasons[value] || (value ? tr("投递异常，请检查服务状态") : '—') }

// 全局通知偏好（管理员）：事件产生闸 + 站内通知配置。与后端 NotificationPreferences  camelCase 对齐。
export function defaultNotificationPrefs() {
  return {
    loginNotifyEnabled: true, notifyOnStuck: true, notifyOnComplete: true, notifyOnCancel: false,
    reportDaily: false, reportWeekly: true, reportMonthly: false,
    healthAlertEnabled: true, scannerOfflineEnabled: false, scannerRecoveryEnabled: true,
    inAppEnabled: true, monitorNotifyEnabled: true, monitorUserEnabled: false,
    inboxRetentionDays: 90, inboxMaxPerUser: 2000,
  }
}
export function validateNotificationPrefs(prefs) {
  if (!Number.isInteger(prefs.inboxRetentionDays) || prefs.inboxRetentionDays < 7 || prefs.inboxRetentionDays > 365) return tr("站内通知保留天数须在 7 至 365 之间。")
  if (!Number.isInteger(prefs.inboxMaxPerUser) || prefs.inboxMaxPerUser < 100 || prefs.inboxMaxPerUser > 10000) return tr("每用户站内通知上限须在 100 至 10000 之间。")
  return ''
}
export function eventLabel(value) {
  return value === 'notification.test' ? tr("测试通知") : notificationEvents.find((item) => item.value === value)?.label || value
}
export function channelForm(channel) {
  return {
    id: channel?.id || null, provider: channel?.provider || 'feishu', name: channel?.name || '', enabled: channel?.enabled ?? true,
    event_types: [...(channel?.event_types || notificationEvents.map((item) => item.value))],
    minimum_severity: channel?.minimum_severity || 'warning', webhook_url: '', signing_secret: '',
    clear_signing_secret: false, expected_revision: channel?.revision ?? null,
    signing_secret_configured: channel?.signing_secret_configured || false,
    credential_configured: channel?.credential_configured || false,
    feishu_app_secret_configured: channel?.feishu_app_secret_configured || false,
    original_feishu_target: channel?.settings?.feishu_target_type || 'group',
    original_feishu_app_id: channel?.settings?.feishu_app_id || '',
    feishu_app_secret: '', clear_feishu_app_secret: false,
    bot_token: '', smtp_password: '',
    proxy_mode: channel?.proxy_mode || 'system', proxy_url: '',
    proxy_configured: Boolean(channel?.proxy_configured), proxy_endpoint: channel?.proxy_endpoint || '',

    settings: { smtp_host: channel?.settings?.smtp_host || '', smtp_port: channel?.settings?.smtp_port || 465,
      smtp_sender: channel?.settings?.smtp_sender || '', chat_id: channel?.settings?.chat_id || '', feishu_app_id: channel?.settings?.feishu_app_id || '',
      feishu_bot_type: channel?.settings?.feishu_bot_type || 'webhook', feishu_chat_id: channel?.settings?.feishu_chat_id || '',
      feishu_target_type: channel?.settings?.feishu_target_type || 'group', feishu_open_id: channel?.settings?.feishu_open_id || '',
      recipients: [...(channel?.settings?.recipients || [])] },
    recipients_text: (channel?.settings?.recipients || []).join('\n'),
  }
}
export function channelPayload(form) {
  const appChanged = form.id && form.original_feishu_app_id !== form.settings.feishu_app_id.trim()
  const pendingFeishuUser = form.provider === 'feishu' && form.settings.feishu_bot_type === 'app' && form.settings.feishu_target_type === 'user' && (!form.settings.feishu_open_id.trim() || appChanged)
  return {
    provider: form.provider, name: form.name.trim(), enabled: Boolean(form.enabled) && !pendingFeishuUser, event_types: [...form.event_types],
    minimum_severity: form.minimum_severity, webhook_url: form.settings.feishu_bot_type === 'app' ? '' : form.webhook_url.trim(),
    signing_secret: form.settings.feishu_bot_type === 'app' ? '' : form.signing_secret.trim(), clear_signing_secret: form.settings.feishu_bot_type === 'app' ? false : Boolean(form.clear_signing_secret),
    feishu_app_secret: form.provider === 'feishu' ? form.feishu_app_secret : '', clear_feishu_app_secret: Boolean(form.clear_feishu_app_secret),
    expected_revision: form.expected_revision,
    bot_token: form.provider === 'telegram' ? form.bot_token.trim() : '',
    smtp_password: form.provider === 'email' ? form.smtp_password : '',
    proxy_mode: form.proxy_mode, proxy_url: form.proxy_mode === 'custom' ? form.proxy_url.trim() : '',

    settings: { ...form.settings, smtp_host: form.settings.smtp_host.trim(), smtp_sender: form.settings.smtp_sender.trim(),
      smtp_port: Number(form.settings.smtp_port), chat_id: form.settings.chat_id.trim(), feishu_app_id: (form.settings.feishu_app_id || '').trim(),
      feishu_bot_type: form.provider === 'feishu' && form.settings.feishu_bot_type === 'app' ? 'app' : '',
      feishu_target_type: form.provider === 'feishu' && form.settings.feishu_bot_type === 'app' ? form.settings.feishu_target_type : null,
      feishu_chat_id: form.provider === 'feishu' && form.settings.feishu_bot_type === 'app' && form.settings.feishu_target_type === 'group' ? (form.settings.feishu_chat_id || '').trim() : '',
      feishu_open_id: form.provider === 'feishu' && form.settings.feishu_bot_type === 'app' && form.settings.feishu_target_type === 'user' && !appChanged ? (form.settings.feishu_open_id || '').trim() : '',
      recipients: [...new Set(form.recipients_text.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean))] },
  }
}
export function validateChannel(form) {
  if (!['info', 'warning', 'critical'].includes(form.minimum_severity)) return tr("请选择有效的最低通知级别。")
  if (!['system', 'direct', 'custom'].includes(form.proxy_mode)) return tr("请选择有效的代理模式。")
  if (form.proxy_mode === 'custom' && (form.proxy_url || !form.proxy_configured)) {
    try {
      const value = form.proxy_url.trim(), url = new URL(value)
      if (value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value) || !['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol)
        || !url.hostname || (url.protocol.startsWith('socks') && (url.username || url.password) && (!url.username || !url.password)) || (url.port === '0') || (url.protocol.startsWith('socks') && !url.port)
        || !['', '/'].includes(url.pathname) || url.search || url.hash) throw new Error()
      for (const credential of [url.username, url.password]) {
        const decoded = decodeURIComponent(credential)
        if (new TextEncoder().encode(decoded).length > 255 || /[\u0000-\u001f\u007f]/.test(decoded)) throw new Error()
      }
    } catch { return tr("请输入完整 HTTP、HTTPS、SOCKS5 或 SOCKS5H 代理地址，不含路径、查询或片段。") }
  }

  if (!form.name.trim() || [...form.name.trim()].length > 80) return tr("请输入 1 至 80 个字符的渠道名称。")
  if (!form.id && !form.event_types.length) return tr("请至少选择一种通知事件。")
  if (form.provider === 'email') {
    const s = channelPayload(form).settings
    if (!s.smtp_host || s.smtp_host.length > 253 || /[\s/\\:@?#]/.test(s.smtp_host)) return tr("请输入 SMTP 服务器域名。")
    if (!Number.isInteger(s.smtp_port) || s.smtp_port < 1 || s.smtp_port > 65535) return tr("SMTP 端口须在 1 至 65535 之间。")
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.smtp_sender)) return tr("请输入有效的发件人邮箱。")
    if ((!form.id || !form.credential_configured) && !form.smtp_password) return tr("首次配置须填写发件邮箱密钥。")
    if (s.recipients.length > 32 || s.recipients.some(value => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) return tr("请填写有效的收件人邮箱，最多 32 个。")
    return ''
  }
  if (form.provider === 'telegram') {
    if ((!form.id || form.bot_token.trim()) && !/^\d{1,20}:[A-Za-z0-9_-]{20,128}$/.test(form.bot_token.trim())) return tr("请输入有效的 Telegram Bot Token。")
    const chat = form.settings.chat_id.trim()
    if (!/^-?[1-9]\d{0,18}$/.test(chat) && !/^@[A-Za-z0-9_]{5,32}$/.test(chat)) return tr("请输入数字 Chat ID 或公开频道 @名称。")
    return ''
  }
  if (form.provider !== 'feishu') return tr("请选择支持的通知渠道类型。")
  if (!['webhook', 'app'].includes(form.settings.feishu_bot_type)) return tr("请选择飞书机器人类型。")
  if (form.settings.feishu_bot_type === 'app') {
    const type = form.settings.feishu_target_type
    const target = type === 'group' ? form.settings.feishu_chat_id.trim() : (form.settings.feishu_open_id || '').trim()
    const pendingUser = type === 'user' && !target
    if (pendingUser && form.id && form.original_feishu_target === 'group') return tr("请在渠道列表点击“绑定个人”，绑定成功后自动切换目标。")
    if (!['group', 'user'].includes(type) || !form.settings.feishu_app_id.trim() || (!target && !pendingUser) || /[\s\u0000-\u001f\u007f]/.test(target) || new TextEncoder().encode(target).length > 128 || (type === 'user' && !pendingUser && (!target.startsWith('ou_') || target.length <= 3)) || form.clear_feishu_app_secret || (!form.feishu_app_secret && !form.feishu_app_secret_configured)) return tr("应用机器人须填写应用 ID、密钥和有效的接收目标。")
    return ''
  }
  if (!form.id || form.webhook_url.trim()) {
    try {
      const url = new URL(form.webhook_url.trim())
      if (url.protocol !== 'https:' || url.hostname !== 'open.feishu.cn' || (url.port && url.port !== '443')
        || url.username || url.password || url.search || url.hash
        || !/^\/open-apis\/bot\/v2\/hook\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.pathname)) throw new Error()
    } catch { return tr("请输入飞书自定义机器人的完整 HTTPS Webhook 地址。") }
  }
  if (form.clear_signing_secret && form.signing_secret.trim()) return tr("请在填写新密钥和清除旧密钥之间选择一项。")
  const appId = (form.settings.feishu_app_id || '').trim()
  const appSecret = form.feishu_app_secret || ''
  if (form.clear_feishu_app_secret && (appId || appSecret)) return tr("清除飞书应用密钥时请同时清空应用 ID。")
  if (Boolean(appId) !== Boolean(appSecret || (form.feishu_app_secret_configured && !form.clear_feishu_app_secret))) return tr("飞书应用 ID 与密钥须同时配置。")
  return ''
}
