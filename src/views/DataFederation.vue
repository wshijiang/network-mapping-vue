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
    proxy_endpoint: '',
    proxy_configured: false,
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
    proxy_endpoint: source.proxy_endpoint || '',
    proxy_configured: Boolean(source.proxy_configured),
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
  if (sourceForm.proxy_mode === 'custom' && sourceForm.proxy_url.trim()) payload.proxy_url = sourceForm.proxy_url
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

const togglingSourceId = ref(null)
async function toggleSourceEnabled(source) {
  togglingSourceId.value = source.id
  try {
    // PUT 按整份配置更新；凭据与自定义代理地址留空即保留原值。
    const payload = {
      kind: source.kind,
      name: source.name,
      enabled: !source.enabled,
      proxy_mode: source.proxy_mode,
      fields: source.fields,
      pagination_mode: source.pagination_mode,
      page_size: source.page_size,
      max_pages: source.max_pages,
      window_mode: source.window_mode,
      window_days: source.window_days,
      timeout_seconds: source.timeout_seconds,
      rate_limit_qps: source.rate_limit_qps,
      expected_revision: source.revision,
    }
    const response = await http.put(`/api/federation/sources/${source.id}`, payload)
    if (response.data?.success) {
      pushAlert('success', source.enabled ? tr('数据源已禁用') : tr('数据源已启用'))
      await loadSources()
    } else {
      pushAlert('error', tr('操作失败'), response.data?.message || '')
    }
  } catch (error) {
    pushAlert('error', tr('操作失败'), errorMessage(error, tr('请稍后重试。')))
  } finally {
    togglingSourceId.value = null
  }
}

// ---- 策略 ----
const policy = ref(null)
const policySnapshot = ref(null)
const policyRevision = ref(0)
const policyLoading = ref(false)
const policySaving = ref(false)

