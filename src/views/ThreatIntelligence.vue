<script setup>
import { tr } from '../i18n/index.js'

import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Copy } from '@lucide/vue'
import http from '../utils/http'
import { formatDateTime } from '../i18n/time.js'
import { useRoute } from 'vue-router'
import { articleIocLocations } from '../utils/intelReportReview'
import IntelArticleSnapshot from '../components/IntelArticleSnapshot.vue'
import IntelActorReview from '../components/IntelActorReview.vue'
import IntelArticleDiagnostics from '../components/IntelArticleDiagnostics.vue'
import IntelArticleValidation from '../components/IntelArticleValidation.vue'
import IntelEvidenceQuote from '../components/IntelEvidenceQuote.vue'
import IntelValidation from '../components/IntelValidation.vue'
import IntelArticleForm from '../components/IntelArticleForm.vue'
import IntelRefreshButton from '../components/IntelRefreshButton.vue'
import IntelStatusText from '../components/IntelStatusText.vue'
import { evidenceExcerpt, sourceKinds, defaultIntervals, states, attackTypes, attackLabel, roleLabel, articleStatusLabel, articleIntakeLabel, intelError, newSource, sourcePayload, originLabel, safeReference } from '../utils/threatIntel'
const tabs = { get sources() { return tr("来源") }, get records() { return tr("IOC 库") }, get review() { return tr("审核") }, get articles() { return tr("文章") }, get entities() { return tr("组织与基准库") }, get mappings() { return tr("名称映射") }, get jobs() { return tr("同步作业") } }
const route = useRoute()
const tab = ref(Object.hasOwn(tabs, route.query.tab) ? route.query.tab : 'sources'), sources = ref([]), records = ref([]), articles = ref([]), entities = ref([]), jobs = ref([]), mappings = ref({ unmapped: [], mappings: [] })
const reviewGroups = ref([])
const error = ref(''), notice = ref(''), loading = ref(false), busy = ref(false), total = ref(0), offset = ref(0), query = ref(''), recordStatus = ref('approved'), recordType = ref(''), attackType = ref(''), entityKind = ref('actor')
const settings = ref({ ai_enabled: false, ai_model: '' })
const sourceDetails = ref(null), sourceCopyMessage = ref(''), sourceDetailsDialog = ref(null)
const deleteDialog = ref(null), deleteTarget = ref(null), managementError = ref('')
const articleEditDialog = ref(null), articleEditForm = ref(null), articleEditLoading = ref(false)
let articleEditVersion = 0
const sourceDialog = ref(null), sourceForm = ref(newSource()), hostsText = ref('')
const importDialog = ref(null), importSource = ref(null), importFile = ref(null), importFileInput = ref(null), uploadProgress = ref(null), uploadChecking = ref(false), importError = ref('')
const reviewDialog = ref(null), selected = ref(null), reviewDecision = ref('approved'), reason = ref(''), article = ref(null), articleLoading = ref(false)
const actorDecision = ref({ action: 'keep' })
const articleError = ref('')
const focusedEvidence = ref(null), evidenceMark = ref(null)
const selectedIocLocation = computed(() => selected.value ? articleIocLocations(article.value?.body, [selected.value]).get(selected.value.id) : null)
async function locateSelectedIoc() { await locateEvidence(selectedIocLocation.value) }
const focusedExcerpt = computed(() => evidenceExcerpt(article.value?.body, focusedEvidence.value))
async function locateEvidence(span) {
  if (!evidenceExcerpt(article.value?.body, span)) return
  focusedEvidence.value = span
  await nextTick()
  evidenceMark.value?.scrollIntoView({ block: 'nearest' })
}
const reviewBlocked = computed(() => busy.value || !reason.value.trim() || (selected.value?.origin === 'ai' && reviewDecision.value === 'approved' && (articleLoading.value || !article.value?.body?.trim())))
const entityDialog = ref(null), entityDetail = ref(null), entityLoading = ref(false)
const mappingDialog = ref(null), mappingForm = ref({ source_id: '', name: '', attack_id: '' }), candidateQuery = ref(''), candidates = ref([])
const requests = new AbortController()
let timer, uploadController, disposed = false, tabVersion = 0, articleVersion = 0, candidateVersion = 0, entityVersion = 0
function fail(e) { if (!disposed && e.code !== 'ERR_CANCELED') error.value = intelError(e) }
async function loadSources() { const r = await http.get('/api/intel/sources', { signal: requests.signal }); if (!disposed) sources.value = r.data.data.items }
async function loadSettings() { const r = await http.get('/api/intel/settings', { signal: requests.signal }); if (!disposed) settings.value = r.data.data.settings }
async function refresh() {
  const version = ++tabVersion, current = tab.value
  loading.value = true; error.value = ''
  try {
    let path, params
    if (current === 'sources') { await loadSources(); return }
    if (current === 'records' || current === 'review') { path = current === 'review' ? '/api/intel/review-queue' : '/api/intel/records'; params = { status: current === 'review' ? 'pending' : recordStatus.value, q: query.value, offset: offset.value, type: recordType.value, attack_type: attackType.value } }
    else if (current === 'entities') { path = '/api/intel/entities'; params = { q: query.value, kind: entityKind.value } }
    else path = `/api/intel/${current}`
    const r = await http.get(path, { params, signal: requests.signal })
    if (disposed || version !== tabVersion) return
    const data = r.data.data
    if (current === 'records' || current === 'review') { if (current === 'review') reviewGroups.value = data.items; else records.value = data.items; total.value = data.total }
    else if (current === 'articles') articles.value = data.items
    else if (current === 'entities') entities.value = data.items
    else if (current === 'mappings') mappings.value = data
    else if (current === 'jobs') jobs.value = data.items
  } catch (e) { if (version === tabVersion) fail(e) } finally { if (version === tabVersion) loading.value = false }
}
function changeTab(value) { tab.value = value; query.value = ''; offset.value = 0; refresh() }
function showSourceDetails(source) { sourceDetails.value = source; sourceCopyMessage.value = ''; sourceDetailsDialog.value?.showModal() }
async function copySourceId() {
  const id = sourceDetails.value?.id
  if (!id) return
  try {
    await navigator.clipboard.writeText(String(id))
    if (!disposed && sourceDetails.value?.id === id) sourceCopyMessage.value = tr("来源 ID 已复制。")
  } catch {
    if (!disposed && sourceDetails.value?.id === id) sourceCopyMessage.value = tr("复制失败，请手动选择来源 ID 复制。")
  }
}
function editSource(source = null) { error.value = ''; sourceForm.value = source ? { ...newSource(), ...source, request_config: { ...newSource().request_config, ...source.request_config, headers: (source.request_config?.headers || []).map(header => ({ ...header })) } } : newSource(); hostsText.value = (source?.allowed_hosts || []).join('\n'); sourceDialog.value?.showModal() }
function clearSourceCredential() { sourceForm.value.credential = ''; sourceForm.value.clear_credential = false }
function kindChanged() { sourceForm.value.interval_seconds = defaultIntervals[sourceForm.value.kind]; if (sourceForm.value.kind === 'article') { sourceForm.value.transport = 'manual'; sourceForm.value.location = ''; sourceForm.value.auth_env = ''; clearSourceCredential() } else if (sourceForm.value.transport === 'manual') sourceForm.value.transport = 'https'; if (sourceForm.value.kind === 'threatfox_export') { sourceForm.value.transport = 'upload'; sourceForm.value.location = ''; sourceForm.value.auth_env = ''; clearSourceCredential(); hostsText.value = '' } else if (sourceForm.value.transport === 'upload' && !['json', 'lines'].includes(sourceForm.value.kind)) sourceForm.value.transport = 'https' }
function openImport(source) { importSource.value = source; importFile.value = null; uploadProgress.value = null; importError.value = ''; if (importFileInput.value) importFileInput.value.value = ''; importDialog.value?.showModal() }
function cancelImport() { uploadController?.abort() }
async function uploadImport() {
  if (!importSource.value || !importFile.value || busy.value) return
  const file = importFile.value
  if (!file.size || file.size > 512 * 1024 * 1024) { importError.value = tr("请选择非空文件，上传大小最多 512 MiB。"); return }
  busy.value = true; error.value = ''; notice.value = ''; importError.value = ''; uploadProgress.value = null
  const controller = new AbortController()
  uploadController = controller; uploadChecking.value = true
  try {
    const path = `/api/intel/sources/${importSource.value.id}/import`
    const params = { expected_revision: importSource.value.revision }
    const readiness = await http.post(`${path}/check`, undefined, { params, signal: controller.signal, timeout: 15000 })
    if (disposed) return
    if (controller.signal.aborted) throw { code: 'ERR_CANCELED' }
    if (readiness?.data?.data?.ready !== true) throw { response: { data: { code: 'intel_import_check_failed' } } }
    uploadChecking.value = false
    await http.post(path, file, { params, headers: { 'Content-Type': 'application/octet-stream' }, signal: controller.signal, timeout: 30 * 60 * 1000, onUploadProgress: e => { if (!disposed && e.loaded > 0) uploadProgress.value = Math.min(100, Math.max(1, Math.round(e.loaded * 100 / (e.total || file.size)))) } })
    if (disposed) return
    uploadProgress.value = 100; importDialog.value?.close(); importFile.value = null; notice.value = tr("离线文件已上传，后台将先校验再分批导入。ThreatFox 增量更新继续使用 API。")
    try { await loadSources() } catch (e) { fail(e) }
  } catch (e) { if (!disposed) importError.value = e.code === 'ERR_CANCELED' ? tr("已取消上传等待，可在同步作业中确认是否已接收。") : intelError(e) } finally { busy.value = false; uploadChecking.value = false; uploadController = null }
}
async function saveSource() {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const payload = sourcePayload(sourceForm.value, hostsText.value)
    if (sourceForm.value.id) await http.put(`/api/intel/sources/${sourceForm.value.id}`, payload)
    else await http.post('/api/intel/sources', payload)
    sourceDialog.value?.close(); clearSourceCredential(); await loadSources(); notice.value = payload.transport === 'manual' ? tr("文章来源已保存，请在文章页提交链接或正文快照。所有 AI 提议固定人工审核。") : payload.transport === 'upload' || payload.kind === 'threatfox_export' ? tr("离线来源已保存，请手动上传文件或从本地导入。") : tr("来源已保存，将按检查周期更新；AI 提议的人工审核规则不受来源设置影响。")
  } catch (e) { fail(e) } finally { busy.value = false }
}
function confirmDelete(kind, row) {
  if (busy.value) return
  deleteTarget.value = { kind, id: row.id, revision: row.revision, name: row.name || row.title || row.url }
  managementError.value = ''; deleteDialog.value?.showModal()
}
async function deleteItem() {
  if (!deleteTarget.value || busy.value) return
  const target = { ...deleteTarget.value }
  busy.value = true; managementError.value = ''; error.value = ''; notice.value = ''
  try {
    await http.delete(`/api/intel/${target.kind}/${target.id}`, { data: { expected_revision: target.revision }, signal: requests.signal })
    if (disposed) return
    deleteDialog.value?.close(); deleteTarget.value = null
    notice.value = target.kind === 'sources' ? tr("来源已删除，后台任务已停止，关联情报不再参与标记。") : tr("文章已删除，仅由此文章支持的情报不再参与标记。")
    try { await loadSources() } catch (e) { fail(e) }
    await refresh()
  } catch (e) { if (!disposed && e.code !== 'ERR_CANCELED') managementError.value = intelError(e) } finally { busy.value = false }
}
async function editArticle(row) {
  if (busy.value) return
  const version = ++articleEditVersion
  articleEditForm.value = null; articleEditLoading.value = true; managementError.value = ''; articleEditDialog.value?.showModal()
  try {
    const response = await http.get(`/api/intel/articles/${row.id}`, { signal: requests.signal })
    if (disposed || version !== articleEditVersion) return
    const detail = response.data.data
    articleEditForm.value = { id: row.id, source_id: row.source_id, source_name: row.source_name, expected_revision: row.current_source_revision, expected_article_revision: detail.revision, title: detail.title, url: detail.url, body: detail.body || '' }
  } catch (e) { if (version === articleEditVersion && !disposed && e.code !== 'ERR_CANCELED') managementError.value = intelError(e) }
  finally { if (version === articleEditVersion) articleEditLoading.value = false }
}
async function saveArticle() {
  if (!articleEditForm.value || busy.value || articleEditLoading.value) return
  const { id, source_name, ...form } = articleEditForm.value
  busy.value = true; managementError.value = ''; error.value = ''; notice.value = ''
  try {
    await http.put(`/api/intel/articles/${id}`, { ...form, title: form.title.trim(), url: form.url.trim(), body: form.body.trim() || null }, { signal: requests.signal })
    if (disposed) return
    articleEditDialog.value?.close(); articleEditForm.value = null
    notice.value = tr("文章已修改并生成新快照，已重新排队；提取结果须人工审核，历史快照与审核记录保留。")
    await refresh()
  } catch (e) { if (!disposed && e.code !== 'ERR_CANCELED') managementError.value = intelError(e) } finally { busy.value = false }
}
async function sync(source) {
  busy.value = true; error.value = ''
  try { await http.post(`/api/intel/sources/${source.id}/sync`); notice.value = tr("同步作业已入队，可在同步作业页查看结果。"); await loadSources() } catch (e) { fail(e) } finally { busy.value = false }
}
async function openReview(record, decision = 'approved') {
  actorDecision.value = { action: 'keep' }; selected.value = record; reviewDecision.value = decision; reason.value = ''; reviewDialog.value?.showModal()
  await loadReviewArticle()
}
async function loadReviewArticle() {
  const version = ++articleVersion
  const record = selected.value
  article.value = null; focusedEvidence.value = null; articleError.value = ''; articleLoading.value = false
  if (!record?.article_id) {
    if (record?.origin === 'ai') articleError.value = tr("AI 提议缺少文章快照，暂不能接纳。")
    return
  }
  articleLoading.value = true
  try {
    const r = await http.get(`/api/intel/articles/${record.article_id}`, { signal: requests.signal })
    if (disposed || version !== articleVersion) return
    const snapshot = r.data.data
    if (typeof snapshot?.body !== 'string' || !snapshot.body.trim()) articleError.value = tr("文章快照没有有效正文，暂不能接纳 AI 提议。")
    else article.value = snapshot
  } catch (e) { if (version === articleVersion) { articleError.value = tr("文章快照加载失败，请重试后再接纳。"); fail(e) } }
  finally { if (version === articleVersion) articleLoading.value = false }
}
async function submitReview() {
  if (!selected.value || reviewBlocked.value) return
  busy.value = true; error.value = ''
  try { await http.post(`/api/intel/records/${selected.value.id}/review`, { content_hash: selected.value.content_hash, decision: reviewDecision.value, reason: reason.value.trim(), ...(reviewDecision.value === 'approved' ? { attribution: actorDecision.value } : {}) }); reviewDialog.value?.close(); notice.value = tr("审核决定已保存，标记已按有效证据更新。"); await refresh() } catch (e) { fail(e) } finally { busy.value = false }
}
async function retryArticle(row) {
  if (busy.value) return
  if (row.source_enabled === false) { error.value = tr("来源已停用，请在“来源”中启用后再提取。"); notice.value = ''; return }
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const response = await http.post(`/api/intel/articles/${row.id}/retry`)
    const result = response.data.data
    if (result.id === row.id) { row.status = result.status || 'queued'; row.error_code = null; row.extraction_metadata = { ...row.extraction_metadata }; delete row.extraction_metadata.result; delete row.extraction_metadata.last_error; delete row.extraction_metadata.ai_usage }
    notice.value = result.new_source_revision ? tr("已使用当前来源版本创建提取任务，保留原文章快照与历史审核。") : result.already_active ? tr("文章已在队列中或正在处理。") : tr("文章已入队，等待 AI 处理。")
    await refresh()
  } catch (e) { await refresh(); fail(e) } finally { busy.value = false }
}
function openMapping(row) { mappingForm.value = { source_id: row.source_id, name: row.name, kind: row.kind || 'actor', attack_id: '' }; candidateQuery.value = row.name; candidates.value = []; mappingDialog.value?.showModal(); searchCandidates() }
async function searchCandidates() { const version = ++candidateVersion; try { const r = await http.get('/api/intel/entities', { params: { kind: mappingForm.value.kind || 'actor', q: candidateQuery.value }, signal: requests.signal }); if (!disposed && version === candidateVersion) candidates.value = r.data.data.items.filter(e => e.active) } catch (e) { if (version === candidateVersion) fail(e) } }
async function saveMapping() { busy.value = true; try { await http.post('/api/intel/mappings', mappingForm.value); mappingDialog.value?.close(); await refresh(); notice.value = tr("本来源的名称对应关系已保存。") } catch (e) { fail(e) } finally { busy.value = false } }
async function deleteMapping(row) { busy.value = true; try { await http.delete(`/api/intel/mappings/${row.id}`, { params: { attack_id: row.attack_id } }); await refresh(); notice.value = tr("名称映射已撤销，已接纳 IOC 的恶意判定保留。") } catch (e) { fail(e) } finally { busy.value = false } }
async function showEntity(row) { const version = ++entityVersion; entityDetail.value = null; entityLoading.value = true; entityDialog.value?.showModal(); try { const r = await http.get(`/api/intel/entities/${row.attack_id}`, { signal: requests.signal }); if (!disposed && version === entityVersion) entityDetail.value = r.data.data } catch (e) { if (version === entityVersion) fail(e) } finally { if (version === entityVersion) entityLoading.value = false } }
async function poll() {
  if (disposed) return
  if (!busy.value && !loading.value && document.visibilityState !== 'hidden' && ['sources', 'jobs', 'articles'].includes(tab.value)) await refresh()
  if (!disposed) timer = setTimeout(poll, 5000)
}
onMounted(async () => { try { await Promise.all([loadSettings(), loadSources()]); await refresh() } catch (e) { fail(e) } if (!disposed) timer = setTimeout(poll, 5000) })
onBeforeUnmount(() => { disposed = true; tabVersion++; articleVersion++; articleEditVersion++; clearSourceCredential(); importFile.value = null; uploadController?.abort(); requests.abort(); clearTimeout(timer) })
</script>

