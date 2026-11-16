import test from 'node:test'
import assert from 'node:assert/strict'
import { nextTick, ref } from 'vue'
import { i18n } from '../i18n/index.js'
import { useTableSort } from './useTableSort.js'

i18n.global.locale.value = 'zh-CN'

test('toggle cycles none -> asc -> desc -> none and sorts a copy', () => {
  const items = ref([{ port: 8080 }, { port: 80 }, { port: 443 }])
  const { pageSort, displayItems, toggle } = useTableSort(items)
  assert.equal(pageSort.value.key, null)
  assert.deepEqual(displayItems.value.map((r) => r.port), [8080, 80, 443]) // server order

  toggle('port')
  assert.deepEqual(pageSort.value, { key: 'port', direction: 1 })
  assert.deepEqual(displayItems.value.map((r) => r.port), [80, 443, 8080])
  assert.deepEqual(items.value.map((r) => r.port), [8080, 80, 443]) // input untouched

  toggle('port')
  assert.deepEqual(pageSort.value, { key: 'port', direction: -1 })
  assert.deepEqual(displayItems.value.map((r) => r.port), [8080, 443, 80])

  toggle('port')
  assert.equal(pageSort.value.key, null)
  assert.deepEqual(displayItems.value.map((r) => r.port), [8080, 80, 443])

  toggle('port')
  toggle('ip') // switching column restarts at asc
  assert.deepEqual(pageSort.value, { key: 'ip', direction: 1 })
})

test('a new items reference resets to server order', async () => {
  const items = ref([{ port: 2 }, { port: 1 }])
  const { pageSort, displayItems, toggle } = useTableSort(items)
  toggle('port')
  assert.deepEqual(displayItems.value.map((r) => r.port), [1, 2])
  items.value = [{ port: 9 }, { port: 3 }]
  await nextTick()
  assert.equal(pageSort.value.key, null)
  assert.deepEqual(displayItems.value.map((r) => r.port), [9, 3])
})