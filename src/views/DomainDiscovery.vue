<script setup>
import { tr } from '../i18n/index.js'

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import http from '@/utils/http'
import IntelLookup from '@/components/IntelLookup.vue'
import DomainDiscoveryProxyCard from './DomainDiscoveryProxyCard.vue'
import { formatDateTime } from '../i18n/time.js'
import { relationLabels, discoveryStatuses, discoveryReason, canVerify, selectPage } from '@/utils/domainDiscovery'
const route = useRoute(), router = useRouter()
const seed = ref(''), includeRelated = ref(true), refresh = ref(false), busy = ref(false), loading = ref(false)
const jobs = ref([]), activeId = ref(''), evidence = ref(null), excluded = ref([]), submitted = ref([]), selected = ref([])
const error = ref(''), notice = ref(''), search = ref(''), relationFilter = ref(''), page = ref(0), relations = ref(null)
const requests = new AbortController()
let timer, disposed = false, requestVersion = 0
const activeJob = ref(null)
const active = computed(() => ['pending', 'running'].includes(activeJob.value?.status))
const candidates = computed(() => evidence.value?.candidates || relations.value?.candidates || [])
const certificates = computed(() => evidence.value?.certificates || relations.value?.certificates || [])
const filtered = computed(() => candidates.value.filter(c => (!relationFilter.value || c.relation === relationFilter.value) && c.name.includes(search.value.trim().toLowerCase())))
const visible = computed(() => filtered.value.slice(page.value * 100, (page.value + 1) * 100))
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 100)))
watch([search, relationFilter], () => { page.value = 0 })
function fail(e) { if (!disposed && e.code !== 'ERR_CANCELED') error.value = discoveryReason(e.response?.data?.code) }
async function loadJobs() {
  if (disposed) return
  try { const data = (await http.get('/api/domain-discovery/jobs', { signal: requests.signal })).data.data; if (!disposed) jobs.value = data || [] } catch (e) { fail(e) }
}
async function openJob(id) {
  if (disposed) return
  const version = ++requestVersion
  if (activeJob.value?.id !== id) activeJob.value = null
  activeId.value = id; evidence.value = null; relations.value = null; selected.value = []; submitted.value = []; excluded.value = []; page.value = 0; error.value = ''
  loading.value = true
  try {
    const job = (await http.get(`/api/domain-discovery/jobs/${id}`, { signal: requests.signal })).data.data
    if (disposed || requestVersion !== version) return
    activeJob.value = job
    if (!['succeeded', 'partial'].includes(job.status)) return
    const data = (await http.get(`/api/domain-discovery/jobs/${id}/results`, { signal: requests.signal })).data.data
    if (disposed || requestVersion !== version) return
    evidence.value = data.evidence; excluded.value = data.excluded || []; submitted.value = data.dns_tasks || []
  } catch (e) { if (requestVersion === version) fail(e) } finally { if (requestVersion === version) loading.value = false }
}
async function create() {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const data = (await http.post('/api/domain-discovery/jobs', { seed: seed.value.trim(), include_related: includeRelated.value, refresh: refresh.value }, { signal: requests.signal })).data.data
    if (disposed) return
    await loadJobs(); await openJob(data.job.id)
    notice.value = data.reused ? tr("已复用进行中的作业或 24 小时内的发现结果。") : tr("发现作业已提交，完成后可选择域名执行 DNS 验证。")
  } catch (e) { fail(e) } finally { busy.value = false }
}
async function verify() {
  if (busy.value || !activeId.value || selected.value.length < 1 || selected.value.length > 500) return
  busy.value = true; error.value = ''
  try {
    const data = (await http.post(`/api/domain-discovery/jobs/${activeId.value}/dns-tasks`, { domains: selected.value }, { signal: requests.signal })).data.data
    notice.value = tr("已提交 DNS 任务：{0} 个。已有提交会复用，不重复入队。", [data.task_ids.length])
    await openJob(activeId.value)
  } catch (e) { fail(e) } finally { busy.value = false }
}
async function cancel() {
  if (busy.value) return
  const id = activeId.value, version = requestVersion
  busy.value = true
  try {
    await http.post(`/api/domain-discovery/jobs/${id}/cancel`, {}, { signal: requests.signal })
    await loadJobs()
    if (!disposed && requestVersion === version) await openJob(id)
  } catch (e) { fail(e) } finally { busy.value = false }
}
async function openRelations(domain) {
  const version = ++requestVersion
  activeId.value = ''; activeJob.value = null; evidence.value = null; relations.value = null; selected.value = []; submitted.value = []; excluded.value = []; page.value = 0; loading.value = true; error.value = ''
  seed.value = domain
  try {
    const data = (await http.get(`/api/domains/${encodeURIComponent(domain)}/relations`, { signal: requests.signal })).data.data
    if (!disposed && requestVersion === version) relations.value = data
  } catch (e) { if (requestVersion === version) fail(e) } finally { if (requestVersion === version) loading.value = false }
}
watch(() => route.params.domain, domain => { if (domain) openRelations(String(domain)) }, { immediate: true })
async function poll() {
  if (disposed) return
  if (active.value && document.visibilityState !== 'hidden') {
    const id = activeId.value, version = requestVersion
    await loadJobs()
    if (!disposed && requestVersion === version) await openJob(id)
  }
  if (!disposed) timer = setTimeout(poll, 3000)
}
onMounted(async () => {
  await loadJobs()
  if (disposed) return
  if (route.query.job && !route.params.domain) await openJob(String(route.query.job))
  if (!disposed) timer = setTimeout(poll, 3000)
})
onBeforeUnmount(() => { disposed = true; requestVersion++; requests.abort(); clearTimeout(timer) })
</script>

