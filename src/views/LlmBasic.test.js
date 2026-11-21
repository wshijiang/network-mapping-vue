import { tr, i18n } from '../i18n/index.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { computed, ref, nextTick, watch } from 'vue'
import { parse, compileScript } from 'vue/compiler-sfc'
import * as llm from '../utils/llm.js'
import * as debug from '../utils/llmDebug.js'
import * as draft from '../utils/llmDraft.js'

const { descriptor } = parse(readFileSync(new URL('./LlmBasic.vue', import.meta.url), 'utf8'))
const compiled = compileScript(descriptor, { id: 'llm-basic-test' })
const source = compiled.scriptSetupAst.filter(n => n.type === 'ImportDeclaration').reverse().reduce((s, n) => s.slice(0, n.start) + s.slice(n.end), descriptor.scriptSetup.content)
const fixture = () => ({ revision: 7, enabled: true, provider_id: 'one', model_id: 'a', ioc_prompt: '', default_ioc_prompt: '系统默认提示词\n返回 JSON 原文证据。', prompt_max_bytes: 65536, global: llm.transportForm(true), providers: [{ id: 'one', default_model: 'a', models: [{ id: 'a', protocol: 'chat', available: true }] }, { id: 'two', default_model: 'b', models: [{ id: 'b', protocol: 'responses', available: true }] }] })
function page({ http, chatRequest, localStorage } = {}) {
  let dispose
  const context = { ...llm, ...debug, ...draft, computed, ref, nextTick, watch, TextEncoder, crypto: { randomUUID: () => 'session-id' }, AbortController, window: { confirm: () => true, localStorage }, onMounted: () => {}, onBeforeUnmount: fn => { dispose = fn }, useUnsavedChanges: () => {}, http: http || { get: async () => ({ data: { data: fixture() } }) }, chatRequest: chatRequest || (async () => {}) }
  const p = localizedVm(`${source}\n;({state,enabled,providerId,modelId,chatProvider,chatModel,messages,input,load,save,chooseProvider,chooseChatProvider,newSession,send,stop,generating,error,promptDraft,promptDirty,promptEditing,editPrompt,cancelPrompt,selectionDirty,dirty,savePrompt,restorePrompt,saveAll,useSystemPrompt,debugParameters,retainIoc,retainDebug,historyId,session,loadHistory,replayLast,draftError,confirmDialog})`, context)
  p.confirmDialog.value = { ask: async () => true }
  return { ...p, dispose: () => dispose() }
}

test('loaded IOC history freezes the original prompt, resumes through the server history ID and preserves thoughts', async () => {
  const calls = []
  const p = page({ chatRequest: async (body, _signal, emit) => {
    calls.push(body); emit({ type: 'started', history_id: 'new-debug-snapshot' }); emit({ type: 'done', text: 'continued', elapsed_ms: 10 })
  } })
  await p.load(); p.input.value = 'unsent-draft'
  p.loadHistory({ id: 'ioc-snapshot', provider_id: 'one', model_id: 'a', protocol: 'chat', parameters: { temperature: 0, max_output_tokens: 512 }, messages: [
    { role: 'system', content: 'original-ioc-prompt' }, { role: 'user', content: 'original-report' },
    { role: 'assistant', content: 'original-answer', reasoning: 'original-thought', complete: true },
  ] })
  assert.equal(p.input.value, 'unsent-draft')
  assert.equal(p.messages.value[1].reasoning, 'original-thought')
  p.state.value.ioc_prompt = 'changed-current-prompt'
  await p.send()
  assert.equal(calls[0].history_id, 'ioc-snapshot')
  assert.equal(calls[0].messages[0].content, 'original-ioc-prompt')
  assert.equal(calls[0].messages[2].content, 'original-answer')
  assert.equal(JSON.stringify(calls[0]).includes('original-thought'), false)
  assert.equal(calls[0].parameters.temperature, 0)
  assert.equal(p.historyId.value, 'new-debug-snapshot')
  p.input.value = 'next'; await p.send()
  assert.equal(calls[1].history_id, 'new-debug-snapshot')
  p.dispose()
})

