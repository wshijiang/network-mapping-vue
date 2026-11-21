<script setup>
import { tr } from '../i18n/index.js'

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import http from '../utils/http'
import { evidenceExcerpt, intelError, states, roleLabel, safeReference } from '../utils/threatIntel'
import { articleIocLocations, reportReviewItems } from '../utils/intelReportReview'
import IntelActorReview from '../components/IntelActorReview.vue'
import IntelEvidenceQuote from '../components/IntelEvidenceQuote.vue'

const route = useRoute()
const backTab = computed(() => route.query.from === 'articles' ? 'articles' : 'review')
const backTo = computed(() => ({ path: '/admin/intel', query: { tab: backTab.value } }))
const notice = ref('')
const submitDialog = ref(null), submitError = ref('')
const article = ref(null), records = ref([]), decisions = ref({}), attribution = ref({})
const loading = ref(false), saving = ref(false), error = ref(''), reason = ref(''), selected = ref(null), focused = ref(null), mark = ref(null)
let controller, version = 0
const locations = computed(() => articleIocLocations(article.value?.body, records.value))
const items = computed(() => reportReviewItems(records.value, decisions.value, attribution.value))
const missing = computed(() => loading.value || !article.value?.body ? [] : records.value.filter(record => decisions.value[record.id] && !locations.value.has(record.id)))
const excerpt = computed(() => evidenceExcerpt(article.value?.body, focused.value))
const reviewBlocked = computed(() => loading.value || saving.value || !items.value.length || (items.value.some(item => item.decision === 'approved') && !article.value?.body?.trim()))
const blocked = computed(() => reviewBlocked.value || !reason.value.trim())

async function load() {
  const current = ++version
  controller?.abort(); controller = new AbortController()
  loading.value = true; error.value = ''; article.value = null; records.value = []; selected.value = null; focused.value = null; decisions.value = {}; attribution.value = {}
  try {
    const response = await http.get(`/api/intel/articles/${encodeURIComponent(route.params.articleId)}/review`, { signal: controller.signal })
    if (current !== version) return
    const data = response.data.data
    article.value = data.article; records.value = data.records
    for (const record of records.value) if (record.status === 'pending') decisions.value[record.id] = 'approved'
    selected.value = records.value.find(record => record.status === 'pending') || records.value[0] || null
  } catch (e) { if (current === version && e.code !== 'ERR_CANCELED') error.value = intelError(e) }
  finally { if (current === version) loading.value = false }
}
async function locate(record) {
  selected.value = record
  await locateSpan(locations.value.get(record.id))
}
async function locateSpan(span) {
  if (!evidenceExcerpt(article.value?.body, span)) { focused.value = null; return }
  focused.value = span
  await nextTick()
  mark.value?.scrollIntoView({ block: 'nearest' })
}
function decideAll(decision) {
  for (const record of records.value) if (record.status === 'pending') decisions.value[record.id] = decision
}
function openConfirmation() {
  if (reviewBlocked.value) return
  submitError.value = ''; submitDialog.value?.showModal()
}
function closeConfirmation() { if (!saving.value) submitDialog.value?.close() }
async function submit() {
  if (blocked.value) return
  const current = version
  saving.value = true; submitError.value = ''; notice.value = ''
  try {
    await http.post(`/api/intel/articles/${encodeURIComponent(route.params.articleId)}/review`, { body_hash: article.value.body_hash, reason: reason.value.trim(), items: items.value }, { signal: controller.signal })
    if (current !== version) return
    submitDialog.value?.close()
    saving.value = false; reason.value = ''; notice.value = tr("报告审核已保存，标记已按有效证据更新。")
    await load()
  } catch (e) { if (current === version && e.code !== 'ERR_CANCELED') submitError.value = intelError(e) }
  finally { if (current === version) saving.value = false }
}
function stop() { version++; controller?.abort() }
watch(() => route.params.articleId, () => { submitDialog.value?.close(); reason.value = ''; submitError.value = ''; notice.value = ''; saving.value = false; load() }, { immediate: true })
onBeforeUnmount(stop)
</script>

