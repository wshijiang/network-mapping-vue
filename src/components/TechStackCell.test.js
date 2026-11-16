import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

test('tech cell shows chips without a badge when they fit, badge only on overflow', async () => {
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
    const { default: component } = await server.ssrLoadModule('/src/components/TechStackCell.vue')
    const render = (props) => renderToString(createSSRApp(component, props))
    const web = { status: 'identified', technologies: [
      { id: 'nginx', name: 'nginx' }, { id: 'jquery', name: 'jQuery' }, { id: 'vue', name: 'Vue' },
      { id: 'react', name: 'React' }, { id: 'bootstrap', name: 'Bootstrap' },
    ] }

    // At rest (no overflow measured in SSR) every chip shows and there is no badge.
    const fit = await render({ web })
    for (const name of ['nginx', 'jQuery', 'Vue', 'React', 'Bootstrap']) assert.match(fit, new RegExp(name))
    assert.match(fit, /nginx\.svg/)
    assert.doesNotMatch(fit, /共5条/)
    assert.doesNotMatch(fit, /badge badge-soft badge-primary/)

    // Forced overflow shows the soft-primary count badge plus the chips; the
    // badge is the tooltip trigger and the full list carries icons.
    const overflow = await render({ web, forceBadge: true })
    assert.match(overflow, /badge badge-soft badge-primary/)
    assert.match(overflow, /共5条/)
    assert.match(overflow, /nginx\.svg/)

    // No technologies renders a bare dash.
    for (const value of [null, { status: 'not_web' }, { status: 'identified', technologies: [] }]) {
      const empty = await render({ web: value })
      assert.match(empty, />-</)
      assert.doesNotMatch(empty, /共0条|badge badge-soft badge-primary/)
    }
  } finally {
    await server.close()
  }
})