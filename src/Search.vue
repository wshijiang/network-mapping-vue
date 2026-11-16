<script setup>
import { formatDateTime as formatCsvDateTime } from './utils/systemTime.js'
import { tr } from './i18n/index.js'

import SearchResultsTable from '@/components/SearchResultsTable.vue'
import { formatNetworkOwner } from './utils/searchFormat'
import { formatDateTime as formatSystemDateTime } from './i18n/time.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { webCsvHeaders, webCsvValues } from './utils/webDetection'
import { osCsvHeaders, osCsvValues } from './utils/osDetection'
import ThemeToggle from '@/components/ThemeToggle.vue'
import http from './utils/http'
import { formatLocation } from './utils/location'
import { federationMessage, isRunActive, originLabel } from './utils/federation.js'

const STORAGE_KEY = 'network_mapping_search_history'
const MAX_HISTORY = 12
const PAGE_SIZE = 50
const MAX_RESULT_WINDOW = 10000

const searchInput = ref('')
const searchHistory = ref([])
const showHistory = ref(false)
const searchBoxRef = ref(null)
const searchInputRef = ref(null)
const loading = ref(false)
const exporting = ref(false)
const errorMessage = ref('')
const errorSpan = ref(null)
const searchResult = ref(null)
const activeSearch = ref(null)
const offset = ref(0)
const sortField = ref('last_seen')
const sortOrder = ref('desc')
const syntaxDialogRef = ref(null)
const tagCatalog = ref([])
const autoGeneration = ref(null)
const federation = ref(null)
let federationPollTimer = null
let searchSequence = 0
const federationText = computed(() => {
  const current = federation.value
  if (!current) return ''
  if (current.status === 'completed' || current.status === 'partial') {
    if (!Number.isFinite(current.merged_new)) return tr('联测完成，请刷新查看结果')
    return current.merged_new > 0
      ? tr('联测完成，新增 {0} 个端点', [current.merged_new])
      : tr('联测完成，无新增端点')
  }
  return tr(federationMessage(current))
})

function scheduleFederationPoll() {
  clearTimeout(federationPollTimer)
  const current = federation.value
  if (!current || !isRunActive(current.status) || !current.run_id) return
  const sequence = searchSequence
  federationPollTimer = setTimeout(async () => {
    try {
      const response = await http.get(`/api/federation/runs/${current.run_id}`)
      if (sequence !== searchSequence) return
      const run = response.data?.data
      if (run && !isRunActive(run.status)) {
        // 轮询完成的 run 不含 merged_new；标注未知，由“刷新结果”获取真实数量。
        federation.value = { ...current, status: run.status, merged_new: null }
      } else {
        scheduleFederationPoll()
      }
    } catch (error) {
      if (sequence !== searchSequence) return
      // 会话失效时停止；其余瞬时错误继续轮询。
      if (error?.response?.status === 401 || error?.response?.status === 403) return
      scheduleFederationPoll()
    }
  }, 2000)
}
const examples = [
  'ip IN 192.168.1.0/24 AND port IN (80, 443)',
  'service = "https" AND banner ~ "nginx"',
  'tech = "jquery@3.7.1"',
  'os.family = "windows" AND os.confidence = "medium"',
  'service = "smtps" AND tls.self_signed = true',
  'tls.not_after < "2026-10-01T00:00:00Z"',
  'domain = "www.example.com" AND port = 443',
  'tag = "生产环境" AND NOT tag.kind = malicious',
  'tag.category = "运行环境" AND tag = "生产环境"',
  'has_endpoint(port = 80) AND has_endpoint(port = 443)',
]

const supportedSyntax = tr("支持域名、AND、OR、NOT、括号、IN、标签及资产服务组合条件")
const visibleTags = computed(() => tagCatalog.value.slice(0, 10))

function openSyntaxDialog() {
  syntaxDialogRef.value?.showModal()
}

function closeSyntaxDialog() {
  syntaxDialogRef.value?.close()
}

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    searchHistory.value = Array.isArray(parsed)
      ? parsed.map((item) => typeof item === 'string' ? { keyword: item } : item).filter((item) => item.keyword)
      : []
  } catch {
    searchHistory.value = []
  }
}

