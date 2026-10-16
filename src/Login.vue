<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import AppAlert from './components/AppAlert.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import HumanVerificationWidget from '@/components/HumanVerificationWidget.vue'
import { useTheme } from '@/composables/useTheme'
import { loginProof, parseHumanVerificationConfig, requiresHumanVerification } from './utils/humanVerification.js'
import http from './utils/http'
import { getCookieValue, expireCookie } from './utils/csrf'

const username = ref('')
const password = ref('')
const { resolvedTheme } = useTheme()
const verificationConfig = ref(null)
const verificationLoading = ref(true)
const verificationError = ref('')
const verificationToken = ref('')
const verificationWidget = ref(null)
const verificationRequired = computed(() => requiresHumanVerification(verificationConfig.value))
const canLogin = computed(() => !!verificationConfig.value && !verificationLoading.value
  && !verificationError.value && (!verificationRequired.value || !!verificationToken.value))

async function loadVerificationConfig() {
  verificationLoading.value = true
  verificationError.value = ''
  verificationToken.value = ''
  verificationConfig.value = null
  try {
    const response = await http.get('/api/auth/human-verification', { timeout: 10000 })
    verificationConfig.value = parseHumanVerificationConfig(response.data)
  } catch {
    verificationError.value = '登录验证配置加载失败，请检查网络或联系管理员。'
  } finally {
    verificationLoading.value = false
  }
}
const totpToken = ref('')
const totpInputRef = ref(null)
const isLoggingIn = ref(false)
const isVerifyingTotp = ref(false)
const isTotpRequired = ref(false)
const showLoginError = ref(false)
const loginErrorMessage = ref('登录失败')
const loginErrorDescription = ref('请检查账号信息后重试。')
const loginErrorId = ref(0)
const loginErrorTimeout = ref(5000)

function closeLoginError() {
  showLoginError.value = false
}

function openLoginError(message = '登录失败', description = '') {
  loginErrorMessage.value = message
  loginErrorDescription.value = description || '请检查账号信息后重试。'
  loginErrorId.value += 1
  showLoginError.value = true
}

function getCsrfHeaders() {
  const token = getCookieValue('csrf_token')
  return token ? { 'X-CSRF-Token': token } : {}
}

const usernameInputRef = ref(null)

onMounted(() => {
  loadVerificationConfig()
  if (getCookieValue('csrf_token')) {
    expireCookie('csrf_token')
  }
  nextTick(() => {
    usernameInputRef.value?.focus()
  })
})

function onCardEnter() {
  if (isTotpRequired.value) {
    nextTick(() => {
      totpInputRef.value?.focus()
    })
  }
}

async function handleLogin() {
  if (isLoggingIn.value || !canLogin.value) return

  const proof = loginProof(verificationConfig.value, verificationToken.value)
  verificationToken.value = ''
  isLoggingIn.value = true
  let navigating = false
  try {
    const response = await http.post(
      '/api/login',
      {
        username: username.value,
        password: password.value,
        ...proof,
      },
      {
        validateStatus: () => true,
      }
    )

    if (response.status === 200) {
      localStorage.setItem('username', username.value)
      navigating = true
      window.location.href = '/'
      return
    }

    if (response.status === 401 && response.data?.success === true) {
      isTotpRequired.value = true
      totpToken.value = ''
      closeLoginError()
      return
    }

    openLoginError(response.data?.message || '登录失败', response.data?.description)
  } catch (error) {
    openLoginError('登录失败', '请检查网络连接后重试。')
  } finally {
    isLoggingIn.value = false
    if (!navigating && !isTotpRequired.value) verificationWidget.value?.reset()
  }
}

async function handleTotpVerify() {
  if (isVerifyingTotp.value) return

  isVerifyingTotp.value = true
  try {
    const response = await http.post(
      '/api/totp/verify',
      {
        username: username.value,
        token: totpToken.value,
      },
      {
        headers: getCsrfHeaders(),
        validateStatus: () => true,
      }
    )

    if (response.status === 200 && response.data?.success !== false) {
      localStorage.setItem('username', username.value)
      window.location.href = '/'
      return
    }

    if (response.status === 403 && response.data?.code === 'login_ip_not_allowlisted') {
      isTotpRequired.value = false
      totpToken.value = ''
      expireCookie('csrf_token')
    }

    openLoginError(response.data?.message || '验证码验证失败', response.data?.description)
  } catch (error) {
    openLoginError('验证码验证失败', '请检查网络连接后重试。')
  } finally {
    isVerifyingTotp.value = false
  }
}

function backToLogin() {
  isTotpRequired.value = false
  totpToken.value = ''
  closeLoginError()
}
</script>

