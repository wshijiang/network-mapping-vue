<script setup>
import { tr } from '../i18n/index.js'

import { computed, onBeforeUnmount, onMounted, reactive, ref, useId } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import EmptyState from '@/components/EmptyState.vue'
import http from '@/utils/http'
import {
  FIELD_LABELS,
  KIND_NAMES,
  WINDOW_MODES,
  federationMessage,
  isRunActive,
  quotaSummary,
  runStatusMeta,
  validateSourceForm,
  windowLabel,
} from '@/utils/federation.js'

const formFieldId = useId()
const alerts = ref([])

function pushAlert(type, title, description = '', timeout = 7000) {
  alerts.value.unshift({ id: crypto.randomUUID(), type, title, description, timeout })
}

function closeAlert(id) {
  alerts.value = alerts.value.filter((alert) => alert.id !== id)
}

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(typeof value === 'number' ? value : Date.parse(value))
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString()
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback
}

const activeTab = ref('sources')

// ---- schema ----
const schema = ref(null)
async function loadSchema() {
  try {
    const response = await http.get('/api/federation/schema')
    schema.value = response.data?.data || null
  } catch (error) {
    pushAlert('error', tr('平台能力目录加载失败'), errorMessage(error, tr('请检查服务端连接。')))
  }
}

// ---- 数据源 ----
const sources = ref([])
const sourcesLoading = ref(false)

async function loadSources() {
  sourcesLoading.value = true
  try {
    const response = await http.get('/api/federation/sources')
    sources.value = response.data?.data?.items || []
  } catch (error) {
    pushAlert('error', tr('数据源加载失败'), errorMessage(error, tr('请检查服务端连接。')))
  } finally {
    sourcesLoading.value = false
  }
}

function sourceQuota(source) {
  return quotaSummary(source.kind, source.capabilities)
}

const sourceModalOpen = ref(false)
const sourceSaving = ref(false)
const editingSourceId = ref(null)
const editingRevision = ref(0)
const sourceForm = reactive(emptySourceForm())

function emptySourceForm() {
  return {
    kind: 'hunter',
    name: '',
    enabled: false,
    api_key: '',
    email: '',
    credential_configured: false,
    clear_credential: false,
    proxy_mode: 'system',
    proxy_url: '',
    fields: ['ip', 'domain', 'port', 'service', 'tech'],
    pagination_mode: 'follow_local',
    page_size: 100,
    max_pages: 5,
    window_mode: 'follow',
    window_days: 30,
    timeout_seconds: 15,
    rate_limit_qps: 0.5,
  }
}

const credentialFields = computed(() => {
  const platform = schema.value?.platforms?.find((p) => p.kind === sourceForm.kind)
  return platform?.credential_fields || ['api_key']
})

const sourceFormErrors = computed(() => validateSourceForm(sourceForm, schema.value?.limits).errors)

function openCreateSource() {
  editingSourceId.value = null
  editingRevision.value = 0
  Object.assign(sourceForm, emptySourceForm())
  sourceModalOpen.value = true
}

function openEditSource(source) {
  editingSourceId.value = source.id
  editingRevision.value = source.revision
  Object.assign(sourceForm, {
    kind: source.kind,
    name: source.name,
    enabled: source.enabled,
    api_key: '',
    email: '',
    credential_configured: source.credential_configured,
    clear_credential: false,
    proxy_mode: source.proxy_mode,
    proxy_url: '',
    fields: [...source.fields],
    pagination_mode: source.pagination_mode,
    page_size: source.page_size,
    max_pages: source.max_pages,
    window_mode: source.window_mode,
    window_days: source.window_days,
    timeout_seconds: source.timeout_seconds,
    rate_limit_qps: source.rate_limit_qps,
  })
  sourceModalOpen.value = true
}

function toggleField(field) {
  if (field === 'ip' || field === 'port') return
  const index = sourceForm.fields.indexOf(field)
  if (index >= 0) sourceForm.fields.splice(index, 1)
  else sourceForm.fields.push(field)
}