test('replaying the last historical request excludes the old response and restores the exact original input', async () => {
  let sent
  const p = page({ chatRequest: async body => { sent = body } })
  await p.load()
  p.loadHistory({ id: 'failed-snapshot', provider_id: 'one', model_id: 'a', messages: [
    { role: 'user', content: '{"untrusted_report_blocks":[]}' },
    { role: 'assistant', content: 'partial-answer', reasoning: 'partial-thought', complete: false },
  ] })
  p.replayLast(); await p.send()
  assert.equal(sent.messages.length, 1)
  assert.equal(sent.messages[0].content, '{"untrusted_report_blocks":[]}')
  assert.equal(sent.history_id, 'failed-snapshot')
  p.dispose()
})

test('per-user browser drafts survive refresh and context changes, but sending and explicit clearing remove them', async () => {
  const map = new Map()
  const localStorage = { getItem: k => map.get(k), setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) }
  const http = { get: async () => ({ data: { data: { ...fixture(), current_user_id: 17 } } }) }
  const first = page({ localStorage, http }); await first.load(); first.input.value = 'refresh-safe draft'; first.dispose()
  const second = page({ localStorage, http, chatRequest: async () => { assert.equal(map.size, 0) } })
  await second.load(); assert.equal(second.input.value, 'refresh-safe draft')
  second.chatProvider.value = 'two'; second.chooseChatProvider()
  assert.equal(second.input.value, 'refresh-safe draft')
  await second.send(); assert.equal(map.size, 0)
  second.input.value = 'delete this'; second.input.value = ''; assert.equal(map.size, 0)
  second.input.value = 'clear this'; second.newSession({ clearDraft: true }); assert.equal(map.size, 0)
  second.dispose()
})

test('retention switches are saved with the IOC card revision', async () => {
  let sent
  const p = page({ http: { get: async () => ({ data: { data: fixture() } }), put: async (_url, body) => { sent = body } } })
  await p.load(); assert.equal(p.retainIoc.value, false); assert.equal(p.retainDebug.value, false)
  p.retainIoc.value = true; p.retainDebug.value = true
  assert.equal(p.selectionDirty.value, true)
  await p.save()
  assert.equal(sent.retain_ioc_conversations, true); assert.equal(sent.retain_debug_conversations, true)
  assert.equal(sent.expected_revision, 7)
  p.dispose()
})
test('pausing saves the selected pair while temporary debugging keeps IOC binding intact', async () => {
  let sent
  const p = page({ http: { get: async () => ({ data: { data: fixture() } }), put: async (_url, body) => { sent = body } } })
  await p.load(); p.chatProvider.value = 'two'; p.chooseChatProvider()
  assert.equal(p.chatModel.value, 'b'); assert.equal(p.providerId.value, 'one')
  p.enabled.value = false; await p.save()
  assert.equal(sent.provider_id, 'one'); assert.equal(sent.model_id, 'a'); assert.equal(sent.enabled, false); assert.equal(sent.expected_revision, 7)
  p.dispose()
})

