<script setup>
import { DEFAULT_SCAN_PORTS } from '@/utils/scanDefaults'
import { tr } from '../i18n/index.js'

import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppAlert from '@/components/AppAlert.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import { inboxSeverityClass } from '@/utils/inbox'
import {
  changeDetailRows, changeKindLabel, intervalLabel, intervalPresets, monitorProfiles,
  profileLabel, ruleForm, rulePayload, runStatuses, skipReasonLabel, targetsSummary, validateRule,
} from '@/utils/targetMonitor'
import { formatDateTime } from '../i18n/time.js'
import http from '@/utils/http'

const formFieldId = useId()
const route = useRoute()
const rules = ref([]), alerts = ref([]), recipients = ref([])
const monitorUserEnabled = ref(false), isAdmin = ref(false)
const loading = ref(false), loadFailed = ref(false), busy = ref(false)
const activeTab = ref('rules')
const editor = ref(null), form = ref(ruleForm()), savedForm = ref('')
const confirmDialog = ref(null)
const historyDialog = ref(null), historyRule = ref(null), activeRun = ref(null)
const runs = ref([]), runsNextBefore = ref(null), runsLoading = ref(false)
const changes = ref([]), changesLoading = ref(false)
const recentChanges = ref([]), recentNextBefore = ref(null), recentLoading = ref(false)
const customHours = ref(24)
let sequence = 0, disposed = false

const canManage = computed(() => isAdmin.value || monitorUserEnabled.value)
const dirty = computed(() => Boolean(editor.value?.open) && JSON.stringify(form.value) !== savedForm.value)
useUnsavedChanges(dirty, saveRule, confirmDialog)

const intervalSelection = computed({
  get: () => (intervalPresets.some(preset => preset.value === form.value.interval_seconds) ? String(form.value.interval_seconds) : 'custom'),
  set: value => {
    if (value === 'custom') {
      customHours.value = Math.min(720, Math.max(1, Math.round((form.value.interval_seconds || 86400) / 3600)))
      form.value.interval_seconds = customHours.value * 3600
      return
    }
    form.value.interval_seconds = Number(value)
  },
})
watch(customHours, hours => {
  if (intervalSelection.value === 'custom' && Number.isFinite(hours)) form.value.interval_seconds = Math.round(hours * 3600)
})

function notify(type, title, description = '') {
  alerts.value.unshift({ id: crypto.randomUUID(), type, title, description, timeout: 7000 })
}
function dataOf(response) {
  if (response.data?.success !== true) throw new Error(tr("目标监控服务响应无效"))
  return response.data.data
}
function errorText(error) { return error.response?.data?.message || tr("操作失败，请检查网络连接后重试。") }
function runStatusClass(status) {
  if (status === 'succeeded') return 'badge-success'
  if (status === 'failed') return 'badge-error'
  if (status === 'skipped') return 'badge-warning'
  if (status === 'running') return 'badge-info'
  return 'badge-ghost'
}

async function loadRules() {
  if (disposed) return
  loading.value = true
  try {
    const data = dataOf(await http.get('/api/target-monitor/rules'))
    if (disposed) return
    rules.value = Array.isArray(data?.items) ? data.items : []
    monitorUserEnabled.value = Boolean(data?.monitor_user_enabled)
    isAdmin.value = Boolean(data?.is_admin)
    loadFailed.value = false
  } catch {
    if (!disposed) loadFailed.value = true
  } finally {
    if (!disposed) loading.value = false
  }
}

async function loadRecipients() {
  try {
    const data = dataOf(await http.get('/api/target-monitor/recipients'))
    recipients.value = Array.isArray(data) ? data : []
  } catch { recipients.value = [] }
}

