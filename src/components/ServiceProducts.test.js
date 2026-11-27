import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

test('service products preserve protocol labels and render candidates with scoped evidence', async () => {
  const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../../', import.meta.url)), plugins: [vue()], resolve: { alias: { '@': fileURLToPath(new URL('../', import.meta.url)) } }, server: { middlewareMode: true, hmr: false }, logLevel: 'silent' })
  try {
    const { i18n } = await server.ssrLoadModule('/src/i18n/index.js')
    i18n.global.locale.value = 'zh-CN'
    const { default: component } = await server.ssrLoadModule('/src/components/ServiceProducts.vue')
    const { default: service } = await server.ssrLoadModule('/src/components/ServiceLabel.vue')
    const products = [{ id: 'cobalt_strike', name: 'Cobalt Strike', component: 'Team Server', assessment: 'suspected', evidence: [{ probe: 'tls', rule_id: 'certificate', field_path: '/evidence/0/result', details: [['subject_dn', '<img src=x onerror=alert(1)>']], source_url: 'javascript:alert(1)' }] }]
    const identification = { status: 'suspected', coverage: 'partial', stale: true, observed_at: 1234, ruleset_revision: 1 }
    const html = await renderToString(createSSRApp(component, { products, identification }))
    assert.match(html, /疑似产品/)
    assert.match(html, /采集证据不完整/)
    assert.match(html, /证据可能过期/)
    assert.match(html, /尚未确认服务角色或恶意用途/)
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
    assert.doesNotMatch(html, /<img|href="javascript:/)
    assert.match(html, /\/evidence\/0\/result/)
    const label = await renderToString(createSSRApp(service, { service: 'https', products, identification }))
    assert.match(label, /https/i)
    assert.match(label, /Cobalt Strike/)
    assert.match(label, /疑似/)
    assert.match(label, /证据可能过期/)
    assert.doesNotMatch(label, /badge-error/)
    const old = await renderToString(createSSRApp(service, { service: 'https' }))
    assert.doesNotMatch(old, /Cobalt Strike/)
    const empty = await renderToString(createSSRApp(component, { products: [], identification: { ...identification, status: 'not_matched' } }))
    assert.match(empty, /未匹配已收录的产品规则/)
    assert.doesNotMatch(empty, /目标正常/)
    i18n.global.locale.value = 'en'
    const english = await renderToString(createSSRApp(component, { products, identification }))
    assert.match(english, /Suspected product/)
  } finally { await server.close() }
})
