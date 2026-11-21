<script setup>
import { ref } from 'vue'
import { tr } from '../i18n/index.js'

// Promise-based daisyUI confirmation modal for dangerous operations.
// ask() resolves true only when the user presses the confirm button; Esc,
// backdrop clicks and the cancel button resolve false. A new ask() supersedes
// any still-pending one (resolved as cancelled).
const dialogRef = ref(null)
const options = ref({ title: '', message: '', confirmText: '', danger: false })
let resolver = null

function settle(value) {
  if (!resolver) return
  const resolve = resolver
  resolver = null
  resolve(value)
}

function ask(next = {}) {
  settle(false)
  options.value = {
    title: next.title || tr("确认操作"),
    message: next.message || '',
    confirmText: next.confirmText || tr("确认"),
    danger: Boolean(next.danger),
  }
  dialogRef.value?.showModal()
  return new Promise((resolve) => { resolver = resolve })
}

function confirm() {
  settle(true)
  dialogRef.value?.close()
}

function cancel() {
  settle(false)
  dialogRef.value?.close()
}

// close() queues its event; when a new ask() reopens the dialog before that
// event fires (save prompt → discard prompt), the stale event must not cancel
// the new prompt. Only a genuinely closed dialog resolves as cancelled.
function onClose() {
  if (dialogRef.value?.open) return
  settle(false)
}

defineExpose({ ask })
</script>

<template>
  <dialog ref="dialogRef" class="modal" @close="onClose">
    <div class="modal-box w-[calc(100vw-2rem)] max-w-md">
      <h3 class="text-lg font-bold break-words">{{ options.title }}</h3>
      <p v-if="options.message" class="py-3 text-sm opacity-70 break-words">{{ options.message }}</p>
      <div class="modal-action">
        <button type="button" class="btn btn-ghost" @click="cancel">{{ tr("取消") }}</button>
        <button type="button" class="btn transition-colors" :class="options.danger ? 'btn-error' : 'btn-neutral'" @click="confirm">{{ options.confirmText }}</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button type="button" @click="cancel">{{ tr("关闭") }}</button>
    </form>
  </dialog>
</template>