function openEditor(rule) {
  form.value = ruleForm(rule)
  customHours.value = Math.min(720, Math.max(1, Math.round((form.value.interval_seconds || 86400) / 3600)))
  savedForm.value = JSON.stringify(form.value)
  editor.value?.showModal()
}
async function closeEditor(force = false) {
  if (!force && dirty.value && !await confirmDialog.value.ask({ message: tr("有未保存的监控规则，确定放弃修改吗？"), confirmText: tr("放弃修改"), danger: true })) return
  editor.value?.close()
  form.value = ruleForm()
  savedForm.value = ''
}
async function saveRule() {
  if (busy.value) return false
  const problem = validateRule(form.value)
  if (problem) { notify('warning', tr("请检查监控规则"), problem); return false }
  busy.value = true
  try {
    const payload = rulePayload(form.value)
    dataOf(await http({ method: form.value.id ? 'PUT' : 'POST', url: `/api/target-monitor/rules${form.value.id ? `/${form.value.id}` : ''}`, data: payload }))
    await closeEditor(true)
    notify('success', tr("监控规则已保存"))
    await loadRules()
    return true
  } catch (error) {
    if (error.response?.status === 409) {
      notify('warning', tr("规则已被其他会话修改"), tr("请重新加载后再编辑。"))
      await closeEditor(true)
      await loadRules()
    } else {
      notify('error', tr("保存失败"), errorText(error))
    }
    return false
  } finally { busy.value = false }
}

async function toggleRule(rule) {
  if (busy.value) return
  busy.value = true
  try {
    const payload = rulePayload(ruleForm(rule))
    payload.enabled = !rule.enabled
    dataOf(await http.put(`/api/target-monitor/rules/${rule.id}`, payload))
    notify('success', payload.enabled ? tr("监控已启用") : tr("监控已停用"))
    await loadRules()
  } catch (error) { notify('error', tr("操作失败"), errorText(error)) }
  finally { busy.value = false }
}

async function runNow(rule) {
  if (busy.value) return
  busy.value = true
  try {
    dataOf(await http.post(`/api/target-monitor/rules/${rule.id}/run`))
    notify('success', tr("已加入执行队列"), tr("扫描完成后变化会出现在运行历史与站内通知中。"))
    await loadRules()
  } catch (error) { notify('error', tr("操作失败"), errorText(error)) }
  finally { busy.value = false }
}

async function deleteRule(rule) {
  if (busy.value || !await confirmDialog.value.ask({ message: tr("确定删除监控规则“{0}”及其运行历史吗？", [rule.name]), confirmText: tr("删除"), danger: true })) return
  busy.value = true
  try {
    dataOf(await http.delete(`/api/target-monitor/rules/${rule.id}`, { data: { expected_revision: rule.revision } }))
    notify('success', tr("监控规则已删除"))
    await loadRules()
  } catch (error) { notify('error', tr("删除失败"), errorText(error)) }
  finally { busy.value = false }
}

async function loadRuns(append = false) {
  if (!historyRule.value || disposed) return
  const request = ++sequence
  runsLoading.value = true
  const params = {}
  if (append && runsNextBefore.value) params.before = runsNextBefore.value
  try {
    const data = dataOf(await http.get(`/api/target-monitor/rules/${historyRule.value.id}/runs`, { params }))
    if (disposed || request !== sequence) return
    runs.value = append ? [...runs.value, ...data.items] : data.items
    runsNextBefore.value = data.next_before
  } catch { /* 历史加载失败保留已有内容 */ }
  finally { if (!disposed && request === sequence) runsLoading.value = false }
}

async function loadRunChanges(runId) {
  changesLoading.value = true
  try {
    const data = dataOf(await http.get(`/api/target-monitor/runs/${runId}/changes`))
    changes.value = Array.isArray(data?.items) ? data.items : []
  } catch { changes.value = [] }
  finally { changesLoading.value = false }
}