<template>
  <div class="flex min-h-screen flex-col bg-base-200 font-sans">
    <div class="fixed right-4 top-20 z-50 flex w-[calc(100vw-2rem)] flex-col items-end sm:w-auto">
      <transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 translate-y-[-8px]"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 translate-y-[-8px]"
      >
        <AppAlert
          v-if="showLoginError"
          :key="loginErrorId"
          type="error"
          :title="loginErrorMessage"
          :description="loginErrorDescription"
          :timeout="loginErrorTimeout"
          @close="closeLoginError"
        />
      </transition>
    </div>

    <div class="flex justify-end px-4 pt-4 sm:px-8">
      <ThemeToggle />
    </div>

    <div class="flex grow items-center justify-center py-10">
      <transition
        mode="out-in"
        @after-enter="onCardEnter"
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="opacity-0 translate-y-3 scale-[0.98]"
        enter-to-class="opacity-100 translate-y-0 scale-100"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="opacity-100 translate-y-0 scale-100"
        leave-to-class="opacity-0 -translate-y-2 scale-[0.98]"
      >
        <div v-if="!isTotpRequired" key="login-card" class="card card-lg w-96 overflow-hidden border-base-300 bg-base-100 card-border">
          <div class="border-b border-dashed border-base-300">
            <div class="p-4 text-center">
              <div class="text-xl font-bold tracking-wide">Network Mapping</div>
              <div class="mt-1 text-sm opacity-60">登录账号</div>
            </div>
          </div>

          <div class="card-body gap-4">
            <div class="flex flex-col gap-1.5">
              <span class="text-sm font-semibold opacity-70">用户名</span>
              <label class="input validator input-border flex max-w-none items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="h-4 w-4 opacity-70">
                  <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12.735 14c.618 0 1.093-.561.872-1.139a6.002 6.002 0 0 0-11.215 0c-.22.578.254 1.139.872 1.139h9.47Z" />
                </svg>
                <input
                  ref="usernameInputRef"
                  v-model="username"
                  type="text"
                  required
                  class="grow"
                  placeholder="请输入用户名"
                >
              </label>
            </div>

            <div class="flex flex-col gap-1.5">
              <span class="text-sm font-semibold opacity-70">密码</span>
              <label class="input validator input-border flex max-w-none items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="h-4 w-4 opacity-70">
                  <path
                    fill-rule="evenodd"
                    d="M14 6a4 4 0 0 1-4.899 3.899l-1.955 1.955a.5.5 0 0 1-.353.146H5v1.5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-2.293a.5.5 0 0 1 .146-.353l3.955-3.955A4 4 0 1 1 14 6Zm-4-2a.75.75 0 0 0 0 1.5.5.5 0 0 1 .5.5.75.75 0 0 0 1.5 0 2 2 0 0 0-2-2Z"
                    clip-rule="evenodd"
                  />
                </svg>
                <input
                  v-model="password"
                  type="password"
                  required
                  class="grow"
                  placeholder="请输入密码"
                  @keyup.enter="handleLogin"
                >
              </label>
            </div>

            <div class="card-actions items-center gap-6">
              <p v-if="verificationLoading" class="text-sm opacity-70" role="status">正在加载登录验证配置…</p>
              <div v-else-if="verificationError" class="flex flex-col gap-2">
                <p class="text-sm text-error" role="alert">{{ verificationError }}</p>
                <button type="button" class="btn btn-outline btn-sm self-start" @click="loadVerificationConfig">重试</button>
              </div>
              <HumanVerificationWidget
                v-else-if="verificationRequired"
                ref="verificationWidget"
                class="w-full"
                :config="verificationConfig"
                :theme="resolvedTheme"
                :busy="isLoggingIn"
                @token="verificationToken = $event"
              />
              <button
                class="btn btn-neutral mt-2 w-full"
                :disabled="isLoggingIn || !canLogin"
                @click="handleLogin"
              >
                {{ isLoggingIn ? '登录中...' : '登录' }}
              </button>
            </div>
          </div>
        </div>

        <div v-else key="totp-card" class="card card-lg w-96 overflow-hidden border-base-300 bg-base-100 card-border">
          <div class="border-b border-dashed border-base-300">
            <div class="relative p-4 text-center">
              <button type="button" class="btn btn-ghost btn-xs absolute left-4 top-1/2 -translate-y-1/2 shrink-0" aria-label="返回登录" @click="backToLogin">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m12 19-7-7 7-7" />
                  <path d="M19 12H5" />
                </svg>
              </button>
              <div class="text-xl font-bold tracking-wide">Network Mapping</div>
              <div class="mt-1 text-sm opacity-60">2FA 验证</div>
            </div>
          </div>

          <div class="card-body gap-4">
            <div class="flex flex-col gap-1.5">
              <span class="text-sm font-semibold opacity-70">2FA 验证码</span>
              <label class="input validator input-border flex max-w-none items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="h-4 w-4 opacity-70">
                  <path fill-rule="evenodd" d="M8 1a4 4 0 0 0-4 4v2a2 2 0 0 0-1 1.732V13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V8.732A2 2 0 0 0 12 7V5a4 4 0 0 0-4-4Zm2.5 6V5a2.5 2.5 0 0 0-5 0v2h5Z" clip-rule="evenodd" />
                </svg>
                <input
                  ref="totpInputRef"
                  v-model="totpToken"
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  required
                  class="grow tracking-widest"
                  placeholder="请输入 6 位验证码"
                  minlength="6"
                  maxlength="6"
                  pattern="[0-9]{6}"
                  @keyup.enter="handleTotpVerify"
                >
              </label>
              <p class="validator-hint hidden">请输入 6 位数字验证码</p>
            </div>

            <div class="card-actions items-center gap-2">
              <button
                class="btn btn-neutral mt-2 w-full"
                :disabled="isVerifyingTotp"
                @click="handleTotpVerify"
              >
                {{ isVerifyingTotp ? '验证中...' : '验证' }}
              </button>
            </div>
          </div>
        </div>
      </transition>
    </div>

    <footer class="footer footer-center bg-neutral p-4 text-neutral-content sm:footer-horizontal">
      <aside>
        <p>Copyright © 2026 - All right reserved by Abdc.world</p>
      </aside>
    </footer>
  </div>
</template>
