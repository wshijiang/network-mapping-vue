<script setup>
import { tr } from '../i18n/index.js'

import { computed, inject, onMounted, ref, useId } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import GeneralSettings from '@/components/GeneralSettings.vue'
import NetworkProxySettings from '@/components/NetworkProxySettings.vue'
import ConfigCheckPanel from '@/components/ConfigCheckPanel.vue'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import http from '@/utils/http'

const formFieldId = useId()
const isAdmin = inject('isAdmin', ref(false))
const alerts = ref([])
const generalSettings = ref(null)
const generalDirty = ref(false)
const networkProxy = ref(null)
const networkProxyDirty = ref(false)

const listenConfig = ref({
  host: '',
  port: null
})

const securityConfig = ref({
  maxLoginRetries: 3,
  lockMinutes: 30,
  apiRateLimit: 50,
  pageRateLimit: 50
})

const sessionSettings = ref({
  sessionTtlMinutes: 45,
  invalidateOtherSessions: false
})
const sessionLimits = ref({ minimumMinutes: 5, maximumMinutes: 1440 })

const BUILT_IN_CLIENT_IP_HEADERS = ['x-forwarded-for', 'forwarded']
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_\x60|~0-9A-Za-z]+$/
const trustedProxySettings = ref({
  trustedProxyCidrsText: '',
  clientIpHeaderMode: 'x-forwarded-for',
  customClientIpHeader: ''
})
const trustedProxyLimits = ref({
  maximumCidrs: 32,
  maximumHeaderNameLength: 64,
  supportsCustomHeader: false
})

const savedSecurityConfig = ref({ ...securityConfig.value })
const savedSessionSettings = ref({ sessionTtlMinutes: sessionSettings.value.sessionTtlMinutes })
const savedTrustedProxySettings = ref({ ...trustedProxySettings.value })
const loadingListenConfig = ref(false)
const listenConfigLoadFailed = ref(false)
const loadingSessionSettings = ref(false)
const savingSessionSettings = ref(false)
const loadingTrustedProxySettings = ref(false)
const savingTrustedProxySettings = ref(false)

function pushAlert(type, title, description = '', timeout = 7000) {
  alerts.value.unshift({
    id: crypto.randomUUID(),
    type,
    title,
    description,
    timeout
  })
}

function closeAlert(id) {
  alerts.value = alerts.value.filter((alert) => alert.id !== id)
}

const showSecuritySave = computed(
  () => JSON.stringify(securityConfig.value) !== JSON.stringify(savedSecurityConfig.value)
)
const showSessionSave = computed(() => (
  sessionSettings.value.sessionTtlMinutes !== savedSessionSettings.value.sessionTtlMinutes
  || sessionSettings.value.invalidateOtherSessions
))
function resolvedClientIpHeader(settings) {
  return settings.clientIpHeaderMode === 'custom'
    ? settings.customClientIpHeader.trim().toLowerCase()
    : settings.clientIpHeaderMode
}

function comparableTrustedProxySettings(settings) {
  return {
    trustedProxyCidrsText: settings.trustedProxyCidrsText,
    clientIpHeader: resolvedClientIpHeader(settings)
  }
}

const showTrustedProxySave = computed(() => (
  JSON.stringify(comparableTrustedProxySettings(trustedProxySettings.value))
    !== JSON.stringify(comparableTrustedProxySettings(savedTrustedProxySettings.value))
))
const trustedProxyCidrs = computed(() => trustedProxySettings.value.trustedProxyCidrsText
  .split(/[\n,]+/)
  .map((value) => value.trim())
  .filter(Boolean))
const customClientIpHeaderError = computed(() => {
  if (trustedProxySettings.value.clientIpHeaderMode !== 'custom') return ''
  const value = trustedProxySettings.value.customClientIpHeader.trim()
  if (!value) return tr("请输入自定义请求头名称。")
  if (value.length > trustedProxyLimits.value.maximumHeaderNameLength) {
    return tr("请求头名称不能超过 {0} 个字符。", [trustedProxyLimits.value.maximumHeaderNameLength])
  }
  if (!HTTP_HEADER_NAME_PATTERN.test(value)) {
    return tr("请求头名称包含空格、冒号或其他非法字符。")
  }
  return ''
})
const hasUnsavedChanges = computed(() => (
  generalDirty.value
  ||
  networkProxyDirty.value
  ||
  showSecuritySave.value
  || showSessionSave.value
  || showTrustedProxySave.value
))