test('prompt editing requires explicit edit and save, including restoring the default', async () => {
  const data = fixture(), writes = []
  const p = page({ http: {
    get: async () => ({ data: { data: structuredClone(data) } }),
    put: async (url, body) => { writes.push({ url, ...body }); data.ioc_prompt = body.prompt; data.revision++; return { data: { data: { revision: data.revision, ioc_prompt: data.ioc_prompt } } } },
  } })
  await p.load()
  assert.equal(p.promptDraft.value, data.default_ioc_prompt)
  assert.equal(p.promptEditing.value, false)
  assert.equal(await p.savePrompt(), false)
  assert.equal(writes.length, 0)
  p.editPrompt()
  p.promptDraft.value = '自定义提示词\n只返回 JSON。'
  assert.equal(p.promptDirty.value, true)
  assert.equal(await p.savePrompt(), true)
  assert.equal(writes[0].url, '/api/llm/prompt')
  assert.equal(writes[0].expected_revision, 7)
  assert.equal(writes[0].prompt, '自定义提示词\n只返回 JSON。')
  assert.equal(p.promptEditing.value, false)
  await p.load(); assert.equal(p.promptDraft.value, data.ioc_prompt)
  p.providerId.value = 'two'; p.chooseProvider()
  p.restorePrompt()
  assert.equal(writes.length, 1)
  assert.equal(p.promptDraft.value, data.ioc_prompt)
  p.editPrompt(); p.restorePrompt()
  assert.equal(p.promptDraft.value, data.default_ioc_prompt)
  assert.equal(writes.length, 1)
  assert.equal(p.promptDirty.value, true)
  assert.equal(await p.savePrompt(), true)
  assert.equal(writes[1].prompt, '')
  assert.equal(writes[1].expected_revision, 8)
  assert.equal(p.promptDraft.value, data.default_ioc_prompt)
  assert.equal(p.promptDirty.value, false)
  assert.equal(p.providerId.value, 'two')
  assert.equal(p.selectionDirty.value, true)
  assert.equal(p.state.value.revision, 9)
  assert.equal(p.promptEditing.value, false)
  p.editPrompt(); p.promptDraft.value = '取消的草稿'; p.cancelPrompt()
  assert.equal(p.promptDraft.value, data.default_ioc_prompt)
  assert.equal(p.promptDirty.value, false)
  assert.equal(p.promptEditing.value, false)
  assert.equal(writes.length, 2)
  p.dispose()
})

test('invalid or conflicted prompt edits remain unsaved and preserve the draft', async () => {
  let writes = 0
  const p = page({ http: {
    get: async () => ({ data: { data: fixture() } }),
    put: async () => { writes++; throw { response: { data: { code: 'intel_revision_conflict' } } } },
  } })
  await p.load()
  p.editPrompt()
  for (const value of ['', '   ', '含\u0000控制字符', '中'.repeat(21846)]) {
    p.promptDraft.value = value
    assert.equal(p.promptDirty.value, true)
    assert.equal(await p.savePrompt(), false)
  }
  assert.equal(writes, 0)
  p.promptDraft.value = '有效草稿'
  assert.equal(await p.savePrompt(), false)
  assert.equal(p.promptDraft.value, '有效草稿')
  assert.equal(p.state.value.revision, 7)
  assert.equal(p.promptDirty.value, true)
  assert.match(p.error.value, /配置已被其他操作修改/)
  p.dispose()
})

test('saving model selection retains a prompt draft and save-before-leaving saves both', async () => {
  const data = fixture(), writes = []
  const p = page({ http: {
    get: async () => ({ data: { data: structuredClone(data) } }),
    put: async (url, body) => {
      writes.push({ url, ...body }); data.revision++
      if (url === '/api/llm/prompt') data.ioc_prompt = body.prompt
      else { data.enabled = body.enabled; data.provider_id = body.provider_id; data.model_id = body.model_id }
      return { data: { data: { revision: data.revision, ioc_prompt: data.ioc_prompt } } }
    },
  } })
  await p.load(); p.enabled.value = false; p.editPrompt(); p.promptDraft.value = '保留的提示词草稿'
  assert.equal(await p.saveAll(), true)
  assert.equal(writes.length, 2)
  assert.equal(writes[1].expected_revision, 8)
  assert.equal(writes[1].prompt, '保留的提示词草稿')
  assert.equal(p.dirty.value, false)
  p.dispose()
})
test('partial failed replies never become history for the next paid request', async () => {
  const calls = []
  const p = page({ chatRequest: async (body, _signal, emit) => {
    calls.push(body)
    if (calls.length === 1) { emit({ type: 'delta', text: 'partial-private-output' }); throw new Error('llm_stream_failed') }
    emit({ type: 'done', text: '<img src=x onerror=alert(1)>', elapsed_ms: 10, usage: {} })
  } })
  await p.load(); p.input.value = 'hello'; await p.send()
  assert.equal(p.messages.value[1].complete, false)
  p.input.value = 'retry'; await p.send()
  assert(!JSON.stringify(calls[1]).includes('partial-private-output'))
  assert.equal(p.messages.value[3].complete, true)
  assert(!descriptor.template.content.includes('v-html'))
  p.dispose()
})

