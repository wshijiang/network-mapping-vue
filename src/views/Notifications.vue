<script setup>
import { tr } from '../i18n/index.js'

import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import { formatDateTime } from '../i18n/time.js'
import { channelForm, channelPayload, deliveryReason, deliveryStatuses, eventLabel, notificationEvents, notificationProviders, providerLabel, validateChannel } from '@/utils/notifications'
import http from '@/utils/http'

const formFieldId = useId()
const channels = ref([]), deliveries = ref([]), alerts = ref([])
const loading = ref(false), busy = ref(false), forbidden = ref(false), loadFailed = ref(false)
const editor = ref(null), form = ref(channelForm()), savedForm = ref('')
const bindingDialog = ref(null), bindingChannel = ref(null), bindingCode = ref(''), bindingStatus = ref(null), bindingBusy = ref(false)
const filterChannel = ref(''), filterStatus = ref(''), nextBefore = ref(null)
const historyLoading = ref(false), historyFailed = ref(false), lastRefresh = ref(null)
const browsingHistory = ref(false)
const dirty = computed(() => Boolean(editor.value?.open) && JSON.stringify(form.value) !== savedForm.value)
const confirmDialog = ref(null)
useUnsavedChanges(dirty, save, confirmDialog)
let sequence = 0, timer, bindingTimer, bindingController, disposed = false
const readControllers = new Set()

