<script setup>
import { tr } from '../i18n/index.js'

import { formatDateTime as formatSystemDateTime } from '../i18n/time.js'
import { computed, onMounted, reactive, ref, useId } from 'vue'
import { useRoute } from 'vue-router'
import AppAlert from '@/components/AppAlert.vue'
import ConfigCheckPanel from '@/components/ConfigCheckPanel.vue'
import EmptyState from '@/components/EmptyState.vue'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import http from '@/utils/http'

const formFieldId = useId()
const route = useRoute()
const scannerId = computed(() => String(route.params.id || ''))
const loading = ref(true)
const saving = ref(false)
const loadFailed = ref(false)
const revision = ref(0)
const appliedRevision = ref(null)
const scannerName = ref('')
const configStatus = ref(null)
const configError = ref(null)
const reportedAt = ref(null)
const localConfigCheck = ref(null)
const changeReason = ref('')
const alerts = ref([])
const savedDocument = ref(null)
const dnsRecordTypes = ['A', 'AAAA', 'CNAME', 'NS', 'MX', 'PTR', 'SRV', 'TXT', 'CAA', 'SOA', 'SVCB', 'HTTPS']

const form = reactive({
  masscan: { rate: 100000 },
  service_detection: {
    enabled: true,
    strategy: 'adaptive',
    max_probes_per_endpoint: 8,
    confidence_threshold: 80,
    senders: 200,
    server_rate_limit: 20,
    connect_timeout_seconds: 5,
    target_timeout_seconds: 15,
    max_result_bytes: 65536,
  },
  dns: { enabled: true, record_types: [...dnsRecordTypes], query_timeout_seconds: 5 },
  nuclei: {
    enabled: false,
    port_fallback: true,
    severities: ['medium', 'high', 'critical'],
    rate_limit: 20,
    bulk_size: 5,
    concurrency: 5,
    timeout_seconds: 10,
    retries: 1,
    max_runtime_seconds: 1800,
    max_findings: 10000,
    max_result_bytes: 262144,
  },
})

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function documentValue() {
  return clone(form)
}

const isDirty = computed(() => savedDocument.value && JSON.stringify(documentValue()) !== JSON.stringify(savedDocument.value))

function applyData(data) {
  Object.assign(form.masscan, data.document.masscan)
  Object.assign(form.service_detection, data.document.service_detection)
  Object.assign(form.dns, data.document.dns)
  Object.assign(form.nuclei, data.document.nuclei)
  revision.value = data.revision
  appliedRevision.value = data.applied_revision ?? null
  scannerName.value = data.scanner_name || ''
  configStatus.value = data.status || null
  configError.value = data.error || null
  reportedAt.value = data.reported_at || null
  localConfigCheck.value = data.local_config_check || null
  savedDocument.value = documentValue()
}

function pushAlert(type, title, description = '') {
  alerts.value.unshift({ id: crypto.randomUUID(), type, title, description, timeout: 7000 })
}

function closeAlert(id) {
  alerts.value = alerts.value.filter((item) => item.id !== id)
}

async function loadConfiguration({ silent = false } = {}) {
  if (!silent) loading.value = true
  try {
    const response = await http.get(`/api/scanner/${scannerId.value}/configuration`)
    const data = response.data?.data
    if (response.data?.success !== true || !data?.document) throw new Error('invalid configuration response')
    applyData(data)
    loadFailed.value = false
  } catch (error) {
    console.error('load scanner configuration failed', error)
    loadFailed.value = true
    if (!silent) pushAlert('error', tr("配置加载失败"), error.response?.data?.message || tr("请稍后重试。"))
  } finally {
    loading.value = false
  }
}

