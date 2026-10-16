const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export function createTurnstileLoader(windowObject, documentObject, timeoutMs = 10000) {
  let pending = null
  const ready = () => ['render', 'reset', 'remove'].every((name) => typeof windowObject.turnstile?.[name] === 'function')
  return function load() {
    if (ready()) return Promise.resolve(windowObject.turnstile)
    if (pending) return pending
    pending = new Promise((resolve, reject) => {
      const script = documentObject.createElement('script')
      let timer
      const cleanup = () => {
        clearTimeout(timer)
        script.onload = null
        script.onerror = null
      }
      const fail = () => {
        cleanup()
        script.remove()
        pending = null
        reject(new Error('验证组件加载失败，请检查网络后重试。'))
      }
      script.src = SCRIPT_URL
      script.async = true
      script.onload = () => {
        if (!ready()) return fail()
        cleanup()
        resolve(windowObject.turnstile)
      }
      script.onerror = fail
      timer = setTimeout(fail, timeoutMs)
      documentObject.head.appendChild(script)
    })
    return pending
  }
}

let loadScript
function loadTurnstile() {
  loadScript ||= createTurnstileLoader(window, document)
  return loadScript()
}

export async function createTurnstileWidget(container, options, events, isActive, load = loadTurnstile) {
  const sdk = await load()
  if (!isActive()) return null
  let removed = false
  let widgetId
  const active = () => !removed && isActive()
  const invalidate = (reason) => {
    if (!active()) return
    events.invalidated(reason)
    if (widgetId !== undefined) sdk.reset(widgetId)
  }
  widgetId = sdk.render(container, {
    sitekey: options.siteKey,
    action: options.action,
    theme: options.theme,
    size: options.size,
    'response-field': false,
    retry: 'never',
    'refresh-expired': 'manual',
    'refresh-timeout': 'manual',
    callback: (token) => { if (active()) events.token(token) },
    'expired-callback': () => invalidate('expired'),
    'timeout-callback': () => invalidate('timeout'),
    'error-callback': () => { if (active()) events.error('验证失败，请重新验证。'); return true },
    'unsupported-callback': () => { if (active()) events.error('当前浏览器无法完成验证，请更换浏览器后重试。') },
  })
  return {
    reset() {
      if (active()) {
        events.invalidated('reset')
        sdk.reset(widgetId)
      }
    },
    remove() {
      if (removed) return
      removed = true
      sdk.remove(widgetId)
    },
  }
}