function saveHistory() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(searchHistory.value))
}

function pushHistory(keyword, type) {
  searchHistory.value = [{ keyword, type }, ...searchHistory.value.filter((item) => item.keyword !== keyword)].slice(0, MAX_HISTORY)
  saveHistory()
}

function clearHistory() {
  searchHistory.value = []
  saveHistory()
}

function pickHistory(item) {
  searchInput.value = item.keyword
  showHistory.value = false
  doSearch()
}

async function runSearch(nextOffset = 0, generateIfNeeded = false) {
  if (!activeSearch.value) return
  const sequence = ++searchSequence
  loading.value = true
  errorMessage.value = ''
  errorSpan.value = null
  try {
    const { query } = activeSearch.value
    const response = await http.post('/api/search/v2', {
      query,
      limit: PAGE_SIZE,
      offset: nextOffset,
      sort_field: sortField.value,
      sort_order: sortOrder.value,
      generate_if_needed: generateIfNeeded,
    })
    if (sequence !== searchSequence) return
    if (generateIfNeeded) autoGeneration.value = response.data.auto_generation || null
    searchResult.value = response.data
    offset.value = nextOffset
    federation.value = response.data.federation || null
    scheduleFederationPoll()
  } catch (error) {
    if (sequence !== searchSequence) return
    searchResult.value = null
    errorMessage.value = error.response?.data?.message || tr("搜索失败，请稍后重试。")
    errorSpan.value = error.response?.data?.span || null
    if (errorSpan.value) {
      await nextTick()
      searchInputRef.value?.focus()
      searchInputRef.value?.setSelectionRange(errorSpan.value.start, errorSpan.value.end)
    }
  } finally {
    if (sequence === searchSequence) loading.value = false
  }
}

function doSearch() {
  const query = searchInput.value.trim()
  if (!query) {
    ++searchSequence
    loading.value = false
    activeSearch.value = null
    autoGeneration.value = null
    searchResult.value = null
    errorMessage.value = tr("请输入搜索内容")
    errorSpan.value = null
    return
  }
  activeSearch.value = { type: 'advanced', query }
  pushHistory(query, 'advanced')
  showHistory.value = false
  autoGeneration.value = null
  federation.value = null
  clearTimeout(federationPollTimer)
  runSearch(0, true)
}

function useExample(query) {
  searchInput.value = query
  showHistory.value = false
  searchInputRef.value?.focus()
}

function quoteSearchValue(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function appendTag(tag) {
  const clause = `tag = ${quoteSearchValue(tag.name)}`
  const current = searchInput.value.trim()
  searchInput.value = current ? `${current} AND ${clause}` : clause
  showHistory.value = false
  searchInputRef.value?.focus()
}

async function loadTags() {
  try {
    const response = await http.get('/api/tags')
    tagCatalog.value = response.data?.data?.items || []
  } catch {
    tagCatalog.value = []
  }
}

function previousPage() {
  runSearch(Math.max(0, offset.value - PAGE_SIZE))
}

function nextPage() {
  if (searchResult.value && offset.value + PAGE_SIZE < Math.min(searchResult.value.total, MAX_RESULT_WINDOW)) runSearch(offset.value + PAGE_SIZE)
}

function changeSortField() {
  sortOrder.value = ['last_seen', 'first_seen'].includes(sortField.value) ? 'desc' : 'asc'
  runSearch(0)
}

function formatTime(timestamp) {
  if (!timestamp) return '-'
  return formatSystemDateTime(new Date(timestamp))
}

function csvCell(value) {
  const text = String(value ?? '')
  const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safeText.replaceAll('"', '""')}"`
}