function buildSourcePayload() {
  const payload = {
    kind: sourceForm.kind,
    name: sourceForm.name,
    enabled: sourceForm.enabled,
    proxy_mode: sourceForm.proxy_mode,
    fields: sourceForm.fields,
    pagination_mode: sourceForm.pagination_mode,
    page_size: Number(sourceForm.page_size),
    max_pages: Number(sourceForm.max_pages),
    window_mode: sourceForm.window_mode,
    window_days: Number(sourceForm.window_days),
    timeout_seconds: Number(sourceForm.timeout_seconds),
    rate_limit_qps: Number(sourceForm.rate_limit_qps),
  }
  if (sourceForm.proxy_mode === 'custom') payload.proxy_url = sourceForm.proxy_url
  if (sourceForm.clear_credential) {
    payload.clear_credential = true
  } else if (sourceForm.api_key) {
    const credential = {}
    if (sourceForm.kind === 'quake') credential.token = sourceForm.api_key
    else if (sourceForm.kind === 'hunter') credential.api_key = sourceForm.api_key
    else credential.key = sourceForm.api_key
    if (sourceForm.kind === 'fofa' && sourceForm.email) credential.email = sourceForm.email
    payload.credential = credential
  }
  return payload
}

async function saveSource() {
  if (sourceFormErrors.value.length) return
  sourceSaving.value = true
  try {
    const payload = buildSourcePayload()
    let response
    if (editingSourceId.value) {
      payload.expected_revision = editingRevision.value
      response = await http.put(`/api/federation/sources/${editingSourceId.value}`, payload)
    } else {
      response = await http.post('/api/federation/sources', payload)
    }
    if (response.data?.success) {
      pushAlert('success', editingSourceId.value ? tr('数据源已更新') : tr('数据源已创建'))
      sourceModalOpen.value = false
      await loadSources()
    } else {
      pushAlert('error', tr('保存失败'), response.data?.message || '')
    }
  } catch (error) {
    pushAlert('error', tr('保存失败'), errorMessage(error, tr('请稍后重试。')))
  } finally {
    sourceSaving.value = false
  }
}

async function removeSource(source) {
  if (!window.confirm(tr('删除后该数据源不再参与联测，确定删除？'))) return
  try {
    const response = await http.delete(`/api/federation/sources/${source.id}`, {
      params: { expected_revision: source.revision },
    })
    if (response.data?.success) {
      pushAlert('success', tr('数据源已删除'))
      await loadSources()
    } else {
      pushAlert('error', tr('删除失败'), response.data?.message || '')
    }
  } catch (error) {
    pushAlert('error', tr('删除失败'), errorMessage(error, tr('请稍后重试。')))
  }
}

const testingSourceId = ref(null)
async function testSource(source) {
  testingSourceId.value = source.id
  try {
    const response = await http.post(`/api/federation/sources/${source.id}/test`)
    const data = response.data?.data || {}
    if (response.data?.success) {
      pushAlert('success', tr('连接成功'), `${tr('延迟')} ${data.latency_ms}ms`)
      await loadSources()
    } else {
      pushAlert('error', tr('连接失败'), `${data.error_code || ''} (${data.latency_ms}ms)`)
    }
  } catch (error) {
    pushAlert('error', tr('连接失败'), errorMessage(error, tr('请稍后重试。')))
  } finally {
    testingSourceId.value = null
  }
}

// ---- 策略 ----
const policy = ref(null)
const policyRevision = ref(0)
const policyLoading = ref(false)
const policySaving = ref(false)

async function loadPolicy() {
  policyLoading.value = true
  try {
    const response = await http.get('/api/config/runtime/federation')
    const data = response.data?.data
    if (data?.document) {
      policy.value = data.document
      policyRevision.value = data.revision
    }
  } catch (error) {
    pushAlert('error', tr('策略加载失败'), errorMessage(error, tr('请检查服务端连接。')))
  } finally {
    policyLoading.value = false
  }
}

function toggleTriggerField(field) {
  if (!policy.value) return
  const index = policy.value.trigger_fields.indexOf(field)
  if (index >= 0) policy.value.trigger_fields.splice(index, 1)
  else policy.value.trigger_fields.push(field)
}

async function savePolicy() {
  if (!policy.value) return
  policySaving.value = true
  try {
    const response = await http.post('/api/config/runtime/federation', {
      expected_revision: policyRevision.value,
      document: policy.value,
      change_reason: '联测策略更新',
    })
    if (response.data?.success) {
      policyRevision.value = response.data.data.revision
      pushAlert('success', tr('策略已保存'), tr('服务器数秒内热生效。'))
    } else {
      pushAlert('error', tr('保存失败'), response.data?.message || '')
    }
  } catch (error) {
    if (error?.response?.status === 409) {
      pushAlert('warning', tr('策略已被其他管理员更新'), tr('已重新加载最新策略，请核对后再保存。'))
      await loadPolicy()
    } else {
      pushAlert('error', tr('保存失败'), errorMessage(error, tr('请稍后重试。')))
    }
  } finally {
    policySaving.value = false
  }
}