async function loadPolicy() {
  policyLoading.value = true
  try {
    const response = await http.get('/api/config/runtime/federation')
    const data = response.data?.data
    if (data?.document) {
      policy.value = structuredClone(data.document)
      policySnapshot.value = structuredClone(data.document)
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
      expectedRevision: policyRevision.value,
      document: policy.value,
      changeReason: '联测策略更新',
    })
    if (response.data?.success) {
      policyRevision.value = response.data.data.revision
      policySnapshot.value = structuredClone(policy.value)
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

// 联测开关独立于表单：开启立即生效；关闭需要二次确认。
const policyToggleSaving = ref(false)
const disablePolicyModalOpen = ref(false)

async function persistPolicyEnabled(enabled) {
  if (!policy.value || !policySnapshot.value) return false
  policyToggleSaving.value = true
  try {
    const response = await http.post('/api/config/runtime/federation', {
      expectedRevision: policyRevision.value,
      document: { ...policySnapshot.value, enabled },
      changeReason: enabled ? '联测已开启' : '联测已关闭',
    })
    if (response.data?.success) {
      policy.value.enabled = enabled
      policySnapshot.value.enabled = enabled
      policyRevision.value = response.data.data.revision
      pushAlert('success', enabled ? tr('联测已开启') : tr('联测已关闭'))
      return true
    }
    pushAlert('error', tr('保存失败'), response.data?.message || '')
  } catch (error) {
    if (error?.response?.status === 409) {
      pushAlert('warning', tr('策略已被其他管理员更新'), tr('已重新加载最新策略，请核对后再保存。'))
      await loadPolicy()
    } else {
      pushAlert('error', tr('保存失败'), errorMessage(error, tr('请稍后重试。')))
    }
  } finally {
    policyToggleSaving.value = false
  }
  return false
}

function onPolicyToggle(event) {
  if (!policy.value) return
  const next = event.target.checked
  // 先回显当前服务端状态，成功后再切换。
  event.target.checked = policy.value.enabled
  if (next === policy.value.enabled) return
  if (next) persistPolicyEnabled(true)
  else disablePolicyModalOpen.value = true
}

async function confirmDisablePolicy() {
  if (await persistPolicyEnabled(false)) disablePolicyModalOpen.value = false
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
      <button type="button" class="btn btn-neutral btn-sm" @click="openManualRun">{{ tr("查询") }}</button>
    </div>

    <!-- 联测 -->
    <section class="card border border-base-300 bg-base-100 p-5 shadow-sm">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="font-semibold">{{ tr("联测") }}</h2>
          <p class="mt-1 text-xs text-base-content/60">{{ tr("开启后搜索联合已启用的数据源查询，关闭后仅使用本地数据；下方策略控制触发时机、等待上限与入库条件。") }}</p>
        </div>
        <div v-if="policy" class="flex items-center gap-2">
          <span v-if="policyToggleSaving" class="loading loading-spinner loading-xs"></span>
          <input
            :id="`${formFieldId}-policy-enabled`"
            type="checkbox"
            class="toggle toggle-neutral"
            :aria-label="tr('联测总开关')"
            :checked="policy.enabled"
            :disabled="policyToggleSaving || policySaving"
            @change="onPolicyToggle"
          />
        </div>
      </div>
      <div v-if="policy">
          <div class="divider my-3"></div>
          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-policy-mode`">{{ tr("执行模式") }}</label></legend>
            <select :id="`${formFieldId}-policy-mode`" class="select select-bordered select-sm w-full" v-model="policy.mode">
              <option value="async">{{ tr("异步（立即返回本地结果）") }}</option>
              <option value="blocking">{{ tr("阻塞（等待联测合并返回）") }}</option>
            </select>
          </fieldset>
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-policy-trigger`">{{ tr("触发策略") }}</label></legend>
            <select :id="`${formFieldId}-policy-trigger`" class="select select-bordered select-sm w-full" v-model="policy.trigger">
              <option value="empty_or_stale">{{ tr("本地无结果或过期时") }}</option>
              <option value="always">{{ tr("每次搜索") }}</option>
            </select>
          </fieldset>
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-policy-stale-days`">{{ tr("本地过期阈值（天）") }}</label></legend>
            <input :id="`${formFieldId}-policy-stale-days`" type="number" class="input input-bordered input-sm w-full" min="1" max="3650" v-model.number="policy.stale_days" />
            <span class="fieldset-label">{{ tr("本地数据超过该天数视为过期，触发联测刷新。") }}</span>
          </fieldset>
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-policy-window-days`">{{ tr("远端查询时间窗（天，全局默认）") }}</label></legend>
            <input :id="`${formFieldId}-policy-window-days`" type="number" class="input input-bordered input-sm w-full" min="1" max="60" v-model.number="policy.query_window_days" />
            <span class="fieldset-label">{{ tr("跟随策略的数据源用此值；Hunter 超 30 天扣权益积分，Shodan 搜索仅覆盖近 30 天。") }}</span>
          </fieldset>
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-policy-blocking-timeout`">{{ tr("阻塞等待上限（秒）") }}</label></legend>
            <input :id="`${formFieldId}-policy-blocking-timeout`" type="number" class="input input-bordered input-sm w-full" min="5" max="120" v-model.number="policy.blocking_timeout_seconds" />
          </fieldset>
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-policy-cooldown`">{{ tr("同查询冷却（秒）") }}</label></legend>
            <input :id="`${formFieldId}-policy-cooldown`" type="number" class="input input-bordered input-sm w-full" min="0" max="86400" v-model.number="policy.cooldown_seconds" />
          </fieldset>
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-policy-max-records`">{{ tr("单 run 记录上限") }}</label></legend>
            <input :id="`${formFieldId}-policy-max-records`" type="number" class="input input-bordered input-sm w-full" min="10" max="5000" v-model.number="policy.max_records_per_run" />
          </fieldset>
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-policy-max-concurrent`">{{ tr("并发 run 上限") }}</label></legend>
            <input :id="`${formFieldId}-policy-max-concurrent`" type="number" class="input input-bordered input-sm w-full" min="1" max="16" v-model.number="policy.max_concurrent_runs" />
          </fieldset>
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
            <label class="flex cursor-pointer items-center gap-3 text-sm">
              {{ tr("联测数据入库") }}
              <input type="checkbox" class="toggle toggle-sm toggle-neutral" v-model="policy.persist.enabled" />
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

        <div class="mt-4 flex justify-end">
          <button type="button" class="btn btn-neutral btn-sm" :disabled="policySaving" @click="savePolicy">
            {{ policySaving ? tr("保存中…") : tr("保存策略") }}
          </button>
        </div>
      </div>
      <p v-else class="mt-4 text-sm opacity-65">{{ policyLoading ? tr("加载中…") : tr("策略加载失败") }}</p>
    </section>

    <!-- 数据源 -->
    <section class="card border border-base-300 bg-base-100 p-5 shadow-sm">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="font-semibold">{{ tr("数据源") }}</h2>
          <p class="mt-1 text-xs text-base-content/60">{{ tr("已配置的平台数据源，启用并配置凭据后参与联测。") }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs text-base-content/60">{{ tr("共 {0} 个数据源", [sources.length]) }}</span>
          <button type="button" class="btn btn-neutral btn-sm" @click="openCreateSource">{{ tr("添加数据源") }}</button>
        </div>
      </div>

      <div v-if="sourcesLoading && !sources.length" class="mt-4"><div class="skeleton h-32 w-full"></div></div>
      <EmptyState v-else-if="!sources.length" class="mt-4" :title="tr('尚未配置数据源')" :message="tr('添加至少一个平台数据源并配置凭据后，联测才会生效。')" />
      <div v-else class="mt-4 overflow-x-auto">
        <table class="table table-zebra">
          <thead>
            <tr>
              <th>{{ tr("名称") }}</th>
              <th>{{ tr("平台") }}</th>
              <th>{{ tr("状态") }}</th>
              <th>{{ tr("凭据") }}</th>
              <th>{{ tr("代理") }}</th>
              <th>{{ tr("时间窗") }}</th>
              <th>{{ tr("额度") }}</th>
              <th class="text-right">{{ tr("操作") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="source in sources" :key="source.id">
              <td class="max-w-56">
                <span class="block truncate font-medium" :title="source.name">{{ source.name }}</span>
              </td>
              <td class="whitespace-nowrap">
                <span class="badge badge-outline">{{ KIND_NAMES[source.kind] || source.kind }}</span>
              </td>
              <td>
                <span class="badge badge-sm" :class="source.enabled ? 'badge-success' : 'badge-ghost'">{{ source.enabled ? tr("已启用") : tr("已禁用") }}</span>
              </td>
              <td>
                <span class="badge badge-sm" :class="source.credential_configured ? 'badge-success' : 'badge-warning'">{{ source.credential_configured ? tr("已配置") : tr("未配置") }}</span>
              </td>
              <td class="whitespace-nowrap text-sm">{{ source.proxy_mode === 'system' ? tr("跟随全局") : source.proxy_mode === 'direct' ? tr("直连") : tr("自定义") }}</td>
              <td class="whitespace-nowrap text-sm">{{ windowLabel(source, policy?.query_window_days) }}</td>
              <td class="text-sm">
                <span :class="{ 'font-medium text-warning': sourceQuota(source).low }">{{ sourceQuota(source).primary }}</span>
                <span v-if="sourceQuota(source).details.length" class="mt-0.5 block text-xs text-base-content/60">{{ sourceQuota(source).details.join(' · ') }}</span>
              </td>
              <td class="whitespace-nowrap text-right">
                <button type="button" class="btn btn-ghost btn-xs" :disabled="togglingSourceId === source.id" @click="toggleSourceEnabled(source)">
                  <span v-if="togglingSourceId === source.id" class="loading loading-spinner loading-xs"></span>
                  {{ source.enabled ? tr("停用") : tr("启用") }}
                </button>
                <button type="button" class="btn btn-ghost btn-xs" :disabled="testingSourceId === source.id" @click="testSource(source)">
                  <span v-if="testingSourceId === source.id" class="loading loading-spinner loading-xs"></span>
                  {{ testingSourceId === source.id ? tr("测试中…") : tr("测试连接") }}
                </button>
                <button type="button" class="btn btn-ghost btn-xs" @click="openEditSource(source)">{{ tr("编辑") }}</button>
                <button type="button" class="btn btn-ghost btn-xs text-error" @click="removeSource(source)">{{ tr("删除") }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 联测记录 -->
    <section class="card border border-base-300 bg-base-100 p-5 shadow-sm">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="font-semibold">{{ tr("联测记录") }}</h2>
          <p class="mt-1 text-xs text-base-content/60">{{ tr("搜索触发或手动联测的执行记录，点击详情查看各平台结果。") }}</p>
        </div>
        <div class="flex items-center gap-2 whitespace-nowrap">
          <span class="text-xs text-base-content/60">{{ tr("共 {0} 条", [runsTotal]) }}</span>
          <select class="select select-bordered select-sm" v-model="runStatusFilter" @change="loadRuns">
            <option value="">{{ tr("全部状态") }}</option>
            <option value="running">{{ tr("联测中") }}</option>
            <option value="completed">{{ tr("已完成") }}</option>
            <option value="partial">{{ tr("部分完成") }}</option>
            <option value="failed">{{ tr("失败") }}</option>
            <option value="cancelled">{{ tr("已取消") }}</option>
          </select>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="runsLoading" @click="loadRuns">
            <span v-if="runsLoading" class="loading loading-spinner loading-xs"></span>{{ tr("刷新") }}
          </button>
        </div>
      </div>

      <div v-if="runsLoading && !runs.length" class="mt-4"><div class="skeleton h-32 w-full"></div></div>
      <EmptyState v-else-if="!runs.length" class="mt-4" :title="tr('暂无联测记录')" :message="tr('搜索触发或手动联测后，记录将显示在这里。')" />
      <div v-else class="mt-4 overflow-x-auto">
        <table class="table table-zebra">
          <thead>
            <tr>
              <th>{{ tr("状态") }}</th>
              <th>{{ tr("触发") }}</th>
              <th>{{ tr("模式") }}</th>
              <th>{{ tr("查询") }}</th>
              <th>{{ tr("拉取/合并/入库") }}</th>
              <th>{{ tr("创建时间") }}</th>
              <th class="text-right">{{ tr("操作") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="run in runs" :key="run.id" :class="{ 'bg-info/5': isRunActive(run.status) }">
              <td>
                <span class="badge badge-sm gap-1" :class="runStatusMeta(run.status).badgeClass">
                  <span v-if="isRunActive(run.status)" class="loading loading-dots loading-xs"></span>
                  {{ tr(runStatusMeta(run.status).labelKey) }}
                </span>
              </td>
              <td><span class="badge badge-sm badge-outline">{{ run.trigger === 'manual' ? tr('手动') : tr('搜索') }}</span></td>
              <td><span class="badge badge-sm badge-ghost">{{ run.mode === 'blocking' ? tr('阻塞') : tr('异步') }}</span></td>
              <td class="max-w-72">
                <span class="block truncate font-mono text-xs" :title="run.query">{{ run.query }}</span>
                <span v-if="run.error_message" class="block truncate text-xs text-error" :title="run.error_message">{{ run.error_message }}</span>
              </td>
              <td class="whitespace-nowrap text-sm tabular-nums">{{ run.total_fetched }} / {{ run.total_merged }} / {{ run.total_persisted }}</td>
              <td class="whitespace-nowrap text-sm">{{ formatDate(run.created_at) }}</td>
              <td class="whitespace-nowrap text-right">
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

  <!-- 关闭联测确认 -->
  <dialog class="modal" :class="{ 'modal-open': disablePolicyModalOpen }">
    <div class="modal-box w-11/12 max-w-md">
      <h3 class="text-lg font-semibold">{{ tr("关闭联测") }}</h3>
      <p class="mt-3 text-sm opacity-75">{{ tr("关闭后搜索将只使用本地数据，不再联合各平台查询；已配置的数据源与策略会保留。确定关闭联测？") }}</p>
      <div class="modal-action">
        <button type="button" class="btn btn-ghost btn-sm" @click="disablePolicyModalOpen = false">{{ tr("取消") }}</button>
        <button type="button" class="btn btn-error btn-sm" :disabled="policyToggleSaving" @click="confirmDisablePolicy">
          <span v-if="policyToggleSaving" class="loading loading-spinner loading-xs"></span>
          {{ tr("确认关闭") }}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop"><button @click="disablePolicyModalOpen = false">{{ tr("关闭") }}</button></form>
  </dialog>

  <!-- 数据源编辑 -->
  <dialog class="modal" :class="{ 'modal-open': sourceModalOpen }">
    <div class="modal-box max-h-[85vh] w-11/12 max-w-2xl overflow-y-auto">
      <h3 class="text-lg font-semibold">{{ editingSourceId ? tr("编辑数据源") : tr("添加数据源") }}</h3>
      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <fieldset class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label :for="`${formFieldId}-source-kind`">{{ tr("平台") }}</label></legend>
          <select :id="`${formFieldId}-source-kind`" class="select select-bordered select-sm w-full" v-model="sourceForm.kind" :disabled="Boolean(editingSourceId)">
            <option v-for="platform in schema?.platforms || []" :key="platform.kind" :value="platform.kind">{{ platform.name }}</option>
          </select>
        </fieldset>
        <fieldset class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label :for="`${formFieldId}-name`">{{ tr("名称") }}</label></legend>
          <input :id="`${formFieldId}-name`" type="text" class="input input-bordered input-sm w-full" maxlength="64" v-model="sourceForm.name" />
        </fieldset>
        <fieldset class="fieldset min-w-0 w-full" v-for="field in credentialFields" :key="field">
          <legend class="fieldset-legend"><label :for="`${formFieldId}-cred-${field}`">{{ field === 'email' ? tr('FOFA email（可选兼容）') : tr('API 凭据') }}</label></legend>
          <input :id="`${formFieldId}-cred-${field}`" type="password" class="input input-bordered input-sm w-full" autocomplete="new-password" v-model="sourceForm[field === 'email' ? 'email' : 'api_key']" :placeholder="sourceForm.credential_configured && field !== 'email' ? tr('留空保持原凭据') : ''" />
        </fieldset>
        <label v-if="editingSourceId && sourceForm.credential_configured" class="flex items-center gap-2 self-center text-sm">
          <input type="checkbox" class="checkbox checkbox-sm" v-model="sourceForm.clear_credential" />
          {{ tr("清除已保存凭据") }}
        </label>
        <fieldset class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label :for="`${formFieldId}-source-proxy-mode`">{{ tr("代理") }}</label></legend>
          <select :id="`${formFieldId}-source-proxy-mode`" class="select select-bordered select-sm w-full" v-model="sourceForm.proxy_mode">
            <option value="system">{{ tr("跟随全局") }}</option>
            <option value="direct">{{ tr("直连") }}</option>
            <option value="custom">{{ tr("自定义") }}</option>
          </select>
        </fieldset>
        <fieldset v-if="sourceForm.proxy_mode === 'custom'" class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label :for="`${formFieldId}-source-proxy-url`">{{ tr("代理 URL") }}{{ sourceForm.proxy_configured ? tr("（留空保留）") : '' }}</label></legend>
          <input :id="`${formFieldId}-source-proxy-url`" type="text" class="input input-bordered input-sm w-full" autocomplete="off" maxlength="2048" :placeholder="tr('socks5h://用户名:密码@代理主机:1080')" v-model="sourceForm.proxy_url" />
          <span v-if="sourceForm.proxy_configured" class="fieldset-label break-all">{{ tr("已配置：") }}{{ sourceForm.proxy_endpoint }}{{ tr("（认证信息不回显）") }}</span>
          <span class="fieldset-label">{{ tr("支持 HTTP、HTTPS、SOCKS5 与 SOCKS5H；失败时不会回退直连。") }}</span>
        </fieldset>
        <fieldset class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label :for="`${formFieldId}-source-pagination`">{{ tr("分页") }}</label></legend>
          <select :id="`${formFieldId}-source-pagination`" class="select select-bordered select-sm w-full" v-model="sourceForm.pagination_mode">
            <option value="follow_local">{{ tr("跟随本地搜索") }}</option>
            <option value="fixed">{{ tr("固定分页") }}</option>
          </select>
        </fieldset>
        <fieldset class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label :for="`${formFieldId}-source-page-size`">{{ tr("每页条数") }}</label></legend>
          <input :id="`${formFieldId}-source-page-size`" type="number" class="input input-bordered input-sm w-full" min="1" max="1000" v-model.number="sourceForm.page_size" />
        </fieldset>
        <fieldset class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label :for="`${formFieldId}-source-max-pages`">{{ tr("最大页数") }}</label></legend>
          <input :id="`${formFieldId}-source-max-pages`" type="number" class="input input-bordered input-sm w-full" min="1" max="50" v-model.number="sourceForm.max_pages" />
        </fieldset>
        <fieldset class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label :for="`${formFieldId}-source-window-mode`">{{ tr("时间窗") }}</label></legend>
          <select :id="`${formFieldId}-source-window-mode`" class="select select-bordered select-sm w-full" v-model="sourceForm.window_mode">
            <option v-for="mode in WINDOW_MODES" :key="mode.value" :value="mode.value">{{ tr(mode.labelKey) }}</option>
          </select>
        </fieldset>
        <fieldset v-if="sourceForm.window_mode === 'custom'" class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label :for="`${formFieldId}-source-window-days`">{{ tr("时间窗天数（1..60）") }}</label></legend>
          <input :id="`${formFieldId}-source-window-days`" type="number" class="input input-bordered input-sm w-full" min="1" max="60" v-model.number="sourceForm.window_days" />
        </fieldset>
        <fieldset class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label :for="`${formFieldId}-source-timeout`">{{ tr("超时（秒）") }}</label></legend>
          <input :id="`${formFieldId}-source-timeout`" type="number" class="input input-bordered input-sm w-full" min="3" max="120" v-model.number="sourceForm.timeout_seconds" />
        </fieldset>
        <fieldset class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label :for="`${formFieldId}-source-qps`">{{ tr("限速 QPS") }}</label></legend>
          <input :id="`${formFieldId}-source-qps`" type="number" step="0.1" class="input input-bordered input-sm w-full" min="0.1" max="10" v-model.number="sourceForm.rate_limit_qps" />
        </fieldset>
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
        <button type="button" class="btn btn-neutral btn-sm" :disabled="sourceSaving || sourceFormErrors.length > 0" @click="saveSource">
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
        <fieldset class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label :for="`${formFieldId}-manual-query`">{{ tr("查询（本地搜索语法）") }}</label></legend>
          <textarea :id="`${formFieldId}-manual-query`" class="textarea textarea-bordered h-24 w-full font-mono text-sm" v-model="manualForm.query" placeholder='ip = "1.1.1.1" AND port = 443'></textarea>
        </fieldset>
        <div class="grid gap-3 sm:grid-cols-3">
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-manual-mode`">{{ tr("模式") }}</label></legend>
            <select :id="`${formFieldId}-manual-mode`" class="select select-bordered select-sm w-full" v-model="manualForm.mode">
              <option value="async">{{ tr("异步") }}</option>
              <option value="blocking">{{ tr("阻塞") }}</option>
            </select>
          </fieldset>
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-manual-window-days`">{{ tr("时间窗（天）") }}</label></legend>
            <input :id="`${formFieldId}-manual-window-days`" type="number" class="input input-bordered input-sm w-full" min="1" max="60" v-model.number="manualForm.window_days" />
          </fieldset>
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-manual-persist`">{{ tr("入库") }}</label></legend>
            <select :id="`${formFieldId}-manual-persist`" class="select select-bordered select-sm w-full" v-model="manualForm.persist">
              <option value="auto">{{ tr("按策略") }}</option>
              <option value="force">{{ tr("强制入库") }}</option>
              <option value="skip">{{ tr("不入库") }}</option>
            </select>
          </fieldset>
        </div>
      </div>
      <div class="modal-action">
        <button type="button" class="btn btn-ghost btn-sm" @click="manualModalOpen = false">{{ tr("取消") }}</button>
        <button type="button" class="btn btn-neutral btn-sm" :disabled="manualSubmitting || !manualForm.query.trim()" @click="submitManualRun">
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