<template>
  <main class="page-shell space-y-5">
    <div class="mb-4"><h1 class="page-title">{{ tr("威胁情报与自动标记") }}</h1><p class="mt-2 text-sm opacity-65">{{ tr("可信来源的 IOC 默认直接接纳；AI 提取作为补充，所有提议均须人工审核后生效。") }}</p></div>
    <div v-if="error" role="alert" class="alert alert-error">{{ error }}</div>
    <div v-if="notice" role="status" class="alert alert-info">{{ notice }}</div>
    <div class="card border border-base-300 bg-base-100 p-4">
      <div class="flex flex-wrap items-center justify-between gap-3"><div><h2 class="font-semibold">{{ tr("LLM 文章提取") }}</h2><p class="mt-2 text-sm opacity-65">{{ settings.ai_enabled ? tr("已启用 · {0}", [settings.ai_model]) : tr("当前已暂停，可信 IOC 同步继续运行。") }} {{ tr("所有 LLM 提议固定人工审核。") }}</p></div><router-link to="/llm/basic" class="btn btn-outline btn-sm">{{ tr("前往 LLM 设置") }}</router-link></div>
    </div>
    <div role="tablist" class="tabs tabs-border overflow-x-auto flex-nowrap"><button v-for="(label, key) in tabs" :key="key" type="button" role="tab" class="tab whitespace-nowrap" :aria-selected="tab === key" :class="{ 'tab-active': tab === key }" @click="changeTab(key)">{{ label }}</button></div>
    <div class="flex min-w-0 flex-wrap items-center justify-end gap-3">
      <IntelRefreshButton :loading="loading" @refresh="refresh" />
      <button v-if="tab === 'sources'" type="button" class="btn btn-neutral btn-sm" @click="editSource()">{{ tr("添加来源") }}</button>
      <form v-if="['records','review','entities'].includes(tab)" class="flex min-w-0 max-w-full flex-wrap justify-end gap-2" @submit.prevent="offset = 0; refresh()">
        <input v-model="query" class="input input-bordered input-sm min-w-0 w-56 max-w-full" maxlength="200" :placeholder="tr(&quot;IOC、软件或组织名称&quot;)" :aria-label="tr(&quot;情报搜索&quot;)" />
        <select v-if="tab === 'records'" v-model="recordStatus" class="select select-bordered select-sm min-w-0 w-44 max-w-full" :aria-label="tr(&quot;接纳状态&quot;)"><option v-for="state in ['approved','expired','revoked','rejected','superseded']" :key="state" :value="state">{{ states[state] }}</option></select>
        <select v-if="['records','review'].includes(tab)" v-model="recordType" class="select select-bordered select-sm min-w-0 w-44 max-w-full" :aria-label="tr(&quot;IOC 类型&quot;)"><option value="">{{ tr("全部 IOC 类型") }}</option><option v-for="kind in ['ip','ip_port','domain','url','md5','sha1','sha256','asn']" :key="kind" :value="kind">{{ kind }}</option></select>
        <select v-if="['records','review'].includes(tab)" v-model="attackType" class="select select-bordered select-sm min-w-0 w-44 max-w-full" :aria-label="tr(&quot;攻击行为&quot;)"><option value="">{{ tr("全部攻击行为") }}</option><option v-for="(label, key) in attackTypes" :key="key" :value="key">{{ label }}</option></select>
        <select v-if="tab === 'entities'" v-model="entityKind" class="select select-bordered select-sm min-w-0 w-44 max-w-full" :aria-label="tr(&quot;基准实体类型&quot;)"><option value="actor">{{ tr("组织") }}</option><option value="software">{{ tr("软件") }}</option><option value="technique">{{ tr("攻击技术") }}</option></select>
        <button class="btn btn-sm">{{ tr("搜索") }}</button>
      </form>
    </div>
    <IntelArticleForm v-if="tab === 'articles'" :sources="sources" @saved="refresh" />
    <div class="card border border-base-300 bg-base-100 overflow-x-auto">
      <table v-if="tab === 'sources'" class="table table-sm"><thead><tr><th>{{ tr("来源") }}</th><th>{{ tr("位置与格式") }}</th><th>{{ tr("接纳策略") }}</th><th>{{ tr("检查周期") }}</th><th>{{ tr("最近作业") }}</th><th>{{ tr("操作") }}</th></tr></thead><tbody>
        <tr v-for="s in sources" :key="s.id"><td><button type="button" class="link link-hover text-left font-semibold" @click="showSourceDetails(s)">{{ s.name }}</button><p class="text-xs opacity-60"><IntelStatusText :text="s.enabled ? tr(&quot;已启用&quot;) : tr(&quot;已停用&quot;)" /></p></td><td><p>{{ sourceKinds[s.kind] }} · {{ s.transport === 'manual' ? tr("手动文章") : s.transport === 'upload' ? tr("离线上传") : s.transport === 'local' ? tr("本地文件") : tr("远程 HTTPS") }}</p><p class="mt-1 max-w-md break-all text-xs opacity-60">{{ s.location }}</p><p v-if="s.auth_env || s.credential_configured" class="text-xs">{{ tr("凭据") }} {{ s.credential_source === 'database' ? tr("数据库加密存储") : s.credential_configured ? tr("环境变量") : tr("未配置") }}</p></td><td>{{ ['rss','article'].includes(s.kind) ? tr("AI 固定人工审核") : s.kind === 'mitre_stix' ? tr("规范化基准库") : s.require_review ? tr("人工审核后接纳") : tr("可信 IOC 直接接纳") }}</td><td>{{ s.transport === 'manual' ? tr("手动提交，不周期抓取") : s.transport === 'upload' || s.kind === 'threatfox_export' ? tr("手动导入，不定时拉取") : tr("{0} 秒", [s.interval_seconds]) }}<p class="text-xs opacity-60">{{ tr("有效期") }} {{ s.expiry_months ? tr("{0} 个月", [s.expiry_months]) : tr("不设置本地期限") }}</p><p v-if="s.import_status" class="text-xs"><IntelStatusText :text="`${states[s.import_status.stage]} · ${s.import_status.processed}/${s.import_status.total}`" /></p></td><td><IntelStatusText :text="states[s.last_run?.status] || tr(&quot;尚未同步&quot;)" /><p v-if="s.last_run?.error_code" class="max-w-xs text-xs text-error">{{ intelError(s.last_run.error_code) }}</p><IntelValidation :report="(s.import_status?.stage !== 'cancelled' && s.import_status?.validation) || s.last_run?.summary?.validation" /></td><td><div class="flex flex-wrap gap-2"><button type="button" class="btn btn-ghost btn-xs" @click="showSourceDetails(s)">{{ tr("配置详情") }}</button><button class="btn btn-ghost btn-xs" :disabled="busy" @click="editSource(s)">{{ tr("编辑") }}</button><button type="button" class="btn btn-ghost btn-xs text-error" :disabled="busy" @click="confirmDelete('sources', s)">{{ tr("删除") }}</button><button v-if="s.transport === 'upload'" class="btn btn-neutral btn-xs" :disabled="busy || !s.enabled" @click="openImport(s)">{{ tr("上传文件") }}</button><button v-if="s.transport !== 'manual' && (s.transport !== 'upload' || ['downloaded','ready','paused'].includes(s.import_status?.stage))" class="btn btn-outline btn-xs" :disabled="busy || !s.enabled" @click="sync(s)">{{ s.transport === 'upload' ? tr("继续导入") : tr("立即同步") }}</button></div></td></tr>
        <tr v-if="!sources.length"><td colspan="6" class="py-8 text-center opacity-60">{{ tr("暂无来源。") }}</td></tr>
      </tbody></table>
      <table v-else-if="tab === 'review'" class="table table-sm"><thead><tr><th>{{ tr("报告 / IOC") }}</th><th>{{ tr("来源") }}</th><th>{{ tr("待审 IOC") }}</th><th>{{ tr("操作") }}</th></tr></thead><tbody><tr v-for="group in reviewGroups" :key="group.id"><td><p class="max-w-lg break-words font-semibold">{{ group.article_id ? group.title || tr("文章报告") : group.record.value }}</p><p v-if="group.article_id" class="mt-1 max-w-lg break-all text-xs opacity-60">{{ group.url }}</p></td><td>{{ group.record.source_name }}<p class="text-xs opacity-60">{{ originLabel(group.record) }}</p></td><td>{{ group.pending_count }} {{ tr("条") }}</td><td><router-link v-if="group.article_id" :to="{ name: 'intel-report-review', params: { articleId: group.article_id }, query: { from: 'review' } }" class="btn btn-neutral btn-xs">{{ tr("审核报告") }}</router-link><button v-else type="button" class="btn btn-neutral btn-xs" @click="openReview(group.record)">{{ tr("审核") }}</button></td></tr><tr v-if="!reviewGroups.length"><td colspan="4" class="py-8 text-center opacity-60">{{ tr("暂无待审提议。") }}</td></tr></tbody></table>
      <table v-else-if="tab === 'records'" class="table table-sm"><thead><tr><th>IOC</th><th>{{ tr("来源") }}</th><th>{{ tr("上下文与证据") }}</th><th>{{ tr("状态") }}</th><th>{{ tr("操作") }}</th></tr></thead><tbody>
        <tr v-for="r in records" :key="r.id"><td><span class="badge badge-outline badge-xs">{{ r.type }}</span><p class="mt-1 max-w-xs break-all font-mono">{{ r.value }}</p><span class="badge badge-xs transition-colors duration-200 motion-reduce:transition-none" :class="r.payload.verdict === 'malicious' ? 'badge-error' : 'badge-warning'"><IntelStatusText :text="r.payload.verdict === &#39;malicious&#39; ? tr(&quot;恶意&quot;) : tr(&quot;可疑&quot;)" /></span></td><td>{{ r.source_name }}<p class="text-xs opacity-60">{{ originLabel(r) }}</p></td><td class="max-w-md"><p v-if="r.payload.actor_name">{{ tr("组织原名：") }}{{ r.payload.actor_name }} <span v-if="r.actor_id">（{{ r.actor_id }}）</span></p><p v-if="r.payload.malware">{{ tr("软件：") }}{{ r.payload.malware }}</p><p v-if="r.payload.confidence != null">{{ tr("来源置信度：") }}{{ r.payload.confidence }}</p><p v-if="r.payload.evidence" class="mt-1 line-clamp-3 break-words text-xs opacity-70">{{ r.payload.evidence }}</p></td><td><IntelStatusText :text="states[r.status]" /><p v-if="r.valid_until" class="text-xs">{{ tr("有效至") }} {{ formatDateTime(r.valid_until) }}</p></td><td><button v-if="r.status === 'pending'" class="btn btn-neutral btn-xs" @click="openReview(r)">{{ tr("审核") }}</button><button v-else-if="['approved','expired'].includes(r.status)" class="btn btn-outline btn-xs" @click="openReview(r, 'revoked')">{{ tr("证据 / 撤销") }}</button></td></tr>
        <tr v-if="!records.length"><td colspan="5" class="py-8 text-center opacity-60">{{ tab === 'review' ? tr("暂无待审提议。AI 关闭时不会产生新的 AI 提议。") : tr("暂无匹配记录。") }}</td></tr>
      </tbody></table>
      <table v-else-if="tab === 'articles'" class="table table-sm"><thead><tr><th>{{ tr("文章") }}</th><th>{{ tr("来源") }}</th><th>{{ tr("提取状态") }}</th><th>{{ tr("操作") }}</th></tr></thead><tbody><tr v-for="r in articles" :key="r.id"><td><a v-if="safeReference(r.url)" :href="safeReference(r.url)" target="_blank" rel="noopener noreferrer" class="link">{{ r.title || r.url }}</a><p class="text-xs opacity-60">{{ formatDateTime(r.created_at) }}</p></td><td>{{ r.source_name }}<p v-if="r.source_enabled === false" class="mt-1 text-xs text-warning">{{ tr("来源已停用，启用后可提取。") }}<button type="button" class="link ml-1" @click="changeTab('sources')">{{ tr("管理来源") }}</button></p><p class="text-xs opacity-60">{{ articleIntakeLabel(r.extraction_metadata) }}</p></td><td><IntelStatusText :text="articleStatusLabel(r)" /><p v-if="r.extraction_metadata?.result" class="mt-1 text-xs opacity-65">{{ tr("本次有效 IOC") }} {{ r.extraction_metadata.result.parsed }} {{ tr("条，新增提议") }} {{ r.extraction_metadata.result.inserted }} {{ tr("条") }}<span v-if="r.extraction_metadata.result.validation?.rejected">；{{ r.extraction_metadata.result.validation.rejected }} {{ tr("条因原文证据不符未保留") }}</span>。</p><IntelArticleValidation :report="r.extraction_metadata?.result?.validation || r.extraction_metadata?.last_error?.validation" /><IntelArticleDiagnostics v-if="r.extraction_metadata?.ai_usage" kind="usage" :diagnostic="r.extraction_metadata.ai_usage" :article-id="r.id" /><p v-if="r.error_code" class="text-xs text-error">{{ intelError(r.error_code) }}</p><IntelArticleDiagnostics v-if="r.error_code" :diagnostic="r.extraction_metadata?.last_error" :article-id="r.id" /></td><td><IntelArticleSnapshot :article="r" /><button type="button" class="btn btn-ghost btn-xs" :disabled="busy" @click="editArticle(r)">{{ tr("编辑") }}</button><button type="button" class="btn btn-ghost btn-xs text-error" :disabled="busy" @click="confirmDelete('articles', r)">{{ tr("删除") }}</button><button v-if="['failed','cancelled','proposed','succeeded'].includes(r.status)" class="btn btn-xs" :disabled="busy || !settings.ai_enabled || r.source_enabled === false" @click="retryArticle(r)">{{ ['proposed','succeeded'].includes(r.status) ? tr("重新提取") : tr("重试提取") }}</button><router-link v-if="r.pending_count > 0" :to="{ name: 'intel-report-review', params: { articleId: r.id }, query: { from: 'articles' } }" class="btn btn-neutral btn-xs ml-1">{{ tr("审核报告") }}</router-link></td></tr><tr v-if="!articles.length"><td colspan="4" class="py-8 text-center opacity-60">{{ tr("暂无文章。") }}</td></tr></tbody></table>
      <table v-else-if="tab === 'entities'" class="table table-sm"><thead><tr><th>ATT&amp;CK ID</th><th>{{ tr("标准名称") }}</th><th>{{ tr("关联名称") }}</th><th>{{ tr("状态") }}</th></tr></thead><tbody><tr v-for="r in entities" :key="r.attack_id"><td><button type="button" class="link font-mono" @click="showEntity(r)">{{ r.attack_id }}</button></td><td>{{ r.name }}</td><td class="max-w-lg">{{ r.aliases.join('、') || '—' }}<p class="text-xs opacity-60">{{ tr("关联名称可能仅部分重叠，不自动作为等价别名。") }}</p></td><td><IntelStatusText :text="r.active ? tr(&quot;有效&quot;) : tr(&quot;已撤销 / 弃用&quot;)" /></td></tr><tr v-if="!entities.length"><td colspan="4" class="py-8 text-center opacity-60">{{ tr("暂无结果；首次使用请先同步 MITRE 来源。") }}</td></tr></tbody></table>
      <div v-else-if="tab === 'mappings'" class="p-4 space-y-5"><div><h2 class="font-semibold">{{ tr("未映射组织与软件名称") }}</h2><p class="mt-1 text-sm opacity-65">{{ tr("组织可对应到有效 MITRE 或人工创建的本地条目；软件仍使用 MITRE 基准库。未映射名称不会自动创建实体。") }}</p><div v-for="r in mappings.unmapped" :key="`${r.source_id}:${r.kind}:${r.name}`" class="flex flex-wrap items-center justify-between gap-3 border-b border-base-300 py-3"><span>{{ r.kind === 'software' ? tr("软件 / 家族") : tr("组织") }} · {{ r.name }} · {{ r.source_name }} · {{ r.count }} {{ tr("条") }}</span><button class="btn btn-outline btn-xs" @click="openMapping(r)">{{ tr("核对对应关系") }}</button></div><p v-if="!mappings.unmapped.length" class="py-4 text-sm opacity-60">{{ tr("暂无未映射名称。") }}</p></div><div><h2 class="font-semibold">{{ tr("已确认的来源名称映射") }}</h2><div v-for="r in mappings.mappings" :key="r.id" class="flex items-center justify-between gap-3 py-2 text-sm"><span>{{ r.name }} → {{ r.canonical_name }}（{{ r.attack_id }}）</span><button type="button" class="btn btn-ghost btn-xs" :disabled="busy" @click="deleteMapping(r)">{{ tr("撤销映射") }}</button></div></div></div>
      <table v-else-if="tab === 'jobs'" class="table table-sm"><thead><tr><th>{{ tr("来源") }}</th><th>{{ tr("时间") }}</th><th>{{ tr("状态") }}</th><th>{{ tr("结果") }}</th></tr></thead><tbody><tr v-for="r in jobs" :key="r.id"><td>{{ r.source_name }}</td><td>{{ formatDateTime(r.created_at) }}</td><td><IntelStatusText :text="states[r.status]" /></td><td><p v-if="r.error_code" class="text-error">{{ intelError(r.error_code) }}</p><code class="text-xs break-all">{{ JSON.stringify(r.summary) }}</code><IntelValidation :report="r.summary?.validation" /></td></tr><tr v-if="!jobs.length"><td colspan="4" class="py-8 text-center opacity-60">{{ tr("暂无作业。") }}</td></tr></tbody></table>
    </div>
    <div v-if="['records','review'].includes(tab) && (total > 50 || offset)" class="flex justify-end items-center gap-3 text-sm"><span>{{ tr("共") }} {{ total }} {{ tr("条") }}</span><button class="btn btn-sm" :disabled="loading || offset === 0" @click="offset = Math.max(0, offset - 50); refresh()">{{ tr("上一页") }}</button><button class="btn btn-sm" :disabled="loading || offset + 50 >= total" @click="offset += 50; refresh()">{{ tr("下一页") }}</button></div>

    <dialog ref="deleteDialog" class="modal" @cancel="busy && $event.preventDefault()">
      <div class="modal-box">
        <h3 class="text-lg font-semibold">{{ tr("删除") }}{{ deleteTarget?.kind === 'sources' ? tr("来源") : tr("文章") }}</h3>
        <p class="mt-4 break-words">{{ tr("确认删除“") }}{{ deleteTarget?.name }}”？</p>
        <p class="mt-3 text-sm opacity-70">{{ deleteTarget?.kind === 'sources' ? tr("此来源将停止同步，关联文章将从列表移除，关联情报不再参与资产标记。") : tr("此文章将停止提取，仅由此文章支持的情报不再参与资产标记。") }}{{ tr("历史证据和审核记录保留供追溯。") }}</p>
        <p v-if="managementError" role="alert" class="mt-3 text-error">{{ managementError }}</p>
        <div class="modal-action"><button type="button" class="btn btn-ghost" :disabled="busy" @click="deleteDialog?.close()">{{ tr("取消") }}</button><button type="button" class="btn btn-error" :disabled="busy" @click="deleteItem">{{ busy ? tr("正在删除…") : tr("确认删除") }}</button></div>
      </div>
    </dialog>
    <dialog ref="articleEditDialog" class="modal" @cancel="busy && $event.preventDefault()">
      <div class="modal-box max-w-3xl">
        <h3 class="text-lg font-semibold">{{ tr("编辑文章") }}</h3>
        <p class="my-3 text-sm opacity-65">{{ tr("保存后生成新快照并重新提取，结果须人工审核。原快照保留供追溯，其独有情报将停止参与标记。") }}</p>
        <p v-if="managementError" role="alert" class="my-3 text-error">{{ managementError }}</p>
        <p v-if="articleEditLoading" role="status" class="py-8 text-center opacity-60">{{ tr("正在加载文章…") }}</p>
        <form v-if="articleEditForm" class="space-y-3" @submit.prevent="saveArticle">
          <p class="text-sm">{{ tr("来源：") }}{{ articleEditForm.source_name }}</p>
          <label class="form-control block text-sm">{{ tr("标题") }}<input v-model="articleEditForm.title" class="input input-bordered mt-1 w-full" maxlength="500" required :disabled="busy" /></label>
          <label class="form-control block text-sm">{{ tr("原文 HTTPS 地址") }}<input v-model="articleEditForm.url" type="url" class="input input-bordered mt-1 w-full" maxlength="4096" required :disabled="busy" /></label>
          <label class="form-control block text-sm">{{ tr("正文快照（纯文本；留空重新抓取）") }}<textarea v-model="articleEditForm.body" class="textarea textarea-bordered mt-1 w-full" rows="10" maxlength="100000" :disabled="busy"></textarea></label>
          <div class="modal-action"><button type="button" class="btn btn-ghost" :disabled="busy" @click="articleEditDialog?.close()">{{ tr("取消") }}</button><button class="btn btn-neutral" :disabled="busy">{{ busy ? tr("正在保存…") : tr("保存并重新提取") }}</button></div>
        </form>
        <div v-else class="modal-action"><button type="button" class="btn btn-ghost" @click="articleEditDialog?.close()">{{ tr("关闭") }}</button></div>
      </div>
    </dialog>
    <dialog ref="importDialog" class="modal" @cancel="busy && $event.preventDefault()" @close="importFile = null">
      <form class="modal-box space-y-4" @submit.prevent="uploadImport">
        <h2 class="text-lg font-semibold">{{ tr("上传离线历史文件") }}</h2>
        <p class="text-sm">{{ importSource?.name }} {{ tr("· 支持 JSON、CSV 和单文件 ZIP。只用于按需补齐历史，持续更新仍使用 API。") }}</p>
        <p v-if="importError" role="alert" class="text-sm text-error">{{ importError }}</p>
        <input ref="importFileInput" type="file" accept=".json,.csv,.zip" class="file-input file-input-bordered w-full" required :disabled="busy" @change="importFile = $event.target.files?.[0] || null" />
        <p class="text-xs opacity-65">{{ tr("上传最多 512 MiB；解压内容与规范化结果各最多 2 GiB。先完整校验，再分批入库。可信来源沿用接纳策略，历史数据按观察时间自动判断是否过期。") }}</p>
        <div v-if="busy" role="status" class="space-y-2">
          <progress class="progress progress-primary w-full" :value="uploadProgress" max="100" :aria-label="tr(&quot;离线文件上传进度&quot;)"></progress>
          <p class="text-sm">{{ uploadChecking ? tr("正在检查服务端缓存和来源状态…") : uploadProgress == null ? tr("正在连接服务器，准备上传…") : uploadProgress < 100 ? tr("正在上传：{0}%", [uploadProgress]) : tr("文件已发送，等待服务器保存并创建导入作业…") }}</p>
        </div>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" @click="busy ? cancelImport() : importDialog?.close()">{{ busy ? tr("取消等待") : tr("取消") }}</button>
          <button class="btn btn-neutral" :disabled="busy || !importFile">{{ tr("上传并导入") }}</button>
        </div>
      </form>
    </dialog>

    <dialog id="intel-source-details" ref="sourceDetailsDialog" class="modal" aria-labelledby="intel-source-details-title" @close="sourceDetails = null">
      <div class="modal-box max-w-2xl">
        <h3 id="intel-source-details-title" class="text-lg font-bold">{{ tr("来源配置详情") }}</h3>
        <dl v-if="sourceDetails" class="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-4 py-4 text-sm">
          <div class="col-span-full min-w-0">
            <dt class="opacity-60">{{ tr("来源 ID") }}</dt>
            <dd class="mt-1 flex items-center gap-2">
              <code class="min-w-0 select-text break-all">{{ sourceDetails.id }}</code>
              <button type="button" class="btn btn-ghost btn-xs btn-square shrink-0" :aria-label="tr(&quot;复制来源 ID&quot;)" :title="tr(&quot;复制来源 ID&quot;)" @click="copySourceId">
                <Copy class="size-4" aria-hidden="true" />
              </button>
            </dd>
            <p class="mt-1 text-xs opacity-60" role="status">{{ sourceCopyMessage }}</p>
          </div>
          <div><dt class="opacity-60">{{ tr("来源名称") }}</dt><dd class="mt-1 break-words">{{ sourceDetails.name }}</dd></div>
          <div><dt class="opacity-60">{{ tr("启用状态") }}</dt><dd class="mt-1">{{ sourceDetails.enabled ? tr("已启用") : tr("已停用") }}</dd></div>
          <div><dt class="opacity-60">{{ tr("数据格式") }}</dt><dd class="mt-1">{{ sourceKinds[sourceDetails.kind] }}</dd></div>
          <div><dt class="opacity-60">{{ tr("获取方式") }}</dt><dd class="mt-1">{{ sourceDetails.transport === 'manual' ? tr("手动文章") : sourceDetails.transport === 'upload' ? tr("离线上传") : sourceDetails.transport === 'local' ? tr("本地文件") : tr("远程 HTTPS") }}</dd></div>
          <div class="col-span-full min-w-0"><dt class="opacity-60">{{ tr("来源位置") }}</dt><dd class="mt-1 break-all">{{ sourceDetails.location || '—' }}</dd></div>
          <div class="col-span-full min-w-0"><dt class="opacity-60">{{ tr("允许的域名") }}</dt><dd class="mt-1 whitespace-pre-wrap break-all">{{ sourceDetails.allowed_hosts?.join('\n') || '—' }}</dd></div>
          <template v-if="sourceDetails.transport === 'https' || ['rss','article'].includes(sourceDetails.kind)">
            <div><dt class="opacity-60">{{ tr("代理方式") }}</dt><dd class="mt-1">{{ { system: tr("跟随全局"), direct: tr("直连"), custom: tr("指定代理") }[sourceDetails.request_config?.proxy_mode || 'system'] }}</dd></div>
            <div v-if="sourceDetails.request_config?.proxy_mode === 'custom'" class="col-span-full min-w-0"><dt class="opacity-60">{{ tr("代理地址") }}</dt><dd class="mt-1 break-all">{{ sourceDetails.request_config.proxy_url || '—' }}</dd></div>
            <div class="min-w-0"><dt class="opacity-60">{{ tr("自定义请求头") }}</dt><dd class="mt-1 break-all">{{ sourceDetails.request_config?.headers?.map(header => header.name).join('、') || '—' }}</dd></div>
          </template>
          <div><dt class="opacity-60">{{ tr("检查周期") }}</dt><dd class="mt-1">{{ sourceDetails.transport === 'manual' ? tr("手动提交，不周期抓取") : sourceDetails.transport === 'upload' || sourceDetails.kind === 'threatfox_export' ? tr("手动导入，不定时拉取") : tr("{0} 秒", [sourceDetails.interval_seconds]) }}</dd></div>
          <div><dt class="opacity-60">{{ tr("情报有效期") }}</dt><dd class="mt-1">{{ sourceDetails.expiry_months ? tr("{0} 个月", [sourceDetails.expiry_months]) : tr("不设置本地期限") }}</dd></div>
          <div><dt class="opacity-60">{{ tr("接纳策略") }}</dt><dd class="mt-1">{{ ['rss','article'].includes(sourceDetails.kind) ? tr("AI 固定人工审核") : sourceDetails.kind === 'mitre_stix' ? tr("规范化基准库") : sourceDetails.require_review ? tr("人工审核后接纳") : tr("可信 IOC 直接接纳") }}</dd></div>
          <template v-if="sourceDetails.transport === 'https'">
            <div><dt class="opacity-60">{{ tr("凭据状态") }}</dt><dd class="mt-1">{{ sourceDetails.credential_source === 'database' ? tr("数据库加密存储") : sourceDetails.credential_configured ? tr("环境变量") : tr("未配置") }}</dd></div>
            <div class="min-w-0"><dt class="opacity-60">{{ tr("凭据环境变量") }}</dt><dd class="mt-1 break-all">{{ sourceDetails.auth_env || '—' }}</dd></div>
          </template>
        </dl>
        <div class="modal-action flex-wrap">
          <button type="button" class="btn btn-neutral" @click="editSource(sourceDetails); sourceDetailsDialog?.close()">{{ tr("编辑来源") }}</button>
          <form method="dialog"><button class="btn">{{ tr("关闭") }}</button></form>
        </div>
      </div>
    </dialog>

    <dialog ref="sourceDialog" class="modal" @close="clearSourceCredential"><form class="modal-box max-w-2xl space-y-4" @submit.prevent="saveSource"><h2 class="text-lg font-semibold">{{ sourceForm.id ? tr("编辑来源") : tr("添加来源") }}</h2><div v-if="error" class="alert alert-error text-sm" role="alert">{{ error }}</div>
      <label class="form-control min-w-0 text-sm">{{ tr("来源名称") }}<input v-model="sourceForm.name" class="input input-bordered mt-1 w-full" required maxlength="100" /></label>
      <div class="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3"><label class="form-control min-w-0 text-sm">{{ tr("数据格式") }}<select v-model="sourceForm.kind" class="select select-bordered mt-1 w-full" @change="kindChanged"><option v-for="(label, kind) in sourceKinds" :key="kind" :value="kind">{{ label }}</option></select></label><label class="form-control min-w-0 text-sm">{{ tr("获取方式") }}<select v-model="sourceForm.transport" class="select select-bordered mt-1 w-full"><option v-if="sourceForm.kind === 'article'" value="manual">{{ tr("手动提交文章") }}</option><option value="https" :disabled="['threatfox_export','article'].includes(sourceForm.kind)">{{ tr("远程 HTTPS 拉取") }}</option><option value="local" :disabled="sourceForm.kind === 'article'">{{ tr("本地文件") }}</option><option v-if="['json','lines','threatfox_export'].includes(sourceForm.kind)" value="upload">{{ tr("离线上传文件") }}</option></select></label></div>
      <label v-if="!['upload','manual'].includes(sourceForm.transport)" class="form-control min-w-0 text-sm">{{ sourceForm.transport === 'local' ? tr("相对 IOC 根目录的文件路径") : tr("远程地址") }}<input v-model="sourceForm.location" class="input input-bordered mt-1 w-full" required maxlength="2048" :placeholder="sourceForm.transport === 'local' ? 'vendor/feed.json' : 'https://…'" /></label>
      <label v-if="sourceForm.transport === 'https' || ['rss','article'].includes(sourceForm.kind)" class="form-control min-w-0 text-sm">{{ tr("允许的域名（每行一个）") }}<textarea v-model="hostsText" class="textarea textarea-bordered mt-1 w-full" rows="3" required placeholder="raw.githubusercontent.com&#10;*.example.com"></textarea><span class="mt-1 text-xs opacity-60">{{ tr("支持完整域名、*.example.com（仅子域名）和 *（全部域名）；主域名需单独添加。") }}</span></label>
      <fieldset v-if="sourceForm.transport === 'https' || ['rss','article'].includes(sourceForm.kind)" class="min-w-0 space-y-3 rounded-box border border-base-300 p-3">
        <legend class="px-1 text-sm font-medium">{{ tr("远程请求设置") }}</legend>
        <label class="form-control min-w-0 text-sm">{{ tr("代理方式") }}<select v-model="sourceForm.request_config.proxy_mode" class="select select-bordered mt-1 w-full"><option value="system">{{ tr("跟随全局") }}</option><option value="direct">{{ tr("直连") }}</option><option value="custom">{{ tr("指定代理") }}</option></select></label>
        <label v-if="sourceForm.request_config.proxy_mode === 'custom'" class="form-control min-w-0 text-sm">{{ tr("代理地址") }}<input v-model="sourceForm.request_config.proxy_url" type="text" autocomplete="off" maxlength="2048" class="input input-bordered mt-1 w-full" required :placeholder="tr(&quot;http://127.0.0.1:7890 或 socks5h://127.0.0.1:1080&quot;)" /><span class="mt-1 text-xs opacity-60">{{ tr("支持 HTTP、HTTPS、SOCKS5 和 SOCKS5H，切换为跟随全局或直连可清除已保存地址。") }}</span></label>
        <div class="flex items-center justify-between gap-2"><span class="text-sm">{{ tr("自定义请求头") }}</span><button type="button" class="btn btn-ghost btn-sm" :disabled="sourceForm.request_config.headers.length >= 64" @click="sourceForm.request_config.headers.push({ name: '', value: '', configured: false })">{{ tr("添加请求头") }}</button></div>
        <div v-for="(header, index) in sourceForm.request_config.headers" :key="index" class="flex min-w-0 flex-wrap items-end gap-2">
          <label class="form-control min-w-0 flex-1 basis-40 text-sm">{{ tr("名称") }}<input v-model="header.name" required maxlength="256" class="input input-bordered mt-1 w-full" placeholder="User-Agent" @input="header.configured = false" /></label>
          <label class="form-control min-w-0 flex-1 basis-48 text-sm">{{ tr("值") }}<input v-model="header.value" type="password" autocomplete="new-password" :required="!header.configured" maxlength="8192" class="input input-bordered mt-1 w-full" :placeholder="header.configured ? tr(&quot;已保存，留空保留&quot;) : tr(&quot;请求头值&quot;)" /></label>
          <button type="button" class="btn btn-ghost btn-sm" :aria-label="tr(&quot;删除请求头 {0}&quot;, [index + 1])" @click="sourceForm.request_config.headers.splice(index, 1)">{{ tr("删除") }}</button>
        </div>
        <p class="text-xs opacity-65">{{ tr("应用于来源同步和文章正文抓取。代理地址明文显示，可直接修改；请求头值加密保存，留空保留，删除后保存即可清除。跨站跳转不会转发自定义请求头。") }}</p>
      </fieldset>
      <div class="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3"><label class="form-control min-w-0 text-sm" v-if="!['upload','manual'].includes(sourceForm.transport) && sourceForm.kind !== 'threatfox_export'">{{ tr("检查周期（秒）") }}<input v-model="sourceForm.interval_seconds" type="number" min="60" max="2592000" class="input input-bordered mt-1 w-full" required /><span class="mt-1 text-xs opacity-60">{{ tr("该格式默认") }} {{ defaultIntervals[sourceForm.kind] }} {{ tr("秒，可自行调整。") }}</span></label><label v-if="sourceForm.transport === 'https'" class="form-control min-w-0 text-sm">{{ tr("凭据环境变量（可选）") }}<input v-model="sourceForm.auth_env" class="input input-bordered mt-1 w-full" placeholder="NM_INTEL_…" /></label></div>
      <template v-if="sourceForm.transport === 'https'"><label class="form-control min-w-0 text-sm">{{ tr("数据库加密凭据（留空保留）") }}<input v-model="sourceForm.credential" type="password" autocomplete="new-password" maxlength="8192" class="input input-bordered mt-1 w-full" :disabled="sourceForm.clear_credential" :placeholder="tr(&quot;Auth-Key 或完整 Authorization 值&quot;)" /></label><label v-if="sourceForm.database_credential_configured" class="flex items-center gap-2 text-sm"><input v-model="sourceForm.clear_credential" type="checkbox" class="checkbox checkbox-sm" />{{ tr("清除已保存的数据库凭据") }}</label><p class="text-xs opacity-65">{{ sourceForm.database_credential_configured ? tr("已保存数据库加密凭据。") : tr("尚未保存数据库凭据。") }}{{ tr("优先使用数据库凭据，留空保留，清除后使用环境变量备用来源。ThreatFox 填写原始 Auth-Key；其他格式填写完整 Authorization 值。") }}</p></template>
      <label class="flex items-center gap-2 text-sm"><input v-model="sourceForm.enabled" type="checkbox" class="checkbox checkbox-sm" />{{ tr("启用") }}{{ sourceForm.transport === 'manual' ? tr("文章提交") : sourceForm.transport === 'upload' || sourceForm.kind === 'threatfox_export' ? tr("该离线来源") : tr("自动检查") }}</label>
      <label class="form-control min-w-0 text-sm">{{ tr("自动情报有效期（月）") }}<input v-model="sourceForm.expiry_months" type="number" min="0" max="120" class="input input-bordered mt-1 w-full" required /><span class="mt-1 text-xs opacity-60">{{ tr("默认 6 个月，按最后观察时间计算，缺失时用首次观察或首次入库时间。0 不设置本地有效期，来源明确到期仍生效。") }}</span></label>
      <label v-if="!['rss','article','mitre_stix'].includes(sourceForm.kind)" class="flex items-center gap-2 text-sm"><input v-model="sourceForm.require_review" type="checkbox" class="checkbox checkbox-sm" />{{ tr("该来源的结构化 IOC 需要人工审核") }}</label>
      <p class="text-xs opacity-65">{{ tr("可信官方 IOC 默认直接接纳，不受置信度或来源数量限制。RSS 与手动文章的 AI 提取结果固定需要人工审核。停用来源会停止后续同步，已有结论可在 IOC 库撤销。") }}</p>
      <div class="modal-action"><button type="button" class="btn btn-ghost" @click="sourceDialog?.close()">{{ tr("取消") }}</button><button class="btn btn-neutral" :disabled="busy">{{ tr("保存来源") }}</button></div>
    </form><form method="dialog" class="modal-backdrop"><button>{{ tr("关闭") }}</button></form></dialog>

    <dialog ref="reviewDialog" class="modal"><form class="modal-box max-w-4xl space-y-4" @submit.prevent="submitReview"><h2 class="text-lg font-semibold">{{ selected?.status === 'pending' ? tr("审核 IOC 提议") : tr("证据与撤销") }}</h2>
      <template v-if="selected"><button type="button" class="link link-hover break-all text-left font-mono" @click="locateSelectedIoc">{{ selected.type }} · {{ selected.value }}</button><p v-if="selected.origin === 'ai' && article?.body && !selectedIocLocation" role="alert" class="alert alert-warning text-sm">{{ tr("该 IOC 未在原文中找到，请核对后再决定。") }}</p><p class="text-sm">{{ selected.source_name }} · {{ originLabel(selected) }}</p><div class="grid gap-4 md:grid-cols-2"><div class="space-y-3"><h3 class="font-semibold">{{ tr("提议与支持证据") }}</h3><p v-if="selected.payload.actor_name">{{ tr("组织原名：") }}{{ selected.payload.actor_name }}{{ tr("；标准 ID：") }}{{ selected.actor_id || tr("未映射") }}</p><p v-if="selected.payload.malware">{{ tr("软件：") }}{{ selected.payload.malware }}</p><p v-if="selected.payload.attack_types?.length">{{ tr("攻击行为：") }}{{ selected.payload.attack_types.map(attackLabel).join('、') }}</p><p v-if="selected.payload.role">{{ tr("指标角色：") }}{{ roleLabel(selected.payload.role) }}</p><p v-if="selected.payload.resource_owner">{{ tr("资源登记方：") }}{{ selected.payload.resource_owner }}{{ tr("（不作为攻击者归因）") }}</p><p v-if="selected.payload.techniques?.length">{{ tr("报告技术：") }}{{ selected.payload.techniques.join('、') }}</p><p v-if="selected.payload.victim_industries?.length">{{ tr("受害行业：") }}{{ selected.payload.victim_industries.join('、') }}</p><p v-if="selected.payload.victim_countries?.length">{{ tr("受害地区：") }}{{ selected.payload.victim_countries.join('、') }}</p><IntelEvidenceQuote :payload="selected.payload" :locatable="Boolean(article?.body)" @locate="locateEvidence" /><a v-if="safeReference(selected.payload.reference)" :href="safeReference(selected.payload.reference)" class="link text-sm" target="_blank" rel="noopener noreferrer">{{ tr("查看来源") }}</a><p class="text-xs opacity-60 break-all">{{ tr("提议版本") }} {{ selected.content_hash }}</p></div><div><h3 class="font-semibold">{{ tr("文章快照") }}</h3><p v-if="article?.extraction_metadata?.intake" class="text-xs opacity-65">{{ articleIntakeLabel(article.extraction_metadata) }}<span v-if="article.extraction_metadata.intake.publisher_id"> · {{ article.extraction_metadata.intake.publisher_id }}</span></p><span v-if="articleLoading" class="loading loading-spinner loading-sm"></span><p v-else-if="article?.body" class="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-base-200 p-3 text-sm"><template v-if="focusedExcerpt">{{ focusedExcerpt.before }}<mark ref="evidenceMark" class="bg-warning text-warning-content">{{ focusedExcerpt.quote }}</mark>{{ focusedExcerpt.after }}</template><template v-else>{{ article.body }}</template></p><div v-else-if="selected.origin === 'ai'" class="mt-2 space-y-2"><p role="alert" class="text-sm text-error">{{ articleError || tr("请先加载原文快照，才能接纳 AI 提议。") }}</p><button v-if="selected.article_id" type="button" class="btn btn-outline btn-sm" :disabled="busy" @click="loadReviewArticle">{{ tr("重试加载原文") }}</button></div><p v-else class="mt-2 text-sm opacity-65">{{ tr("该记录来自结构化 IOC，无 AI 文章快照。") }}</p></div></div>
        <IntelActorReview v-if="selected.status === 'pending' && reviewDecision === 'approved'" :record="selected" :disabled="busy" @change="actorDecision = $event" />
        <label v-if="selected.status === 'pending'" class="form-control min-w-0 text-sm">{{ tr("审核决定") }}<select v-model="reviewDecision" class="select select-bordered mt-1 w-full"><option value="approved">{{ tr("接纳该 IOC 及所列事实") }}</option><option value="rejected">{{ tr("拒绝该提议") }}</option></select></label>
        <label class="form-control min-w-0 text-sm">{{ reviewDecision === 'revoked' ? tr("撤销原因") : tr("审核说明") }}<textarea v-model="reason" class="textarea textarea-bordered mt-1 w-full" maxlength="1000" required rows="2"></textarea></label>
        <p v-if="selected.origin === 'ai'" class="text-xs opacity-65">{{ tr("请核对 IOC 角色、归因及证据是否明确。受害目标不能误标为攻击基础设施；接纳后才进入有效 IOC 库。") }}</p>
      </template>
      <div class="modal-action"><button type="button" class="btn btn-ghost" @click="reviewDialog?.close()">{{ tr("关闭") }}</button><button class="btn" :class="reviewDecision === 'approved' ? 'btn-neutral' : 'btn-error'" :disabled="reviewBlocked">{{ reviewDecision === 'revoked' ? tr("撤销这条证据") : tr("提交审核决定") }}</button></div>
    </form><form method="dialog" class="modal-backdrop"><button>{{ tr("关闭") }}</button></form></dialog>

    <dialog ref="entityDialog" class="modal"><div class="modal-box max-w-3xl space-y-3"><h2 class="text-lg font-semibold">{{ tr("MITRE 关系与来源") }}</h2><span v-if="entityLoading" class="loading loading-spinner"></span><template v-if="entityDetail"><h3 class="font-semibold">{{ entityDetail.entity.name }}</h3><p class="text-sm whitespace-pre-wrap break-words">{{ entityDetail.entity.description }}</p><p class="text-xs opacity-65">{{ tr("以下是 MITRE 已报告的使用或技术关系，不代表任何当前 IOC 的组织归因。") }}</p><div class="overflow-x-auto"><table class="table table-sm"><thead><tr><th>{{ tr("关系") }}</th><th>{{ tr("方向") }}</th><th>{{ tr("实体") }}</th></tr></thead><tbody><tr v-for="r in entityDetail.relationships" :key="`${r.attack_id}:${r.direction}:${r.relation}`"><td>{{ r.relation }}</td><td>{{ r.direction === 'incoming' ? tr("指向本实体") : tr("本实体指向") }}</td><td>{{ r.name }}（{{ r.attack_id }}）</td></tr></tbody></table></div></template><div class="modal-action"><button type="button" class="btn" @click="entityDialog?.close()">{{ tr("关闭") }}</button></div></div><form method="dialog" class="modal-backdrop"><button>{{ tr("关闭") }}</button></form></dialog>
    <dialog ref="mappingDialog" class="modal"><form class="modal-box max-w-2xl space-y-4" @submit.prevent="saveMapping"><h2 class="text-lg font-semibold">{{ tr("核对来源名称与 MITRE 实体") }}</h2><p>{{ tr("原名：") }}{{ mappingForm.name }}</p><div class="flex min-w-0 flex-wrap justify-end gap-2"><input v-model="candidateQuery" class="input input-bordered min-w-0 max-w-full flex-1 basis-56" :aria-label="tr(&quot;搜索 MITRE 候选组织&quot;)" /><button type="button" class="btn" @click="searchCandidates">{{ tr("搜索候选") }}</button></div><label class="form-control min-w-0 text-sm">{{ tr("确认对应实体") }}<select v-model="mappingForm.attack_id" class="select select-bordered mt-1 w-full" required><option disabled value="">{{ tr("请选择已核实的 MITRE 实体") }}</option><option v-for="r in candidates" :key="r.attack_id" :value="r.attack_id">{{ r.attack_id }} · {{ r.name }}</option></select></label><p class="text-sm opacity-65">{{ tr("MITRE 关联名称可能仅部分重叠。此操作表示你已核实该来源的这个名称与所选实体对应，不会创建新实体；软件映射不产生组织归因。") }}</p><div class="modal-action"><button type="button" class="btn btn-ghost" @click="mappingDialog?.close()">{{ tr("取消") }}</button><button class="btn btn-neutral" :disabled="busy || !mappingForm.attack_id">{{ tr("保存已核实映射") }}</button></div></form><form method="dialog" class="modal-backdrop"><button>{{ tr("关闭") }}</button></form></dialog>
  </main>
</template>