// ---- 联测记录 ----
const runs = ref([])
const runsTotal = ref(0)
const runsLoading = ref(false)
const runStatusFilter = ref('')
let runRefreshTimer = null

async function loadRuns() {
  runsLoading.value = true
  try {
    const response = await http.get('/api/federation/runs', {
      params: { status: runStatusFilter.value || undefined, limit: 20, offset: 0 },
    })
    runs.value = response.data?.data?.items || []
    runsTotal.value = response.data?.data?.total || 0
  } catch (error) {
    pushAlert('error', tr('联测记录加载失败'), errorMessage(error, tr('请检查服务端连接。')))
  } finally {
    runsLoading.value = false
  }
}

const hasActiveRun = computed(() => runs.value.some((run) => isRunActive(run.status)))

function scheduleRunRefresh() {
  clearTimeout(runRefreshTimer)
  if (hasActiveRun.value) {
    runRefreshTimer = setTimeout(async () => {
      await loadRuns()
      scheduleRunRefresh()
    }, 2000)
  }
}

async function cancelRun(run) {
  try {
    const response = await http.post(`/api/federation/runs/${run.id}/cancel`)
    if (response.data?.success) {
      pushAlert('success', tr('run 已取消'), tr('已入库数据保留。'))
      await loadRuns()
    } else {
      pushAlert('error', tr('取消失败'), response.data?.message || '')
    }
  } catch (error) {
    pushAlert('error', tr('取消失败'), errorMessage(error, tr('请稍后重试。')))
  }
}

async function removeRun(run) {
  if (!window.confirm(tr('删除后 run 记录与结果缓存将被移除，已入库资产保留。确定删除？'))) return
  try {
    const response = await http.delete(`/api/federation/runs/${run.id}`)
    if (response.data?.success) {
      pushAlert('success', tr('run 已删除'))
      await loadRuns()
    } else {
      pushAlert('error', tr('删除失败'), response.data?.message || '')
    }
  } catch (error) {
    pushAlert('error', tr('删除失败'), errorMessage(error, tr('请稍后重试。')))
  }
}

const detailRun = ref(null)
async function openRunDetail(run) {
  try {
    const response = await http.get(`/api/federation/runs/${run.id}`)
    detailRun.value = response.data?.data || run
  } catch {
    detailRun.value = run
  }
}

// ---- 手动联测 ----
const manualModalOpen = ref(false)
const manualSubmitting = ref(false)
const manualForm = reactive({ query: '', mode: 'async', window_days: 30, persist: 'auto' })

function openManualRun() {
  manualForm.query = ''
  manualForm.mode = policy.value?.mode || 'async'
  manualForm.window_days = policy.value?.query_window_days || 30
  manualForm.persist = 'auto'
  manualModalOpen.value = true
}

async function submitManualRun() {
  if (!manualForm.query.trim()) return
  manualSubmitting.value = true
  try {
    const response = await http.post('/api/federation/runs', {
      query: manualForm.query.trim(),
      mode: manualForm.mode,
      window_days: Number(manualForm.window_days),
      persist: manualForm.persist,
    })
    if (response.data?.success) {
      pushAlert('success', tr('联测 run 已创建'), tr('后台执行中，可在联测记录查看进度。'))
      manualModalOpen.value = false
      activeTab.value = 'runs'
      await loadRuns()
      scheduleRunRefresh()
    } else {
      pushAlert('error', tr('创建失败'), response.data?.message || '')
    }
  } catch (error) {
    pushAlert('error', tr('创建失败'), errorMessage(error, tr('请稍后重试。')))
  } finally {
    manualSubmitting.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadSchema(), loadSources(), loadPolicy(), loadRuns()])
  scheduleRunRefresh()
})

onBeforeUnmount(() => clearTimeout(runRefreshTimer))
</script>

