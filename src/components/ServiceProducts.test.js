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
    const fingerprint = '41d41d41d41d41d41d41d41d41d41da0bfb9dc5a7a50dfa51c2a70be11dda8'
    const methods = [
      { id: 'jarm', name: 'JARM', principle: 'tls_server_response', active_probe: true, additional_probe: true, observed: true },
      { id: 'tls_certificate', name: 'TLS Certificate', principle: 'certificate_metadata', active_probe: true, additional_probe: false, observed: false },
      { id: 'http_fingerprint', name: 'HTTP Fingerprint', principle: 'http_response', active_probe: true, additional_probe: false, observed: false },
      { id: 'protocol_fingerprint', name: 'Protocol Fingerprint', principle: 'application_protocol', active_probe: true, additional_probe: false, observed: false },
    ]
    const jarm = { status: 'success', fingerprint, expected_probes: 10, completed_probes: 10, sni: '<img src=x onerror=alert(1)>' }
    const measured = { ...identification, detection_methods: methods, jarm }
    const jarmHtml = await renderToString(createSSRApp(component, { identification: measured }))
    for (const name of ['JARM', 'TLS Certificate', 'HTTP Fingerprint', 'Protocol Fingerprint']) assert.ok(jarmHtml.includes(name))
    assert.match(jarmHtml, /检测方式与基本原理/)
    assert.match(jarmHtml, /额外握手/)
    assert.match(jarmHtml, /复用已有采集/)
    assert.match(jarmHtml, /不能单独确认 C2 家族/)
    assert.ok(jarmHtml.includes(fingerprint))
    assert.doesNotMatch(jarmHtml, /<img|Cobalt Strike|QakBot/)
    const jarmLabel = await renderToString(createSSRApp(service, { service: 'tls', identification: measured }))
    assert.match(jarmLabel, /JARM/)
    assert.match(jarmLabel, /tls/i)
    const partial = await renderToString(createSSRApp(component, { identification: { ...measured, jarm: { ...jarm, fingerprint: null, status: 'partial', completed_probes: 9 } } }))
    assert.match(partial, /JARM 采集不完整/)
    assert.ok(!partial.includes(fingerprint))
    const rejected = await renderToString(createSSRApp(component, { identification: { ...measured, jarm: { ...jarm, fingerprint: null, status: 'no_response' } } }))
    assert.match(rejected, /未返回可用的 TLS ServerHello/)
    i18n.global.locale.value = 'en'
    const englishMethods = await renderToString(createSSRApp(component, { identification: measured }))
    assert.match(englishMethods, /Detection methods and principles/)
    assert.match(englishMethods, /Additional handshakes/)
    assert.doesNotMatch(englishMethods, /[\u4e00-\u9fff]/)
    i18n.global.locale.value = 'zh-CN'
    const old = await renderToString(createSSRApp(service, { service: 'https' }))
    assert.doesNotMatch(old, /Cobalt Strike/)
    const empty = await renderToString(createSSRApp(component, { products: [], identification: { ...identification, status: 'not_matched' } }))
    assert.match(empty, /未匹配已收录的产品规则/)
    assert.doesNotMatch(empty, /目标正常/)
    i18n.global.locale.value = 'en'
    const english = await renderToString(createSSRApp(component, { products, identification }))
    assert.match(english, /Suspected product/)
    i18n.global.locale.value = 'zh-CN'
    const additions = [
      { id: 'sliver', name: 'Sliver', component: 'Multiplayer', assessment: 'suspected', basis: 'certificate_template', evidence: [] },
      { id: 'qakbot', name: 'QakBot', assessment: 'suspected', basis: 'historical_certificate_heuristic', evidence: [] },
    ]
    const candidates = await renderToString(createSSRApp(component, { products: additions, identification: { ...identification, ruleset_revision: 2 } }))
    assert.match(candidates, /Sliver(?:\s|<!--[\s\S]*?-->)*·(?:\s|<!--[\s\S]*?-->)*Multiplayer/)
    assert.match(candidates, /QakBot/)
    assert.match(candidates, /历史证书启发式/)
    assert.match(candidates, /仅符合历史证书结构，家族归属需复核/)
    assert.doesNotMatch(candidates, /badge-error/)
    const compact = await renderToString(createSSRApp(component, { products: additions, compact: true }))
    assert.match(compact, /QakBot/)
    assert.match(compact, /title="仅符合历史证书结构，家族归属需复核。"/)
    i18n.global.locale.value = 'en'
    const englishHeuristic = await renderToString(createSSRApp(component, { products: additions, identification }))
    assert.match(englishHeuristic, /Historical certificate heuristic/)
  } finally { await server.close() }
})
