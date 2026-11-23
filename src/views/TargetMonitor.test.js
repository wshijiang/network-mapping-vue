import { tr, i18n } from '../i18n/index.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, reactive, ref, watch } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { inboxSeverityClass } from '../utils/inbox.js'
import {
  changeDetailRows, changeKindLabel, intervalLabel, intervalPresets, monitorProfiles,
  profileLabel, ruleForm, rulePayload, runStatuses, skipReasonLabel, targetsSummary, validateRule,
} from '../utils/targetMonitor.js'
import { formatDateTime } from '../i18n/time.js'

const plain = value => JSON.parse(JSON.stringify(value))

const { descriptor } = parse(readFileSync(new URL('./TargetMonitor.vue', import.meta.url), 'utf8'))
const compiled = compileScript(descriptor, { id: 'target-monitor-test' })
const source = compiled.scriptSetupAst.filter(node => node.type === 'ImportDeclaration')
  .reverse().reduce((code, node) => code.slice(0, node.start) + code.slice(node.end), descriptor.scriptSetup.content)

const ruleFixture = {
  id: 'rule-1', name: '核心网段', created_by: 2, owner_name: 'member', recipient_ids: [],
  target_type: 'ip', target_family: 'ipv4', targets: ['192.0.2.0/24'], ports: '1-65535',
  scan_profile: 'service_inventory', interval_seconds: 86400, enabled: true,
  last_task_id: null, last_run_at: null, next_run_at: null, last_change_count: 0,
  revision: 1, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
}
const runFixture = { id: 'run-1', rule_id: 'rule-1', task_id: 'task-1', status: 'succeeded', skip_reason: null, started_at: '2026-11-02T00:00:00Z', finished_at: '2026-11-02T00:05:00Z', change_count: 1, summary: null }
const changeFixture = { id: 'change-1', kind: 'port_opened', severity: 'warning', target: '192.0.2.1', port: 8443, detail: { after: { port: 8443, service: 'https' } }, occurred_at: '2026-11-02T00:05:00Z' }

function dialog() {
  return { open: false, showModal() { this.open = true }, close() { this.open = false } }
}

function createPage({ routeQuery = {}, rulesData, putError } = {}) {
  i18n.global.locale.value = 'zh-CN'
  const requests = []
  const ok = data => ({ data: { success: true, data } })
  const get = async (url, options) => {
    requests.push({ method: 'GET', url, params: options?.params })
    if (url === '/api/target-monitor/rules') return ok(rulesData ?? { items: [ruleFixture], monitor_user_enabled: true, is_admin: false })
    if (url === '/api/target-monitor/recipients') return ok([{ id: 1, username: 'admin' }])
    if (/\/runs\/[^/]+\/changes$/.test(url)) return ok({ items: [changeFixture] })
    if (/\/rules\/[^/]+\/runs$/.test(url)) return ok({ items: [runFixture], next_before: null })
    if (url === '/api/target-monitor/changes') return ok({ items: [{ ...changeFixture, rule_name: '核心网段' }], next_before: null })
    return ok({})
  }
  const callable = async config => {
    requests.push(config)
    if (putError && config.method === 'PUT') throw putError
    return ok(config.data)
  }
  const http = Object.assign(callable, {
    get,
    post: async (url, data) => { requests.push({ method: 'POST', url, data }); return ok({}) },
    put: async (url, data) => {
      requests.push({ method: 'PUT', url, data })
      if (putError) throw putError
      return ok(data)
    },
    delete: async (url, options) => { requests.push({ method: 'DELETE', url, data: options?.data }); return ok({}) },
  })
  let mount, dispose
  const route = reactive({ query: { ...routeQuery } })
  const sandbox = {
    tr, ref, computed, watch,
    onMounted: callback => { mount = callback },
    onBeforeUnmount: callback => { dispose = callback },
    useId: () => 'target-monitor-test-field',
    useRoute: () => route,
    useUnsavedChanges: () => ({ allowNextRouteLeave() {} }),
    inboxSeverityClass,
    changeDetailRows, changeKindLabel, intervalLabel, intervalPresets, monitorProfiles,
    profileLabel, ruleForm, rulePayload, runStatuses, skipReasonLabel, targetsSummary, validateRule,
    formatDateTime, http, crypto: globalThis.crypto,
  }
  const page = vm.runInNewContext(`${source}\n;({ rules, monitorUserEnabled, isAdmin, canManage, loading, loadFailed, form, editor, confirmDialog, historyDialog, historyRule, activeRun, runs, changes, recentChanges, activeTab, alerts, customHours, intervalSelection, recipients, loadRules, openEditor, closeEditor, saveRule, toggleRule, runNow, deleteRule, openHistory, openRun, loadRecentChanges, switchTab })`, sandbox)
  page.editor.value = dialog()
  page.historyDialog.value = dialog()
  page.confirmDialog.value = { ask: async () => true }
  return { ...page, route, requests, mount: () => mount(), dispose: () => dispose() }
}

test('mount loads rules and the feature flag gates self-service management', async () => {
  const page = createPage()
  await page.mount()
  assert.equal(page.rules.value.length, 1)
  assert.equal(page.canManage.value, true)
  page.dispose()
  const closed = createPage({ rulesData: { items: [], monitor_user_enabled: false, is_admin: false } })
  await closed.mount()
  assert.equal(closed.canManage.value, false)
  assert.equal(closed.rules.value.length, 0)
  closed.dispose()
  const admin = createPage({ rulesData: { items: [], monitor_user_enabled: false, is_admin: true } })
  await admin.mount()
  assert.equal(admin.canManage.value, true)
  assert.ok(admin.requests.some(request => request.url === '/api/target-monitor/recipients'))
  admin.dispose()
})

