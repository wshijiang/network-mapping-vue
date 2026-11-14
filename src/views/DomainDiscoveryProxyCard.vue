<script setup>
import { tr } from '../i18n/index.js'
import { computed, inject, onMounted, ref, useId } from 'vue'
import { formatDateTime } from '../i18n/time.js'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import http from '@/utils/http'
import { discoveryReason } from '@/utils/domainDiscovery'

const isAdmin = inject('isAdmin', ref(false))
const formFieldId = useId()
const loading = ref(false)
const saving = ref(false)
const testing = ref(false)
const clearing = ref(false)
const error = ref('')
const notice = ref('')
const form = ref({
  proxy_mode: 'system',
  proxy_url: '',
  proxy_endpoint: '',
  proxy_configured: false,
  revision: 0,
  updated_at: ''
})
const saved = ref({ proxy_mode: 'system', proxy_url: '' })

const hasUnsavedChanges = computed(() => form.value.proxy_mode !== saved.value.proxy_mode || (form.value.proxy_mode === 'custom' && form.value.proxy_url.trim() !== ''))
const customUrlRequired = computed(() => form.value.proxy_mode === 'custom' && !form.value.proxy_configured && !form.value.proxy_url.trim())
const canSave = computed(() => hasUnsavedChanges.value && !saving.value && !loading.value && !clearing.value && !customUrlRequired.value)
const canTest = computed(() => !testing.value && !loading.value && !saving.value && !clearing.value && !customUrlRequired.value)

function applySettings(data) {
  form.value = {
    proxy_mode: data?.proxy_mode || 'system',
    proxy_url: '',
    proxy_endpoint: data?.proxy_endpoint || '',
    proxy_configured: data?.proxy_configured === true,
    revision: Number(data?.revision) || 0,
    updated_at: data?.updated_at || ''
  }
  saved.value = { proxy_mode: form.value.proxy_mode, proxy_url: '' }
}

async function load() {
  if (!isAdmin.value) return
  loading.value = true
  error.value = ''
  try {
    const response = await http.get('/api/domain-discovery/settings')
    if (response.data?.success !== true || !response.data?.data) throw new Error('invalid settings response')
    applySettings(response.data.data)
  } catch (e) {
    error.value = e.response?.status === 403
      ? tr("仅管理员可以管理域名发现代理设置。")
      : tr("代理设置加载失败")
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!canSave.value) return false
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const custom = form.value.proxy_mode === 'custom'
    const response = await http.put('/api/domain-discovery/settings', {
      expected_revision: form.value.revision,
      proxy_mode: form.value.proxy_mode,
      proxy_url: custom ? form.value.proxy_url.trim() : ''
    })
    if (response.data?.success !== true || !response.data?.data) throw new Error('invalid settings response')
    applySettings(response.data.data)
    notice.value = tr("域名发现代理设置已保存")
    return true
  } catch (e) {
    if (e.response?.status === 409) {
      error.value = tr("配置已被其他管理员更新，请重新加载后再保存。")
      await load()
    } else {
      const code = e.response?.data?.code
      error.value = code ? discoveryReason(code) : tr("代理设置保存失败")
    }
    return false
  } finally {
    saving.value = false
  }
}

async function test() {
  if (!canTest.value) return
  testing.value = true
  error.value = ''
  notice.value = ''
  try {
    const custom = form.value.proxy_mode === 'custom'
    const response = await http.post('/api/domain-discovery/settings/test', {
      proxy_mode: form.value.proxy_mode,
      proxy_url: custom ? form.value.proxy_url.trim() : ''
    })
    const data = response.data?.data
    if (data?.ok === true) {
      notice.value = tr("连接正常（{0} ms）", [Number(data.latency_ms) || 0])
    } else {
      error.value = tr("连接失败：{0}", [discoveryReason(data?.code)])
    }
  } catch (e) {
    const code = e.response?.data?.code
    error.value = code ? tr("连接失败：{0}", [discoveryReason(code)]) : tr("代理连接测试失败")
  } finally {
    testing.value = false
  }
}

