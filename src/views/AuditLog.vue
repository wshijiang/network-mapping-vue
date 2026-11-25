<script setup>
import { tr } from '../i18n/index.js'

import { formatDateTime as formatSystemDateTime, localToIso } from '../i18n/time.js'
import { computed, inject, onMounted, ref } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import EmptyState from '@/components/EmptyState.vue'
import http from '@/utils/http'
import AccessVerification from '@/components/AccessVerification.vue'

const verification = ref(null)
const access = inject('access')

const alerts = ref([])
const events = ref([])
const loading = ref(false)
const exporting = ref(false)
const initialLoadFailed = ref(false)
const hasLoadedEvents = ref(false)
const selectedEvent = ref(null)
const page = ref(1)
const pageSize = 25
const total = ref(0)

const filters = ref({
  keyword: '',
  category: '',
  outcome: '',
  request_id: '',
  start: '',
  end: ''
})

const categoryLabels = {
  get authentication() { return tr("身份认证") },
  get authorization() { return tr("权限控制") },
  get user_security() { return tr("用户安全") },
  get task() { return tr("扫描任务") },
  get scanner() { return tr("扫描器") },
  get automatic_target() { return tr("系统生成目标") },
  get configuration() { return tr("系统配置") },
  get data_access() { return tr("数据访问") },
  get backup() { return tr("数据备份") },
  get audit() { return tr("审计系统") }
}

const actionLabels = {
  get 'auth.login'() { return tr("用户登录") },
  get 'auth.password_verify'() { return tr("密码验证") },
  get 'auth.logout'() { return tr("退出登录") },
  get 'auth.totp_verify'() { return tr("双因素验证") },
  get 'user.password_change'() { return tr("修改密码") },
  get 'user.totp_bind'() { return tr("绑定双因素认证") },
  get 'user.totp_unbind'() { return tr("解绑双因素认证") },
  get 'user.create'() { return tr("创建用户") },
  get 'user.enable'() { return tr("启用用户") },
  get 'user.disable'() { return tr("禁用用户") },
  get 'user.kick'() { return tr("踢出用户") },
  get 'user.delete'() { return tr("删除用户") },
  get 'user.login_records.query'() { return tr("查询登录记录") },
  get 'task.create'() { return tr("创建任务") },
  get 'task.create_dns'() { return tr("创建 DNS 任务") },
  get 'task.auto_generate'() { return tr("生成系统目标") },
  get 'task.cancel'() { return tr("取消任务") },
  get 'task.retry'() { return tr("重试任务") },
  get 'scanner.create'() { return tr("创建扫描器") },
  get 'scanner.register'() { return tr("注册扫描器") },
  get 'scanner.update'() { return tr("更新扫描器") },
  get 'scanner.enable'() { return tr("启用扫描器") },
  get 'scanner.disable'() { return tr("禁用扫描器") },
  get 'scanner.token.reissue'() { return tr("重发扫描器令牌") },
  get 'scanner.delete'() { return tr("删除扫描器") },
  get 'backup.job.create'() { return tr("提交备份任务") },
  get 'backup.job.complete'() { return tr("备份任务完成") },
  get 'backup.run'() { return tr("执行数据备份") },
  get 'backup.check'() { return tr("执行归档检查") },
  get 'audit.query'() { return tr("查询审计日志") },
  get 'audit.export'() { return tr("导出审计日志") }
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

function pushAlert(type, title, description = '', timeout = 7000) {
  alerts.value.unshift({
    id: crypto.randomUUID(),
    type,
    title,
    description,
    timeout
  })
}

function closeAlert(id) {
  alerts.value = alerts.value.filter((alert) => alert.id !== id)
}

function formatTime(value) {
  if (!value) return '--'
  return formatSystemDateTime(new Date(value))
}

function resultClass(outcome) {
  if (outcome === 'success') return 'badge-success'
  if (outcome === 'denied') return 'badge-warning'
  return 'badge-error'
}

function resultLabel(outcome) {
  return { get success() { return tr("成功") }, get failure() { return tr("失败") }, get denied() { return tr("拒绝") } }[outcome] || outcome
}

function actorLabel(event) {
  if (event.actor_name) return event.actor_name
  if (event.actor_id) return `${event.actor_type}:${event.actor_id}`
  return event.actor_type === 'anonymous' ? tr("匿名访问") : event.actor_type
}

function resourceLabel(event) {
  if (!event.resource_type && !event.resource_id) return '--'
  return [event.resource_type, event.resource_id].filter(Boolean).join(' / ')
}

function buildParams(includePagination = true) {
  const params = {}
  for (const key of ['keyword', 'category', 'outcome', 'request_id']) {
    if (filters.value[key]) params[key] = filters.value[key]
  }
  if (filters.value.start) params.start = localToIso(filters.value.start)
  if (filters.value.end) params.end = localToIso(filters.value.end)
  if (includePagination) {
    params.page = page.value
    params.page_size = pageSize
  }
  return params
}

async function loadEvents() {
  loading.value = true
  try {
    const response = await http.get('/api/audit/events', { params: buildParams() })
    events.value = response.data?.items || []
    total.value = Number(response.data?.pagination?.total) || 0
    initialLoadFailed.value = false
    hasLoadedEvents.value = true
  } catch (error) {
    console.error('load audit events failed', error)
    if (!hasLoadedEvents.value) {
      events.value = []
      total.value = 0
      initialLoadFailed.value = true
    }
    if (error.response?.status === 403) {
      pushAlert('error', tr("审计日志加载失败"), tr("只有管理员可以查看审计日志。"))
    } else {
      pushAlert('error', tr("审计日志加载失败"), error.response?.data?.message || error.message || tr("请检查网络连接或服务器运行状态。"))
    }
  } finally {
    loading.value = false
  }
}

function applyFilters() {
  page.value = 1
  loadEvents()
}

function resetFilters() {
  filters.value = { keyword: '', category: '', outcome: '', request_id: '', start: '', end: '' }
  page.value = 1
  loadEvents()
}

function filterByRequestId(id) {
  if (!id) return
  filters.value.request_id = id
  selectedEvent.value = null
  page.value = 1
  loadEvents()
}

function changePage(nextPage) {
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value) return
  page.value = nextPage
  loadEvents()
}

