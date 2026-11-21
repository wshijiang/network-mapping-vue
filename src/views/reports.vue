<script setup>
import { tr } from '../i18n/index.js'

import { computed, onBeforeUnmount, onMounted, ref, watch, useId } from 'vue'
import { useRouter } from 'vue-router'
import AppAlert from '@/components/AppAlert.vue'
import EmptyState from '@/components/EmptyState.vue'
import http from '@/utils/http'
import { timeSettings } from '../i18n/time.js'
import { reportDate, reportPeriod, reportStatuses } from '@/utils/reports'

const formFieldId = useId()
const router = useRouter()
const reports = ref([])
const total = ref(0)
const page = ref(1)
const filter = ref('')
const loading = ref(true)
const error = ref('')
const forbidden = ref(false)
const alerts = ref([])
const generating = ref(false)
const generation = ref({ period_type: 'weekly', date: '' })
const settings = ref(null)
const settingsError = ref('')
const saving = ref('')
const plans = ref([])
const pages = computed(() => Math.max(1, Math.ceil(total.value / 20)))
let timer
let controller
let disposed = false

function alert(type, title) {
  alerts.value.unshift({ id: crypto.randomUUID(), type, title, timeout: 7000 })
}

async function loadReports({ silent = false } = {}) {
  clearTimeout(timer)
  controller?.abort()
  const request = new AbortController()
  controller = request
  if (!silent) loading.value = true
  try {
    const response = await http.get('/api/reports', { signal: request.signal, params: { page: page.value, ...(filter.value ? { period_type: filter.value } : {}) } })
    if (request.signal.aborted || disposed) return
    if (!response.data?.success) throw new Error(tr("报告列表加载失败"))
    reports.value = response.data.data.items
    total.value = response.data.data.total
    error.value = ''
    forbidden.value = false
  } catch (e) {
    if (request.signal.aborted || disposed) return
    forbidden.value = e.response?.status === 403
    error.value = e.response?.data?.message || tr("报告列表加载失败，请重试。")
  } finally {
    if (!request.signal.aborted && !disposed) {
      loading.value = false
      if (reports.value.some((r) => ['queued', 'waiting_data', 'generating'].includes(r.status))) {
        timer = setTimeout(() => loadReports({ silent: true }), 5000)
      }
    }
  }
}

async function loadSettings() {
  try {
    const response = await http.get('/api/report-schedules')
    if (disposed) return
    settings.value = response.data.data
    plans.value = response.data.data.schedules.map((s) => ({ ...s, recipient_ids: [...s.recipient_ids],
      bot_channels: (response.data.data.bot_channels || []).filter((c) => c.enabled && c.minimum_severity === 'warning')
        .map((c) => ({ ...c, selected: c.event_types.includes(`report.${s.period_type}`) })) }))
    settingsError.value = ''
  } catch (e) {
    if (!disposed) settingsError.value = e.response?.data?.message || tr("计划配置加载失败")
  }
}

async function generate() {
  generating.value = true
  try {
    const response = await http.post('/api/reports/generate', { period_type: generation.value.period_type, ...(generation.value.date ? { date: generation.value.date } : {}) })
    await router.push(`/reports/${response.data.data.id}`)
  } catch (e) {
    alert('error', e.response?.data?.message || tr("生成请求失败"))
  } finally {
    generating.value = false
  }
}

async function savePlan(plan) {
  saving.value = plan.period_type
  try {
    await http.put(`/api/report-schedules/${plan.period_type}`, {
      enabled: plan.enabled, send_hour: Number(plan.send_hour), send_minute: Number(plan.send_minute),
      recipient_ids: plan.recipient_ids, expected_revision: plan.revision,
      bot_channels: plan.bot_channels.map(({ id, revision, selected }) => ({ id, revision, selected })),
    })
    alert('success', tr("报告计划已保存"))
    await loadSettings()
  } catch (e) {
    alert('error', e.response?.data?.message || tr("保存失败"))
    if (e.response?.status === 409) await loadSettings()
  } finally {
    saving.value = ''
  }
}

watch(() => timeSettings.timezone, () => loadSettings())

watch(filter, () => { if (page.value !== 1) page.value = 1; else loadReports() })
watch(page, () => loadReports())
onMounted(async () => { await loadReports(); if (!forbidden.value && !disposed) await loadSettings() })
onBeforeUnmount(() => { disposed = true; clearTimeout(timer); controller?.abort() })
</script>

