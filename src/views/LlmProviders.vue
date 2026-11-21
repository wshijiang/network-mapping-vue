<script setup>
import { tr } from '../i18n/index.js'

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import LlmTransportFields from '@/components/LlmTransportFields.vue'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import { availableModels, clone, llmError, mergeModels, providerForm, settingsPayload, transportForm } from '@/utils/llm'
import http from '@/utils/http'

const state = ref(null), global = ref(transportForm(true)), savedGlobal = ref(''), savedProvider = ref('')
const form = ref(providerForm()), editor = ref(null), preset = ref(''), busy = ref(false), loading = ref(false), refreshing = ref(false)
const alerts = ref([]), error = ref(''), editing = ref(false)
const globalDirty = computed(() => state.value && JSON.stringify(global.value) !== savedGlobal.value)
const providerDirty = computed(() => editing.value && JSON.stringify(form.value) !== savedProvider.value)
const dirty = computed(() => globalDirty.value || providerDirty.value)
const confirmDialog = ref(null)
useUnsavedChanges(dirty, () => providerDirty.value ? saveProvider() : saveGlobal(), confirmDialog)
const requests = new AbortController()
let disposed = false, sequence = 0
function notify(title, type = 'success') { alerts.value.unshift({ id: crypto.randomUUID(), type, title }) }
async function load() {
  const current = ++sequence
  loading.value = true; error.value = ''
  try {
    const r = await http.get('/api/llm/settings', { signal: requests.signal })
    if (disposed || current !== sequence) return
    state.value = r.data.data
    global.value = clone(state.value.global)
    savedGlobal.value = JSON.stringify(global.value)
  } catch (e) { if (!disposed && e.code !== 'ERR_CANCELED') error.value = llmError(e) }
  finally { if (!disposed && current === sequence) loading.value = false }
}
async function refresh() { if (dirty.value && !await confirmDialog.value.ask({ message: tr("刷新将放弃未保存的配置，确定继续吗？"), confirmText: tr("放弃修改"), danger: true })) return; load() }
function open(provider) {
  form.value = providerForm(provider)
  savedProvider.value = JSON.stringify(form.value)
  error.value = ''; editing.value = true; editor.value.showModal()
}
function add() { const template = state.value?.presets.find(p => p.preset === preset.value); open(template || {}) }
async function close() {
  if (busy.value || refreshing.value) return
  if (providerDirty.value && !await confirmDialog.value.ask({ message: tr("有未保存的供应商配置，确定放弃修改吗？"), confirmText: tr("放弃修改"), danger: true })) return
  editor.value.close(); editing.value = false; form.value = providerForm()
}
async function saveGlobal() {
  if (!state.value || busy.value) return false
  busy.value = true; error.value = ''
  try {
    await http.put('/api/llm/settings', settingsPayload(state.value, { global: global.value }), { signal: requests.signal })
    if (!disposed) { await load(); notify(tr("全局配置已保存，供应商的局部设置优先生效。")) }
    return true
  } catch (e) { if (!disposed && e.code !== 'ERR_CANCELED') error.value = llmError(e); return false }
  finally { busy.value = false }
}
async function saveProvider() {
  if (!state.value || busy.value || refreshing.value) return false
  busy.value = true; error.value = ''
  try {
    const provider = { ...form.value }
    if (provider.clear_credential) delete provider.credential
    const payload = { expected_revision: state.value.revision, provider }
    const url = '/api/llm/providers' + (form.value.id ? `/${form.value.id}` : '')
    await http[form.value.id ? 'put' : 'post'](url, payload, { signal: requests.signal })
    if (!disposed) { editor.value.close(); editing.value = false; form.value = providerForm(); await load(); notify(tr("供应商已保存。")) }
    return true
  } catch (e) { if (!disposed && e.code !== 'ERR_CANCELED') error.value = llmError(e); return false }
  finally { busy.value = false }
}
async function remove(provider) {
  if (dirty.value) { error.value = tr("请先保存或放弃当前修改。"); return }
  const active = state.value.provider_id === provider.id
  if (!await confirmDialog.value.ask({ message: active ? tr("删除“{0}”并同时暂停 IOC 提取？", [provider.name]) : tr("确定删除供应商“{0}”？", [provider.name]), confirmText: tr("删除"), danger: true })) return
  busy.value = true; error.value = ''
  try {
    await http.delete(`/api/llm/providers/${provider.id}`, { data: { expected_revision: state.value.revision, pause_extraction: active }, signal: requests.signal })
    if (!disposed) { await load(); notify(tr("供应商已删除。")) }
  } catch (e) { if (!disposed && e.code !== 'ERR_CANCELED') error.value = llmError(e) }
  finally { busy.value = false }
}
async function refreshModels() {
  if (!form.value.id || refreshing.value) return
  refreshing.value = true; error.value = ''
  try {
    const r = await http.post(`/api/llm/providers/${form.value.id}/models/refresh`, {}, { signal: requests.signal })
    if (disposed) return
    form.value.models = mergeModels(form.value.models, r.data.data)
    notify(tr("模型列表已载入草稿，请核对协议、可用状态和默认模型后保存。"), 'info')
  } catch (e) { if (!disposed && e.code !== 'ERR_CANCELED') error.value = llmError(e) }
  finally { refreshing.value = false }
}
function addModel() { form.value.models.push({ id: '', name: '', protocol: form.value.protocol, available: true }) }
onMounted(load)
onBeforeUnmount(() => { disposed = true; requests.abort() })
</script>