async function openHistory(rule) {
  historyRule.value = rule
  activeRun.value = null
  changes.value = []
  runs.value = []
  runsNextBefore.value = null
  historyDialog.value?.showModal()
  await loadRuns()
}
async function openRun(run) {
  activeRun.value = run
  await loadRunChanges(run.id)
}
function closeHistory() {
  historyDialog.value?.close()
  historyRule.value = null
  activeRun.value = null
}
async function openDeepLink(runId) {
  historyRule.value = null
  activeRun.value = { id: runId }
  runs.value = []
  historyDialog.value?.showModal()
  await loadRunChanges(runId)
}

async function loadRecentChanges(append = false) {
  if (disposed) return
  const request = ++sequence
  recentLoading.value = true
  const params = {}
  if (append && recentNextBefore.value) params.before = recentNextBefore.value
  try {
    const data = dataOf(await http.get('/api/target-monitor/changes', { params }))
    if (disposed || request !== sequence) return
    recentChanges.value = append ? [...recentChanges.value, ...data.items] : data.items
    recentNextBefore.value = data.next_before
  } catch { /* 保留已有内容 */ }
  finally { if (!disposed && request === sequence) recentLoading.value = false }
}
async function switchTab(tab) {
  activeTab.value = tab
  if (tab === 'changes' && !recentChanges.value.length) await loadRecentChanges()
}

// 已停留在 /monitor 时点击监控通知仅变更 query，不会重跑 onMounted。
watch(() => route.query?.run, async (run, previous) => {
  if (run && run !== previous) await openDeepLink(String(run))
})

onMounted(async () => {
  await loadRules()
  if (disposed) return
  if (isAdmin.value) await loadRecipients()
  if (disposed) return
  if (route.query?.run) await openDeepLink(String(route.query.run))
})
onBeforeUnmount(() => { disposed = true; ++sequence })
</script>

