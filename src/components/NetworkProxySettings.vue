<script setup>
import { tr } from '../i18n/index.js'
import { computed, onMounted, ref, useId, watch } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import { formatDateTime } from '../i18n/time.js'
import http from '@/utils/http'

const emit = defineEmits(['dirty'])
const formFieldId = useId()
const loading = ref(false)
const saving = ref(false)
const testing = ref(false)
const clearing = ref(false)
const alert = ref(null)
const testUrl = ref('https://example.com/')
const form = ref({
  proxy_mode: 'system',
  proxy_url: '',
  proxy_endpoint: '',
  proxy_configured: false,
  revision: 0,
  updated_at: '',
  available: true,
  config_error: null
})
const savedMode = ref('system')

const proxyErrors = {
  get proxy_invalid() { return tr("代理配置无效，请检查协议、地址和凭据。") },
  get proxy_authentication_failed() { return tr("代理认证失败，请检查代理用户名和密码。") },
  get proxy_tls_error() { return tr("代理服务器 TLS 证书校验失败。") },
  get proxy_connection_failed() { return tr("无法连接代理服务器。") },
  get proxy_dns_failed() { return tr("无法解析代理服务器域名。") },
  get proxy_connect_rejected() { return tr("代理服务器拒绝连接目标。") },
  get proxy_invalid_response() { return tr("代理服务器响应格式无效。") },
  get proxy_configuration_unavailable() { return tr("代理凭据无法解密，请重新保存代理地址。") },
  get proxy_url_required() { return tr("指定代理模式需要填写代理地址。") },
  get proxy_url_not_allowed() { return tr("只有指定代理模式可以填写代理地址。") },
  get settings_revision_conflict() { return tr("配置已被其他管理员更新，请重新加载后再保存。") },
  get invalid_revision_or_change_reason() { return tr("配置版本或变更原因无效。") },
  get settings_unavailable() { return tr("网络代理配置暂不可用，请稍后重试。") },
  get source_timeout() { return tr("测试目标连接超时。") },
  get source_tls_error() { return tr("测试目标的 TLS 证书校验失败。") },
  get source_transport() { return tr("无法连接测试目标。") },
  get proxy_test_url_invalid() { return tr("测试目标必须是有效的 HTTP 或 HTTPS 地址，且不能包含凭据或片段。") },
  get proxy_test_target_unreachable() { return tr("无法连接测试目标，请检查目标地址或代理出口。") }
}
function proxyReason(code) { return proxyErrors[code] || tr("操作失败，请稍后重试。") }
function showAlert(type, title, description = '') { alert.value = { type, title, description } }

const hasUnsavedChanges = computed(() => form.value.proxy_mode !== savedMode.value
  || (form.value.proxy_mode === 'custom' && form.value.proxy_url.trim() !== ''))
const customUrlRequired = computed(() => form.value.proxy_mode === 'custom' && !form.value.proxy_configured && !form.value.proxy_url.trim())
const canSave = computed(() => hasUnsavedChanges.value && !saving.value && !loading.value && !customUrlRequired.value)
const canTest = computed(() => !testing.value && !loading.value && !saving.value && !clearing.value && !customUrlRequired.value)

watch(hasUnsavedChanges, (value) => emit('dirty', value), { immediate: true })

function applySettings(data) {
  form.value = {
    proxy_mode: data?.proxy_mode || 'system',
    proxy_url: '',
    proxy_endpoint: data?.proxy_endpoint || '',
    proxy_configured: data?.proxy_configured === true,
    revision: Number(data?.revision) || 0,
    updated_at: data?.updated_at || '',
    available: data?.available !== false,
    config_error: data?.error || null
  }
  savedMode.value = form.value.proxy_mode
}

