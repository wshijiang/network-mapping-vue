<script setup>
import { computed, ref } from 'vue'
import { Database } from '@lucide/vue'
import { webTechnologyIcon } from '@/utils/webTechnologyIcons'

// Decorative technology icon shared by the label chip, the collapsed tech badge
// and the tech tooltip list. A vendored brand SVG is preferred; the inline lucide
// Database symbol is only a fallback for database-category techs that have no
// dedicated icon. Monochrome marks get a dark-mode invert class so they stay
// legible without a white backing box.
const props = defineProps({
  technology: { type: Object, required: true },
  size: { type: Number, default: 18 },
})
const failedSource = ref('')
const source = computed(() => webTechnologyIcon(props.technology.id))
const icon = computed(() => failedSource.value === source.value ? webTechnologyIcon(null) : source.value)
const mono = computed(() => /\/(express|nextjs|generic|s3|socket-io|mkdocs)\.svg$/.test(icon.value))
const useDatabaseSymbol = computed(() => props.technology.category === 'database' && /\/generic\.svg$/.test(icon.value))
const sizeClass = computed(() => ({ 14: 'size-3.5', 16: 'size-4', 18: 'size-[18px]' }[props.size] || 'size-[18px]'))
</script>

<template>
  <Database v-if="useDatabaseSymbol" class="shrink-0" :class="sizeClass" aria-hidden="true" />
  <img v-else :src="icon" alt="" aria-hidden="true" width="18" height="18"
    class="shrink-0 rounded-sm object-contain" :class="[sizeClass, { 'tech-icon-mono': mono }]"
    decoding="async" @error="failedSource = source">
</template>