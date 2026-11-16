<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, useId, watch } from 'vue'

// Auto-positioning tooltip used for the collapsed tech-stack badge. Prefers
// bottom, flips to top when there is no room, clamps to the viewport, draws a
// small arrow toward the trigger and fades/slides on show/hide. Positioning math
// follows SystemMaintenanceTooltip.vue. Plain truncated cells use daisyUI
// tooltips instead.
const props = defineProps({
  content: { type: String, default: '' },
  open: { type: Boolean, default: false },
  prefer: { type: String, default: 'bottom' },
})

const GAP = 12
const ARROW = 8
const trigger = ref(null)
const panel = ref(null)
const hovered = ref(false)
const pos = reactive({ left: 0, top: 0 })
const placement = ref('bottom')
const arrowLeft = ref(0)
const panelId = useId()
const visible = computed(() => props.open || hovered.value)

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const arrowStyle = computed(() => {
  const base = { left: `${arrowLeft.value}px`, width: `${ARROW}px`, height: `${ARROW}px` }
  return placement.value === 'bottom'
    ? { ...base, top: `${-ARROW / 2 - 1}px`, borderLeftWidth: '1px', borderTopWidth: '1px' }
    : { ...base, bottom: `${-ARROW / 2 - 1}px`, borderRightWidth: '1px', borderBottomWidth: '1px' }
})

async function updatePosition() {
  if (typeof window === 'undefined') return
  await nextTick()
  const triggerEl = trigger.value
  const panelEl = panel.value
  if (!triggerEl || !panelEl) return
  const rect = triggerEl.getBoundingClientRect()
  const width = panelEl.offsetWidth
  const height = panelEl.offsetHeight
  const maxLeft = Math.max(GAP, window.innerWidth - width - GAP)
  pos.left = clamp(rect.left + rect.width / 2 - width / 2, GAP, maxLeft)
  const centerX = rect.left + rect.width / 2
  let top
  let place
  if (props.prefer === 'top') {
    top = rect.top - height - GAP
    place = 'top'
    if (top < GAP) {
      top = rect.bottom + GAP
      place = 'bottom'
    }
  } else {
    top = rect.bottom + GAP
    place = 'bottom'
    if (top + height > window.innerHeight - GAP) {
      top = rect.top - height - GAP
      place = 'top'
    }
  }
  pos.top = clamp(top, GAP, Math.max(GAP, window.innerHeight - height - GAP))
  placement.value = place
  arrowLeft.value = clamp(centerX - pos.left - ARROW / 2, ARROW, Math.max(ARROW, width - ARROW * 2))
}

function addListeners() {
  window.addEventListener('scroll', updatePosition, true)
  window.addEventListener('resize', updatePosition)
  window.addEventListener('keydown', onKeydown)
}
function removeListeners() {
  window.removeEventListener('scroll', updatePosition, true)
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('keydown', onKeydown)
}
function onKeydown(event) {
  if (event.key === 'Escape') hovered.value = false
}

function show() {
  hovered.value = true
  updatePosition()
  addListeners()
}
function hide() {
  hovered.value = false
  removeListeners()
}

watch(visible, (isVisible) => {
  if (typeof window === 'undefined') return
  if (isVisible) {
    updatePosition()
    addListeners()
  } else {
    removeListeners()
  }
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') removeListeners()
})
</script>

<template>
  <span
    ref="trigger"
    class="inline-flex max-w-full"
    :aria-describedby="visible ? panelId : undefined"
    @mouseenter="show"
    @mouseleave="hide"
    @focusin="show"
    @focusout="hide"
  >
    <slot></slot>
  </span>
  <Teleport to="body">
    <Transition name="auto-tip">
      <div
        v-if="visible"
        :id="panelId"
        ref="panel"
        role="tooltip"
        class="pointer-events-none fixed z-[70] max-w-sm rounded-box border border-base-300 bg-base-100 p-3 shadow-xl"
        :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
      >
        <span class="absolute rotate-45 border-base-300 bg-base-100" :style="arrowStyle" aria-hidden="true"></span>
        <slot name="content">{{ content }}</slot>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.auto-tip-enter-active,
.auto-tip-leave-active {
  transition: opacity 150ms ease, transform 150ms ease;
}
.auto-tip-enter-from,
.auto-tip-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
@media (prefers-reduced-motion: reduce) {
  .auto-tip-enter-active,
  .auto-tip-leave-active {
    transition: none;
  }
}
</style>