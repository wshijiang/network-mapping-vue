import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { compile, createSSRApp, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { compileScript, parse } from 'vue/compiler-sfc'
import { tr } from '../i18n/index.js'

const { descriptor } = parse(readFileSync(new URL('./AssetDetail.vue', import.meta.url), 'utf8'))
const compiled = compileScript(descriptor, { id: 'asset-history-test' })
const names = new Set(['hasHistoryDetails', 'toggleHistoryData'])
const source = compiled.scriptSetupAst.filter(node => node.type === 'FunctionDeclaration' && names.has(node.id.name))
  .map(node => descriptor.scriptSetup.content.slice(node.start, node.end)).join('\n')
function findToggle(node) {
  if (node.tag === 'button' && node.props?.some(prop => prop.name === 'on' && prop.exp?.content === 'toggleHistoryData(item)')) return node
  return node.children?.map(findToggle).find(Boolean)
}
const button = findToggle(descriptor.template.ast)
assert.ok(button, 'history toggle button exists')
const renderButton = compile(button.loc.source)
function page() {
  const expandedHistoryItemId = ref(null)
  return vm.runInNewContext(`${source}\n;({ hasHistoryDetails, toggleHistoryData, expandedHistoryItemId })`, { expandedHistoryItemId })
}
async function render(view, item) {
  return renderToString(createSSRApp({ setup: () => ({ ...view, item, tr }), render: renderButton }))
}

test('product-only history exposes its actual View button and can expand and collapse', async () => {
  const view = page()
  const item = { id: 'product-only', banner: null, data: null, product_identification: { status: 'suspected', coverage: 'partial' }, products: [{ id: 'sliver', name: 'Sliver' }] }
  let html = await render(view, item)
  assert.match(html, /<button/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /aria-controls="history-data-product-only"/)
  view.toggleHistoryData(item)
  assert.equal(view.expandedHistoryItemId.value, item.id)
  html = await render(view, item)
  assert.match(html, /aria-expanded="true"/)
  view.toggleHistoryData(item)
  assert.equal(view.expandedHistoryItemId.value, null)
})

test('legacy evidence is still expandable and truly empty rows stay closed', async () => {
  const view = page()
  for (const evidence of [{ banner: 'SSH-2.0' }, { data: { schema_version: 2 } }, { c2_fingerprint: { status: 'matched' } }]) {
    const item = { id: 'legacy', ...evidence }
    assert.match(await render(view, item), /<button/)
    view.toggleHistoryData(item)
    assert.equal(view.expandedHistoryItemId.value, item.id)
    view.toggleHistoryData(item)
    assert.equal(view.expandedHistoryItemId.value, null)
  }
  const empty = { id: 'empty', banner: null, data: null, product_identification: null, c2_fingerprint: null }
  assert.doesNotMatch(await render(view, empty), /<button/)
  view.toggleHistoryData(empty)
  assert.equal(view.expandedHistoryItemId.value, null)
})