<template>
  <div class="page-shell space-y-5">
    <ConfirmDialog ref="confirmDialog" />
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h1 class="page-title">{{ tr("LLM 供应商") }}</h1><p class="mt-2 text-sm opacity-65">{{ tr("管理模型接口与公共请求设置，供应商局部配置可覆盖全局。") }}</p></div><button type="button" class="btn btn-outline btn-sm" :disabled="loading || busy" @click="refresh">{{ loading ? tr("加载中…") : tr("刷新") }}</button></div>
    <AppAlert v-for="alert in alerts" :key="alert.id" :type="alert.type" :title="alert.title" @close="alerts = alerts.filter(a => a.id !== alert.id)" />
    <div v-if="error && !editing" role="alert" class="alert alert-error">{{ error }}</div>
    <template v-if="state">
      <form class="card border border-base-300 bg-base-100 p-4 space-y-4" @submit.prevent="saveGlobal">
        <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="font-semibold">{{ tr("全局配置") }}</h2><button class="btn btn-neutral btn-sm" :disabled="busy || loading || !globalDirty">{{ tr("保存全局配置") }}</button></div>
        <LlmTransportFields v-model="global" global />
      </form>
      <div class="card border border-base-300 bg-base-100 p-4 space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="font-semibold">{{ tr("供应商") }}</h2><div class="flex min-w-0 max-w-full items-center gap-2"><select v-model="preset" :aria-label="tr(&quot;供应商预设&quot;)" class="select select-bordered select-sm min-w-0 w-auto flex-1"><option value="">{{ tr("自定义供应商") }}</option><option v-for="p in state.presets" :key="p.preset" :value="p.preset">{{ p.name }}</option></select><button class="btn btn-neutral btn-sm shrink-0" :disabled="busy || loading || globalDirty" @click="add">{{ tr("添加供应商") }}</button></div></div>
        <div class="overflow-x-auto"><table class="table table-sm"><thead><tr><th>{{ tr("名称") }}</th><th>{{ tr("接口") }}</th><th>{{ tr("模型") }}</th><th>{{ tr("凭据") }}</th><th>{{ tr("操作") }}</th></tr></thead><tbody>
          <tr v-for="p in state.providers" :key="p.id"><td><span class="font-semibold">{{ p.name }}</span><span v-if="state.provider_id === p.id" class="badge badge-outline badge-xs ml-2">{{ tr("IOC 当前选择") }}</span></td><td class="max-w-md break-all">{{ p.endpoint }}<p class="mt-1 text-xs opacity-60">{{ p.protocol === 'responses' ? 'Responses' : 'Chat Completions' }}</p></td><td>{{ p.models.length }} {{ tr("个") }}<p class="text-xs opacity-60">{{ tr("默认：") }}{{ p.default_model || tr("未设置") }}</p></td><td>{{ p.database_credential_configured ? tr("数据库加密") : p.credential_configured ? tr("环境变量") : tr("未配置 API Key") }}</td><td><div class="flex gap-2"><button class="btn btn-ghost btn-xs" :disabled="busy || globalDirty" @click="open(p)">{{ tr("编辑") }}</button><button class="btn btn-ghost btn-xs text-error" :disabled="busy" @click="remove(p)">{{ tr("删除") }}</button></div></td></tr>
          <tr v-if="!state.providers.length"><td colspan="5" class="py-8 text-center opacity-60">{{ tr("暂无供应商，请从预设添加或填写自定义接口。") }}</td></tr>
        </tbody></table></div>
      </div>
    </template>
    <dialog ref="editor" class="modal" @cancel.prevent="close">
      <form class="modal-box w-11/12 max-w-4xl space-y-5" @submit.prevent="saveProvider">
        <h2 class="text-lg font-semibold">{{ form.id ? tr("修改供应商") : tr("添加供应商") }}</h2>
        <div v-if="error" role="alert" class="alert alert-error">{{ error }}</div>
        <fieldset :disabled="busy || refreshing" class="space-y-4">
          <div class="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-3">
            <label class="form-control text-sm">{{ tr("名称") }}<input v-model="form.name" required maxlength="100" class="input input-bordered mt-1 w-full" /></label>
            <label class="form-control text-sm">{{ tr("默认请求格式") }}<select v-model="form.protocol" class="select select-bordered mt-1 w-full"><option value="chat">Chat Completions</option><option value="responses">Responses</option></select></label>
            <label class="form-control min-w-0 text-sm">{{ tr("接口地址") }}<input v-model="form.endpoint" required type="url" class="input input-bordered mt-1 w-full" /><span class="mt-1 text-xs opacity-60">{{ tr("可填 /v1 基础地址或与协议匹配的完整端点。") }}</span></label>
            <label class="form-control min-w-0 text-sm">{{ tr("模型列表地址") }}<input v-model="form.models_url" type="url" class="input input-bordered mt-1 w-full" :placeholder="tr(&quot;https://…/models（可选）&quot;)" /></label>
            <label class="form-control text-sm">API Key<input v-model="form.credential" :disabled="form.clear_credential" type="password" autocomplete="new-password" maxlength="8192" class="input input-bordered mt-1 w-full" :placeholder="form.database_credential_configured ? tr(&quot;已保存，留空保留&quot;) : tr(&quot;输入原始 API Key&quot;)" /></label>
            <label class="form-control text-sm">{{ tr("环境变量备用来源") }}<input v-model="form.key_env" class="input input-bordered mt-1 w-full" :placeholder="tr(&quot;例如 NM_INTEL_AI_API_KEY&quot;)" /></label>
          </div>
          <label v-if="form.database_credential_configured" class="flex items-center gap-2 text-sm"><input v-model="form.clear_credential" type="checkbox" class="checkbox checkbox-sm" />{{ tr("清除数据库 API Key") }}</label>
          <p class="text-xs opacity-60">{{ tr("优先使用数据库加密凭据，未保存时读取环境变量；解密失败不会自动切换凭据。") }}</p>
          <div class="border-t border-base-300 pt-4 space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-3"><h3 class="font-semibold">{{ tr("模型列表") }}</h3><div class="flex gap-2"><button type="button" class="btn btn-outline btn-sm" :disabled="!form.id || !form.models_url" @click="refreshModels">{{ tr("刷新模型") }}</button><button type="button" class="btn btn-outline btn-sm" @click="addModel">{{ tr("手工添加") }}</button></div></div>
            <p class="text-xs opacity-60">{{ tr("刷新使用已保存的接口与凭据，仅更新草稿。OpenCode Go 的模型可能使用不同协议，请逐项核对。") }}</p>
            <div class="overflow-x-auto"><table class="table table-sm"><thead><tr><th>{{ tr("模型 ID") }}</th><th>{{ tr("显示名称") }}</th><th>{{ tr("请求格式") }}</th><th>{{ tr("可用") }}</th><th></th></tr></thead><tbody>
              <tr v-for="(m, index) in form.models" :key="index"><td><input v-model="m.id" required maxlength="100" class="input input-bordered input-sm w-44" :aria-label="tr(&quot;模型 {0} ID&quot;, [index + 1])" /></td><td><input v-model="m.name" maxlength="200" class="input input-bordered input-sm w-36" :aria-label="tr(&quot;模型 {0} 名称&quot;, [index + 1])" /></td><td><select v-model="m.protocol" class="select select-bordered select-sm" :aria-label="tr(&quot;模型 {0} 协议&quot;, [index + 1])"><option value="">{{ tr("供应商默认") }}</option><option value="chat">Chat Completions</option><option value="responses">Responses</option><option value="unsupported">{{ tr("待确认／未适配") }}</option><option value="anthropic">{{ tr("Anthropic（未适配）") }}</option><option value="google">{{ tr("Google（未适配）") }}</option></select></td><td><input v-model="m.available" type="checkbox" class="checkbox checkbox-sm" :aria-label="tr(&quot;模型 {0} 可用&quot;, [index + 1])" /></td><td><button type="button" class="btn btn-ghost btn-xs" @click="form.models.splice(index, 1)">{{ tr("删除") }}</button></td></tr>
            </tbody></table></div>
            <label class="form-control text-sm">{{ tr("默认模型") }}<select v-model="form.default_model" class="select select-bordered mt-1 w-full"><option value="">{{ tr("未设置") }}</option><option v-for="m in availableModels(form)" :key="m.id" :value="m.id">{{ m.name || m.id }}</option></select></label>
          </div>
          <div class="border-t border-base-300 pt-4 space-y-3"><h3 class="font-semibold">{{ tr("请求配置") }}</h3><LlmTransportFields v-model="form.transport" /></div>
          <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3 border-t border-base-300 pt-4">
            <label class="form-control text-sm">{{ tr("请求超时（秒）") }}<input v-model.number="form.timeout_seconds" type="number" min="1" max="1800" required class="input input-bordered mt-1 w-full" /></label>
            <label class="form-control text-sm">{{ tr("输出预算（token）") }}<input v-model.number="form.max_output_tokens" type="number" min="512" max="393216" required class="input input-bordered mt-1 w-full" /></label>
            <label class="form-control text-sm">{{ tr("推理强度") }}<select v-model="form.reasoning_effort" class="select select-bordered mt-1 w-full"><option value="default">{{ tr("接口默认（不发送参数）") }}</option><option value="none">{{ tr("关闭推理") }}</option><option value="low">{{ tr("低") }}</option><option value="medium">{{ tr("中") }}</option><option value="high">{{ tr("高") }}</option><option value="max">{{ tr("最高") }}</option></select></label>
          </div>
        </fieldset>
        <div class="modal-action"><button type="button" class="btn btn-ghost" :disabled="busy || refreshing" @click="close">{{ tr("取消") }}</button><button class="btn btn-neutral" :disabled="busy || refreshing">{{ busy ? tr("保存中…") : refreshing ? tr("正在刷新…") : tr("保存供应商") }}</button></div>
      </form>
    </dialog>
  </div>
</template>
