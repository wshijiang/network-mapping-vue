<script setup>
import { formatDateTime as formatSystemDateTime } from '@/utils/systemTime'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AssetTags from './components/AssetTags.vue'
import OsFingerprint from './components/OsFingerprint.vue'
import { osCsvHeaders, osCsvValues } from './utils/osDetection'
import ThemeToggle from '@/components/ThemeToggle.vue'
import http from './utils/http'
import { formatLocation } from './utils/location'

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
let searchSequence = 0
const generationMessage = computed(() => ({
  created: '已创建目标更新任务，扫描完成后可重新搜索。',
  existing: '该目标已有任务正在排队或执行。',
  cooldown: '该目标近期已由搜索生成任务，冷却期间不会重复创建。',
  fresh: '该目标数据仍在有效期内，无需创建更新任务。',
  queue_full: '搜索更新队列已满，请稍后重新搜索。',
  rate_limited: '本小时搜索生成任务已达上限。',
  out_of_scope: '该目标不在已启用的搜索扫描范围内。',
  unavailable: '自动更新暂不可用，请稍后重新搜索确认任务状态。',
}[autoGeneration.value?.status] || ''))

const examples = [
  'ip IN 192.168.1.0/24 AND port IN (80, 443)',
  'service = "https" AND banner ~ "nginx"',
  'os.family = "windows" AND os.confidence = "medium"',
  'service = "smtps" AND tls.self_signed = true',
  'tls.not_after < "2026-10-01T00:00:00Z"',
  'domain = "www.example.com" AND port = 443',
  'tag = "生产环境" AND NOT tag.kind = malicious',
  'tag.category = "运行环境" AND tag = "生产环境"',
  'has_endpoint(port = 80) AND has_endpoint(port = 443)',
]

const supportedSyntax = '支持域名、AND、OR、NOT、括号、IN、标签及资产服务组合条件'
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
  } catch (error) {
    if (sequence !== searchSequence) return
    searchResult.value = null
    errorMessage.value = error.response?.data?.message || '搜索失败，请稍后重试。'
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
    errorMessage.value = '请输入搜索内容'
    errorSpan.value = null
    return
  }
  activeSearch.value = { type: 'advanced', query }
  pushHistory(query, 'advanced')
  showHistory.value = false
  autoGeneration.value = null
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

function formatNetworkOwner(item) {
  const asn = item.asn ? (/^AS/i.test(item.asn) ? item.asn : `AS${item.asn}`) : ''
  return [asn, item.as_org || item.isp].filter(Boolean).join(' · ') || '-'
}

function certificateStatus(item) {
  if (!item.tls_subject && !item.tls_not_after && !item.tls_version) return null
  if (item.tls_not_after && Number(item.tls_not_after) <= Date.now()) {
    return { text: '证书已过期', class: 'badge-error' }
  }
  if (item.tls_self_signed === true) return { text: '自签名', class: 'badge-warning' }
  return { text: item.tls_version || 'TLS', class: 'badge-success' }
}

function csvCell(value) {
  const text = String(value ?? '')
  const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safeText.replaceAll('"', '""')}"`
}

