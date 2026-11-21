<script setup>
import { tr } from '../i18n/index.js'

import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import http from '@/utils/http'
import { settingsForm, settingsPayload, validateSettings } from '@/utils/humanVerificationSettings.js'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'

const fieldId = useId()
const confirmDialog = ref(null)
const endpoint = '/api/config/human-verification'
const form = ref(null)
const saved = ref('')
const savedProvider = ref('none')
const loading = ref(true)
const saving = ref(false)
const forbidden = ref(false)
const failed = ref(false)
const conflict = ref(false)
const alert = ref(null)
const dirty = computed(() => !!form.value && JSON.stringify(form.value) !== saved.value)
const problem = computed(() => form.value ? validateSettings(form.value) : '')
let disposed = false
let readController

function apply(data) {
  form.value = settingsForm(data)
  saved.value = JSON.stringify(form.value)
  savedProvider.value = form.value.provider
  conflict.value = false
}

async function load() {
  if (saving.value || (dirty.value && !await confirmDialog.value.ask({ message: tr("重新加载会放弃未保存的修改，是否继续？"), confirmText: tr("放弃修改"), danger: true }))) return
  readController?.abort()
  const controller = new AbortController()
  readController = controller
  loading.value = true
  failed.value = false
  try {
    const response = await http.get(endpoint, { signal: controller.signal, timeout: 10000 })
    if (disposed || controller.signal.aborted) return
    if (response.data?.success !== true) throw new Error(tr("配置读取失败"))
    apply(response.data.data)
    forbidden.value = false
  } catch (error) {
    if (disposed || controller.signal.aborted) return
    failed.value = true
    forbidden.value = error.response?.status === 403
  } finally {
    if (!disposed && !controller.signal.aborted) loading.value = false
  }
}

async function save() {
  if (saving.value || loading.value || forbidden.value || failed.value || conflict.value || !dirty.value || problem.value) return false
  saving.value = true
  alert.value = null
  try {
    const response = await http.put(endpoint, settingsPayload(form.value))
    if (disposed) return false
    if (response.data?.success !== true) throw new Error(tr("配置保存失败"))
    apply(response.data.data)
    alert.value = { type: 'success', get title() { return tr("登录保护已保存") }, get description() { return tr("新的密码登录将使用当前设置。已打开的登录页请刷新后重试。") } }
    return true
  } catch (error) {
    if (disposed) return false
    conflict.value = error.response?.status === 409
    forbidden.value = error.response?.status === 403
    if (forbidden.value) form.value.secret_key = ''
    alert.value = { type: 'error', get title() { return tr("登录保护保存失败") }, description: conflict.value
      ? tr("配置已被其他管理员更新。请重新加载后再修改，当前输入尚未保存。")
      : error.response?.data?.message || tr("请检查网络连接后重试。") }
    return false
  } finally {
    if (!disposed) saving.value = false
  }
}

useUnsavedChanges(dirty, save, confirmDialog)
onMounted(load)
onBeforeUnmount(() => { disposed = true; readController?.abort(); if (form.value) form.value.secret_key = '' })
</script>

