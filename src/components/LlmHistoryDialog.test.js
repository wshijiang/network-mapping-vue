import { tr, i18n } from '../i18n/index.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import { parse, compileScript } from 'vue/compiler-sfc'
import { llmError } from '../utils/llm.js'
const { descriptor } = parse(readFileSync(new URL('./LlmHistoryDialog.vue', import.meta.url), 'utf8'))
const compiled = compileScript(descriptor, { id: 'history-dialog-test' })
const source = compiled.scriptSetupAst.filter(n => n.type === 'ImportDeclaration').reverse().reduce((s, n) => s.slice(0, n.start) + s.slice(n.end), descriptor.scriptSetup.content)
function page(http) {
  const events = []; let dispose
  const p = localizedVm(`${source};({dialog,rows,selected,offset,total,loading,error,fetchPage,loadSelected,remove,confirmDialog})`, {
    ref, llmError, http, AbortController, defineEmits: () => (...args) => events.push(args), defineExpose() {},
    onBeforeUnmount: fn => { dispose = fn }, window: { confirm: () => true },
  })
  p.dialog.value = { showModal() {}, close() {} }
  p.confirmDialog.value = { ask: async () => true }
  return { ...p, events, dispose: () => dispose() }
}
test('modal selects a historical snapshot and deletion refreshes the correct page', async () => {
  const requests = []
  const p = page({
    get: async (url, config) => { requests.push([url, config]); return { data: { data: url.endsWith('/selected') ? { messages: [], model_id: 'model' } : { items: [{ id: 'selected', kind: 'ioc' }], total: 31 } } } },
    delete: async url => requests.push([url]),
  })
  await p.fetchPage(30); p.selected.value = 'selected'; await p.loadSelected()
  assert.equal(p.events[0][0], 'loaded'); assert.equal(p.events[0][1].id, 'selected')
  await p.remove({ id: 'selected' })
  assert.equal(p.events[1][0], 'deleted')
  assert.equal(requests.at(-1)[1].params.offset, 0)
  assert.match(descriptor.template.content, /class="modal"/)
  assert.match(descriptor.template.content, /IOC 提取/)
  assert(!descriptor.template.content.includes('v-html'))
  p.dispose()
})

// Existing business fixtures select Chinese explicitly; locale behavior has its own tests.
function localizedVm(code, context, options) {
  i18n.global.locale.value = 'zh-CN'
  return vm.runInNewContext(code, { tr, ...context }, options)
}
