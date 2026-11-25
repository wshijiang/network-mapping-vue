<script setup>
import { tr } from '../i18n/index.js'

import { formatDateTime as formatSystemDateTime } from '../i18n/time.js'
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import EmptyState from '@/components/EmptyState.vue'
import VersionUpdateBadge from '@/components/VersionUpdateBadge.vue'
import http from '@/utils/http'
import AccessVerification from '@/components/AccessVerification.vue'

const verification = ref(null)

const formFieldId = useId()
const scannerForm = ref({
  name: '',
  location: '',
  remark: '',
  tag: ''
})

const submitting = ref(false)
const scannerResult = ref(null)
const alerts = ref([])

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
  alerts.value = alerts.value.filter((a) => a.id !== id)
}

const scannerList = ref([])
const maintenanceStatus = ref(null)
const isLoadingData = ref(false)
const initialLoadFailed = ref(false)

const pageSize = ref(7)
const copiedField = ref(null)

async function copyToClipboard(text, field) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }
  copiedField.value = field
  window.setTimeout(() => {
    copiedField.value = null
  }, 1600)
}
const currentPage = ref(1)

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return formatSystemDateTime(date)
}

function resolveStatus(item) {
  if (item.is_enable !== true) {
    return { key: 'pending', get text() { return tr("待注册") }, class: 'badge-warning' }
  }
  if (maintenanceStatus.value?.phase === 'active' && item.current_task_id) {
    return { key: 'maintenance-scanning', get text() { return tr("维护中 · 本地扫描") }, class: 'badge-warning' }
  }
  if (maintenanceStatus.value?.phase === 'active' || (
    maintenanceStatus.value?.phase === 'draining' && !item.current_task_id
  )) {
    return { key: 'maintenance', get text() { return tr("维护休眠") }, class: 'badge-warning' }
  }
  if (item.is_online === true) {
    if (item.runtime_state === 'scanning') {
      return {
        key: 'online',
        text: maintenanceStatus.value?.phase === 'draining' ? tr("扫描中 · 正在冻结任务") : tr("扫描中"),
        class: 'badge-info'
      }
    }
    return { key: 'online', get text() { return tr("在线 · 空闲") }, class: 'badge-success' }
  }
  return { key: 'offline', get text() { return tr("离线") }, class: 'badge-error' }
}

function normalizeLatency(latency) {
  const milliseconds = Number(latency?.network_rtt_ms)
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return { text: '--', class: 'badge-ghost', get title() { return tr("尚无延迟样本") } }
  }
  const text = milliseconds < 10 ? `${milliseconds.toFixed(1)} ms` : `${Math.round(milliseconds)} ms`
  if (latency.stale) {
    return { text, class: 'badge-ghost', title: tr("样本已过期：{0}", [formatDate(latency.measured_at)]) }
  }
  const badgeClass = latency.severity === 'critical' ? 'badge-error'
    : latency.severity === 'warning' ? 'badge-warning' : 'badge-success'
  return { text, class: badgeClass, title: tr("测量时间：{0}", [formatDate(latency.measured_at)]) }
}

function normalizeScanner(item, index) {
  const status = resolveStatus(item)
  const latency = normalizeLatency(item.latency)
  return {
    id: item.scanner_id,
    index: index + 1,
    name: item.name || '未命名扫描器',
    region: item.location || '-',
    ip: item.ip_address || '-',
    creator: item.creator || '-',
    version: item.scanner_version || '',
    lastSeenAt: item.last_seen_at,
    currentTaskId: item.current_task_id,
    statusKey: status.key,
    statusText: status.text,
    statusClass: status.class,
    latencyText: latency.text,
    latencyClass: latency.class,
    latencyTitle: latency.title,
    ipv4Ready: item.supports_ipv4 === true && item.ipv4_ready === true,
    ipv6Ready: item.supports_ipv6 === true && item.ipv6_ready === true
  }
}

const scannerStats = computed(() => {
  const online = scannerList.value.filter((item) => item.statusKey === 'online').length
  return {
    total: scannerList.value.length,
    online,
    nonOnline: scannerList.value.length - online
  }
})