<template>
  <div class="page-shell space-y-5">
    <ConfirmDialog ref="confirmDialog" />
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div><h1 class="page-title">{{ tr("登录保护") }}</h1><p class="mt-2 text-sm opacity-60">{{ tr("配置密码登录的人机验证。保存后应用于新的登录，现有会话和两步验证沿用原有规则。") }}</p></div>
      <button type="button" class="btn btn-outline btn-sm" :disabled="loading || saving" @click="load">{{ tr("重新加载") }}</button>
    </div>
    <AppAlert v-if="alert" :type="alert.type" :title="alert.title" :description="alert.description" @close="alert = null" />
    <div v-if="loading" class="card border border-base-300 bg-base-100 p-6" role="status"><span class="loading loading-spinner loading-sm" />{{ tr("正在加载登录保护配置…") }}</div>
    <div v-else-if="forbidden" class="alert alert-error" role="alert">{{ tr("仅管理员可以查看和修改登录保护。") }}</div>
    <div v-else-if="failed" class="alert alert-error" role="alert">{{ tr("配置加载失败，请重新加载。加载成功前无法修改设置。") }}</div>
    <form v-else-if="form" class="card space-y-5 border border-base-300 bg-base-100 p-5" @submit.prevent="save">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-lg font-semibold">{{ tr("人机验证") }}</h2>
        <span class="badge" :class="savedProvider === 'none' ? 'badge-ghost' : 'badge-success'">{{ savedProvider === 'none' ? tr("当前未启用") : tr("当前已启用 Turnstile") }}</span>
      </div>
      <fieldset class="grid min-w-0 gap-5" :disabled="saving">
        <div class="grid min-w-0 gap-5 md:grid-cols-2">
          <div class="min-w-0"><label class="mb-2 block text-sm font-medium" :for="`${fieldId}-provider`">{{ tr("验证服务") }}</label><select :id="`${fieldId}-provider`" v-model="form.provider" class="select select-bordered w-full"><option value="none">{{ tr("关闭") }}</option><option value="turnstile">Cloudflare Turnstile</option></select><p class="mt-2 text-xs opacity-60">{{ tr("关闭时不加载外部验证组件；开启后每次密码登录都须完成验证。") }}</p></div>
          <div class="min-w-0"><label class="mb-2 block text-sm font-medium" :for="`${fieldId}-site-key`">Site Key</label><input :id="`${fieldId}-site-key`" v-model="form.site_key" class="input input-bordered w-full" autocomplete="off" maxlength="256" :placeholder="tr(&quot;填写 Turnstile Site Key&quot;)" /><p class="mt-2 text-xs opacity-60">{{ tr("用于登录页小组件的公开密钥。") }}</p></div>
        </div>
        <div class="grid min-w-0 gap-5 md:grid-cols-2">
          <div class="min-w-0"><div class="mb-2 flex items-center justify-between gap-2"><label class="text-sm font-medium" :for="`${fieldId}-secret`">Secret Key</label><span class="badge badge-sm badge-ghost">{{ form.secret_key_configured ? tr("已配置") : tr("未配置") }}</span></div><input :id="`${fieldId}-secret`" v-model="form.secret_key" type="password" class="input input-bordered w-full" autocomplete="new-password" maxlength="2048" :disabled="form.clear_secret" :placeholder="form.secret_key_configured ? tr(&quot;留空保留当前 Secret&quot;) : tr(&quot;填写 Turnstile Secret Key&quot;)" /><p class="mt-2 text-xs opacity-60">{{ tr("仅用于服务端验证，加密保存，保存后不会回显。") }}</p><label v-if="form.secret_key_configured" class="mt-3 flex items-center gap-2 text-sm"><input v-model="form.clear_secret" type="checkbox" class="checkbox checkbox-sm" :disabled="!!form.secret_key" />{{ tr("清除已保存的 Secret") }}</label></div>
          <div class="min-w-0"><label class="mb-2 block text-sm font-medium" :for="`${fieldId}-hosts`">{{ tr("允许域名") }}</label><textarea :id="`${fieldId}-hosts`" v-model="form.hostnames" class="textarea textarea-bordered min-h-28 w-full" placeholder="console.example.com&#10;login.example.com" /><p class="mt-2 text-xs opacity-60">{{ tr("每行一个，最多 32 个；包含所填域名及其各级子域名。不含协议、路径、端口或通配符。需与 Cloudflare widget 域名设置一致。") }}</p></div>
        </div>
        <details class="rounded-box border border-base-300 p-4">
          <summary class="cursor-pointer text-sm font-medium">{{ tr("连接与流量限制") }}</summary>
          <div class="mt-4 grid min-w-0 gap-4 md:grid-cols-3">
            <div><label class="mb-2 block text-sm" :for="`${fieldId}-timeout`">{{ tr("验证超时（毫秒）") }}</label><input :id="`${fieldId}-timeout`" v-model.number="form.timeout_ms" type="number" min="500" max="10000" step="1" class="input input-bordered w-full" /></div>
            <div><label class="mb-2 block text-sm" :for="`${fieldId}-connect-timeout`">{{ tr("连接超时（毫秒）") }}</label><input :id="`${fieldId}-connect-timeout`" v-model.number="form.connect_timeout_ms" type="number" min="1" :max="form.timeout_ms" step="1" class="input input-bordered w-full" /></div>
            <div><label class="mb-2 block text-sm" :for="`${fieldId}-concurrency`">{{ tr("单实例验证并发上限") }}</label><input :id="`${fieldId}-concurrency`" v-model.number="form.max_in_flight" type="number" min="1" max="256" step="1" class="input input-bordered w-full" /></div>
          </div>
          <label class="mt-4 flex items-center gap-2 text-sm"><input v-model="form.send_remote_ip" type="checkbox" class="checkbox checkbox-sm" />{{ tr("向验证服务发送访问者 IP") }}</label><p class="mt-2 text-xs opacity-60">{{ tr("默认关闭。开启时使用平台的可信代理规则解析客户端地址。") }}</p>
        </details>
        <div><label class="mb-2 block text-sm font-medium" :for="`${fieldId}-reason`">{{ tr("变更说明（选填）") }}</label><input :id="`${fieldId}-reason`" v-model="form.change_reason" class="input input-bordered w-full" maxlength="500" :placeholder="tr(&quot;例如：启用登录人机验证&quot;)" /></div>
      </fieldset>
      <div v-if="conflict" class="alert alert-warning text-sm" role="alert">{{ tr("配置已被其他管理员更新。重新加载会放弃当前未保存的修改。") }}</div>
      <p v-if="dirty && problem" class="text-sm text-error" role="alert">{{ problem }}</p>
      <div class="flex flex-wrap items-center justify-between gap-3 border-t border-base-300 pt-4">
        <p class="text-xs opacity-60">{{ dirty ? tr("有未保存的修改") : tr("所有修改已保存") }}</p>
        <button type="submit" class="btn btn-neutral" :disabled="!dirty || !!problem || saving || conflict"><span v-if="saving" class="loading loading-spinner loading-sm" />{{ saving ? tr("保存中…") : tr("保存设置") }}</button>
      </div>
    </form>
  </div>
</template>
