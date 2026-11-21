import { tr, i18n } from '../i18n/index.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { notificationEvents, providerLabel, deliveryReason } from '../utils/notifications.js'

const { descriptor } = parse(readFileSync(new URL('./BotTemplateEditor.vue', import.meta.url), 'utf8'))
const compiled = compileScript(descriptor, { id: 'bot-template-test' })
const code = compiled.scriptSetupAst.filter(node => node.type === 'ImportDeclaration').reverse()
  .reduce((text, node) => text.slice(0, node.start) + text.slice(node.end), descriptor.scriptSetup.content)
const initial = { provider:'feishu', eventType:'health.alert', revision:0, status:'default', variables:[], versions:[],
  source:{format:'text',titleTemplate:'title',bodyTemplate:'body'} }
const response = data => ({data:{success:true,data}})
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return {promise,resolve} }
function createPage(request = async () => response(initial), post = async () => response({htmlBody:'sample'}), provider = 'feishu', initialEvent = '', {confirm = () => true, eventVariants = []} = {}) {
  let dispose
  let exposed
  const events = []
  const page = localizedVm(`${code}\n;({load,apply,act,refreshPreview,source,saved,detail,preview,previewDocument,previewError,error,hasUnsavedChanges,sendTest,channelId,channels,loadChannels,sampleSeverity,testDelivery,testNotice,selectEvent,event,selectStateFromDropdown,confirmDialog})`, {
    computed, nextTick, ref, shallowRef, watch, useId: () => 'bot-template-test', notificationEvents, providerLabel, deliveryReason, AbortController,
    defineProps: () => ({provider, initialEvent, eventVariants}), defineExpose: value => { exposed = value }, defineEmits: () => (...args) => events.push(args),
    http:Object.assign(request,{post}), setTimeout, clearTimeout,
    DOMPurify:{sanitize:value=>value}, formatDateTime:value=>value,
    useUnsavedChanges:()=>{}, onMounted:()=>{}, onBeforeUnmount:fn=>{dispose=fn}, window:{confirm},
  })
  page.confirmDialog.value = { ask: async () => confirm() }
  return {...page,events,exposed,dispose:()=>dispose()}
}

test('both bot state dropdowns load the selected template and revert selection when unsaved changes are kept', async () => {
  const eventVariants = [{value:'scanner.offline'}, {value:'scanner.recovered'}]
  for (const provider of ['feishu', 'telegram']) {
    const calls = []
    let accepted = true
    const page = createPage(async config => { calls.push(config.url); return response(initial) }, undefined, provider, 'scanner.offline', {eventVariants, confirm:()=>accepted})
    await page.selectStateFromDropdown({target:{value:'scanner.recovered'}})
    assert.equal(page.event.value, 'scanner.recovered')
    assert.equal(calls[0], `/api/notifications/templates/${provider}/scanner.recovered`)
    page.source.value.bodyTemplate = '保留修改'
    accepted = false
    const change = {target:{value:'scanner.offline'}}
    await page.selectStateFromDropdown(change)
    assert.equal(change.target.value, 'scanner.recovered')
    assert.equal(page.source.value.bodyTemplate, '保留修改')
    assert.equal(calls.length, 1)
    await page.selectStateFromDropdown({target:{value:'user.login'}})
    assert.equal(page.event.value, 'scanner.recovered')
    page.dispose()
  }
})

test('sidebar history is reactive and restoring an archived version uses the existing restore endpoint', async () => {
  const calls = []
  const page = createPage(async config => { calls.push(config); return response({...initial,revision:2,versions:[{version:2,status:'draft'}]}) })
  page.apply({...initial,revision:1,versions:[{version:1,status:'archived'}]})
  assert.equal(page.exposed.versions.value[0].version, 1)
  await page.exposed.restoreVersion(1)
  assert.equal(calls[0].url, '/api/notifications/templates/feishu/health.alert/restore')
  assert.equal(calls[0].data.version, 1)
  assert.equal(calls[0].data.expectedRevision, 1)
  assert.equal(page.exposed.versions.value[0].version, 2)
  page.dispose()
})

test('grouped navigation loads the selected event and reports subsequent event changes', async () => {
  const calls = []
  const page = createPage(async config => {
    calls.push(config.url)
    return response(initial)
  }, undefined, 'telegram', 'report.monthly')
  await page.load()
  assert.equal(calls[0], '/api/notifications/templates/telegram/report.monthly')
  await page.selectEvent('user.login')
  assert.equal(calls[1], '/api/notifications/templates/telegram/user.login')
  assert.equal(page.event.value, 'user.login')
  assert.deepEqual(page.events, [['selected', 'user.login']])
  page.dispose()
})

test('Feishu card previews use the header color and keep plain text and Telegram previews separate', () => {
  const page = createPage()
  for (const [template, color] of [['red','#fde2e2'],['orange','#fff0d4'],['green','#dff3e5'],['blue','#e3edff']]) {
    page.preview.value = {htmlBody:'<b>标题</b>\n<b>正文</b>',payload:{msg_type:'interactive',card:{header:{template}}}}
    assert.ok(page.previewDocument.value.includes('<article class="message-card"><b>标题</b>'))
    assert.ok(page.previewDocument.value.includes(`background:${color};font-size:16px`))
    assert.ok(page.previewDocument.value.includes("default-src 'none'"))
  }
  page.preview.value = {htmlBody:'普通消息',payload:{msg_type:'text'}}
  assert.equal(page.previewDocument.value.includes('<article'), false)
  const telegram = createPage(undefined, undefined, 'telegram')
  telegram.preview.value = {htmlBody:'<b>Telegram</b>',payload:{text:'<b>Telegram</b>',parse_mode:'HTML'}}
  assert.equal(telegram.previewDocument.value.includes('<article'), false)
  page.dispose()
  telegram.dispose()
})