async function saveConfiguration() {
  if (saving.value || !isDirty.value) return true
  saving.value = true
  try {
    const response = await http.put(`/api/scanner/${scannerId.value}/configuration`, {
      expectedRevision: revision.value,
      document: documentValue(),
      changeReason: changeReason.value.trim(),
    })
    const data = response.data?.data
    if (response.data?.success !== true || !data?.document) throw new Error('invalid configuration response')
    revision.value = data.revision
    savedDocument.value = documentValue()
    changeReason.value = ''
    pushAlert('success', tr("配置已发布"), tr("版本 #{0} 将通过下一次心跳通知扫描器。", [data.revision]))
    await loadConfiguration({ silent: true })
    return true
  } catch (error) {
    if (error.response?.status === 409) {
      pushAlert('warning', tr("配置已被其他管理员更新"), tr("已重新加载服务端最新版本，请确认后再次发布。"))
      await loadConfiguration({ silent: true })
    } else {
      pushAlert('error', tr("配置发布失败"), error.response?.data?.message || tr("请检查输入后重试。"))
    }
    return false
  } finally {
    saving.value = false
  }
}

const statusView = computed(() => {
  if (configStatus.value === 'rejected') return { get text() { return tr("应用失败") }, class: 'badge-error' }
  if (configStatus.value === 'staged') return { get text() { return tr("等待任务边界") }, class: 'badge-warning' }
  if (appliedRevision.value === revision.value) return { get text() { return tr("已同步") }, class: 'badge-success' }
  if (appliedRevision.value == null) return { get text() { return tr("等待首次确认") }, class: 'badge-ghost' }
  return { get text() { return tr("等待下发") }, class: 'badge-warning' }
})

function formatDate(value) {
  if (!value) return '-'
  return formatSystemDateTime(new Date(value))
}

function toggleList(list, value, checked) {
  const index = list.indexOf(value)
  if (checked && index < 0) list.push(value)
  if (!checked && index >= 0) list.splice(index, 1)
}

useUnsavedChanges(isDirty, saveConfiguration)
onMounted(loadConfiguration)
</script>

