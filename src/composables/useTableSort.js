import { computed, ref, watch } from 'vue'
import { compareItems } from '../utils/tableSort.js'

// Client-side sorting of the currently loaded page only. It never re-queries
// the server; the server-side sort dropdown remains the cross-page ordering.
// `items` is a ref/computed of the page array; a new array reference (new
// search, pagination, server-sort change) resets back to the server order.
export function useTableSort(items) {
  const pageSort = ref({ key: null, direction: 1 })

  const displayItems = computed(() => {
    const { key, direction } = pageSort.value
    const list = items.value ?? []
    if (!key) return list
    // Stable sort on a copy: ties keep the server order, input is not mutated.
    return [...list].sort((a, b) => compareItems(key, direction, a, b))
  })

  // Cycle none -> asc -> desc -> none so the server order is always reachable.
  function toggle(key) {
    const current = pageSort.value
    if (current.key !== key) pageSort.value = { key, direction: 1 }
    else if (current.direction === 1) pageSort.value = { key, direction: -1 }
    else pageSort.value = { key: null, direction: 1 }
  }

  function reset() {
    pageSort.value = { key: null, direction: 1 }
  }

  watch(() => items.value, reset)

  return { pageSort, displayItems, toggle, reset }
}