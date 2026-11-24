<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { tr } from '../i18n/index.js'
import AppAlert from '@/components/AppAlert.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import http from '@/utils/http'

const endpoint = '/api/data-export/settings'
const fieldId = useId()
const confirmDialog = ref(null)
const form = ref(null)
const saved = ref('')
const revision = ref(0)
const s3Configured = ref(false)
const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const forbidden = ref(false)
const failed = ref(false)
const conflict = ref(false)
const alert = ref(null)
const controller = new AbortController()
const dirty = computed(() => !!form.value && JSON.stringify(form.value) !== saved.value)
const valid = computed(() => {
  const value = form.value
  return !!value && (value.local || value.s3) && (!value.s3 || s3Configured.value)
    && inRange(value.batch_size, 10_000) && inRange(value.workers, 4)
    && inRange(value.upload_concurrency, 8)
})

function inRange(value, max) {
  return Number.isInteger(value) && value >= 1 && value <= max
}

function apply(data) {
  form.value = { ...data.document }
  saved.value = JSON.stringify(form.value)
  revision.value = data.revision
  s3Configured.value = data.s3_configured
  conflict.value = false
}

async function load() {
  if (loading.value && form.value) return
  if (dirty.value && !conflict.value && !await confirmDialog.value.ask({
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

async function save() {
  if (saving.value || loading.value || failed.value || conflict.value || !dirty.value || !valid.value) return false
  saving.value = true
  alert.value = null
  try {
    const { data } = await http.put(endpoint, {
      expected_revision: revision.value,
      document: form.value,
    })
    apply(data.data)
    alert.value = { type: 'success', title: tr('导出设置已保存') }
    return true
  } catch (error) {
    conflict.value = error.response?.status === 409
    alert.value = {
      type: 'error',
      title: tr('导出设置保存失败'),
      description: conflict.value
        ? tr('配置已被其他管理员更新。请重新加载后再修改，当前输入尚未保存。')
        : error.response?.data?.message || tr('请检查网络连接后重试。'),
    }
    return false
  } finally {
    saving.value = false
  }
}

async function testStorage() {
  testing.value = true
  alert.value = null
  try {
    await http.post(`${endpoint}/test-s3`, null, { signal: controller.signal })
    alert.value = { type: 'success', title: tr('S3 连接测试通过') }
  } catch (error) {
    if (controller.signal.aborted) return
    alert.value = {
      type: 'error',
      title: tr('S3 连接测试失败'),
      description: error.response?.data?.message || tr('请检查网络连接后重试。'),
    }
  } finally {
    testing.value = false
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
      <h1 class="page-title">{{ tr('导出设置') }}</h1>
      <RouterLink to="/data/export" class="btn btn-ghost btn-sm">{{ tr('返回导出列表') }}</RouterLink>
    </header>

    <div v-if="loading" class="grid min-h-64 place-items-center rounded-lg bg-base-200/60">
      <span class="loading loading-spinner loading-md" role="status" :aria-label="tr('加载中...')"></span>
    </div>
    <EmptyState v-else-if="forbidden" type="error" :title="tr('需要管理员权限')" />
    <div v-else-if="failed" class="space-y-3">
      <EmptyState type="error" :title="tr('导出设置加载失败')" />
      <button type="button" class="btn btn-outline btn-sm" @click="load">{{ tr('重新加载') }}</button>
    </div>

    <form v-else-if="form" class="space-y-4" @submit.prevent="save">
      <AppAlert v-if="alert" :type="alert.type" :title="alert.title" :description="alert.description" @close="alert = null" />

      <fieldset class="card card-border border-base-300 bg-base-100 p-4" :disabled="saving">
        <h2 class="mb-2 font-semibold">{{ tr('导出保存位置') }}</h2>
        <p class="mb-3 text-sm opacity-70">{{ tr('至少选择一个位置。保存位置和批大小仅对新任务生效。') }}</p>
        <div class="flex flex-wrap items-center gap-4">
          <label class="label gap-2 text-base-content">
            <input v-model="form.local" type="checkbox" class="checkbox checkbox-sm">
            {{ tr('服务器本地') }}
          </label>
          <label class="label gap-2 text-base-content">
            <input v-model="form.s3" type="checkbox" class="checkbox checkbox-sm" :disabled="!s3Configured && !form.s3">
            {{ tr('S3 兼容对象存储') }}
          </label>
          <RouterLink to="/data/export/settings/s3" class="btn btn-outline btn-xs">{{ tr('管理 S3 连接') }}</RouterLink>
          <button v-if="s3Configured" type="button" class="btn btn-outline btn-xs" :disabled="testing" @click="testStorage">
            <span v-if="testing" class="loading loading-spinner loading-xs"></span>
            {{ tr('测试连接') }}
          </button>
        </div>
        <p v-if="!s3Configured" class="mt-2 text-sm opacity-70">{{ tr('启用前请先保存 S3 连接。') }}</p>
      </fieldset>

      <fieldset class="card card-border border-base-300 bg-base-100 p-4" :disabled="saving">
        <h2 class="mb-3 font-semibold">{{ tr('导出性能') }}</h2>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label class="label mb-1" :for="`${fieldId}-batch`">{{ tr('每批读取行数') }}</label>
            <input :id="`${fieldId}-batch`" v-model.number="form.batch_size" type="number" min="1" max="10000" required class="input input-sm w-full">
          </div>
          <div>
            <label class="label mb-1" :for="`${fieldId}-workers`">{{ tr('同时运行的导出任务数') }}</label>
            <input :id="`${fieldId}-workers`" v-model.number="form.workers" type="number" min="1" max="4" required class="input input-sm w-full">
          </div>
          <div v-if="form.s3">
            <label class="label mb-1" :for="`${fieldId}-upload`">{{ tr('S3 分片上传并发数') }}</label>
            <input :id="`${fieldId}-upload`" v-model.number="form.upload_concurrency" type="number" min="1" max="8" required class="input input-sm w-full">
          </div>
        </div>
      </fieldset>

      <div class="flex flex-wrap justify-end gap-2">
        <button type="button" class="btn btn-ghost btn-sm" :disabled="saving" @click="load">{{ tr('重新加载') }}</button>
        <button type="submit" class="btn btn-neutral btn-sm" :disabled="!dirty || !valid || saving || conflict">
          <span v-if="saving" class="loading loading-spinner loading-xs"></span>
          {{ tr('保存设置') }}
        </button>
      </div>
    </form>
  </div>
</template>