<template>
  <main class="page-shell flex flex-col gap-5">
    <div class="-mb-1 flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0"><h1 class="page-title">{{ tr("审核报告") }}</h1><p class="mt-2 text-sm opacity-65">{{ tr("同一报告集中审核；点击 IOC 查看其原文位置，可逐条接纳、拒绝或暂不处理。") }}</p></div>
      <router-link :to="backTo" class="btn btn-ghost btn-sm">{{ backTab === 'articles' ? tr("返回文章列表") : tr("返回审核列表") }}</router-link>
    </div>
    <div v-if="notice" role="status" class="alert alert-success text-sm">{{ notice }}</div>
    <form class="card min-w-0 space-y-4 border border-base-300 bg-base-100 p-4 md:p-6" @submit.prevent="openConfirmation">
      <div class="flex items-start justify-between gap-3">
        <h2 class="min-w-0 flex-1 break-words text-lg font-semibold"><a v-if="safeReference(article?.url)" :href="safeReference(article.url)" class="link link-hover" target="_blank" rel="noopener noreferrer">{{ article.title || article.url }}</a><template v-else>{{ article?.title || tr("文章提议") }}</template></h2>
        <button type="submit" class="btn btn-neutral shrink-0" :disabled="reviewBlocked">{{ tr("提交") }} {{ items.length }} {{ tr("条审核决定") }}</button>
      </div>
      <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
      <span v-if="loading" class="loading loading-spinner loading-sm"></span>
      <template v-else-if="article">
        <div v-if="missing.length" role="alert" class="alert alert-warning text-sm"><div><p>{{ tr("以下") }} {{ missing.length }} {{ tr("条送审 IOC 未在原文中找到，请核对后再决定：") }}</p><p class="mt-1 break-all font-mono">{{ missing.map(record => record.value).join('、') }}</p></div></div>
        <div class="grid min-w-0 gap-4 lg:grid-cols-2">
          <div class="min-w-0 space-y-3">
            <div class="flex flex-wrap items-center gap-2 text-sm"><span>{{ tr("本报告") }} {{ records.length }} {{ tr("条 IOC，待审") }} {{ records.filter(record => record.status === 'pending').length }} {{ tr("条") }}</span><button type="button" class="btn btn-ghost btn-xs" :disabled="saving" @click="decideAll('approved')">{{ tr("全部接纳") }}</button><button type="button" class="btn btn-ghost btn-xs" :disabled="saving" @click="decideAll('rejected')">{{ tr("全部拒绝") }}</button><button type="button" class="btn btn-ghost btn-xs" :disabled="saving" @click="decideAll('')">{{ tr("全部暂不处理") }}</button></div>
            <div class="max-h-80 overflow-auto rounded border border-base-300"><table class="table table-sm min-w-[32rem]"><thead><tr><th>IOC</th><th>{{ tr("角色 / 状态") }}</th><th>{{ tr("审核决定") }}</th></tr></thead><tbody><tr v-for="record in records" :key="record.id" class="cursor-pointer hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" :class="selected?.id === record.id ? 'bg-base-200' : ''" tabindex="0" :aria-label="tr(&quot;定位 IOC {0}&quot;, [record.value])" @click="locate(record)" @keydown.enter.self.prevent="locate(record)" @keydown.space.self.prevent="locate(record)"><td><span class="badge badge-outline badge-xs">{{ record.type }}</span><span class="mt-1 block max-w-xs break-all font-mono">{{ record.value }}</span></td><td>{{ roleLabel(record.payload.role) }}<p class="text-xs opacity-65">{{ states[record.status] }}</p></td><td><select v-if="record.status === 'pending'" v-model="decisions[record.id]" class="select select-bordered select-xs w-28" :disabled="saving" :aria-label="tr(&quot;{0} 的审核决定&quot;, [record.value])" @click.stop @keydown.stop><option value="approved">{{ tr("接纳") }}</option><option value="rejected">{{ tr("拒绝") }}</option><option value="">{{ tr("暂不处理") }}</option></select><span v-else class="text-xs opacity-65">{{ tr("已审核") }}</span></td></tr><tr v-if="!records.length"><td colspan="3" class="py-6 text-center opacity-65">{{ tr("本报告没有待审提议。") }}</td></tr></tbody></table></div>
            <template v-if="selected"><h3 class="break-all text-sm font-semibold">{{ selected.value }} {{ tr("的支持证据") }}</h3><IntelEvidenceQuote :payload="selected.payload" :locatable="Boolean(article.body)" @locate="locateSpan" /><IntelActorReview v-if="selected.status === 'pending' && decisions[selected.id] === 'approved' && (selected.payload.actor_name || selected.actor_id)" :key="selected.id" :record="selected" :initial-decision="attribution[selected.id]" :disabled="saving" @change="attribution[selected.id] = $event" /></template>
          </div>
          <div class="min-w-0"><h3 class="font-semibold">{{ tr("文章快照") }}</h3><p v-if="article.body" class="mt-2 max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded bg-base-200 p-3 text-sm"><template v-if="excerpt">{{ excerpt.before }}<mark ref="mark" class="bg-warning text-warning-content">{{ excerpt.quote }}</mark>{{ excerpt.after }}</template><template v-else>{{ article.body }}</template></p><p v-else role="alert" class="mt-2 text-sm text-error">{{ tr("文章快照没有有效正文，暂不能接纳。") }}</p></div>
        </div>
      </template>
      <div v-if="error" class="flex justify-end"><button type="button" class="btn btn-outline" :disabled="loading || saving" @click="load">{{ tr("重新加载报告") }}</button></div>
    </form>
    <dialog ref="submitDialog" class="modal" aria-labelledby="intel-review-submit-title" @cancel="saving && $event.preventDefault()">
      <form class="modal-box max-w-lg space-y-4" @submit.prevent="submit">
        <h2 id="intel-review-submit-title" class="text-lg font-semibold">{{ tr("提交审核决定") }}</h2>
        <p class="text-sm opacity-65">{{ tr("本次将提交") }} {{ items.length }} {{ tr("条审核决定，请填写审核说明。") }}</p>
        <p v-if="submitError" role="alert" class="text-sm text-error">{{ submitError }}</p>
        <label class="form-control block min-w-0 text-sm">{{ tr("审核说明") }}<textarea v-model="reason" class="textarea textarea-bordered mt-1 w-full" :disabled="saving" maxlength="1000" rows="4" required autofocus></textarea></label>
        <div class="modal-action"><button type="button" class="btn btn-ghost" :disabled="saving" @click="closeConfirmation">{{ tr("取消") }}</button><button type="submit" class="btn btn-neutral" :disabled="blocked">{{ saving ? tr("正在提交…") : tr("确认提交") }}</button></div>
      </form>
      <!-- <form method="dialog" class="modal-backdrop"><button :disabled="saving">关闭</button></form> -->
    </dialog>
  </main>
</template>
