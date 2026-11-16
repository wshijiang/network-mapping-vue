<script setup>
import { tr } from '../i18n/index.js'
import { technologyLabel } from '@/utils/webDetection'
import TechIcon from '@/components/TechIcon.vue'

defineProps({ technology: { type: Object, required: true } })
</script>

<template>
  <span class="inline-flex max-w-full items-center gap-1 align-middle">
    <TechIcon :technology="technology" />
    <span class="break-words">{{ technologyLabel(technology) }}</span>
    <span v-if="technology.category === 'database'" class="badge badge-outline badge-sm shrink-0">{{ tr("数据库") }}</span>
  </span>
</template>