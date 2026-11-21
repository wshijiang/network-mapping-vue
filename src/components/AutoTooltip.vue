<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, useId, watch } from 'vue'
import { Check, Copy } from '@lucide/vue'
import { tr } from '../i18n/index.js'

// Auto-positioning, interactive tooltip styled with daisyUI tokens. Teleported to
// <body> and only mounted while open, so it never contributes to page scroll
// height and is never clipped by overflow containers. Picks the side with room
// (prefers bottom, then top / right / left), clamps to the viewport, draws an
// arrow toward the trigger and fades/slides on show/hide.
//
// The panel is hoverable: leaving the trigger only schedules a hide, so the user
// can move into the panel to select text or press the copy button. A trailing
// lucide Copy button writes the content to the clipboard.
const props = defineProps({
  content: { type: String, default: '' },
  copyText: { type: String, default: '' },
  copyable: { type: Boolean, default: true },
  open: { type: Boolean, default: false },
  prefer: { type: String, default: 'bottom' },
  // When disabled the trigger renders normally but never opens the panel
  // (used by clamp helpers that only need a tip while text is truncated).
  disabled: { type: Boolean, default: false },
})

const GAP = 12
const ARROW = 8
const HIDE_DELAY = 220
const trigger = ref(null)
const panel = ref(null)
const hovered = ref(false)
const copied = ref(false)
const pos = reactive({ left: 0, top: 0 })
const placement = ref('bottom')
const arrowOffset = ref(0)
const panelId = useId()
const visible = computed(() => props.open || hovered.value)
let hideTimer = null
let copyTimer = null

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const arrowStyle = computed(() => {
  const half = ARROW / 2
  const base = { width: `${ARROW}px`, height: `${ARROW}px` }
  switch (placement.value) {
    case 'top':
      return { ...base, bottom: `${-half - 1}px`, left: `${arrowOffset.value}px`, borderRightWidth: '1px', borderBottomWidth: '1px' }
    case 'right':
      return { ...base, left: `${-half - 1}px`, top: `${arrowOffset.value}px`, borderBottomWidth: '1px', borderLeftWidth: '1px' }
    case 'left':
      return { ...base, right: `${-half - 1}px`, top: `${arrowOffset.value}px`, borderTopWidth: '1px', borderRightWidth: '1px' }
    default:
      return { ...base, top: `${-half - 1}px`, left: `${arrowOffset.value}px`, borderLeftWidth: '1px', borderTopWidth: '1px' }
  }
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
  const vw = window.innerWidth
  const vh = window.innerHeight
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const room = { bottom: vh - rect.bottom, top: rect.top, right: vw - rect.right, left: rect.left }
  const need = { bottom: height, top: height, right: width, left: width }
  const order = ['bottom', 'top', 'right', 'left']
  if (order.includes(props.prefer)) order.splice(order.indexOf(props.prefer), 1), order.unshift(props.prefer)
  let side = order.find((s) => room[s] >= need[s] + GAP)
  if (!side) side = order.reduce((best, s) => (room[s] > room[best] ? s : best), order[0])
  placement.value = side
  if (side === 'bottom' || side === 'top') {
    pos.left = clamp(centerX - width / 2, GAP, Math.max(GAP, vw - width - GAP))
    pos.top = side === 'bottom' ? rect.bottom + GAP : rect.top - height - GAP
    pos.top = clamp(pos.top, GAP, Math.max(GAP, vh - height - GAP))
    arrowOffset.value = clamp(centerX - pos.left - ARROW / 2, ARROW, Math.max(ARROW, width - ARROW * 2))
  } else {
    pos.top = clamp(centerY - height / 2, GAP, Math.max(GAP, vh - height - GAP))
    pos.left = side === 'right' ? rect.right + GAP : rect.left - width - GAP
    pos.left = clamp(pos.left, GAP, Math.max(GAP, vw - width - GAP))
    arrowOffset.value = clamp(centerY - pos.top - ARROW / 2, ARROW, Math.max(ARROW, height - ARROW * 2))
  }
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
  if (event.key === 'Escape') {
    cancelHide()
    hovered.value = false
  }
}

function cancelHide() {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = null
}
function scheduleHide() {
  cancelHide()
  hideTimer = setTimeout(() => { hovered.value = false }, HIDE_DELAY)
}
function show() {
  if (props.disabled) return
  cancelHide()
  hovered.value = true
  updatePosition()
  addListeners()
}

async function copy() {
  const text = props.copyText || props.content
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
  copied.value = true
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copied.value = false }, 1500)
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
  cancelHide()
  if (copyTimer) clearTimeout(copyTimer)
  if (typeof window !== 'undefined') removeListeners()
})
</script>

<template>
  <span
    ref="trigger"
    class="inline-flex max-w-full min-w-0"
    :aria-describedby="visible ? panelId : undefined"
    @mouseenter="show"
    @mouseleave="scheduleHide"
    @focusin="show"
    @focusout="scheduleHide"
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
        class="fixed z-[70] max-w-sm whitespace-normal break-words rounded-box border border-base-300 bg-base-100 p-3 text-xs shadow-xl"
        :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
        @mouseenter="cancelHide"
        @mouseleave="scheduleHide"
        @focusin="cancelHide"
      >
        <span class="absolute rotate-45 border-base-300 bg-base-100" :style="arrowStyle" aria-hidden="true"></span>
        <div class="min-w-0 select-text">
          <slot name="content">{{ content }}</slot>
          <button
            v-if="copyable"
            type="button"
            class="ml-1 inline-flex align-middle opacity-60 hover:opacity-100"
            :aria-label="tr(&quot;复制&quot;)"
            :title="tr(&quot;复制&quot;)"
            @click="copy"
          >
            <Check v-if="copied" class="size-3 text-success" aria-hidden="true" />
            <Copy v-else class="size-3" aria-hidden="true" />
          </button>
        </div>
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