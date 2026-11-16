import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'

const STORAGE_KEY = 'network_mapping_search_column_widths'
const MAX_WIDTH = 600

// Column widths for a table-fixed results table. Before the user drags a
// column, an auto-fit pass scales the default widths to the container so the
// table never forces a horizontal scrollbar at rest. The first drag (or a
// persisted layout) disables auto-fit; the overflow wrapper then acts as the
// fallback scrollbar. All browser APIs are guarded for SSR.
export function useColumnResize(columns, wrapperRef) {
  const defaults = Object.fromEntries(columns.map((c) => [c.key, c.default]))
  const mins = Object.fromEntries(columns.map((c) => [c.key, c.min]))
  const widths = reactive({ ...defaults })
  const userResized = ref(false)
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

  function autoFit() {
    if (userResized.value || typeof window === 'undefined') return
    const el = wrapperRef.value
    if (!el) return
    const totalDefault = columns.reduce((sum, c) => sum + c.default, 0)
    const scale = Math.min(1, el.clientWidth / totalDefault)
    for (const c of columns) widths[c.key] = Math.max(c.min, Math.round(c.default * scale))
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
    if (typeof ResizeObserver !== 'undefined' && wrapperRef.value) {
      observer = new ResizeObserver(() => autoFit())
      observer.observe(wrapperRef.value)
    }
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  })

  return { widths, userResized, onPointerDown, onKeydown, resetColumn, resetAll }
}