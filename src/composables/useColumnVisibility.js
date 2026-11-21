import { computed, ref, toValue } from 'vue'

// Persistent column visibility for data tables. The preference is stored in
// localStorage and never expires (product requirement). Hidden keys are stored
// rather than visible ones so columns added in later releases stay visible for
// existing users. `columns` may be a plain array, ref or computed.
export function useColumnVisibility(storageKey, columns) {
  const knownKeys = () => toValue(columns).map((column) => column.key)

  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || 'null')
      if (!Array.isArray(parsed)) return []
      const known = new Set(knownKeys())
      return parsed.filter((key) => known.has(key))
    } catch {
      return []
    }
  }

  const hiddenKeys = ref(load())
  const visibleColumns = computed(() => toValue(columns).filter((column) => !hiddenKeys.value.includes(column.key)))
  const isDefault = computed(() => hiddenKeys.value.length === 0)

  function persist() {
    try {
      if (hiddenKeys.value.length) localStorage.setItem(storageKey, JSON.stringify(hiddenKeys.value))
      else localStorage.removeItem(storageKey)
    } catch { /* corrupted or unavailable storage falls back to defaults */ }
  }

  function isVisible(key) {
    return !hiddenKeys.value.includes(key)
  }

  function toggle(key) {
    if (!knownKeys().includes(key)) return
    if (isVisible(key)) {
      // Keep at least one data column visible so the table never goes blank.
      if (visibleColumns.value.length <= 1) return
      hiddenKeys.value = [...hiddenKeys.value, key]
    } else {
      hiddenKeys.value = hiddenKeys.value.filter((item) => item !== key)
    }
    persist()
  }

  function reset() {
    hiddenKeys.value = []
    persist()
  }

  return { hiddenKeys, visibleColumns, isDefault, isVisible, toggle, reset }
}