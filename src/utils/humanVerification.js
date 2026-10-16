import { createTurnstileWidget } from './humanVerification/turnstile.js'

const adapters = { turnstile: createTurnstileWidget }

export function parseHumanVerificationConfig(value) {
  if (!value || value.schema_version !== 1 || !Array.isArray(value.actions)) {
    throw new Error('无法读取登录验证配置，请刷新后重试。')
  }
  if (value.provider === 'none' && value.actions.length === 0 && value.widget === null) {
    return { schema_version: 1, provider: 'none', actions: [], widget: null }
  }
  if (value.provider === 'turnstile' && value.actions.length === 1 && value.actions[0] === 'login'
    && typeof value.widget?.site_key === 'string' && value.widget.site_key.trim()) {
    return {
      schema_version: 1, provider: 'turnstile', actions: ['login'],
      widget: { site_key: value.widget.site_key, theme: 'auto', size: 'flexible' },
    }
  }
  throw new Error('当前登录验证配置不受支持，请联系管理员。')
}

export function requiresHumanVerification(config, action = 'login') {
  return config?.provider !== 'none' && config?.actions.includes(action)
}

export function verificationAdapter(config) {
  const adapter = adapters[config?.provider]
  if (!adapter) throw new Error('当前验证服务不受支持。')
  return adapter
}

export function loginProof(config, token) {
  if (!config) throw new Error('请等待登录验证配置加载完成。')
  const policy = parseHumanVerificationConfig(config)
  if (!requiresHumanVerification(policy)) return {}
  if (typeof token !== 'string' || !token.trim()) throw new Error('请先完成人机验证。')
  return { human_verification: { token } }
}
