<script setup>
import { tr } from '../i18n/index.js'

import { computed, ref } from 'vue'
import { Database } from '@lucide/vue'
import { technologyLabel } from '@/utils/webDetection'
import { webTechnologyIcon } from '@/utils/webTechnologyIcons'

const props = defineProps({ technology: { type: Object, required: true } })
const failedSource = ref('')
const source = computed(() => webTechnologyIcon(props.technology.id))
const icon = computed(() => failedSource.value === source.value ? webTechnologyIcon(null) : source.value)
// Monochrome marks (black fill / currentColor stroke) need a dark-mode invert to
// stay legible now that the white backing box is gone. Reflects the resolved icon,
// including the generic fallback.
const mono = computed(() => /\/(express|nextjs|generic|s3)\.svg$/.test(icon.value))
</script>

<template>
  <span class="inline-flex max-w-full items-center gap-1 align-middle">
    <Database v-if="technology.category === 'database'" class="size-[18px] shrink-0" aria-hidden="true" />
    <img v-else :src="icon" alt="" aria-hidden="true" width="18" height="18"
      class="size-[18px] shrink-0 rounded-sm object-contain" :class="{ 'tech-icon-mono': mono }"
      decoding="async" @error="failedSource = source">
    <span class="break-words">{{ technologyLabel(technology) }}</span>
    <span v-if="technology.category === 'database'" class="badge badge-outline badge-sm shrink-0">{{ tr("数据库") }}</span>
  </span>
</template>
