import { tr, i18n } from '../i18n/index.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, nextTick, ref, shallowRef, useId, watch } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'

const { descriptor } = parse(readFileSync(new URL('./MailTemplateEditor.vue', import.meta.url), 'utf8'))
const compiled = compileScript(descriptor, { id: 'mail-template-navigation' })
const code = compiled.scriptSetupAst.filter(node => node.type === 'ImportDeclaration').reverse()
  .reduce((text, node) => text.slice(0, node.start) + text.slice(node.end), descriptor.scriptSetup.content)
const response = data => ({data:{success:true,data}})
const templates = [{templateKey:'login',displayName:'登录成功'}, {templateKey:'health',displayName:'健康告警'}]
const detail = templateKey => ({templateKey,source:{subjectTemplate:'标题',htmlTemplate:'<b>正文</b>',textTemplate:'正文'}})
function createPage({ initialTemplateKey = '', confirm = () => true, failDetail = false, post, autoPreview = false } = {}) {
  const calls = [], events = [], posts = []
  const timers = new Map(), stopWatchers = []
  let exposed, cleanup, nextTimer = 0
  const page = localizedVm(`${code}\n;({initialize,selectTemplate,applyTemplateDetail,currentTemplate,source,hasUnsavedChanges,selectNotificationState,notificationState,validateAndPreview,sendTestMail,testRecipient,previewing,preview,previewError,alerts,useDefaultTemplate,confirmDialog})`, {
    computed, nextTick, ref, shallowRef, AbortController, useId: () => 'mail-navigation',
    watch: (...args) => { if (autoPreview) stopWatchers.push(watch(...args)) },
    setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id }, clearTimeout: id => timers.delete(id),
    defineProps: () => ({initialTemplateKey}), defineExpose: value => { exposed = value }, defineEmits: () => (...args) => events.push(args),
    onMounted: () => {}, onBeforeUnmount: callback => { cleanup = callback }, useUnsavedChanges: () => {}, DOMPurify: {sanitize:value=>value},
    formatSystemDateTime:value=>value, window:{confirm}, crypto:globalThis.crypto, console:{error:()=>{}},
    http:{get:async url => {
      calls.push(url)
      if (url === '/api/mail/templates') return response(templates)
      if (url === '/api/config/mail') return response({recipient:'test@example.com'})
      if (url.endsWith('/versions')) return response([{version:1,status:'archived'}])
      if (failDetail) throw new Error('unavailable')
      return response(detail(url.split('/').at(-1)))
    },post:async (url, data, config) => { calls.push(url); posts.push({url,data,config}); return post ? post(url,data,config) : response(detail(url.split('/')[4])) }},
  })
  page.confirmDialog.value = { ask: async () => confirm() }
  return {...page,calls,events,posts,exposed,timers,
    dispose: () => { cleanup(); stopWatchers.forEach(stop => stop()) },
    runPreviews: async () => {
      await nextTick()
      const callbacks = [...timers.values()]
      timers.clear()
      await Promise.all(callbacks.map(callback => callback()))
      await nextTick()
    },
  }
}

test('initial mail loading automatically previews and batches edits without saving or publishing', async t => {
  const page = createPage({autoPreview:true})
  t.after(page.dispose)
  await page.initialize()
  await page.runPreviews()
  assert.equal(page.posts.length, 1)
  assert.equal(page.posts[0].url, '/api/mail/templates/login/preview')
  page.posts.length = 0
  page.source.value.subjectTemplate = '新的主题'
  await nextTick()
  page.source.value.htmlTemplate = '<b>新的正文</b>'
  await nextTick()
  page.source.value.textTemplate = '新的纯文本'
  await nextTick()
  assert.equal(page.posts.length, 0)
  assert.equal(page.timers.size, 1)
  await page.runPreviews()
  assert.equal(page.posts.length, 1)
  assert.equal(page.posts[0].data.subjectTemplate, '新的主题')
  assert.equal(page.posts[0].data.htmlTemplate, '<b>新的正文</b>')
  assert.equal(page.posts[0].data.textTemplate, '新的纯文本')
  assert.equal(page.hasUnsavedChanges.value, true)
})

test('loading defaults also refreshes the preview automatically', async t => {
  const page = createPage({autoPreview:true})
  t.after(page.dispose)
  page.applyTemplateDetail({...detail('login'),defaultSource:{subjectTemplate:'默认主题',htmlTemplate:'默认 HTML',textTemplate:'默认纯文本'}})
  await page.runPreviews()
  page.useDefaultTemplate()
  await page.runPreviews()
  assert.equal(page.posts.at(-1).data.htmlTemplate, '默认 HTML')
  assert.equal(page.hasUnsavedChanges.value, true)
  assert.ok(page.posts.every(item => item.url.endsWith('/preview')))
})

test('typing cancels an in-flight preview and late results cannot overwrite the latest preview', async t => {
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  let count = 0
  const page = createPage({autoPreview:true,post:() => ++count === 1 ? pending : response({subject:'最新预览'})})
  t.after(page.dispose)
  page.applyTemplateDetail(detail('login'))
  const first = page.runPreviews()
  await nextTick()
  page.source.value.htmlTemplate = '最新内容'
  await nextTick()
  assert.equal(page.posts[0].config.signal.aborted, true)
  await page.runPreviews()
  finish(response({subject:'过期预览'}))
  await first
  assert.equal(page.preview.value.subject, '最新预览')
})

