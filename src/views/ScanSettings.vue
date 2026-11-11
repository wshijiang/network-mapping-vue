<script setup>
import { tr } from '../i18n/index.js'

import { computed, onMounted, ref } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import http from '@/utils/http'

const scanProfiles = [
  {
    value: 'port_only',
    get title() { return tr("仅端口扫描") },
    get description() { return tr("只发现开放端口，不启动 zgrab2 服务识别。") }
  },
  {
    value: 'service_inventory',
    get title() { return tr("服务识别") },
    get description() { return tr("发现开放端口后必须完成 zgrab2 服务识别，识别阶段失败会使任务失败。") }
  },
  {
    value: 'vulnerability_scan',
    get title() { return tr("漏洞扫描") },
    get description() { return tr("发现开放端口并尝试识别服务，然后使用扫描节点配置的安全 Nuclei 模板集检查漏洞。") }
  }
]

const alerts = ref([])
const defaultScanProfile = ref('port_only')
const savedScanProfile = ref('port_only')
const loading = ref(false)
const saving = ref(false)
const hasUnsavedChanges = computed(() => defaultScanProfile.value !== savedScanProfile.value)

function pushAlert(type, title, description = '', timeout = 7000) {
  alerts.value.unshift({ id: crypto.randomUUID(), type, title, description, timeout })
}

function closeAlert(id) {
  alerts.value = alerts.value.filter((alert) => alert.id !== id)
}

function applySettings(data) {
  const profile = scanProfiles.some((item) => item.value === data?.defaultScanProfile)
    ? data.defaultScanProfile
    : 'port_only'
  defaultScanProfile.value = profile
  savedScanProfile.value = profile
}

async function fetchSettings() {
  loading.value = true
  try {
    const response = await http.get('/api/config/scan')
    applySettings(response.data?.data)
  } catch (error) {
    console.error('load scan settings failed', error)
    pushAlert('error', tr("扫描设置加载失败"), tr("请检查网络连接或服务器运行状态。"))
  } finally {
    loading.value = false
  }
}

async function saveSettings() {
  if (saving.value || !hasUnsavedChanges.value) return false
  saving.value = true
  try {
    const response = await http.post('/api/config/scan', {
      defaultScanProfile: defaultScanProfile.value
    })
    applySettings(response.data?.data)
    pushAlert('success', tr("扫描设置已保存"), tr("新建任务和系统自动任务将默认使用该模式。"))
    return true
  } catch (error) {
    console.error('save scan settings failed', error)
    pushAlert('error', tr("扫描设置保存失败"), error.response?.data?.message || tr("请稍后重试。"))
    return false
  } finally {
    saving.value = false
  }
}

useUnsavedChanges(hasUnsavedChanges, saveSettings)
onMounted(fetchSettings)
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
      <h1 class="page-title">{{ tr("扫描设置") }}</h1>
      <p class="text-xs opacity-60">{{ tr("设置未显式指定模式的新任务及系统自动任务使用的默认扫描模式。") }}</p>
    </div>

    <div class="card bg-base-100 card-border border-base-300 p-4">
      <div class="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 class="font-semibold">{{ tr("系统默认扫描模式") }}</h3>
          <p class="mt-1 text-xs opacity-60">{{ tr("设置只影响之后创建的任务，已进入队列的任务不会改变。") }}</p>
        </div>
        <button
          class="btn btn-neutral btn-sm rounded-lg"
          :class="hasUnsavedChanges ? 'visible' : 'invisible'"
          :disabled="!hasUnsavedChanges || loading || saving"
          @click="saveSettings"
        >
          <span v-if="saving" class="loading loading-spinner loading-xs"></span>
          {{ saving ? tr("保存中") : tr("保存") }}
        </button>
      </div>

      <div v-if="loading" class="flex items-center gap-2 py-3 text-sm opacity-60">
        <span class="loading loading-spinner loading-sm"></span> {{ tr("正在读取扫描设置...") }} </div>

      <fieldset v-else :disabled="saving" class="grid gap-3 lg:grid-cols-3">
        <label
          v-for="profile in scanProfiles"
          :key="profile.value"
          class="flex cursor-pointer items-start gap-3 rounded-lg border border-base-300 bg-base-200/40 p-4"
          :class="defaultScanProfile === profile.value ? 'border-base-content/60 bg-base-content/5' : ''"
        >
          <input v-model="defaultScanProfile" class="radio radio-sm mt-0.5" type="radio" :value="profile.value" />
          <span>
            <span class="block font-medium">{{ profile.title }}</span>
            <span class="mt-1 block text-xs leading-5 opacity-60">{{ profile.description }}</span>
          </span>
        </label>
      </fieldset>
    </div>
  </div>
</template>
