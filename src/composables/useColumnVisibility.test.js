import assert from 'node:assert/strict'
import test from 'node:test'
import { computed } from 'vue'
import { useColumnVisibility } from './useColumnVisibility.js'

const KEY = 'test_column_visibility'
const columns = computed(() => [
  { key: 'ip', label: 'IP' },
  { key: 'port', label: '端口' },
  { key: 'banner', label: 'Banner' },
])

function withStorage(fn) {
  const store = new Map()
  const previous = globalThis.localStorage
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
  try {
    fn(store)
  } finally {
    if (previous === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previous
  }
}

test('defaults to all columns visible and persists hidden keys across instances', () => {
  withStorage((store) => {
    const first = useColumnVisibility(KEY, columns)
    assert.equal(first.visibleColumns.value.length, 3)
    assert.equal(first.isDefault.value, true)
    first.toggle('banner')
    assert.deepEqual(first.visibleColumns.value.map((c) => c.key), ['ip', 'port'])
    assert.equal(first.isDefault.value, false)
    assert.deepEqual(JSON.parse(store.get(KEY)), ['banner'])

    const second = useColumnVisibility(KEY, columns)
    assert.deepEqual(second.hiddenKeys.value, ['banner'])
    second.toggle('banner')
    assert.equal(second.isDefault.value, true)
    assert.equal(store.has(KEY), false)
  })
})

test('the last visible column cannot be hidden and unknown keys are ignored', () => {
  withStorage(() => {
    const state = useColumnVisibility(KEY, columns)
    state.toggle('ip')
    state.toggle('port')
    state.toggle('banner')
    assert.equal(state.visibleColumns.value.length, 1)
    state.toggle('nope')
    assert.equal(state.visibleColumns.value.length, 1)
    state.reset()
    assert.equal(state.visibleColumns.value.length, 3)
  })
})

test('corrupted storage and stale keys fall back to defaults', () => {
  withStorage((store) => {
    store.set(KEY, '{broken')
    assert.equal(useColumnVisibility(KEY, columns).visibleColumns.value.length, 3)
    store.set(KEY, JSON.stringify(['removed-column', 'port']))
    const state = useColumnVisibility(KEY, columns)
    assert.deepEqual(state.hiddenKeys.value, ['port'])
  })
})