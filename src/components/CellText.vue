<script setup>
import { computed } from 'vue'
import AutoTooltip from '@/components/AutoTooltip.vue'

// A single table-cell text line: truncates to the column width and shows the
// full value in an auto-positioning daisyUI-styled tooltip on hover. Empty / "-"
// values render plainly without a tooltip.
const props = defineProps({ text: { type: [String, Number], default: '-' } })
const display = computed(() => (props.text === '' || props.text == null ? '-' : String(props.text)))
const hasTip = computed(() => display.value !== '-')
</script>

<template>
  <AutoTooltip v-if="hasTip" :content="display">
    <span class="block truncate">{{ display }}</span>
  </AutoTooltip>
  <span v-else>{{ display }}</span>
</template>