test('invalid rules are blocked before any request and valid rules post normalized payloads', async () => {
  const page = createPage()
  await page.mount()
  page.openEditor()
  page.form.value.name = ''
  assert.equal(await page.saveRule(), false)
  assert.equal(page.requests.filter(request => request.method === 'POST').length, 0)
  page.form.value.name = '新规则'
  page.form.value.targets_text = '192.0.2.1,192.0.2.2'
  assert.equal(await page.saveRule(), true)
  const post = page.requests.find(request => request.method === 'POST')
  assert.equal(post.url, '/api/target-monitor/rules')
  assert.deepEqual(plain(post.data.targets), ['192.0.2.1', '192.0.2.2'])
  assert.equal(post.data.scan_profile, 'service_inventory')
  assert.equal('expected_revision' in post.data, false)
  assert.equal(page.editor.value.open, false)
  page.dispose()
})

test('domain rules pin dns_records and drop ports in the payload', async () => {
  const page = createPage()
  await page.mount()
  page.openEditor()
  Object.assign(page.form.value, { name: '域名监控', target_type: 'domain', targets_text: 'Example.COM.', ports: '443' })
  assert.equal(await page.saveRule(), true)
  const post = page.requests.find(request => request.method === 'POST')
  assert.deepEqual(plain(post.data.targets), ['example.com'])
  assert.equal(post.data.scan_profile, 'dns_records')
  assert.equal(post.data.ports, '')
  page.dispose()
})

test('revision conflicts close the editor, warn and reload rules', async () => {
  const conflict = Object.assign(new Error('conflict'), { response: { status: 409 } })
  const page = createPage({ putError: conflict })
  await page.mount()
  page.openEditor(ruleFixture)
  page.form.value.name = '改名'
  assert.equal(await page.saveRule(), false)
  assert.equal(page.editor.value.open, false)
  assert.equal(page.alerts.value[0].type, 'warning')
  assert.equal(page.requests.filter(request => request.method === 'GET' && request.url === '/api/target-monitor/rules').length, 2)
  page.dispose()
})

test('rule actions toggle, run now and delete with the expected revision', async () => {
  const page = createPage()
  await page.mount()
  await page.toggleRule(ruleFixture)
  const put = page.requests.find(request => request.method === 'PUT')
  assert.equal(put.url, '/api/target-monitor/rules/rule-1')
  assert.equal(put.data.enabled, false)
  assert.equal(put.data.expected_revision, 1)
  await page.runNow(ruleFixture)
  assert.ok(page.requests.some(request => request.method === 'POST' && request.url === '/api/target-monitor/rules/rule-1/run'))
  await page.deleteRule(ruleFixture)
  const removal = page.requests.find(request => request.method === 'DELETE')
  assert.equal(removal.url, '/api/target-monitor/rules/rule-1')
  assert.deepEqual(plain(removal.data), { expected_revision: 1 })
  page.dispose()
})

test('run history loads runs then changes, and the ?run deep link opens changes directly', async () => {
  const page = createPage()
  await page.mount()
  await page.openHistory(ruleFixture)
  assert.equal(page.historyDialog.value.open, true)
  assert.equal(page.runs.value.length, 1)
  await page.openRun(page.runs.value[0])
  assert.equal(page.changes.value.length, 1)
  assert.equal(page.activeRun.value.id, 'run-1')
  page.dispose()
  const deep = createPage({ routeQuery: { run: 'run-9' } })
  await deep.mount()
  assert.equal(deep.historyDialog.value.open, true)
  assert.equal(deep.activeRun.value.id, 'run-9')
  assert.equal(deep.changes.value.length, 1)
  assert.ok(deep.requests.some(request => request.url === '/api/target-monitor/runs/run-9/changes'))
  deep.dispose()
})

test('custom interval selection converts hours and the changes tab loads recent changes', async () => {
  const page = createPage()
  await page.mount()
  page.openEditor({ ...ruleFixture, interval_seconds: 7200 })
  assert.equal(page.intervalSelection.value, 'custom')
  assert.equal(page.customHours.value, 2)
  page.customHours.value = 3
  await Promise.resolve()
  assert.equal(page.form.value.interval_seconds, 10800)
  page.intervalSelection.value = '86400'
  assert.equal(page.form.value.interval_seconds, 86400)
  await page.switchTab('changes')
  assert.equal(page.activeTab.value, 'changes')
  assert.equal(page.recentChanges.value.length, 1)
  assert.ok(page.requests.some(request => request.url === '/api/target-monitor/changes'))
  page.dispose()
})

test('query-only navigation on a mounted page opens the run deep link', async () => {
  const page = createPage()
  await page.mount()
  assert.equal(page.historyDialog.value.open, false)
  page.route.query = { run: 'run-9' }
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(page.historyDialog.value.open, true)
  assert.equal(page.activeRun.value.id, 'run-9')
  assert.ok(page.requests.some(request => request.url === '/api/target-monitor/runs/run-9/changes'))
  page.dispose()
})