<template>
  <div class="pointer-events-none fixed right-4 top-20 z-50 flex w-[calc(100vw-2rem)] flex-col items-end gap-2 sm:w-auto">
    <AppAlert
      v-for="alert in alerts"
      :key="alert.id"
      class="pointer-events-auto"
      :type="alert.type"
      :title="alert.title"
      :description="alert.description"
      :timeout="alert.timeout"
      @close="closeAlert(alert.id)"
    />
  </div>

  <div class="space-y-4 p-4 sm:p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">{{ tr("联测") }}</h1>
        <p class="mt-1 text-sm opacity-65">{{ tr("搜索时按策略联合 Hunter / Quake / FOFA / Shodan 查询，聚合去重后返回并按策略入库。") }}</p>
      </div>
      <button type="button" class="btn btn-primary btn-sm" @click="openManualRun">{{ tr("手动联测") }}</button>
    </div>

    <div role="tablist" class="tabs tabs-boxed w-fit">
      <button role="tab" class="tab" :class="{ 'tab-active': activeTab === 'sources' }" @click="activeTab = 'sources'">{{ tr("数据源") }}</button>
      <button role="tab" class="tab" :class="{ 'tab-active': activeTab === 'policy' }" @click="activeTab = 'policy'">{{ tr("策略") }}</button>
      <button role="tab" class="tab" :class="{ 'tab-active': activeTab === 'runs' }" @click="activeTab = 'runs'; loadRuns(); scheduleRunRefresh()">{{ tr("联测记录") }}</button>
    </div>

    <!-- 数据源 -->
    <section v-if="activeTab === 'sources'" class="space-y-3">
      <div class="flex justify-end">
        <button type="button" class="btn btn-outline btn-sm" @click="openCreateSource">{{ tr("添加数据源") }}</button>
      </div>
      <EmptyState v-if="!sourcesLoading && !sources.length" :title="tr('尚未配置数据源')" :description="tr('添加至少一个平台数据源并配置凭据后，联测才会生效。')" />
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div v-for="source in sources" :key="source.id" class="card border border-base-300 bg-base-100 shadow-sm">
          <div class="card-body gap-2 p-4">
            <div class="flex items-center justify-between gap-2">
              <h2 class="card-title text-base">{{ source.name }}</h2>
              <span class="badge" :class="source.enabled ? 'badge-success' : 'badge-ghost'">{{ source.enabled ? tr("已启用") : tr("已禁用") }}</span>
            </div>
            <p class="text-xs opacity-65">{{ KIND_NAMES[source.kind] || source.kind }}</p>
            <div class="flex flex-wrap gap-1 text-xs">
              <span class="badge badge-outline">{{ tr("凭据") }}：{{ source.credential_configured ? tr("已配置") : tr("未配置") }}</span>
              <span class="badge badge-outline">{{ tr("代理") }}：{{ source.proxy_mode === 'system' ? tr("跟随全局") : source.proxy_mode === 'direct' ? tr("直连") : tr("自定义") }}</span>
              <span class="badge badge-outline">{{ tr("时间窗") }}：{{ windowLabel(source, policy?.query_window_days) }}</span>
            </div>
            <div class="text-xs" :class="{ 'text-warning font-medium': sourceQuota(source).low }">
              {{ tr("额度") }}：{{ sourceQuota(source).primary }}
              <span v-if="sourceQuota(source).details.length" class="opacity-65">（{{ sourceQuota(source).details.join(' · ') }}）</span>
            </div>
            <div class="card-actions justify-end pt-1">
              <button type="button" class="btn btn-ghost btn-xs" :disabled="testingSourceId === source.id" @click="testSource(source)">
                {{ testingSourceId === source.id ? tr("测试中…") : tr("测试连接") }}
              </button>
              <button type="button" class="btn btn-ghost btn-xs" @click="openEditSource(source)">{{ tr("编辑") }}</button>
              <button type="button" class="btn btn-ghost btn-xs text-error" @click="removeSource(source)">{{ tr("删除") }}</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 策略 -->
    <section v-if="activeTab === 'policy'" class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body gap-4" v-if="policy">
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label class="form-control">
            <span class="label-text mb-1">{{ tr("联测总开关") }}</span>
            <input type="checkbox" class="toggle toggle-primary" v-model="policy.enabled" />
          </label>
          <label class="form-control">
            <span class="label-text mb-1">{{ tr("执行模式") }}</span>
            <select class="select select-bordered select-sm" v-model="policy.mode">
              <option value="async">{{ tr("异步（立即返回本地结果）") }}</option>
              <option value="blocking">{{ tr("阻塞（等待联测合并返回）") }}</option>
            </select>
          </label>
          <label class="form-control">
            <span class="label-text mb-1">{{ tr("触发策略") }}</span>
            <select class="select select-bordered select-sm" v-model="policy.trigger">
              <option value="empty_or_stale">{{ tr("本地无结果或过期时") }}</option>
              <option value="always">{{ tr("每次搜索") }}</option>
            </select>
          </label>
          <label class="form-control">
            <span class="label-text mb-1">{{ tr("本地过期阈值（天）") }}</span>
            <input type="number" class="input input-bordered input-sm" min="1" max="3650" v-model.number="policy.stale_days" />
            <span class="label-text-alt mt-1 opacity-60">{{ tr("本地数据超过该天数视为过期，触发联测刷新。") }}</span>
          </label>
          <label class="form-control">
            <span class="label-text mb-1">{{ tr("远端查询时间窗（天，全局默认）") }}</span>
            <input type="number" class="input input-bordered input-sm" min="1" max="60" v-model.number="policy.query_window_days" />
            <span class="label-text-alt mt-1 opacity-60">{{ tr("跟随策略的数据源用此值；Hunter 超 30 天扣权益积分，Shodan 搜索仅覆盖近 30 天。") }}</span>
          </label>
          <label class="form-control">
            <span class="label-text mb-1">{{ tr("阻塞等待上限（秒）") }}</span>
            <input type="number" class="input input-bordered input-sm" min="5" max="120" v-model.number="policy.blocking_timeout_seconds" />
          </label>
          <label class="form-control">
            <span class="label-text mb-1">{{ tr("同查询冷却（秒）") }}</span>
            <input type="number" class="input input-bordered input-sm" min="0" max="86400" v-model.number="policy.cooldown_seconds" />
          </label>
          <label class="form-control">
            <span class="label-text mb-1">{{ tr("单 run 记录上限") }}</span>
            <input type="number" class="input input-bordered input-sm" min="10" max="5000" v-model.number="policy.max_records_per_run" />
          </label>
          <label class="form-control">
            <span class="label-text mb-1">{{ tr("并发 run 上限") }}</span>
            <input type="number" class="input input-bordered input-sm" min="1" max="16" v-model.number="policy.max_concurrent_runs" />
          </label>
        </div>

        <fieldset class="rounded border border-base-300 p-3">
          <legend class="px-1 text-sm font-medium">{{ tr("触发字段（不选 = 任意字段）") }}</legend>
          <div class="flex flex-wrap gap-3">
            <label v-for="(label, field) in FIELD_LABELS" :key="field" class="flex cursor-pointer items-center gap-1 text-sm">
              <input type="checkbox" class="checkbox checkbox-sm" :checked="policy.trigger_fields.includes(field)" @change="toggleTriggerField(field)" />
              {{ tr(label) }}
            </label>
          </div>
        </fieldset>

        <fieldset class="rounded border border-base-300 p-3">
          <legend class="px-1 text-sm font-medium">{{ tr("入库策略（可选）") }}</legend>
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" class="toggle toggle-sm toggle-primary" v-model="policy.persist.enabled" />
              {{ tr("联测数据入库") }}
            </label>
            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" class="checkbox checkbox-sm" v-model="policy.persist.on_empty" />
              {{ tr("本地无结果时入库") }}
            </label>
            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" class="checkbox checkbox-sm" v-model="policy.persist.on_stale" />
              {{ tr("本地过期时入库") }}
            </label>
            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" class="checkbox checkbox-sm" v-model="policy.persist.on_fresh" />
              {{ tr("本地新鲜时也入库") }}
            </label>
          </div>
        </fieldset>

        <div class="card-actions justify-end">
          <button type="button" class="btn btn-primary btn-sm" :disabled="policySaving" @click="savePolicy">
            {{ policySaving ? tr("保存中…") : tr("保存策略") }}
          </button>
        </div>
      </div>
      <div v-else class="card-body">
        <p class="text-sm opacity-65">{{ policyLoading ? tr("加载中…") : tr("策略加载失败") }}</p>
      </div>
    </section>

    <!-- 联测记录 -->
    <section v-if="activeTab === 'runs'" class="space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <select class="select select-bordered select-sm" v-model="runStatusFilter" @change="loadRuns">
          <option value="">{{ tr("全部状态") }}</option>
          <option value="running">{{ tr("联测中") }}</option>
          <option value="completed">{{ tr("已完成") }}</option>
          <option value="partial">{{ tr("部分完成") }}</option>
          <option value="failed">{{ tr("失败") }}</option>
          <option value="cancelled">{{ tr("已取消") }}</option>
        </select>
        <button type="button" class="btn btn-ghost btn-sm" @click="loadRuns">{{ tr("刷新") }}</button>
        <span class="text-xs opacity-60">{{ tr("共 {0} 条", [runsTotal]) }}</span>
      </div>
      <EmptyState v-if="!runsLoading && !runs.length" :title="tr('暂无联测记录')" :description="tr('搜索触发或手动联测后，记录将显示在这里。')" />
      <div class="overflow-x-auto rounded border border-base-300">
        <table class="table table-sm">
          <thead>
            <tr>
              <th>{{ tr("时间") }}</th>
              <th>{{ tr("查询") }}</th>
              <th>{{ tr("触发") }}</th>
              <th>{{ tr("模式") }}</th>
              <th>{{ tr("状态") }}</th>
              <th>{{ tr("拉取/合并/入库") }}</th>
              <th>{{ tr("操作") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="run in runs" :key="run.id">
              <td class="whitespace-nowrap">{{ formatDate(run.created_at) }}</td>
              <td class="max-w-64 truncate font-mono text-xs" :title="run.query">{{ run.query }}</td>
              <td>{{ run.trigger === 'manual' ? tr('手动') : tr('搜索') }}</td>
              <td>{{ run.mode === 'blocking' ? tr('阻塞') : tr('异步') }}</td>
              <td><span class="badge badge-sm" :class="runStatusMeta(run.status).badgeClass">{{ tr(runStatusMeta(run.status).labelKey) }}</span></td>
              <td class="whitespace-nowrap">{{ run.total_fetched }} / {{ run.total_merged }} / {{ run.total_persisted }}</td>
              <td class="whitespace-nowrap">
                <button type="button" class="btn btn-ghost btn-xs" @click="openRunDetail(run)">{{ tr("详情") }}</button>
                <button v-if="isRunActive(run.status)" type="button" class="btn btn-ghost btn-xs text-warning" @click="cancelRun(run)">{{ tr("取消") }}</button>
                <button v-else type="button" class="btn btn-ghost btn-xs text-error" @click="removeRun(run)">{{ tr("删除") }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>

  <!-- 数据源编辑 -->
  <dialog class="modal" :class="{ 'modal-open': sourceModalOpen }">
    <div class="modal-box max-h-[85vh] w-11/12 max-w-2xl overflow-y-auto">
      <h3 class="text-lg font-semibold">{{ editingSourceId ? tr("编辑数据源") : tr("添加数据源") }}</h3>
      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <label class="form-control">
          <span class="label-text mb-1">{{ tr("平台") }}</span>
          <select class="select select-bordered select-sm" v-model="sourceForm.kind" :disabled="Boolean(editingSourceId)">
            <option v-for="platform in schema?.platforms || []" :key="platform.kind" :value="platform.kind">{{ platform.name }}</option>
          </select>
        </label>
        <label class="form-control">
          <span class="label-text mb-1">{{ tr("名称") }}</span>
          <input :id="`${formFieldId}-name`" type="text" class="input input-bordered input-sm" maxlength="64" v-model="sourceForm.name" />
        </label>
        <label class="form-control">
          <span class="label-text mb-1">{{ tr("启用") }}</span>
          <input type="checkbox" class="toggle toggle-primary" v-model="sourceForm.enabled" />
        </label>
        <label class="form-control" v-for="field in credentialFields" :key="field">
          <span class="label-text mb-1">{{ field === 'email' ? tr('FOFA email（可选兼容）') : tr('API 凭据') }}</span>
          <input type="password" class="input input-bordered input-sm" autocomplete="new-password" v-model="sourceForm[field === 'email' ? 'email' : 'api_key']" :placeholder="sourceForm.credential_configured && field !== 'email' ? tr('留空保持原凭据') : ''" />
        </label>
        <label v-if="editingSourceId && sourceForm.credential_configured" class="flex items-center gap-2 text-sm">
          <input type="checkbox" class="checkbox checkbox-sm" v-model="sourceForm.clear_credential" />
          {{ tr("清除已保存凭据") }}
        </label>
        <label class="form-control">
          <span class="label-text mb-1">{{ tr("代理") }}</span>
          <select class="select select-bordered select-sm" v-model="sourceForm.proxy_mode">
            <option value="system">{{ tr("跟随全局") }}</option>
            <option value="direct">{{ tr("直连") }}</option>
            <option value="custom">{{ tr("自定义") }}</option>
          </select>
        </label>
        <label v-if="sourceForm.proxy_mode === 'custom'" class="form-control">
          <span class="label-text mb-1">{{ tr("代理 URL") }}</span>
          <input type="text" class="input input-bordered input-sm" placeholder="http://… / socks5h://…" v-model="sourceForm.proxy_url" />
        </label>
        <label class="form-control">
          <span class="label-text mb-1">{{ tr("分页") }}</span>
          <select class="select select-bordered select-sm" v-model="sourceForm.pagination_mode">
            <option value="follow_local">{{ tr("跟随本地搜索") }}</option>
            <option value="fixed">{{ tr("固定分页") }}</option>
          </select>
        </label>
        <label class="form-control">
          <span class="label-text mb-1">{{ tr("每页条数") }}</span>
          <input type="number" class="input input-bordered input-sm" min="1" max="1000" v-model.number="sourceForm.page_size" />
        </label>
        <label class="form-control">
          <span class="label-text mb-1">{{ tr("最大页数") }}</span>
          <input type="number" class="input input-bordered input-sm" min="1" max="50" v-model.number="sourceForm.max_pages" />
        </label>
        <label class="form-control">
          <span class="label-text mb-1">{{ tr("时间窗") }}</span>
          <select class="select select-bordered select-sm" v-model="sourceForm.window_mode">
            <option v-for="mode in WINDOW_MODES" :key="mode.value" :value="mode.value">{{ tr(mode.labelKey) }}</option>
          </select>
        </label>
        <label v-if="sourceForm.window_mode === 'custom'" class="form-control">
          <span class="label-text mb-1">{{ tr("时间窗天数（1..60）") }}</span>
          <input type="number" class="input input-bordered input-sm" min="1" max="60" v-model.number="sourceForm.window_days" />
        </label>
        <label class="form-control">
          <span class="label-text mb-1">{{ tr("超时（秒）") }}</span>
          <input type="number" class="input input-bordered input-sm" min="3" max="120" v-model.number="sourceForm.timeout_seconds" />
        </label>
        <label class="form-control">
          <span class="label-text mb-1">{{ tr("限速 QPS") }}</span>
          <input type="number" step="0.1" class="input input-bordered input-sm" min="0.1" max="10" v-model.number="sourceForm.rate_limit_qps" />
        </label>
      </div>
      <fieldset class="mt-3 rounded border border-base-300 p-3">
        <legend class="px-1 text-sm font-medium">{{ tr("联测字段（IP/端口恒选）") }}</legend>
        <div class="flex flex-wrap gap-3">
          <label v-for="(label, field) in FIELD_LABELS" :key="field" class="flex cursor-pointer items-center gap-1 text-sm" :class="{ 'opacity-50': field === 'ip' || field === 'port' }">
            <input type="checkbox" class="checkbox checkbox-sm" :checked="sourceForm.fields.includes(field)" :disabled="field === 'ip' || field === 'port'" @change="toggleField(field)" />
            {{ tr(label) }}
          </label>
        </div>
      </fieldset>
      <ul v-if="sourceFormErrors.length" class="mt-3 list-disc pl-5 text-sm text-error">
        <li v-for="error in sourceFormErrors" :key="error">{{ tr(error) }}</li>
      </ul>
      <div class="modal-action">
        <button type="button" class="btn btn-ghost btn-sm" @click="sourceModalOpen = false">{{ tr("取消") }}</button>
        <button type="button" class="btn btn-primary btn-sm" :disabled="sourceSaving || sourceFormErrors.length > 0" @click="saveSource">
          {{ sourceSaving ? tr("保存中…") : tr("保存") }}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop"><button @click="sourceModalOpen = false">{{ tr("关闭") }}</button></form>
  </dialog>

  <!-- 手动联测 -->
  <dialog class="modal" :class="{ 'modal-open': manualModalOpen }">
    <div class="modal-box w-11/12 max-w-lg">
      <h3 class="text-lg font-semibold">{{ tr("手动联测") }}</h3>
      <div class="mt-4 space-y-3">
        <label class="form-control">
          <span class="label-text mb-1">{{ tr("查询（本地搜索语法）") }}</span>
          <textarea class="textarea textarea-bordered h-24 font-mono text-sm" v-model="manualForm.query" placeholder='ip = "1.1.1.1" AND port = 443'></textarea>
        </label>
        <div class="grid gap-3 sm:grid-cols-3">
          <label class="form-control">
            <span class="label-text mb-1">{{ tr("模式") }}</span>
            <select class="select select-bordered select-sm" v-model="manualForm.mode">
              <option value="async">{{ tr("异步") }}</option>
              <option value="blocking">{{ tr("阻塞") }}</option>
            </select>
          </label>
          <label class="form-control">
            <span class="label-text mb-1">{{ tr("时间窗（天）") }}</span>
            <input type="number" class="input input-bordered input-sm" min="1" max="60" v-model.number="manualForm.window_days" />
          </label>
          <label class="form-control">
            <span class="label-text mb-1">{{ tr("入库") }}</span>
            <select class="select select-bordered select-sm" v-model="manualForm.persist">
              <option value="auto">{{ tr("按策略") }}</option>
              <option value="force">{{ tr("强制入库") }}</option>
              <option value="skip">{{ tr("不入库") }}</option>
            </select>
          </label>
        </div>
      </div>
      <div class="modal-action">
        <button type="button" class="btn btn-ghost btn-sm" @click="manualModalOpen = false">{{ tr("取消") }}</button>
        <button type="button" class="btn btn-primary btn-sm" :disabled="manualSubmitting || !manualForm.query.trim()" @click="submitManualRun">
          {{ manualSubmitting ? tr("提交中…") : tr("执行联测") }}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop"><button @click="manualModalOpen = false">{{ tr("关闭") }}</button></form>
  </dialog>

  <!-- run 详情 -->
  <dialog class="modal" :class="{ 'modal-open': Boolean(detailRun) }">
    <div class="modal-box max-h-[85vh] w-11/12 max-w-3xl overflow-y-auto">
      <h3 class="text-lg font-semibold">{{ tr("联测 run 详情") }}</h3>
      <div v-if="detailRun" class="mt-3 space-y-3">
        <p class="font-mono text-sm">{{ detailRun.query }}</p>
        <div class="flex flex-wrap gap-2 text-xs">
          <span class="badge badge-outline">{{ tr("状态") }}：{{ tr(runStatusMeta(detailRun.status).labelKey) }}</span>
          <span class="badge badge-outline">{{ tr("时间窗") }}：{{ detailRun.window_days }} {{ tr("天") }}</span>
          <span class="badge badge-outline">{{ tr("本地状态") }}：{{ detailRun.local_state }}</span>
          <span class="badge badge-outline">{{ tr("拉取") }} {{ detailRun.total_fetched }} · {{ tr("合并") }} {{ detailRun.total_merged }} · {{ tr("入库") }} {{ detailRun.total_persisted }}</span>
        </div>
        <p v-if="detailRun.error_message" class="text-sm text-error">{{ detailRun.error_message }}</p>
        <div class="overflow-x-auto rounded border border-base-300">
          <table class="table table-xs">
            <thead>
              <tr>
                <th>{{ tr("平台") }}</th>
                <th>{{ tr("状态") }}</th>
                <th>{{ tr("时间窗") }}</th>
                <th>{{ tr("拉取/归一化") }}</th>
                <th>{{ tr("耗时") }}</th>
                <th>{{ tr("平台查询") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(source, index) in detailRun.sources || []" :key="index">
                <td>{{ KIND_NAMES[source.kind] || source.kind }}</td>
                <td>
                  <span class="badge badge-xs" :class="source.status === 'completed' ? 'badge-success' : source.status === 'unsupported' ? 'badge-ghost' : 'badge-warning'">{{ source.status }}</span>
                  <span v-if="source.error_code" class="ml-1 text-error">{{ source.error_code }}</span>
                </td>
                <td>{{ source.window_days ? `${source.window_days}d` : tr('不指定') }} <span class="opacity-60">({{ source.time_filter }})</span></td>
                <td>{{ source.fetched }} / {{ source.normalized }}</td>
                <td>{{ source.duration_ms }}ms</td>
                <td class="max-w-64 truncate font-mono" :title="source.platform_query">{{ source.platform_query || source.reason || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="modal-action">
        <button type="button" class="btn btn-ghost btn-sm" @click="detailRun = null">{{ tr("关闭") }}</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop"><button @click="detailRun = null">{{ tr("关闭") }}</button></form>
  </dialog>
</template>