<script setup>
import { tr } from '../i18n/index.js'

import { computed, onBeforeUnmount, onMounted, ref, watch, useId } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import http from '../utils/http'
import { formatDateTime } from '../i18n/time.js'
import OpenApiPolicyEditor from '../components/OpenApiPolicyEditor.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { apiError, applicationStatus, cloneDocument, curlExample, endpointPath, isMutation, redactInvocationResult, samplePayload } from '../utils/openApi'

const formFieldId = useId()
const route = useRoute(), router = useRouter()
const role = ref('developer'), catalog = ref({ scopes: [], fields: [], endpoints: [] }), initialized = ref(false)
const loading = ref(false), acting = ref(false), message = ref(null), overview = ref({}), applications = ref([]), rows = ref([]), nextAfter = ref(null)
const selected = ref(null), details = ref(null), appTab = ref('overview'), appFilter = ref(''), textFilter = ref(''), usage = ref([]), calls = ref([])
const settings = ref({ document: { enabled: false, retention_days: 30, audit_retention_days: 180, webhook_allowed_hosts: [] }, revision: 1 })
const allowedHostsText = ref(''), roles = ref([]), roleForm = ref({ user_id: '', role: 'auditor' })
const policyDraft = ref(null), metadataDraft = ref({ name: '', purpose: '' }), approval = ref(null), approvalPolicy = ref(null), approvalNote = ref('')
const createDialog = ref(null), keyDialog = ref(null), secretDialog = ref(null), verificationDialog = ref(null), approvalDialog = ref(null), webhookDialog = ref(null), confirmDialog = ref(null)
const createForm = ref({ name: '', purpose: '', kind: 'personal', environment: 'production', owner_user_id: '', policy: {} })
const keyForm = ref({ name: '', expires_days: 90, ip_allowlist: '', scopes: [], overlap_hours: 0, rotate: null })
const secret = ref(''), secretTitle = ref(''), verification = ref({ password: '', totp: '' }), subscriptions = ref([])
const webhookForm = ref({ url: '', event_types: [], enabled: true }), applicationJobs = ref([])
const endpointIndex = ref(0), credentialId = ref(''), payloadText = ref('{}'), parameterValues = ref({}), invocationResult = ref(''), invocationBusy = ref(false)
const documentText = ref(''), documentKind = ref('integration'), approvalReason = ref(''), clock = ref(Date.now())
const policyDatesValid = ref(true), createDatesValid = ref(true), approvalDatesValid = ref(true)
let pendingAction = null, timer = null, applicationSequence = 0, subscriptionSequence = 0, sectionSequence = 0

const section = computed(() => route.path === '/developer/open-api' ? 'apps' : route.path.split('/')[2] || 'overview')
const isAdmin = computed(() => role.value === 'admin'), isAuditor = computed(() => role.value === 'auditor')
const nav = computed(() => [
  ['overview', tr("总览")], ['apps', tr("应用与凭据")], ['catalog', tr("接口目录与调试")], ['approvals', tr("申请与审批")],
  ['logs', tr("调用日志")], ['audit', tr("操作审计")], ['jobs', tr("导出与报告")], ['deliveries', tr("事件投递")], ['docs', tr("接入文档")],
  ...(isAdmin.value ? [['settings', tr("平台设置")], ['roles', tr("管理权限")]] : []),
])
const filteredApplications = computed(() => applications.value.filter(a => !textFilter.value || `${a.name} ${a.purpose}`.toLowerCase().includes(textFilter.value.toLowerCase())))
const filteredEndpoints = computed(() => catalog.value.endpoints.filter(e => !textFilter.value || `${e.path} ${e.summary} ${e.scope}`.toLowerCase().includes(textFilter.value.toLowerCase())))
const activeCredentials = computed(() => (details.value?.credentials || []).filter(k => !k.revoked_at && new Date(k.expires_at).getTime() > clock.value))
const endpoint = computed(() => catalog.value.endpoints[endpointIndex.value] || null)
const parameters = computed(() => endpoint.value?.path.match(/\{([^}]+)\}/g)?.map(v => v.slice(1, -1)) || [])
const invocationPath = computed(() => endpointPath(endpoint.value?.path || '', parameterValues.value))
const codeExample = computed(() => { try { return curlExample(window.location.origin, endpoint.value?.method || 'GET', endpointPath(endpoint.value?.path || '', parameterValues.value, true), JSON.parse(payloadText.value)) } catch { return tr("请求参数必须为有效 JSON。") } })
const canInvoke = computed(() => details.value?.application?.status === 'active' && activeCredentials.value.length && !isAuditor.value)
const scopeSet = computed(() => new Set(details.value?.application?.policy?.scopes || []))
const policyChanges = computed(() => {
  const before = details.value?.application?.policy || {}, after = policyDraft.value || {}
  return Object.keys(after).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map(k => ({ key: k, before: before[k], after: after[k] }))
})
const appStats = computed(() => ({ active: applications.value.filter(a => a.status === 'active').length, pending: applications.value.filter(a => a.status === 'pending').length }))

