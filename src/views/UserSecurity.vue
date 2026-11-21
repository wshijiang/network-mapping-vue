<script setup>
import { tr } from '../i18n/index.js'

import { computed, onMounted, ref, useId } from 'vue'
import VueQrcode from 'vue-qrcode'
import AppAlert from '@/components/AppAlert.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import http from '@/utils/http'
import { expireCookie } from '@/utils/csrf'

const formFieldId = useId()
const isLoading = ref(true)
const twoFactorEnabled = ref(false)
const twoFactorBound = ref(false)
const twoFactorQrContent = ref('')
const twoFactorVerificationCode = ref('')
const twoFactorConfirming = ref(false)
const copied = ref(false)
const alerts = ref([])
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const passwordSaving = ref(false)
const passwordDialogRef = ref(null)
const allowlistLoading = ref(true)
const allowlistSaving = ref(false)
const allowlistText = ref('')
const savedAllowlistText = ref('')
const currentIp = ref('')
const maximumAllowlistEntries = ref(64)

const allowlistEntries = computed(() => (
  [...new Set(allowlistText.value.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean))]
))
const allowlistDirty = computed(() => allowlistText.value !== savedAllowlistText.value)
const allowlistTooLarge = computed(() => allowlistEntries.value.length > maximumAllowlistEntries.value)

const twoFactorStatus = computed(() => {
  if (!twoFactorEnabled.value) return tr("关闭")
  return twoFactorBound.value ? tr("已绑定") : tr("未绑定")
})

const showTwoFactorBinding = computed(() => twoFactorEnabled.value && !twoFactorBound.value)

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
  alerts.value = alerts.value.filter((a) => a.id !== id)
}

function openPasswordDialog() {
  passwordDialogRef.value?.showModal()
}

function resetPasswordForm() {
  currentPassword.value = ''
  newPassword.value = ''
  confirmPassword.value = ''
}

function closePasswordDialog() {
  if (!passwordSaving.value) passwordDialogRef.value?.close()
}

async function changePassword() {
  if (passwordSaving.value) return
  if (!currentPassword.value) {
    pushAlert('error', tr("无法修改密码"), tr("请输入当前密码。"))
    return
  }
  if (newPassword.value.length < 12 || newPassword.value.length > 128) {
    pushAlert('error', tr("无法修改密码"), tr("新密码长度必须在 12 到 128 个字符之间。"))
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    pushAlert('error', tr("无法修改密码"), tr("两次输入的新密码不一致。"))
    return
  }
  if (currentPassword.value === newPassword.value) {
    pushAlert('error', tr("无法修改密码"), tr("新密码不能与当前密码相同。"))
    return
  }

  passwordSaving.value = true
  try {
    const response = await http.post('/api/user/password/update', {
      current_password: currentPassword.value,
      new_password: newPassword.value,
    }, {
      validateStatus: () => true,
    })
    if (response.status === 200 && response.data?.success === true) {
      currentPassword.value = ''
      newPassword.value = ''
      confirmPassword.value = ''
      expireCookie('csrf_token')
      pushAlert('success', tr("密码已修改"), tr("登录会话已失效，即将跳转至登录页。"), 3000)
      window.setTimeout(() => {
        window.location.href = '/login'
      }, 1000)
    } else {
      pushAlert('error', tr("密码修改失败"), response.data?.message || tr("请检查当前密码后重试。"))
    }
  } catch (error) {
    console.error('change password failed', error)
    pushAlert('error', tr("密码修改请求失败"), tr("请检查网络连接后重试。"))
  } finally {
    passwordSaving.value = false
  }
}

function redirectToLoginAfterSessionInvalidation(message) {
  expireCookie('csrf_token')
  pushAlert('success', tr("登录已失效"), message, 3000)
  window.setTimeout(() => {
    window.location.href = '/login'
  }, 1000)
}

async function fetchTotpStatus() {
  try {
    const response = await http.get('/api/totp/get')
    if (response.data?.success === true) {
      twoFactorBound.value = true
      twoFactorEnabled.value = true
    }
  } catch (error) {
    console.error('fetch TOTP status failed', error)
    pushAlert('error', tr("2FA 状态获取失败"), tr("请稍后刷新页面重试。"))
  } finally {
    isLoading.value = false
  }
}

function applyAllowlistResponse(response) {
  const entries = Array.isArray(response.data?.data?.entries) ? response.data.data.entries : []
  const text = entries.join('\n')
  allowlistText.value = text
  savedAllowlistText.value = text
  currentIp.value = response.data?.data?.currentIp || ''
  maximumAllowlistEntries.value = Number(response.data?.limits?.maximumEntries) || 64
}

