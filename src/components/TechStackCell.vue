<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { tr } from '../i18n/index.js'
import { technologyLabel } from '@/utils/webDetection'
import WebTechnologyLabel from '@/components/WebTechnologyLabel.vue'
import AutoTooltip from '@/components/AutoTooltip.vue'
import TechIcon from '@/components/TechIcon.vue'

// Technologies render as full icon chips — never a half-truncated chip. Only the
// chips that fit the column entirely are shown; when some do not fit, a trailing
// soft-primary "共N条" badge appears and its auto-positioning tooltip lists every
// technology with its icon. A hidden measuring row provides stable chip widths;
// per-cell fit detection with hysteresis avoids badge flicker at boundary widths.
const props = defineProps({
  web: { type: Object, default: null },
  forceBadge: { type: Boolean, default: false },
})
const technologies = computed(() => ['identified', 'partial'].includes(props.web?.status) && Array.isArray(props.web?.technologies) ? props.web.technologies.slice(0, 64) : [])
const GAP = 8
const box = ref(null)
const measureRow = ref(null)
const badgeWrap = ref(null)
const fitCount = ref(technologies.value.length)
const measuredBadge = ref(false)
const badgeWidth = ref(72)
const showBadge = computed(() => props.forceBadge || measuredBadge.value)
const visibleChips = computed(() => technologies.value.slice(0, props.forceBadge ? technologies.value.length : fitCount.value))
let observer = null

function computeFit() {
  const el = box.value
  const row = measureRow.value
  if (!el || !row || props.forceBadge) return
  const widths = [...row.children].map((child) => child.offsetWidth)
  const n = widths.length
  const total = widths.reduce((s, w) => s + w, 0) + GAP * Math.max(0, n - 1)
  const cellW = el.clientWidth
  if (total <= cellW) {
    measuredBadge.value = false
    fitCount.value = n
    return
  }
  measuredBadge.value = true
  const avail = cellW - badgeWidth.value - GAP
  let acc = 0
  let k = 0
  for (const w of widths) {
    const next = acc + w + (k ? GAP : 0)
    if (next > avail) break
    acc = next
    k += 1
  }
  fitCount.value = k
  nextTick(() => {
    if (badgeWrap.value) badgeWidth.value = badgeWrap.value.offsetWidth
  })
}

async function remeasure() {
  fitCount.value = technologies.value.length
  await nextTick()
  computeFit()
}

onMounted(() => {
  computeFit()
  if (typeof ResizeObserver !== 'undefined' && box.value) {
    observer = new ResizeObserver(() => computeFit())
    observer.observe(box.value)
  }
})

watch(() => props.web, () => { remeasure() })

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div v-if="technologies.length" ref="box" class="relative flex items-center gap-2">
    <div ref="measureRow" class="pointer-events-none invisible absolute flex flex-nowrap items-center gap-2" aria-hidden="true">
      <WebTechnologyLabel v-for="technology in technologies" :key="`m-${technology.id}`" :technology="technology" />
    </div>
    <div class="flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden">
      <WebTechnologyLabel v-for="technology in visibleChips" :key="technology.id" :technology="technology" />
    </div>
    <span v-if="showBadge" ref="badgeWrap" class="shrink-0">
      <AutoTooltip prefer="bottom">
        <button type="button" class="badge badge-soft badge-primary whitespace-nowrap">{{ tr("共{0}条", [technologies.length]) }}</button>
        <template #content>
          <ul class="space-y-1 text-xs">
            <li v-for="technology in technologies" :key="technology.id" class="flex items-center gap-1.5">
              <TechIcon :technology="technology" :size="16" />
              <span>{{ technologyLabel(technology) }}</span>
            </li>
          </ul>
        </template>
      </AutoTooltip>
    </span>
  </div>
  <span v-else class="text-xs opacity-50">-</span>
</template>