test('debug system prompt toggle uses saved content exactly once and excludes editor drafts', async () => {
  const calls = [], data = fixture()
  const p = page({
    http: { get: async () => ({ data: { data: structuredClone(data) } }) },
    chatRequest: async (body, _signal, emit) => { calls.push(body); emit({ type: 'done', text: 'answer', elapsed_ms: 1 }) },
  })
  await p.load(); assert.equal(p.useSystemPrompt.value, false)
  p.input.value = 'plain'; await p.send()
  assert.equal(calls[0].messages[0].role, 'user')
  p.useSystemPrompt.value = true; p.newSession()
  p.editPrompt(); p.promptDraft.value = 'unsaved editor draft'
  p.input.value = 'first'; await p.send()
  assert.equal(calls[1].messages[0].role, 'system')
  assert.equal(calls[1].messages[0].content, data.default_ioc_prompt)
  p.input.value = 'second'; await p.send()
  assert.equal(calls[2].messages.filter(m => m.role === 'system').length, 1)
  assert.equal(calls[2].messages.length, 4)
  assert(!JSON.stringify(calls).includes('unsaved editor draft'))
  p.useSystemPrompt.value = false; p.newSession()
  p.input.value = 'off again'; await p.send()
  assert.equal(calls[3].messages.length, 1)
  assert.equal(calls[3].messages[0].role, 'user')
  data.ioc_prompt = 'saved custom prompt'; p.useSystemPrompt.value = true
  await p.load(); assert.equal(p.messages.value.length, 0)
  p.input.value = 'custom'; await p.send()
  assert.equal(calls[4].messages[0].content, 'saved custom prompt')
  p.dispose()
})
test('new session cancels the old request and late events cannot repopulate the conversation', async () => {
  let emit, finish, signal
  const p = page({ chatRequest: async (_body, s, callback) => { signal = s; emit = callback; await new Promise(resolve => { finish = resolve }) } })
  await p.load(); p.input.value = 'hello'; const pending = p.send(); await new Promise(setImmediate)
  p.newSession(); assert(signal.aborted)
  emit({ type: 'delta', text: 'obsolete' }); finish(); await pending
  assert.equal(p.messages.value.length, 0); assert.equal(p.generating.value, false)
  p.dispose()
})

test('debug controls affect only subsequent debug requests and record effective response parameters', async () => {
  const calls = [], writes = []
  const p = page({
    http: { get: async () => ({ data: { data: fixture() } }), put: async (...args) => writes.push(args) },
    chatRequest: async (body, _signal, emit) => {
      calls.push(body)
      emit({ type: 'started', stream: true, parameters: { reasoning_effort: body.parameters.reasoning_effort || 'medium', max_output_tokens: body.parameters.max_output_tokens || 4096, stream: true } })
      emit({ type: 'done', text: 'answer', elapsed_ms: 1 })
    },
  })
  await p.load(); p.input.value = 'inherit'; await p.send()
  assert.deepEqual(Object.keys(calls[0].parameters), [])
  Object.assign(p.debugParameters.value, { reasoning_effort: 'high', max_output_tokens: '128', temperature: '0', timeout_seconds: '30', stream: 'on', token_limit_field: 'max_completion_tokens' })
  p.input.value = 'override'; await p.send()
  assert.equal(calls[1].messages.length, 3)
  assert.equal(calls[1].parameters.temperature, 0)
  assert.equal(calls[1].parameters.max_output_tokens, 128)
  assert.equal(calls[1].parameters.stream, true)
  assert.equal(calls[1].parameters.token_limit_field, 'max_completion_tokens')
  assert.equal(p.messages.value[1].parameters.reasoning_effort, 'medium')
  assert.equal(p.messages.value[3].parameters.reasoning_effort, 'high')
  assert.equal(p.dirty.value, false)
  assert.equal(writes.length, 0)
  p.debugParameters.value = debug.debugParameterForm()
  p.input.value = 'reset'; await p.send()
  assert.deepEqual(Object.keys(calls[2].parameters), [])
  p.debugParameters.value.temperature = '3'
  p.input.value = 'invalid'
  await p.send(); assert.equal(calls.length, 3)
  assert.equal(p.input.value, 'invalid')
  assert.match(p.error.value, /温度/)
  p.dispose()
})