const totalPages = computed(() => {
  const pages = Math.ceil(scannerList.value.length / pageSize.value)
  return pages > 0 ? pages : 1
})

const pagedScannerList = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return scannerList.value.slice(start, end)
})

const pageNumbers = computed(() => Array.from({ length: totalPages.value }, (_, i) => i + 1))

async function loadScanners({ silent = false } = {}) {
  if (isLoadingData.value) return
  isLoadingData.value = true

  try {
    const response = await http.get('/api/scanner/list')
    const data = response.data?.data
    if (response.data?.success !== true || !Array.isArray(data)) {
      throw new Error(tr("服务器未返回有效扫描器列表"))
    }
    maintenanceStatus.value = response.data?.maintenance || null
    scannerList.value = data.map(normalizeScanner)
    initialLoadFailed.value = false
    if (currentPage.value > totalPages.value) currentPage.value = totalPages.value
  } catch (error) {
    console.error('load scanners failed', error)
    initialLoadFailed.value = scannerList.value.length === 0
    if (!silent) pushAlert('error', tr("加载扫描器失败"), tr("请稍后重试。"))
  } finally {
    isLoadingData.value = false
  }
}

async function createScanner() {
  if (!scannerForm.value.name.trim()) return
  if (submitting.value) return

  submitting.value = true
  scannerResult.value = null

  try {
    const payload = {
      name: scannerForm.value.name.trim(),
    }
    if (scannerForm.value.location.trim()) payload.location = scannerForm.value.location.trim()
    if (scannerForm.value.remark.trim()) payload.remark = scannerForm.value.remark.trim()
    if (scannerForm.value.tag.trim()) payload.tag = scannerForm.value.tag.trim()

    let response
    try {
      response = await http.post('/api/scanner/add', payload)
    } catch (failure) {
      if (failure?.response?.data?.error?.code !== 'step_up_required') throw failure
      if (!await verification.value.verify()) return
      response = await http.post('/api/scanner/add', payload)
    }
    const result = response.data?.data
    if (response.data?.success === true && result?.scanner_id && result?.registration_token) {
      scannerResult.value = result
      scannerForm.value = {
        name: '',
        location: '',
        remark: '',
        tag: ''
      }
      pushAlert('success', tr("扫描器创建成功"), tr("请妥善保存下方展示的 token，关闭后无法再次查看。"))
      await loadScanners({ silent: true })
    } else {
      pushAlert('error', tr("创建扫描器失败"), tr("服务器未返回有效数据，请稍后重试。"))
    }
  } catch (error) {
    console.error('create scanner failed', error)
    pushAlert('error', tr("创建扫描器失败"), tr("请检查网络连接后重试。"))
  } finally {
    submitting.value = false
  }
}

function changePage(page) {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
}

let refreshTimer

onMounted(() => {
  loadScanners()
  refreshTimer = window.setInterval(() => loadScanners({ silent: true }), 30000)
})

