<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { tr } from '../i18n/index.js'
import AppAlert from '@/components/AppAlert.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import http from '@/utils/http'

const endpoint = '/api/data-export/settings/s3'
const fieldId = useId()
const confirmDialog = ref(null)
const current = ref(null)
const form = ref(null)
const saved = ref('')
const loading = ref(true)
const busy = ref('')
const forbidden = ref(false)
const failed = ref(false)
const conflict = ref(false)
const alert = ref(null)
const controller = new AbortController()
const dirty = computed(() => !!form.value && JSON.stringify(form.value) !== saved.value)
const proxyUrlRequired = computed(() => form.value?.proxy_mode === 'custom' && !current.value?.connection?.proxy_configured)
const credentialsIncomplete = computed(() => {
  const value = form.value
  if (value?.credential_mode !== 'static') return false
  const replacing = current.value?.connection?.credential_mode !== 'static'
    || value.access_key_id || value.secret_access_key || value.session_token
  return replacing && (!value.access_key_id.trim() || !value.secret_access_key.trim())
})
const canReset = computed(() => current.value?.overridden && (current.value.deployment_connection || !current.value.enabled))

function apply(data) {
  current.value = data
  const connection = data.connection
  form.value = {
    endpoint: connection?.endpoint ?? '',
    region: connection?.region ?? 'us-east-1',
    bucket: connection?.bucket ?? '',
    prefix: connection?.prefix ?? '',
    path_style: connection?.path_style ?? false,
    download_endpoint: connection?.download_endpoint ?? '',
    proxy_download: connection?.proxy_download ?? false,
    proxy_mode: connection?.proxy_mode ?? 'system',
    proxy_url: '',
    credential_mode: connection?.credential_mode ?? 'aws_chain',
    access_key_id: '',
    secret_access_key: '',
    session_token: '',
  }
  saved.value = JSON.stringify(form.value)
  conflict.value = false
}

async function load() {
  if (dirty.value && !await confirmDialog.value.ask({
    message: tr('重新加载会放弃未保存的修改，是否继续？'),
    confirmText: tr('放弃修改'),
    danger: true,
  })) return
  loading.value = true
  alert.value = null
  failed.value = false
  forbidden.value = false
  try {
    const { data } = await http.get(endpoint, { signal: controller.signal })
    apply(data.data)
  } catch (error) {
    if (controller.signal.aborted) return
    forbidden.value = error.response?.status === 403
    failed.value = true
  } finally {
    loading.value = false
  }
}

async function publish(connection, credentials = null) {
  busy.value = 'save'
  alert.value = null
  try {
    const { data } = await http.put(endpoint, { expected_revision: current.value.revision, connection, credentials })
    apply(data.data)
    alert.value = { type: 'success', title: tr('S3 连接设置已保存') }
    return true
  } catch (error) {
    conflict.value = error.response?.status === 409
    alert.value = {
      type: 'error',
      title: tr('S3 连接设置保存失败'),
      description: conflict.value
        ? tr('配置已被其他管理员更新。请重新加载后再修改，当前输入尚未保存。')
        : error.response?.data?.message || tr('请检查网络连接后重试。'),
    }
    return false
  } finally {
    busy.value = ''
  }
}

function save() {
  if (busy.value || loading.value || failed.value || conflict.value || !dirty.value ||
      !form.value.region.trim() || !form.value.bucket.trim() ||
      (proxyUrlRequired.value && !form.value.proxy_url.trim()) || credentialsIncomplete.value) return false
  const { credential_mode, access_key_id, secret_access_key, session_token, ...connection } = form.value
  const credentials = { mode: credential_mode }
  if (credential_mode === 'static' && access_key_id && secret_access_key) {
    credentials.values = { access_key_id: access_key_id.trim(), secret_access_key, session_token: session_token || null }
  }
  return publish({
    ...connection,
    region: connection.region.trim(),
    bucket: connection.bucket.trim(),
    prefix: connection.prefix.trim(),
    endpoint: connection.endpoint.trim() || null,
    download_endpoint: connection.download_endpoint.trim() || null,
    proxy_url: connection.proxy_mode === 'custom' ? connection.proxy_url.trim() || null : null,
  }, credentials)
}

async function reset() {
  if (busy.value || conflict.value || !canReset.value) return
  if (await confirmDialog.value.ask({
    message: tr('确定移除自定义 S3 连接并恢复部署默认值？'),
    confirmText: tr('恢复默认'),
    danger: true,
  })) await publish(null)
}

