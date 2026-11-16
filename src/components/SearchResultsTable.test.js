import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

test('search results table renders fixed columns, compact cells and the tech badge', async () => {
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
    const { applyTimeSettings } = await server.ssrLoadModule('/src/utils/systemTime.js')
    applyTimeSettings({ revision: 1, document: { timezone: 'Asia/Shanghai', hourCycle: '24', dateFormat: 'YYYY-MM-DD' } })
    const { default: component } = await server.ssrLoadModule('/src/components/SearchResultsTable.vue')

    const items = [
      {
        ip_address: '192.168.1.10', port: 443, protocol: 'tcp', service: 'https', banner: 'nginx/1.25.3',
        os: { status: 'identified', family: 'linux', distribution: 'ubuntu', confidence: 'medium' },
        web: { status: 'identified', technologies: [
          { id: 'nginx', name: 'nginx' }, { id: 'jquery', name: 'jQuery' }, { id: 'vue', name: 'Vue' },
          { id: 'react', name: 'React' }, { id: 'bootstrap', name: 'Bootstrap' },
        ] },
        title: 'Example Domain', tls_version: 'TLSv1.3', tls_subject: 'CN=example.invalid',
        asn: 'AS4134', as_org: 'Chinanet', country_name: '中国', country_code: 'CN',
        scan_time: '2026-01-15T01:00:00Z', tags: [], intel: null,
      },
      {
        ip_address: '2001:db8::1', port: 80, protocol: 'tcp', service: 'http',
        os: { status: 'unknown' }, web: { status: 'not_web' }, scan_time: '2026-01-15T01:00:00Z', tags: [],
      },
    ]
    const html = await renderToString(createSSRApp(component, { items }))

    // Eleven fixed columns and eleven sortable headers.
    assert.equal((html.match(/<col /g) || []).length, 11)
    assert.equal((html.match(/aria-sort=/g) || []).length, 11)
    assert.match(html, /table-fixed/)

    // Tech chips render fully with icons. The "共N条" badge only appears when the
    // chips overflow the column, so at rest (SSR) it is absent.
    assert.match(html, /nginx\.svg/)
    for (const name of ['nginx', 'jQuery', 'Vue', 'React', 'Bootstrap']) assert.match(html, new RegExp(name))
    assert.doesNotMatch(html, /共5条/)
    assert.doesNotMatch(html, /badge badge-soft badge-primary/)

    // Compact OS shows the identified label; unknown OS and non-web tech show a dash.
    assert.match(html, /Linux · Ubuntu/)
    assert.doesNotMatch(html, /<details|<summary/)
    assert.doesNotMatch(html, /未识别到组件|非 Web 服务|未知|暂无识别结果/)

    // Scan time is date-only with a short UTC offset badge naming the IANA zone
    // through a daisyUI tooltip.
    assert.match(html, /2026-01-15/)
    assert.match(html, /UTC\+8/)
    assert.match(html, /data-tip="Asia\/Shanghai"/)
    assert.doesNotMatch(html, /09:00:00/)

    // IPv4 stays a full link; the IPv6 address is exposed via a daisyUI tooltip.
    assert.match(html, /192\.168\.1\.10/)
    assert.match(html, /data-tip="2001:db8::1"/)
    assert.match(html, /tooltip tooltip-bottom/)

    // Column header renamed from "Web 技术栈" to "技术栈".
    assert.match(html, /技术栈/)
    assert.doesNotMatch(html, /Web 技术栈/)
  } finally {
    await server.close()
  }
})