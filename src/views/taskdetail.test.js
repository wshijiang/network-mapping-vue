import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, ref } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { isProjectionPending, projectionMessage } from '../utils/projectionStatus.js'

const { descriptor } = parse(readFileSync(new URL('./taskdetail.vue', import.meta.url), 'utf8'))
const compiled = compileScript(descriptor, { id: 'task-detail-refresh-test' })
const source = compiled.scriptSetupAst.filter(node => node.type === 'ImportDeclaration')
  .reverse().reduce((code, node) => code.slice(0, node.start) + code.slice(node.end), descriptor.scriptSetup.content)

function taskResponse(webStatus, osStatus = 'identified', status = 'succeeded', projection = 'ready') {
  return { data: { success: true, data: {
    selected_execution_id: 'selected-execution',
    executions: [{ execution_id: 'selected-execution', status, projection_status: projection }],
    results: [{ ip: '192.0.2.1', ports: [{ port: 443, web: webStatus ? { status: webStatus } : null, os: { status: osStatus } }] }],
  } } }
}

function createPage(responses) {
  const timers = new Map(), requests = []
  let dispose, nextTimer = 0
  const page = vm.runInNewContext(`${source}\n;({ loadTask, task })`, {
    computed, ref, isProjectionPending, projectionMessage,
    useRoute: () => ({ params: { taskid: 'task-id' } }), useRouter: () => ({}),
    // Drive the first load explicitly so its asynchronous completion can be awaited.
    watch: () => {}, onBeforeUnmount: callback => { dispose = callback },
    http: { get: async (url, options) => { requests.push({ url, options }); return responses.shift() } },
    window: {
      clearTimeout: id => timers.delete(id),
      setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id },
    },
    console,
  })
  return { ...page, timers, requests, dispose: () => dispose() }
}

test('a completed task keeps polling pending Web evidence and stops after identification', async () => {
  const page = createPage([taskResponse('pending'), taskResponse('identified')])
  await page.loadTask()
  assert.equal(page.timers.size, 1)
  const timer = [...page.timers.values()][0]
  assert.equal(timer.delay, 30000)
  await timer.callback()
  assert.equal(page.requests.length, 2)
  assert.equal(page.requests[1].url, '/api/task/task-id')
  assert.equal(page.requests[1].options.params.execution_id, 'selected-execution')
  assert.equal(page.task.value.results[0].ports[0].web.status, 'identified')
  assert.equal(page.timers.size, 0)
  page.dispose()
})

test('terminal or absent Web results do not keep a completed task polling', async () => {
  for (const status of ['identified', 'unknown', 'partial', 'unsupported', 'not_web', undefined]) {
    const page = createPage([taskResponse(status)])
    await page.loadTask()
    assert.equal(page.timers.size, 0, status)
    page.dispose()
  }
})

test('OS inference, execution and projection work still keep task details refreshing', async () => {
  for (const response of [taskResponse('unknown', 'pending'), taskResponse('unknown', 'identified', 'running'), taskResponse('unknown', 'identified', 'succeeded', 'retrying')]) {
    const page = createPage([response])
    await page.loadTask()
    assert.equal(page.timers.size, 1)
    page.dispose()
    assert.equal(page.timers.size, 0)
  }
})

test('unmount clears a pending Web refresh and late responses cannot schedule another timer', async () => {
  const page = createPage([taskResponse('pending'), taskResponse('pending')])
  await page.loadTask()
  const loading = page.loadTask({ silent: true })
  page.dispose()
  await loading
  assert.equal(page.timers.size, 0)
})
