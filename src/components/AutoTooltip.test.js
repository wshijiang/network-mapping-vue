import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

test('AutoTooltip renders an escaped tooltip panel only when open', async () => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../../', import.meta.url)),
    plugins: [vue()],
    resolve: { alias: { '@': fileURLToPath(new URL('../', import.meta.url)) } },
    server: { middlewareMode: true, hmr: false },
    logLevel: 'silent',
  })
  try {
    const { default: component } = await server.ssrLoadModule('/src/components/AutoTooltip.vue')
    const render = async (props, slots) => {
      const ctx = {}
      const html = await renderToString(createSSRApp({ render: () => h(component, props, slots) }), ctx)
      return { html, panel: ctx.teleports?.body || '' }
    }
    const closed = await render({ content: 'nginx' }, {
      default: () => h('button', { type: 'button' }, 'nginx 共5条'),
    })
    assert.doesNotMatch(closed.html, /role="tooltip"/)
    assert.doesNotMatch(closed.panel, /role="tooltip"/)
    assert.match(closed.html, /nginx 共5条/)

    const open = await render({ content: 'nginx 1.25', open: true }, {
      default: () => h('button', { type: 'button' }, 'nginx 共5条'),
    })
    assert.match(open.panel, /role="tooltip"/)
    assert.match(open.panel, /nginx 1\.25/)

    const slot = await render({ open: true }, {
      default: () => h('button', { type: 'button' }, 'trigger'),
      content: () => h('ul', [h('li', '<script>alert(1)</script>')]),
    })
    assert.match(slot.panel, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    assert.doesNotMatch(slot.panel, /<script>alert/)
  } finally {
    await server.close()
  }
})