test('publishing unsaved changes saves the selected provider/event first and uses the returned revision', async () => {
  const calls=[]
  const page=createPage(async config => {
    calls.push(config)
    if (config.url.endsWith('/draft')) return response({...initial,status:'draft',revision:1,source:config.data.source})
    return response({...initial,status:'published',revision:2,source:calls[0].data.source})
  })
  page.apply(initial)
  page.source.value.bodyTemplate='edited'
  await page.act('publish')
  assert.equal(calls.length,2)
  assert.equal(calls[0].url,'/api/notifications/templates/feishu/health.alert/draft')
  assert.equal(calls[0].data.expectedRevision,0)
  assert.equal(calls[0].data.source.bodyTemplate,'edited')
  assert.equal(calls[1].data.expectedRevision,1)
  assert.equal(page.hasUnsavedChanges.value,false)
  page.dispose()
})

test('a conflict preserves edits and does not publish', async () => {
  let calls=0
  const page=createPage(async () => { calls++; throw {response:{data:{message:'配置已变化'}}} })
  page.apply(initial)
  page.source.value.bodyTemplate='keep this edit'
  await page.act('publish')
  assert.equal(calls,1)
  assert.equal(page.source.value.bodyTemplate,'keep this edit')
  assert.equal(page.hasUnsavedChanges.value,true)
  assert.equal(page.error.value,'配置已变化')
  page.dispose()
})

test('stale previews cannot replace the latest rendering even if cancellation is ignored', async () => {
  const first=deferred(), second=deferred()
  const calls=[]
  const page=createPage(undefined,(_,body,{signal}) => {calls.push({body,signal});return calls.length===1?first.promise:second.promise})
  const pendingFirst=page.refreshPreview()
  page.source.value.bodyTemplate='latest'
  await nextTick()
  const pendingSecond=page.refreshPreview()
  second.resolve(response({htmlBody:'latest'}))
  await pendingSecond
  first.resolve(response({htmlBody:'stale'}))
  await pendingFirst
  assert.equal(calls[0].signal.aborted,true)
  assert.equal(page.preview.value.htmlBody,'latest')
  page.dispose()
})

test('unmount cancels detail loading and discards late responses', async () => {
  const pending=deferred()
  let signal
  const page=createPage(config => {signal=config.signal;return pending.promise})
  const loading=page.load()
  page.dispose()
  pending.resolve(response(initial))
  await loading
  assert.equal(signal.aborted,true)
  assert.equal(page.detail.value,null)
})

test('template testing sends current unsaved content and selected severity without publishing', async () => {
  const calls=[]
  const page=createPage(async config => {
    calls.push(config)
    return config.method==='POST' ? response({delivery_id:'delivery-1'}) : response({id:'delivery-1',status:'sent'})
  })
  page.apply(initial)
  page.channelId.value='channel-1'
  page.source.value.bodyTemplate='<b>{{ summary }}</b>'
  page.sampleSeverity.value='critical'
  await page.sendTest()
  assert.equal(calls.length,2)
  assert.equal(calls[0].url,'/api/notifications/templates/feishu/health.alert/test')
  assert.equal(calls[0].data.channelId,'channel-1')
  assert.equal(calls[0].data.source.bodyTemplate,'<b>{{ summary }}</b>')
  assert.equal(calls[0].data.severity,'critical')
  assert.equal(calls[1].url,'/api/notifications/deliveries/delivery-1')
  assert.equal(page.hasUnsavedChanges.value,true)
  assert.equal(page.detail.value.revision,0)
  assert.equal(page.testDelivery.value.status,'sent')
  page.dispose()
})

test('only enabled channels of the selected provider can be selected for testing', async () => {
  const page=createPage(async()=>response([
    {id:'email',provider:'email',enabled:true}, {id:'disabled',provider:'feishu',enabled:false},
    {id:'correct',provider:'feishu',name:'飞书测试群',enabled:true}, {id:'telegram',provider:'telegram',enabled:true},
  ]))
  await page.loadChannels()
  assert.deepEqual(Array.from(page.channels.value, c=>c.id),['correct'])
  assert.equal(page.channelId.value,'correct')
  page.dispose()
})

test('late test status cannot update the page after unmount', async () => {
  const pending=deferred(), started=deferred()
  let statusSignal
  const page=createPage(async config=>{
    if(config.method==='POST') return response({delivery_id:'delivery-1'})
    statusSignal=config.signal
    started.resolve()
    return pending.promise
  })
  page.apply(initial)
  page.channelId.value='channel-1'
  const sending=page.sendTest()
  await started.promise
  page.dispose()
  pending.resolve(response({id:'delivery-1',status:'sent'}))
  await sending
  assert.equal(statusSignal.aborted,true)
  assert.equal(page.testDelivery.value.status,'pending')
})

// Existing business fixtures select Chinese explicitly; locale behavior has its own tests.
function localizedVm(code, context, options) {
  i18n.global.locale.value = 'zh-CN'
  return vm.runInNewContext(code, { tr, ...context }, options)
}
