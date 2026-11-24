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
    proxy_url: connection?.proxy_url ?? '',
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

async function publish(connection) {
  busy.value = 'save'
  alert.value = null
  try {
    const { data } = await http.put(endpoint, { expected_revision: current.value.revision, connection })
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
      !form.value.region.trim() || !form.value.bucket.trim()) return false
  return publish({
    ...form.value,
    region: form.value.region.trim(),
    bucket: form.value.bucket.trim(),
    prefix: form.value.prefix.trim(),
    endpoint: form.value.endpoint.trim() || null,
    download_endpoint: form.value.download_endpoint.trim() || null,
    proxy_url: form.value.proxy_url.trim() || null,
  })
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
          {{ tr('服务器通过 AWS 凭据链访问 S3。保存的连接设置对新导出任务生效。') }}
        </p>
        <p v-if="current.connection && !current.overridden" class="mb-3 text-sm opacity-70">{{ tr('当前使用部署配置，保存后将使用自定义连接。') }}</p>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label mb-1" :for="`${fieldId}-endpoint`">{{ tr('S3 API 地址') }}</label>
            <input :id="`${fieldId}-endpoint`" v-model="form.endpoint" type="url" class="input input-sm w-full" placeholder="https://s3.example.invalid">
            <p class="mt-1 text-xs opacity-70">{{ tr('使用 AWS S3 时可留空。') }}</p>
          </div>
          <div>
            <label class="label mb-1" :for="`${fieldId}-region`">{{ tr('签名区域') }}</label>
            <input :id="`${fieldId}-region`" v-model="form.region" class="input input-sm w-full" required>
          </div>
          <div>
            <label class="label mb-1" :for="`${fieldId}-bucket`">{{ tr('存储桶') }}</label>
            <input :id="`${fieldId}-bucket`" v-model="form.bucket" class="input input-sm w-full" required>
          </div>
          <div>
            <label class="label mb-1" :for="`${fieldId}-prefix`">{{ tr('对象前缀') }}</label>
            <input :id="`${fieldId}-prefix`" v-model="form.prefix" class="input input-sm w-full">
          </div>
          <div>
            <label class="label mb-1" :for="`${fieldId}-proxy`">{{ tr('S3 出站代理地址') }}</label>
            <input :id="`${fieldId}-proxy`" v-model="form.proxy_url" type="url" class="input input-sm w-full" placeholder="http://proxy.example.invalid:8080">
            <p class="mt-1 text-xs opacity-70">{{ tr('可选。填写 HTTP(S) 代理，仅用于服务器访问 S3。') }}</p>
          </div>
          <div>
            <label class="label mb-1" :for="`${fieldId}-download`">{{ tr('浏览器下载地址') }}</label>
            <input :id="`${fieldId}-download`" v-model="form.download_endpoint" type="url" class="input input-sm w-full" :disabled="form.proxy_download" placeholder="https://download.example.invalid">
          </div>
        </div>
        <div class="mt-4 flex flex-wrap gap-4">
          <label class="label gap-2 text-base-content"><input v-model="form.path_style" type="checkbox" class="checkbox checkbox-sm">{{ tr('使用路径式寻址') }}</label>
          <label class="label gap-2 text-base-content"><input v-model="form.proxy_download" type="checkbox" class="checkbox checkbox-sm">{{ tr('由服务器转发 S3 下载') }}</label>
        </div>
      </fieldset>
      <p v-if="current.overridden && !canReset" class="text-sm opacity-70">{{ tr('清除连接前，请在导出设置中取消选择 S3。') }}</p>
      <div class="flex flex-wrap justify-end gap-2">
        <button type="button" class="btn btn-ghost btn-sm" :disabled="!!busy" @click="load">{{ tr('重新加载') }}</button>
        <button v-if="current.overridden" type="button" class="btn btn-outline btn-sm" :disabled="!!busy || conflict || !canReset" @click="reset">{{ tr('恢复默认') }}</button>
        <button type="button" class="btn btn-outline btn-sm" :disabled="!!busy || dirty || !current.connection || conflict" @click="testStorage">
          <span v-if="busy === 'test'" class="loading loading-spinner loading-xs"></span>
          {{ tr('测试连接') }}
        </button>
        <button type="submit" class="btn btn-neutral btn-sm" :disabled="!!busy || !dirty || conflict || !form.bucket.trim() || !form.region.trim()">
          <span v-if="busy === 'save'" class="loading loading-spinner loading-xs"></span>
          {{ tr('保存设置') }}
        </button>
      </div>
    </form>
  </div>
</template>
