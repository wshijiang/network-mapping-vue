import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

test('Web evidence renders safely and partial results retain their limits', async () => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../../', import.meta.url)),
    plugins: [vue()],
    resolve: { alias: { '@': fileURLToPath(new URL('../', import.meta.url)) } },
    server: { middlewareMode: true, hmr: false },
    logLevel: 'silent',
  })
  try {
    const { i18n } = await server.ssrLoadModule('/src/i18n/index.js')
    i18n.global.locale.value = 'zh-CN'
    const { default: component } = await server.ssrLoadModule('/src/components/WebTechnologies.vue')
    const value = {
      status: 'partial', truncated: true, observed_at: 1000, stale: true, ruleset_version: 'fixture',
      technologies: [{ id: 'jquery', name: 'jQuery', version_conflict: true, confidence: 'high', usage: 'referenced_resource', evidence: [{ module: 'https', rule_id: 'fixture', field_path: '/body', excerpt: '<img src=x onerror=alert(1)>' }] }],
    }
    const html = await renderToString(createSSRApp(component, { value }))
    assert.match(html, /jQuery（版本冲突）/)
    assert.match(html, /证据不完整/)
    assert.match(html, /证据可能过期/)
    assert.match(html, /页面引用资源/)
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
    assert.match(html, /<img[^>]+src="\/assets\/web-technologies\/jquery\.svg"[^>]+alt(?:="")?[^>]+aria-hidden="true"/)
    assert.doesNotMatch(html, /<img src=x/)
    assert.ok(html.indexOf('jquery.svg') < html.indexOf('jQuery（版本冲突）'))
    const unknown = await renderToString(createSSRApp(component, { value: {
      status: 'identified', technologies: [{ id: 'https://untrusted.invalid/icon.svg', name: '<Unknown>' }],
    } }))
    assert.match(unknown, /src="\/assets\/web-technologies\/generic\.svg"/)
    assert.match(unknown, /&lt;Unknown&gt;/)
    assert.doesNotMatch(unknown, /untrusted\.invalid/)
    const pending = await renderToString(createSSRApp(component, { value: { ...value, status: 'pending' } }))
    assert.match(pending, /识别中/)
    assert.doesNotMatch(pending, /jQuery/)
    assert.doesNotMatch(pending, /<img/)
    const database = await renderToString(createSSRApp(component, { value: {
      status: 'identified', ruleset_version: '2026-10-22.6',
      technologies: [{ id: 'elasticsearch', name: 'Elasticsearch', category: 'database', version: '8.19.0', confidence: 'high', usage: 'response_marker', evidence: [{ module: 'https', rule_id: 'elasticsearch-root-json', field_path: '/body', excerpt: '<script>untrusted</script>' }] }],
    } }))
    assert.match(database, /Elasticsearch 8\.19\.0/)
    assert.doesNotMatch(database, /数据库/)
    assert.doesNotMatch(database, /badge badge-outline badge-sm/)
    assert.match(database, /elasticsearch\.svg/)
    assert.match(database, /&lt;script&gt;untrusted&lt;\/script&gt;/)
    assert.doesNotMatch(database, /<script>/)
    const databaseConflict = await renderToString(createSSRApp(component, { value: {
      status: 'partial', truncated: true, stale: true,
      technologies: [{ id: 'elasticsearch', name: 'Elasticsearch', category: 'database', version: '8.19.0', version_conflict: true }],
    } }))
    assert.match(databaseConflict, /Elasticsearch（版本冲突）/)
    assert.doesNotMatch(databaseConflict, /8\.19\.0/)
    assert.match(databaseConflict, /证据不完整/)
    assert.match(databaseConflict, /证据可能过期/)
    const empty = await renderToString(createSSRApp(component))
    assert.match(empty, /暂无识别结果/)
  } finally {
    await server.close()
  }
})
