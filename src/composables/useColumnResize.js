import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

const STORAGE_KEY = 'network_mapping_search_column_widths'
const MAX_WIDTH = 600
const MAX_CONTENT = 480

// Content-aware column widths for a table-fixed results table.
//
// `natural` columns (port, protocol, scan time, tech) keep a predictable width.
// The remaining columns measure their real content need (the widest truncated
// cell) and compete for the container width: surplus space goes to columns whose
// content cannot fully display, while sparse columns stay near their minimum.
// Every minimum still fits the header label plus sort chevron. The allocation
// always sums to the container width when there is room for the minimums, so the
// table fills the card without a spurious scrollbar; it only scrolls when the
// user drags columns wider or the viewport is narrower than the minimums.
export function useColumnResize(columns, wrapperRef) {
  const defaults = Object.fromEntries(columns.map((c) => [c.key, c.default]))
  const mins = Object.fromEntries(columns.map((c) => [c.key, c.min]))
  const widths = reactive({ ...defaults })
  const userResized = ref(false)
  const containerWidth = ref(0)
  const contentNeed = reactive({})
  const totalWidth = computed(() => columns.reduce((sum, c) => sum + widths[c.key], 0))
  const needsScroll = computed(() => totalWidth.value > containerWidth.value + 1)
  let observer = null
  let dragging = null

  function loadPersisted() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      if (!parsed) return
      let valid = false
      for (const c of columns) {
        const value = parsed[c.key]
        if (Number.isFinite(value) && value >= c.min && value <= MAX_WIDTH) {
          widths[c.key] = value
          valid = true
        }
      }
      if (valid) userResized.value = true
    } catch { /* corrupted or unavailable storage falls back to defaults */ }
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...widths })) } catch { /* ignore */ }
  }

  // Widest content per measured column, read from the rendered cells. Truncated
  // inner lines report their full scrollWidth, so the need is independent of the
  // current column width and stable across resize passes.
  function measureContent() {
    const table = wrapperRef.value?.querySelector('table')
    if (!table) return
    const rows = table.querySelectorAll('tbody tr')
    columns.forEach((c, index) => {
      if (c.natural) return
      let need = 0
      for (const row of rows) {
        const cell = row.children[index]
        if (!cell) continue
        let w = cell.scrollWidth
        for (const line of cell.querySelectorAll('.truncate')) w = Math.max(w, line.scrollWidth)
        need = Math.max(need, w)
      }
      contentNeed[c.key] = Math.min(MAX_CONTENT, Math.max(c.min, need))
    })
  }

  function desiredFor(c) {
    if (c.natural) return Math.max(c.min, c.default)
    return Math.max(c.min, contentNeed[c.key] ?? c.default)
  }

  // Measure the stable parent width, not the wrapper's own clientWidth: the
  // wrapper shrinks when its horizontal scrollbar appears, which would feed back
  // into needsScroll and oscillate the overflow class.
  function availableWidth() {
    const el = wrapperRef.value
    return el?.parentElement?.clientWidth ?? el?.clientWidth ?? 0
  }

  function autoFit() {
    if (userResized.value || typeof window === 'undefined') return
    const el = wrapperRef.value
    if (!el) return
    containerWidth.value = availableWidth()
    measureContent()
    const desired = Object.fromEntries(columns.map((c) => [c.key, desiredFor(c)]))
    const desiredSum = columns.reduce((s, c) => s + desired[c.key], 0)
    const minSum = columns.reduce((s, c) => s + c.min, 0)
    const available = containerWidth.value
    if (available >= desiredSum) {
      const surplus = available - desiredSum
      for (const c of columns) widths[c.key] = Math.round(desired[c.key] + surplus * (desired[c.key] / desiredSum))
    } else if (available >= minSum) {
      const extra = available - minSum
      const span = desiredSum - minSum
      for (const c of columns) widths[c.key] = Math.round(c.min + extra * ((desired[c.key] - c.min) / span))
    } else {
      for (const c of columns) widths[c.key] = c.min
    }
  }

  function refresh() {
    if (typeof window === 'undefined') return
    requestAnimationFrame(() => autoFit())
  }

  function resetColumn(key) {
    widths[key] = defaults[key]
    persist()
  }

  function resetAll() {
    for (const c of columns) widths[c.key] = c.default
    userResized.value = false
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    autoFit()
  }

  function onPointerMove(event) {
    if (!dragging) return
    const dx = event.clientX - dragging.startX
    widths[dragging.key] = Math.min(MAX_WIDTH, Math.max(mins[dragging.key], dragging.startWidth + dx))
  }

  function onPointerUp() {
    if (!dragging) return
    dragging.handle?.releasePointerCapture?.(dragging.pointerId)
    dragging = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    persist()
  }

  function onPointerDown(event, key) {
    if (typeof window === 'undefined') return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture?.(event.pointerId)
    dragging = { key, startX: event.clientX, startWidth: widths[key], handle, pointerId: event.pointerId }
    userResized.value = true
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  function onKeydown(event, key) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const delta = event.key === 'ArrowLeft' ? -8 : 8
    widths[key] = Math.min(MAX_WIDTH, Math.max(mins[key], widths[key] + delta))
    userResized.value = true
    persist()
  }

  onMounted(() => {
    loadPersisted()
    autoFit()
    const observed = wrapperRef.value?.parentElement
    if (typeof ResizeObserver !== 'undefined' && observed) {
      observer = new ResizeObserver(() => {
        containerWidth.value = availableWidth()
        autoFit()
      })
      observer.observe(observed)
    }
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  })

  return { widths, totalWidth, needsScroll, userResized, refresh, onPointerDown, onKeydown, resetColumn, resetAll }
}