function clampLoginRetries() {
  let value = Number(securityConfig.value.maxLoginRetries)
  if (!Number.isFinite(value)) value = 3
  value = Math.floor(value)
  if (value <= 0) value = 1
  if (value >= 5) value = 4
  securityConfig.value.maxLoginRetries = value
}

function normalizeLockMinutes() {
  let value = Number(securityConfig.value.lockMinutes)
  if (!Number.isFinite(value)) value = 30
  value = Math.max(1, Math.floor(value))
  securityConfig.value.lockMinutes = value
}

function normalizeRateLimit(field) {
  let value = Number(securityConfig.value[field])
  if (!Number.isFinite(value)) value = 50
  value = Math.max(0, Math.floor(value))
  securityConfig.value[field] = value
}

function saveSecurityConfig() {
  clampLoginRetries()
  normalizeLockMinutes()
  savedSecurityConfig.value = { ...securityConfig.value }
}

async function fetchListenConfig() {
  loadingListenConfig.value = true
  listenConfigLoadFailed.value = false
  try {
    const response = await http.get('/api/config/server')
    const data = response.data?.data
    if (response.data?.success !== true || typeof data?.host !== 'string' || !Number.isInteger(data?.port)) {
      throw new Error(tr("服务器未返回有效 Web 监听配置"))
    }
    listenConfig.value = { host: data.host, port: data.port }
  } catch (error) {
    console.error('fetch server listen config failed', error)
    listenConfigLoadFailed.value = true
    pushAlert(
      'error',
      tr("Web 监听配置加载失败"),
      error?.response?.status === 403 ? tr("仅管理员可以查看 Web 监听配置。") : tr("请稍后刷新页面重试。")
    )
  } finally {
    loadingListenConfig.value = false
  }
}

function normalizeSessionTtl() {
  let value = Number(sessionSettings.value.sessionTtlMinutes)
  if (!Number.isFinite(value)) value = 45
  value = Math.floor(value)
  value = Math.max(sessionLimits.value.minimumMinutes, value)
  value = Math.min(sessionLimits.value.maximumMinutes, value)
  sessionSettings.value.sessionTtlMinutes = value
}

function applySessionSettings(data) {
  const sessionTtlMinutes = Number(data?.sessionTtlMinutes) || 45
  sessionLimits.value = {
    minimumMinutes: Number(data?.minimumMinutes) || 5,
    maximumMinutes: Number(data?.maximumMinutes) || 1440
  }
  sessionSettings.value = {
    sessionTtlMinutes,
    invalidateOtherSessions: false
  }
  savedSessionSettings.value = { sessionTtlMinutes }
}

async function fetchSessionSettings() {
  loadingSessionSettings.value = true
  try {
    const response = await http.get('/api/config/security/session')
    if (response.data?.success !== true || !response.data?.data) {
      throw new Error(tr("服务器未返回有效会话策略"))
    }
    applySessionSettings(response.data.data)
  } catch (error) {
    console.error('fetch session settings failed', error)
    pushAlert(
      'error',
      tr("会话策略加载失败"),
      error?.response?.status === 403 ? tr("仅管理员可以查看会话策略。") : tr("请稍后刷新页面重试。")
    )
  } finally {
    loadingSessionSettings.value = false
  }
}

async function saveSessionSettings() {
  if (savingSessionSettings.value) return false
  normalizeSessionTtl()
  savingSessionSettings.value = true
  try {
    const response = await http.post('/api/config/security/session', {
      sessionTtlMinutes: sessionSettings.value.sessionTtlMinutes,
      invalidateOtherSessions: sessionSettings.value.invalidateOtherSessions
    })
    if (response.data?.success !== true || !response.data?.data) {
      throw new Error(tr("服务器未确认会话策略写入成功"))
    }
    const invalidatedCount = Number(response.data.data.invalidatedSessionCount) || 0
    applySessionSettings(response.data.data)
    const description = invalidatedCount > 0
      ? tr("新登录会话将使用新的有效期，另有 {0} 个会话已注销。", [invalidatedCount])
      : tr("新的有效期将在下次登录时生效，当前会话保持不变。")
    pushAlert('success', tr("会话策略已保存"), description, 6000)
    return true
  } catch (error) {
    console.error('save session settings failed', error)
    pushAlert(
      'error',
      tr("会话策略保存失败"),
      error?.response?.data?.message || tr("请检查输入后重试。")
    )
    return false
  } finally {
    savingSessionSettings.value = false
  }
}