async function exportCsv() {
  exporting.value = true
  try {
    const download = () => http.post('/api/audit/export', null, { params: buildParams(false), responseType: 'blob' })
    let response
    try {
      response = await download()
    } catch (failure) {
      const error = failure.response?.data instanceof Blob
        ? JSON.parse(await failure.response.data.text()).error
        : failure.response?.data?.error
      if (error?.code !== 'step_up_required') throw failure
      if (!await verification.value.verify()) return
      response = await download()
    }
    const url = URL.createObjectURL(response.data)
    const link = document.createElement('a')
    link.href = url
    link.download = `network-mapping-audit-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('export audit events failed', error)
    pushAlert(
      'error',
      tr("审计日志导出失败"),
      error.response?.status === 403
        ? tr("当前账号未获授予导出审计日志的权限。")
        : tr("请检查网络连接或服务器运行状态。")
    )
  } finally {
    exporting.value = false
  }
}

function formattedJson(value) {
  if (!value || (typeof value === 'object' && Object.keys(value).length === 0)) return '--'
  return JSON.stringify(value, null, 2)
}

onMounted(loadEvents)
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

  <main class="page-shell">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="page-title">{{ tr("审计日志") }}</h1>
        <p class="mt-1 text-sm text-base-content/60">{{ tr("追踪关键身份认证、任务和扫描器管理操作。") }}</p>
      </div>
      <button v-if="access?.export_audit" class="btn btn-outline btn-sm" :disabled="exporting || loading" @click="exportCsv">
        {{ exporting ? tr("导出中…") : tr("导出 CSV") }}
      </button>
    </div>

    <div class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body gap-4 p-4">
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <input v-model.trim="filters.keyword" class="input input-bordered w-full xl:col-span-2" :placeholder="tr(&quot;动作、操作者或资源 ID&quot;)" @keyup.enter="applyFilters" />
          <select v-model="filters.category" class="select select-bordered w-full">
            <option value="">{{ tr("全部分类") }}</option>
            <option v-for="(label, value) in categoryLabels" :key="value" :value="value">{{ label }}</option>
          </select>
          <select v-model="filters.outcome" class="select select-bordered w-full">
            <option value="">{{ tr("全部结果") }}</option>
            <option value="success">{{ tr("成功") }}</option>
            <option value="failure">{{ tr("失败") }}</option>
            <option value="denied">{{ tr("拒绝") }}</option>
          </select>
          <SystemDateTimeInput v-model="filters.start" class="input input-bordered w-full" :aria-label="tr(&quot;开始时间&quot;)" />
          <SystemDateTimeInput v-model="filters.end" class="input input-bordered w-full" :aria-label="tr(&quot;结束时间&quot;)" />
          <input v-model.trim="filters.request_id" class="input input-bordered w-full" :placeholder="tr(&quot;请求 ID (UUID)&quot;)" @keyup.enter="applyFilters" />
        </div>
        <div class="flex justify-end gap-2">
          <button class="btn btn-ghost btn-sm" :disabled="loading" @click="resetFilters">{{ tr("重置") }}</button>
          <button class="btn btn-neutral btn-sm" :disabled="loading" @click="applyFilters">{{ tr("查询") }}</button>
        </div>
      </div>
    </div>

    <div class="mt-4 overflow-hidden rounded-box border border-base-300 bg-base-100">
      <div v-if="loading" class="space-y-3 p-5">
        <div class="skeleton h-72 w-full rounded-box"></div>
        <div class="skeleton h-4 w-52"></div>
      </div>
      <EmptyState
        v-else-if="initialLoadFailed"
        type="error"
        :title="tr(&quot;加载数据失败&quot;)"
        :message="tr(&quot;这通常是由于客户端与服务器的网络不可达或服务器崩溃了\n请检查您的网络，并测试是否可以正常访问服务器，如果上述一切正常，请联系系统管理员&quot;)"
      />
      <EmptyState v-else-if="events.length === 0" :title="tr(&quot;暂无审计事件&quot;)" :message="tr(&quot;当前筛选条件下没有可显示的记录。&quot;)" />
      <div v-else-if="events.length" class="overflow-x-auto">
        <table class="table table-zebra">
          <thead>
            <tr>
              <th>{{ tr("时间") }}</th>
              <th>{{ tr("操作者") }}</th>
              <th>{{ tr("动作") }}</th>
              <th>{{ tr("资源") }}</th>
              <th>{{ tr("请求 ID") }}</th>
              <th>{{ tr("来源 IP") }}</th>
              <th>{{ tr("结果") }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in events" :key="event.event_id">
              <td class="whitespace-nowrap text-xs">{{ formatTime(event.occurred_at) }}</td>
              <td>{{ actorLabel(event) }}</td>
              <td>
                <div class="font-medium">{{ actionLabels[event.action] || event.action }}</div>
                <div class="text-xs text-base-content/50">{{ categoryLabels[event.category] || event.category }}</div>
              </td>
              <td class="max-w-64 truncate" :title="resourceLabel(event)">{{ resourceLabel(event) }}</td>
              <td class="max-w-48">
                <span v-if="event.request_id" class="block truncate font-mono text-xs" :title="event.request_id">{{ event.request_id }}</span>
                <span v-else class="text-base-content/40">--</span>
              </td>
              <td class="font-mono text-xs">{{ event.source_ip || '--' }}</td>
              <td><span class="badge badge-sm" :class="resultClass(event.outcome)">{{ resultLabel(event.outcome) }}</span></td>
              <td><button class="btn btn-ghost btn-xs" @click="selectedEvent = event">{{ tr("详情") }}</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="events.length" class="mt-4 flex items-center justify-between text-sm">
      <span class="text-base-content/60">{{ tr("共") }} {{ total }} {{ tr("条，第") }} {{ page }} / {{ totalPages }} {{ tr("页") }}</span>
      <div class="join">
        <button class="btn btn-sm join-item" :disabled="page <= 1 || loading" @click="changePage(page - 1)">{{ tr("上一页") }}</button>
        <button class="btn btn-sm join-item" :disabled="page >= totalPages || loading" @click="changePage(page + 1)">{{ tr("下一页") }}</button>
      </div>
    </div>

    <dialog class="modal" :class="{ 'modal-open': selectedEvent }">
      <div v-if="selectedEvent" class="modal-box max-w-3xl">
        <h2 class="text-lg font-semibold">{{ tr("审计事件详情") }}</h2>
        <div class="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <div><span class="text-base-content/50">{{ tr("事件 ID") }}</span><div class="break-all font-mono text-xs">{{ selectedEvent.event_id }}</div></div>
          <div>
            <span class="text-base-content/50">{{ tr("请求 ID") }}</span>
            <div class="break-all font-mono text-xs">{{ selectedEvent.request_id || '--' }}</div>
            <button v-if="selectedEvent.request_id" class="btn btn-outline btn-xs mt-2" @click="filterByRequestId(selectedEvent.request_id)">{{ tr("筛选此请求的全部事件") }}</button>
          </div>
          <div><span class="text-base-content/50">{{ tr("时间") }}</span><div>{{ formatTime(selectedEvent.occurred_at) }}</div></div>
          <div><span class="text-base-content/50">{{ tr("响应状态") }}</span><div>{{ selectedEvent.response_status || '--' }}</div></div>
          <div><span class="text-base-content/50">{{ tr("事件触发者 IP") }}</span><div class="font-mono text-xs">{{ selectedEvent.source_ip || '--' }}</div></div>
          <div><span class="text-base-content/50">{{ tr("请求") }}</span><div>{{ selectedEvent.http_method || '--' }} {{ selectedEvent.request_path || '--' }}</div></div>
          <div><span class="text-base-content/50">User-Agent</span><div class="break-all">{{ selectedEvent.user_agent || '--' }}</div></div>
        </div>
        <div class="mt-4">
          <div class="text-sm text-base-content/50">{{ tr("变更内容") }}</div>
          <pre class="mt-1 max-h-52 overflow-auto rounded-box bg-base-200 p-3 text-xs">{{ formattedJson(selectedEvent.changes) }}</pre>
        </div>
        <div class="mt-4">
          <div class="text-sm text-base-content/50">{{ tr("元数据") }}</div>
          <pre class="mt-1 max-h-52 overflow-auto rounded-box bg-base-200 p-3 text-xs">{{ formattedJson(selectedEvent.metadata) }}</pre>
        </div>
        <div class="modal-action"><button class="btn" @click="selectedEvent = null">{{ tr("关闭") }}</button></div>
      </div>
      <button class="modal-backdrop" :aria-label="tr(&quot;关闭详情&quot;)" @click="selectedEvent = null"></button>
    </dialog>
  </main>
  <AccessVerification ref="verification" />
</template>
