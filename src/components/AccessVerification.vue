<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { tr } from '../i18n/index.js'
import http from '@/utils/http'

const dialog = ref(null)
const password = ref('')
const totp = ref('')
const error = ref('')
const saving = ref(false)
let resolveVerification

function finish(ok) {
  resolveVerification?.(ok)
  resolveVerification = undefined
  password.value = ''
  totp.value = ''
  error.value = ''
}

function verify() {
  if (!dialog.value || dialog.value.open) return Promise.resolve(false)
  dialog.value.showModal()
  return new Promise(resolve => { resolveVerification = resolve })
}

async function submit() {
  saving.value = true
  error.value = ''
  try {
    await http.post('/api/access/verify', { password: password.value, totp: totp.value })
    finish(true)
    dialog.value?.close()
  } catch (failure) {
    error.value = failure?.response?.data?.error?.message || tr('身份验证失败')
  } finally {
    saving.value = false
  }
}

onBeforeUnmount(() => finish(false))
defineExpose({ verify })
</script>

<template>
  <dialog ref="dialog" class="modal" @cancel="saving && $event.preventDefault()" @close="finish(false)">
    <form class="modal-box w-[calc(100vw-2rem)] max-w-md" @submit.prevent="submit">
      <h3 class="text-lg font-semibold">{{ tr('重新验证身份') }}</h3>
      <p class="mt-1 text-xs opacity-60">{{ tr('请输入当前密码。如已启用双因素认证，请同时填写验证码。') }}</p>
      <p v-if="error" role="alert" class="alert alert-error mt-4">{{ error }}</p>
      <fieldset class="fieldset mt-4">
        <label class="fieldset-legend">{{ tr('当前密码') }}</label>
        <input v-model="password" class="input input-bordered w-full" type="password" autocomplete="current-password" required maxlength="256" :disabled="saving" :aria-label="tr('当前密码')" />
      </fieldset>
      <fieldset class="fieldset">
        <label class="fieldset-legend">{{ tr('双因素验证码') }}</label>
        <input v-model="totp" class="input input-bordered w-full" inputmode="numeric" autocomplete="one-time-code" maxlength="6" :disabled="saving" :aria-label="tr('双因素验证码')" />
      </fieldset>
      <div class="modal-action">
        <button type="button" class="btn" :disabled="saving" @click="dialog.close()">{{ tr('取消') }}</button>
        <button type="submit" class="btn btn-neutral" :disabled="saving">{{ tr('验证') }}</button>
      </div>
    </form>
  </dialog>
</template>
