<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { tr } from '../i18n/index.js'
import { technologyLabel } from '@/utils/webDetection'
import WebTechnologies from '@/components/WebTechnologies.vue'
import AutoTooltip from '@/components/AutoTooltip.vue'

// One search-result tech cell. Shows compact chips while they fit the column;
// when they overflow, collapses to a single soft-primary badge ("nginx 共5条")
// whose auto-positioning tooltip lists every technology. Per-cell overflow
// detection with cached-width hysteresis avoids collapse/expand oscillation.
const props = defineProps({
  web: { type: Object, default: null },
  forceCollapse: { type: Boolean, default: false },
})

const technologies = computed(() => ['identified', 'partial'].includes(props.web?.status) && Array.isArray(props.web?.technologies) ? props.web.technologies.slice(0, 64) : [])
const box = ref(null)
const collapsed = ref(false)
const isCollapsed = computed(() => props.forceCollapse || collapsed.value)
const badgeText = computed(() => technologies.value.length ? tr("{0} 共{1}条", [technologyLabel(technologies.value[0]), technologies.value.length]) : '')
let chipsWidth = 0
let observer = null

function measure() {
  const el = box.value
  if (!el || props.forceCollapse) return
  if (collapsed.value) {
    if (chipsWidth && chipsWidth <= el.clientWidth) collapsed.value = false
  } else {
    chipsWidth = el.scrollWidth
    if (el.scrollWidth > el.clientWidth) collapsed.value = true
  }
}

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && box.value) {
    observer = new ResizeObserver(() => measure())
    observer.observe(box.value)
  }
})

watch(() => props.web, () => {
  chipsWidth = 0
  collapsed.value = false
  measure()
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div v-if="technologies.length" ref="box" class="overflow-hidden">
    <AutoTooltip v-if="isCollapsed" prefer="bottom">
      <button type="button" class="badge badge-soft badge-primary whitespace-nowrap">{{ badgeText }}</button>
      <template #content>
        <ul class="space-y-1 text-xs">
          <li v-for="technology in technologies" :key="technology.id">{{ technologyLabel(technology) }}</li>
        </ul>
      </template>
    </AutoTooltip>
    <ul v-if="isCollapsed" class="sr-only">
      <li v-for="technology in technologies" :key="technology.id">{{ technologyLabel(technology) }}</li>
    </ul>
    <WebTechnologies v-else compact :value="web" />
  </div>
  <span v-else class="text-xs opacity-50">-</span>
</template>