function exportCurrentPage() {
  if (!searchResult.value?.items.length) return

  exporting.value = true
  try {
    const header = [
      'IP', '端口', '协议', '服务', 'Banner', ...osCsvHeaders, '网页标题', 'TLS 模式', 'TLS 版本',
      'TLS 密码套件', '证书主体', '证书签发者', '证书名称', '证书序列号',
      '证书生效时间', '证书失效时间', '证书 SHA-256 指纹', '是否自签名',
      'ASN / AS 组织', '位置', '扫描时间', '标签',
    ]
    const rows = searchResult.value.items.map((item) => [
      item.ip_address,
      item.port,
      item.protocol,
      item.service,
      item.banner,
      ...osCsvValues(item.os, formatTime),
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

onBeforeUnmount(() => document.removeEventListener('mousedown', onDocumentClick))
</script>

<template>
  <nav class="absolute top-0 right-0 flex flex-wrap items-center justify-end gap-3 px-4 py-5 sm:gap-5 sm:px-8">
    <ThemeToggle />
    <a class="link" target="_blank" href="/">仪表盘</a>
    <a class="link" target="_blank" rel="noopener noreferrer" href="https://github.com/wshijiang/network-mapping/blob/dev/docs/SEARCH_SYNTAX.md">搜索文档</a>
  </nav>

  <main class="bg-base-200 min-h-screen px-4 py-24">
    <div class="mx-auto w-full max-w-5xl">
      <h1 class="mb-5 text-center text-3xl font-semibold md:text-4xl">Network-Mapping Search</h1>

      <div ref="searchBoxRef" class="relative mx-auto max-w-2xl">
        <div class="join w-full">
          <label class="input join-item w-full">
            <svg class="h-[1em] opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.5" /><path d="m20 20-3.5-3.5" fill="none" stroke="currentColor" stroke-width="2.5" /></svg>
            <input ref="searchInputRef" v-model="searchInput" type="text" class="grow font-mono" :placeholder="supportedSyntax" autofocus @focus="showHistory = true" @keyup.enter="doSearch" />
          </label>
          <button class="btn btn-neutral join-item px-6" :disabled="loading" @click="doSearch">{{ loading ? '搜索中' : '搜索' }}</button>
        </div>
        <div class="mt-2 flex items-center justify-between gap-3 text-xs opacity-60">
          <span>{{ supportedSyntax }}</span>
          <button type="button" class="link link-hover shrink-0" @click="openSyntaxDialog">搜索语法说明</button>
        </div>

        <!-- <div class="mt-3 flex flex-wrap gap-2">
          <button v-for="example in examples" :key="example" type="button" class="btn btn-ghost btn-xs h-auto min-h-7 max-w-full justify-start font-mono font-normal" :title="example" @click="useExample(example)">
            <span class="truncate">{{ example }}</span>
          </button>
        </div> -->

        <div v-if="visibleTags.length" class="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span class="opacity-60">标签：</span>
          <button v-for="tag in visibleTags" :key="tag.id" type="button" class="badge badge-outline cursor-pointer" :title="`添加标签条件：${tag.name}`" @click="appendTag(tag)">{{ tag.name }}</button>
        </div>

        <div v-if="showHistory" class="absolute z-20 mt-2 w-full rounded-xl border border-base-300 bg-base-100 shadow-lg">
          <div class="flex items-center justify-between border-b border-base-300 px-4 py-3"><span class="text-sm font-medium">搜索历史</span><button class="btn btn-ghost btn-xs" @click="clearHistory">清空</button></div>
          <div v-if="searchHistory.length === 0" class="px-4 py-6 text-center text-sm opacity-60">暂无搜索历史</div>
          <ul v-else class="max-h-64 overflow-y-auto p-2"><li v-for="item in searchHistory" :key="item.keyword"><button class="btn btn-ghost w-full justify-start rounded-lg" @click="pickHistory(item)">{{ item.keyword }}</button></li></ul>
        </div>
      </div>

      <div v-if="errorMessage" role="alert" class="alert alert-error mx-auto mt-6 max-w-2xl">
        <span>{{ errorMessage }}<span v-if="errorSpan">（位置 {{ errorSpan.start + 1 }}）</span></span>
      </div>

      <div v-if="generationMessage" role="status" class="alert alert-info alert-soft mx-auto mt-6 max-w-2xl text-sm">
        <span>
          {{ generationMessage }}
          <span v-if="autoGeneration.status === 'cooldown' && autoGeneration.next_eligible_at">冷却至 {{ formatTime(autoGeneration.next_eligible_at) }}。</span>
        </span>
        <a v-if="autoGeneration.task_id" :href="`/task/${autoGeneration.task_id}`" class="link whitespace-nowrap" target="_blank" rel="noopener">查看任务</a>
      </div>

      <section v-if="searchResult" class="mt-10 rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-lg font-semibold">组合搜索结果</h2>
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-sm opacity-70">“{{ searchResult.query }}” · 共 {{ searchResult.total }} 条</span>
            <label class="flex items-center gap-1 text-sm">
              <span>排序</span>
              <select v-model="sortField" class="select select-bordered select-sm" aria-label="排序字段" :disabled="loading" @change="changeSortField">
                <option value="last_seen">扫描时间</option>
                <option value="first_seen">首次发现</option>
                <option value="ip">IP</option>
                <option value="port">端口</option>
              </select>
              <select v-model="sortOrder" class="select select-bordered select-sm" aria-label="排序方向" :disabled="loading" @change="runSearch(0)">
                <option value="desc">降序</option>
                <option value="asc">升序</option>
              </select>
            </label>
            <button class="btn btn-outline btn-sm" :disabled="loading || exporting || searchResult.items.length === 0" @click="exportCurrentPage">
              {{ exporting ? '导出中…' : '导出当前页 CSV' }}
            </button>
          </div>
        </div>
        <div v-if="searchResult.items.length === 0" class="py-12 text-center opacity-60">没有匹配的资产。</div>
        <div v-else class="overflow-x-auto">
          <table class="table table-zebra table-sm">
            <thead><tr><th>IP</th><th>端口</th><th>协议</th><th>服务</th><th>Banner</th><th>系统线索</th><th>网页 / TLS</th><th>ASN / AS 组织</th><th>位置</th><th>扫描时间</th></tr></thead>
            <tbody>
              <tr v-for="(item, index) in searchResult.items" :key="`${item.ip_address}-${item.port}-${item.scan_time}-${index}`">
                <td><div class="flex min-w-max items-center gap-2"><a class="link whitespace-nowrap font-mono" :href="`/asset.html?ip=${encodeURIComponent(item.ip_address)}`" target="_blank" rel="noopener noreferrer" title="查看资产详情">{{ item.ip_address }}</a><AssetTags :tags="item.tags || []" :limit="3" size="xs" /></div></td>
                <td>{{ item.port ?? '-' }}</td>
                <td>{{ item.protocol ?? '-' }}</td>
                <td>{{ item.service ?? '-' }}</td>
                <td class="max-w-xs truncate" :title="item.banner">{{ item.banner ?? '-' }}</td>
                <td><OsFingerprint :value="item.os" /></td>
                <td class="min-w-64 max-w-sm">
                  <div v-if="item.title || item.tls_subject || item.tls_version" class="space-y-1">
                    <div v-if="item.title" class="truncate font-medium" :title="item.title">{{ item.title }}</div>
                    <div v-if="certificateStatus(item)" class="flex flex-wrap items-center gap-1">
                      <span class="badge badge-sm" :class="certificateStatus(item).class">{{ certificateStatus(item).text }}</span>
                      <span v-if="item.tls_mode" class="badge badge-ghost badge-sm">{{ item.tls_mode }}</span>
                    </div>
                    <div v-if="item.tls_subject" class="truncate font-mono text-xs opacity-70" :title="item.tls_subject">{{ item.tls_subject }}</div>
                  </div>
                  <span v-else>-</span>
                </td>
                <td>{{ formatNetworkOwner(item) }}</td>
                <td>{{ formatLocation(item) }}</td>
                <td class="whitespace-nowrap">{{ formatTime(item.scan_time) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="searchResult.total > PAGE_SIZE" class="mt-5 flex flex-wrap items-center justify-end gap-2">
          <span v-if="searchResult.total > MAX_RESULT_WINDOW" class="mr-auto text-xs opacity-60">最多可浏览前 {{ MAX_RESULT_WINDOW }} 条结果。</span>
          <button class="btn btn-sm" :disabled="loading || offset === 0" @click="previousPage">上一页</button>
          <button class="btn btn-sm" :disabled="loading || offset + PAGE_SIZE >= Math.min(searchResult.total, MAX_RESULT_WINDOW)" @click="nextPage">下一页</button>
        </div>
      </section>
    </div>
  </main>

  <dialog ref="syntaxDialogRef" class="modal">
    <div class="modal-box w-[calc(100vw-2rem)] max-w-lg">
      <h3 class="text-lg font-bold">搜索语法说明</h3>
      <p class="py-3 text-sm opacity-70">支持域名、布尔组合、括号、精确匹配、包含匹配、集合和资产标签；旧版单条件语法仍然兼容。</p>

      <div class="space-y-3 text-sm">
        <div class="rounded-lg bg-base-200 p-3 space-y-2">
          <p class="font-medium">逻辑与运算符</p>
          <p class="opacity-70"><code>NOT</code> 优先于 <code>AND</code>，<code>AND</code> 优先于 <code>OR</code>；可用括号改变顺序。</p>
          <div class="flex flex-wrap gap-2"><code class="rounded bg-base-300 px-2 py-1">=</code><code class="rounded bg-base-300 px-2 py-1">!=</code><code class="rounded bg-base-300 px-2 py-1">~</code><code class="rounded bg-base-300 px-2 py-1">!~</code><code class="rounded bg-base-300 px-2 py-1">IN (...)</code><code class="rounded bg-base-300 px-2 py-1">EXISTS(...)</code></div>
        </div>
        <div class="rounded-lg bg-base-200 p-3 space-y-2">
          <p class="font-medium">资产字段</p>
          <code class="block rounded bg-base-300 px-2 py-1">ip IN 221.233.151.0/24 AND country = CN</code>
          <code class="block rounded bg-base-300 px-2 py-1">asn = AS4134 AND tag = "生产环境"</code>
        </div>
        <div class="rounded-lg bg-base-200 p-3 space-y-2">
          <p class="font-medium">域名关联资产</p>
          <code class="block rounded bg-base-300 px-2 py-1">domain = "www.example.com" AND port = 443</code>
          <p class="text-xs opacity-70">域名会关联当前 A/AAAA 记录及 CNAME 链后返回对应的 IP 端点。</p>
        </div>
        <div class="rounded-lg bg-base-200 p-3 space-y-2">
          <p class="font-medium">端口与服务字段</p>
          <code class="block rounded bg-base-300 px-2 py-1">port IN (80, 443) AND service ~ "http"</code>
          <code class="block rounded bg-base-300 px-2 py-1">service = "https" AND banner ~ "nginx"</code>
        </div>
        <div class="rounded-lg bg-base-200 p-3 space-y-2">
          <p class="font-medium">TLS 与证书字段</p>
          <code class="block rounded bg-base-300 px-2 py-1">service = "smtps" AND tls.self_signed = true</code>
          <code class="block rounded bg-base-300 px-2 py-1">tls.not_after &lt; "2026-10-01T00:00:00Z"</code>
          <code class="block rounded bg-base-300 px-2 py-1">tls.san = "mail.example.com"</code>
        </div>
        <div class="rounded-lg bg-base-200 p-3 space-y-2">
          <p class="font-medium">同一资产的多个端点</p>
          <code class="block rounded bg-base-300 px-2 py-1">has_endpoint(port = 80) AND has_endpoint(port = 443)</code>
        </div>
        <div class="rounded-lg border border-base-300 p-3">
          <p class="font-medium">支持字段</p>
          <p class="mt-1 break-words font-mono text-xs opacity-70">ip, domain, asn, isp, org, country, city, tag, tag.id, tag.kind, tag.category, port, protocol, service, banner, os.family, os.distribution, os.version, os.confidence, os.status, os.score, title, http.body, tls.mode, tls.version, tls.cipher, tls.subject, tls.issuer, tls.san, tls.serial, tls.not_before, tls.not_after, tls.fingerprint, tls.self_signed, source, scanner, first_seen, last_seen</p>
        </div>
      </div>

      <div class="modal-action">
        <a class="btn btn-ghost" target="_blank" rel="noopener noreferrer" href="https://github.com/wshijiang/network-mapping/blob/dev/docs/SEARCH_SYNTAX.md">查看完整文档</a>
        <button type="button" class="btn btn-neutral" @click="closeSyntaxDialog">知道了</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button type="button" @click="closeSyntaxDialog">关闭</button>
    </form>
  </dialog>
</template>