<template>
  <main class="page-shell space-y-5">
    <div class="mb-4"><h1 class="page-title">{{ tr("域名发现") }}</h1><p class="mt-2 text-sm opacity-65">{{ tr("从 crt.sh 证书透明度记录发现子域名和证书关联，选中域名后执行 DNS 验证。") }}</p><IntelLookup v-if="seed" type="domain" :value="seed" /></div>
    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
    <div v-if="notice" class="alert alert-info" role="status">{{ notice }}</div>
    <form class="card border border-base-300 bg-base-100 p-4 space-y-3" @submit.prevent="create">
      <label for="discovery-seed" class="font-medium">{{ tr("种子域名") }}</label>
      <div class="flex flex-col gap-3 sm:flex-row"><input id="discovery-seed" v-model="seed" class="input input-bordered grow" maxlength="254" required placeholder="example.com" /><button class="btn btn-neutral" :disabled="busy || !seed.trim()">{{ busy ? tr("提交中…") : tr("发起发现") }}</button></div>
      <div class="flex flex-wrap gap-5 text-sm"><label class="flex items-center gap-2"><input v-model="includeRelated" type="checkbox" class="checkbox checkbox-sm" />{{ tr("补充完整证书与关联域名") }}</label><label class="flex items-center gap-2"><input v-model="refresh" type="checkbox" class="checkbox checkbox-sm" />{{ tr("重新查询（不复用近期结果）") }}</label></div>
      <p class="text-xs opacity-60">{{ tr("输入子域时只查询该子域及其后代。证书共同出现不代表同一组织或服务存活；通配证书不展开为实际主机。刷新受冷却和配额限制。") }}</p>
    </form>
    <DomainDiscoveryProxyCard />
    <section class="card border border-base-300 bg-base-100 p-4 space-y-3">
      <div class="flex flex-wrap items-center gap-3"><h2 class="font-semibold">{{ tr("发现历史") }}</h2><button class="btn btn-ghost btn-sm" @click="loadJobs">{{ tr("刷新") }}</button></div>
      <label for="discovery-job" class="text-sm">{{ tr("我的发现作业（最近 100 条）") }}</label>
      <select id="discovery-job" :value="activeId" class="select select-bordered w-full" @change="openJob($event.target.value)"><option value="">{{ tr("选择作业查看结果") }}</option><option v-for="job in jobs" :key="job.id" :value="job.id">{{ job.seed }} · {{ discoveryStatuses[job.status] }} · {{ formatDateTime(job.created_at) }}</option></select>
      <div v-if="activeJob" class="flex flex-wrap items-center gap-3 text-sm"><span class="badge badge-outline">{{ discoveryStatuses[activeJob.status] }}</span><span>{{ tr("尝试") }} {{ activeJob.attempts }} {{ tr("次") }}</span><span v-if="activeJob.summary?.domains != null">{{ activeJob.summary.domains }} {{ tr("个名称 ·") }} {{ activeJob.summary.certificates }} {{ tr("张证书") }}</span><button v-if="active" class="btn btn-sm" :disabled="busy" @click="cancel">{{ tr("取消发现") }}</button></div>
      <p v-if="activeJob?.last_error" class="text-sm text-warning">{{ discoveryReason(activeJob.last_error) }}</p>
      <p v-if="active" class="text-sm opacity-60" role="status">{{ tr("正在后台查询，可离开页面后在历史中查看。") }}</p>
    </section>
    <section v-if="relations" class="card border border-base-300 p-4 space-y-2"><h2 class="font-semibold">{{ relations.domain }} {{ tr("的已有证书关联") }}</h2><p class="text-sm opacity-65">{{ tr("展示已发现子域及该域或其子域的证书关联；查看不会自动请求 crt.sh 或创建扫描。") }}</p><div class="flex flex-wrap gap-2"><button v-for="id in relations.job_ids" :key="id" class="btn btn-sm" @click="openJob(id)">{{ tr("查看来源作业") }}</button></div><p v-if="relations.truncated" class="text-warning text-sm">{{ tr("仅展示最近 20 个匹配作业，请查看发现历史缩小范围。") }}</p></section>
    <div v-if="loading" class="skeleton h-32" role="status" :aria-label="tr(&quot;读取发现结果&quot;)"></div>
    <section v-else-if="evidence || relations" class="card border border-base-300 p-4 space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="font-semibold">{{ tr("发现名称（") }}{{ candidates.length }}）</h2><span v-if="evidence" class="text-xs opacity-60">{{ tr("查询时间") }} {{ formatDateTime(evidence.fetched_at) }}</span></div>
      <div v-if="evidence?.truncated || evidence?.incomplete_certificates || evidence?.source_errors?.length" class="alert alert-warning text-sm">{{ tr("结果不完整：") }}<span v-if="evidence.truncated">{{ tr("已达到数量上限。") }}</span><span v-if="evidence.incomplete_certificates">{{ evidence.incomplete_certificates }} {{ tr("张证书未取得完整 SAN。") }}</span><span v-for="code in evidence.source_errors" :key="code">{{ discoveryReason(code) }}</span>{{ tr("已有证据仍可查看和验证。") }}</div>
      <div class="flex flex-wrap gap-3"><input v-model="search" class="input input-bordered input-sm grow" :aria-label="tr(&quot;筛选域名&quot;)" :placeholder="tr(&quot;筛选域名&quot;)" /><select v-model="relationFilter" class="select select-bordered select-sm" :aria-label="tr(&quot;筛选关联类型&quot;)"><option value="">{{ tr("全部类型") }}</option><option v-for="(label, key) in relationLabels" :key="key" :value="key">{{ label }}</option></select></div>
      <div v-if="evidence" class="flex flex-wrap gap-3 items-center"><button class="btn btn-sm" @click="selected = selectPage(selected, visible, excluded, submitted)">{{ tr("选择当前页可验证域名") }}</button><button class="btn btn-ghost btn-sm" @click="selected = []">{{ tr("清空") }}</button><button class="btn btn-neutral btn-sm" :disabled="busy || !selected.length || selected.length > 500" @click="verify">{{ tr("DNS 验证（") }}{{ selected.length }}/500）</button></div>
      <div class="overflow-x-auto"><table class="table table-sm"><thead><tr><th v-if="evidence">{{ tr("选择") }}</th><th>{{ tr("域名 / 模式") }}</th><th>{{ tr("关系") }}</th><th>{{ tr("证据") }}</th><th>{{ tr("DNS 任务") }}</th></tr></thead><tbody><tr v-for="item in visible" :key="item.name"><td v-if="evidence"><input v-model="selected" type="checkbox" class="checkbox checkbox-sm" :value="item.name" :disabled="!canVerify(item, excluded, submitted) || (!selected.includes(item.name) && selected.length >= 500)" :aria-label="tr(&quot;选择 {0}&quot;, [item.name])" /></td><td class="font-mono"><button v-if="item.relation !== 'wildcard'" class="link link-hover text-left" @click="router.push(`/domains/${encodeURIComponent(item.name)}`)">{{ item.name }}</button><span v-else>{{ item.name }}</span><span v-if="evidence && excluded.includes(item.name) && item.relation !== 'wildcard'" class="badge badge-warning badge-xs ml-2">{{ tr("已排除") }}</span></td><td>{{ relationLabels[item.relation] }}</td><td>{{ item.certificate_ids?.length ?? '—' }} {{ tr("张证书") }}</td><td><template v-for="task in submitted.filter(t => t.domain === item.name)" :key="task.task_id"><router-link class="link" :to="`/task/${task.task_id}`">{{ tr("查看 DNS 任务") }}</router-link></template><span v-if="!submitted.some(t => t.domain === item.name)">{{ tr("未提交") }}</span></td></tr><tr v-if="!visible.length"><td colspan="5" class="text-center opacity-60">{{ tr("没有匹配结果") }}</td></tr></tbody></table></div>
      <div class="flex items-center justify-between text-sm"><span>{{ filtered.length }} {{ tr("个匹配项 · 第") }} {{ page + 1 }}/{{ pages }} {{ tr("页") }}</span><div class="join"><button class="btn btn-sm join-item" :disabled="page === 0" @click="page--">{{ tr("上一页") }}</button><button class="btn btn-sm join-item" :disabled="page + 1 >= pages" @click="page++">{{ tr("下一页") }}</button></div></div>
    </section>
    <section v-if="certificates.length" class="card border border-base-300 p-4 space-y-3"><h2 class="font-semibold">{{ tr("证书证据（") }}{{ certificates.length }}）</h2><details v-for="cert in certificates" :key="cert.crtsh_id" class="rounded-lg border border-base-300 p-3"><summary class="cursor-pointer text-sm">crt.sh #{{ cert.crtsh_id }} · {{ cert.full_san ? tr("完整 SAN") : tr("仅查询匹配名称") }} {{ tr("· 有效期") }} {{ cert.not_before || tr("未知") }} {{ tr("至") }} {{ cert.not_after || tr("未知") }}</summary><div class="mt-3 space-y-2 text-xs"><a class="link" :href="`https://crt.sh/?id=${cert.crtsh_id}`" target="_blank" rel="noopener noreferrer">{{ tr("查看 crt.sh 原始记录") }}</a><p v-if="cert.fingerprint_sha256" class="break-all font-mono">SHA-256 {{ cert.fingerprint_sha256 }}</p><ul class="max-h-64 overflow-y-auto font-mono"><li v-for="name in cert.names" :key="name">{{ name }}</li></ul></div></details></section>
  </main>
</template>