async function load() {
  loading.value = true
  alert.value = null
  try {
    const response = await http.get('/api/config/network-proxy')
    if (response.data?.success !== true || !response.data?.data) throw new Error('invalid settings response')
    applySettings(response.data.data)
  } catch (e) {
    if (e.response?.status === 403) showAlert('error', tr("仅管理员可以管理全局网络代理。"))
    else showAlert('error', tr("网络代理配置加载失败"))
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!canSave.value) return false
  saving.value = true
  alert.value = null
  try {
    const custom = form.value.proxy_mode === 'custom'
    const response = await http.put('/api/config/network-proxy', {
      expected_revision: form.value.revision,
      proxy_mode: form.value.proxy_mode,
      proxy_url: custom ? form.value.proxy_url.trim() : ''
    })
    if (response.data?.success !== true || !response.data?.data) throw new Error('invalid settings response')
    applySettings(response.data.data)
    showAlert('success', tr("网络代理设置已保存"))
    return true
  } catch (e) {
    if (e.response?.status === 409) {
      await load()
      showAlert('error', tr("网络代理设置保存失败"), proxyReason('settings_revision_conflict'))
    } else {
      const code = e.response?.data?.code
      showAlert('error', tr("网络代理设置保存失败"), code ? proxyReason(code) : '')
    }
    return false
  } finally {
    saving.value = false
  }
}

async function clearCredentials() {
  if (clearing.value || !form.value.proxy_configured) return
  if (!window.confirm(tr("确定清除已保存的代理地址和认证信息吗？"))) return
  clearing.value = true
  alert.value = null
  try {
    const response = await http.post('/api/config/network-proxy/clear', {
      expected_revision: form.value.revision,
      change_reason: ''
    })
    if (response.data?.success !== true || !response.data?.data) throw new Error('invalid settings response')
    applySettings(response.data.data)
    showAlert('success', tr("已清除保存的代理地址和认证信息"))
  } catch (e) {
    const code = e.response?.data?.code
    showAlert('error', tr("清除代理地址失败"), code ? proxyReason(code) : '')
  } finally {
    clearing.value = false
  }
}

async function test() {
  if (!canTest.value) return
  testing.value = true
  alert.value = null
  try {
    const custom = form.value.proxy_mode === 'custom'
    const response = await http.post('/api/config/network-proxy/test', {
      proxy_mode: form.value.proxy_mode,
      proxy_url: custom ? form.value.proxy_url.trim() : '',
      test_url: testUrl.value.trim()
    })
    const data = response.data?.data
    if (data?.ok === true) {
      showAlert('success', data.http_status
        ? tr("连接正常（{0} ms，HTTP {1}）", [Number(data.latency_ms) || 0, data.http_status])
        : tr("连接正常（{0} ms）", [Number(data.latency_ms) || 0]))
    } else {
      showAlert('error', tr("连接失败：{0}", [proxyReason(data?.code)]))
    }
  } catch (e) {
    const code = e.response?.data?.code
    if (code) showAlert('error', tr("连接失败：{0}", [proxyReason(code)]))
    else showAlert('error', tr("代理连接测试失败"))
  } finally {
    testing.value = false
  }
}

defineExpose({ save })
onMounted(load)
</script>

