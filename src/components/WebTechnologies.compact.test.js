import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

test('compact Web summary drops evidence and verbose status labels', async () => {
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
    const render = (props) => renderToString(createSSRApp(component, props))
    const identified = {
      status: 'identified', ruleset_version: 'fixture',
      technologies: [
        { id: 'nginx', name: 'Nginx', version: '1.25.3', confidence: 'high', usage: 'response_marker' },
        { id: 'jquery', name: 'jQuery', version: '3.7.1', confidence: 'high', usage: 'referenced_resource' },
      ],
    }
    const chips = await render({ value: identified, compact: true })
    assert.match(chips, /Nginx 1\.25\.3/)
    assert.match(chips, /jQuery 3\.7\.1/)
    assert.match(chips, /<img[^>]+src="\/assets\/web-technologies\/nginx\.svg"/)
    assert.doesNotMatch(chips, /<details|<summary/)
    assert.doesNotMatch(chips, /置信度|证据时间|规则版本/)

    // Every non-identified shape collapses to a bare dash with no verbose label.
    for (const value of [
      null,
      { status: 'not_web' },
      { status: 'pending' },
      { status: 'unsupported' },
      { status: 'unknown' },
      { status: 'identified', technologies: [] },
      { status: 'partial', technologies: [] },
    ]) {
      const html = await render({ value, compact: true })
      assert.match(html, />-</, JSON.stringify(value))
      for (const label of ['未识别到组件', '非 Web 服务', '暂无识别结果', '识别中', '证据格式暂不支持', '证据不完整', '证据可能过期']) {
        assert.doesNotMatch(html, new RegExp(label), `${label} for ${JSON.stringify(value)}`)
      }
      assert.doesNotMatch(html, /<details|<summary/)
    }

    // The database category badge contract is preserved in compact mode.
    const database = await render({ compact: true, value: {
      status: 'identified', technologies: [{ id: 'elasticsearch', name: 'Elasticsearch', category: 'database', version: '8.19.0' }],
    } })
    assert.match(database, /elasticsearch\.svg/)
    assert.doesNotMatch(database, /数据库/)

    // More than three technologies show the count suffix, still without evidence.
    const many = await render({ compact: true, value: { status: 'identified', technologies: [
      { id: 'nginx', name: 'Nginx' }, { id: 'jquery', name: 'jQuery' }, { id: 'vue', name: 'Vue' },
      { id: 'react', name: 'React' }, { id: 'bootstrap', name: 'Bootstrap' },
    ] } })
    for (const name of ['Nginx', 'jQuery', 'Vue', 'React', 'Bootstrap']) assert.match(many, new RegExp(name))
    assert.doesNotMatch(many, /等/)
    assert.doesNotMatch(many, /<details|<summary/)

    // Regression guard: the default (detail) mode still renders the evidence triangle.
    const detail = await render({ value: identified })
    assert.match(detail, /<details/)
    assert.match(detail, /<summary/)
  } finally {
    await server.close()
  }
})

test('monochrome icons get the dark-mode invert class, colored brands do not', async () => {
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
    const { default: component } = await server.ssrLoadModule('/src/components/WebTechnologies.vue')
    const render = (value) => renderToString(createSSRApp(component, { value, compact: true }))
    const mono = (id, name) => render({ status: 'identified', technologies: [{ id, name }] })

    const express = await mono('express', 'Express')
    assert.match(express, /express\.svg[^>]*class="[^"]*tech-icon-mono/)
    const generic = await mono('totally-unknown', 'Unknown')
    assert.match(generic, /generic\.svg[^>]*class="[^"]*tech-icon-mono/)
    const nginx = await mono('nginx', 'Nginx')
    assert.match(nginx, /nginx\.svg/)
    assert.doesNotMatch(nginx, /tech-icon-mono/)
    // Newly catalogued brands resolve to their own vendored SVG, not the generic.
    const django = await mono('django', 'Django')
    assert.match(django, /django\.svg/)
    assert.doesNotMatch(django, /generic\.svg/)
    const socketio = await mono('socket-io', 'Socket.IO')
    assert.match(socketio, /socket-io\.svg[^>]*class="[^"]*tech-icon-mono/)
  } finally {
    await server.close()
  }
})