<template>
  <div class="page-shell">
    <div class="pointer-events-none fixed right-4 top-20 z-50 flex w-[calc(100vw-2rem)] flex-col items-end gap-2 sm:w-auto">
      <AppAlert v-for="alert in alerts" :key="alert.id" class="pointer-events-auto" v-bind="alert" @close="closeAlert(alert.id)" />
    </div>

    <div class="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row">
      <div>
        <h1 class="page-title">{{ scannerName || tr("扫描器") }} {{ tr("· 扫描配置") }}</h1>
        <p class="mt-1 break-all text-sm opacity-70">ID：{{ scannerId }}</p>
      </div>
      <router-link :to="{ name: 'scanner-detail', params: { id: scannerId } }" class="btn btn-ghost btn-sm">{{ tr("返回扫描器详情") }}</router-link>
    </div>

    <div v-if="loading" class="grid min-h-80 place-items-center rounded-lg bg-base-200/60"><span class="loading loading-spinner loading-md"></span></div>
    <EmptyState v-else-if="loadFailed" type="error" :title="tr(&quot;扫描器配置加载失败&quot;)" :message="tr(&quot;无法从服务端读取配置，请稍后重试。&quot;)" />

    <div v-else class="space-y-5">
      <section class="card bg-base-100 card-border border-base-300 p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="font-semibold">{{ tr("下发状态") }}</h3>
            <p class="mt-1 text-xs opacity-60">{{ tr("扫描任务启动后固定使用当时的配置快照，新配置会在任务边界生效。") }}</p>
          </div>
          <span class="badge" :class="statusView.class">{{ statusView.text }}</span>
        </div>
        <div class="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div class="rounded-lg bg-base-200/60 p-3"><span class="opacity-65">{{ tr("服务端版本") }}</span><div class="mt-1 font-medium">#{{ revision }}</div></div>
          <div class="rounded-lg bg-base-200/60 p-3"><span class="opacity-65">{{ tr("已应用版本") }}</span><div class="mt-1 font-medium">{{ appliedRevision == null ? '-' : `#${appliedRevision}` }}</div></div>
          <div class="rounded-lg bg-base-200/60 p-3"><span class="opacity-65">{{ tr("扫描端状态") }}</span><div class="mt-1 font-medium">{{ configStatus || '-' }}</div></div>
          <div class="rounded-lg bg-base-200/60 p-3"><span class="opacity-65">{{ tr("最后回报") }}</span><div class="mt-1 font-medium">{{ formatDate(reportedAt) }}</div></div>
        </div>
        <div v-if="configError" class="alert alert-error mt-3"><span class="break-all">{{ configError }}</span></div>
      </section>
      <ConfigCheckPanel :report="localConfigCheck" :title="tr(&quot;扫描器本地配置检查&quot;)" />

      <section class="card bg-base-100 card-border border-base-300 p-4">
        <h3 class="font-semibold">{{ tr("端口扫描") }}</h3>
        <p class="mt-1 text-xs opacity-60">{{ tr("实际速率仍受扫描节点本地安全上限约束。") }}</p>
        <fieldset class="fieldset min-w-0 w-full mt-4 max-w-md"><legend class="fieldset-legend"><label :for="`${formFieldId}-1`">{{ tr("Masscan 发包速率") }}</label></legend><input :id="`${formFieldId}-1`" v-model.number="form.masscan.rate" type="number" min="1" class="input input-bordered w-full" /></fieldset>
      </section>

      <section class="card bg-base-100 card-border border-base-300 p-4">
        <div class="flex items-start justify-between gap-3">
          <div><h3 class="font-semibold">{{ tr("服务识别（zgrab2）") }}</h3><p class="mt-1 text-xs opacity-60">{{ tr("远程开启不能突破节点本地的服务识别授权。关闭后该节点不再领取需要服务识别的任务。") }}</p></div>
          <input v-model="form.service_detection.enabled" type="checkbox" class="toggle" />
        </div>
        <div class="mt-4 grid gap-4 lg:grid-cols-3">
          <div class="space-y-4">
            <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-2`">{{ tr("服务识别策略") }}</label></legend><select :id="`${formFieldId}-2`" v-model="form.service_detection.strategy" class="select select-bordered w-full"><option value="standard">standard</option><option value="adaptive">adaptive</option><option value="exhaustive">exhaustive</option></select></fieldset>
            <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-3`">{{ tr("每端点最大探针数") }}</label></legend><input :id="`${formFieldId}-3`" v-model.number="form.service_detection.max_probes_per_endpoint" type="number" min="1" max="32" class="input input-bordered w-full" /></fieldset>
            <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-4`">{{ tr("置信度阈值") }}</label></legend><input :id="`${formFieldId}-4`" v-model.number="form.service_detection.confidence_threshold" type="number" min="1" max="100" class="input input-bordered w-full" /></fieldset>
          </div>
          <div class="space-y-4">
            <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-5`">{{ tr("并发发送协程") }}</label></legend><input :id="`${formFieldId}-5`" v-model.number="form.service_detection.senders" type="number" min="1" max="10000" class="input input-bordered w-full" /></fieldset>
            <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-6`">{{ tr("单目标连接速率") }}</label></legend><input :id="`${formFieldId}-6`" v-model.number="form.service_detection.server_rate_limit" type="number" min="1" max="10000" class="input input-bordered w-full" /></fieldset>
            <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-7`">{{ tr("连接超时（秒）") }}</label></legend><input :id="`${formFieldId}-7`" v-model.number="form.service_detection.connect_timeout_seconds" type="number" min="1" max="60" class="input input-bordered w-full" /></fieldset>
          </div>
          <div class="space-y-4">
            <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-8`">{{ tr("目标超时（秒）") }}</label></legend><input :id="`${formFieldId}-8`" v-model.number="form.service_detection.target_timeout_seconds" type="number" min="1" max="300" class="input input-bordered w-full" /></fieldset>
            <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-9`">{{ tr("单结果上限（字节）") }}</label></legend><input :id="`${formFieldId}-9`" v-model.number="form.service_detection.max_result_bytes" type="number" min="1024" max="1048576" class="input input-bordered w-full" /></fieldset>
          </div>
        </div>
      </section>

      <section class="grid gap-5 xl:grid-cols-2">
        <div class="card bg-base-100 card-border border-base-300 p-4">
          <div class="flex items-center justify-between"><div><h3 class="font-semibold">{{ tr("DNS 查询") }}</h3><p class="mt-1 text-xs opacity-60">{{ tr("远程开启不能突破节点本地的 DNS 授权。关闭后该节点不再领取 DNS 任务。") }}</p></div><input v-model="form.dns.enabled" type="checkbox" class="toggle" /></div>
          <div class="mt-4 space-y-4">
            <div><span class="label-text">{{ tr("记录类型") }}</span><div class="mt-2 flex flex-wrap gap-x-5 gap-y-1"><label v-for="type in dnsRecordTypes" :key="type" class="label cursor-pointer justify-start gap-2"><input type="checkbox" class="checkbox checkbox-sm" :checked="form.dns.record_types.includes(type)" @change="toggleList(form.dns.record_types, type, $event.target.checked)" /><span>{{ type }}</span></label></div></div>
            <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-10`">{{ tr("查询超时（秒）") }}</label></legend><input :id="`${formFieldId}-10`" v-model.number="form.dns.query_timeout_seconds" type="number" min="1" max="60" class="input input-bordered w-full" /></fieldset>
          </div>
        </div>

        <div class="card bg-base-100 card-border border-base-300 p-4">
          <div class="flex items-center justify-between"><div><h3 class="font-semibold">{{ tr("漏洞扫描（Nuclei）") }}</h3><p class="mt-1 text-xs opacity-60">{{ tr("本机未授权时远程开启不会生效。关闭后该节点不再领取漏洞扫描任务。") }}</p></div><input v-model="form.nuclei.enabled" type="checkbox" class="toggle" /></div>
          <label class="label mt-3 cursor-pointer justify-start gap-2"><input v-model="form.nuclei.port_fallback" type="checkbox" class="checkbox checkbox-sm" /><span>{{ tr("未知服务按端口回退选择模板") }}</span></label>
          <div class="mt-3"><span class="label-text">{{ tr("严重级别") }}</span><div class="mt-2 flex flex-wrap gap-x-4"><label v-for="severity in ['info', 'low', 'medium', 'high', 'critical']" :key="severity" class="label cursor-pointer justify-start gap-2"><input type="checkbox" class="checkbox checkbox-sm" :checked="form.nuclei.severities.includes(severity)" @change="toggleList(form.nuclei.severities, severity, $event.target.checked)" /><span>{{ severity }}</span></label></div></div>
          <div class="mt-4 grid gap-4 sm:grid-cols-2">
            <fieldset v-for="field in [
              [&#39;rate_limit&#39;, tr(&quot;速率限制&quot;), 1, 10000], [&#39;bulk_size&#39;, tr(&quot;批大小&quot;), 1, 1000], [&#39;concurrency&#39;, tr(&quot;并发数&quot;), 1, 1000],
              [&#39;timeout_seconds&#39;, tr(&quot;超时（秒）&quot;), 1, 300], [&#39;retries&#39;, tr(&quot;重试次数&quot;), 0, 10], [&#39;max_runtime_seconds&#39;, tr(&quot;最长运行（秒）&quot;), 10, 86400],
              [&#39;max_findings&#39;, tr(&quot;最大结果数&quot;), 1, 100000], [&#39;max_result_bytes&#39;, tr(&quot;单结果上限（字节）&quot;), 4096, 1048576]
            ]" :key="field[0]" class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-11-${field[0]}`">{{ field[1] }}</label></legend><input :id="`${formFieldId}-11-${field[0]}`" v-model.number="form.nuclei[field[0]]" type="number" :min="field[2]" :max="field[3]" class="input input-bordered w-full" /></fieldset>
          </div>
        </div>
      </section>

      <section class="card bg-base-100 card-border border-base-300 p-4">
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label for="scannerconfiguration-changereason">{{ tr("变更原因（可选）") }}</label></legend><textarea id="scannerconfiguration-changereason" v-model="changeReason" maxlength="500" class="textarea textarea-bordered w-full" :placeholder="tr(&quot;可选：说明本次调整目的；该内容会写入版本历史和审计日志。&quot;)"></textarea></fieldset>
        <div class="mt-4 flex flex-wrap justify-end gap-2"><button class="btn btn-ghost" :disabled="saving || !isDirty" @click="loadConfiguration()">{{ tr("放弃修改") }}</button><button class="btn btn-neutral" :disabled="saving || !isDirty" @click="saveConfiguration"><span v-if="saving" class="loading loading-spinner loading-sm"></span>{{ tr("发布配置") }}</button></div>
      </section>
    </div>
  </div>
</template>