<template>
  <div class="card bg-base-100 card-border border-base-300 p-4">
    <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 class="font-semibold">{{ tr("网络") }}</h3>
        <p class="mt-1 text-xs opacity-60">{{ tr("配置服务器访问外部服务时使用的全局代理。模块内的局部代理可覆盖此设置。") }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-ghost btn-sm rounded-lg" :disabled="!canTest" @click="test">
          <span v-if="testing" class="loading loading-spinner loading-xs"></span>
          {{ testing ? tr("测试中…") : tr("测试连接") }}
        </button>
        <button
          v-if="form.proxy_configured"
          class="btn btn-ghost btn-sm rounded-lg"
          :disabled="clearing || saving"
          @click="clearCredentials"
        >
          <span v-if="clearing" class="loading loading-spinner loading-xs"></span>
          {{ clearing ? tr("清除中…") : tr("清除代理") }}
        </button>
        <button
          class="btn btn-neutral btn-sm rounded-lg"
          :class="hasUnsavedChanges ? 'visible' : 'invisible'"
          :disabled="!canSave"
          @click="save"
        >
          <span v-if="saving" class="loading loading-spinner loading-xs"></span>
          {{ saving ? tr("保存中") : tr("保存") }}
        </button>
      </div>
    </div>

    <AppAlert v-if="alert" v-bind="alert" @close="alert = null" />
    <div v-if="!form.available && form.config_error" class="alert alert-warning text-sm" role="alert">
      {{ tr("已保存的全局代理当前不可用：{0}", [proxyReason(form.config_error)]) }}
    </div>

    <div v-if="loading" class="flex items-center gap-2 py-3 text-sm opacity-60">
      <span class="loading loading-spinner loading-sm"></span>{{ tr("正在读取网络代理配置...") }}
    </div>
    <fieldset v-else class="space-y-4" :disabled="saving || clearing">
      <fieldset class="fieldset min-w-0 w-full">
        <legend class="fieldset-legend"><label :for="`${formFieldId}-mode`">{{ tr("代理方式") }}</label></legend>
        <select :id="`${formFieldId}-mode`" v-model="form.proxy_mode" class="select select-bordered w-full">
          <option value="system">{{ tr("沿用系统环境代理（HTTPS_PROXY 等）") }}</option>
          <option value="direct">{{ tr("直接连接") }}</option>
          <option value="custom">{{ tr("指定代理") }}</option>
        </select>
      </fieldset>

      <fieldset v-if="form.proxy_mode === 'custom'" class="fieldset min-w-0 w-full">
        <legend class="fieldset-legend">
          <label :for="`${formFieldId}-url`">{{ tr("代理地址") }}{{ form.proxy_configured ? tr("（留空保留）") : '' }}</label>
        </legend>
        <input
          :id="`${formFieldId}-url`"
          v-model="form.proxy_url"
          type="text"
          autocomplete="off"
          maxlength="2048"
          class="input input-bordered w-full"
          :placeholder="tr('socks5h://用户名:密码@代理主机:1080')"
        />
        <span v-if="form.proxy_configured" class="label-text-alt break-all opacity-60">{{ tr("已配置：") }}{{ form.proxy_endpoint }}{{ tr("（认证信息不回显）") }}</span>
        <span class="label-text-alt opacity-60">{{ tr("支持 HTTP、HTTPS、SOCKS5 和 SOCKS5H；SOCKS5H 由代理解析目标域名。") }}</span>
      </fieldset>
      <p v-else-if="form.proxy_configured" class="text-xs break-all opacity-60">{{ tr("已保存代理地址（当前未使用）：") }}{{ form.proxy_endpoint }}</p>
      <p v-if="customUrlRequired" class="text-xs text-warning">{{ tr("指定代理模式需要填写代理地址。") }}</p>

      <fieldset class="fieldset min-w-0 w-full">
        <legend class="fieldset-legend"><label :for="`${formFieldId}-test`">{{ tr("测试目标") }}</label></legend>
        <input
          :id="`${formFieldId}-test`"
          v-model="testUrl"
          type="text"
          autocomplete="off"
          maxlength="2048"
          class="input input-bordered w-full"
          placeholder="https://example.com/"
        />
        <span class="label-text-alt opacity-60">{{ tr("仅用于测试连接，不保存。支持 HTTP 和 HTTPS 地址。") }}</span>
      </fieldset>

      <p class="text-xs opacity-60">{{ tr("局部“指定代理”或“直接连接”会覆盖全局；局部“沿用系统”表示跟随全局。保存只对之后领取的任务生效。") }}</p>
      <p v-if="form.updated_at" class="text-xs opacity-60">{{ tr("当前版本 #{0}，更新于 {1}", [form.revision, formatDateTime(form.updated_at)]) }}</p>
    </fieldset>
  </div>
</template>