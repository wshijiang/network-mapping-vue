<script setup>
import { ref } from 'vue'
import { tr } from '../i18n/index.js'

// Shared column-visibility manager. The parent owns the persisted state
// (useColumnVisibility); this modal only renders and emits toggle / reset.
const props = defineProps({
  columns: { type: Array, required: true },
  hiddenKeys: { type: Array, default: () => [] },
  isDefault: { type: Boolean, default: true },
})
const emit = defineEmits(['toggle', 'reset', 'close'])
const dialogRef = ref(null)

const visibleCount = () => props.columns.filter((column) => !props.hiddenKeys.includes(column.key)).length

function open() {
  dialogRef.value?.showModal()
}
function close() {
  dialogRef.value?.close()
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="dialogRef" class="modal" @close="emit('close')">
    <div class="modal-box w-[calc(100vw-2rem)] max-w-md">
      <h3 class="text-lg font-bold">{{ tr("管理显示列") }}</h3>
      <p class="py-2 text-sm opacity-70">{{ tr("选择表格中显示的列，设置保存在本浏览器中，不会过期。") }}</p>
      <div class="max-h-[50dvh] space-y-1 overflow-y-auto py-2">
        <label
          v-for="column in columns"
          :key="column.key"
          class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-base-200"
        >
          <input
            type="checkbox"
            class="checkbox checkbox-sm checkbox-neutral"
            :checked="!hiddenKeys.includes(column.key)"
            :disabled="!hiddenKeys.includes(column.key) && visibleCount() <= 1"
            @change="emit('toggle', column.key)"
          />
          <span class="min-w-0 truncate">{{ column.label }}</span>
        </label>
      </div>
      <div class="modal-action">
        <button type="button" class="btn btn-ghost" :disabled="isDefault" @click="emit('reset')">{{ tr("重置为默认") }}</button>
        <button type="button" class="btn btn-neutral" @click="close">{{ tr("关闭") }}</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button type="button" @click="close">{{ tr("关闭") }}</button>
    </form>
  </dialog>
</template>