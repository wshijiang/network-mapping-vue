<script setup>
import { computed } from 'vue'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from '@lucide/vue'
import { tr } from '../i18n/index.js'

// daisyUI join pager with first / previous / numbered window / next / last.
// Designed to live inside a card footer; the parent owns the page state.
const props = defineProps({
  page: { type: Number, required: true },
  totalPages: { type: Number, required: true },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['change'])

const WINDOW = 5
const pageCount = computed(() => Math.max(1, props.totalPages))
const current = computed(() => Math.min(Math.max(1, props.page), pageCount.value))
const numberWindow = computed(() => {
  const total = pageCount.value
  let start = Math.max(1, current.value - Math.floor(WINDOW / 2))
  const end = Math.min(total, start + WINDOW - 1)
  start = Math.max(1, end - WINDOW + 1)
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
})

function go(target) {
  if (props.disabled || target < 1 || target > pageCount.value || target === current.value) return
  emit('change', target)
}
</script>

<template>
  <div class="join" role="navigation" :aria-label="tr(&quot;分页&quot;)">
    <button type="button" class="join-item btn btn-sm transition-colors" :disabled="disabled || current <= 1" :title="tr(&quot;首页&quot;)" :aria-label="tr(&quot;首页&quot;)" @click="go(1)">
      <ChevronsLeft class="size-4" aria-hidden="true" />
    </button>
    <button type="button" class="join-item btn btn-sm transition-colors" :disabled="disabled || current <= 1" :title="tr(&quot;上一页&quot;)" :aria-label="tr(&quot;上一页&quot;)" @click="go(current - 1)">
      <ChevronLeft class="size-4" aria-hidden="true" />
    </button>
    <button
      v-for="number in numberWindow"
      :key="number"
      type="button"
      class="join-item btn btn-sm tabular-nums transition-colors"
      :class="number === current ? 'btn-neutral' : ''"
      :disabled="disabled"
      :aria-current="number === current ? 'page' : undefined"
      @click="go(number)"
    >{{ number }}</button>
    <button type="button" class="join-item btn btn-sm transition-colors" :disabled="disabled || current >= pageCount" :title="tr(&quot;下一页&quot;)" :aria-label="tr(&quot;下一页&quot;)" @click="go(current + 1)">
      <ChevronRight class="size-4" aria-hidden="true" />
    </button>
    <button type="button" class="join-item btn btn-sm transition-colors" :disabled="disabled || current >= pageCount" :title="tr(&quot;末页&quot;)" :aria-label="tr(&quot;末页&quot;)" @click="go(pageCount)">
      <ChevronsRight class="size-4" aria-hidden="true" />
    </button>
  </div>
</template>