test('thinking starts collapsed, expands independently and collapses once at the first real output', async () => {
  const calls = []
  const p = page({ chatRequest: async (body, _signal, emit) => {
    calls.push(body)
    emit({ type: 'started', stream: true })
    const answer = p.messages.value.at(-1)
    assert.equal(answer.thinking, true)
    assert.equal(answer.reasoningExpanded, false)
    emit({ type: 'reasoning', text: '思考第一段' })
    emit({ type: 'reasoning', text: '\n思考第二段' })
    assert.equal(answer.reasoning, '思考第一段\n思考第二段')
    assert.equal(answer.content, '')
    answer.reasoningExpanded = true
    emit({ type: 'delta', text: '' })
    assert.equal(answer.reasoningExpanded, true)
    emit({ type: 'delta', text: '正式' })
    assert.equal(answer.thinking, false)
    assert.equal(answer.reasoningExpanded, false)
    answer.reasoningExpanded = true
    emit({ type: 'delta', text: '回答' })
    assert.equal(answer.reasoningExpanded, true)
    emit({ type: 'done', text: '正式回答', elapsed_ms: 25 })
    assert.equal(answer.reasoningExpanded, true)
  } })
  await p.load(); p.input.value = 'hello'; await p.send()
  assert.equal(p.messages.value[1].complete, true)
  assert.equal(p.messages.value[1].outputRate, '—')
  assert.equal(p.messages.value[1].cacheUsage.tokens, '—')
  assert.equal(p.messages.value[1].cacheUsage.hitRate, '—')
  p.input.value = 'follow up'; await p.send()
  assert.equal(JSON.stringify(calls[1]).includes('思考第一段'), false)
  assert.equal(calls[1].messages[1].content, '正式回答')
  assert.match(descriptor.template.content, /skeleton skeleton-text/)
  assert.match(descriptor.template.content, /aria-expanded="m.reasoningExpanded"/)
  p.dispose()
})

test('complete responses expose reasoning separately without requiring stream deltas', async () => {
  const p = page({ chatRequest: async (_body, _signal, emit) => {
    emit({ type: 'started', stream: false })
    p.messages.value.at(-1).reasoningExpanded = true
    emit({ type: 'done', text: 'answer', reasoning: '供应商返回的思考摘要', elapsed_ms: 2500, usage: { output_tokens: 100, input_tokens: 1000, cached_input_tokens: 800 } })
  } })
  await p.load(); p.input.value = 'hello'; await p.send()
  const answer = p.messages.value[1]
  assert.equal(answer.outputRate, '40.0 token/s')
  assert.equal(answer.cacheUsage.tokens, '800 token')
  assert.equal(answer.cacheUsage.hitRate, '80.0%')
  assert.equal(answer.reasoning, '供应商返回的思考摘要')
  assert.equal(answer.content, 'answer')
  assert.equal(answer.reasoningExpanded, false)
  assert.equal(answer.thinking, false)
  p.dispose()
})

test('failed and cancelled reasoning stops animation while keeping already received text', async () => {
  for (const failure of ['error', 'cancel']) {
    const p = page({ chatRequest: async (_body, _signal, emit) => {
      emit({ type: 'started', stream: true })
      emit({ type: 'reasoning', text: 'partial thought' })
      if (failure === 'error') emit({ type: 'error', code: 'llm_stream_failed' })
      else throw Object.assign(new Error('cancelled'), { name: 'AbortError' })
    } })
    await p.load(); p.input.value = 'hello'; await p.send()
    assert.equal(p.messages.value[1].thinking, false)
    assert.equal(p.messages.value[1].reasoning, 'partial thought')
    assert.equal(p.messages.value[1].complete, false)
    assert.equal(p.generating.value, false)
    p.dispose()
  }
})

// Existing business fixtures select Chinese explicitly; locale behavior has its own tests.
function localizedVm(code, context, options) {
  i18n.global.locale.value = 'zh-CN'
  return vm.runInNewContext(code, { tr, ...context }, options)
}
