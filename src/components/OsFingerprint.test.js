import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

test('system evidence renders as escaped text and conflict summaries remain explicit', async () => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../../', import.meta.url)),
    plugins: [vue()],
    resolve: { alias: { '@': fileURLToPath(new URL('../', import.meta.url)) } },
    server: { middlewareMode: true, hmr: false },
    logLevel: 'silent',
  })
  try {
    const { default: component } = await server.ssrLoadModule('/src/components/OsFingerprint.vue')
    const value = {
      status: 'identified', family: 'linux', confidence: 'medium', inference_scope: 'service_environment',
      observed_at: 1000, stale: true, ruleset_version: 'fixture',
      evidence: [{ port: 2222, module: 'ssh', rule_id: 'fixture', field_path: '/banner', excerpt: '<img src=x onerror=alert(1)>' }],
    }
    const html = await renderToString(createSSRApp(component, { value }))
    assert.match(html, /Linux/)
    assert.match(html, /证据可能过期/)
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
    assert.doesNotMatch(html, /<img/)
    const conflict = await renderToString(createSSRApp(component, { value: { ...value, status: 'conflict', family: 'windows' } }))
    const summary = conflict.match(/<summary[^>]*>(.*?)<\/summary>/s)[1]
    assert.match(summary, /证据冲突/)
    assert.doesNotMatch(summary, /Windows|置信度中/)
    const empty = await renderToString(createSSRApp(component))
    assert.match(empty, /暂无识别结果/)
  } finally {
    await server.close()
  }
})
