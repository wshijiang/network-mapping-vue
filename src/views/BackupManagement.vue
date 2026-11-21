<script setup>
import { tr } from '../i18n/index.js'

import { formatDateTime as formatSystemDateTime } from '../i18n/time.js'
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import http from '@/utils/http'

const formFieldId = useId()
const confirmDialog = ref(null)
const alerts = ref([])
const summary = ref({
  enabled: false,
  available: false,
  stanza: '',
  executionMode: 'direct',
  runAsUser: null,
  operationRunning: false,
  stanzas: []
})
const jobs = ref([])
const loading = ref(false)
const submitting = ref(false)
const initialLoadFailed = ref(false)
const backupDialog = ref(null)
const logDialog = ref(null)
const guideDialog = ref(null)
const selectedJob = ref(null)
const jobDetailLoading = ref(false)
const form = ref({ type: 'incr', remark: '' })
let pollTimer

const backupTypeInfo = {
  full: { get label() { return tr("全量") }, class: 'badge-primary' },
  diff: { get label() { return tr("差异") }, class: 'badge-secondary' },
  incr: { get label() { return tr("增量") }, class: 'badge-accent' },
  check: { get label() { return tr("归档检查") }, class: 'badge-info' }
}

const jobStatusInfo = {
  queued: { get label() { return tr("等待执行") }, class: 'badge-ghost' },
  running: { get label() { return tr("执行中") }, class: 'badge-info' },
  succeeded: { get label() { return tr("成功") }, class: 'badge-success' },
  failed: { get label() { return tr("失败") }, class: 'badge-error' }
}

const backupTypeDescriptions = {
  get full() { return tr("读取完整数据库集群并建立新的备份基线，耗时和占用空间最大。首次部署、仓库重建或重大数据变更前优先选择。") },
  get diff() { return tr("保存相对最近一次全量备份发生的变化，空间和耗时通常介于全量与增量之间，恢复链路较短。") },
  get incr() { return tr("保存相对最近一次成功备份发生的变化，适合发布前和缩短备份间隔，但恢复依赖的备份链更长。") }
}

const stanzaStatusLabels = {
  get 0() { return tr("正常") },
  get 1() { return tr("Stanza 路径不存在") },
  get 2() { return tr("没有有效备份") },
  get 3() { return tr("Stanza 元数据缺失") },
  get 4() { return tr("多仓库状态不一致") },
  get 5() { return tr("数据库身份不匹配") },
  get 6() { return tr("指定备份不存在") },
  get 99() { return tr("仓库或权限错误") }
}

const backupSets = computed(() => {
  const items = []
  for (const stanza of summary.value.stanzas || []) {
    for (const backup of stanza.backup || []) {
      items.push({ ...backup, stanza: stanza.name })
    }
  }
  return items.sort((left, right) => backupStop(right) - backupStop(left))
})

const latestBackup = computed(() => backupSets.value[0] || null)
const failedJobs = computed(() => jobs.value.filter((job) => job.status === 'failed').length)
const activeJob = computed(() => jobs.value.find((job) => ['queued', 'running'].includes(job.status)))
const targetStanza = computed(() => (
  (summary.value.stanzas || []).find((stanza) => stanza.name === summary.value.stanza)
  || summary.value.stanzas?.[0]
  || null
))
const stanzaStatusCode = computed(() => {
  const value = Number(targetStanza.value?.status?.code)
  return Number.isFinite(value) ? value : null
})
const stanzaHealthy = computed(() => summary.value.available && stanzaStatusCode.value === 0)
const executorText = computed(() => (
  summary.value.executionMode === 'sudo' && summary.value.runAsUser
    ? `sudo → ${summary.value.runAsUser}`
    : tr("服务账户直接执行")
))
const stanzaStatusText = computed(() => {
  if (!summary.value.enabled) return tr("管理功能未启用")
  if (!summary.value.available) return tr("无法运行 info 命令")
  if (stanzaStatusCode.value === null) return tr("未返回 Stanza 状态")
  return stanzaStatusLabels[stanzaStatusCode.value]
    || targetStanza.value?.status?.message
    || tr("未知状态 {0}", [stanzaStatusCode.value])
})
const selectedBackupDescription = computed(() => backupTypeDescriptions[form.value.type] || '')

function pushAlert(type, title, description = '', timeout = 7000) {
  alerts.value.unshift({ id: crypto.randomUUID(), type, title, description, timeout })
}

function closeAlert(id) {
  alerts.value = alerts.value.filter((alert) => alert.id !== id)
}

function apiMessage(error, fallback) {
  if (error?.response?.status === 403) return tr("仅管理员可以执行此操作。")
  if (error?.response?.status === 409) return error.response.data?.message || tr("已有任务正在运行。")
  return error?.response?.data?.message || fallback
}

function backupStop(backup) {
  return Number(backup?.timestamp?.stop || backup?.timestamp?.start || 0)
}

function formatEpoch(value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return '--'
  return formatSystemDateTime(new Date(seconds * 1000))
}

function formatTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '--' : formatSystemDateTime(date)
}

function formatBytes(value) {
  let bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return '--'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let unit = 0
  while (bytes >= 1024 && unit < units.length - 1) {
    bytes /= 1024
    unit += 1
  }
  return `${bytes.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function backupSize(backup) {
  return backup?.info?.repository?.size ?? backup?.info?.size
}

function backupType(value) {
  return backupTypeInfo[value] || { label: value || tr("未知"), class: 'badge-ghost' }
}

function jobStatus(value) {
  return jobStatusInfo[value] || { label: value || tr("未知"), class: 'badge-ghost' }
}

async function loadData({ silent = false } = {}) {
  if (loading.value) return
  loading.value = true
  try {
    const [summaryResponse, jobsResponse] = await Promise.all([
      http.get('/api/admin/backups/summary'),
      http.get('/api/admin/backups/jobs', { params: { page: 1, page_size: 20 } })
    ])
    summary.value = summaryResponse.data || summary.value
    jobs.value = jobsResponse.data?.items || []
    initialLoadFailed.value = false
  } catch (error) {
    console.error('load backup management data failed', error)
    initialLoadFailed.value = true
    if (!silent) pushAlert('error', tr("备份信息加载失败"), apiMessage(error, tr("请检查服务器和数据库状态。")))
  } finally {
    loading.value = false
  }
}

function openBackupDialog(type = 'incr') {
  form.value = { type, remark: '' }
  backupDialog.value?.showModal()
}

function openGuide() {
  guideDialog.value?.showModal()
}

async function submitBackup() {
  if (submitting.value) return
  submitting.value = true
  try {
    await http.post('/api/admin/backups/jobs', {
      type: form.value.type,
      remark: form.value.remark.trim() || null
    })
    backupDialog.value?.close()
    pushAlert('success', tr("备份任务已提交"), tr("任务正在后台执行，可以在任务记录中查看进度。"), 5000)
    await loadData({ silent: true })
  } catch (error) {
    console.error('submit backup failed', error)
    pushAlert('error', tr("备份任务提交失败"), apiMessage(error, tr("请稍后重试。")))
  } finally {
    submitting.value = false
  }
}

async function runCheck() {
  if (submitting.value || !await confirmDialog.value.ask({ message: tr("执行 pgBackRest 检查并验证 WAL 归档链路吗？"), confirmText: tr("确认执行") })) return
  submitting.value = true
  try {
    await http.post('/api/admin/backups/check')
    pushAlert('success', tr("检查任务已提交"), tr("检查结果将显示在任务记录中。"), 5000)
    await loadData({ silent: true })
  } catch (error) {
    console.error('submit backup check failed', error)
    pushAlert('error', tr("检查任务提交失败"), apiMessage(error, tr("请稍后重试。")))
  } finally {
    submitting.value = false
  }
}

async function openJobDetail(job) {
  selectedJob.value = job
  jobDetailLoading.value = true
  logDialog.value?.showModal()
  try {
    const response = await http.get(`/api/admin/backups/jobs/${job.id}`)
    selectedJob.value = response.data?.data || job
  } catch (error) {
    console.error('load backup job detail failed', error)
    pushAlert('error', tr("任务日志加载失败"), apiMessage(error, tr("请稍后重试。")))
  } finally {
    jobDetailLoading.value = false
  }
}

onMounted(async () => {
  await loadData()
  pollTimer = window.setInterval(() => loadData({ silent: true }), 10000)
})

onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer)
})
</script>

<template>
  <div class="pointer-events-none fixed right-4 top-20 z-50 flex w-[calc(100vw-2rem)] flex-col items-end gap-2 sm:w-auto">
    <AppAlert v-for="alert in alerts" :key="alert.id" class="pointer-events-auto" v-bind="alert" @close="closeAlert(alert.id)" />
  </div>

  <main class="page-shell">
    <ConfirmDialog ref="confirmDialog" />
    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 class="page-title">{{ tr("数据备份") }}</h1>
        <p class="mt-1 text-sm text-base-content/60">{{ tr("管理 pgBackRest 备份集、手动任务和 WAL 归档检查。") }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-ghost btn-sm" @click="openGuide">{{ tr("使用指南") }}</button>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadData()">
          <span v-if="loading" class="loading loading-spinner loading-xs"></span> {{ tr("刷新") }} </button>
        <button class="btn btn-outline btn-sm" :disabled="!summary.enabled || submitting || summary.operationRunning" @click="runCheck">{{ tr("运行检查") }}</button>
        <button class="btn btn-neutral btn-sm" :disabled="!summary.enabled || submitting || summary.operationRunning" @click="openBackupDialog()">{{ tr("立即备份") }}</button>
      </div>
    </div>

    <EmptyState
      v-if="initialLoadFailed"
      type="error"
      :title="tr(&quot;加载数据失败&quot;)"
      :message="tr(&quot;无法读取备份状态，请检查网络连接和服务器运行状态。&quot;)"
    />

    <template v-else>
      <div v-if="!summary.enabled" role="alert" class="alert alert-warning mb-4">
        <span>{{ tr("pgBackRest Web 管理功能尚未启用。请先完成 stanza 初始化和服务端 `[backup]` 配置。") }}</span>
      </div>
      <div v-else-if="!summary.available" role="alert" class="alert alert-error mb-4">
        <span>{{ tr("无法读取 pgBackRest 状态：") }}{{ summary.message || tr("请检查二进制路径、配置文件和运行账户权限。") }}</span>
      </div>
      <div v-else-if="!stanzaHealthy" role="alert" class="alert alert-warning mb-4">
        <div>
          <div class="font-medium">{{ tr("Stanza 当前状态：") }}{{ stanzaStatusText }}</div>
          <div class="text-sm opacity-75">{{ tr("info 命令可以运行，但仓库状态码为") }} {{ stanzaStatusCode ?? tr("未知") }}{{ tr("。请打开“使用指南”查看状态码说明和处理步骤。") }}</div>
        </div>
      </div>

      <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div class="stat rounded-box border border-base-300 bg-base-100 shadow-sm">
          <div class="stat-title">Stanza</div>
          <div class="stat-value truncate text-xl">{{ summary.stanza || '--' }}</div>
          <div class="stat-desc">{{ stanzaStatusText }}<span v-if="stanzaStatusCode !== null">{{ tr("（代码") }} {{ stanzaStatusCode }}）</span> · {{ executorText }}</div>
        </div>
        <div class="stat rounded-box border border-base-300 bg-base-100 shadow-sm">
          <div class="stat-title">{{ tr("最近成功备份") }}</div>
          <div class="stat-value text-lg">{{ latestBackup ? backupType(latestBackup.type).label : '--' }}</div>
          <div class="stat-desc">{{ latestBackup ? formatEpoch(backupStop(latestBackup)) : tr("暂无备份集") }}</div>
        </div>
        <div class="stat rounded-box border border-base-300 bg-base-100 shadow-sm">
          <div class="stat-title">{{ tr("可用备份集") }}</div>
          <div class="stat-value text-2xl">{{ backupSets.length }}</div>
          <div class="stat-desc">{{ tr("来自 pgBackRest 仓库元数据") }}</div>
        </div>
        <div class="stat rounded-box border border-base-300 bg-base-100 shadow-sm">
          <div class="stat-title">{{ tr("任务状态") }}</div>
          <div class="stat-value text-lg">{{ activeJob ? tr("执行中") : tr("空闲") }}</div>
          <div class="stat-desc">{{ tr("最近 20 条中失败") }} {{ failedJobs }} {{ tr("条") }}</div>
        </div>
      </section>

      <section class="mt-5 rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 class="font-semibold">{{ tr("快速使用流程") }}</h2>
            <p class="mt-1 text-xs text-base-content/55">{{ tr("首次使用请按顺序完成，成功执行命令不等于已经验证可恢复。") }}</p>
          </div>
          <button type="button" class="btn btn-link btn-sm btn-neutral h-auto min-h-0 px-0" @click="openGuide">{{ tr("查看完整部署、操作与排障指南") }}</button>
        </div>
        <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div class="rounded-box bg-base-200 p-3">
            <div class="flex items-center gap-2"><span class="badge badge-neutral badge-sm">1</span><span class="font-medium">{{ tr("确认基础状态") }}</span></div>
            <p class="mt-2 text-sm text-base-content/65">{{ tr("Stanza 状态码应为 0；首次部署没有备份时可能为 2。") }}</p>
          </div>
          <div class="rounded-box bg-base-200 p-3">
            <div class="flex items-center gap-2"><span class="badge badge-neutral badge-sm">2</span><span class="font-medium">{{ tr("运行归档检查") }}</span></div>
            <p class="mt-2 text-sm text-base-content/65">{{ tr("验证数据目录、数据库身份、配置和 WAL 是否能到达仓库。") }}</p>
          </div>
          <div class="rounded-box bg-base-200 p-3">
            <div class="flex items-center gap-2"><span class="badge badge-neutral badge-sm">3</span><span class="font-medium">{{ tr("创建备份") }}</span></div>
            <p class="mt-2 text-sm text-base-content/65">{{ tr("首次先做全量；日常按变更规模选择差异或增量并填写备注。") }}</p>
          </div>
          <div class="rounded-box bg-base-200 p-3">
            <div class="flex items-center gap-2"><span class="badge badge-neutral badge-sm">4</span><span class="font-medium">{{ tr("核对并演练恢复") }}</span></div>
            <p class="mt-2 text-sm text-base-content/65">{{ tr("确认新标签、任务日志和 timer，并在隔离环境定期恢复。") }}</p>
          </div>
        </div>
      </section>

      <section class="mt-5 overflow-hidden rounded-box border border-base-300 bg-base-100">
        <div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
          <div>
            <h2 class="font-semibold">{{ tr("备份集") }}</h2>
            <p class="text-xs text-base-content/55">{{ tr("定时和手动生成的真实仓库备份。") }}</p>
          </div>
        </div>
        <div v-if="loading && !backupSets.length" class="p-5"><div class="skeleton h-48 w-full"></div></div>
        <EmptyState v-else-if="backupSets.length === 0" :title="tr(&quot;暂无备份集&quot;)" :message="tr(&quot;完成第一次全量备份后，备份集会显示在这里。&quot;)" />
        <div v-else class="overflow-x-auto">
          <table class="table table-zebra">
            <thead><tr><th>{{ tr("标签") }}</th><th>{{ tr("类型") }}</th><th>{{ tr("完成时间") }}</th><th>{{ tr("仓库大小") }}</th><th>{{ tr("数据库 ID") }}</th></tr></thead>
            <tbody>
              <tr v-for="backup in backupSets" :key="`${backup.stanza}-${backup.label}`">
                <td class="font-mono text-xs">{{ backup.label }}</td>
                <td><span class="badge badge-sm" :class="backupType(backup.type).class">{{ backupType(backup.type).label }}</span></td>
                <td>{{ formatEpoch(backupStop(backup)) }}</td>
                <td>{{ formatBytes(backupSize(backup)) }}</td>
                <td>{{ backup.database?.id ?? '--' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="mt-5 overflow-hidden rounded-box border border-base-300 bg-base-100">
        <div class="border-b border-base-300 px-4 py-3">
          <h2 class="font-semibold">{{ tr("手动任务") }}</h2>
          <p class="text-xs text-base-content/55">{{ tr("页面提交的备份和检查操作；点击记录查看完整输出。") }}</p>
        </div>
        <EmptyState v-if="jobs.length === 0" :title="tr(&quot;暂无手动任务&quot;)" :message="tr(&quot;可以运行一次检查或立即备份。&quot;)" />
        <div v-else class="overflow-x-auto">
          <table class="table table-zebra">
            <thead><tr><th>{{ tr("创建时间") }}</th><th>{{ tr("操作") }}</th><th>{{ tr("状态") }}</th><th>{{ tr("发起人") }}</th><th>{{ tr("耗时") }}</th><th></th></tr></thead>
            <tbody>
              <tr v-for="job in jobs" :key="job.id">
                <td>{{ formatTime(job.createdAt) }}</td>
                <td><span class="badge badge-sm" :class="backupType(job.operation).class">{{ backupType(job.operation).label }}</span></td>
                <td><span class="badge badge-sm" :class="jobStatus(job.status).class">{{ jobStatus(job.status).label }}</span></td>
                <td>{{ job.requestedByName || '--' }}</td>
                <td>{{ job.startedAt && job.finishedAt ? tr("{0} 秒", [Math.max(0, Math.round((new Date(job.finishedAt) - new Date(job.startedAt)) / 1000))]) : '--' }}</td>
                <td><button class="btn btn-ghost btn-xs" @click="openJobDetail(job)">{{ tr("查看日志") }}</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="mt-5 card border border-base-300 bg-base-100 shadow-sm">
        <div class="card-body p-4">
          <h2 class="font-semibold">{{ tr("默认定时策略") }}</h2>
          <div class="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div class="rounded-box bg-base-200 p-3"><div class="font-medium">{{ tr("全量") }}</div><div class="text-base-content/60">{{ tr("周日 02:10") }}</div></div>
            <div class="rounded-box bg-base-200 p-3"><div class="font-medium">{{ tr("差异") }}</div><div class="text-base-content/60">{{ tr("周一至周六 02:10") }}</div></div>
            <div class="rounded-box bg-base-200 p-3"><div class="font-medium">{{ tr("增量") }}</div><div class="text-base-content/60">{{ tr("每天 08:10 / 14:10 / 20:10") }}</div></div>
            <div class="rounded-box bg-base-200 p-3"><div class="font-medium">{{ tr("归档检查") }}</div><div class="text-base-content/60">{{ tr("每天 01:30") }}</div></div>
          </div>
          <p class="text-xs text-base-content/55">{{ tr("计划由服务器 systemd timer 独立执行；实际启用状态请在服务器上通过 systemctl list-timers 检查。") }}</p>
        </div>
      </section>
    </template>
  </main>

  <dialog ref="guideDialog" class="modal">
    <div class="modal-box max-h-[90vh] max-w-5xl overflow-y-auto p-0">
      <div class="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-base-300 bg-base-100 px-5 py-4">
        <div>
          <h2 class="text-xl font-semibold">{{ tr("pgBackRest 数据备份使用指南") }}</h2>
          <p class="mt-1 text-sm text-base-content/60">{{ tr("从首次启用、日常操作到错误排查和恢复演练。") }}</p>
        </div>
        <form method="dialog"><button class="btn btn-ghost btn-sm" :aria-label="tr(&quot;关闭使用指南&quot;)">{{ tr("关闭") }}</button></form>
      </div>

      <div class="space-y-4 p-5">
        <div role="alert" class="alert alert-warning">
          <div>
            <div class="font-medium">{{ tr("备份成功不等于可恢复") }}</div>
            <div class="text-sm opacity-75">{{ tr("必须定期在隔离环境执行真实恢复。当前页面不会执行恢复、删除备份或修改保留策略。") }}</div>
          </div>
        </div>

        <details class="collapse collapse-arrow rounded-lg bg-base-200/40" open>
          <summary class="collapse-title font-semibold">{{ tr("1. 首次启用前需要完成什么？") }}</summary>
          <div class="collapse-content space-y-3 text-sm text-base-content/75">
            <ol class="list-decimal space-y-2 pl-5">
              <li>{{ tr("在 PostgreSQL 主机安装 pgBackRest，并确认数据库版本、数据目录和端口。") }}</li>
              <li>{{ tr("创建独立备份仓库，限制目录和配置文件权限；仓库不能位于 PostgreSQL 数据目录内。") }}</li>
              <li>{{ tr("配置") }} <code class="rounded bg-base-200 px-1">archive_mode=on</code> {{ tr("和包含 pgBackRest 的") }} <code class="rounded bg-base-200 px-1">archive_command</code>。</li>
              <li>{{ tr("创建 stanza，运行检查并完成第一次全量备份。") }}</li>
              <li>{{ tr("启用服务端") }} <code class="rounded bg-base-200 px-1">[backup]</code> {{ tr("配置，重启服务后再安装 systemd timers。") }}</li>
            </ol>
            <pre class="overflow-x-auto rounded-box bg-neutral p-3 text-xs text-neutral-content"><code>sudo -u postgres pgbackrest --stanza={{ summary.stanza || 'network_mapping' }} stanza-create
sudo -u postgres pgbackrest --stanza={{ summary.stanza || 'network_mapping' }} check
sudo -u postgres pgbackrest --stanza={{ summary.stanza || 'network_mapping' }} --type=full backup
sudo -u postgres pgbackrest --stanza={{ summary.stanza || 'network_mapping' }} info</code></pre>
            <p>{{ tr("目标 stanza 的仓库目录必须为空。首次全量成功前不要启用差异或增量定时任务。") }}</p>
          </div>
        </details>

        <details class="collapse collapse-arrow rounded-lg bg-base-200/40">
          <summary class="collapse-title font-semibold">{{ tr("2. 如何安全地让 postgres 执行？") }}</summary>
          <div class="collapse-content space-y-3 text-sm text-base-content/75">
            <p>{{ tr("当 pgBackRest 必须以") }} <code class="rounded bg-base-200 px-1">postgres</code> {{ tr("运行时，不要把 Network Mapping 改成 root。请使用仓库提供的精确 sudoers 模板，让服务账户只能执行 info、check 和三种 backup 命令。") }}</p>
            <div role="note" class="rounded-box border border-base-300 bg-base-200 p-3">
              <div class="font-medium">{{ tr("当前后端执行方式：") }}{{ executorText }}</div>
              <div class="mt-1 text-xs">{{ tr("如果这里未显示“sudo → postgres”，说明服务端尚未启用 run_as_user 配置。") }}</div>
            </div>
            <ol class="list-decimal space-y-2 pl-5">
              <li>{{ tr("确认 systemd 的") }} <code class="rounded bg-base-200 px-1">User=network-mapping</code>、<code class="rounded bg-base-200 px-1">NoNewPrivileges=no</code>{{ tr("、sudo 和 pgBackRest 的实际绝对路径。如必须保留 NoNewPrivileges，需改用只暴露固定操作的本机代理。") }}</li>
              <li>{{ tr("在服务端") }} <code class="rounded bg-base-200 px-1">config.toml</code> {{ tr("的") }} <code class="rounded bg-base-200 px-1">[backup]</code> {{ tr("中固定执行账户和 sudo 路径。") }}</li>
            </ol>
            <pre class="overflow-x-auto rounded-box bg-neutral p-3 text-xs text-neutral-content"><code>run_as_user = "postgres"
sudo_binary = "/usr/bin/sudo"</code></pre>
            <ol start="3" class="list-decimal space-y-2 pl-5">
              <li>{{ tr("使用") }} <code class="rounded bg-base-200 px-1">visudo -cf</code> {{ tr("检查") }} <code class="rounded bg-base-200 px-1">deploy/sudoers/network-mapping-pgbackrest</code>{{ tr("，然后以 root:root、0440 安装到") }} <code class="rounded bg-base-200 px-1">/etc/sudoers.d/</code>。</li>
              <li>{{ tr("重启后端，刷新本页，确认显示“sudo → postgres”并能读取 stanza 状态。") }}</li>
              <li>{{ tr("除正向 info/check 测试外，必须验证更换 stanza、restore 和") }} <code class="rounded bg-base-200 px-1">/bin/sh</code> {{ tr("全部被 sudo 拒绝。") }}</li>
            </ol>
            <pre class="overflow-x-auto rounded-box bg-neutral p-3 text-xs text-neutral-content"><code># 正向：必须成功
sudo -u network-mapping sudo -n -u postgres -- \
  /usr/bin/pgbackrest --config=/etc/pgbackrest/pgbackrest.conf \
  --stanza={{ summary.stanza || 'network_mapping' }} --output=json info

# 反向：必须被拒绝
sudo -u network-mapping sudo -n -u postgres -- \
  /usr/bin/pgbackrest --config=/etc/pgbackrest/pgbackrest.conf \
  --stanza={{ summary.stanza || 'network_mapping' }} restore
sudo -u network-mapping sudo -n -u postgres -- /bin/sh -c id</code></pre>
            <p>{{ tr("不要授权无参数的") }} <code class="rounded bg-base-200 px-1">/usr/bin/pgbackrest</code>、<code class="rounded bg-base-200 px-1">pgbackrest *</code>{{ tr("、任意脚本或 shell。完整的可复制 sudoers 内容、安装命令和反向测试见项目文档") }} <code class="rounded bg-base-200 px-1">docs/PGBACKREST_BACKUP.md</code>。</p>
          </div>
        </details>

        <details class="collapse collapse-arrow rounded-lg bg-base-200/40">
          <summary class="collapse-title font-semibold">{{ tr("3. 如何判断页面状态？") }}</summary>
          <div class="collapse-content space-y-3 text-sm text-base-content/75">
            <p><strong>{{ tr("命令可用") }}</strong>{{ tr("只表示后端能运行并解析") }} <code>pgbackrest info --output=json</code>{{ tr("；还必须检查 stanza 自身的状态码。") }}</p>
            <div class="overflow-x-auto">
              <table class="table table-sm">
                <thead><tr><th>{{ tr("状态码") }}</th><th>{{ tr("含义") }}</th><th>{{ tr("建议") }}</th></tr></thead>
                <tbody>
                  <tr><td>0</td><td>{{ tr("正常") }}</td><td>{{ tr("继续核对最近备份时间和恢复演练") }}</td></tr>
                  <tr><td>1</td><td>{{ tr("Stanza 路径不存在") }}</td><td>{{ tr("检查仓库路径并执行 stanza-create") }}</td></tr>
                  <tr><td>2</td><td>{{ tr("没有有效备份") }}</td><td>{{ tr("执行第一次全量备份") }}</td></tr>
                  <tr><td>3</td><td>{{ tr("Stanza 元数据缺失") }}</td><td>{{ tr("检查仓库完整性、权限和初始化步骤") }}</td></tr>
                  <tr><td>4</td><td>{{ tr("多仓库状态不一致") }}</td><td>{{ tr("分别核对各仓库配置和可访问性") }}</td></tr>
                  <tr><td>5</td><td>{{ tr("数据库身份不匹配") }}</td><td>{{ tr("停止写入并确认 pg1-path 指向正确实例") }}</td></tr>
                  <tr><td>6</td><td>{{ tr("指定备份不存在") }}</td><td>{{ tr("核对备份标签和仓库") }}</td></tr>
                  <tr><td>99</td><td>{{ tr("其他仓库错误") }}</td><td>{{ tr("检查网络、对象存储、权限和详细日志") }}</td></tr>
                </tbody>
              </table>
            </div>
            <p>{{ tr("当前页面状态：") }}<span class="font-medium">{{ stanzaStatusText }}</span><span v-if="stanzaStatusCode !== null">{{ tr("（代码") }} {{ stanzaStatusCode }}）</span>。</p>
          </div>
        </details>

        <details class="collapse collapse-arrow rounded-lg bg-base-200/40">
          <summary class="collapse-title font-semibold">{{ tr("4. 全量、差异和增量怎样选择？") }}</summary>
          <div class="collapse-content space-y-3 text-sm text-base-content/75">
            <div class="grid gap-3 md:grid-cols-3">
              <div class="rounded-box bg-base-200 p-3"><div class="font-semibold text-base-content">{{ tr("全量 full") }}</div><p class="mt-1">{{ tr("完整读取集群并建立新基线。用于首次部署、仓库重建、重大数据迁移或 PostgreSQL 大版本切换后。") }}</p></div>
              <div class="rounded-box bg-base-200 p-3"><div class="font-semibold text-secondary">{{ tr("差异 diff") }}</div><p class="mt-1">{{ tr("保存相对最近全量的变化。适合日常备份和希望缩短恢复链路的场景。") }}</p></div>
              <div class="rounded-box bg-base-200 p-3"><div class="font-semibold text-accent">{{ tr("增量 incr") }}</div><p class="mt-1">{{ tr("保存相对最近一次备份的变化。适合发布前和较短备份周期，单次开销较小但恢复链更长。") }}</p></div>
            </div>
            <ol class="list-decimal space-y-2 pl-5">
              <li>{{ tr("点击“立即备份”，按场景选择类型。") }}</li>
              <li>{{ tr("备注填写发布版本、工单号或变更原因，避免只写“测试”。") }}</li>
              <li>{{ tr("提交后等待任务由“等待执行”进入“执行中”，不要重复点击。") }}</li>
              <li>{{ tr("任务成功后刷新，确认备份集出现新标签和合理的完成时间。") }}</li>
              <li>{{ tr("任务失败时打开日志，先查看 stderr 最后部分，再检查服务器 pgBackRest 日志。") }}</li>
            </ol>
          </div>
        </details>

        <details class="collapse collapse-arrow rounded-lg bg-base-200/40">
          <summary class="collapse-title font-semibold">{{ tr("5. “运行检查”会做什么？") }}</summary>
          <div class="collapse-content space-y-2 text-sm text-base-content/75">
            <p>{{ tr("检查任务不会创建备份。它会核对 stanza、数据目录、数据库身份、归档配置，并通过 WAL 切换确认归档文件能到达仓库。") }}</p>
            <p>{{ tr("首次部署、修改 PostgreSQL/pgBackRest 配置、更换仓库或凭据、调整网络策略、发现归档超时后都应运行检查。") }}</p>
            <p>{{ tr("检查成功只代表当前链路正常，不能替代仓库校验和隔离恢复演练。") }}</p>
          </div>
        </details>

        <details class="collapse collapse-arrow rounded-lg bg-base-200/40">
          <summary class="collapse-title font-semibold">{{ tr("6. 定时任务在哪里运行？") }}</summary>
          <div class="collapse-content space-y-3 text-sm text-base-content/75">
            <p>{{ tr("定时任务由数据库主机上的 systemd timer 直接运行，不依赖 Network Mapping Web 服务。页面当前只展示仓库结果，不在线修改 timer。") }}</p>
            <div class="overflow-x-auto">
              <table class="table table-sm">
                <thead><tr><th>{{ tr("任务") }}</th><th>{{ tr("模板默认时间") }}</th></tr></thead>
                <tbody>
                  <tr><td>{{ tr("全量") }}</td><td>{{ tr("周日 02:10") }}</td></tr>
                  <tr><td>{{ tr("差异") }}</td><td>{{ tr("周一至周六 02:10") }}</td></tr>
                  <tr><td>{{ tr("增量") }}</td><td>{{ tr("每天 08:10、14:10、20:10") }}</td></tr>
                  <tr><td>{{ tr("归档检查") }}</td><td>{{ tr("每天 01:30") }}</td></tr>
                </tbody>
              </table>
            </div>
            <pre class="overflow-x-auto rounded-box bg-neutral p-3 text-xs text-neutral-content"><code>systemctl list-timers 'pgbackrest-*'
systemctl status pgbackrest-backup-full.timer
journalctl -u pgbackrest-backup@full.service -n 100 --no-pager</code></pre>
            <p>{{ tr("systemd 任务不会出现在“手动任务”表，但成功后一定应在“备份集”中出现新标签。") }}</p>
          </div>
        </details>

        <details class="collapse collapse-arrow rounded-lg bg-base-200/40">
          <summary class="collapse-title font-semibold">{{ tr("7. 常见错误怎样处理？") }}</summary>
          <div class="collapse-content space-y-3 text-sm text-base-content/75">
            <div class="space-y-2">
              <p><strong>{{ tr("管理功能未启用：") }}</strong>{{ tr("确认服务实际使用的 config.toml 中") }} <code>[backup].enabled=true</code>{{ tr("，然后重启服务。") }}</p>
              <p><strong>{{ tr("sudo 要求密码或拒绝：") }}</strong>{{ tr("确认页面显示的执行方式为“sudo → postgres”，再用上一节的精确 info 命令以服务账户测试。检查 sudoers 中账户、路径、参数顺序、config 和 stanza 是否与服务配置完全一致。") }}</p>
              <p><strong>{{ tr("pgBackRest 权限错误：") }}</strong>{{ tr("如果 sudo 已通过但 pgBackRest 仍报错，再检查 postgres 对配置文件、数据目录、spool、日志和仓库的访问权限。") }}</p>
              <p><strong>archive timeout：</strong>{{ tr("检查 PostgreSQL 实际 archive_mode/archive_command、数据库日志、archive-push 日志、spool 权限和对象存储网络。") }}</p>
              <p><strong>HTTP 409：</strong>{{ tr("已有手动任务运行。等待结束并刷新，同时确认操作系统中没有其他 pgBackRest 或 systemd 任务。") }}</p>
              <p><strong>{{ tr("长时间执行：") }}</strong>{{ tr("查看任务日志、pgBackRest 文件日志和 systemd journal，确认仓库 I/O、数据库负载和网络；不要直接删除锁文件。") }}</p>
              <p><strong>{{ tr("Web 日志被截断：") }}</strong>{{ tr("页面日志受 max_output_bytes 限制，完整内容在 pgBackRest log-path 或 journal 中。") }}</p>
            </div>
          </div>
        </details>

        <details class="collapse collapse-arrow rounded-lg bg-base-200/40">
          <summary class="collapse-title font-semibold">{{ tr("8. 恢复和安全边界") }}</summary>
          <div class="collapse-content space-y-2 text-sm text-base-content/75">
            <ul class="list-disc space-y-2 pl-5">
              <li>{{ tr("恢复只能在停止 PostgreSQL、目标数据目录为空且权限正确的隔离环境进行。") }}</li>
              <li>{{ tr("指定时间点恢复必须包含明确时区，并确保备份和 WAL 覆盖目标时间。") }}</li>
              <li>{{ tr("不要把恢复测试的 pg1-path、端口或应用配置指向生产环境。") }}</li>
              <li>{{ tr("不要在 Git、页面、systemd unit 或任务备注中填写仓库密钥。") }}</li>
              <li>{{ tr("不要通过放宽为 root 或授权任意 sudo 来修复权限问题。") }}</li>
              <li>{{ tr("至少每季度恢复一次，并记录恢复时间点、业务校验结果和实际 RTO。") }}</li>
            </ul>
            <a class="link link-neutral inline-block" href="https://pgbackrest.org/user-guide.html" target="_blank" rel="noopener noreferrer">{{ tr("查看 pgBackRest 官方用户指南") }}</a>
          </div>
        </details>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop"><button>{{ tr("关闭使用指南") }}</button></form>
  </dialog>

  <dialog ref="backupDialog" class="modal">
    <div class="modal-box">
      <h3 class="text-lg font-semibold">{{ tr("立即备份") }}</h3>
      <p class="mt-1 text-sm text-base-content/60">{{ tr("任务提交后会在后台运行，同一时间只允许一个备份或检查任务。") }}</p>
      <div class="mt-5 space-y-4">
        <fieldset class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label :for="`${formFieldId}-1`">{{ tr("备份类型") }}</label></legend>
          <select :id="`${formFieldId}-1`" v-model="form.type" class="select select-bordered w-full">
            <option value="incr">{{ tr("增量备份") }}</option>
            <option value="diff">{{ tr("差异备份") }}</option>
            <option value="full">{{ tr("全量备份") }}</option>
          </select>
        </fieldset>
        <div role="note" class="rounded-box border border-base-300 bg-base-200 p-3 text-sm text-base-content/70">
          {{ selectedBackupDescription }}
        </div>
        <fieldset class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label for="backupmanagement-form-remark">{{ tr("操作备注") }}</label></legend>
          <textarea id="backupmanagement-form-remark" v-model="form.remark" maxlength="500" class="textarea textarea-bordered min-h-24 w-full" :placeholder="tr(&quot;例如：版本发布前备份&quot;)"></textarea>
        </fieldset>
      </div>
      <div class="modal-action">
        <form method="dialog"><button class="btn btn-ghost" :disabled="submitting">{{ tr("取消") }}</button></form>
        <button class="btn btn-neutral" :disabled="submitting" @click="submitBackup">
          <span v-if="submitting" class="loading loading-spinner loading-sm"></span> {{ tr("确认执行") }} </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop"><button>{{ tr("关闭") }}</button></form>
  </dialog>

  <dialog ref="logDialog" class="modal">
    <div class="modal-box max-w-4xl">
      <h3 class="text-lg font-semibold">{{ tr("任务日志") }}</h3>
      <div v-if="jobDetailLoading" class="mt-4"><div class="skeleton h-64 w-full"></div></div>
      <div v-else-if="selectedJob" class="mt-4 space-y-4">
        <div class="grid gap-2 text-sm sm:grid-cols-3">
          <div><span class="text-base-content/55">{{ tr("任务 ID") }}</span><div class="break-all font-mono text-xs">{{ selectedJob.id }}</div></div>
          <div><span class="text-base-content/55">{{ tr("状态") }}</span><div>{{ jobStatus(selectedJob.status).label }}</div></div>
          <div><span class="text-base-content/55">{{ tr("退出码") }}</span><div>{{ selectedJob.exitCode ?? '--' }}</div></div>
        </div>
        <div>
          <div class="mb-1 text-sm font-medium">{{ tr("标准输出") }}</div>
          <pre class="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-box bg-neutral p-3 text-xs text-neutral-content">{{ selectedJob.stdout || '无输出' }}</pre>
        </div>
        <div>
          <div class="mb-1 text-sm font-medium">{{ tr("错误输出") }}</div>
          <pre class="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-box bg-neutral p-3 text-xs text-neutral-content">{{ selectedJob.stderr || '无输出' }}</pre>
        </div>
      </div>
      <div class="modal-action"><form method="dialog"><button class="btn">{{ tr("关闭") }}</button></form></div>
    </div>
    <form method="dialog" class="modal-backdrop"><button>{{ tr("关闭") }}</button></form>
  </dialog>
</template>
