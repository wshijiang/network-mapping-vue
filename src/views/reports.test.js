import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, ref } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'

const { descriptor } = parse(readFileSync(new URL('./reports.vue', import.meta.url), 'utf8'))
const compiled = compileScript(descriptor, { id: 'reports-test' })
const code = compiled.scriptSetupAst.filter(node => node.type === 'ImportDeclaration').reverse()
  .reduce((text, node) => text.slice(0, node.start) + text.slice(node.end), descriptor.scriptSetup.content)

test('weekly and monthly plans save only eligible bot subscriptions with their revisions', async () => {
  const requests = []
  const data = { schedules: [{period_type:'weekly', recipient_ids:[], revision:2, enabled:true, send_hour:9, send_minute:0}, {period_type:'monthly', recipient_ids:[], revision:3, enabled:true, send_hour:8, send_minute:30}], bot_channels: [
    {id:'f',name:'飞书',provider:'feishu',enabled:true,minimum_severity:'warning',revision:4,event_types:['report.weekly']},
    {id:'t',name:'Telegram',provider:'telegram',enabled:true,minimum_severity:'warning',revision:5,event_types:['report.monthly']},
    {id:'off',enabled:false,minimum_severity:'warning',event_types:[]},
    {id:'critical',enabled:true,minimum_severity:'critical',event_types:[]},
  ] }
  const http = { get: async () => ({data:{data}}), put: async (url, payload) => { requests.push({url,payload}) } }
  const page = vm.runInNewContext(`${code}\n;({loadSettings,savePlan,plans})`, { tr: x=>x, ref, computed, watch:()=>{}, onMounted:()=>{}, onBeforeUnmount:()=>{}, useId:()=> 'test', useRouter:()=>({}), inject:()=>ref(false), http, timeSettings:{timezone:'UTC'}, crypto:globalThis.crypto, setTimeout, clearTimeout, AbortController, defaultReportSubscriptions:()=>({daily:false,weekly:false,monthly:false}), reportSubscriptionPayload:s=>({daily:!!s.daily,weekly:!!s.weekly,monthly:!!s.monthly}), reportPeriodTypes:[] })
  await page.loadSettings()
  assert.deepEqual(Array.from(page.plans.value[0].bot_channels, c=>[c.id,c.selected]), [['f',true],['t',false]])
  assert.deepEqual(Array.from(page.plans.value[1].bot_channels, c=>[c.id,c.selected]), [['f',false],['t',true]])
  page.plans.value[0].bot_channels[1].selected = true
  await page.savePlan(page.plans.value[0])
  assert.equal(requests[0].url, '/api/report-schedules/weekly')
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].payload.bot_channels)), [{id:'f',revision:4,selected:true},{id:'t',revision:5,selected:true}])
})

test('report subscriptions load and save all period toggles', async () => {
  const requests = []
  const http = {
    get: async () => ({ data: { success: true, data: { daily: true, weekly: false, monthly: true } } }),
    put: async (url, payload) => { requests.push({ url, payload }); return { data: { success: true, data: payload } } },
  }
  const page = vm.runInNewContext(`${code}\n;({loadSubscriptions,saveSubscriptions,subscriptions,alerts})`, { tr: x=>x, ref, computed, watch:()=>{}, onMounted:()=>{}, onBeforeUnmount:()=>{}, useId:()=> 'test', useRouter:()=>({}), inject:()=>ref(false), http, timeSettings:{timezone:'UTC'}, crypto:globalThis.crypto, setTimeout, clearTimeout, AbortController, defaultReportSubscriptions:()=>({daily:false,weekly:false,monthly:false}), reportSubscriptionPayload:s=>({daily:!!s.daily,weekly:!!s.weekly,monthly:!!s.monthly}), reportPeriodTypes:[] })
  await page.loadSubscriptions()
  assert.deepEqual(JSON.parse(JSON.stringify(page.subscriptions.value)), { daily: true, weekly: false, monthly: true })
  page.subscriptions.value.weekly = true
  await page.saveSubscriptions()
  assert.equal(requests[0].url, '/api/report-subscriptions')
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].payload)), { daily: true, weekly: true, monthly: true })
  assert.equal(page.alerts.value.length, 1)
})