async function testStorage() {
  busy.value = 'test'
  alert.value = null
  try {
    await http.post('/api/data-export/settings/test-s3', null, { signal: controller.signal })
    alert.value = { type: 'success', title: tr('S3 连接测试通过') }
  } catch (error) {
    if (controller.signal.aborted) return
    alert.value = {
      type: 'error',
      title: tr('S3 连接测试失败'),
      description: error.response?.data?.message || tr('请检查网络连接后重试。'),
    }
  } finally {
    busy.value = ''
  }
}

useUnsavedChanges(dirty, save, confirmDialog)
onMounted(load)
onBeforeUnmount(() => controller.abort())
</script>

<template>
  <div class="page-shell space-y-5">
    <ConfirmDialog ref="confirmDialog" />
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="page-title">{{ tr('S3 存储管理') }}</h1>
      <RouterLink to="/data/export/settings" class="btn btn-ghost btn-sm">{{ tr('返回导出设置') }}</RouterLink>
    </header>

    <div v-if="loading" class="grid min-h-64 place-items-center rounded-lg bg-base-200/60">
      <span class="loading loading-spinner loading-md" role="status" :aria-label="tr('加载中...')"></span>
    </div>
    <EmptyState v-else-if="forbidden" type="error" :title="tr('需要管理员权限')" />
    <div v-else-if="failed" class="space-y-3">
      <EmptyState type="error" :title="tr('S3 连接设置加载失败')" />
      <button type="button" class="btn btn-outline btn-sm" @click="load">{{ tr('重新加载') }}</button>
    </div>
    <form v-else-if="form" class="space-y-4" @submit.prevent="save">
      <AppAlert v-if="alert" :type="alert.type" :title="alert.title" :description="alert.description" @close="alert = null" />
      <fieldset class="card card-border border-base-300 bg-base-100 p-4" :disabled="!!busy">
        <h2 class="mb-2 font-semibold">{{ tr('S3 连接') }}</h2>
        <p class="mb-3 text-sm opacity-70">
          {{ tr('保存的 S3 连接和凭据对新导出任务生效。') }}
        </p>
        <p v-if="current.connection && !current.overridden" class="mb-3 text-sm opacity-70">{{ tr('当前使用部署配置，保存后将使用自定义连接。') }}</p>
        <div class="grid gap-4 sm:grid-cols-2">
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${fieldId}-endpoint`">{{ tr('S3 API 地址') }}</label></legend>
            <input :id="`${fieldId}-endpoint`" v-model="form.endpoint" type="url" class="input input-sm w-full" placeholder="https://s3.example.invalid">
            <p class="mt-1 text-xs opacity-70">{{ tr('使用 AWS S3 时可留空。') }}</p>
          </fieldset>
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${fieldId}-region`">{{ tr('签名区域') }}</label></legend>
            <input :id="`${fieldId}-region`" v-model="form.region" class="input input-sm w-full" required>
          </fieldset>
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${fieldId}-bucket`">{{ tr('存储桶') }}</label></legend>
            <input :id="`${fieldId}-bucket`" v-model="form.bucket" class="input input-sm w-full" required>
          </fieldset>
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${fieldId}-prefix`">{{ tr('对象前缀') }}</label></legend>
            <input :id="`${fieldId}-prefix`" v-model="form.prefix" class="input input-sm w-full">
          </fieldset>
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${fieldId}-proxy-mode`">{{ tr('代理方式') }}</label></legend>
            <select :id="`${fieldId}-proxy-mode`" v-model="form.proxy_mode" class="select select-bordered select-sm w-full">
              <option value="system">{{ tr('跟随全局') }}</option>
              <option value="direct">{{ tr('直连') }}</option>
              <option value="custom">{{ tr('自定义') }}</option>
            </select>
          </fieldset>
          <fieldset v-if="form.proxy_mode === 'custom'" class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${fieldId}-proxy`">{{ tr('S3 出站代理地址') }}</label></legend>
            <input
              :id="`${fieldId}-proxy`"
              v-model="form.proxy_url"
              type="password"
              autocomplete="new-password"
              class="input input-sm w-full"
              :required="proxyUrlRequired"
              :placeholder="current.connection?.proxy_endpoint || 'socks5h://proxy.example.invalid:1080'"
            >
            <p class="text-xs opacity-70">{{ tr('支持 HTTP、HTTPS、SOCKS5 和 SOCKS5H。') }}</p>
            <p v-if="current.connection?.proxy_configured" class="text-xs opacity-70">{{ tr('留空保留已保存的代理地址及凭据。') }}</p>
          </fieldset>
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${fieldId}-download`">{{ tr('浏览器下载地址') }}</label></legend>
            <input :id="`${fieldId}-download`" v-model="form.download_endpoint" type="url" class="input input-sm w-full" :disabled="form.proxy_download" placeholder="https://download.example.invalid">
          </fieldset>
        </div>
        <div class="mt-4 grid grid-cols-2 gap-4">
          <fieldset class="fieldset min-w-0">
            <label class="flex items-center gap-2 text-sm">
              <span>{{ tr('使用路径式寻址') }}</span>
              <input v-model="form.path_style" type="checkbox" role="switch" class="toggle toggle-sm shrink-0">
            </label>
          </fieldset>
          <fieldset class="fieldset min-w-0">
            <label class="flex items-center gap-2 text-sm">
              <span>{{ tr('由服务器转发 S3 下载') }}</span>
              <input v-model="form.proxy_download" type="checkbox" role="switch" class="toggle toggle-sm shrink-0">
            </label>
          </fieldset>
        </div>
      </fieldset>
      <fieldset class="card card-border border-base-300 bg-base-100 p-4" :disabled="!!busy">
        <h2 class="mb-2 font-semibold">{{ tr('S3 凭据') }}</h2>
        <div class="grid gap-4 sm:grid-cols-2">
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${fieldId}-credential-mode`">{{ tr('凭据来源') }}</label></legend>
            <select :id="`${fieldId}-credential-mode`" v-model="form.credential_mode" class="select select-bordered select-sm w-full">
              <option value="aws_chain">{{ tr('服务器 AWS 凭据链') }}</option>
              <option value="static">{{ tr('自定义 Access Key') }}</option>
            </select>
          </fieldset>
        </div>
        <template v-if="form.credential_mode === 'static'">
          <p v-if="current.connection?.credential_mode === 'static'" class="mt-2 text-sm opacity-70">{{ tr('凭据已保存。留空保留当前凭据，更换时请同时填写两项密钥。') }}</p>
          <div class="grid gap-4 sm:grid-cols-2">
            <fieldset class="fieldset min-w-0 w-full">
              <legend class="fieldset-legend"><label :for="`${fieldId}-access-key`">Access Key ID</label></legend>
              <input :id="`${fieldId}-access-key`" v-model="form.access_key_id" type="password" autocomplete="new-password" maxlength="256" class="input input-sm w-full">
            </fieldset>
            <fieldset class="fieldset min-w-0 w-full">
              <legend class="fieldset-legend"><label :for="`${fieldId}-secret-key`">Secret Access Key</label></legend>
              <input :id="`${fieldId}-secret-key`" v-model="form.secret_access_key" type="password" autocomplete="new-password" maxlength="1024" class="input input-sm w-full">
            </fieldset>
            <fieldset class="fieldset min-w-0 w-full">
              <legend class="fieldset-legend"><label :for="`${fieldId}-session-token`">{{ tr('Session Token（可选）') }}</label></legend>
              <input :id="`${fieldId}-session-token`" v-model="form.session_token" type="password" autocomplete="new-password" maxlength="16384" class="input input-sm w-full">
            </fieldset>
          </div>
        </template>
      </fieldset>
      <p v-if="current.overridden && !canReset" class="text-sm opacity-70">{{ tr('清除连接前，请在导出设置中取消选择 S3。') }}</p>
      <div class="flex flex-wrap justify-end gap-2">
        <button type="button" class="btn btn-ghost btn-sm" :disabled="!!busy" @click="load">{{ tr('重新加载') }}</button>
        <button v-if="current.overridden" type="button" class="btn btn-outline btn-sm" :disabled="!!busy || conflict || !canReset" @click="reset">{{ tr('恢复默认') }}</button>
        <button type="button" class="btn btn-outline btn-sm" :disabled="!!busy || dirty || !current.connection || conflict" @click="testStorage">
          <span v-if="busy === 'test'" class="loading loading-spinner loading-xs"></span>
          {{ tr('测试连接') }}
        </button>
        <button type="submit" class="btn btn-neutral btn-sm" :disabled="!!busy || !dirty || conflict || !form.bucket.trim() || !form.region.trim() || credentialsIncomplete || (proxyUrlRequired && !form.proxy_url.trim())">
          <span v-if="busy === 'save'" class="loading loading-spinner loading-xs"></span>
          {{ tr('保存设置') }}
        </button>
      </div>
    </form>
  </div>
</template>