function applyTrustedProxySettings(data, limits = {}) {
  const configuredHeader = typeof data?.clientIpHeader === 'string'
    ? data.clientIpHeader.trim().toLowerCase()
    : 'x-forwarded-for'
  const clientIpHeaderMode = BUILT_IN_CLIENT_IP_HEADERS.includes(configuredHeader)
    ? configuredHeader
    : 'custom'
  const next = {
    trustedProxyCidrsText: Array.isArray(data?.trustedProxyCidrs)
      ? data.trustedProxyCidrs.join('\n')
      : '',
    clientIpHeaderMode,
    customClientIpHeader: clientIpHeaderMode === 'custom' ? configuredHeader : ''
  }
  trustedProxySettings.value = next
  savedTrustedProxySettings.value = { ...next }
  trustedProxyLimits.value = {
    maximumCidrs: Number(limits?.maximumCidrs) || 32,
    maximumHeaderNameLength: Number(limits?.maximumHeaderNameLength) || 64,
    supportsCustomHeader: limits?.supportsCustomHeader === true
  }
}

async function fetchTrustedProxySettings() {
  loadingTrustedProxySettings.value = true
  try {
    const response = await http.get('/api/config/security/trusted-proxies')
    if (response.data?.success !== true || !response.data?.data) {
      throw new Error(tr("服务器未返回有效可信代理配置"))
    }
    applyTrustedProxySettings(response.data.data, response.data.limits)
  } catch (error) {
    console.error('fetch trusted proxy settings failed', error)
    pushAlert(
      'error',
      tr("可信代理配置加载失败"),
      error?.response?.status === 403 ? tr("仅管理员可以查看可信代理配置。") : tr("请稍后刷新页面重试。")
    )
  } finally {
    loadingTrustedProxySettings.value = false
  }
}

async function saveTrustedProxySettings() {
  if (savingTrustedProxySettings.value) return false
  if (customClientIpHeaderError.value) {
    pushAlert('warning', tr("自定义请求头无效"), customClientIpHeaderError.value)
    return false
  }
  if (trustedProxyCidrs.value.length > trustedProxyLimits.value.maximumCidrs) {
    pushAlert(
      'warning',
      tr("可信代理配置过多"),
      tr("最多允许 {0} 条 CIDR。", [trustedProxyLimits.value.maximumCidrs])
    )
    return false
  }
  savingTrustedProxySettings.value = true
  try {
    const response = await http.post('/api/config/security/trusted-proxies', {
      trustedProxyCidrs: trustedProxyCidrs.value,
      clientIpHeader: resolvedClientIpHeader(trustedProxySettings.value)
    })
    if (response.data?.success !== true || !response.data?.data) {
      throw new Error(tr("服务器未确认可信代理配置写入成功"))
    }
    applyTrustedProxySettings(response.data.data, response.data.limits)
    pushAlert('success', tr("可信代理配置已保存"), tr("新的来源 IP 解析规则已经即时生效。"), 6000)
    return true
  } catch (error) {
    console.error('save trusted proxy settings failed', error)
    pushAlert(
      'error',
      tr("可信代理配置保存失败"),
      error?.response?.data?.message || tr("请检查 CIDR 和代理请求头后重试。")
    )
    return false
  } finally {
    savingTrustedProxySettings.value = false
  }
}

async function saveAllSettings() {
  if (generalDirty.value && !await generalSettings.value?.save()) return false
  if (networkProxyDirty.value && !await networkProxy.value?.save()) return false
  if (showSecuritySave.value) saveSecurityConfig()
  if (showSessionSave.value && !await saveSessionSettings()) return false
  if (showTrustedProxySave.value && !await saveTrustedProxySettings()) return false
  return true
}

const confirmDialog = ref(null)
useUnsavedChanges(hasUnsavedChanges, saveAllSettings, confirmDialog)

onMounted(() => {
  fetchListenConfig()
  fetchSessionSettings()
  fetchTrustedProxySettings()
})
</script>