async function fetchLoginAllowlist() {
  allowlistLoading.value = true
  try {
    const response = await http.get('/api/user/security/login-ip-allowlist')
    if (response.data?.success !== true || !response.data?.data) {
      throw new Error(tr("服务器未返回有效登录白名单"))
    }
    applyAllowlistResponse(response)
  } catch (error) {
    console.error('fetch login IP allowlist failed', error)
    pushAlert('error', tr("登录白名单加载失败"), error.response?.data?.message || tr("请稍后刷新页面重试。"))
  } finally {
    allowlistLoading.value = false
  }
}

function addCurrentIp() {
  if (!currentIp.value || allowlistEntries.value.includes(currentIp.value)) return
  allowlistText.value = [...allowlistEntries.value, currentIp.value].join('\n')
}

async function saveLoginAllowlist() {
  if (allowlistSaving.value || allowlistTooLarge.value) return false
  allowlistSaving.value = true
  try {
    const response = await http.put('/api/user/security/login-ip-allowlist', {
      entries: allowlistEntries.value,
    }, {
      validateStatus: () => true,
    })
    if (response.status !== 200 || response.data?.success !== true) {
      pushAlert('error', tr("登录白名单保存失败"), response.data?.message || tr("请检查 IP 和 CIDR 格式后重试。"))
      return false
    }
    applyAllowlistResponse(response)
    pushAlert(
      'success',
      tr("登录白名单已保存"),
      allowlistEntries.value.length > 0 ? tr("后续登录仅允许白名单内的来源 IP。") : tr("登录来源限制已关闭。"),
      5000
    )
    return true
  } catch (error) {
    console.error('save login IP allowlist failed', error)
    pushAlert('error', tr("登录白名单保存失败"), tr("请检查网络连接后重试。"))
    return false
  } finally {
    allowlistSaving.value = false
  }
}

const confirmDialog = ref(null)
useUnsavedChanges(allowlistDirty, saveLoginAllowlist, confirmDialog)

async function onToggleTwoFactor(event) {
  const checked = event.target.checked

  if (!checked) {
    const username = localStorage.getItem('username') || ''
    try {
      const response = await http.post('/api/totp/unbind', { username }, {
        validateStatus: () => true,
      })

      if (response.status === 200) {
        twoFactorEnabled.value = false
        twoFactorBound.value = false
        twoFactorQrContent.value = ''
        redirectToLoginAfterSessionInvalidation(tr("2FA 已解绑，所有登录会话均已失效，即将跳转至登录页。"))
      } else if (response.status === 404) {
        twoFactorEnabled.value = true
        pushAlert('error', tr("解绑失败"), tr("未找到对应用户，请稍后重试。"))
      } else if (response.status === 403) {
        twoFactorEnabled.value = true
        pushAlert('error', tr("解绑失败"), tr("权限不足，无法执行此操作。"))
      } else {
        twoFactorEnabled.value = true
        pushAlert('error', tr("解绑失败"), tr("服务器错误，请稍后重试。"))
      }
    } catch (error) {
      console.error('unbind TOTP failed', error)
      twoFactorEnabled.value = true
      pushAlert('error', tr("2FA 解绑请求失败"), tr("请检查网络连接后重试。"))
    }
    return
  }

  // 开启 2FA：请求绑定链接
  try {
    const response = await http.get('/api/totp/bind')
    if (response.data?.success === true && response.data?.data) {
      twoFactorEnabled.value = true
      twoFactorQrContent.value = response.data.data
    } else {
      twoFactorEnabled.value = false
      pushAlert('error', tr("2FA 绑定初始化失败"), tr("服务器未能返回绑定信息，请稍后重试。"))
    }
  } catch (error) {
    console.error('bind TOTP failed', error)
    twoFactorEnabled.value = false
    pushAlert('error', tr("2FA 绑定请求失败"), tr("请检查网络连接后重试。"))
  }
}

async function copyTwoFactorContent() {
  const text = twoFactorQrContent.value
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }

  copied.value = true
  window.setTimeout(() => {
    copied.value = false
  }, 1600)
}

