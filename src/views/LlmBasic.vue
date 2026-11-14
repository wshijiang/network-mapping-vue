<script setup>
import { tr } from '../i18n/index.js'

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import LlmHistoryDialog from '@/components/LlmHistoryDialog.vue'
import LlmInkText from '@/components/LlmInkText.vue'
import { readDraft, writeDraft, historyParameters } from '@/utils/llmDraft'
import { ChevronDown } from '@lucide/vue'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import { availableModels, llmError, settingsPayload } from '@/utils/llm'
import { chatRequest } from '@/utils/llmChat'
import { debugParameterForm, debugParameterPayload, debugParameterSummary, debugOutputRate, debugCacheUsage, debugReasoningOptions } from '@/utils/llmDebug'
import http from '@/utils/http'

const state = ref(null), enabled = ref(false), providerId = ref(''), modelId = ref(''), saved = ref('')
const loading = ref(false), busy = ref(false), error = ref(''), alerts = ref([])
const chatProvider = ref(''), chatModel = ref(''), input = ref(''), messages = ref([]), generating = ref(false), transcript = ref(null)
const session = ref(crypto.randomUUID())
const retainIoc = ref(false), retainDebug = ref(false), historyId = ref(null), historyDialog = ref(null), conversationPrompt = ref(null), loadedHistory = ref(false)
const draftUser = ref(null), draftError = ref('')
let restoringDraft = false
watch(input, text => {
  if (restoringDraft || draftUser.value == null) return
  let storage
  try { storage = window.localStorage } catch {}
  draftError.value = writeDraft(storage, draftUser.value, text) ? '' : tr("当前浏览器无法保存草稿，请在离开前复制未发送内容。")
}, { flush: 'sync' })
const promptDraft = ref('')
const promptEditing = ref(false)
const useSystemPrompt = ref(false)
const effectiveSystemPrompt = computed(() => state.value?.ioc_prompt || state.value?.default_ioc_prompt || '')
const promptDirty = computed(() => state.value && promptDraft.value !== (state.value.ioc_prompt || state.value.default_ioc_prompt || ''))
const provider = computed(() => state.value?.providers.find(p => p.id === providerId.value))
const debugProvider = computed(() => state.value?.providers.find(p => p.id === chatProvider.value))
const debugParameters = ref(debugParameterForm())
const debugProtocol = computed(() => debugProvider.value?.models.find(m => m.id === chatModel.value)?.protocol || debugProvider.value?.protocol || 'chat')
const selected = computed(() => JSON.stringify([enabled.value, providerId.value, modelId.value, retainIoc.value, retainDebug.value]))
const selectionDirty = computed(() => state.value && selected.value !== saved.value)
const dirty = computed(() => selectionDirty.value || promptDirty.value)
useUnsavedChanges(dirty, saveAll)
const requests = new AbortController()
let disposed = false, chatController, chatVersion = 0