function notify(type, title, description = '') {
  alerts.value.unshift({ id: crypto.randomUUID(), type, title, description, timeout: 7000 })
}
function dataOf(response) {
  if (response.data?.success !== true) throw new Error(tr("通知服务响应无效"))
  return response.data.data
}
function errorText(error) { return error.response?.data?.message || tr("操作失败，请检查网络连接后重试。") }
async function loadChannels() {
  if (disposed) return
  const controller = new AbortController()
  readControllers.add(controller)
  loading.value = true
  try {
    const response = await http.get('/api/notifications/channels', { signal: controller.signal })
    if (disposed) return
    const data = dataOf(response)
    if (!Array.isArray(data)) throw new Error(tr("渠道列表无效"))
    channels.value = data
    loadFailed.value = false
    forbidden.value = false
  } catch (error) {
    if (disposed || controller.signal.aborted) return
    loadFailed.value = true
    forbidden.value = error.response?.status === 403
    if (forbidden.value) { channels.value = []; deliveries.value = [] }
  } finally {
    readControllers.delete(controller)
    if (!disposed) loading.value = false
  }
}
async function loadHistory(append = false) {
  if (disposed) return
  const controller = new AbortController()
  readControllers.add(controller)
  browsingHistory.value = append
  const request = ++sequence
  historyLoading.value = true
  const params = {}
  if (filterChannel.value) params.channel_id = filterChannel.value
  if (filterStatus.value) params.status = filterStatus.value
  if (append && nextBefore.value) params.before = nextBefore.value
  try {
    const response = await http.get('/api/notifications/deliveries', { params, signal: controller.signal })
    if (disposed || request !== sequence) return
    const data = dataOf(response)
    if (!Array.isArray(data?.items)) throw new Error(tr("投递记录无效"))
    deliveries.value = append ? [...deliveries.value, ...data.items] : data.items
    nextBefore.value = data.next_before
    historyFailed.value = false
    lastRefresh.value = new Date()
  } catch (error) {
    if (disposed || controller.signal.aborted || request !== sequence) return
    historyFailed.value = true
    if (error.response?.status === 403) { forbidden.value = true; deliveries.value = [] }
  } finally {
    readControllers.delete(controller)
    if (!disposed && request === sequence) historyLoading.value = false
  }
}
function openEditor(channel) {
  form.value = channelForm(channel)
  savedForm.value = JSON.stringify(form.value)
  editor.value?.showModal()
}
async function closeEditor() {
  if (dirty.value && !await confirmDialog.value.ask({ message: tr("有未保存的渠道配置，确定放弃修改吗？"), confirmText: tr("放弃修改"), danger: true })) return
  editor.value?.close()
  form.value = channelForm()
  savedForm.value = ''
}
async function save() {
  if (busy.value) return
  const problem = validateChannel(form.value)
  if (problem) { notify('warning', tr("请检查渠道配置"), problem); return }
  if (form.value.provider === 'feishu' && form.value.settings.feishu_bot_type === 'app' && form.value.settings.feishu_target_type === 'user' && !form.value.settings.feishu_open_id.trim()) form.value.enabled = false
  busy.value = true
  try {
    dataOf(await http({ method: form.value.id ? 'PUT' : 'POST', url: `/api/notifications/channels${form.value.id ? `/${form.value.id}` : ''}`, data: channelPayload(form.value) }))
    savedForm.value = JSON.stringify(form.value)
    editor.value?.close()
    form.value = channelForm()
    notify('success', tr("渠道已保存"), tr("已取消该渠道尚未完成的旧投递；后续事件使用新配置。"))
    await loadChannels()
    await loadHistory()
  } catch (error) { notify('error', tr("保存失败"), errorText(error)) }
  finally { busy.value = false }
}
async function action(channel, kind) {
  if (busy.value) return
  if (kind === 'delete' && !await confirmDialog.value.ask({ message: tr("确定删除“{0}”并取消其待处理通知吗？", [channel.name]), confirmText: tr("删除"), danger: true })) return
  busy.value = true
  try {
    if (kind === 'test') {
      const data = dataOf(await http.post(`/api/notifications/channels/${channel.id}/test`))
      notify('success', tr("测试已入队"), tr("请在投递记录中查看结果。投递 ID：{0}", [data.delivery_id]))
    } else if (kind === 'delete') {
      dataOf(await http.delete(`/api/notifications/channels/${channel.id}`, { data: { expected_revision: channel.revision } }))
      if (filterChannel.value === channel.id) filterChannel.value = ''
      notify('success', tr("渠道已删除"))
    } else {
      const payload = channelPayload(channelForm(channel))
      payload.enabled = !channel.enabled
      dataOf(await http.put(`/api/notifications/channels/${channel.id}`, payload))
      notify('success', payload.enabled ? tr("渠道已启用") : tr("渠道已停用"))
    }
    await loadChannels()
    await loadHistory()
  } catch (error) { notify('error', tr("操作失败"), errorText(error)) }
  finally { busy.value = false }
}
async function retry(item) {
  if (busy.value) return
  busy.value = true
  try {
    dataOf(await http.post(`/api/notifications/deliveries/${item.id}/retry`))
    notify('success', tr("已重新入队"), tr("重试可能产生重复消息，请关注事件 ID。"))
    await loadHistory()
  } catch (error) { notify('error', tr("重试失败"), errorText(error)) }
  finally { busy.value = false }
}
async function pollBinding() {
  window.clearTimeout(bindingTimer)
  if (disposed || !bindingChannel.value || !bindingDialog.value?.open) return
  bindingController?.abort()
  const controller = new AbortController()
  bindingController = controller
  try {
    const state = dataOf(await http.get(`/api/notifications/channels/${bindingChannel.value.id}/feishu-binding`, { signal: controller.signal }))
    if (disposed || controller.signal.aborted) return
    bindingStatus.value = state
    if (state.binding_status === 'bound') { bindingCode.value = ''; await loadChannels(); return }
    if (state.binding_status === 'expired' || state.binding_status === 'cancelled') { bindingCode.value = ''; return }
  } catch (error) {
    if (!disposed && !controller.signal.aborted) notify('warning', tr("绑定状态加载失败"), errorText(error))
  }
  if (!disposed && bindingDialog.value?.open) bindingTimer = window.setTimeout(pollBinding, 3000)
}
async function startBinding(channel) {
  if (bindingBusy.value || busy.value) return
  bindingBusy.value = true
  try {
    const data = dataOf(await http.post(`/api/notifications/channels/${channel.id}/feishu-binding`, { expected_revision: channel.revision }))
    bindingChannel.value = channel; bindingCode.value = data.code; bindingStatus.value = { binding_status: 'pending', expires_at: data.expires_at, connection_status: 'connecting' }
    bindingDialog.value?.showModal()
    await pollBinding()
  } catch (error) { notify('error', tr("生成绑定码失败"), errorText(error)) }
  finally { bindingBusy.value = false }
}
function closeBinding() {
  window.clearTimeout(bindingTimer); bindingController?.abort(); bindingController = null
  bindingDialog.value?.close(); bindingCode.value = ''; bindingChannel.value = null; bindingStatus.value = null
}
async function cancelBinding() {
  if (!bindingChannel.value || bindingBusy.value) return
  bindingBusy.value = true
  try { dataOf(await http.delete(`/api/notifications/channels/${bindingChannel.value.id}/feishu-binding`)); closeBinding() }
  catch (error) { notify('error', tr("取消绑定失败"), errorText(error)) }
  finally { bindingBusy.value = false }
}
async function unbindRecipient(channel) {
  if (busy.value || bindingBusy.value || !await confirmDialog.value.ask({ message: tr("解除个人绑定会停用渠道并取消待处理通知，确定继续吗？"), confirmText: tr("解绑"), danger: true })) return
  busy.value = true
  try {
    dataOf(await http.delete(`/api/notifications/channels/${channel.id}/feishu-binding/recipient`, { data: { expected_revision: channel.revision } }))
    notify('success', tr("已解除个人绑定"))
    await loadChannels()
    await loadHistory()
  } catch (error) { notify('error', tr("操作失败"), errorText(error)) }
  finally { busy.value = false }
}
async function refresh() { await loadChannels(); if (!disposed && !forbidden.value) await loadHistory() }
onMounted(async () => {
  await refresh()
  if (disposed) return
  timer = window.setInterval(() => {
    if (!disposed && !document.hidden && !busy.value && !historyLoading.value && !forbidden.value && !browsingHistory.value) loadHistory()
  }, 15000)
})
onBeforeUnmount(() => {
  disposed = true
  ++sequence
  window.clearInterval(timer)
  window.clearTimeout(bindingTimer); bindingController?.abort()
  for (const controller of readControllers) controller.abort()
  readControllers.clear()
})
</script>