async function confirmTwoFactorBinding() {
  const token = twoFactorVerificationCode.value.trim()
  if (!/^\d{6}$/.test(token)) {
    pushAlert('error', tr("无法确认绑定"), tr("请输入认证器中显示的 6 位验证码。"))
    return
  }

  twoFactorConfirming.value = true
  try {
    const response = await http.post('/api/totp/verify', { token }, { validateStatus: () => true })
    if (response.status === 200 && response.data?.success === true) {
      twoFactorBound.value = true
      twoFactorEnabled.value = true
      twoFactorQrContent.value = ''
      twoFactorVerificationCode.value = ''
      redirectToLoginAfterSessionInvalidation(tr("2FA 已绑定，所有登录会话均已失效，请重新登录。"))
    } else {
      pushAlert('error', tr("2FA 绑定确认失败"), response.data?.message || tr("验证码不正确或绑定已过期，请重新开始。"))
    }
  } catch (error) {
    console.error('confirm TOTP binding failed', error)
    pushAlert('error', tr("2FA 绑定确认请求失败"), tr("请检查网络连接后重试。"))
  } finally {
    twoFactorConfirming.value = false
  }
}

onMounted(() => {
  fetchTotpStatus()
  fetchLoginAllowlist()
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
      <h1 class="page-title">{{ tr("用户安全") }}</h1>
      <p class="mt-1 text-xs opacity-60">{{ tr("管理当前用户的登录保护、双因素认证和安全验证状态。") }}</p>
    </div>

    <div class="card bg-base-100 card-border border-base-300 mb-5 p-4">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 class="font-semibold">{{ tr("修改密码") }}</h3>
          <p class="mt-1 text-xs opacity-60">{{ tr("修改成功后，当前账户的所有登录会话都会失效，需要重新登录。") }}</p>
        </div>
        <button type="button" class="btn btn-neutral btn-sm" @click="openPasswordDialog">{{ tr("修改密码") }}</button>
      </div>
    </div>
    <div class="card bg-base-100 card-border border-base-300 mb-5 p-4">
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <h3 class="font-semibold">{{ tr("登录 IP 白名单") }}</h3>
            <span class="badge badge-sm" :class="allowlistEntries.length ? 'badge-success' : 'badge-ghost'">
              {{ allowlistEntries.length ? tr("已启用") : tr("未启用") }}
            </span>
          </div>
          <p class="mt-1 text-xs opacity-60">{{ tr("设置后，仅允许匹配的 IPv4、IPv6 或 CIDR 地址登录。回环地址和内网地址不会自动放行。") }}</p>
        </div>
        <button
          type="button"
          class="btn btn-neutral btn-sm"
          :disabled="allowlistLoading || allowlistSaving || !allowlistDirty || allowlistTooLarge"
          @click="saveLoginAllowlist"
        >
          {{ allowlistSaving ? tr("保存中...") : tr("保存白名单") }}
        </button>
      </div>

      <div v-if="allowlistLoading" class="skeleton h-44 w-full rounded-box"></div>
      <div v-else class="space-y-3">
        <div class="flex flex-wrap items-center gap-2 rounded-box bg-base-200 px-3 py-2 text-sm">
          <span class="opacity-60">{{ tr("当前识别 IP") }}</span>
          <code class="font-medium">{{ currentIp || '无法识别' }}</code>
          <button v-if="currentIp" type="button" class="btn btn-ghost btn-xs ml-auto" @click="addCurrentIp">{{ tr("添加当前 IP") }}</button>
        </div>

        <fieldset class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label for="usersecurity-allowlisttext">{{ tr("允许登录的地址") }}</label></legend>
          <textarea
            id="usersecurity-allowlisttext"
            v-model="allowlistText"
            class="textarea textarea-bordered min-h-36 w-full font-mono text-sm"
            :disabled="allowlistSaving"
            placeholder="192.0.2.10&#10;10.0.0.0/8&#10;2001:db8::/48"
          ></textarea>
        </fieldset>

        <div class="flex flex-wrap justify-between gap-2 text-xs">
          <p class="opacity-60">{{ tr("每行填写一个地址；留空并保存表示关闭限制。当前会话不会因修改立即失效。") }}</p>
          <p :class="allowlistTooLarge ? 'text-error' : 'opacity-60'">
            {{ allowlistEntries.length }} / {{ maximumAllowlistEntries }} {{ tr("条") }} </p>
        </div>
        <div v-if="allowlistEntries.length && currentIp" class="alert alert-warning py-2 text-sm"> {{ tr("保存前请确认白名单覆盖当前及后续登录所使用的网络；错误设置可能导致账号无法再次登录。") }} </div>
      </div>
    </div>

    <div class="card bg-base-100 card-border border-base-300 p-4">
      <div class="mb-4">
        <h3 class="font-semibold">{{ tr("2FA 设置") }}</h3>
        <p class="mt-1 text-xs opacity-60">{{ tr("启用后，登录时需要额外的身份验证步骤。") }}</p>
      </div>

      <div v-if="isLoading" class="skeleton h-40 w-full rounded-box"></div>

      <div v-else class="divide-y divide-base-300">
        <div class="flex items-center justify-between gap-4 py-3">
          <div>
            <div class="text-sm font-medium">{{ tr("启用 2FA") }}</div>
            <div class="text-xs opacity-60">{{ tr("控制用户双因素认证相关设置的总开关。") }}</div>
          </div>
          <input type="checkbox" class="toggle" :checked="twoFactorEnabled" @change="onToggleTwoFactor" />
        </div>

        <div class="flex items-center justify-between gap-4 py-3">
          <div>
            <div class="text-sm font-medium">{{ tr("2FA 绑定状态") }}</div>
            <div class="text-xs opacity-60">{{ tr("显示当前用户是否已经绑定双因素认证设备。") }}</div>
          </div>
          <span class="badge" :class="twoFactorEnabled && twoFactorBound ? 'badge-success' : 'badge-ghost'">
            {{ twoFactorStatus }}
          </span>
        </div>

        <div v-if="showTwoFactorBinding" class="flex w-full flex-col items-center justify-center py-4 lg:flex-row lg:gap-4">
          <div class="grid shrink-0 place-items-center">
            <div class="rounded-lg border border-base-300 bg-white p-3">
              <vue-qrcode
                :value="twoFactorQrContent"
                :width="160"
                :margin="1"
                type="image/png"
                :color="{ dark: '#000000ff', light: '#ffffffff' }"
              />
            </div>
          </div>

          <div class="divider my-2 lg:divider-horizontal lg:mx-0">OR</div>

          <div class="grid w-full max-w-md place-items-center lg:w-auto">
            <div class="w-full min-w-0">
              <div class="text-sm font-medium">{{ tr("扫码绑定 2FA") }}</div>
              <p class="mt-1 text-xs opacity-60">{{ tr("使用认证器应用扫描左侧二维码，或复制下方测试内容手动添加。") }}</p>

              <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <code class="block min-w-0 flex-1 overflow-hidden text-ellipsis rounded-lg bg-base-200 px-3 py-2 text-xs">
                  {{ twoFactorQrContent }}
                </code>
                <button type="button" class="btn btn-neutral btn-sm rounded-lg" @click="copyTwoFactorContent">
                  {{ copied ? tr("已复制") : tr("复制") }}
                </button>
              </div>

              <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input v-model="twoFactorVerificationCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="input input-bordered w-full" :placeholder="tr(&quot;输入 6 位验证码以确认绑定&quot;)" :disabled="twoFactorConfirming" />
                <button type="button" class="btn btn-neutral shrink-0" :disabled="twoFactorConfirming" @click="confirmTwoFactorBinding">
                  {{ twoFactorConfirming ? tr("确认中...") : tr("确认绑定") }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <dialog ref="passwordDialogRef" class="modal" @close="resetPasswordForm">
    <form class="modal-box w-[calc(100vw-2rem)] max-w-md" @submit.prevent="changePassword">
      <h3 class="text-lg font-bold">{{ tr("修改密码") }}</h3>
      <p class="py-3 text-sm opacity-70">{{ tr("修改成功后，当前账户的所有登录会话都会失效，需要重新登录。") }}</p>

      <div class="space-y-4">
        <fieldset class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label :for="`${formFieldId}-1`">{{ tr("当前密码") }}</label></legend>
          <input :id="`${formFieldId}-1`" v-model="currentPassword" type="password" autocomplete="current-password" class="input input-bordered w-full" required />
        </fieldset>
        <fieldset class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label :for="`${formFieldId}-2`">{{ tr("新密码") }}</label></legend>
          <input :id="`${formFieldId}-2`" v-model="newPassword" type="password" autocomplete="new-password" minlength="12" maxlength="128" class="input input-bordered w-full" required />
        </fieldset>
        <fieldset class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label :for="`${formFieldId}-3`">{{ tr("确认新密码") }}</label></legend>
          <input :id="`${formFieldId}-3`" v-model="confirmPassword" type="password" autocomplete="new-password" minlength="12" maxlength="128" class="input input-bordered w-full" required />
        </fieldset>
      </div>

      <p class="mt-3 text-xs opacity-60">{{ tr("新密码长度为 12 至 128 个字符。") }}</p>
      <div class="modal-action">
        <button type="button" class="btn btn-ghost" :disabled="passwordSaving" @click="closePasswordDialog">{{ tr("取消") }}</button>
        <button type="submit" class="btn btn-neutral" :disabled="passwordSaving">{{ passwordSaving ? tr("修改中...") : tr("确认修改") }}</button>
      </div>
    </form>
    <form method="dialog" class="modal-backdrop">
      <button :disabled="passwordSaving">{{ tr("关闭") }}</button>
    </form>
  </dialog>
</template>
