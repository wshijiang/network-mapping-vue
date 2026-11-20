import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

test('AssetFavicon serves stored bytes through the relay and hides without a port', async () => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../../', import.meta.url)),
    plugins: [vue()],
    resolve: { alias: { '@': fileURLToPath(new URL('../', import.meta.url)) } },
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'silent',
  })
  try {
    const { i18n } = await server.ssrLoadModule('/src/i18n/index.js')
    i18n.global.locale.value = 'zh-CN'
    const { default: component } = await server.ssrLoadModule('/src/components/AssetFavicon.vue')
    const render = (props) => renderToString(createSSRApp(component, props))

    const html = await render({
      ip: '192.0.2.10', port: 8443, protocol: 'tcp',
      iconMd5: '22eeab765346f14faf564a4709f98548', size: 16,
    })
    assert.match(html, /<img/)
    assert.match(html, /\/api\/assets\/favicon\?ip=192\.0\.2\.10/)
    assert.match(html, /port=8443/)
    assert.match(html, /protocol=tcp/)
    assert.match(html, /loading="lazy"/)

    // No port (asset-level context without an endpoint) renders nothing.
    const empty = await render({ ip: '192.0.2.10', port: null })
    assert.doesNotMatch(empty, /<img/)

    // IPv6 and missing protocol stay valid query strings.
    const ipv6 = await render({ ip: '2001:db8::1', port: 443 })
    assert.match(ipv6, /ip=2001%3Adb8%3A%3A1/)
    assert.doesNotMatch(ipv6, /protocol=/)
  } finally {
    await server.close()
  }
})
