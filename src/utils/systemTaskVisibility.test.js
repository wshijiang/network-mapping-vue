import assert from 'node:assert/strict'
import test from 'node:test'
import { loadSystemTaskVisibility, saveSystemTaskVisibility } from './systemTaskVisibility.js'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 21)

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

test('default is hidden when nothing is stored', () => {
  withStorage(() => {
    assert.equal(loadSystemTaskVisibility(NOW), false)
  })
})

test('a recent choice is remembered in both directions', () => {
  withStorage(() => {
    saveSystemTaskVisibility(true, NOW - DAY_MS)
    assert.equal(loadSystemTaskVisibility(NOW), true)
    saveSystemTaskVisibility(false, NOW - DAY_MS)
    assert.equal(loadSystemTaskVisibility(NOW), false)
  })
})

test('the choice expires one month after the last state change', () => {
  withStorage(() => {
    saveSystemTaskVisibility(true, NOW - 30 * DAY_MS)
    assert.equal(loadSystemTaskVisibility(NOW), true)
    saveSystemTaskVisibility(true, NOW - 31 * DAY_MS)
    assert.equal(loadSystemTaskVisibility(NOW), false)
  })
})

test('corrupted storage falls back to the default', () => {
  withStorage((store) => {
    store.set('network_mapping_task_include_system', '{oops')
    assert.equal(loadSystemTaskVisibility(NOW), false)
    store.set('network_mapping_task_include_system', JSON.stringify({ value: 'yes', updatedAt: NOW }))
    assert.equal(loadSystemTaskVisibility(NOW), false)
  })
})