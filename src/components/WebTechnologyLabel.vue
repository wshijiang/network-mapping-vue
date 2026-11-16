<script setup>
import { technologyLabel } from '@/utils/webDetection'
import TechIcon from '@/components/TechIcon.vue'

defineProps({ technology: { type: Object, required: true } })
</script>

<template>
  <span class="inline-flex max-w-full items-center gap-1 align-middle">
    <TechIcon :technology="technology" />
    <span class="break-words">{{ technologyLabel(technology) }}</span>
  </span>
</template>