test('unmount clears scheduled work and cancels active mail preview requests', async () => {
  const scheduled = createPage({autoPreview:true})
  scheduled.applyTemplateDetail(detail('login'))
  await nextTick()
  assert.equal(scheduled.timers.size, 1)
  scheduled.dispose()
  await scheduled.runPreviews()
  assert.equal(scheduled.posts.length, 0)

  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const active = createPage({autoPreview:true,post:() => pending})
  active.applyTemplateDetail(detail('login'))
  const rendering = active.runPreviews()
  await nextTick()
  active.dispose()
  assert.equal(active.posts[0].config.signal.aborted, true)
  finish(response({subject:'页面关闭后的预览'}))
  await rendering
  assert.equal(active.preview.value, null)
})

test('automatic validation errors stay inline and clear after a successful edit', async t => {
  let failing = true
  const page = createPage({autoPreview:true,post:async () => {
    if (failing) throw {response:{data:{message:'未知模板变量'}}}
    return response({subject:'校验通过'})
  }})
  t.after(page.dispose)
  page.applyTemplateDetail(detail('login'))
  await page.runPreviews()
  assert.equal(page.previewError.value, '未知模板变量')
  assert.equal(page.alerts.value.length, 0)
  failing = false
  page.source.value.htmlTemplate = '修正后的正文'
  await page.runPreviews()
  assert.equal(page.preview.value.subject, '校验通过')
  assert.equal(page.previewError.value, '')
})

test('mail scanner state changes preview and test samples while preserving the shared unsaved template', async () => {
  const page = createPage()
  page.applyTemplateDetail(detail('scanner_outage'))
  page.source.value.htmlTemplate = '未保存的 {{ event_label }}'
  await page.selectNotificationState({target:{value:'recovered'}})
  assert.equal(page.notificationState.value, 'recovered')
  assert.equal(page.posts[0].url, '/api/mail/templates/scanner_outage/preview?notificationState=recovered')
  assert.equal(page.posts[0].data.htmlTemplate, '未保存的 {{ event_label }}')
  page.testRecipient.value = ' test@example.com '
  await page.sendTestMail()
  assert.equal(page.posts[1].url, '/api/mail/templates/scanner_outage/test?notificationState=recovered')
  assert.equal(page.posts[1].data.recipient, 'test@example.com')
  assert.equal(page.posts[1].data.source.htmlTemplate, '未保存的 {{ event_label }}')
  assert.equal(page.hasUnsavedChanges.value, true)
  await page.selectNotificationState({target:{value:'offline'}})
  assert.equal(page.posts[2].url, '/api/mail/templates/scanner_outage/preview?notificationState=offline')
})

test('mail ignores invalid state changes and keeps other events on their existing preview endpoint', async () => {
  const page = createPage()
  page.applyTemplateDetail(detail('scanner_outage'))
  const invalid = {target:{value:'invalid'}}
  await page.selectNotificationState(invalid)
  assert.equal(invalid.target.value, 'offline')
  assert.equal(page.posts.length, 0)
  page.previewing.value = true
  const blocked = {target:{value:'recovered'}}
  await page.selectNotificationState(blocked)
  assert.equal(blocked.target.value, 'offline')
  page.previewing.value = false
  page.applyTemplateDetail(detail('login_success'))
  await page.selectNotificationState({target:{value:'recovered'}})
  await page.validateAndPreview()
  assert.equal(page.posts.length, 1)
  assert.equal(page.posts[0].url, '/api/mail/templates/login_success/preview')
})

test('a late scanner state preview cannot replace the newly selected template preview', async () => {
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  let count = 0
  const page = createPage({post:() => ++count === 1 ? pending : response({subject:'新模板预览'})})
  page.applyTemplateDetail(detail('scanner_outage'))
  const changing = page.selectNotificationState({target:{value:'recovered'}})
  page.applyTemplateDetail(detail('login_success'))
  await page.validateAndPreview()
  finish(response({subject:'过期的恢复状态预览'}))
  await changing
  assert.equal(page.preview.value.subject, '新模板预览')
  assert.equal(page.previewing.value, false)
})

test('sidebar restoration retains mail confirmation and refreshes the exposed history', async () => {
  const page = createPage()
  await page.initialize()
  assert.equal(page.exposed.versions.value[0].version, 1)
  await page.exposed.restoreVersion(1)
  assert.ok(page.calls.includes('/api/mail/templates/login/versions/1/restore'))
  assert.equal(page.exposed.versions.value[0].status, 'archived')
})

test('initialization publishes the mail catalogue and loads the requested template', async () => {
  const page = createPage({initialTemplateKey:'health'})
  await page.initialize()
  assert.ok(page.calls.includes('/api/mail/templates/health'))
  assert.equal(page.currentTemplate.value.templateKey, 'health')
  assert.equal(page.events[0][0], 'templates-loaded')
  assert.equal(page.events[0][1].length, 2)
  assert.deepEqual(page.events.at(-1), ['selected','health'])
})

test('cancelling a template switch keeps edits and emits no new selection', async () => {
  const page = createPage({confirm:()=>false})
  page.applyTemplateDetail(detail('login'))
  page.source.value.htmlTemplate = '未保存'
  await page.selectTemplate('health')
  assert.equal(page.currentTemplate.value.templateKey, 'login')
  assert.equal(page.source.value.htmlTemplate, '未保存')
  assert.equal(page.calls.length, 0)
  assert.equal(page.events.length, 1)
})

test('failed template loading does not select another template in the grouped menu', async () => {
  const page = createPage({failDetail:true})
  page.applyTemplateDetail(detail('login'))
  await page.selectTemplate('health')
  assert.equal(page.currentTemplate.value.templateKey, 'login')
  assert.equal(page.events.length, 1)
})

// Existing business fixtures select Chinese explicitly; locale behavior has its own tests.
function localizedVm(code, context, options) {
  i18n.global.locale.value = 'zh-CN'
  return vm.runInNewContext(code, { tr, ...context }, options)
}