<template>
  <div class="page-shell space-y-6">
    <ConfirmDialog ref="confirmDialog" />
    <AppAlert v-for="item in alerts" :key="item.id" v-bind="item" @close="alerts = alerts.filter(value => value.id !== item.id)" />
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h1 class="page-title">{{ tr("目标监控") }}</h1><p class="mt-2 text-sm opacity-60">{{ tr("周期性复扫指定目标，检测端口、服务、标题、证书与 DNS 解析变化，并经站内通知与订阅渠道推送。") }}</p></div>
      <div class="flex gap-2"><button class="btn btn-sm" :disabled="loading" @click="loadRules">{{ tr("刷新") }}</button><button class="btn btn-neutral btn-sm" :disabled="busy || loadFailed || !canManage" @click="openEditor()">{{ tr("添加监控规则") }}</button></div>
    </div>
    <div v-if="!canManage && !loading" class="alert alert-warning" role="alert">{{ tr("目标监控功能暂未开放，请联系管理员在通知管理中开启“允许用户自助创建监控”。") }}</div>
    <div v-if="loadFailed" class="alert alert-error" role="alert"><span>{{ tr("监控规则加载失败，请刷新后重试。") }}</span><button class="btn btn-sm" @click="loadRules">{{ tr("重试") }}</button></div>
    <div class="tabs tabs-boxed w-fit">
      <button type="button" class="tab" :class="{ 'tab-active': activeTab === 'rules' }" @click="switchTab('rules')">{{ tr("监控规则") }}</button>
      <button type="button" class="tab" :class="{ 'tab-active': activeTab === 'changes' }" @click="switchTab('changes')">{{ tr("最近变化") }}</button>
    </div>
    <section v-if="activeTab === 'rules'" class="rounded-xl bg-base-100 p-4 md:p-6">
      <p v-if="loading" class="py-6" role="status">{{ tr("正在加载监控规则…") }}</p>
      <p v-else-if="!rules.length && !loadFailed" class="py-8 text-center opacity-60">{{ canManage ? tr("尚未配置监控规则。添加 IP/CIDR 或域名目标后，系统会按周期复扫并检测变化。") : tr("暂无可查看的监控规则。") }}</p>
      <div v-else class="grid gap-4 lg:grid-cols-2">
        <article v-for="rule in rules" :key="rule.id" class="rounded-lg border border-base-300 p-4">
          <div class="flex items-center justify-between gap-3">
            <h2 class="break-all font-semibold">{{ rule.name }}</h2>
            <span class="badge badge-sm" :class="rule.enabled ? 'badge-success' : 'badge-ghost'">{{ rule.enabled ? tr("已启用") : tr("已停用") }}</span>
          </div>
          <div class="mt-2 flex flex-wrap gap-2">
            <span class="badge badge-outline badge-sm">{{ rule.target_type === 'domain' ? tr("域名") : tr("IP / CIDR") }}</span>
            <span class="badge badge-outline badge-sm">{{ profileLabel(rule.scan_profile) }}</span>
            <span class="badge badge-outline badge-sm">{{ intervalLabel(rule.interval_seconds) }}</span>
            <span v-if="isAdmin" class="badge badge-outline badge-sm">{{ tr("所有者：") }}{{ rule.owner_name || rule.created_by }}</span>
          </div>
          <p class="mt-2 break-all text-sm">{{ targetsSummary(rule) }}</p>
          <p class="mt-1 text-xs opacity-60">{{ tr("上次运行：") }}{{ rule.last_run_at ? formatDateTime(rule.last_run_at) : '—' }} · {{ tr("下次运行：") }}{{ rule.next_run_at ? formatDateTime(rule.next_run_at) : '—' }}</p>
          <p class="mt-1 text-xs opacity-60">{{ tr("最近变化：") }}{{ rule.last_change_count ?? 0 }}{{ tr(" 项") }}</p>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <button class="btn btn-sm" :disabled="busy || loadFailed || !canManage" @click="openEditor(rule)">{{ tr("编辑") }}</button>
            <button class="btn btn-sm" :disabled="busy || loadFailed || !canManage || !rule.enabled" @click="runNow(rule)">{{ tr("立即执行") }}</button>
            <button class="btn btn-sm" :disabled="busy" @click="openHistory(rule)">{{ tr("运行历史") }}</button>
            <button class="btn btn-ghost btn-sm text-error" :disabled="busy || loadFailed || !canManage" @click="deleteRule(rule)">{{ tr("删除") }}</button>
            <label class="ml-auto flex items-center gap-2 text-xs"><input type="checkbox" class="toggle toggle-neutral toggle-sm" :checked="rule.enabled" :disabled="busy || !canManage" @change="toggleRule(rule)" />{{ tr("启用") }}</label>
          </div>
        </article>
      </div>
    </section>
    <section v-else class="rounded-xl bg-base-100 p-4 md:p-6">
      <p v-if="recentLoading && !recentChanges.length" class="py-6" role="status">{{ tr("正在加载…") }}</p>
      <p v-else-if="!recentChanges.length" class="py-8 text-center opacity-60">{{ tr("暂无监控变化记录。") }}</p>
      <div v-else class="space-y-3">
        <details v-for="change in recentChanges" :key="change.id" class="rounded-lg border border-base-300 p-3">
          <summary class="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
            <span class="size-2 rounded-full" :class="inboxSeverityClass(change.severity)" aria-hidden="true"></span>
            <span class="badge badge-outline badge-xs">{{ changeKindLabel(change.kind) }}</span>
            <span class="break-all font-medium">{{ change.target }}{{ change.port != null ? `:${change.port}` : '' }}</span>
            <span class="opacity-60">{{ change.rule_name }}</span>
            <span class="ml-auto text-xs opacity-60">{{ formatDateTime(change.occurred_at) }}</span>
          </summary>
          <table class="table table-xs mt-2">
            <thead><tr><th>{{ tr("字段") }}</th><th>{{ tr("之前") }}</th><th>{{ tr("之后") }}</th></tr></thead>
            <tbody><tr v-for="row in changeDetailRows(change.detail)" :key="row.key"><td>{{ row.label }}</td><td class="break-all">{{ row.before }}</td><td class="break-all">{{ row.after }}</td></tr></tbody>
          </table>
        </details>
        <div class="flex justify-center"><button v-if="recentNextBefore" class="btn btn-sm" :disabled="recentLoading" @click="loadRecentChanges(true)">{{ recentLoading ? tr("正在加载…") : tr("加载更多") }}</button></div>
      </div>
    </section>
    <dialog ref="editor" class="modal" @cancel.prevent="closeEditor()">
      <form class="modal-box space-y-5" @submit.prevent="saveRule">
        <h2 class="text-lg font-semibold">{{ form.id ? tr("编辑监控规则") : tr("添加监控规则") }}</h2>
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-name`">{{ tr("规则名称") }}</label></legend><input :id="`${formFieldId}-name`" v-model="form.name" class="input input-bordered w-full" maxlength="80" required autocomplete="off" :placeholder="tr(&quot;例如：核心网段监控&quot;)" /></fieldset>
        <fieldset><legend class="mb-2 text-sm">{{ tr("目标类型") }}</legend><div class="flex flex-wrap gap-4"><label class="flex items-center gap-2 text-sm"><input v-model="form.target_type" :name="`${formFieldId}-target-type`" type="radio" value="ip" class="radio radio-sm" />{{ tr("IP / CIDR") }}</label><label class="flex items-center gap-2 text-sm"><input v-model="form.target_type" :name="`${formFieldId}-target-type`" type="radio" value="domain" class="radio radio-sm" />{{ tr("域名") }}</label></div></fieldset>
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-targets`">{{ tr("监控目标（每行一个或逗号分隔，最多 64 个）") }}</label></legend><textarea :id="`${formFieldId}-targets`" v-model="form.targets_text" class="textarea textarea-bordered w-full" rows="4" required :placeholder="form.target_type === 'domain' ? 'example.com' : '192.0.2.0/24'" /></fieldset>
        <template v-if="form.target_type === 'ip'">
          <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-ports`">{{ tr("端口表达式") }}</label></legend><input :id="`${formFieldId}-ports`" v-model="form.ports" class="input input-bordered w-full" autocomplete="off" :placeholder="DEFAULT_SCAN_PORTS" /></fieldset>
          <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-profile`">{{ tr("扫描模式") }}</label></legend><select :id="`${formFieldId}-profile`" v-model="form.scan_profile" class="select select-bordered w-full"><option v-for="profile in monitorProfiles" :key="profile.value" :value="profile.value">{{ profile.label }}</option></select></fieldset>
        </template>
        <p v-else class="text-xs opacity-60">{{ tr("域名规则固定使用“仅 DNS”模式，监控解析地址集合的变化。") }}</p>
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-interval`">{{ tr("监控周期") }}</label></legend><select :id="`${formFieldId}-interval`" v-model="intervalSelection" class="select select-bordered w-full"><option v-for="preset in intervalPresets" :key="preset.value" :value="String(preset.value)">{{ preset.label }}</option><option value="custom">{{ tr("自定义") }}</option></select></fieldset>
        <fieldset v-if="intervalSelection === 'custom'" class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-custom-hours`">{{ tr("自定义周期（小时，1–720）") }}</label></legend><input :id="`${formFieldId}-custom-hours`" v-model.number="customHours" type="number" min="1" max="720" class="input input-bordered w-full" /></fieldset>
        <fieldset v-if="isAdmin"><legend class="mb-2 text-sm">{{ tr("站内通知收件人") }}</legend><p class="mb-2 text-xs opacity-60">{{ tr("不选择时仅通知规则创建者。") }}</p><label v-for="user in recipients" :key="user.id" class="mb-2 flex items-center gap-2 text-sm"><input v-model="form.recipient_ids" :value="user.id" type="checkbox" class="checkbox checkbox-sm" />{{ user.username }}</label></fieldset>
        <label class="flex items-center gap-2 text-sm"><input v-model="form.enabled" type="checkbox" class="toggle toggle-neutral" />{{ tr("启用规则") }}</label>
        <div class="modal-action"><button type="button" class="btn btn-sm" :disabled="busy" @click="closeEditor()">{{ tr("取消") }}</button><button class="btn btn-neutral btn-sm" :disabled="busy">{{ busy ? tr("正在保存…") : tr("保存规则") }}</button></div>
      </form>
    </dialog>
    <dialog ref="historyDialog" class="modal" @cancel.prevent="closeHistory">
      <div class="modal-box max-w-3xl space-y-4">
        <h2 class="text-lg font-semibold">{{ historyRule ? tr("运行历史：{0}", [historyRule.name]) : tr("监控变化详情") }}</h2>
        <template v-if="historyRule">
          <p v-if="runsLoading && !runs.length" class="py-4 text-sm opacity-60" role="status">{{ tr("正在加载…") }}</p>
          <p v-else-if="!runs.length" class="py-4 text-sm opacity-60">{{ tr("暂无运行记录。") }}</p>
          <ul v-else class="divide-y divide-base-300">
            <li v-for="run in runs" :key="run.id" class="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span class="badge badge-sm" :class="runStatusClass(run.status)">{{ runStatuses[run.status] || run.status }}</span>
              <span class="text-xs opacity-60">{{ run.started_at ? formatDateTime(run.started_at) : '—' }}</span>
              <span v-if="run.skip_reason" class="text-xs opacity-60">{{ skipReasonLabel(run.skip_reason) }}</span>
              <span class="text-xs opacity-60">{{ tr("变化：") }}{{ run.change_count ?? 0 }}</span>
              <router-link v-if="run.task_id" class="link link-hover text-xs" :to="`/task/${run.task_id}`">{{ tr("任务详情") }}</router-link>
              <button type="button" class="btn btn-xs ml-auto" :disabled="changesLoading" @click="openRun(run)">{{ tr("查看变化") }}</button>
            </li>
          </ul>
          <div v-if="runsNextBefore" class="flex justify-center"><button class="btn btn-sm" :disabled="runsLoading" @click="loadRuns(true)">{{ tr("加载更多") }}</button></div>
        </template>
        <template v-if="activeRun">
          <h3 class="border-t border-base-300 pt-3 text-sm font-semibold">{{ tr("变化明细") }}</h3>
          <p v-if="changesLoading" class="py-4 text-sm opacity-60" role="status">{{ tr("正在加载…") }}</p>
          <p v-else-if="!changes.length" class="py-4 text-sm opacity-60">{{ tr("本次运行没有检测到变化。") }}</p>
          <div v-else class="space-y-3">
            <article v-for="change in changes" :key="change.id" class="rounded-lg border border-base-300 p-3">
              <div class="flex flex-wrap items-center gap-2 text-sm">
                <span class="size-2 rounded-full" :class="inboxSeverityClass(change.severity)" aria-hidden="true"></span>
                <span class="badge badge-outline badge-xs">{{ changeKindLabel(change.kind) }}</span>
                <span class="break-all font-medium">{{ change.target }}{{ change.port != null ? `:${change.port}` : '' }}</span>
                <span class="ml-auto text-xs opacity-60">{{ formatDateTime(change.occurred_at) }}</span>
              </div>
              <table class="table table-xs mt-2">
                <thead><tr><th>{{ tr("字段") }}</th><th>{{ tr("之前") }}</th><th>{{ tr("之后") }}</th></tr></thead>
                <tbody><tr v-for="row in changeDetailRows(change.detail)" :key="row.key"><td>{{ row.label }}</td><td class="break-all">{{ row.before }}</td><td class="break-all">{{ row.after }}</td></tr></tbody>
              </table>
            </article>
          </div>
        </template>
        <div class="modal-action"><button type="button" class="btn btn-sm" @click="closeHistory">{{ tr("关闭") }}</button></div>
      </div>
      <form method="dialog" class="modal-backdrop"><button @click.prevent="closeHistory">{{ tr("关闭") }}</button></form>
    </dialog>
  </div>
</template>