<template>
  <div class="page-shell space-y-6">
    <ConfirmDialog ref="confirmDialog" />
    <AppAlert v-for="item in alerts" :key="item.id" v-bind="item" @close="alerts = alerts.filter(value => value.id !== item.id)" />
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h1 class="page-title">{{ tr("通知渠道") }}</h1><p class="mt-2 text-sm opacity-60">{{ tr("统一管理邮件、飞书和 Telegram。各渠道独立启停、订阅通知，同一事件可同时发送到多个渠道。") }}</p></div>
      <div v-if="!forbidden" class="flex gap-2"><button class="btn btn-sm" :disabled="loading || historyLoading" @click="refresh">{{ tr("刷新") }}</button><button class="btn btn-neutral btn-sm" :disabled="busy || loadFailed" @click="openEditor()">{{ tr("添加通知渠道") }}</button></div>
    </div>
    <div v-if="forbidden" class="alert alert-warning" role="alert">{{ tr("仅管理员可以管理通知渠道和查看投递记录。") }}</div>
    <template v-else>
      <div v-if="loadFailed" class="alert alert-error" role="alert"><span>{{ tr("渠道加载失败，请刷新后重试。") }}</span><button class="btn btn-sm" @click="refresh">{{ tr("重试") }}</button></div>
      <section class="rounded-xl bg-base-100 p-4 md:p-6">
        <h2 class="text-lg font-semibold">{{ tr("渠道与事件订阅") }}</h2>
        <p class="mt-1 text-sm opacity-60">{{ tr("三种渠道提供相同的通知类型，可以只启用一种，也可以同时启用。修改或停用会取消旧配置下尚未完成的投递。") }}</p>
        <p v-if="loading" class="py-6" role="status">{{ tr("正在加载渠道…") }}</p>
        <p v-else-if="!channels.length && !loadFailed" class="py-8 text-center opacity-60">{{ tr("尚未配置渠道。添加邮件、飞书或 Telegram 渠道后，选择需要接收的通知。") }}</p>
        <div v-else class="mt-4 grid gap-4 lg:grid-cols-2">
          <article v-for="channel in channels" :key="channel.id" class="rounded-lg border border-base-300 p-4">
            <div class="flex items-center justify-between gap-3"><h3 class="break-all font-semibold">{{ channel.name }}</h3><span class="badge badge-sm" :class="channel.enabled ? 'badge-success' : 'badge-ghost'">{{ channel.enabled ? tr("已启用") : tr("已停用") }}</span></div>
            <span class="badge badge-outline badge-sm mt-2">{{ providerLabel(channel.provider || 'feishu') }}</span>
            <span v-if="channel.provider === 'feishu'" class="badge badge-outline badge-sm mt-2 ml-2">{{ channel.settings?.feishu_bot_type === 'app' ? tr("应用机器人") : tr("群聊自定义机器人") }}</span>
            <span v-if="channel.provider === 'feishu' && channel.settings?.feishu_bot_type === 'app'" class="badge badge-outline badge-sm mt-2 ml-2">{{ channel.settings?.feishu_target_type === 'user' ? tr("个人聊天") : tr("群聊") }}</span>
            <p class="mt-2 text-sm">{{ channel.event_types.map(eventLabel).join(' · ') }}</p>
            <p class="mt-2 text-xs opacity-60">{{ channel.minimum_severity === 'critical' ? tr("仅严重通知") : tr("警告及严重通知") }} · {{ channel.provider === 'feishu' ? (channel.settings?.feishu_bot_type === 'app' ? tr("已配置应用凭据") : (channel.signing_secret_configured ? tr("已配置签名") : tr("未配置签名"))) : (channel.credential_configured ? tr("已配置凭据") : tr("待配置凭据")) }} {{ tr("· 版本") }} {{ channel.revision }}</p>
            <p v-if="channel.provider === 'feishu'" class="mt-1 text-xs opacity-60">{{ channel.feishu_app_secret_configured ? tr("报告趋势图：已配置上传凭据") : tr("报告趋势图：仅文本，未配置上传凭据") }}</p>
            <p class="mt-1 text-xs opacity-60 break-all">{{ tr("代理：") }}{{ channel.proxy_mode === 'custom' ? channel.proxy_endpoint : channel.proxy_mode === 'direct' ? tr("直接连接") : tr("跟随全局") }}</p>
            <div class="mt-4 flex flex-wrap gap-2">
              <button class="btn btn-sm" :disabled="busy || loadFailed" @click="openEditor(channel)">{{ tr("编辑") }}</button>
              <button v-if="channel.provider === 'feishu' && channel.settings?.feishu_bot_type === 'app'" class="btn btn-sm" :disabled="busy || bindingBusy || loadFailed" @click="startBinding(channel)">{{ channel.settings?.feishu_target_type === 'user' && channel.settings?.feishu_open_id ? tr("重新绑定个人") : tr("绑定个人") }}</button>
              <button v-if="channel.provider === 'feishu' && channel.settings?.feishu_bot_type === 'app' && channel.settings?.feishu_target_type === 'user' && channel.settings?.feishu_open_id" class="btn btn-sm" :disabled="busy || bindingBusy || loadFailed" @click="unbindRecipient(channel)">{{ tr("解除个人绑定") }}</button>
              <button class="btn btn-sm" :disabled="busy || !channel.enabled || loadFailed" @click="action(channel, 'test')">{{ tr("测试发送") }}</button>
              <button class="btn btn-sm" :disabled="busy || loadFailed" @click="action(channel, 'toggle')">{{ channel.enabled ? tr("停用") : tr("启用") }}</button>
              <button class="btn btn-ghost btn-sm text-error" :disabled="busy || loadFailed" @click="action(channel, 'delete')">{{ tr("删除") }}</button>
            </div>
          </article>
        </div>
      </section>
      <section class="rounded-xl bg-base-100 p-4 md:p-6">
        <div class="flex flex-wrap items-end justify-between gap-3"><div><h2 class="text-lg font-semibold">{{ tr("投递记录") }}</h2><p class="mt-1 text-xs opacity-60">{{ browsingHistory ? tr("正在查看历史，已暂停自动刷新。") : tr("自动刷新最新 50 条；点击加载更多查看历史。") }}{{ lastRefresh ? tr("最近刷新：{0}", [formatDateTime(lastRefresh)]) : '' }}</p></div>
          <div class="flex min-w-0 max-w-full items-center gap-2"><select v-model="filterChannel" :aria-label="tr(&quot;筛选通知渠道&quot;)" class="select select-bordered select-sm min-w-0 w-auto flex-1" @change="loadHistory()"><option value="">{{ tr("全部渠道") }}</option><option v-for="channel in channels" :key="channel.id" :value="channel.id">{{ channel.name }}</option></select><select v-model="filterStatus" :aria-label="tr(&quot;筛选投递状态&quot;)" class="select select-bordered select-sm min-w-0 w-auto flex-1" @change="loadHistory()"><option value="">{{ tr("全部状态") }}</option><option v-for="(label, value) in deliveryStatuses" :key="value" :value="value">{{ label }}</option></select></div>
        </div>
        <div v-if="historyFailed" class="alert alert-warning mt-4" role="alert"><span>{{ tr("投递记录刷新失败，当前显示上次结果。") }}</span><button class="btn btn-sm" @click="loadHistory()">{{ tr("重试") }}</button></div>
        <div class="mt-4 overflow-x-auto"><table class="table table-sm"><thead><tr><th>{{ tr("时间 / 渠道") }}</th><th>{{ tr("事件") }}</th><th>{{ tr("状态 / 尝试") }}</th><th>{{ tr("结果") }}</th><th /></tr></thead><tbody>
          <tr v-for="item in deliveries" :key="item.id"><td class="whitespace-nowrap"><div>{{ formatDateTime(item.created_at) }}</div><div class="max-w-56 truncate text-xs opacity-60">{{ item.channel_name }}</div></td><td><div>{{ eventLabel(item.event_type) }}</div><div class="max-w-64 truncate text-xs opacity-60" :title="item.title">{{ item.title }}</div></td><td class="whitespace-nowrap"><span class="badge badge-sm" :class="item.status === 'sent' ? 'badge-success' : item.status === 'failed' ? 'badge-error' : 'badge-ghost'">{{ deliveryStatuses[item.status] || item.status }}</span><div class="mt-1 text-xs opacity-60">{{ item.attempts }} {{ tr("次") }}</div></td><td class="min-w-48 text-xs"><div>{{ deliveryReason(item.last_error) }}</div><div v-if="item.response_status || item.provider_code != null" class="mt-1 opacity-60">HTTP {{ item.response_status || '—' }} {{ tr("· 服务码") }} {{ item.provider_code ?? '—' }}</div><div v-if="item.status === 'pending'" class="mt-1 opacity-60">{{ tr("计划：") }}{{ formatDateTime(item.available_at) }}</div></td><td><button v-if="item.status === 'failed'" class="btn btn-xs" :disabled="busy" @click="retry(item)">{{ tr("重试") }}</button></td></tr>
        </tbody></table></div>
        <p v-if="!deliveries.length && !historyLoading && !historyFailed" class="py-8 text-center text-sm opacity-60">{{ tr("暂无符合条件的投递记录。") }}</p>
        <div class="mt-4 flex justify-center"><button v-if="nextBefore" class="btn btn-sm" :disabled="historyLoading" @click="loadHistory(true)">{{ historyLoading ? tr("正在加载…") : tr("加载更多") }}</button><span v-else-if="historyLoading" role="status" class="text-sm opacity-60">{{ tr("正在刷新…") }}</span></div>
      </section>
    </template>
    <dialog ref="editor" class="modal" @cancel.prevent="closeEditor">
      <form class="modal-box space-y-5" @submit.prevent="save">
        <h2 class="text-lg font-semibold">{{ form.id ? tr("编辑通知渠道") : tr("添加通知渠道") }}</h2>
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-1`">{{ tr("渠道类型") }}</label></legend><select :id="`${formFieldId}-1`" :aria-label="tr(&quot;渠道类型&quot;)" v-model="form.provider" :disabled="Boolean(form.id)" class="select select-bordered w-full"><option v-for="provider in notificationProviders" :key="provider.value" :value="provider.value">{{ provider.label }}</option></select></fieldset>
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-2`">{{ tr("渠道名称") }}</label></legend><input :id="`${formFieldId}-2`" v-model="form.name" class="input input-bordered w-full" maxlength="80" required autocomplete="off" :placeholder="tr(&quot;例如：运维告警群&quot;)" /></fieldset>
        <template v-if="form.provider === 'feishu'">
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-feishu-type`">{{ tr("飞书机器人类型") }}</label></legend><select :id="`${formFieldId}-feishu-type`" v-model="form.settings.feishu_bot_type" :disabled="Boolean(form.id)" class="select select-bordered w-full"><option value="webhook">{{ tr("群聊自定义机器人") }}</option><option value="app">{{ tr("应用机器人") }}</option></select></fieldset>
        <template v-if="form.settings.feishu_bot_type === 'webhook'">
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-3`">{{ tr("Webhook 地址") }}{{ form.id ? tr("（留空保留）") : '' }}</label></legend><input :id="`${formFieldId}-3`" v-model="form.webhook_url" type="password" class="input input-bordered w-full" :required="!form.id" autocomplete="new-password" :placeholder="tr(&quot;粘贴飞书自定义机器人 Webhook&quot;)" /></fieldset>
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-4`">{{ tr("签名密钥") }}{{ form.id ? tr("（留空保留）") : tr("（建议配置）") }}</label></legend><input :id="`${formFieldId}-4`" v-model="form.signing_secret" type="password" class="input input-bordered w-full" autocomplete="new-password" :disabled="form.clear_signing_secret" /></fieldset>
        <label v-if="form.signing_secret_configured" class="flex items-center gap-2 text-sm"><input v-model="form.clear_signing_secret" type="checkbox" class="checkbox checkbox-sm" />{{ tr("清除已保存的签名密钥") }}</label>
        </template>
        <template v-if="form.settings.feishu_bot_type === 'app'">
        <fieldset><legend class="mb-2 text-sm">{{ tr("接收对象") }}</legend><div class="flex flex-wrap gap-4"><label class="flex items-center gap-2 text-sm"><input v-model="form.settings.feishu_target_type" :name="`${formFieldId}-feishu-target`" type="radio" value="group" class="radio radio-sm" />{{ tr("群聊") }}</label><label class="flex items-center gap-2 text-sm"><input v-model="form.settings.feishu_target_type" :name="`${formFieldId}-feishu-target`" type="radio" value="user" class="radio radio-sm" />{{ tr("个人聊天") }}</label></div><p v-if="form.id" class="mt-2 text-xs opacity-60">{{ tr("更改接收对象并保存后，旧配置下未完成的投递会取消。") }}</p></fieldset>
        <fieldset v-if="form.settings.feishu_target_type === 'group'" class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-feishu-chat-id`">{{ tr("飞书群聊 ID") }}</label></legend><input :id="`${formFieldId}-feishu-chat-id`" v-model="form.settings.feishu_chat_id" class="input input-bordered w-full" required placeholder="oc_..." /></fieldset>
        <p v-else class="text-xs opacity-60">{{ form.settings.feishu_open_id ? tr("已配置个人接收者，可在渠道列表重新绑定。") : form.id && form.original_feishu_target === 'group' ? tr("请在渠道列表点击“绑定个人”，绑定成功后自动切换目标。") : tr("保存后渠道暂不启用，请在渠道列表点击“绑定个人”，通过飞书私聊发送绑定指令。") }}</p>
        </template>
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-feishu-app-id`">{{ form.settings.feishu_bot_type === 'app' ? tr("飞书应用 ID") : tr("飞书应用 ID（报告图片）") }}</label></legend><input :id="`${formFieldId}-feishu-app-id`" v-model="form.settings.feishu_app_id" class="input input-bordered w-full" :required="form.settings.feishu_bot_type === 'app'" autocomplete="off" /></fieldset>
        <p v-if="form.id && form.settings.feishu_bot_type === 'app' && form.settings.feishu_target_type === 'user' && form.original_feishu_app_id !== form.settings.feishu_app_id.trim()" class="text-xs opacity-60">{{ tr("更换应用后渠道将停用，需要重新绑定个人接收者。") }}</p>
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-feishu-app-secret`">{{ tr("飞书应用密钥") }}{{ form.feishu_app_secret_configured ? tr("（留空保留）") : '' }}</label></legend><input :id="`${formFieldId}-feishu-app-secret`" v-model="form.feishu_app_secret" type="password" class="input input-bordered w-full" autocomplete="new-password" :disabled="form.clear_feishu_app_secret" /></fieldset>
        <label v-if="form.feishu_app_secret_configured && form.settings.feishu_bot_type === 'webhook'" class="flex items-center gap-2 text-sm"><input v-model="form.clear_feishu_app_secret" type="checkbox" class="checkbox checkbox-sm" />{{ tr("清除应用密钥（同时清空应用 ID）") }}</label>
        <p v-if="form.settings.feishu_bot_type === 'webhook'" class="text-xs opacity-60">{{ tr("配置飞书自建应用凭据后，报告趋势图会先上传飞书，再发送到此机器人。未配置时发送文本。") }}</p>
        <p v-if="form.settings.feishu_bot_type === 'webhook'" class="text-xs opacity-60">{{ tr("机器人若开启关键词校验，请允许固定前缀“Network Mapping”。") }}</p>
        <p v-else-if="form.settings.feishu_target_type === 'group'" class="text-xs opacity-60">{{ tr("请启用并发布应用机器人，授予发送消息和上传图片权限，并将机器人加入目标群。测试发送只验证文字，报告图片须通过发送报告验证。") }}</p>
        <p v-else class="text-xs opacity-60">{{ tr("请启用并发布应用机器人，授予发送消息和上传图片权限。测试发送只验证文字，报告图片须通过发送报告验证。") }}</p>
        </template>
        <template v-else-if="form.provider === 'telegram'">
          <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-5`">Bot Token{{ form.id ? tr("（留空保留）") : '' }}</label></legend><input :id="`${formFieldId}-5`" v-model="form.bot_token" type="password" class="input input-bordered w-full" :required="!form.id" autocomplete="new-password" :placeholder="tr(&quot;从 BotFather 获取的 Token&quot;)" /></fieldset>
          <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-6`">Chat ID</label></legend><input :id="`${formFieldId}-6`" v-model="form.settings.chat_id" class="input input-bordered w-full" required :placeholder="tr(&quot;例如：-1001234567890 或 @channel_name&quot;)" /></fieldset>
          <p class="text-xs opacity-60">{{ tr("请先将机器人加入目标群或频道并允许发送消息；私聊须先向机器人发送 /start。") }}</p>
        </template>
        <template v-else-if="form.provider === 'email'">
          <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-7`">{{ tr("SMTP 服务器") }}</label></legend><input :id="`${formFieldId}-7`" v-model="form.settings.smtp_host" class="input input-bordered w-full" required placeholder="smtp.example.com" /></fieldset>
          <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-8`">{{ tr("SMTPS 端口") }}</label></legend><input :id="`${formFieldId}-8`" v-model.number="form.settings.smtp_port" type="number" min="1" max="65535" class="input input-bordered w-full" required /></fieldset>
          <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-9`">{{ tr("发件人邮箱 / 登录账号") }}</label></legend><input :id="`${formFieldId}-9`" v-model="form.settings.smtp_sender" type="email" class="input input-bordered w-full" required /></fieldset>
          <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-10`">{{ tr("发件邮箱密钥") }}{{ form.id ? tr("（留空保留）") : '' }}</label></legend><input :id="`${formFieldId}-10`" v-model="form.smtp_password" type="password" class="input input-bordered w-full" :required="!form.id && !form.credential_configured" autocomplete="new-password" /></fieldset>
          <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label for="notifications-form-recipients-text">{{ tr("收件人（选填，每行一个或逗号分隔）") }}</label></legend><textarea id="notifications-form-recipients-text" v-model="form.recipients_text" class="textarea textarea-bordered w-full" rows="3" :placeholder="tr(&quot;留空使用事件默认收件人&quot;)" /></fieldset>
          <p class="text-xs opacity-60">{{ tr("留空时，登录通知发给登录用户本人；报告按报告计划选择管理员，其余通知发给当前启用的管理员。填写后发送到指定邮箱。") }}</p>
        </template>
        <fieldset><legend class="mb-2 text-sm">{{ tr("通知事件") }}</legend><label v-for="event in notificationEvents" :key="event.value" class="mb-2 flex items-center gap-2 text-sm"><input v-model="form.event_types" :value="event.value" type="checkbox" class="checkbox checkbox-sm" />{{ event.label }}</label></fieldset>
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-11`">{{ tr("最低通知级别") }}</label></legend><select :id="`${formFieldId}-11`" :aria-label="tr(&quot;最低通知级别&quot;)" v-model="form.minimum_severity" class="select select-bordered w-full"><option value="warning">{{ tr("警告及严重（全部已选通知类型）") }}</option><option value="critical">{{ tr("仅严重健康告警（不发送登录、Scanner 或报告通知）") }}</option></select></fieldset>
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-proxy-mode`">{{ tr("投递代理") }}</label></legend><select :id="`${formFieldId}-proxy-mode`" v-model="form.proxy_mode" class="select select-bordered w-full"><option value="system">{{ tr("跟随全局（未配置时使用系统环境代理）") }}</option><option value="direct">{{ tr("直接连接") }}</option><option value="custom">{{ tr("指定代理") }}</option></select></fieldset>
        <fieldset v-if="form.proxy_mode === 'custom'" class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-proxy-url`">{{ tr("代理地址") }}{{ form.proxy_configured ? tr("（留空保留）") : '' }}</label></legend><input :id="`${formFieldId}-proxy-url`" v-model="form.proxy_url" type="text" autocomplete="off" maxlength="2048" class="input input-bordered w-full" :placeholder="tr(&quot;socks5h://用户名:密码@代理主机:1080&quot;)" /><p v-if="form.proxy_configured" class="text-xs break-all opacity-60">{{ tr("已配置：") }}{{ form.proxy_endpoint }}{{ tr("（认证信息不回显）") }}</p><p class="text-xs opacity-60">{{ tr("支持 HTTP、HTTPS、SOCKS5 与 SOCKS5H，适用于邮件和机器人。SOCKS5H 由代理解析目标域名。失败时不会回退直连。局部“指定代理”或“直接连接”会覆盖全局。") }}</p></fieldset>
        <p v-else-if="form.proxy_configured" class="text-xs opacity-60">{{ tr("保存此模式将清除该渠道已保存的代理地址和认证信息。") }}</p>
        <label class="flex items-center gap-2 text-sm"><input v-model="form.enabled" type="checkbox" class="toggle toggle-neutral" />{{ tr("启用渠道") }}</label>
        <p class="text-xs leading-relaxed opacity-60">{{ tr("Webhook、邮箱密钥和 Bot Token 保存后不会回显，编辑留空保留。测试发送需要先保存并启用渠道。") }}</p>
        <div class="modal-action"><button type="button" class="btn btn-sm" :disabled="busy" @click="closeEditor">{{ tr("取消") }}</button><button class="btn btn-neutral btn-sm" :disabled="busy">{{ busy ? tr("正在保存…") : tr("保存渠道") }}</button></div>
      </form>
    </dialog>
    <dialog ref="bindingDialog" class="modal" @cancel.prevent="closeBinding">
      <div class="modal-box space-y-4"><h2 class="text-lg font-semibold">{{ tr("绑定飞书个人聊天") }}</h2>
        <p class="text-sm">{{ tr("请将下面的指令发送给飞书应用机器人，绑定码 10 分钟内有效，只能使用一次。") }}</p>
        <div v-if="bindingCode" class="rounded-lg border border-base-300 p-3 font-mono break-all select-all">/bind {{ bindingCode }}</div>
        <p class="text-sm">{{ tr("绑定状态：") }}{{ bindingStatus?.binding_status === 'bound' ? tr("已绑定") : bindingStatus?.binding_status === 'expired' ? tr("绑定码已过期") : bindingStatus?.binding_status === 'cancelled' ? tr("已取消") : tr("等待用户发送指令") }}</p>
        <p class="text-xs opacity-60">{{ tr("连接状态：") }}{{ bindingStatus?.connection_status === 'connected' ? tr("已连接") : bindingStatus?.connection_status === 'conflict' ? tr("同一应用的凭据或代理不一致") : tr("连接中或未连接，请检查飞书权限与网络") }}</p>
        <p v-if="bindingStatus?.binding_status === 'bound'" class="text-xs opacity-60">{{ tr("绑定成功。新渠道需要在列表中启用后才会接收通知。") }}</p>
        <div class="modal-action"><button v-if="bindingStatus?.binding_status === 'pending'" type="button" class="btn btn-sm" :disabled="bindingBusy" @click="cancelBinding">{{ tr("取消绑定") }}</button><button type="button" class="btn btn-sm" @click="closeBinding">{{ tr("关闭") }}</button></div>
      </div><form method="dialog" class="modal-backdrop"><button @click.prevent="closeBinding">{{ tr("关闭") }}</button></form>
    </dialog>
  </div>
</template>
