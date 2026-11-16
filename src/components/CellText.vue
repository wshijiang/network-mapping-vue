<script setup>
import { computed } from 'vue'

// A single table-cell text line: truncates to the column width and shows the
// full value in a daisyUI tooltip on hover. Empty / "-" values render plainly
// without a tooltip. The tooltip wrapper keeps overflow visible so the bubble
// is not clipped; only the inner line truncates.
const props = defineProps({ text: { type: [String, Number], default: '-' } })
const display = computed(() => (props.text === '' || props.text == null ? '-' : String(props.text)))
const hasTip = computed(() => display.value !== '-')
</script>

<template>
  <div v-if="hasTip" class="tooltip tooltip-bottom block max-w-full" :data-tip="display">
    <div class="truncate">{{ display }}</div>
  </div>
  <span v-else>{{ display }}</span>
</template>