onBeforeUnmount(() => window.clearInterval(refreshTimer))
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

  <div class="page-shell">
    <div class="mb-4">
      <h1 class="page-title">{{ tr("扫描器") }}</h1>
      <p class="text-xs opacity-60">{{ tr("该页面展示了添加的所有扫描器") }}</p>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
      <div class="xl:col-span-2 flex flex-col gap-4">
        <div class="stats shadow border border-base-300 bg-base-100">
          <div class="stat place-items-center">
            <div class="stat-title">{{ tr("扫描器总数") }}</div>
            <div class="stat-value">{{ isLoadingData ? '—' : scannerStats.total }}</div>
            <div class="stat-desc">{{ tr("当前已注册扫描器") }}</div>
          </div>

          <div class="stat place-items-center">
            <div class="stat-title">{{ tr("在线扫描器") }}</div>
            <div class="stat-value">{{ isLoadingData ? '—' : scannerStats.online }}</div>
            <div class="stat-desc">{{ tr("可立即执行任务") }}</div>
          </div>

          <div class="stat place-items-center">
            <div class="stat-title">{{ tr("非在线扫描器") }}</div>
            <div class="stat-value text-error">{{ isLoadingData ? '—' : scannerStats.nonOnline }}</div>
            <div class="stat-desc text-error">{{ tr("包含待注册及离线节点") }}</div>
          </div>
        </div>

        <div class="card bg-base-100 card-border border-base-300 p-4">
          <div class="mb-3 flex items-center justify-between gap-3">
            <h3 class="font-semibold">{{ tr("扫描器列表") }}</h3>
            <button class="btn btn-ghost btn-xs" :disabled="isLoadingData" @click="loadScanners()">
              {{ isLoadingData ? tr("加载中...") : tr("刷新") }}
            </button>
          </div>

          <div v-if="isLoadingData && scannerList.length === 0" class="grid min-h-64 place-items-center rounded-lg bg-base-200/60">
            <span class="loading loading-spinner loading-md"></span>
          </div>

          <EmptyState
            v-else-if="initialLoadFailed"
            type="error"
            :title="tr(&quot;扫描器列表加载失败&quot;)"
            :message="tr(&quot;无法从服务器获取扫描器信息，请稍后重试。&quot;)"
          />

          <EmptyState
            v-else-if="scannerList.length === 0"
            :title="tr(&quot;暂无扫描器&quot;)"
            :message="tr(&quot;请使用右侧表单创建第一个扫描器。&quot;)"
          />

          <div v-else class="overflow-x-auto rounded-box border border-base-300">
            <table class="table table-sm whitespace-nowrap">
              <thead>
                <tr>
                  <th></th>
                  <th>{{ tr("名称") }}</th>
                  <th>{{ tr("区域") }}</th>
                  <th>{{ tr("地址") }}</th>
                  <th>{{ tr("状态") }}</th>
                  <th>{{ tr("版本") }}</th>
                  <th>{{ tr("协议") }}</th>
                  <th>{{ tr("延迟") }}</th>
                  <th>{{ tr("添加者") }}</th>
                  <th>{{ tr("最后心跳") }}</th>
                  <th>{{ tr("当前任务") }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in pagedScannerList" :key="item.id">
                  <td>{{ item.index }}</td>
                  <td>
                    <router-link class="link" :to="`/scanner/${item.id}`">
                      {{ item.name }}
                    </router-link>
                  </td>
                  <td>{{ item.region }}</td>
                  <td>{{ item.ip }}</td>
                  <td><span class="badge badge-sm" :class="item.statusClass">{{ item.statusText }}</span></td>
                  <td>
                    <div class="flex items-center gap-2 whitespace-nowrap">
                      <span>{{ item.version || '-' }}</span>
                      <VersionUpdateBadge component="scanner" :current-version="item.version" />
                    </div>
                  </td>
                  <td>
                    <div class="flex gap-1 whitespace-nowrap">
                      <span class="badge badge-xs" :class="item.ipv4Ready ? 'badge-success' : 'badge-ghost'">IPv4</span>
                      <span class="badge badge-xs" :class="item.ipv6Ready ? 'badge-success' : 'badge-ghost'">IPv6</span>
                    </div>
                  </td>
                  <td><span class="badge badge-sm whitespace-nowrap" :class="item.latencyClass" :title="item.latencyTitle">{{ item.latencyText }}</span></td>
                  <td>{{ item.creator }}</td>
                  <td class="whitespace-nowrap">{{ formatDate(item.lastSeenAt) }}</td>
                  <td>
                    <router-link v-if="item.currentTaskId" class="link link-neutral text-xs" :to="`/task/${item.currentTaskId}`"> {{ tr("查看任务") }} </router-link>
                    <span v-else>-</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="!initialLoadFailed && scannerList.length > 0" class="flex items-center justify-between mt-3">
            <div class="text-xs opacity-70">{{ tr("第") }} {{ currentPage }} / {{ totalPages }} {{ tr("页") }}</div>
            <div class="join">
              <button class="join-item btn btn-xs" :disabled="currentPage === 1" @click="changePage(currentPage - 1)">{{ tr("上一页") }}</button>
              <button
                v-for="p in pageNumbers"
                :key="p"
                class="join-item btn btn-xs"
                :class="{ 'btn-active': p === currentPage }"
                @click="changePage(p)"
              >
                {{ p }}
              </button>
              <button class="join-item btn btn-xs" :disabled="currentPage === totalPages" @click="changePage(currentPage + 1)">{{ tr("下一页") }}</button>
            </div>
          </div>
        </div>
      </div>

      <div class="xl:col-span-1">
        <div class="card bg-base-100 card-border border-base-300 p-4">
          <h3 class="font-semibold mb-3">{{ tr("创建扫描器") }}</h3>

          <div class="grid grid-cols-1 gap-3">
            <fieldset class="fieldset min-w-0 w-full">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-1`">{{ tr("扫描器名称") }} <span class="text-error">*</span></label></legend>
              <input :id="`${formFieldId}-1`" v-model="scannerForm.name" type="text" class="input input-bordered w-full" :placeholder="tr(&quot;例如：scanner-04&quot;)" :disabled="submitting" />
            </fieldset>

            <fieldset class="fieldset min-w-0 w-full">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-2`">{{ tr("位置") }}</label></legend>
              <input :id="`${formFieldId}-2`" v-model="scannerForm.location" type="text" class="input input-bordered w-full" :placeholder="tr(&quot;例如：华东-上海&quot;)" :disabled="submitting" />
            </fieldset>

            <fieldset class="fieldset min-w-0 w-full">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-3`">{{ tr("备注") }}</label></legend>
              <input :id="`${formFieldId}-3`" v-model="scannerForm.remark" type="text" class="input input-bordered w-full" :placeholder="tr(&quot;备注信息（可选）&quot;)" :disabled="submitting" />
            </fieldset>

            <fieldset class="fieldset min-w-0 w-full">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-4`">{{ tr("标签") }}</label></legend>
              <input :id="`${formFieldId}-4`" v-model="scannerForm.tag" type="text" class="input input-bordered w-full" :placeholder="tr(&quot;标签（可选）&quot;)" :disabled="submitting" />
            </fieldset>

            <button class="btn btn-neutral w-full mt-1" :disabled="submitting || !scannerForm.name.trim()" @click="createScanner">
              {{ submitting ? tr("提交中...") : tr("提交") }}
            </button>
          </div>

          <!-- 创建结果展开 -->
          <div v-if="scannerResult" class="mt-5 space-y-2 border-t border-base-300 pt-4">
            <h4 class="text-sm font-semibold">{{ tr("创建成功") }}</h4>
            <p class="text-xs opacity-60">{{ tr("以下信息仅在本次展示，请立即保存。") }}</p>

            <label class="form-control w-full">
              <span class="label-text text-xs mb-1">Scanner ID</span>
              <div class="flex items-center gap-2">
                <code class="flex-1 truncate rounded-lg bg-base-200 px-3 py-2 text-xs">{{ scannerResult.scanner_id }}</code>
                <button class="btn btn-ghost btn-xs shrink-0" @click="copyToClipboard(scannerResult.scanner_id, 'id')">
                  {{ copiedField === 'id' ? tr("已复制") : tr("复制") }}
                </button>
              </div>
            </label>

            <label class="form-control w-full">
              <span class="label-text text-xs mb-1">Registration Token</span>
              <div class="flex items-center gap-2">
                <code class="flex-1 truncate rounded-lg bg-base-200 px-3 py-2 text-xs">{{ scannerResult.registration_token }}</code>
                <button class="btn btn-ghost btn-xs shrink-0" @click="copyToClipboard(scannerResult.registration_token, 'token')">
                  {{ copiedField === 'token' ? tr("已复制") : tr("复制") }}
                </button>
              </div>
            </label>
          </div>
        </div>
      </div>
    </div>
  </div>
  <AccessVerification ref="verification" />
</template>
