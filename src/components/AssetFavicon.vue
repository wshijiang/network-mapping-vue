<script setup>
import { computed, ref } from 'vue'
import { tr } from '../i18n/index.js'
import AutoTooltip from '@/components/AutoTooltip.vue'

// Favicon of a scanned endpoint, served from stored bytes through the backend
// relay (/api/assets/favicon) — the browser never hotlinks the target. Renders
// nothing when the endpoint has no icon or the image fails to load, so tables
// keep their original layout for icon-less assets. The tooltip exposes the
// MD5 (copyable) and a one-click same-icon search.
const props = defineProps({
  ip: { type: String, required: true },
  port: { type: [Number, String], default: null },
  protocol: { type: String, default: '' },
  iconMd5: { type: String, default: '' },
  size: { type: Number, default: 16 },
})
const failed = ref(false)
const src = computed(() => {
  if (props.port == null || props.port === '') return ''
  const params = new URLSearchParams({ ip: props.ip, port: String(props.port) })
  if (props.protocol) params.set('protocol', props.protocol)
  return `/api/assets/favicon?${params.toString()}`
})
const sizeClass = computed(() => ({ 14: 'size-3.5', 16: 'size-4', 18: 'size-[18px]', 24: 'size-6' }[props.size] || 'size-4'))
const tooltip = computed(() => props.iconMd5 ? `Favicon MD5: ${props.iconMd5}` : tr("网站图标"))
const searchHref = computed(() => props.iconMd5
  ? `/search.html?q=${encodeURIComponent(`icon_md5 = "${props.iconMd5}"`)}`
  : '')
</script>

<template>
  <AutoTooltip v-if="src && !failed" :content="tooltip" :copy-text="iconMd5" :copyable="!!iconMd5" prefer="bottom">
    <img :src="src" alt="" aria-hidden="true" :width="size" :height="size"
      class="shrink-0 rounded-sm object-contain" :class="sizeClass"
      loading="lazy" decoding="async" @error="failed = true" />
    <template #content>
      <div class="space-y-1">
        <div v-if="iconMd5" class="break-all font-mono text-xs">MD5: {{ iconMd5 }}</div>
        <a v-if="searchHref" class="link link-primary text-xs" :href="searchHref">{{ tr("按此图标搜索同类资产") }}</a>
      </div>
    </template>
  </AutoTooltip>
</template>