async function clearCredentials() {
  if (clearing.value || !form.value.proxy_configured) return
  if (!window.confirm(tr("确定清除已保存的代理地址和认证信息吗？"))) return
  clearing.value = true
  error.value = ''
  notice.value = ''
  try {
    const response = await http.post('/api/domain-discovery/settings/clear', {
      expected_revision: form.value.revision,
      change_reason: ''
    })
    if (response.data?.success !== true || !response.data?.data) throw new Error('invalid settings response')
    applySettings(response.data.data)
    notice.value = tr("已清除保存的代理地址和认证信息")
  } catch (e) {
    const code = e.response?.data?.code
    error.value = code ? discoveryReason(code) : tr("清除代理地址失败")
  } finally {
    clearing.value = false
  }
}

useUnsavedChanges(hasUnsavedChanges, save)
onMounted(load)
</script>

<template>
  <section v-if="isAdmin" class="card border border-base-300 bg-base-100 p-4 space-y-3">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="font-semibold">{{ tr("域名发现出站代理") }}</h2>
        <p class="mt-1 text-xs opacity-60">{{ tr("控制服务器访问 crt.sh 的网络路径。默认跟随全局网络代理；未配置全局代理时使用系统环境代理。指定代理失败时不会回退直连。") }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-ghost btn-sm" :disabled="!canTest" @click="test">
          <span v-if="testing" class="loading loading-spinner loading-xs"></span>
          {{ testing ? tr("测试中…") : tr("测试连接") }}
        </button>
        <button
          v-if="form.proxy_configured"
          class="btn btn-ghost btn-sm"
          :disabled="clearing || saving"
          @click="clearCredentials"
        >
          <span v-if="clearing" class="loading loading-spinner loading-xs"></span>
          {{ clearing ? tr("清除中…") : tr("清除代理") }}
        </button>
        <button class="btn btn-neutral btn-sm" :class="hasUnsavedChanges ? 'visible' : 'invisible'" :disabled="!canSave" @click="save">
          <span v-if="saving" class="loading loading-spinner loading-xs"></span>
          {{ saving ? tr("保存中") : tr("保存") }}
        </button>
      </div>
    </div>
    <div v-if="error" class="alert alert-error text-sm" role="alert">{{ error }}</div>
    <div v-if="notice" class="alert alert-success text-sm" role="status">{{ notice }}</div>
    <div v-if="loading" class="skeleton h-20" role="status" :aria-label="tr('读取代理设置')"></div>
    <fieldset v-else class="space-y-3" :disabled="saving || clearing">
      <label class="form-control w-full" :for="`${formFieldId}-mode`">
        <span class="label-text">{{ tr("代理方式") }}</span>
        <select :id="`${formFieldId}-mode`" v-model="form.proxy_mode" class="select select-bordered w-full">
          <option value="system">{{ tr("跟随全局（未配置时使用系统环境代理）") }}</option>
          <option value="direct">{{ tr("直接连接") }}</option>
          <option value="custom">{{ tr("指定代理") }}</option>
        </select>
      </label>
      <label v-if="form.proxy_mode === 'custom'" class="form-control w-full" :for="`${formFieldId}-url`">
        <span class="label-text">{{ tr("代理地址") }}{{ form.proxy_configured ? tr("（留空保留）") : '' }}</span>
        <input
          :id="`${formFieldId}-url`"
          v-model="form.proxy_url"
          type="text"
          autocomplete="off"
          maxlength="2048"
          class="input input-bordered w-full"
          :placeholder="tr('socks5h://用户名:密码@代理主机:1080')"
        />
        <span v-if="form.proxy_configured" class="label-text-alt break-all">{{ tr("已配置：") }}{{ form.proxy_endpoint }}{{ tr("（认证信息不回显）") }}</span>
        <span class="label-text-alt">{{ tr("支持 HTTP、HTTPS、SOCKS5 和 SOCKS5H；SOCKS5H 由代理解析 crt.sh 域名。") }}</span>
      </label>
      <p v-else-if="form.proxy_configured" class="text-xs break-all opacity-60">{{ tr("已保存代理地址（当前未使用）：") }}{{ form.proxy_endpoint }}</p>
      <p v-if="customUrlRequired" class="text-xs text-warning">{{ tr("指定代理模式需要填写代理地址。") }}</p>
      <p class="text-xs opacity-60">{{ tr("局部“指定代理”或“直接连接”会覆盖全局；“跟随全局”表示使用全局代理。保存只对之后领取的发现作业生效。") }}</p>
      <p v-if="form.updated_at" class="text-xs opacity-60">{{ tr("当前版本 #{0}，更新于 {1}", [form.revision, formatDateTime(form.updated_at)]) }}</p>
    </fieldset>
  </section>
</template>