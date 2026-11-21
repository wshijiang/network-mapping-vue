<script setup>
import { computed, ref, watch } from 'vue'
import AutoTooltip from '@/components/AutoTooltip.vue'

// Multi-line field value: wraps freely up to `lines` lines, then clamps with
// an ellipsis. While clamped, hovering shows the full text in an AutoTooltip
// (with copy). Width is always bounded by the parent, so long unbreakable
// values grow the height instead of overflowing the card.
const props = defineProps({
  text: { type: [String, Number], default: '-' },
  lines: { type: Number, default: 3 },
})
const display = computed(() => (props.text === '' || props.text == null ? '-' : String(props.text)))
const clampClass = computed(() => ({ 2: 'line-clamp-2', 3: 'line-clamp-3', 4: 'line-clamp-4' }[props.lines] || 'line-clamp-3'))
const el = ref(null)
const clamped = ref(false)
let observer

function measure() {
  const node = el.value
  clamped.value = Boolean(node && node.scrollHeight > node.clientHeight + 1)
}

watch(el, (node) => {
  observer?.disconnect()
  observer = undefined
  if (!node) return
  measure()
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure)
    observer.observe(node)
  }
})
</script>

<template>
  <AutoTooltip :content="display" :disabled="!clamped || display === '-'">
    <span ref="el" class="block min-w-0 break-words" :class="clampClass">{{ display }}</span>
  </AutoTooltip>
</template>