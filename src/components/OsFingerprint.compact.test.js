import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

test('compact OS summary shows only an identified label or a dash', async () => {
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
    const { default: component } = await server.ssrLoadModule('/src/components/OsFingerprint.vue')
    const render = (props) => renderToString(createSSRApp(component, props))

    const identified = await render({ compact: true, value: {
      status: 'identified', family: 'linux', distribution: 'ubuntu', version: '22.04', confidence: 'medium',
    } })
    assert.match(identified, /Linux · Ubuntu · 22\.04/)
    assert.doesNotMatch(identified, /置信度/) // confidence lives in the hover tooltip, closed at rest
    assert.doesNotMatch(identified, /<details|<summary/)

    for (const value of [
      null,
      { status: 'pending' },
      { status: 'unknown' },
      { status: 'conflict', family: 'linux' },
      { status: 'identified' }, // identified without a family is not displayable
    ]) {
      const html = await render({ value, compact: true })
      assert.match(html, />-</, JSON.stringify(value))
      assert.doesNotMatch(html, /<details|<summary/)
      for (const label of ['未知', '证据冲突', '识别中', '暂无识别结果', '证据可能过期']) {
        assert.doesNotMatch(html, new RegExp(label), `${label} for ${JSON.stringify(value)}`)
      }
    }

    // Regression guard: default mode keeps the evidence triangle and conflict summary.
    const conflict = await render({ value: { status: 'conflict', candidates: [{ family: 'linux', score: 60 }, { family: 'windows', score: 60 }] } })
    const summary = conflict.match(/<summary[^>]*>(.*?)<\/summary>/s)
    assert.ok(summary, 'default mode must keep a <summary>')
    assert.match(summary[1], /证据冲突/)
  } finally {
    await server.close()
  }
})