function exportCurrentPage() {
  const formatTime = timestamp => timestamp ? formatCsvDateTime(new Date(timestamp)) : '-'
  if (!searchResult.value?.items.length) return

  exporting.value = true
  try {
    const header = [
      'IP', '端口', '协议', '服务', 'Banner', ...osCsvHeaders, ...webCsvHeaders, '网页标题', 'TLS 模式', 'TLS 版本',
      'TLS 密码套件', '证书主体', '证书签发者', '证书名称', '证书序列号',
      '证书生效时间', '证书失效时间', '证书 SHA-256 指纹', '是否自签名',
      'ASN / AS 组织', '位置', '扫描时间', '标签', '数据来源',
    ]
    const rows = searchResult.value.items.map((item) => [
      item.ip_address,
      item.port,
      item.protocol,
      item.service,
      item.banner,
      ...osCsvValues(item.os, formatTime),
      ...webCsvValues(item.web, formatTime),
      item.title,
      item.tls_mode,
      item.tls_version,
      item.tls_cipher_suite,
      item.tls_subject,
      item.tls_issuer,
      (item.tls_names || []).join('、'),
      item.tls_serial_number,
      formatTime(item.tls_not_before),
      formatTime(item.tls_not_after),
      item.tls_fingerprint_sha256,
      item.tls_self_signed == null ? '' : item.tls_self_signed ? '是' : '否',
      formatNetworkOwner(item),
      formatLocation(item),
      formatTime(item.scan_time),
      (item.tags || []).map((tag) => tag.name).join('、'),
      originLabel(item) ? `${originLabel(item)}(${(item.federation_sources || []).join('/')})` : '本地',
    ])
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `network-mapping-search-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  } catch (error) {
    console.error('export search results failed', error)
    errorMessage.value = '导出搜索结果失败，请稍后重试。'
  } finally {
    exporting.value = false
  }
}

function onDocumentClick(event) {
  if (searchBoxRef.value && !searchBoxRef.value.contains(event.target)) showHistory.value = false
}

onMounted(() => {
  loadHistory()
  loadTags()
  document.addEventListener('mousedown', onDocumentClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentClick)
  clearTimeout(federationPollTimer)
})
</script>

<template>
  <nav class="absolute top-0 right-0 flex flex-wrap items-center justify-end gap-3 px-4 py-5 sm:gap-5 sm:px-8">
    <LanguageSelect />
          <ThemeToggle />
    <a class="link" target="_blank" href="/">{{ tr("仪表盘") }}</a>
    <a class="link" target="_blank" rel="noopener noreferrer" href="https://docs.abdc.world/s/SEARCH_SYNTAX/">{{ tr("搜索文档") }}</a>
  </nav>

  <main class="bg-base-200 min-h-screen px-4 py-24">
    <div class="mx-auto w-full max-w-[1600px]">
      <h1 class="mb-5 text-center text-3xl font-semibold md:text-4xl">Network-Mapping Search</h1>

      <div ref="searchBoxRef" class="relative mx-auto max-w-2xl">
        <div class="join w-full">
          <label class="input join-item w-full">
            <svg class="h-[1em] opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.5" /><path d="m20 20-3.5-3.5" fill="none" stroke="currentColor" stroke-width="2.5" /></svg>
            <input ref="searchInputRef" v-model="searchInput" type="text" class="grow font-mono" :placeholder="supportedSyntax" autofocus @focus="showHistory = true" @keyup.enter="doSearch" />
          </label>
          <button class="btn btn-neutral join-item px-6" :disabled="loading" @click="doSearch">{{ loading ? tr("搜索中") : tr("搜索") }}</button>
        </div>
        <div class="mt-2 flex items-center justify-between gap-3 text-xs opacity-60">
          <span>{{ supportedSyntax }}</span>
          <button type="button" class="link link-hover shrink-0" @click="openSyntaxDialog">{{ tr("搜索语法说明") }}</button>
        </div>

        <!-- <div class="mt-3 flex flex-wrap gap-2">
          <button v-for="example in examples" :key="example" type="button" class="btn btn-ghost btn-xs h-auto min-h-7 max-w-full justify-start font-mono font-normal" :title="example" @click="useExample(example)">
            <span class="truncate">{{ example }}</span>
          </button>
        </div> -->

        <div v-if="visibleTags.length" class="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span class="opacity-60">{{ tr("标签：") }}</span>
          <button v-for="tag in visibleTags" :key="tag.id" type="button" class="badge badge-outline cursor-pointer" :title="tr(&quot;添加标签条件：{0}&quot;, [tag.name])" @click="appendTag(tag)">{{ tag.name }}</button>
        </div>

        <div v-if="showHistory" class="absolute z-20 mt-2 w-full rounded-xl border border-base-300 bg-base-100 shadow-lg">
          <div class="flex items-center justify-between border-b border-base-300 px-4 py-3"><span class="text-sm font-medium">{{ tr("搜索历史") }}</span><button class="btn btn-ghost btn-xs" @click="clearHistory">{{ tr("清空") }}</button></div>
          <div v-if="searchHistory.length === 0" class="px-4 py-6 text-center text-sm opacity-60">{{ tr("暂无搜索历史") }}</div>
          <ul v-else class="max-h-64 overflow-y-auto p-2"><li v-for="item in searchHistory" :key="item.keyword"><button class="btn btn-ghost w-full justify-start rounded-lg" @click="pickHistory(item)">{{ item.keyword }}</button></li></ul>
        </div>
      </div>

      <div v-if="errorMessage" role="alert" class="alert alert-error mx-auto mt-6 max-w-2xl">
        <span>{{ errorMessage }}<span v-if="errorSpan">{{ tr("（位置") }} {{ errorSpan.start + 1 }}）</span></span>
      </div>

      <div v-if="federationText" role="status" class="alert alert-info alert-soft mx-auto mt-3 max-w-2xl text-sm">
        <span>{{ federationText }}</span>
        <button v-if="['completed', 'partial'].includes(federation.status)" type="button" class="btn btn-outline btn-xs" @click="runSearch(offset)">{{ tr("刷新结果") }}</button>
        <router-link v-if="federation.run_id" to="/data/federation" class="link whitespace-nowrap">{{ tr("联测记录") }}</router-link>
      </div>

      <section v-if="searchResult" class="mt-10 rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-lg font-semibold">{{ tr("组合搜索结果") }}</h2>
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-sm opacity-70">“{{ searchResult.query }}{{ tr("” · 共") }} {{ searchResult.total }} {{ tr("条") }}</span>
            <label class="flex items-center gap-1 text-sm">
              <span>{{ tr("排序") }}</span>
              <select v-model="sortField" class="select select-bordered select-sm" :aria-label="tr(&quot;排序字段&quot;)" :disabled="loading" @change="changeSortField">
                <option value="last_seen">{{ tr("扫描时间") }}</option>
                <option value="first_seen">{{ tr("首次发现") }}</option>
                <option value="ip">IP</option>
                <option value="port">{{ tr("端口") }}</option>
              </select>
              <select v-model="sortOrder" class="select select-bordered select-sm" :aria-label="tr(&quot;排序方向&quot;)" :disabled="loading" @change="runSearch(0)">
                <option value="desc">{{ tr("降序") }}</option>
                <option value="asc">{{ tr("升序") }}</option>
              </select>
            </label>
            <button class="btn btn-outline btn-sm" :disabled="loading || exporting || searchResult.items.length === 0" @click="exportCurrentPage">
              {{ exporting ? tr("导出中…") : tr("导出当前页 CSV") }}
            </button>
          </div>
        </div>
        <div v-if="searchResult.items.length === 0" class="py-12 text-center opacity-60">{{ tr("没有匹配的资产。") }}</div>
        <SearchResultsTable v-else :items="searchResult.items" />
        <div v-if="searchResult.total > PAGE_SIZE" class="mt-5 flex flex-wrap items-center justify-end gap-2">
          <span v-if="searchResult.total > MAX_RESULT_WINDOW" class="mr-auto text-xs opacity-60">{{ tr("最多可浏览前") }} {{ MAX_RESULT_WINDOW }} {{ tr("条结果。") }}</span>
          <button class="btn btn-sm" :disabled="loading || offset === 0" @click="previousPage">{{ tr("上一页") }}</button>
          <button class="btn btn-sm" :disabled="loading || offset + PAGE_SIZE >= Math.min(searchResult.total, MAX_RESULT_WINDOW)" @click="nextPage">{{ tr("下一页") }}</button>
        </div>
      </section>
    </div>
  </main>

  <dialog ref="syntaxDialogRef" class="modal">
    <div class="modal-box w-[calc(100vw-2rem)] max-w-lg">
      <h3 class="text-lg font-bold">{{ tr("搜索语法说明") }}</h3>
      <p class="py-3 text-sm opacity-70">{{ tr("支持域名、布尔组合、括号、精确匹配、包含匹配、集合和资产标签；旧版单条件语法仍然兼容。") }}</p>

      <div class="space-y-3 text-sm">
        <div class="rounded-lg bg-base-200 p-3 space-y-2">
          <p class="font-medium">{{ tr("逻辑与运算符") }}</p>
          <p class="opacity-70"><code>NOT</code> {{ tr("优先于") }} <code>AND</code>，<code>AND</code> {{ tr("优先于") }} <code>OR</code>{{ tr("；可用括号改变顺序。") }}</p>
          <div class="flex flex-wrap gap-2"><code class="rounded bg-base-300 px-2 py-1">=</code><code class="rounded bg-base-300 px-2 py-1">!=</code><code class="rounded bg-base-300 px-2 py-1">~</code><code class="rounded bg-base-300 px-2 py-1">!~</code><code class="rounded bg-base-300 px-2 py-1">IN (...)</code><code class="rounded bg-base-300 px-2 py-1">EXISTS(...)</code></div>
        </div>
        <div class="rounded-lg bg-base-200 p-3 space-y-2">
          <p class="font-medium">{{ tr("资产字段") }}</p>
          <code class="block rounded bg-base-300 px-2 py-1">ip IN 221.233.151.0/24 AND country = CN</code>
          <code class="block rounded bg-base-300 px-2 py-1">asn = AS4134 AND tag = "生产环境"</code>
        </div>
        <div class="rounded-lg bg-base-200 p-3 space-y-2">
          <p class="font-medium">{{ tr("域名关联资产") }}</p>
          <code class="block rounded bg-base-300 px-2 py-1">domain = "www.example.com" AND port = 443</code>
          <p class="text-xs opacity-70">{{ tr("域名会关联当前 A/AAAA 记录及 CNAME 链后返回对应的 IP 端点。") }}</p>
        </div>
        <div class="rounded-lg bg-base-200 p-3 space-y-2">
          <p class="font-medium">{{ tr("端口与服务字段") }}</p>
          <code class="block rounded bg-base-300 px-2 py-1">port IN (80, 443) AND service ~ "http"</code>
          <code class="block rounded bg-base-300 px-2 py-1">service = "https" AND banner ~ "nginx"</code>
        </div>
        <div class="rounded-lg bg-base-200 p-3 space-y-2">
          <p class="font-medium">{{ tr("TLS 与证书字段") }}</p>
          <code class="block rounded bg-base-300 px-2 py-1">service = "smtps" AND tls.self_signed = true</code>
          <code class="block rounded bg-base-300 px-2 py-1">tls.not_after &lt; "2026-10-01T00:00:00Z"</code>
          <code class="block rounded bg-base-300 px-2 py-1">tls.san = "mail.example.com"</code>
        </div>
        <div class="rounded-lg bg-base-200 p-3 space-y-2">
          <p class="font-medium">{{ tr("同一资产的多个端点") }}</p>
          <code class="block rounded bg-base-300 px-2 py-1">has_endpoint(port = 80) AND has_endpoint(port = 443)</code>
        </div>
        <div class="rounded-lg border border-base-300 p-3">
          <p class="font-medium">{{ tr("支持字段") }}</p>
          <p class="mt-1 break-words font-mono text-xs opacity-70">ip, domain, asn, isp, org, country, city, tag, tag.id, tag.kind, tag.category, port, protocol, service, banner, os.family, os.distribution, os.version, os.confidence, os.status, os.score, tech, web.status, title, http.body, tls.mode, tls.version, tls.cipher, tls.subject, tls.issuer, tls.san, tls.serial, tls.not_before, tls.not_after, tls.fingerprint, tls.self_signed, source, scanner, first_seen, last_seen</p>
        </div>
      </div>

      <div class="modal-action">
        <a class="btn btn-ghost" target="_blank" rel="noopener noreferrer" href="https://docs.abdc.world/s/SEARCH_SYNTAX/">{{ tr("查看完整文档") }}</a>
        <button type="button" class="btn btn-neutral" @click="closeSyntaxDialog">{{ tr("知道了") }}</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button type="button" @click="closeSyntaxDialog">{{ tr("关闭") }}</button>
    </form>
  </dialog>
</template>