async function load({ preservePrompt = false } = {}) {
  loading.value = true; error.value = ''
  try {
    const r = await http.get('/api/llm/settings', { signal: requests.signal })
    if (disposed) return
    const previousPrompt = effectiveSystemPrompt.value
    state.value = r.data.data
    if (Number.isInteger(state.value.current_user_id) && draftUser.value !== state.value.current_user_id) {
      restoringDraft = true
      if (draftUser.value != null) newSession()
      draftUser.value = state.value.current_user_id
      let storage
      try { storage = window.localStorage } catch {}
      input.value = readDraft(storage, draftUser.value)
      restoringDraft = false
    }
    retainIoc.value = Boolean(state.value.retain_ioc_conversations)
    retainDebug.value = Boolean(state.value.retain_debug_conversations)
    if (conversationPrompt.value === null && useSystemPrompt.value && previousPrompt && previousPrompt !== effectiveSystemPrompt.value) newSession()
    if (!preservePrompt) { promptDraft.value = state.value.ioc_prompt || state.value.default_ioc_prompt || ''; promptEditing.value = false }
    enabled.value = state.value.enabled; providerId.value = state.value.provider_id || ''; modelId.value = state.value.model_id || ''
    saved.value = selected.value
    if (!chatProvider.value) { chatProvider.value = providerId.value; chatModel.value = modelId.value }
  } catch (e) { if (!disposed && e.code !== 'ERR_CANCELED') error.value = llmError(e) }
  finally { if (!disposed) loading.value = false }
}
function refresh() { if (dirty.value && !window.confirm(tr("刷新将放弃未保存的设置，确定继续吗？"))) return; load() }
function chooseProvider() { modelId.value = provider.value?.default_model || availableModels(provider.value)[0]?.id || ''; if (!providerId.value) modelId.value = '' }
async function save() {
  if (!state.value || busy.value) return false
  if (enabled.value && (!providerId.value || !modelId.value)) { error.value = tr("启用 IOC 提取前请选择一个供应商及模型。"); return false }
  busy.value = true; error.value = ''
  try {
    await http.put('/api/llm/settings', settingsPayload(state.value, { enabled: enabled.value, provider_id: providerId.value || null, model_id: modelId.value || null, retain_ioc_conversations: retainIoc.value, retain_debug_conversations: retainDebug.value }), { signal: requests.signal })
    if (!disposed) { await load({ preservePrompt: true }); alerts.value.unshift({ id: crypto.randomUUID(), get title() { return tr("IOC 提取设置已保存。") } }) }
    return true
  } catch (e) { if (!disposed && e.code !== 'ERR_CANCELED') error.value = llmError(e); return false }
  finally { busy.value = false }
}
async function persistPrompt(value, restored = false) {
  if (!state.value || !promptEditing.value || busy.value || loading.value) return false
  if (!restored && (!value.trim() || new TextEncoder().encode(value).length > (state.value.prompt_max_bytes || 65536) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value))) {
    error.value = tr("提示词不能为空、包含非法控制字符或超过允许的字节数。"); return false
  }
  busy.value = true; error.value = ''
  try {
    const r = await http.put('/api/llm/prompt', { expected_revision: state.value.revision, prompt: value }, { signal: requests.signal })
    if (disposed) return false
    const previousPrompt = effectiveSystemPrompt.value
    state.value.revision = r.data.data.revision
    state.value.ioc_prompt = r.data.data.ioc_prompt
    state.value.prompt_version = r.data.data.prompt_version
    if (conversationPrompt.value === null && useSystemPrompt.value && previousPrompt !== effectiveSystemPrompt.value) newSession()
    promptDraft.value = state.value.ioc_prompt || state.value.default_ioc_prompt
    promptEditing.value = false
    alerts.value.unshift({ id: crypto.randomUUID(), title: restored ? tr("已恢复并保存系统默认提示词。") : tr("IOC 提取提示词已保存。") })
    return true
  } catch (e) { if (!disposed && e.code !== 'ERR_CANCELED') error.value = llmError(e); return false }
  finally { busy.value = false }
}
function savePrompt() { return promptDraft.value === state.value?.default_ioc_prompt ? persistPrompt('', true) : persistPrompt(promptDraft.value) }
function editPrompt() { if (state.value && !busy.value && !loading.value) promptEditing.value = true }
function cancelPrompt() {
  if (busy.value) return
  promptDraft.value = state.value.ioc_prompt || state.value.default_ioc_prompt || ''
  promptEditing.value = false
}
function restorePrompt() {
  if (!promptEditing.value || busy.value || loading.value) return
  promptDraft.value = state.value.default_ioc_prompt
}
async function saveAll() {
  if (selectionDirty.value && !await save()) return false
  if (promptDirty.value && !await savePrompt()) return false
  return true
}
function newSession({ clearDraft = false } = {}) { chatVersion++; chatController?.abort(); generating.value = false; messages.value = []; if (clearDraft) input.value = ''; session.value = crypto.randomUUID(); historyId.value = null; conversationPrompt.value = null; loadedHistory.value = false }
function chooseChatProvider() { chatModel.value = debugProvider.value?.default_model || availableModels(debugProvider.value)[0]?.id || ''; newSession() }
function stop() { chatController?.abort() }
async function scroll() { await nextTick(); if (transcript.value) transcript.value.scrollTop = transcript.value.scrollHeight }
function messageKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  if (!event.repeat && !generating.value) event.currentTarget.form?.requestSubmit()
}
async function send() {
  const text = input.value.trim()
  if (!text || generating.value || !chatProvider.value || !chatModel.value) return
  if (useSystemPrompt.value && !(conversationPrompt.value ?? effectiveSystemPrompt.value)) { error.value = tr("系统提示词尚未加载，请刷新后重试。"); return }
  if (messages.value.length >= 60) { error.value = tr("当前对话较长，请新建会话后继续。"); return }
  let parameters
  try { parameters = debugParameterPayload(debugParameters.value, debugProtocol.value) }
  catch (e) { error.value = e.message; return }
  error.value = ''
  const current = ++chatVersion
  chatController = new AbortController(); generating.value = true
  const history = [...(useSystemPrompt.value ? [{ role: 'system', content: conversationPrompt.value ?? effectiveSystemPrompt.value }] : []), ...messages.value.filter(m => m.complete).map(m => ({ role: m.role, content: m.content })), { role: 'user', content: text }]
  messages.value.push({ role: 'user', content: text, complete: true })
  messages.value.push({ role: 'assistant', content: '', reasoning: '', reasoningExpanded: false, thinking: false, complete: false, get status() { return tr("正在连接…") } })
  const index = messages.value.length - 1
  input.value = ''; await scroll()
  if (disposed || current !== chatVersion) return
  try {
    await chatRequest({ provider_id: chatProvider.value, model_id: chatModel.value, session_id: session.value, history_id: historyId.value, messages: history, parameters }, chatController.signal, event => {
      if (disposed || current !== chatVersion) return
      const answer = messages.value[index]
      if (event.history_id) historyId.value = event.history_id
      if (event.history_saved === false) error.value = tr("本次对话未能保存，请复制所需内容后重试。")
      if (event.type === 'started') { answer.stream = Boolean(event.stream); answer.thinking = !answer.content; answer.status = event.stream ? tr("正在生成…") : tr("等待完整响应…"); answer.parameters = event.parameters }
      if (event.type === 'reasoning' && event.text) { answer.reasoning += event.text; answer.thinking = !answer.content; if (answer.thinking) answer.status = tr("正在思考…") }
      if (event.type === 'delta' && event.text) { if (!answer.content) answer.reasoningExpanded = false; answer.thinking = false; answer.content += event.text; answer.status = tr("正在生成…") }
      if (event.type === 'done') { if (!answer.content) answer.reasoningExpanded = false; if (event.reasoning) answer.reasoning = event.reasoning; answer.thinking = false; answer.content = event.text; answer.complete = true; answer.status = tr("完成 · {0} 秒", [(event.elapsed_ms / 1000).toFixed(1)]); answer.usage = event.usage; answer.outputRate = debugOutputRate(event.usage, event.elapsed_ms); answer.cacheUsage = debugCacheUsage(event.usage); answer.firstDeltaMs = event.first_delta_ms }
      if (event.type === 'error') { answer.thinking = false; answer.status = llmError(event.code) }
      scroll()
    })
  } catch (e) {
    if (!disposed && current === chatVersion) messages.value[index].status = e.name === 'AbortError' ? tr("已停止，未完整的回答不会继续发送。") : llmError(e.response ? e : e.message)
  } finally { if (!disposed && current === chatVersion) { messages.value[index].thinking = false; generating.value = false; await scroll() } }
}
function loadHistory(data) {
  if (generating.value || (messages.value.length && !window.confirm(tr("加载历史将替换当前显示的对话，未发送草稿会保留。继续吗？")))) return
  newSession()
  chatProvider.value = data.provider_id || ''; chatModel.value = data.model_id || ''
  const system = data.messages.find(m => m.role === 'system')
  conversationPrompt.value = system?.content || ''
  useSystemPrompt.value = Boolean(system)
  historyId.value = data.id; loadedHistory.value = true
  debugParameters.value = historyParameters(data.parameters, data.protocol || debugProtocol.value)
  messages.value = data.messages.filter(m => m.role !== 'system').map(m => ({ ...m, complete: m.role === 'user' || m.complete === true, thinking: false, reasoningExpanded: false, status: m.complete ? tr("历史完成") : ({ get cancelled() { return tr("历史已停止") }, get failed() { return tr("历史失败") }, get running() { return tr("历史未完成") } }[m.status] || ''), outputRate: debugOutputRate(m.usage, m.elapsed_ms), cacheUsage: debugCacheUsage(m.usage) }))
  scroll()
}
function historyDeleted(id) { if (historyId.value === id) newSession() }
function replayLast() {
  if (generating.value) return
  const index = messages.value.findLastIndex(m => m.role === 'user')
  if (index < 0 || (input.value && !window.confirm(tr("重放将替换当前未发送的草稿，继续吗？")))) return
  input.value = messages.value[index].content
  messages.value = messages.value.slice(0, index)
}
onMounted(load)
onBeforeUnmount(() => { disposed = true; requests.abort(); chatController?.abort() })
</script>

