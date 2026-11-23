<script setup>
import { tr } from '../i18n/index.js'

import { computed, onBeforeUnmount, ref, watch, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppAlert from '@/components/AppAlert.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import ReportTrendChart from '@/components/ReportTrendChart.vue'
import http from '@/utils/http'
import { deliveryStatuses, reportCsv, reportDate, reportTimezone, reportPeriod, reportStatuses, reportTypeLabel } from '@/utils/reports'
import { deliveryReason } from '@/utils/notifications'

const route = useRoute()
const router = useRouter()
const isAdmin = inject('isAdmin', ref(false))
const confirmDialog = ref(null)
const report = ref(null)
const deliveries = ref([])
const recipients = ref([])
const selectedRecipients = ref([])
const channels = ref([])
const selectedChannels = ref([])
const loading = ref(true)
const error = ref('')
const forbidden = ref(false)
const actionLoading = ref(false)
const alerts = ref([])
const deliveryError = ref('')
const sendDialog = ref(null)
let controller
let timer
let disposed = false
const payload = computed(() => report.value?.payload)
const cards = computed(() => [
  { get title() { return tr("新建任务") }, value: payload.value?.tasks?.created ?? 0 },
  { get title() { return tr("任务成功率") }, value: payload.value?.tasks?.success_rate == null ? '--' : `${payload.value.tasks.success_rate}%` },
  { get title() { return tr("成功执行发现的去重 IP") }, value: payload.value?.scan_output?.unique_ips ?? 0 },
  { get title() { return tr("端口 / 服务观测次数") }, value: `${payload.value?.scan_output?.port_observations ?? 0} / ${payload.value?.scan_output?.service_observations ?? 0}` },
])

function alert(type, title) { alerts.value.unshift({ id: crypto.randomUUID(), type, title, timeout: 7000 }) }
function signed(value, suffix) { return value == null ? tr("上期为 0 或无可比较值") : `${value > 0 ? '+' : ''}${value}${suffix}` }
function seconds(value) { return tr("{0} 秒", [(Number(value || 0) / 1000).toFixed(1)]) }

async function load({ silent = false } = {}) {
  clearTimeout(timer)
  controller?.abort()
  const request = new AbortController()
  controller = request
  if (!silent) loading.value = true
  const id = String(route.params.id)
  try {
    const response = await http.get(`/api/reports/${id}`, { signal: request.signal })
    if (request.signal.aborted || disposed) return
    if (!response.data?.success) throw new Error(tr("报告加载失败"))
    report.value = response.data.data
    error.value = ''
    forbidden.value = false
    if (!isAdmin.value) return
    const deliveryResponse = await http.get(`/api/reports/${id}/deliveries`, { signal: request.signal }).catch((e) => {
      if (!request.signal.aborted) deliveryError.value = e.response?.data?.message || tr("投递状态加载失败")
      return null
    })
    if (request.signal.aborted || disposed) return
    if (deliveryResponse) { deliveries.value = deliveryResponse.data.data; deliveryError.value = '' }
  } catch (e) {
    if (request.signal.aborted || disposed) return
    forbidden.value = e.response?.status === 403
    error.value = e.response?.data?.message || tr("报告加载失败，请重试。")
  } finally {
    if (!request.signal.aborted && !disposed) {
      loading.value = false
      if (!error.value && (['queued', 'waiting_data', 'generating'].includes(report.value?.status) || deliveries.value.some((d) => ['pending', 'sending'].includes(d.status)))) {
        timer = setTimeout(() => load({ silent: true }), 5000)
      }
    }
  }
}

async function action(name) {
  actionLoading.value = true
  const id = report.value.id
  try {
    const response = await http.post(`/api/reports/${id}/${name}`)
    if (name === 'revisions') await router.push(`/reports/${response.data.data.id}`)
    else await load({ silent: true })
  } catch (e) { alert('error', e.response?.data?.message || tr("操作失败")) }
  finally { actionLoading.value = false }
}

async function prepareSend() {
  actionLoading.value = true
  try {
    const [response, channelResponse] = await Promise.all([http.get('/api/report-schedules'), http.get('/api/notifications/channels')])
    recipients.value = response.data.data.recipients.filter((u) => u.email)
    channels.value = channelResponse.data.data.filter((c) => c.enabled && ['feishu', 'telegram'].includes(c.provider))
    selectedRecipients.value = []
    selectedChannels.value = []
    sendDialog.value?.showModal()
  } catch (e) { alert('error', e.response?.data?.message || tr("收件人加载失败")) }
  finally { actionLoading.value = false }
}

async function send() {
  actionLoading.value = true
  try {
    await http.post(`/api/reports/${report.value.id}/deliveries`, { recipient_ids: selectedRecipients.value, channel_ids: selectedChannels.value })
    sendDialog.value?.close()
    alert('success', tr("报告已加入投递队列"))
    await load({ silent: true })
  } catch (e) { alert('error', e.response?.data?.message || tr("发送请求失败")) }
  finally { actionLoading.value = false }
}

async function revokeImage() {
  if (!await confirmDialog.value.ask({ message: tr("撤销后将停止从服务器加载这份报告的趋势图，待发送邮件会取消。邮箱已缓存的图像无法收回。是否继续？"), confirmText: tr("撤销"), danger: true })) return
  actionLoading.value = true
  try {
    await http.post(`/api/reports/${report.value.id}/mail-image/revoke`)
    alert('success', tr("报告趋势图片已撤销"))
    await load({ silent: true })
  } catch (e) { alert('error', e.response?.data?.message || tr("撤销失败，请稍后重试")) }
  finally { actionLoading.value = false }
}

function exportCsv() {
  const url = URL.createObjectURL(new Blob([reportCsv(report.value)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${report.value.period_type}-${report.value.id}-r${report.value.revision}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function printReport() { window.print() }

watch(() => route.params.id, () => { report.value = null; deliveries.value = []; deliveryError.value = ''; load() }, { immediate: true })
watch(isAdmin, (value) => { if (value && report.value && !disposed) load({ silent: true }) })
onBeforeUnmount(() => { disposed = true; clearTimeout(timer); controller?.abort() })
</script>

<template>
  <div class="page-shell report-detail space-y-6">
    <ConfirmDialog ref="confirmDialog" />
    <AppAlert v-for="item in alerts" :key="item.id" v-bind="item" @close="alerts = alerts.filter((a) => a.id !== item.id)" />
    <div class="report-controls flex flex-wrap items-center justify-between gap-3">
      <router-link class="btn btn-sm btn-ghost" to="/reports">{{ tr("← 报告中心") }}</router-link>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-sm btn-ghost" :disabled="loading" @click="load({ silent: true })">{{ tr("刷新") }}</button>
        <button v-if="isAdmin && report?.status === 'failed'" class="btn btn-sm btn-neutral" :disabled="actionLoading" @click="action('retry')">{{ tr("重试生成") }}</button>
        <button v-if="isAdmin && report && ['ready', 'failed'].includes(report.status)" class="btn btn-sm" :disabled="actionLoading" @click="action('revisions')">{{ tr("生成修订版") }}</button>
        <template v-if="report?.status === 'ready'">
          <button class="btn btn-sm" @click="exportCsv">{{ tr("导出 CSV") }}</button><button class="btn btn-sm" @click="printReport">{{ tr("打印") }}</button>
          <button v-if="isAdmin" class="btn btn-sm btn-neutral" :disabled="actionLoading" @click="prepareSend">{{ tr("发送报告") }}</button>
        </template>
      </div>
    </div>
    <div v-if="loading" class="grid min-h-80 place-items-center"><span class="loading loading-spinner loading-lg" /></div>
    <EmptyState v-else-if="error" type="error" :title="forbidden ? tr(&quot;无权访问该报告&quot;) : tr(&quot;报告加载失败&quot;)" :message="error" />
    <template v-else-if="report">
      <div class="card border border-base-300 bg-base-100 p-5">
        <div class="flex flex-wrap items-center gap-3"><h1 class="page-title">{{ tr("平台") }}{{ reportTypeLabel(report.period_type) }}</h1><span class="badge badge-outline">{{ tr("修订 #") }}{{ report.revision }}</span><span class="badge" :class="reportStatuses[report.status]?.class">{{ reportStatuses[report.status]?.label }}</span></div>
        <p class="mt-3 text-sm">{{ reportPeriod(report) }} · {{ reportTimezone(report) }}</p>
        <p class="mt-1 text-xs text-base-content/60">{{ tr("输入固定于") }} {{ reportDate(report.cutoff_at, true) }} {{ tr("· 归档于") }} {{ reportDate(report.generated_at, true) }}</p>
        <router-link v-if="report.supersedes_report_id" class="link mt-2 text-xs" :to="`/reports/${report.supersedes_report_id}`">{{ tr("查看上一修订版") }}</router-link>
      </div>
      <div v-if="report.status !== 'ready'" role="status" class="alert" :class="report.status === 'failed' ? 'alert-error' : 'alert-info'">
        <span>{{ report.last_error || tr("报告已排队，正在等待生成。") }}<span v-if="report.quality?.current"> {{ tr("· 统计执行") }} {{ report.quality.current.ready }} / {{ report.quality.current.expected }}</span></span>
      </div>
      <div v-if="isAdmin && report.quality?.mail_error" role="alert" class="alert alert-warning"><span>{{ tr("报告已归档，邮件内容不可用：") }}{{ report.quality.mail_error }}{{ tr("。检查邮件模板后可生成修订版。") }}</span></div>
      <template v-if="payload">
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><div v-for="card in cards" :key="card.title" class="card border border-base-300 bg-base-100 p-5"><div class="text-sm opacity-60">{{ card.title }}</div><div class="mt-2 break-words text-2xl font-semibold">{{ card.value }}</div></div></div>
        <div class="grid gap-4 lg:grid-cols-2">
          <div class="card border border-base-300 bg-base-100 p-5"><h2 class="font-semibold">{{ tr("任务完成情况") }}</h2><div class="mt-4 grid grid-cols-2 gap-3 text-sm"><span>{{ tr("成功：") }}{{ payload.tasks.succeeded }}</span><span>{{ tr("失败：") }}{{ payload.tasks.failed }}</span><span>{{ tr("部分完成：") }}{{ payload.tasks.partial }}</span><span>{{ tr("取消：") }}{{ payload.tasks.cancelled }}</span></div><p class="mt-4 text-xs opacity-60">{{ tr("成功率 = 成功 /（成功 + 失败 + 部分完成），取消单列。") }}</p></div>
          <div class="card border border-base-300 bg-base-100 p-5"><h2 class="font-semibold">{{ tr("与上一周期比较") }}</h2><div v-if="payload.previous_available" class="mt-4 space-y-2 text-sm"><p>{{ tr("新建任务：") }}{{ signed(payload.comparison.created_growth_percent, '%') }}</p><p>{{ tr("去重 IP：") }}{{ signed(payload.comparison.unique_ips_growth_percent, '%') }}</p><p>{{ tr("日均去重 IP：") }}{{ signed(payload.comparison.daily_unique_ips_growth_percent, '%') }}</p><p>{{ tr("成功率：") }}{{ signed(payload.comparison.success_rate_change_points, tr(" 个百分点")) }}</p></div><p v-else class="mt-4 text-sm opacity-60">{{ tr("上期历史或统计不完整，暂不提供环比。") }}</p></div>
        </div>
        <div class="card border border-base-300 bg-base-100 p-5"><h2 class="font-semibold">{{ tr("每日完成任务") }}</h2><ReportTrendChart :items="payload.trend" :filename="`report-${report.id}-r${report.revision}-trend`" /></div>
        <div class="grid gap-4 lg:grid-cols-2"><div v-for="dimension in [{ key: &#39;ports&#39;, label: tr(&quot;端口&quot;) }, { key: &#39;services&#39;, label: tr(&quot;服务&quot;) }]" :key="dimension.key" class="card border border-base-300 bg-base-100 p-5"><h2 class="font-semibold">{{ dimension.label }}{{ tr("观测 Top 10") }}</h2><div v-if="payload.scan_output[dimension.key].length" class="mt-3 overflow-x-auto"><table class="table table-sm"><thead><tr><th>{{ dimension.label }}</th><th>{{ tr("观测次数") }}</th></tr></thead><tbody><tr v-for="item in payload.scan_output[dimension.key]" :key="item.name"><td class="break-all">{{ item.name }}</td><td>{{ item.count }}</td></tr></tbody></table></div><p v-else class="mt-4 text-sm opacity-60">{{ tr("本期无") }}{{ dimension.label }}{{ tr("观测记录。") }}</p></div></div>
        <div class="card border border-base-300 bg-base-100 p-5"><h2 class="font-semibold">{{ tr("扫描器执行表现") }}</h2><div v-if="payload.scanners.length" class="mt-3 overflow-x-auto"><table class="table table-sm"><thead><tr><th>{{ tr("扫描器") }}</th><th>{{ tr("总执行") }}</th><th>{{ tr("成功 / 失败 / 取消") }}</th><th>{{ tr("成功执行平均耗时") }}</th><th>P50 / P95</th></tr></thead><tbody><tr v-for="(scanner, index) in payload.scanners" :key="scanner.scanner_id || index"><td>{{ scanner.name }}</td><td>{{ scanner.total }}</td><td>{{ scanner.succeeded }} / {{ scanner.failed }} / {{ scanner.cancelled }}</td><td>{{ seconds(scanner.avg_duration_ms) }}</td><td>{{ seconds(scanner.p50_ms) }} / {{ seconds(scanner.p95_ms) }}</td></tr></tbody></table></div><p v-else class="mt-4 text-sm opacity-60">{{ tr("本期无完成执行。") }}</p></div>
        <div class="card border border-base-300 bg-base-100 p-5"><h2 class="font-semibold">{{ tr("处理建议") }}</h2><ul v-if="payload.recommendations.length" class="mt-3 list-inside list-disc space-y-2 text-sm"><li v-for="item in payload.recommendations" :key="item">{{ item }}</li></ul><p v-else class="mt-3 text-sm opacity-60">{{ tr("本期未发现需要提示的任务异常。") }}</p></div>
        <div class="card border border-base-300 bg-base-100 p-5"><h2 class="font-semibold">{{ tr("统计口径与完整性") }}</h2><p class="mt-3 text-sm">{{ tr("成功执行统计已完成：") }}{{ report.quality.current.ready }} / {{ report.quality.current.expected }}</p><p v-for="note in payload.notes" :key="note" class="mt-2 text-xs opacity-60">{{ note }}</p><p class="mt-3 break-all font-mono text-xs opacity-50">SHA-256：{{ report.content_checksum }}</p></div>
      </template>
      <div v-if="isAdmin && report.mail_image" class="report-controls card border border-base-300 bg-base-100 p-5"><h2 class="font-semibold">{{ tr("邮件趋势图片") }}</h2><p class="mt-3 text-sm">{{ report.mail_image.revoked_at ? tr("图片已撤销") : tr("有效期至 {0}", [reportDate(report.mail_image.expires_at, true)]) }}</p><p class="mt-2 text-xs opacity-60">{{ tr("图片与当前报告版本固定对应；撤销后需要生成修订版才能再次发送。邮箱已缓存的图像可能继续显示。") }}</p><button v-if="!report.mail_image.revoked_at" class="btn btn-sm btn-outline mt-3 self-start" :disabled="actionLoading" @click="revokeImage">{{ tr("撤销图片访问") }}</button></div>
      <div v-if="isAdmin" class="report-controls card border border-base-300 bg-base-100 p-5"><h2 class="font-semibold">{{ tr("报告投递记录") }}</h2><p v-if="deliveryError" class="mt-3 text-sm text-error">{{ deliveryError }}</p><div v-else-if="deliveries.length" class="mt-3 overflow-x-auto"><table class="table table-sm"><thead><tr><th>{{ tr("收件人 / 渠道") }}</th><th>{{ tr("批次") }}</th><th>{{ tr("状态") }}</th><th>{{ tr("尝试次数") }}</th><th>{{ tr("说明") }}</th></tr></thead><tbody><tr v-for="delivery in deliveries" :key="delivery.id"><td>{{ delivery.recipient }}</td><td>{{ delivery.dispatch_seq ? `#${delivery.dispatch_seq}` : '—' }}</td><td>{{ deliveryStatuses[delivery.status] || delivery.status }}</td><td>{{ delivery.attempts }}</td><td class="max-w-sm break-words text-xs">{{ delivery.last_error ? (delivery.dispatch_seq ? delivery.last_error : deliveryReason(delivery.last_error)) : (delivery.status === 'sent' ? reportDate(delivery.sent_at, true) : '') }}</td></tr></tbody></table></div><p v-else class="mt-3 text-sm opacity-60">{{ tr("尚无投递记录。") }}</p></div>
    </template>
    <dialog ref="sendDialog" class="modal"><div class="modal-box"><h2 class="text-lg font-semibold">{{ tr("发送报告") }}</h2><p class="mt-2 text-sm opacity-60">{{ tr("选择邮件收件人或已启用的通知渠道，发送当前归档版本。发送失败可能自动重试，重复发送可能产生重复消息。") }}</p><form class="mt-4" @submit.prevent="send"><h3 class="font-medium">{{ tr("邮件收件人") }}</h3><label v-for="user in recipients" :key="user.id" class="mt-3 flex items-center gap-2 text-sm"><input v-model="selectedRecipients" type="checkbox" class="checkbox checkbox-sm" :value="user.id" :disabled="!!report?.mail_image?.revoked_at" />{{ user.username }} · {{ user.email }}</label><p v-if="!recipients.length" class="text-sm opacity-60">{{ tr("没有可用管理员邮箱。") }}</p><h3 class="mt-4 font-medium">{{ tr("通知渠道") }}</h3><label v-for="channel in channels" :key="channel.id" class="mt-3 flex items-center gap-2 text-sm"><input v-model="selectedChannels" type="checkbox" class="checkbox checkbox-sm" :value="channel.id" />{{ channel.provider === 'feishu' ? tr("飞书") : 'Telegram' }} · {{ channel.name }}</label><p v-if="!channels.length" class="text-sm opacity-60">{{ tr("没有已启用的飞书或 Telegram 渠道。") }}</p><div class="modal-action"><button type="button" class="btn" @click="sendDialog.close()">{{ tr("取消") }}</button><button class="btn btn-neutral" :disabled="(!selectedRecipients.length && !selectedChannels.length) || actionLoading">{{ tr("确认发送") }}</button></div></form></div><form method="dialog" class="modal-backdrop"><button>{{ tr("关闭") }}</button></form></dialog>
  </div>
</template>

<style>
@media print {
  .report-controls, .drawer-side, .navbar, .modal { display: none !important; }
  .drawer-content { margin-left: 0 !important; }
  .drawer, .drawer-content { background: white !important; color: #111 !important; }
  .report-detail .card { break-inside: avoid; box-shadow: none; }
  .report-detail {
    --color-base-100: white;
    --color-base-200: #f5f5f5;
    --color-base-300: #ddd;
    --color-base-content: #111;
    color: #111;
    background: white;
  }
  .report-detail .card { background: white !important; border-color: #ddd !important; }
  .report-detail .apexcharts-text { fill: #111 !important; }
  .report-detail .apexcharts-legend-text { color: #111 !important; }
}
</style>