<template>
  <div class="page-shell space-y-6">
    <AppAlert v-for="item in alerts" :key="item.id" v-bind="item" @close="alerts = alerts.filter((a) => a.id !== item.id)" />
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h1 class="page-title">{{ tr("报告中心") }}</h1><p class="mt-1 text-sm text-base-content/60">{{ tr("管理员平台周报与月报 ·") }} {{ timeSettings.timezone }} {{ tr("· 归档后保留统计快照") }}</p></div>
      <button class="btn btn-sm btn-ghost" :disabled="loading" @click="loadReports(); loadSettings()">{{ tr("刷新") }}</button>
    </div>
    <EmptyState v-if="forbidden" type="error" :title="tr(&quot;仅管理员可以访问平台报告&quot;)" />
    <template v-else>
      <div class="card border border-base-300 bg-base-100 p-5">
        <h2 class="font-semibold">{{ tr("手动生成") }}</h2>
        <p class="mt-1 text-sm text-base-content/60">{{ tr("留空日期生成上一完整周期；指定日期生成该日期所在的完整周或月。生成后会通知已订阅的渠道，也可在详情页手动发送。") }}</p>
        <form class="mt-4 flex flex-wrap items-end gap-3" @submit.prevent="generate">
          <fieldset class="fieldset min-w-0 w-full sm:w-auto"><legend class="fieldset-legend"><label :for="`${formFieldId}-1`" class="opacity-60">{{ tr("周期") }}</label></legend><select :id="`${formFieldId}-1`" v-model="generation.period_type" class="select select-bordered w-full"><option value="weekly">{{ tr("周报") }}</option><option value="monthly">{{ tr("月报") }}</option></select></fieldset>
          <fieldset class="fieldset min-w-0 w-full sm:w-auto"><legend class="fieldset-legend"><label :for="`${formFieldId}-2`" class="opacity-60">{{ tr("周期内日期（可选）") }}</label></legend><input :id="`${formFieldId}-2`" v-model="generation.date" type="date" class="input input-bordered w-full" /></fieldset>
          <button class="btn btn-neutral" :disabled="generating"><span v-if="generating" class="loading loading-spinner loading-xs" />{{ tr("生成报告") }}</button>
        </form>
      </div>
      <div v-if="settingsError" role="alert" class="alert alert-warning"><span>{{ settingsError }}</span><button class="btn btn-sm" @click="loadSettings">{{ tr("重试") }}</button></div>
      <div v-if="settings" class="space-y-3">
        <div v-if="!settings.analytics_ready" class="alert alert-warning"><span>{{ tr("分析快照尚未启用。请在") }}<router-link class="link" to="/setting/runtime">{{ tr("运行策略") }}</router-link>{{ tr("中选择 shadow 或 snapshot 并完成回填；报告会等待统计完整。") }}</span></div>
        <div v-if="!settings.mail_ready" class="alert alert-info"><span>{{ tr("手动发送完整报告邮件需要配置邮件渠道；飞书和 Telegram 通知可独立订阅。配置入口：") }}<router-link class="link" to="/setting/notifications">{{ tr("通知渠道") }}</router-link>。</span></div>
        <p v-if="settings.mail_images_ready === false" class="text-sm text-base-content/60">{{ tr("远程趋势图尚未启用，邮件仍包含文字统计。可在") }}<router-link class="link" to="/setting/runtime">{{ tr("运行策略 → 报告邮件") }}</router-link>{{ tr("中设置外部 HTTPS 地址并启用图片。") }}</p>
        <div class="grid gap-4 lg:grid-cols-2">
          <form v-for="plan in plans" :key="plan.period_type" class="card border border-base-300 bg-base-100 p-5" @submit.prevent="savePlan(plan)">
            <div class="flex items-center justify-between gap-3"><h2 class="font-semibold">{{ plan.period_type === 'weekly' ? tr("自动周报") : tr("自动月报") }}</h2><label class="flex items-center gap-2 text-sm"><input v-model="plan.enabled" type="checkbox" class="toggle toggle-neutral toggle-sm" />{{ tr("启用") }}</label></div>
            <p class="mt-2 text-xs text-base-content/60">{{ plan.period_type === 'weekly' ? tr("周一发送上一周报告") : tr("每月 1 日发送上一自然月报告") }}{{ tr("。启用后从下一周期开始，不补发启用前的历史。") }}</p>
            <p v-if="plan.enabled && !settings.notifications[plan.period_type]" class="mt-2 text-sm text-warning">{{ tr("尚无启用渠道订阅此类报告，报告仍会生成；请在通知渠道中选择接收方式。") }}</p>
            <div class="mt-4 flex items-center gap-2"><span class="text-sm">{{ tr("发送时间") }}</span><input v-model="plan.send_hour" type="number" min="0" max="23" required class="input input-bordered input-sm w-20" :aria-label="tr(&quot;发送小时&quot;)" /><span>:</span><input v-model="plan.send_minute" type="number" min="0" max="59" required class="input input-bordered input-sm w-20" :aria-label="tr(&quot;发送分钟&quot;)" /></div>
            <fieldset class="mt-4"><legend class="text-sm font-medium">{{ tr("飞书与 Telegram 通知渠道") }}</legend><p class="mt-1 text-xs opacity-60">{{ tr("勾选后订阅该周期的报告生成事件；修改也会同步到通知渠道。") }}</p>
              <label v-for="channel in plan.bot_channels" :key="channel.id" class="mt-2 flex items-center gap-2 text-sm"><input v-model="channel.selected" type="checkbox" class="checkbox checkbox-sm" /><span>{{ channel.provider === 'feishu' ? tr("飞书") : 'Telegram' }} · {{ channel.name }}</span></label>
              <p v-if="!plan.bot_channels.length" class="mt-2 text-sm opacity-60">{{ tr("没有可用的飞书或 Telegram 渠道。请启用渠道并将最低级别设为警告。") }}</p>
              <router-link class="link mt-2 inline-block text-xs" to="/setting/notifications">{{ tr("管理通知渠道") }}</router-link>
            </fieldset>
            <fieldset class="mt-4"><legend class="text-sm font-medium">{{ tr("邮件默认收件管理员（选填）") }}</legend><p class="mt-1 text-xs opacity-60">{{ tr("仅影响未指定收件人的邮件渠道；不勾选时使用所有有效管理员邮箱。飞书和 Telegram 使用各自配置的目标。") }}</p>
              <label v-for="user in settings.recipients" :key="user.id" class="mt-2 flex items-center gap-2 text-sm"><input v-model="plan.recipient_ids" type="checkbox" class="checkbox checkbox-sm" :value="user.id" :disabled="!user.email" /><span>{{ user.username }} · {{ user.email || tr("未设置邮箱") }}</span></label>
            </fieldset>
            <div class="mt-4 flex flex-wrap items-center justify-between gap-2"><span class="text-xs opacity-60">{{ tr("下次：") }}{{ reportDate(plan.next_run_at, true, plan.timezone) }}</span><button class="btn btn-sm btn-neutral" :disabled="!!saving || (plan.enabled && !settings.analytics_ready)">{{ saving === plan.period_type ? tr("保存中…") : tr("保存计划") }}</button></div>
          </form>
        </div>
      </div>
      <div class="card border border-base-300 bg-base-100 p-5">
        <div class="mb-4 flex items-center justify-between"><h2 class="font-semibold">{{ tr("历史报告") }}</h2><select v-model="filter" class="select select-bordered select-sm" :aria-label="tr(&quot;筛选报告类型&quot;)"><option value="">{{ tr("全部周期") }}</option><option value="weekly">{{ tr("周报") }}</option><option value="monthly">{{ tr("月报") }}</option></select></div>
        <div v-if="loading" class="grid min-h-48 place-items-center"><span class="loading loading-spinner loading-lg" /></div>
        <EmptyState v-else-if="error" type="error" :title="tr(&quot;列表加载失败&quot;)" :message="error" />
        <EmptyState v-else-if="!reports.length" :title="tr(&quot;暂无报告&quot;)" :message="tr(&quot;生成上一周或上一月的报告，或启用自动报告计划。&quot;)" />
        <div v-else class="overflow-x-auto"><table class="table"><thead><tr><th>{{ tr("周期") }}</th><th>{{ tr("修订") }}</th><th>{{ tr("状态") }}</th><th>{{ tr("生成时间") }}</th><th></th></tr></thead><tbody>
          <tr v-for="report in reports" :key="report.id"><td><span class="font-medium">{{ report.period_type === 'weekly' ? tr("周报") : tr("月报") }}</span><div class="mt-1 text-xs opacity-60">{{ reportPeriod(report) }}</div></td><td>#{{ report.revision }}</td><td><span class="badge" :class="reportStatuses[report.status]?.class">{{ reportStatuses[report.status]?.label || report.status }}</span></td><td>{{ reportDate(report.generated_at, true) }}</td><td><router-link class="btn btn-sm btn-ghost" :to="`/reports/${report.id}`">{{ tr("查看") }}</router-link></td></tr>
        </tbody></table></div>
        <div class="mt-4 flex items-center justify-end gap-3"><span class="text-xs opacity-60">{{ tr("共") }} {{ total }} {{ tr("份 ·") }} {{ page }} / {{ pages }} {{ tr("页") }}</span><button class="btn btn-sm" :disabled="page <= 1 || loading" @click="page--">{{ tr("上一页") }}</button><button class="btn btn-sm" :disabled="page >= pages || loading" @click="page++">{{ tr("下一页") }}</button></div>
      </div>
    </template>
  </div>
</template>