<template>
  <div class="page-shell space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3"><div><h1 class="page-title">{{ tr("LLM 基础") }}</h1><p class="mt-2 text-sm opacity-65">{{ tr("选择 IOC 提取使用的供应商和模型，并通过对话调试连接。") }}</p></div><button class="btn btn-outline btn-sm" :disabled="loading || busy" @click="refresh">{{ loading ? tr("加载中…") : tr("刷新") }}</button></div>
    <AppAlert v-for="alert in alerts" :key="alert.id" :title="alert.title" type="success" @close="alerts = alerts.filter(a => a.id !== alert.id)" />
    <div v-if="error" role="alert" class="alert alert-error">{{ error }}</div>
    <template v-if="state">
      <form class="card border border-base-300 bg-base-100 p-4 space-y-4" @submit.prevent="save">
        <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="font-semibold">{{ tr("IOC 提取") }}</h2><button class="btn btn-neutral btn-sm" :disabled="busy || loading || !selectionDirty">{{ busy ? tr("保存中…") : tr("保存设置") }}</button></div>
        <label class="flex items-center gap-2 text-sm"><input v-model="enabled" type="checkbox" class="toggle toggle-sm" />{{ tr("启用 LLM IOC 提取") }}</label>
        <div class="space-y-2 border-t border-base-300 pt-3">
          <label class="flex items-center gap-2 text-sm"><input v-model="retainIoc" type="checkbox" class="toggle toggle-sm" />{{ tr("保留文章 IOC 提取对话（包括思考）") }}</label>
          <label class="flex items-center gap-2 text-sm"><input v-model="retainDebug" type="checkbox" class="toggle toggle-sm" />{{ tr("保留调试对话（包括思考）") }}</label>
          <p class="text-xs opacity-60">{{ tr("默认关闭。保存设置后用于后续请求，已保留记录可在历史弹窗中加载或删除。思考仅保留供应商实际返回的文本。") }}</p>
        </div>
        <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
          <label class="form-control text-sm">{{ tr("供应商") }}<select v-model="providerId" class="select select-bordered mt-1 w-full" :required="enabled" @change="chooseProvider"><option disabled selected value="">{{ tr("请选择") }}</option><option v-for="p in state.providers" :key="p.id" :value="p.id">{{ p.name }}</option></select></label>
          <label class="form-control text-sm">{{ tr("模型") }}<select v-model="modelId" class="select select-bordered mt-1 w-full" :required="Boolean(providerId)" :disabled="!providerId"><option disabled selected value="">{{ tr("请选择") }}</option><option v-for="m in availableModels(provider)" :key="m.id" :value="m.id">{{ m.name || m.id }}</option></select></label>
        </div>
        <p class="text-sm opacity-65">{{ tr("一次只使用一组供应商和模型。暂停保留当前选择；可信 IOC 同步继续运行，LLM 提议仍须人工审核。") }}</p>
        <div v-if="state.effective && !selectionDirty" class="rounded-box border border-base-300 p-3 text-sm space-y-1"><p>{{ tr("当前生效：") }}{{ state.providers.find(p => p.id === state.provider_id)?.name }} / {{ state.model_id }}</p><p class="opacity-65">{{ tr("流式") }}{{ state.effective.stream ? tr("开启") : tr("关闭") }} · {{ { system: tr("跟随平台全局"), direct: tr("直连"), custom: tr("指定代理") }[state.effective.proxy_mode] }} · Session {{ state.effective.session_mode === 'disabled' ? tr("关闭") : state.effective.session_mode === 'auto' ? tr("自动生成") : tr("固定值") }}</p></div>
        <router-link to="/llm/providers" class="link text-sm">{{ tr("管理供应商与全局配置") }}</router-link>
      </form>
      <form class="card border border-base-300 bg-base-100 p-4 space-y-4" @submit.prevent="savePrompt">
        <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="font-semibold">{{ tr("IOC 提取提示词") }}</h2><div class="flex flex-wrap gap-2"><button v-if="!promptEditing" type="button" class="btn btn-neutral btn-sm" :disabled="busy || loading" @click="editPrompt">{{ tr("编辑提示词") }}</button><template v-else><button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="cancelPrompt">{{ tr("取消编辑") }}</button><button type="button" class="btn btn-outline btn-sm" :disabled="busy || loading || !state.default_ioc_prompt" @click="restorePrompt">{{ tr("恢复系统默认") }}</button><button class="btn btn-neutral btn-sm" :disabled="busy || loading || !promptDirty">{{ tr("保存提示词") }}</button></template></div></div>
        <p class="text-sm opacity-65">{{ tr("当前使用") }}{{ state.ioc_prompt ? tr("自定义提示词") : tr("系统默认提示词") }}。{{ promptEditing ? tr("修改或恢复默认后，点击保存才会生效。") : tr("点击编辑提示词后可修改。") }} {{ tr("保存后用于后续文章提取；系统默认内容随系统更新。") }}</p>
        <label class="form-control text-sm" for="ioc-system-prompt">{{ tr("系统提示词") }}<textarea id="ioc-system-prompt" v-model="promptDraft" required rows="14" class="textarea textarea-bordered mt-1 w-full font-mono text-sm" :readonly="!promptEditing" :disabled="busy || loading" spellcheck="false" /></label>
        <p class="text-xs opacity-60">{{ tr("支持多行文本，最多") }} {{ state.prompt_max_bytes || 65536 }} {{ tr("字节。请保留 IOC JSON 输出和原文证据要求；所有提议仍须校验及人工审核。") }}</p>
      </form>
      <section class="card border border-base-300 bg-base-100 p-4 space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="font-semibold">{{ tr("在线调试") }}</h2><div class="flex flex-wrap items-center gap-3"><label class="flex items-center gap-2 text-sm"><input v-model="useSystemPrompt" type="checkbox" class="toggle toggle-sm" :disabled="generating" @change="newSession" />{{ tr("启用系统提示词") }}</label><button type="button" class="btn btn-outline btn-sm" :disabled="generating" @click="historyDialog?.open()">{{ tr("加载历史对话") }}</button><button type="button" class="btn btn-neutral btn-sm" @click="newSession({ clearDraft: true })">{{ tr("新建会话／清空") }}</button></div></div>
        <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
          <label class="form-control text-sm">{{ tr("调试供应商") }}<select v-model="chatProvider" class="select select-bordered mt-1 w-full" :disabled="generating" @change="chooseChatProvider"><option disabled selected value="">{{ tr("请选择") }}</option><option v-for="p in state.providers" :key="p.id" :value="p.id">{{ p.name }}</option></select></label>
          <label class="form-control text-sm">{{ tr("调试模型") }}<select v-model="chatModel" class="select select-bordered mt-1 w-full" :disabled="generating || !chatProvider" @change="newSession"><option disabled selected value="">{{ tr("请选择") }}</option><option v-for="m in availableModels(debugProvider)" :key="m.id" :value="m.id">{{ m.name || m.id }}</option></select></label>
        </div>
        <p class="text-xs opacity-60">{{ tr("临时调试不改变 IOC 提取配置。启用系统提示词时使用已保存的内容；切换模型或提示词开关会清空会话。启用保留后可加载历史。新建会话会重新生成 session；历史加载会保留原供应商 session，缓存是否命中仍由供应商决定。") }}</p>
        <div v-if="loadedHistory" class="alert text-sm"><span>{{ tr("已加载历史，继续使用当时的系统提示词和 session。继续发送会另存调试记录；接口或协议变化时请新建会话。") }}</span></div>
        <details v-if="loadedHistory && conversationPrompt" class="collapse collapse-arrow border border-base-300 rounded-box"><summary class="collapse-title text-sm">{{ tr("历史系统提示词") }}</summary><pre class="collapse-content whitespace-pre-wrap break-words text-xs">{{ conversationPrompt }}</pre></details>
        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div class="min-w-0 flex flex-col gap-4">
            <div ref="transcript" role="log" :aria-label="tr(&quot;调试对话&quot;)" aria-live="polite" class="min-h-64 flex-1 max-h-[36rem] overflow-y-auto rounded-box border border-base-300 p-3">
              <p v-if="!messages.length" class="py-12 text-center text-sm opacity-60">{{ tr("选择供应商和模型后发送消息，检查连接与回答。") }}</p>
              <div v-for="(m, index) in messages" :key="index" class="chat" :class="m.role === 'user' ? 'chat-end' : 'chat-start'">
                <div class="chat-header mb-1 opacity-60">{{ m.role === 'user' ? tr("你") : tr("模型") }}</div>
                <div class="row-start-2 min-w-0 max-w-full space-y-2" :class="m.role === 'user' ? 'col-start-1' : 'col-start-2'">
                  <div v-if="m.role === 'assistant' && (m.thinking || m.reasoning)" class="min-w-0 max-w-full text-sm">
                    <div class="flex items-center gap-1">
                      <span :class="m.thinking ? 'skeleton skeleton-text' : 'opacity-65'">{{ m.thinking ? 'Thinking...' : tr("思考数据") }}</span>
                      <button type="button" class="btn btn-ghost btn-xs btn-square" :aria-label="m.reasoningExpanded ? tr(&quot;收起思考数据&quot;) : tr(&quot;展开思考数据&quot;)" :aria-expanded="m.reasoningExpanded" :aria-controls="`debug-reasoning-${index}`" @click="m.reasoningExpanded = !m.reasoningExpanded">
                        <ChevronDown class="size-4 transition-transform" :class="{ '-rotate-90': !m.reasoningExpanded }" aria-hidden="true" />
                      </button>
                    </div>
                    <div v-show="m.reasoningExpanded" :id="`debug-reasoning-${index}`" class="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-base-300 pl-3 text-base-content/65"><LlmInkText v-if="m.reasoning" :text="m.reasoning" :animate="m.stream && m.reasoningExpanded" /><template v-else>{{ tr("等待模型返回思考数据…") }}</template></div>
                  </div>
                  <div v-if="m.content || (!m.thinking && !m.reasoning)" class="chat-bubble max-w-prose whitespace-pre-wrap break-words" :class="m.role === 'user' ? 'chat-bubble-neutral' : 'bg-base-200 text-base-content'"><LlmInkText v-if="m.role === 'assistant'" :text="m.content" :animate="m.stream" /><template v-else>{{ m.content }}</template><template v-if="!m.content">…</template></div>
                </div>
                <div v-if="m.role === 'assistant'" class="chat-footer mt-1 max-w-full flex-wrap break-words text-xs opacity-65">{{ m.status }}<span v-if="m.firstDeltaMs != null"> {{ tr("· 首段") }} {{ (m.firstDeltaMs / 1000).toFixed(1) }} {{ tr("秒") }}</span><span v-if="m.usage?.input_tokens != null"> {{ tr("· 输入") }} {{ m.usage.input_tokens }} token</span><span v-if="m.usage?.output_tokens != null"> {{ tr("· 输出") }} {{ m.usage.output_tokens }} token</span><span v-if="m.usage?.reasoning_tokens != null"> {{ tr("· 思考") }} {{ m.usage.reasoning_tokens }} token</span><p v-if="m.parameters" class="mt-1 basis-full">{{ debugParameterSummary(m.parameters) }}<span :title="tr(&quot;平均输出速率 = 供应商返回的输出 token 数 ÷ 总耗时（包含等待与思考）；未提供用量或耗时无效时显示 —&quot;)"> {{ tr("· 输出速率") }} {{ generating && index === messages.length - 1 && !m.complete ? tr("统计中…") : m.outputRate || '—' }}</span><span :title="tr(&quot;供应商返回的缓存命中输入 token 数&quot;)"> {{ tr("· 缓存命中") }} {{ m.cacheUsage?.tokens || '—' }}</span><span :title="tr(&quot;命中率 = 缓存命中 token 数 ÷ 输入 token 总数；缺少用量、输入为 0 或数据无效时显示 —&quot;)"> {{ tr("· 命中率") }} {{ m.cacheUsage?.hitRate || '—' }}</span></p></div>
              </div>
            </div>
            <form class="space-y-3" @submit.prevent="send">
              <p v-if="draftError" class="text-sm text-warning" role="status">{{ draftError }}</p>
              <label class="form-control text-sm">{{ tr("消息") }}<textarea v-model="input" required maxlength="32000" rows="3" class="textarea textarea-bordered mt-1 mb-5 w-full" :disabled="generating" :placeholder="tr(&quot;输入调试消息，Enter 发送，Shift+Enter 换行&quot;)" @keydown="messageKeydown" />
              </label><p class="text-xs opacity-60 ">{{ tr("未发送草稿在此浏览器保留 7 天，发送或清空后立即移除。") }}</p><div class="flex flex-wrap justify-end gap-2"><button type="button" class="btn btn-ghost btn-sm" :disabled="generating || !messages.some(m => m.role === 'user')" @click="replayLast">{{ tr("重放最后一轮") }}</button><button v-if="generating" type="button" class="btn btn-outline btn-sm" @click="stop">{{ tr("停止生成") }}</button><button class="btn btn-neutral btn-sm" :disabled="generating || !input.trim() || !chatModel">{{ generating ? tr("正在生成…") : tr("发送") }}</button></div></form>
          </div>
          <aside :aria-label="tr(&quot;调试参数&quot;)" class="min-w-0 border-t border-base-300 pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-4">
            <fieldset :disabled="generating" class="space-y-3">
              <div class="flex items-center justify-between gap-2"><h3 class="font-semibold text-sm">{{ tr("调试参数") }}</h3><button type="button" class="btn btn-ghost btn-xs" @click="debugParameters = debugParameterForm()">{{ tr("重置参数") }}</button></div>
              <p class="text-xs opacity-60">{{ tr("仅用于当前调试，下次发送生效；留空继承配置或使用接口默认值。") }}</p>
              <label class="form-control text-xs" for="debug-reasoning">{{ tr("推理强度") }}<select id="debug-reasoning" v-model="debugParameters.reasoning_effort" class="select select-bordered select-sm mt-1 w-full"><option v-for="option in debugReasoningOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
              <label class="form-control text-xs" for="debug-max-tokens">{{ tr("输出上限（token）") }}<input id="debug-max-tokens" v-model="debugParameters.max_output_tokens" type="number" min="1" max="393216" step="1" class="input input-bordered input-sm mt-1 w-full" :placeholder="tr(&quot;继承：{0}&quot;, [debugProvider?.max_output_tokens || 65536])" /></label>
              <label class="form-control text-xs" for="debug-temperature">{{ tr("温度（Temperature）") }}<input id="debug-temperature" v-model="debugParameters.temperature" type="number" min="0" max="2" step="0.1" class="input input-bordered input-sm mt-1 w-full" :placeholder="tr(&quot;接口默认 · 0–2&quot;)" /></label>
              <label class="form-control text-xs" for="debug-top-p">Top P<input id="debug-top-p" v-model="debugParameters.top_p" type="number" min="0" max="1" step="0.05" class="input input-bordered input-sm mt-1 w-full" :placeholder="tr(&quot;接口默认 · 0–1&quot;)" /></label>
              <label class="form-control text-xs" for="debug-timeout">{{ tr("请求超时（秒）") }}<input id="debug-timeout" v-model="debugParameters.timeout_seconds" type="number" min="1" max="1800" step="1" class="input input-bordered input-sm mt-1 w-full" :placeholder="tr(&quot;继承：{0}&quot;, [debugProvider?.timeout_seconds || 180])" /></label>
              <label class="form-control text-xs" for="debug-stream">{{ tr("流式输出") }}<select id="debug-stream" v-model="debugParameters.stream" class="select select-bordered select-sm mt-1 w-full"><option value="inherit">{{ tr("继承请求配置") }}</option><option value="on">{{ tr("开启") }}</option><option value="off">{{ tr("关闭") }}</option></select></label>
              <label v-if="debugProtocol === 'chat'" class="form-control text-xs" for="debug-token-field">{{ tr("输出上限字段") }}<select id="debug-token-field" v-model="debugParameters.token_limit_field" class="select select-bordered select-sm mt-1 w-full"><option value="inherit">{{ tr("兼容接口默认") }}</option><option value="max_tokens">max_tokens</option><option value="max_completion_tokens">max_completion_tokens</option></select></label>
              <p class="text-xs opacity-60">{{ tr("可按模型支持情况选择参数；重置后恢复继承配置。") }}</p>
            </fieldset>
          </aside>
        </div>
      </section>
    </template>
    <LlmHistoryDialog ref="historyDialog" @loaded="loadHistory" @deleted="historyDeleted" />
  </div>
</template>