function time(value) { return value ? formatDateTime(value) : '—' }
function pretty(value) { return JSON.stringify(value, null, 2) }
function notify(kind, text, requestId = '') { message.value = { kind, text, requestId } }
function clearSecret() { secret.value = '' }
function showSecret(value, title) { secret.value = value; secretTitle.value = title; secretDialog.value?.showModal() }
async function copy(value) { try { await navigator.clipboard.writeText(value); notify('success', tr("已复制。")) } catch { notify('error', tr("浏览器不允许复制，请手动选择文本。")) } }
async function api(method, path, payload, config = {}) { const response = await http({ method, url: `/api/open-platform/${path}`, ...(payload === undefined ? {} : { data: payload }), ...config }); return response.data?.data }
async function act(action, success = '') {
  if (acting.value) return
  acting.value = true; message.value = null
  try { await action(); if (success) notify('success', success) }
  catch (error) {
    const info = apiError(error)
    if (info.code === 'step_up_required') { pendingAction = () => act(action, success); verification.value = { password: '', totp: '' }; verificationDialog.value?.showModal() }
    else notify('error', info.message, info.requestId)
  } finally { acting.value = false }
}
async function verify() {
  await act(async () => {
    await api('POST', 'step-up', verification.value)
    verification.value = { password: '', totp: '' }; verificationDialog.value?.close()
    const action = pendingAction; pendingAction = null
    if (action) window.setTimeout(action, 0)
  })
}
function cancelVerification() { verification.value = { password: '', totp: '' }; pendingAction = null }
async function loadApplications() { applications.value = (await api('GET', 'apps'))?.items || [] }
async function loadApp(id, refreshDraft = true) {
  if (!id) return
  const sequence = ++applicationSequence
  if (selected.value !== id) {
    ++subscriptionSequence; subscriptions.value = []; details.value = null; credentialId.value = ''; invocationResult.value = ''; clearSecret()
  }
  const result = await api('GET', `apps/${id}`)
  if (sequence !== applicationSequence) return
  selected.value = id; details.value = result
  if (refreshDraft) { policyDraft.value = structuredClone(result.application.status === 'pending' ? result.application.requested_policy : result.application.policy); metadataDraft.value = { name: result.application.name, purpose: result.application.purpose } }
  if (!activeCredentials.value.some(k => k.id === credentialId.value)) credentialId.value = activeCredentials.value[0]?.id || ''
  const [u, l, j] = await Promise.all([api('GET', 'usage', undefined, { params: { client_id: id } }), api('GET', 'logs', undefined, { params: { client_id: id } }), api('GET', 'jobs', undefined, { params: { client_id: id } })])
  if (sequence !== applicationSequence) return
  usage.value = u?.items || []; calls.value = l?.items || []; applicationJobs.value = j?.items || []
}
async function selectApp(id) {
  if (acting.value) return
  const sequence = applicationSequence + 1
  loading.value = true
  try { await loadApp(id); if (sequence === applicationSequence) await router.replace({ path: route.path, query: { ...route.query, app: id } }) }
  catch (error) { if (sequence === applicationSequence) { const info = apiError(error); notify('error', info.message, info.requestId) } }
  finally { if (sequence === applicationSequence) loading.value = false }
}
async function loadSection(after = null) {
  if (!initialized.value) return
  const sequence = ++sectionSequence, target = section.value, filter = appFilter.value, document = documentKind.value, app = route.query.app
  const current = () => sequence === sectionSequence && target === section.value && filter === appFilter.value && document === documentKind.value && app === route.query.app
  loading.value = true
  if (!after) { rows.value = []; nextAfter.value = null }
  try {
    if (target === 'apps') { const data = await api('GET', 'apps'); if (!current()) return; applications.value = data?.items || []; if (app) await loadApp(String(app)); }
    else if (target === 'catalog') { if (app && selected.value !== app) await loadApp(String(app)); }
    else {
      const list = !['overview', 'settings', 'roles', 'docs'].includes(target)
      const data = await api('GET', target === 'docs' ? `documentation/${document}` : target, undefined, list ? { params: { ...(filter ? { client_id: filter } : {}), ...(after ? { after } : {}) } } : {})
      if (!current()) return
      if (target === 'overview') overview.value = data || {}
      else if (target === 'settings') { settings.value = data; allowedHostsText.value = (data.document.webhook_allowed_hosts || []).join('\n') }
      else if (target === 'roles') roles.value = data?.items || []
      else if (target === 'docs') documentText.value = data?.markdown || ''
      else { rows.value = after ? [...rows.value, ...(data?.items || [])] : data?.items || []; nextAfter.value = data?.next_after || null }
    }
  } catch (error) { if (current()) { const info = apiError(error); notify('error', info.message, info.requestId) } }
  finally { if (current()) loading.value = false }
}
function openCreate() {
  createForm.value = { name: '', purpose: '', kind: 'personal', environment: 'production', owner_user_id: '', policy: cloneDocument(catalog.value.default_policy) }
  createDialog.value?.showModal()
}
async function createApplication() {
  if (!createDatesValid.value) return
  await act(async () => {
    const form = { ...createForm.value }; if (form.owner_user_id) form.owner_user_id = Number(form.owner_user_id); else delete form.owner_user_id
    const app = await api('POST', 'apps', form); createDialog.value?.close(); await loadApplications(); await selectApp(app.id)
  }, tr("应用申请已提交，审批通过后可创建凭据。"))
}
async function changeState(status) {
  const stateVerb = status === 'active' ? tr("启用") : status === 'paused' ? tr("暂停") : tr("归档")
  if (!await confirmDialog.value.ask({ message: tr("确定{0}“{1}”吗？", [stateVerb, details.value.application.name]), confirmText: stateVerb, danger: status !== 'active' && status !== 'paused' })) return
  await act(async () => { await api('POST', `apps/${selected.value}/state`, { status, expected_revision: details.value.application.revision }); await loadApp(selected.value); await loadApplications() }, tr("应用状态已更新。"))
}
async function saveMetadata() {
  await act(async () => { await api('PATCH', `apps/${selected.value}`, { ...metadataDraft.value, expected_revision: details.value.application.revision }); await loadApp(selected.value); await loadApplications() }, tr("应用信息已保存。"))
}
async function savePolicy() {
  if (!policyDatesValid.value) return
  await act(async () => { await api('PATCH', `apps/${selected.value}`, { policy: policyDraft.value, expected_revision: details.value.application.revision }); await loadApp(selected.value) }, tr("授权已发布。旧游标及旧授权生成的文件需要重新生成。"))
}
async function requestPolicy() {
  if (!policyDatesValid.value) return
  await act(async () => { await api('POST', `apps/${selected.value}/requests`, { policy: policyDraft.value, reason: approvalReason.value }); approvalReason.value = '' }, tr("权限与配额申请已提交。"))
}
function openKey(key = null) {
  keyForm.value = { name: key ? `${key.name}（轮换）` : '', expires_days: 90, ip_allowlist: (key?.ip_allowlist || []).join('\n'), scopes: [...(key?.scopes || details.value.application.policy.scopes || [])], overlap_hours: 0, rotate: key?.id || null }
  keyDialog.value?.showModal()
}
async function issueKey() {
  await act(async () => {
    const { rotate, ...form } = keyForm.value; form.ip_allowlist = form.ip_allowlist.split(/[\n,]+/).map(v => v.trim()).filter(Boolean)
    const result = await api('POST', `apps/${selected.value}/credentials${rotate ? `/${rotate}/rotate` : ''}`, form)
    keyDialog.value?.close(); showSecret(result.token, rotate ? tr("新凭据已生成") : tr("凭据已生成")); await loadApp(selected.value, false)
  })
}
async function revokeKey(key) {
  if (!await confirmDialog.value.ask({ message: tr("撤销“{0}”后，新调用和关联后台任务将失去授权。确定撤销吗？", [key.name]), confirmText: tr("撤销"), danger: true })) return
  await act(async () => { await api('POST', `apps/${selected.value}/credentials/${key.id}/revoke`, {}); await loadApp(selected.value, false) }, tr("凭据已撤销。"))
}
function review(item) {
  approval.value = item; approvalPolicy.value = cloneDocument(item.requested_policy); approvalNote.value = ''
  approvalDialog.value?.showModal()
}
function clearApprovalDraft() { approval.value = null; approvalPolicy.value = null; approvalNote.value = '' }
async function submitReview(approved) {
  if (approved && !approvalDatesValid.value) return
  await act(async () => { await api('POST', `approvals/${approval.value.id}/review`, { approved, ...(approved ? { policy: approvalPolicy.value } : {}), note: approvalNote.value }); approvalDialog.value?.close(); await loadSection(); await loadApplications() }, approved ? tr("申请已批准。") : tr("申请已驳回。"))
}
function chooseEndpoint(e) { endpointIndex.value = catalog.value.endpoints.indexOf(e); payloadText.value = pretty(samplePayload(e.path, e.method)); parameterValues.value = {}; invocationResult.value = '' }
async function invoke(method, path, payload = {}, config = {}) {
  if (!selected.value || !credentialId.value) throw new Error(tr("请选择应用和有效凭据。"))
  return api('POST', `apps/${selected.value}/invoke`, { credential_id: credentialId.value, method, path, payload }, { headers: { 'Idempotency-Key': crypto.randomUUID() }, ...config })
}
async function runExample() {
  if (!endpoint.value || invocationBusy.value) return
  if (parameters.value.some(k => !parameterValues.value[k])) { notify('error', tr("请填写路径参数。")); return }
  let payload
  try { payload = JSON.parse(payloadText.value) } catch { notify('error', tr("请求参数必须为有效 JSON。")); return }
  if (isMutation(endpoint.value.method, endpoint.value.path) && !await confirmDialog.value.ask({ message: tr("执行 {0} 会变更当前应用的业务资源。确定执行吗？", [endpoint.value.summary]), confirmText: tr("确认执行"), danger: true })) return
  invocationBusy.value = true
  const client = selected.value, credential = credentialId.value
  try {
    const result = await invoke(endpoint.value.method, invocationPath.value, payload)
    if (client !== selected.value || credential !== credentialId.value) return
    invocationResult.value = pretty(redactInvocationResult(result))
    if (result?.signing_secret) showSecret(result.signing_secret, tr("事件签名密钥已生成"))
  }
  catch (error) { if (client === selected.value && credential === credentialId.value) { const info = apiError(error, error.message); invocationResult.value = pretty({ error: info.message, request_id: info.requestId }); notify('error', info.message, info.requestId) } }
  finally { invocationBusy.value = false }
}
async function downloadJob(job) {
  await act(async () => {
    if (selected.value !== job.client_id) await loadApp(job.client_id)
    const path = job.kind === 'report' ? `/reports/${job.id}/artifacts/json` : `/exports/${job.id}/download`
    const response = await http.post(`/api/open-platform/apps/${selected.value}/invoke`, { credential_id: credentialId.value, method: 'GET', path, payload: {} }, { responseType: 'blob' })
    const url = URL.createObjectURL(response.data), link = document.createElement('a'); link.href = url
    link.download = response.headers['content-disposition']?.match(/filename="([^"]+)"/)?.[1] || `${job.kind}-${job.id}.json`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
}
async function jobAction(job, action) {
  if (!await confirmDialog.value.ask({ message: action === 'cancel' ? tr("确定取消此导出任务吗？") : tr("确定删除此导出生成物吗？"), confirmText: action === 'cancel' ? tr("确认取消") : tr("删除"), danger: true })) return
  await act(async () => { if (selected.value !== job.client_id) await loadApp(job.client_id); await invoke(action === 'cancel' ? 'POST' : 'DELETE', `/exports/${job.id}${action === 'cancel' ? '/cancel' : ''}`); await loadApp(selected.value, false); if (section.value === 'jobs') await loadSection() }, tr("导出已更新。"))
}
async function retryDelivery(item) {
  if (!await confirmDialog.value.ask({ message: tr("确定重新投递此事件吗？接收方需要按事件 ID 去重。"), confirmText: tr("继续") })) return
  await act(async () => { if (selected.value !== item.client_id) await loadApp(item.client_id); await invoke('POST', `/webhook-deliveries/${item.id}/retry`); await loadSection() }, tr("投递已重新入队。"))
}
async function fetchSubscriptions() {
  const client = selected.value, credential = credentialId.value, sequence = ++subscriptionSequence
  subscriptions.value = []
  const result = await invoke('GET', '/webhooks')
  if (client === selected.value && credential === credentialId.value && sequence === subscriptionSequence) subscriptions.value = result?.items || []
}
async function loadSubscriptions() {
  const client = selected.value, credential = credentialId.value
  try { await fetchSubscriptions() }
  catch (error) { if (client === selected.value && credential === credentialId.value) { const info = apiError(error); notify('error', info.message, info.requestId) } }
}
function editWebhook(hook) { webhookForm.value = { id: hook.id, url: hook.url, event_types: cloneDocument(hook.event_types), enabled: hook.enabled }; webhookDialog.value?.showModal() }
function newWebhook() { webhookForm.value = { url: '', event_types: [], enabled: true }; webhookDialog.value?.showModal() }
async function createWebhook() { await act(async () => { const { id, ...payload } = webhookForm.value; const result = await invoke(id ? 'PATCH' : 'POST', id ? `/webhooks/${id}` : '/webhooks', payload); webhookDialog.value?.close(); if (result.signing_secret) showSecret(result.signing_secret, tr("事件签名密钥已生成")); await fetchSubscriptions() }) }
async function webhookAction(hook, action) { if (isAuditor.value || !canInvoke.value) return; if (action === 'delete' && !window.confirm(tr("确定停用此事件订阅吗？"))) return; await act(async () => { await invoke(action === 'delete' ? 'DELETE' : 'POST', `/webhooks/${hook.id}${action === 'test' ? '/test' : ''}`); await fetchSubscriptions() }, action === 'test' ? tr("测试事件已入队。") : tr("订阅已停用。")) }
async function saveSettings() { await act(async () => { settings.value.document.webhook_allowed_hosts = allowedHostsText.value.split(/[\n,]+/).map(v => v.trim()).filter(Boolean); await api('PUT', 'settings', { document: settings.value.document, expected_revision: settings.value.revision }); await loadSection() }, tr("平台设置已发布。")) }
async function saveRole() { await act(async () => { await api('PUT', `roles/${Number(roleForm.value.user_id)}`, { role: roleForm.value.role }); await loadSection() }, tr("开放平台管理权限已更新。")) }
async function exportOpenApi() { const response = await http.get('/api/open-platform/openapi.json'); const url = URL.createObjectURL(new Blob([pretty(response.data)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'network-mapping-openapi.json'; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }

watch(section, () => { textFilter.value = ''; rows.value = []; nextAfter.value = null; loadSection() })
watch([selected, credentialId, appTab], () => { ++subscriptionSequence; subscriptions.value = []; if (appTab.value === 'webhooks' && canInvoke.value) loadSubscriptions() })
watch(documentKind, () => { if (section.value === 'docs') loadSection() })
onMounted(async () => {
  try { const [s, c] = await Promise.all([api('GET', 'session'), api('GET', 'catalog')]); role.value = s.role; catalog.value = c; await loadApplications(); initialized.value = true; await loadSection() }
  catch (error) { const info = apiError(error); notify('error', info.message, info.requestId) }
  timer = window.setInterval(() => { clock.value = Date.now(); if (!document.hidden && !loading.value && !acting.value && ['overview', 'jobs', 'deliveries'].includes(section.value)) loadSection() }, 30000)
})
onBeforeUnmount(() => { ++sectionSequence; ++applicationSequence; ++subscriptionSequence; if (timer) window.clearInterval(timer); clearSecret(); cancelVerification() })
</script>

<template>
  <main class="page-shell space-y-5">
    <ConfirmDialog ref="confirmDialog" />
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h1 class="page-title">{{ tr("开放平台") }}</h1><p class="mt-1 text-sm opacity-60">{{ tr("管理应用接入、授权范围和业务自动化。") }}</p></div><div class="flex items-center gap-2"><span class="badge badge-outline">{{ { admin: tr("平台管理员"), operator: tr("运营人员"), auditor: tr("审计人员"), developer: tr("开发者") }[role] }}</span><button class="btn btn-sm btn-ghost" :disabled="loading" @click="loadSection()">{{ tr("刷新") }}</button></div></div>
    <div v-if="message" role="alert" class="alert" :class="message.kind === 'error' ? 'alert-error' : 'alert-success'"><div><p>{{ message.text }}</p><p v-if="message.requestId" class="mt-1 font-mono text-xs">{{ tr("请求 ID：") }}{{ message.requestId }}</p></div><button class="btn btn-ghost btn-xs" :aria-label="tr(&quot;关闭提示&quot;)" @click="message = null">{{ tr("关闭") }}</button></div>
    <nav class="flex flex-wrap gap-1 rounded-xl bg-base-100 p-2"><router-link v-for="[id, label] in nav" :key="id" :to="{ path: id === 'overview' ? '/open-platform' : `/open-platform/${id}`, query: selected ? { app: selected } : {} }" class="btn btn-sm" :class="section === id ? 'btn-neutral' : 'btn-ghost'">{{ label }}</router-link></nav>
    <div v-if="loading" class="flex items-center gap-2 text-sm opacity-60"><span class="loading loading-spinner loading-xs" />{{ tr("正在加载…") }}</div>
    <div v-if="!initialized && !loading" class="rounded-xl bg-base-100 p-6"><p>{{ tr("开放平台暂时无法加载。") }}</p><button class="btn btn-sm mt-3" @click="router.go(0)">{{ tr("重新加载") }}</button></div>

    <template v-if="section === 'overview' && initialized">
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"><div v-for="[key, label] in [[&#39;applications&#39;, tr(&quot;应用总数&quot;)], [&#39;active&#39;, tr(&quot;已启用&quot;)], [&#39;pending&#39;, tr(&quot;待审批&quot;)], [&#39;calls&#39;, tr(&quot;近 24 小时调用&quot;)], [&#39;errors&#39;, tr(&quot;近 24 小时错误&quot;)]]" :key="key" class="rounded-xl border border-base-300 bg-base-100 p-5"><p class="text-sm opacity-60">{{ label }}</p><p class="mt-2 text-3xl font-semibold">{{ Number(overview[key] || 0).toLocaleString() }}</p></div></div>
      <div class="grid gap-4 lg:grid-cols-2"><div class="rounded-xl bg-base-100 p-6"><h2 class="font-semibold">{{ tr("接入流程") }}</h2><ol class="mt-4 list-decimal space-y-3 pl-5 text-sm"><li>{{ tr("申请应用，填写用途、功能和数据范围。") }}</li><li>{{ tr("审批通过后创建独立凭据，保存一次性显示的密钥。") }}</li><li>{{ tr("从接口目录选择功能，验证返回数据和配额。") }}</li><li>{{ tr("通过调用日志、请求 ID 和事件投递排查问题。") }}</li></ol><router-link class="btn btn-neutral btn-sm mt-5" to="/open-platform/apps">{{ tr("管理我的应用") }}</router-link></div><div class="rounded-xl bg-base-100 p-6"><h2 class="font-semibold">{{ tr("运行情况") }}</h2><p class="mt-4 text-sm opacity-70">{{ tr("近 24 小时 P95 请求耗时") }}</p><p class="mt-2 text-3xl font-semibold">{{ Number(overview.p95_ms || 0).toFixed(1) }} <span class="text-base opacity-60">ms</span></p><p class="mt-5 text-sm opacity-60">{{ tr("同一应用的所有凭据共享额度。查询不会自动创建扫描；扫描需单独授权。") }}</p></div></div>
    </template>

    <template v-if="section === 'apps' && initialized">
      <div class="flex flex-wrap items-center justify-between gap-3"><div class="flex items-center gap-2"><input v-model="textFilter" class="input input-bordered input-sm" :placeholder="tr(&quot;搜索应用或用途&quot;)" /><span class="text-xs opacity-60">{{ appStats.active }} {{ tr("个启用 ·") }} {{ appStats.pending }} {{ tr("个待审批") }}</span></div><button v-if="!isAuditor" class="btn btn-neutral btn-sm" @click="openCreate">{{ tr("申请应用") }}</button></div>
      <div class="overflow-x-auto rounded-xl bg-base-100"><table class="table"><thead><tr><th>{{ tr("应用") }}</th><th>{{ tr("类型") }}</th><th>{{ tr("环境") }}</th><th>{{ tr("状态") }}</th><th>{{ tr("数据范围") }}</th><th>{{ tr("更新") }}</th><th /></tr></thead><tbody><tr v-for="app in filteredApplications" :key="app.id" :class="selected === app.id ? 'bg-neutral/5' : ''"><td><div class="font-medium">{{ app.name }}</div><div class="max-w-xs truncate text-xs opacity-60">{{ app.purpose }}</div></td><td>{{ app.kind === 'partner' ? tr("合作方") : tr("个人工具") }}</td><td>{{ app.environment === 'sandbox' ? tr("沙箱") : tr("生产") }}</td><td><span class="badge badge-sm" :class="applicationStatus(app.status)[1]">{{ applicationStatus(app.status)[0] }}</span></td><td>{{ app.policy.data_mode === 'owner' ? tr("责任用户数据") : tr("应用任务数据") }}</td><td class="text-xs">{{ time(app.updated_at) }}</td><td><button class="btn btn-sm btn-ghost" @click="selectApp(app.id)">{{ tr("详情") }}</button></td></tr></tbody></table><div v-if="!applications.length && !loading" class="p-8 text-center text-sm opacity-60">{{ tr("暂无应用。申请应用后即可开始接入。") }}</div></div>
      <div v-if="details" class="rounded-xl border border-base-300 bg-base-100 p-4 sm:p-6">
        <div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="text-xl font-semibold">{{ details.application.name }}</h2><p class="mt-1 font-mono text-xs opacity-60">{{ details.application.id }}</p></div><div v-if="!isAuditor" class="flex gap-2"><button v-if="isAdmin && details.application.status === 'paused'" class="btn btn-sm" :disabled="acting" @click="changeState('active')">{{ tr("启用") }}</button><button v-if="details.application.status === 'active'" class="btn btn-sm" :disabled="acting" @click="changeState('paused')">{{ tr("暂停") }}</button><button v-if="details.application.status !== 'archived'" class="btn btn-sm btn-outline btn-error" :disabled="acting" @click="changeState('archived')">{{ tr("归档") }}</button></div></div>
        <div class="tabs tabs-border my-4 overflow-x-auto"><button v-for="[id, label] in [[&#39;overview&#39;, tr(&quot;概览&quot;)], [&#39;policy&#39;, tr(&quot;授权与配额&quot;)], [&#39;keys&#39;, tr(&quot;凭据&quot;)], [&#39;usage&#39;, tr(&quot;用量与调用&quot;)], [&#39;jobs&#39;, tr(&quot;导出与报告&quot;)], [&#39;webhooks&#39;, tr(&quot;事件订阅&quot;)]]" :key="id" class="tab whitespace-nowrap" :class="appTab === id ? 'tab-active' : ''" @click="appTab = id">{{ label }}</button></div>
        <div v-if="appTab === 'overview'" class="space-y-4"><p class="text-sm">{{ details.application.purpose }}</p><div class="grid gap-3 sm:grid-cols-3"><div><span class="text-xs opacity-60">{{ tr("状态") }}</span><p>{{ applicationStatus(details.application.status)[0] }}</p></div><div><span class="text-xs opacity-60">{{ tr("授权版本") }}</span><p>{{ details.application.policy_revision }}</p></div><div><span class="text-xs opacity-60">{{ tr("到期") }}</span><p>{{ time(details.application.expires_at) }}</p></div></div><div v-if="!isAuditor" class="grid gap-3 sm:grid-cols-2"><fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-1`">{{ tr("名称") }}</label></legend><input :id="`${formFieldId}-1`" v-model="metadataDraft.name" class="input input-bordered w-full" maxlength="100" /></fieldset><fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-2`">{{ tr("用途") }}</label></legend><input :id="`${formFieldId}-2`" v-model="metadataDraft.purpose" class="input input-bordered w-full" maxlength="2000" /></fieldset><button class="btn btn-sm w-fit" :disabled="acting" @click="saveMetadata">{{ tr("保存信息") }}</button></div><p v-if="details.application.environment === 'sandbox'" class="text-sm text-warning">{{ tr("沙箱凭据可查询已批准的数据，但不能提交真实扫描；该环境不生成模拟资产。") }}</p></div>
        <div v-if="appTab === 'policy' && policyDraft" class="space-y-4"><OpenApiPolicyEditor v-model="policyDraft" :catalog="catalog" :disabled="isAuditor" @validity-change="policyDatesValid = $event" /><div v-if="policyChanges.length" class="overflow-x-auto"><table class="table table-xs"><thead><tr><th>{{ tr("变更项") }}</th><th>{{ tr("现有值") }}</th><th>{{ tr("拟发布值") }}</th></tr></thead><tbody><tr v-for="change in policyChanges" :key="change.key"><td>{{ change.key }}</td><td class="max-w-xs break-words">{{ pretty(change.before) }}</td><td class="max-w-xs break-words">{{ pretty(change.after) }}</td></tr></tbody></table></div><button v-if="isAdmin && details.application.status !== 'pending'" class="btn btn-neutral btn-sm" :disabled="acting || !policyDatesValid" @click="savePolicy">{{ tr("发布授权") }}</button><div v-else-if="!isAuditor" class="flex flex-wrap gap-3"><input v-model="approvalReason" class="input input-bordered input-sm flex-1" :placeholder="tr(&quot;说明权限或配额调整用途&quot;)" maxlength="2000" /><button class="btn btn-neutral btn-sm" :disabled="acting || !policyDatesValid || !approvalReason.trim()" @click="requestPolicy">{{ tr("提交审批") }}</button></div></div>
        <div v-if="appTab === 'keys'"><div class="mb-4 flex justify-between"><p class="text-sm opacity-60">{{ tr("密钥只在生成时显示。应用暂停、到期或凭据撤销后，新调用将被拒绝。") }}</p><button v-if="!isAuditor" class="btn btn-neutral btn-sm" :disabled="details.application.status !== 'active'" @click="openKey()">{{ tr("创建凭据") }}</button></div><div class="overflow-x-auto"><table class="table table-sm"><thead><tr><th>{{ tr("名称") }}</th><th>{{ tr("状态") }}</th><th>{{ tr("到期") }}</th><th>{{ tr("最近调用") }}</th><th>{{ tr("权限") }}</th><th /></tr></thead><tbody><tr v-for="key in details.credentials" :key="key.id"><td>{{ key.name }}<p class="font-mono text-[10px] opacity-50">{{ key.id }}</p></td><td>{{ key.revoked_at ? tr("已撤销") : new Date(key.expires_at).getTime() < clock ? tr("已过期") : tr("有效") }}</td><td class="text-xs">{{ time(key.expires_at) }}</td><td class="text-xs">{{ time(key.last_used_at) }}</td><td class="max-w-xs break-words text-xs">{{ key.scopes.join(', ') }}</td><td><div v-if="!isAuditor && !key.revoked_at" class="flex gap-1"><button class="btn btn-xs" @click="openKey(key)">{{ tr("轮换") }}</button><button class="btn btn-xs btn-ghost text-error" @click="revokeKey(key)">{{ tr("撤销") }}</button></div></td></tr></tbody></table><p v-if="!details.credentials.length" class="p-5 text-center text-sm opacity-60">{{ tr("暂无凭据。") }}</p></div></div>
        <div v-if="appTab === 'usage'" class="space-y-4"><h3 class="text-sm font-semibold">{{ tr("配额消耗") }}</h3><div class="max-h-72 overflow-auto"><table class="table table-sm"><thead><tr><th>{{ tr("类别") }}</th><th>{{ tr("周期起点") }}</th><th>{{ tr("已用额度") }}</th></tr></thead><tbody><tr v-for="(item, index) in usage" :key="index"><td class="font-mono text-xs">{{ item.category }}</td><td>{{ time(item.bucket_start) }}</td><td>{{ item.units }}</td></tr></tbody></table></div><h3 class="text-sm font-semibold">{{ tr("最近调用") }}</h3><div class="max-h-72 overflow-auto"><table class="table table-xs"><thead><tr><th>{{ tr("接口") }}</th><th>{{ tr("状态") }}</th><th>{{ tr("耗时") }}</th><th>{{ tr("原因") }}</th><th>{{ tr("请求 ID") }}</th></tr></thead><tbody><tr v-for="item in calls" :key="item.id"><td class="font-mono">{{ item.method }} {{ item.route }}</td><td>{{ item.status }}</td><td>{{ item.duration_ms }} ms</td><td>{{ item.reason_code || '—' }}</td><td class="font-mono">{{ item.request_id }}</td></tr></tbody></table></div></div>
        <div v-if="appTab === 'jobs'" class="overflow-x-auto"><table class="table table-sm"><thead><tr><th>{{ tr("类型") }}</th><th>{{ tr("任务") }}</th><th>{{ tr("状态") }}</th><th>{{ tr("到期") }}</th><th /></tr></thead><tbody><tr v-for="job in applicationJobs" :key="job.id"><td>{{ job.kind === 'report' ? tr("报告") : tr("导出") }}</td><td class="font-mono text-xs">{{ job.id }}</td><td>{{ job.status }}</td><td>{{ time(job.expires_at) }}</td><td><button v-if="job.status === 'succeeded' && !isAuditor" class="btn btn-xs" :disabled="!activeCredentials.length" @click="downloadJob(job)">{{ tr("下载") }}</button><button v-if="job.kind === 'export' && ['queued', 'running'].includes(job.status) && !isAuditor" class="btn btn-xs ml-1" :disabled="acting" @click="jobAction(job, 'cancel')">{{ tr("取消") }}</button><button v-if="job.kind === 'export' && job.status !== 'deleted' && !isAuditor" class="btn btn-xs btn-ghost text-error ml-1" :disabled="acting" @click="jobAction(job, 'delete')">{{ tr("删除生成物") }}</button></td></tr></tbody></table><p v-if="!applicationJobs.length" class="p-5 text-center text-sm opacity-60">{{ tr("暂无导出或报告。从接口调试可提交生成请求。") }}</p></div>
        <div v-if="appTab === 'webhooks'" class="space-y-4"><div class="flex flex-wrap items-center gap-2"><select v-model="credentialId" class="select select-bordered select-sm"><option v-for="key in activeCredentials" :key="key.id" :value="key.id">{{ key.name }}</option></select><button class="btn btn-sm" :disabled="!canInvoke" @click="loadSubscriptions">{{ tr("刷新订阅") }}</button><button class="btn btn-neutral btn-sm" :disabled="!canInvoke || !scopeSet.has('webhooks:manage')" @click="newWebhook">{{ tr("创建订阅") }}</button></div><div class="overflow-x-auto"><table class="table table-sm"><thead><tr><th>{{ tr("回调地址") }}</th><th>{{ tr("事件") }}</th><th>{{ tr("状态") }}</th><th /></tr></thead><tbody><tr v-for="hook in subscriptions" :key="hook.id"><td class="max-w-xs break-all">{{ hook.url }}</td><td class="text-xs">{{ hook.event_types.join(', ') }}</td><td>{{ hook.enabled ? tr("启用") : tr("暂停") }}</td><td><div v-if="!isAuditor" class="flex gap-1"><button class="btn btn-xs" :disabled="acting || !canInvoke" @click="editWebhook(hook)">{{ tr("编辑") }}</button><button class="btn btn-xs" :disabled="acting || !canInvoke || !hook.enabled" @click="webhookAction(hook, 'test')">{{ tr("测试") }}</button><button class="btn btn-xs btn-ghost text-error" :disabled="acting || !canInvoke" @click="webhookAction(hook, 'delete')">{{ tr("停用") }}</button></div></td></tr></tbody></table><p v-if="!subscriptions.length" class="p-5 text-center text-sm opacity-60">{{ tr("暂无订阅；需批准事件权限及回调域名。") }}</p></div></div>
      </div>
    </template>

    <template v-if="section === 'catalog' && initialized">
      <div class="flex flex-wrap justify-between gap-3"><input v-model="textFilter" class="input input-bordered input-sm" :placeholder="tr(&quot;搜索路径、功能或权限&quot;)" /><button class="btn btn-sm" @click="exportOpenApi">{{ tr("下载 OpenAPI 契约") }}</button></div>
      <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><div class="max-h-[75vh] overflow-auto rounded-xl bg-base-100"><table class="table table-sm"><thead><tr><th>{{ tr("方法") }}</th><th>{{ tr("接口与功能") }}</th><th>{{ tr("权限") }}</th></tr></thead><tbody><tr v-for="item in filteredEndpoints" :key="`${item.method}:${item.path}`" class="cursor-pointer hover:bg-base-200" @click="chooseEndpoint(item)"><td><span class="badge badge-sm badge-outline">{{ item.method }}</span></td><td><p class="font-mono text-xs">{{ item.path }}</p><p class="mt-1 text-xs opacity-60">{{ item.summary }}</p></td><td class="text-xs">{{ item.scope }}</td></tr></tbody></table></div><div class="space-y-4 rounded-xl bg-base-100 p-5"><h2 class="font-semibold">{{ endpoint?.summary || tr("选择接口") }}</h2><div class="grid gap-3 sm:grid-cols-2"><fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-3`">{{ tr("应用") }}</label></legend><select :id="`${formFieldId}-3`" :value="selected || ''" class="select select-bordered select-sm w-full" @change="selectApp($event.target.value)"><option value="" disabled>{{ tr("请选择") }}</option><option v-for="app in applications" :key="app.id" :value="app.id">{{ app.name }}</option></select></fieldset><fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-4`">{{ tr("凭据") }}</label></legend><select :id="`${formFieldId}-4`" v-model="credentialId" class="select select-bordered select-sm w-full"><option value="" disabled>{{ tr("请选择") }}</option><option v-for="key in activeCredentials" :key="key.id" :value="key.id">{{ key.name }}</option></select></fieldset></div><fieldset v-for="key in parameters" :key="key" class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-5-${key}`">{{ key }}</label></legend><input :id="`${formFieldId}-5-${key}`" v-model="parameterValues[key]" class="input input-bordered input-sm w-full" /></fieldset><fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label for="openplatform-payloadtext">{{ tr("请求参数") }} {{ endpoint?.method === 'GET' ? tr("（查询参数）") : '' }}</label></legend><textarea id="openplatform-payloadtext" v-model="payloadText" class="textarea textarea-bordered min-h-40 font-mono text-xs w-full" spellcheck="false" /></fieldset><div class="flex gap-2"><button class="btn btn-neutral btn-sm" :disabled="!canInvoke || invocationBusy" @click="runExample">{{ invocationBusy ? tr("调用中…") : tr("执行调用") }}</button><button class="btn btn-sm btn-ghost" @click="copy(codeExample)">{{ tr("复制 cURL") }}</button></div><p class="text-xs opacity-60">{{ tr("调试使用当前登录会话和所选凭据的授权，不读取凭据密钥。写操作会产生真实业务变更。") }}</p><pre class="max-h-48 overflow-auto rounded-lg bg-base-200 p-3 text-xs">{{ codeExample }}</pre><pre v-if="invocationResult" class="max-h-80 overflow-auto rounded-lg bg-base-200 p-3 text-xs">{{ invocationResult }}</pre></div></div>
    </template>

    <template v-if="section === 'approvals' && initialized"><div class="overflow-x-auto rounded-xl bg-base-100"><table class="table"><thead><tr><th>{{ tr("应用") }}</th><th>{{ tr("申请原因") }}</th><th>{{ tr("状态") }}</th><th>{{ tr("提交时间") }}</th><th>{{ tr("意见") }}</th><th /></tr></thead><tbody><tr v-for="item in rows" :key="item.id"><td>{{ item.name }}</td><td class="max-w-sm break-words">{{ item.reason }}</td><td>{{ { pending: tr("待审核"), approved: tr("已批准"), rejected: tr("已驳回") }[item.status] }}</td><td class="text-xs">{{ time(item.created_at) }}</td><td>{{ item.review_note || '—' }}</td><td><button class="btn btn-sm" @click="review(item)">{{ isAdmin && item.status === 'pending' ? tr("审核") : tr("详情") }}</button></td></tr></tbody></table><div v-if="!rows.length && !loading" class="p-8 text-center opacity-60">{{ tr("暂无申请。") }}</div></div></template>

    <template v-if="['logs', 'audit', 'jobs', 'deliveries'].includes(section) && initialized">
      <div class="flex gap-2"><select v-model="appFilter" class="select select-bordered select-sm" @change="loadSection()"><option value="">{{ tr("全部可见应用") }}</option><option v-for="app in applications" :key="app.id" :value="app.id">{{ app.name }}</option></select><span class="self-center text-xs opacity-60">{{ section === 'logs' || section === 'audit' ? tr("每页 100 条，可继续加载") : tr("最近 100 条") }}</span></div>
      <div class="overflow-x-auto rounded-xl bg-base-100"><table v-if="section === 'logs'" class="table table-sm"><thead><tr><th>{{ tr("时间") }}</th><th>{{ tr("接口") }}</th><th>{{ tr("状态") }}</th><th>{{ tr("耗时") }}</th><th>{{ tr("原因") }}</th><th>{{ tr("请求 ID") }}</th></tr></thead><tbody><tr v-for="item in rows" :key="item.id"><td class="text-xs">{{ time(item.created_at) }}</td><td class="font-mono text-xs">{{ item.method }} {{ item.route }}</td><td :class="item.status >= 400 ? 'text-error' : ''">{{ item.status }}</td><td>{{ item.duration_ms }} ms</td><td>{{ item.reason_code || '—' }}</td><td class="font-mono text-xs">{{ item.request_id }}</td></tr></tbody></table><table v-if="section === 'audit'" class="table table-sm"><thead><tr><th>{{ tr("时间") }}</th><th>{{ tr("操作者") }}</th><th>{{ tr("动作") }}</th><th>{{ tr("资源") }}</th><th>{{ tr("变更") }}</th><th>{{ tr("请求 ID") }}</th></tr></thead><tbody><tr v-for="item in rows" :key="item.id"><td class="text-xs">{{ time(item.created_at) }}</td><td>{{ item.actor_type }} / {{ item.actor_id }}</td><td class="font-mono text-xs">{{ item.action }}</td><td class="max-w-xs break-all text-xs">{{ item.resource_id }}</td><td><details><summary class="cursor-pointer">{{ tr("查看") }}</summary><pre class="max-h-60 max-w-lg overflow-auto text-xs">{{ pretty(item.changes) }}</pre></details></td><td class="font-mono text-xs">{{ item.request_id }}</td></tr></tbody></table><table v-if="section === 'jobs'" class="table table-sm"><thead><tr><th>{{ tr("类型") }}</th><th>{{ tr("任务") }}</th><th>{{ tr("状态") }}</th><th>{{ tr("创建时间") }}</th><th>{{ tr("失败原因") }}</th><th /></tr></thead><tbody><tr v-for="item in rows" :key="item.id"><td>{{ item.kind === 'report' ? tr("报告") : tr("导出") }}</td><td class="font-mono text-xs">{{ item.id }}</td><td>{{ item.status }}</td><td class="text-xs">{{ time(item.created_at) }}</td><td>{{ item.last_error || '—' }}</td><td><button v-if="item.status === 'succeeded' && !isAuditor" class="btn btn-xs" @click="downloadJob(item)">{{ tr("下载") }}</button><button v-if="item.kind === 'export' && ['queued', 'running'].includes(item.status) && !isAuditor" class="btn btn-xs ml-1" :disabled="acting" @click="jobAction(item, 'cancel')">{{ tr("取消") }}</button><button v-if="item.kind === 'export' && item.status !== 'deleted' && !isAuditor" class="btn btn-xs btn-ghost text-error ml-1" :disabled="acting" @click="jobAction(item, 'delete')">{{ tr("删除生成物") }}</button></td></tr></tbody></table><table v-if="section === 'deliveries'" class="table table-sm"><thead><tr><th>{{ tr("投递") }}</th><th>{{ tr("状态") }}</th><th>{{ tr("尝试次数") }}</th><th>{{ tr("接收状态码") }}</th><th>{{ tr("原因") }}</th><th>{{ tr("时间") }}</th><th /></tr></thead><tbody><tr v-for="item in rows" :key="item.id"><td class="font-mono text-xs">{{ item.id }}</td><td>{{ item.status }}</td><td>{{ item.attempt_count }}</td><td>{{ item.response_status || '—' }}</td><td>{{ item.last_error || '—' }}</td><td class="text-xs">{{ time(item.created_at) }}</td><td><button v-if="item.status === 'failed' && !isAuditor" class="btn btn-xs" :disabled="acting" @click="retryDelivery(item)">{{ tr("重试") }}</button></td></tr></tbody></table><div v-if="!rows.length && !loading" class="p-8 text-center text-sm opacity-60">{{ tr("暂无记录。") }}</div><button v-if="nextAfter && ['logs', 'audit'].includes(section)" class="btn btn-sm btn-ghost m-3" :disabled="loading" @click="loadSection(nextAfter)">{{ tr("继续加载") }}</button></div>
    </template>

    <template v-if="section === 'settings' && isAdmin"><form class="max-w-3xl space-y-5 rounded-xl bg-base-100 p-6" @submit.prevent="saveSettings"><label class="flex items-center gap-3"><input v-model="settings.document.enabled" type="checkbox" class="toggle toggle-primary" /><span>{{ tr("启用外部 API") }}</span></label><p class="text-sm opacity-60">{{ tr("关闭后拒绝新调用；后台任务重新检查授权，已下发扫描通过取消协议停止。") }}</p><div class="grid gap-4 sm:grid-cols-2"><fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-6`">{{ tr("调用日志保留天数") }}</label></legend><input :id="`${formFieldId}-6`" v-model.number="settings.document.retention_days" type="number" min="1" max="90" class="input input-bordered w-full" /></fieldset><fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-7`">{{ tr("审计保留天数") }}</label></legend><input :id="`${formFieldId}-7`" v-model.number="settings.document.audit_retention_days" type="number" min="30" max="730" class="input input-bordered w-full" /></fieldset></div><fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label for="openplatform-allowedhoststext">{{ tr("批准的 Webhook 域名") }}</label></legend><textarea id="openplatform-allowedhoststext" v-model="allowedHostsText" class="textarea textarea-bordered w-full" rows="5" placeholder="hooks.partner.example.com" /><span class="mt-1 text-xs opacity-60">{{ tr("每行一个明确域名。仅 HTTPS 443，禁止重定向和私网地址。") }}</span></fieldset><button class="btn btn-neutral btn-sm" :disabled="acting">{{ tr("发布设置") }}</button></form></template>
    <template v-if="section === 'roles' && isAdmin"><div class="space-y-5 rounded-xl bg-base-100 p-6"><form class="flex flex-wrap items-end gap-3" @submit.prevent="saveRole"><fieldset class="fieldset min-w-0 w-full sm:w-auto"><legend class="fieldset-legend"><label :for="`${formFieldId}-8`">{{ tr("现有用户 ID") }}</label></legend><input :id="`${formFieldId}-8`" v-model="roleForm.user_id" type="number" min="1" required class="input input-bordered input-sm w-full" /></fieldset><fieldset class="fieldset min-w-0 w-full sm:w-auto"><legend class="fieldset-legend"><label :for="`${formFieldId}-9`">{{ tr("开放平台权限") }}</label></legend><select :id="`${formFieldId}-9`" v-model="roleForm.role" class="select select-bordered select-sm w-full"><option value="operator">{{ tr("运营人员") }}</option><option value="auditor">{{ tr("审计人员") }}</option><option value="developer">{{ tr("开发者（移除额外权限）") }}</option></select></fieldset><button class="btn btn-neutral btn-sm" :disabled="acting">{{ tr("保存") }}</button></form><p class="text-sm opacity-60">{{ tr("平台管理员沿用原管理员角色。此操作只调整开放平台权限。") }}</p><table class="table table-sm"><thead><tr><th>{{ tr("用户") }}</th><th>ID</th><th>{{ tr("开放平台角色") }}</th></tr></thead><tbody><tr v-for="item in roles" :key="item.user_id"><td>{{ item.username }}</td><td>{{ item.user_id }}</td><td>{{ item.role }}</td></tr></tbody></table></div></template>
    <template v-if="section === 'docs'"><div class="flex flex-wrap gap-2"><button v-for="[kind, label] in [[&#39;integration&#39;, tr(&quot;外部接入&quot;)], [&#39;management&#39;, tr(&quot;管理与运维&quot;)], [&#39;implementation&#39;, tr(&quot;实现与验证&quot;)]]" :key="kind" class="btn btn-sm" :class="documentKind === kind ? 'btn-neutral' : 'btn-ghost'" @click="documentKind = kind">{{ label }}</button><button class="btn btn-sm" @click="exportOpenApi">{{ tr("下载接口契约") }}</button></div><pre class="max-h-[75vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-base-100 p-5 text-sm leading-7">{{ documentText || '正在加载文档…' }}</pre></template>

    <dialog ref="createDialog" class="modal"><form class="modal-box max-w-5xl space-y-4" @submit.prevent="createApplication"><h2 class="text-xl font-semibold">{{ tr("申请应用") }}</h2><div class="grid gap-3 sm:grid-cols-2"><fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-10`">{{ tr("应用名称") }}</label></legend><input :id="`${formFieldId}-10`" v-model="createForm.name" required maxlength="100" class="input input-bordered w-full" /></fieldset><fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-11`">{{ tr("用途") }}</label></legend><input :id="`${formFieldId}-11`" v-model="createForm.purpose" required maxlength="2000" class="input input-bordered w-full" /></fieldset><fieldset v-if="isAdmin" class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-12`">{{ tr("应用类型") }}</label></legend><select :id="`${formFieldId}-12`" v-model="createForm.kind" class="select select-bordered w-full"><option value="personal">{{ tr("个人工具") }}</option><option value="partner">{{ tr("合作方系统") }}</option></select></fieldset><fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-13`">{{ tr("环境") }}</label></legend><select :id="`${formFieldId}-13`" v-model="createForm.environment" class="select select-bordered w-full"><option value="production">{{ tr("生产") }}</option><option value="sandbox">{{ tr("沙箱（禁止真实扫描）") }}</option></select></fieldset><fieldset v-if="isAdmin" class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-14`">{{ tr("责任用户 ID（留空为本人）") }}</label></legend><input :id="`${formFieldId}-14`" v-model="createForm.owner_user_id" type="number" min="1" class="input input-bordered w-full" /></fieldset></div><OpenApiPolicyEditor v-model="createForm.policy" :catalog="catalog" @validity-change="createDatesValid = $event" /><div class="modal-action"><button type="button" class="btn btn-sm" @click="createDialog.close()">{{ tr("取消") }}</button><button class="btn btn-neutral btn-sm" :disabled="acting || !createDatesValid">{{ tr("提交申请") }}</button></div></form><form method="dialog" class="modal-backdrop"><button>{{ tr("关闭") }}</button></form></dialog>
    <dialog ref="keyDialog" class="modal"><form class="modal-box max-w-2xl space-y-4" @submit.prevent="issueKey"><h2 class="text-xl font-semibold">{{ keyForm.rotate ? tr("轮换凭据") : tr("创建凭据") }}</h2><fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-15`">{{ tr("名称") }}</label></legend><input :id="`${formFieldId}-15`" v-model="keyForm.name" class="input input-bordered w-full" required maxlength="100" /></fieldset><div class="grid gap-3 sm:grid-cols-2"><fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-16`">{{ tr("有效天数") }}</label></legend><input :id="`${formFieldId}-16`" v-model.number="keyForm.expires_days" type="number" min="1" max="365" required class="input input-bordered w-full" /></fieldset><fieldset v-if="keyForm.rotate" class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-17`">{{ tr("旧凭据重叠小时数") }}</label></legend><input :id="`${formFieldId}-17`" v-model.number="keyForm.overlap_hours" type="number" min="0" max="24" class="input input-bordered w-full" /></fieldset></div><fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label for="openplatform-keyform-ip-allowlist">{{ tr("来源 CIDR") }}</label></legend><textarea id="openplatform-keyform-ip-allowlist" v-model="keyForm.ip_allowlist" class="textarea textarea-bordered w-full" rows="3" /></fieldset><div class="grid gap-2 sm:grid-cols-2"><label v-for="scope in details?.application?.policy?.scopes || []" :key="scope" class="flex items-center gap-2 text-xs"><input v-model="keyForm.scopes" :value="scope" type="checkbox" class="checkbox checkbox-sm" />{{ scope }}</label></div><div class="modal-action"><button type="button" class="btn btn-sm" @click="keyDialog.close()">{{ tr("取消") }}</button><button class="btn btn-neutral btn-sm" :disabled="acting">{{ tr("生成凭据") }}</button></div></form><form method="dialog" class="modal-backdrop"><button>{{ tr("关闭") }}</button></form></dialog>
    <dialog ref="secretDialog" class="modal" @close="clearSecret"><div class="modal-box max-w-2xl"><h2 class="text-xl font-semibold">{{ secretTitle }}</h2><p class="my-4 text-sm">{{ tr("请保存到调用方的密钥管理系统。关闭后无法再次查看。") }}</p><fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label for="openplatform-secret">{{ tr("一次性密钥") }}</label></legend><textarea id="openplatform-secret" :value="secret" readonly class="textarea textarea-bordered w-full break-all font-mono text-xs" rows="4" :aria-label="tr(&quot;一次性密钥&quot;)" /></fieldset><div class="modal-action"><button class="btn btn-sm" @click="copy(secret)">{{ tr("复制") }}</button><button class="btn btn-neutral btn-sm" @click="secretDialog.close()">{{ tr("已保存，关闭") }}</button></div></div></dialog>
    <dialog ref="verificationDialog" class="modal" @close="cancelVerification"><form class="modal-box space-y-4" @submit.prevent="verify"><h2 class="text-xl font-semibold">{{ tr("验证身份") }}</h2><p class="text-sm opacity-60">{{ tr("凭据和授权变更需要重新验证。验证有效期为 5 分钟。") }}</p><fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-18`">{{ tr("当前密码") }}</label></legend><input :id="`${formFieldId}-18`" v-model="verification.password" type="password" autocomplete="current-password" required class="input input-bordered w-full" /></fieldset><fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-19`">{{ tr("2FA 验证码（已启用时必填）") }}</label></legend><input :id="`${formFieldId}-19`" v-model="verification.totp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="input input-bordered w-full" /></fieldset><div class="modal-action"><button type="button" class="btn btn-sm" @click="verificationDialog.close()">{{ tr("取消") }}</button><button class="btn btn-neutral btn-sm" :disabled="acting">{{ tr("验证并继续") }}</button></div></form></dialog>
    <dialog ref="approvalDialog" class="modal" @close="clearApprovalDraft"><div class="modal-box max-w-5xl space-y-4"><h2 class="text-xl font-semibold">{{ approval?.name }} {{ tr("· 申请详情") }}</h2><p class="text-sm">{{ approval?.reason }}</p><OpenApiPolicyEditor v-if="approvalPolicy" v-model="approvalPolicy" :catalog="catalog" :disabled="!isAdmin || approval?.status !== 'pending'" @validity-change="approvalDatesValid = $event" /><fieldset v-if="isAdmin && approval?.status === 'pending'" class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label for="openplatform-approvalnote">{{ tr("审批意见") }}</label></legend><textarea id="openplatform-approvalnote" v-model="approvalNote" class="textarea textarea-bordered w-full" maxlength="2000" /></fieldset><div class="modal-action"><button class="btn btn-sm" @click="approvalDialog.close()">{{ tr("关闭") }}</button><template v-if="isAdmin && approval?.status === 'pending'"><button class="btn btn-sm btn-outline btn-error" :disabled="acting" @click="submitReview(false)">{{ tr("驳回") }}</button><button class="btn btn-neutral btn-sm" :disabled="acting || !approvalDatesValid" @click="submitReview(true)">{{ tr("批准并发布授权") }}</button></template></div></div><form method="dialog" class="modal-backdrop"><button>{{ tr("关闭") }}</button></form></dialog>
    <dialog ref="webhookDialog" class="modal"><form class="modal-box space-y-4" @submit.prevent="createWebhook"><h2 class="text-xl font-semibold">{{ webhookForm.id ? tr("编辑事件订阅") : tr("创建事件订阅") }}</h2><fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-20`">{{ tr("回调 HTTPS 地址") }}</label></legend><input :id="`${formFieldId}-20`" v-model="webhookForm.url" type="url" required class="input input-bordered w-full" placeholder="https://hooks.example.com/network-events" /></fieldset><div class="grid gap-2"><label v-for="kind in catalog.event_types || []" :key="kind" class="flex items-center gap-2 text-sm"><input v-model="webhookForm.event_types" :value="kind" type="checkbox" class="checkbox checkbox-sm" />{{ kind }}</label></div><label class="flex items-center gap-2 text-sm"><input v-model="webhookForm.enabled" type="checkbox" class="toggle toggle-sm" />{{ tr("启用投递") }}</label><div class="modal-action"><button type="button" class="btn btn-sm" @click="webhookDialog.close()">{{ tr("取消") }}</button><button class="btn btn-neutral btn-sm" :disabled="acting">{{ webhookForm.id ? tr("保存订阅") : tr("创建订阅") }}</button></div></form><form method="dialog" class="modal-backdrop"><button>{{ tr("关闭") }}</button></form></dialog>
  </main>
</template>