<template>
  <ConfirmDialog ref="confirmDialog" />
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
      <h1 class="page-title">{{ tr("系统设置") }}</h1>
      <p class="text-xs opacity-60">{{ tr("系统运行、安全策略与通知方式") }}</p>
    </div>

    <div class="grid grid-cols-1 gap-5">
      <ConfigCheckPanel endpoint="/api/config/check" />
      <GeneralSettings ref="generalSettings" @dirty="generalDirty = $event" />
      <NetworkProxySettings v-if="isAdmin" ref="networkProxy" @dirty="networkProxyDirty = $event" />
      <div class="card bg-base-100 card-border border-base-300 p-4">
        <div class="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 class="font-semibold">{{ tr("Web 监听配置") }}</h3>
            <p class="mt-1 text-xs opacity-60">{{ tr("读取服务端当前启动配置；如需调整，请修改 config.toml 并重启服务。") }}</p>
          </div>
          <span class="badge badge-ghost badge-sm">{{ tr("只读") }}</span>
        </div>

        <div v-if="loadingListenConfig" class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div class="skeleton h-16 w-full rounded-box"></div>
          <div class="skeleton h-16 w-full rounded-box"></div>
        </div>
        <div v-else-if="listenConfigLoadFailed" class="alert alert-error alert-soft text-sm"> {{ tr("无法读取当前 Web 监听配置，请刷新页面重试。") }} </div>
        <dl v-else class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div class="rounded-box border border-base-300 bg-base-200/40 px-4 py-3">
            <dt class="text-xs opacity-60">{{ tr("监听主机") }}</dt>
            <dd class="mt-1 font-mono text-sm">{{ listenConfig.host || '--' }}</dd>
          </div>
          <div class="rounded-box border border-base-300 bg-base-200/40 px-4 py-3">
            <dt class="text-xs opacity-60">{{ tr("监听端口") }}</dt>
            <dd class="mt-1 font-mono text-sm">{{ listenConfig.port ?? '--' }}</dd>
          </div>
        </dl>
      </div>

      <div class="card bg-base-100 card-border border-base-300 p-4">
        <div class="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 class="font-semibold">{{ tr("来源 IP 可信代理") }}</h3>
            <p class="mt-1 text-xs opacity-60">{{ tr("统一控制请求日志、审计、限流和扫描器接口如何从反向代理请求头还原客户端地址。") }}</p>
          </div>
          <button
            class="btn rounded-lg btn-neutral btn-sm"
            :class="showTrustedProxySave ? 'visible' : 'invisible'"
            :disabled="!showTrustedProxySave || loadingTrustedProxySettings || savingTrustedProxySettings"
            @click="saveTrustedProxySettings"
          >
            <span v-if="savingTrustedProxySettings" class="loading loading-spinner loading-xs"></span>
            {{ savingTrustedProxySettings ? tr("保存中") : tr("保存") }}
          </button>
        </div>

        <div v-if="loadingTrustedProxySettings" class="flex items-center gap-2 py-3 text-sm opacity-60">
          <span class="loading loading-spinner loading-sm"></span> {{ tr("正在读取可信代理配置...") }} </div>

        <fieldset v-else :disabled="savingTrustedProxySettings" class="space-y-4">
          <div class="alert alert-warning alert-soft py-3 text-sm">
            <span>{{ tr("此配置影响全站来源 IP 判定。仅填写实际反向代理的地址范围，推荐使用单地址 /32 或 /128。代理必须覆盖或安全追加所选请求头，不能直接透传客户端提交的同名字段。留空时忽略所有转发头；禁止配置 0.0.0.0/0 或 ::/0。") }}</span>
          </div>

          <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div class="space-y-3">
              <fieldset class="fieldset min-w-0 w-full">
                <legend class="fieldset-legend"><label :for="`${formFieldId}-1`">{{ tr("客户端 IP 请求头") }}</label></legend>
                <select :id="`${formFieldId}-1`" v-model="trustedProxySettings.clientIpHeaderMode" class="select select-bordered w-full">
                  <option value="x-forwarded-for">X-Forwarded-For</option>
                  <option value="forwarded">Forwarded（RFC 7239）</option>
                  <option
                    v-if="trustedProxyLimits.supportsCustomHeader || trustedProxySettings.clientIpHeaderMode === 'custom'"
                    value="custom"
                  > {{ tr("自定义请求头") }} </option>
                </select>
                <span class="label text-wrap text-xs opacity-60">{{ tr("只解析选中的一种请求头，避免不同代理头之间产生歧义。") }}</span>
              </fieldset>

              <fieldset v-if="trustedProxySettings.clientIpHeaderMode === 'custom'" class="fieldset min-w-0 w-full">
                <legend class="fieldset-legend"><label :for="`${formFieldId}-2`">{{ tr("自定义请求头名称") }}</label></legend>
                <input :id="`${formFieldId}-2`"
                  v-model="trustedProxySettings.customClientIpHeader"
                  type="text"
                  class="input input-bordered w-full font-mono"
                  :class="{ 'input-error': customClientIpHeaderError }"
                  :placeholder="tr(&quot;例如: X-Real-IP&quot;)"
                  :maxlength="trustedProxyLimits.maximumHeaderNameLength"
                  autocomplete="off"
                  spellcheck="false"
                />
                <span
                  class="label text-wrap text-xs"
                  :class="customClientIpHeaderError ? 'text-error' : 'opacity-60'"
                >
                  {{ customClientIpHeaderError || tr("支持单个 IP 或逗号分隔的 IP 代理链，例如 CF-Connecting-IP。") }}
                </span>
              </fieldset>
            </div>

            <fieldset class="fieldset min-w-0 w-full lg:col-span-2">
              <legend class="fieldset-legend"><label for="setting-trustedproxysettings-trustedproxycidrstext">{{ tr("可信代理 CIDR") }}</label></legend>
              <textarea
                id="setting-trustedproxysettings-trustedproxycidrstext"
                v-model="trustedProxySettings.trustedProxyCidrsText"
                class="textarea textarea-bordered min-h-28 w-full font-mono text-sm"
                placeholder="127.0.0.1/32&#10;::1/128"
              ></textarea>
              <span class="label text-wrap text-xs opacity-60"> {{ tr("每行一条，也可使用逗号分隔；当前") }} {{ trustedProxyCidrs.length }}/{{ trustedProxyLimits.maximumCidrs }} {{ tr("条。") }} </span>
            </fieldset>
          </div>

          <div class="rounded-lg bg-base-200/60 p-3 text-xs leading-5 opacity-75"> {{ tr("服务端在请求入口统一解析一次来源 IP：先验证 TCP 直连地址是否属于可信代理，再从右向左剥离代理链并选择第一个非可信地址。自定义请求头按裸 IP 或逗号分隔的 IP 链解析；Forwarded 按 RFC 7239 的 for 参数解析。未命中可信 CIDR、请求头缺失、格式错误或整条链均为可信地址时，都会安全回退到 TCP 对端地址。") }} </div>
        </fieldset>
      </div>

      <div class="card bg-base-100 card-border border-base-300 p-4">
        <div class="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 class="font-semibold">{{ tr("会话策略") }}</h3>
            <p class="text-xs opacity-60 mt-1">{{ tr("控制用户登录后的绝对有效期，不会因持续操作自动续期。") }}</p>
          </div>
          <button
            class="btn rounded-lg btn-neutral btn-sm"
            :class="showSessionSave ? 'visible' : 'invisible'"
            :disabled="!showSessionSave || loadingSessionSettings || savingSessionSettings"
            @click="saveSessionSettings"
          >
            <span v-if="savingSessionSettings" class="loading loading-spinner loading-xs"></span>
            {{ savingSessionSettings ? tr("保存中") : tr("保存") }}
          </button>
        </div>

        <div v-if="loadingSessionSettings" class="flex items-center gap-2 text-sm opacity-60">
          <span class="loading loading-spinner loading-sm"></span> {{ tr("正在读取会话策略...") }} </div>

        <fieldset v-else :disabled="savingSessionSettings" class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-3`">{{ tr("登录会话最长有效期") }} <span class="text-xs opacity-60">{{ tr("（分钟）") }}</span></label></legend>
            <input :id="`${formFieldId}-3`"
              v-model.number="sessionSettings.sessionTtlMinutes"
              type="number"
              :min="sessionLimits.minimumMinutes"
              :max="sessionLimits.maximumMinutes"
              step="1"
              class="input input-bordered w-full"
              placeholder="45"
              @blur="normalizeSessionTtl"
            />
            <span class="label text-wrap text-xs opacity-60"> {{ tr("允许") }} {{ sessionLimits.minimumMinutes }}-{{ sessionLimits.maximumMinutes }} {{ tr("分钟，仅影响新登录会话。") }} </span>
          </fieldset>

          <label class="rounded-lg bg-base-200/60 p-3 flex items-start gap-3 cursor-pointer">
            <input v-model="sessionSettings.invalidateOtherSessions" type="checkbox" class="checkbox rounded-md mt-0.5" />
            <span class="text-sm">
              <span class="font-medium block">{{ tr("保存后注销其他现有会话") }}</span>
              <span class="text-xs opacity-60">{{ tr("保留当前管理员会话，其余用户需要重新登录。") }}</span>
            </span>
          </label>
        </fieldset>
      </div>

      <div class="card bg-base-100 card-border border-base-300 p-4">
        <div class="flex items-start justify-between mb-3">
          <h3 class="font-semibold">{{ tr("系统安全") }}</h3>
          <button
            class="btn rounded-lg btn-neutral btn-sm"
            :class="showSecuritySave ? 'visible' : 'invisible'"
            :disabled="!showSecuritySave"
            @click="saveSecurityConfig"
          > {{ tr("保存") }} </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-4`">{{ tr("限制登录错误次数") }}</label></legend>
            <input :id="`${formFieldId}-4`"
              v-model.number="securityConfig.maxLoginRetries"
              type="number"
              min="1"
              max="4"
              step="1"
              class="input input-bordered w-full"
              @blur="clampLoginRetries"
              @input="clampLoginRetries"
            />
            <span class="label text-wrap text-xs opacity-60">{{ tr("仅允许输入 1-4 的整数，默认 3") }}</span>
          </fieldset>

          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-5`">{{ tr("锁定时间") }} <span class="text-xs opacity-60">{{ tr("（分钟）") }}</span></label></legend>
            <input :id="`${formFieldId}-5`"
              v-model.number="securityConfig.lockMinutes"
              type="number"
              min="1"
              step="1"
              class="input input-bordered w-full"
              :placeholder="tr(&quot;例如: 30&quot;)"
              @blur="normalizeLockMinutes"
              @input="normalizeLockMinutes"
            />
          </fieldset>

          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-6`">{{ tr("请求速率限制（API 路径）") }}</label></legend>
            <input :id="`${formFieldId}-6`"
              v-model.number="securityConfig.apiRateLimit"
              type="number"
              min="0"
              step="1"
              class="input input-bordered w-full"
              placeholder="50"
              @blur="normalizeRateLimit('apiRateLimit')"
              @input="normalizeRateLimit('apiRateLimit')"
            />
            <span class="label text-wrap text-xs opacity-60">{{ tr("单位：次/秒，0 表示不限制") }}</span>
          </fieldset>

          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-7`">{{ tr("请求速率限制（普通页面）") }}</label></legend>
            <input :id="`${formFieldId}-7`"
              v-model.number="securityConfig.pageRateLimit"
              type="number"
              min="0"
              step="1"
              class="input input-bordered w-full"
              placeholder="50"
              @blur="normalizeRateLimit('pageRateLimit')"
              @input="normalizeRateLimit('pageRateLimit')"
            />
            <span class="label text-wrap text-xs opacity-60">{{ tr("单位：次/秒，0 表示不限制") }}</span>
          </fieldset>
        </div>
      </div>

      <div v-if="isAdmin" class="card bg-base-100 card-border border-base-300 p-4">
        <h3 class="font-semibold">{{ tr("登录保护") }}</h3>
        <p class="mt-2 text-sm opacity-60">{{ tr("配置可选人机验证、允许域名与验证密钥，保护新的密码登录。") }}</p>
        <router-link class="btn btn-neutral btn-sm mt-4 w-fit" to="/setting/human-verification">{{ tr("管理登录保护") }}</router-link>
      </div>
      <div class="card bg-base-100 card-border border-base-300 p-4">
        <h3 class="font-semibold">{{ tr("通知渠道") }}</h3>
        <p class="mt-2 text-sm opacity-60">{{ tr("邮件、飞书、Telegram 的配置、启停和通知类型订阅已统一到通知渠道页面，可选择一种或同时开启。") }}</p>
        <router-link class="btn btn-neutral btn-sm mt-4 w-fit" to="/setting/notifications">{{ tr("管理通知渠道") }}</router-link>
      </div>
    </div>
  </div>
</template>
