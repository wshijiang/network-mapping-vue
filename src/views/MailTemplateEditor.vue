<script setup>
import { tr } from '../i18n/index.js'

import { formatDateTime as formatSystemDateTime } from '../i18n/time.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import DOMPurify from 'dompurify'
import TemplateCodeEditor from '@/components/TemplateCodeEditor.vue'
import TemplateVariables from '@/components/TemplateVariables.vue'
import AppAlert from '@/components/AppAlert.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import http from '@/utils/http'

const props = defineProps({
  initialTemplateKey: { type: String, default: '' },
  externalNavigation: { type: Boolean, default: false },
})
const emit = defineEmits(['templates-loaded', 'selected'])
const formFieldId = useId()

const alerts = ref([])
const confirmDialog = ref(null)
const templates = ref([])
const currentTemplate = ref(null)
const source = ref(emptySource())
const savedSource = ref(emptySource())
const versions = ref([])
const editorTab = ref('html')
const notificationState = ref('offline')
const isScannerTemplate = computed(() => currentTemplate.value?.templateKey === 'scanner_outage')
const sampleQuery = computed(() => isScannerTemplate.value ? `?notificationState=${notificationState.value}` : '')
const previewTab = ref('html')
const preview = ref(null)
const previewError = ref('')
const testRecipient = ref('')
const activeField = ref('html')
const subjectInput = ref(null)
const htmlEditorView = shallowRef(null)
const textEditorView = shallowRef(null)
const loading = ref(false)
const saving = ref(false)
const publishing = ref(false)
const previewing = ref(false)
const testing = ref(false)
const restoringVersion = ref(null)
let previewSequence = 0
let previewTimer
let previewAbort
let disposed = false

function emptySource() {
  return {
    subjectTemplate: '',
    htmlTemplate: '',
    textTemplate: ''
  }
}

function cloneSource(value) {
  return {
    subjectTemplate: value?.subjectTemplate || '',
    htmlTemplate: value?.htmlTemplate || '',
    textTemplate: value?.textTemplate || ''
  }
}

const hasUnsavedChanges = computed(
  () => JSON.stringify(source.value) !== JSON.stringify(savedSource.value)
)
const actionBusy = computed(() => loading.value || saving.value || publishing.value || testing.value || restoringVersion.value !== null)
defineExpose({ hasUnsavedChanges, selectTemplate, restoreVersion, versions, loading, busy: actionBusy })

const canPublish = computed(() => currentTemplate.value?.status === 'draft' || hasUnsavedChanges.value)

const statusLabel = computed(() => {
  switch (currentTemplate.value?.status) {
    case 'draft': return tr("草稿")
    case 'published': return tr("已发布")
    default: return tr("内置默认")
  }
})

function pushAlert(type, title, description = '', timeout = 7000) {
  alerts.value.unshift({
    id: crypto.randomUUID(),
    type,
    title,
    description,
    timeout
  })
}

function closeAlert(id) {
  alerts.value = alerts.value.filter((alert) => alert.id !== id)
}

function applyTemplateDetail(detail) {
  invalidatePreview()
  currentTemplate.value = detail
  source.value = cloneSource(detail?.source)
  savedSource.value = cloneSource(detail?.source)
  preview.value = null
  previewError.value = ''
  emit('selected', detail.templateKey)
}

async function loadTemplateList() {
  const response = await http.get('/api/mail/templates')
  if (response.data?.success !== true) throw new Error(tr("邮件模板列表无效"))
  templates.value = response.data.data || []
  emit('templates-loaded', templates.value)
}

async function loadTemplate(templateKey) {
  if (!templateKey) return
  invalidatePreview()
  loading.value = true
  try {
    const [detailResponse, versionsResponse] = await Promise.all([
      http.get(`/api/mail/templates/${templateKey}`),
      http.get(`/api/mail/templates/${templateKey}/versions`)
    ])
    if (detailResponse.data?.success !== true || !detailResponse.data?.data) {
      throw new Error(tr("邮件模板内容无效"))
    }
    applyTemplateDetail(detailResponse.data.data)
    versions.value = versionsResponse.data?.data || []
  } catch (error) {
    console.error('load mail template failed', error)
    pushAlert(
      'error',
      tr("邮件模板加载失败"),
      error?.response?.data?.message || tr("请稍后刷新页面重试。")
    )
  } finally {
    loading.value = false
  }
}

async function initialize() {
  loading.value = true
  try {
    const [templateResponse, mailResponse] = await Promise.all([
      http.get('/api/mail/templates'),
      http.get('/api/config/mail')
    ])
    templates.value = templateResponse.data?.data || []
    emit('templates-loaded', templates.value)
    testRecipient.value = mailResponse.data?.data?.recipient || ''
    const firstKey = templates.value.find(item => item.templateKey === props.initialTemplateKey)?.templateKey || templates.value[0]?.templateKey
    if (firstKey) await loadTemplate(firstKey)
  } catch (error) {
    console.error('initialize mail template editor failed', error)
    pushAlert(
      'error',
      tr("邮件模板编辑器加载失败"),
      error?.response?.status === 403 ? tr("仅管理员可以使用邮件模板编辑器。") : tr("请稍后刷新页面重试。")
    )
  } finally {
    loading.value = false
  }
}

async function selectTemplate(templateKey) {
  if (templateKey === currentTemplate.value?.templateKey) return
  if (hasUnsavedChanges.value) {
    const shouldContinue = await confirmDialog.value.ask({ message: tr("当前模板有未保存修改，确定切换模板吗？"), confirmText: tr("放弃修改"), danger: true })
    if (!shouldContinue) return
  }
  await loadTemplate(templateKey)
}

async function saveDraft({ silent = false } = {}) {
  if (!currentTemplate.value || actionBusy.value) return false
  saving.value = true
  try {
    const response = await http.put(
      `/api/mail/templates/${currentTemplate.value.templateKey}/draft`,
      source.value
    )
    if (response.data?.success !== true || !response.data?.data) {
      throw new Error(tr("服务器未确认草稿保存成功"))
    }
    applyTemplateDetail(response.data.data)
    await Promise.all([loadTemplateList(), loadVersions()])
    if (!silent) pushAlert('success', tr("模板草稿已保存"), tr("草稿尚未影响正在发送的邮件。"), 5000)
    return true
  } catch (error) {
    console.error('save mail template draft failed', error)
    pushAlert(
      'error',
      tr("模板草稿保存失败"),
      error?.response?.data?.message || tr("请检查模板语法后重试。")
    )
    return false
  } finally {
    saving.value = false
  }
}

async function loadVersions() {
  if (!currentTemplate.value) return
  const response = await http.get(
    `/api/mail/templates/${currentTemplate.value.templateKey}/versions`
  )
  versions.value = response.data?.data || []
}

function invalidatePreview() {
  clearTimeout(previewTimer)
  previewAbort?.abort()
  previewSequence++
  previewing.value = false
  preview.value = null
  previewError.value = ''
}

async function validateAndPreview({ showSuccess = false } = {}) {
  if (disposed || !currentTemplate.value || loading.value) return false
  clearTimeout(previewTimer)
  previewAbort?.abort()
  const sequence = ++previewSequence
  const controller = new AbortController()
  previewAbort = controller
  previewing.value = true
  preview.value = null
  previewError.value = ''
  try {
    const response = await http.post(
      `/api/mail/templates/${currentTemplate.value.templateKey}/preview${sampleQuery.value}`,
      cloneSource(source.value),
      { signal: controller.signal }
    )
    if (disposed || sequence !== previewSequence) return false
    if (response.data?.success !== true || !response.data?.data) {
      throw new Error(tr("服务器未返回有效预览"))
    }
    preview.value = response.data.data
    if (showSuccess) pushAlert('success', tr("模板校验通过"), tr("预览已使用示例变量重新渲染。"), 4000)
    return true
  } catch (error) {
    if (disposed || sequence !== previewSequence || controller.signal.aborted) return false
    console.error('preview mail template failed', error)
    preview.value = null
    previewError.value = error?.response?.data?.message || tr("模板校验失败")
    if (showSuccess) pushAlert('error', tr("模板校验失败"), previewError.value)
    return false
  } finally {
    if (!disposed && sequence === previewSequence) previewing.value = false
  }
}

watch([source, loading], () => {
  invalidatePreview()
  if (!disposed && !loading.value && currentTemplate.value) previewTimer = setTimeout(validateAndPreview, 450)
}, { deep: true, flush: 'post' })

async function selectNotificationState(change) {
  const value = change.target.value
  if (isScannerTemplate.value && ['offline', 'recovered'].includes(value) && value !== notificationState.value
    && !loading.value && !saving.value && !publishing.value && !testing.value && !previewing.value && restoringVersion.value === null) {
    notificationState.value = value
    preview.value = null
    await validateAndPreview()
  }
  change.target.value = notificationState.value
}

async function publishTemplate() {
  if (!currentTemplate.value || actionBusy.value) return
  const confirmed = await confirmDialog.value.ask({ message: tr("确定发布当前模板吗？发布后，后续对应事件的邮件将使用这个版本；已归档报告保持原正文。"), confirmText: tr("发布") })
  if (!confirmed) return
  if (hasUnsavedChanges.value) {
    const saved = await saveDraft({ silent: true })
    if (!saved) return
  }
  publishing.value = true
  try {
    const response = await http.post(
      `/api/mail/templates/${currentTemplate.value.templateKey}/publish`
    )
    if (response.data?.success !== true || !response.data?.data) {
      throw new Error(tr("服务器未确认模板发布成功"))
    }
    applyTemplateDetail(response.data.data)
    await Promise.all([loadTemplateList(), loadVersions()])
    pushAlert('success', tr("邮件模板已发布"), tr("后续对应事件的邮件将使用这个版本；已归档报告保持原正文。"), 5000)
  } catch (error) {
    console.error('publish mail template failed', error)
    pushAlert(
      'error',
      tr("邮件模板发布失败"),
      error?.response?.data?.message || tr("请检查模板语法后重试。")
    )
  } finally {
    publishing.value = false
  }
}

async function restoreVersion(version) {
  if (!currentTemplate.value || actionBusy.value) return
  const warning = hasUnsavedChanges.value ? tr("当前未保存修改将被覆盖。") : ''
  const confirmed = await confirmDialog.value.ask({ message: tr("{0}确定将版本 {1} 恢复为新草稿吗？", [warning, version]), confirmText: tr("继续"), danger: Boolean(warning) })
  if (!confirmed) return
  restoringVersion.value = version
  try {
    const response = await http.post(
      `/api/mail/templates/${currentTemplate.value.templateKey}/versions/${version}/restore`
    )
    if (response.data?.success !== true || !response.data?.data) {
      throw new Error(tr("服务器未确认版本恢复成功"))
    }
    applyTemplateDetail(response.data.data)
    await Promise.all([loadTemplateList(), loadVersions()])
    pushAlert('success', tr("历史版本已恢复"), tr("恢复内容已保存为草稿，需要再次发布才会生效。"), 5000)
  } catch (error) {
    console.error('restore mail template version failed', error)
    pushAlert('error', tr("历史版本恢复失败"), error?.response?.data?.message || tr("请稍后重试。"))
  } finally {
    restoringVersion.value = null
  }
}

async function sendTestMail() {
  if (!currentTemplate.value || actionBusy.value) return
  if (!testRecipient.value.trim()) {
    pushAlert('warning', tr("请输入测试收件人"), tr("测试邮件不会自动发布当前模板。"))
    return
  }
  testing.value = true
  try {
    const response = await http.post(
      `/api/mail/templates/${currentTemplate.value.templateKey}/test${sampleQuery.value}`,
      {
        recipient: testRecipient.value.trim(),
        source: source.value
      }
    )
    pushAlert('success', tr("模板测试邮件已发送"), response.data?.message || tr("请检查收件箱。"), 5000)
  } catch (error) {
    console.error('send template test failed', error)
    pushAlert(
      'error',
      tr("模板测试邮件发送失败"),
      error?.response?.data?.message || tr("请检查 SMTP 配置和模板内容。")
    )
  } finally {
    testing.value = false
  }
}

function setEditorReady(field, payload) {
  if (field === 'html') htmlEditorView.value = payload.view
  if (field === 'text') textEditorView.value = payload.view
}

function insertVariable(variableKey) {
  const token = `{{ ${variableKey} }}`
  if (activeField.value === 'subject') {
    const input = subjectInput.value
    const start = input?.selectionStart ?? source.value.subjectTemplate.length
    const end = input?.selectionEnd ?? start
    source.value.subjectTemplate = `${source.value.subjectTemplate.slice(0, start)}${token}${source.value.subjectTemplate.slice(end)}`
    nextTick(() => {
      input?.focus()
      input?.setSelectionRange(start + token.length, start + token.length)
    })
    return
  }

  const view = activeField.value === 'text' ? textEditorView.value : htmlEditorView.value
  if (!view) return
  const selection = view.state.selection.main
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: token },
    selection: { anchor: selection.from + token.length }
  })
  view.focus()
}

async function useDefaultTemplate() {
  if (!currentTemplate.value?.defaultSource || actionBusy.value) return
  if (hasUnsavedChanges.value && !await confirmDialog.value.ask({ message: tr("载入默认模板将替换当前未保存的编辑内容，是否继续？"), confirmText: tr("继续"), danger: true })) return
  source.value = cloneSource(currentTemplate.value.defaultSource)
  preview.value = null
  pushAlert('info', tr("已载入默认模板"), tr("请确认预览，再保存草稿并发布。现有归档报告不会改变。"))
}

function safePreviewDocument(htmlBody) {
  const clean = DOMPurify.sanitize(htmlBody || '', {
    WHOLE_DOCUMENT: true,
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['srcdoc']
  })
  const documentValue = new DOMParser().parseFromString(clean, 'text/html')
  documentValue.querySelectorAll('link, base').forEach((element) => element.remove())
  documentValue.querySelectorAll('[src]').forEach((element) => {
    const value = element.getAttribute('src') || ''
    const sampleUrl = new URL('/mail/report-images/sample/trend.png', window.location.origin).href
    if (value === '/mail/report-images/sample/trend.png' || value === sampleUrl) element.setAttribute('src', sampleUrl)
    else if (!value.startsWith('data:image/')) element.removeAttribute('src')
    element.removeAttribute('srcset')
  })
  documentValue.querySelectorAll('a').forEach((element) => element.removeAttribute('href'))
  const policy = documentValue.createElement('meta')
  policy.setAttribute('http-equiv', 'Content-Security-Policy')
  policy.setAttribute('content', `default-src 'none'; style-src 'unsafe-inline'; img-src data: ${window.location.origin}/mail/report-images/sample/trend.png`)
  documentValue.head.prepend(policy)
  return `<!DOCTYPE html>${documentValue.documentElement.outerHTML}`
}

const previewDocument = computed(() => safePreviewDocument(preview.value?.htmlBody))

function formatTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return formatSystemDateTime(date)
}

useUnsavedChanges(hasUnsavedChanges, saveDraft, confirmDialog)
onMounted(initialize)
onBeforeUnmount(() => {
  disposed = true
  invalidatePreview()
})
</script>

<template>
  <ConfirmDialog ref="confirmDialog" />
  <div class="pointer-events-none fixed right-4 top-20 z-50 flex w-[calc(100vw-2rem)] flex-col items-end gap-2 sm:w-auto">
    <AppAlert
      v-for="alert in alerts"
      :key="alert.id"
      class="pointer-events-auto"
      :type="alert.type"
      :title="alert.title"
      :description="alert.description"
      :timeout="alert.timeout"
      @close="closeAlert(alert.id)"
    />
  </div>

  <div class="template-workspace min-w-0 w-full p-5">
    <div v-if="loading && !currentTemplate" class="grid min-h-80 place-items-center rounded-lg bg-base-100 border border-base-300">
      <span class="loading loading-spinner loading-md"></span>
    </div>

    <div v-else class="template-layout grid min-w-0 grid-cols-1 items-start gap-4" :class="externalNavigation ? 'template-layout-external' : '2xl:grid-cols-[220px_minmax(0,1fr)_minmax(280px,0.8fr)]'">
      <aside v-if="!externalNavigation" class="card min-w-0 bg-base-100 card-border border-base-300 p-3">
        <h3 class="px-2 pb-2 text-sm font-semibold">{{ tr("模板") }}</h3>
        <ul class="menu w-full p-0">
          <li v-for="item in templates" :key="item.templateKey">
            <button
              class="flex items-center justify-between"
              :class="{ active: item.templateKey === currentTemplate?.templateKey }"
              @click="selectTemplate(item.templateKey)"
            >
              <span>{{ item.displayName }}</span>
              <span v-if="item.hasDraft" class="badge badge-warning badge-xs">{{ tr("草稿") }}</span>
            </button>
          </li>
        </ul>

        <div class="divider my-3"></div>
        <h3 class="px-2 pb-2 text-sm font-semibold">{{ tr("历史版本") }}</h3>
        <div v-if="versions.length" class="flex max-h-72 flex-col gap-2 overflow-auto px-1">
          <div v-for="version in versions" :key="version.version" class="rounded-lg border border-base-300 p-2 text-xs">
            <div class="flex items-center justify-between gap-2">
              <span class="font-medium">{{ tr("版本") }} {{ version.version }}</span>
              <span class="badge badge-xs" :class="version.status === 'published' ? 'badge-success' : version.status === 'draft' ? 'badge-warning' : ''">
                {{ version.status === 'published' ? tr("已发布") : version.status === 'draft' ? tr("草稿") : tr("历史") }}
              </span>
            </div>
            <div class="mt-1 opacity-60">{{ formatTime(version.updateAt || version.createAt) }}</div>
            <button
              v-if="version.status !== 'draft'"
              class="btn btn-ghost btn-xs mt-2 w-full"
              :disabled="restoringVersion !== null"
              @click="restoreVersion(version.version)"
            >
              <span v-if="restoringVersion === version.version" class="loading loading-spinner loading-xs"></span> {{ tr("恢复为草稿") }} </button>
          </div>
        </div>
        <p v-else class="px-2 text-xs opacity-50">{{ tr("暂无数据库版本，当前使用内置模板。") }}</p>
      </aside>

      <main class="min-w-0 space-y-4">
        <section class="card min-w-0 bg-base-100 card-border border-base-300 p-4">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <h3 class="font-semibold">{{ currentTemplate?.displayName || tr("邮件模板") }} · {{ statusLabel }}</h3>
              <span v-if="currentTemplate?.activeVersion" class="text-xs opacity-60">{{ tr("已发布版本") }} {{ currentTemplate.activeVersion }}</span>
            </div>
            <span v-if="hasUnsavedChanges" class="text-xs text-warning">{{ tr("存在未保存修改") }}</span>
          </div>

          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-format`">{{ tr("消息格式") }}</label></legend>
            <select :id="`${formFieldId}-format`" v-model="editorTab" class="select min-w-0 w-full max-w-full" :disabled="loading || saving || publishing" @change="activeField = editorTab">
              <option value="html">{{ tr("HTML 富文本") }}</option>
              <option value="text">{{ tr("纯文本") }}</option>
            </select>
          </fieldset>

          <fieldset class="fieldset mt-4 min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-1`">{{ tr("邮件主题") }}</label></legend>
            <input :id="`${formFieldId}-1`"
              ref="subjectInput"
              v-model="source.subjectTemplate"
              type="text"
              maxlength="500"
              class="input input-bordered min-w-0 w-full max-w-full font-mono"
              :placeholder="tr(&quot;例如：{{ system_name }} 登录成功提醒&quot;)"
              @focus="activeField = 'subject'"
            />
          </fieldset>

          <fieldset v-if="isScannerTemplate" class="fieldset mt-4 min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-state`">{{ tr("通知状态") }}</label></legend>
            <select :id="`${formFieldId}-state`" :value="notificationState" class="select min-w-0 w-full max-w-full" :disabled="loading || saving || publishing || testing || previewing || restoringVersion !== null" @change="selectNotificationState">
              <option value="offline">{{ tr("掉线") }}</option>
              <option value="recovered">{{ tr("恢复") }}</option>
            </select>
            <p class="label whitespace-normal text-xs">{{ tr("掉线与恢复共用此模板，所选状态用于预览和测试发送。") }}</p>
          </fieldset>

          <div class="mt-3 overflow-hidden rounded-lg border border-base-300 bg-base-100">
            <TemplateCodeEditor
              v-if="editorTab === 'html'"
              v-model="source.htmlTemplate"
              :variables="currentTemplate?.variables || []" language="html" :disabled="saving || publishing"
              :indent-with-tab="true"
              :tab-size="2"
              :placeholder="tr(&quot;输入 HTML 和 Tera 模板语法&quot;)"
              @ready="setEditorReady('html', $event)"
              @focus="activeField = 'html'"
            />
            <TemplateCodeEditor
              v-else
              v-model="source.textTemplate"
              :variables="currentTemplate?.variables || []" language="text" :disabled="saving || publishing"
              :indent-with-tab="true"
              :tab-size="2"
              :placeholder="tr(&quot;输入纯文本备用正文&quot;)"
              @ready="setEditorReady('text', $event)"
              @focus="activeField = 'text'"
            />
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            <button class="btn btn-sm" :disabled="actionBusy || !currentTemplate?.defaultSource" @click="useDefaultTemplate">{{ tr("载入默认模板") }}</button>
            <button class="btn btn-sm" :disabled="actionBusy || !hasUnsavedChanges" @click="saveDraft()">{{ tr("保存草稿") }}</button>
            <button class="btn btn-neutral btn-sm" :disabled="actionBusy || !canPublish" @click="publishTemplate">{{ saving || publishing ? tr("处理中…") : tr("发布模板") }}</button>
          </div>
          <section class="mt-5 border-t border-base-300 pt-4">
            <h3 class="font-semibold">{{ tr("测试发送") }}</h3>
            <p class="mt-1 text-xs opacity-60">{{ tr("使用当前编辑内容和系统设置中的 SMTP 配置发送，不会自动保存或发布。") }}</p>
            <div class="mt-3 flex min-w-0 flex-wrap gap-2">
              <input v-model="testRecipient" type="email" class="input input-bordered min-w-0 w-full max-w-full flex-1 basis-56" :placeholder="tr(&quot;测试收件人邮箱&quot;)" />
              <button class="btn btn-neutral max-w-full" :disabled="testing" @click="sendTestMail">
                <span v-if="testing" class="loading loading-spinner loading-sm"></span> {{ tr("发送测试邮件") }} </button>
            </div>
          </section>
        </section>
      </main>

      <aside class="min-w-0 space-y-4">
        <TemplateVariables :key="currentTemplate?.templateKey" :variables="currentTemplate?.variables || []" :disabled="saving || publishing" class="card card-border border-base-300 bg-base-100 p-4" @insert="insertVariable" />

        <section class="card min-w-0 bg-base-100 card-border border-base-300 p-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="font-semibold">{{ tr("渲染预览") }}</h3>
            <button class="btn btn-ghost btn-sm" :disabled="actionBusy || !currentTemplate" @click="validateAndPreview()">{{ previewing ? tr("渲染中…") : tr("刷新预览") }}</button>
          </div>
          <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div class="tabs tabs-box tabs-xs">
              <button class="tab" :class="{ 'tab-active': previewTab === 'html' }" @click="previewTab = 'html'">HTML</button>
              <button class="tab" :class="{ 'tab-active': previewTab === 'text' }" @click="previewTab = 'text'">{{ tr("纯文本") }}</button>
            </div>
          </div>
          <div v-if="preview" class="mt-3">
            <div class="mb-2 rounded-lg bg-base-200 px-3 py-2 text-xs">
              <span class="opacity-60">{{ tr("主题：") }}</span>{{ preview.subject }}
            </div>
            <iframe
              v-if="previewTab === 'html'"
              :title="tr(&quot;邮件模板安全预览&quot;)"
              sandbox=""
              :srcdoc="previewDocument"
              class="h-[520px] w-full rounded-lg border border-base-300 bg-white"
            ></iframe>
            <pre v-else class="h-[520px] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-base-300 bg-base-200 p-3 text-xs">{{ preview.textBody }}</pre>
          </div>
          <div v-else class="mt-3 grid h-72 place-items-center rounded-lg border border-dashed border-base-300 text-center text-xs opacity-60">
            <div>
              <p>{{ previewError || (previewing ? tr("正在使用示例数据渲染…") : tr("编辑后自动预览。")) }}</p>
              <p class="mt-1">{{ tr("预览使用固定示例数据，不包含真实用户信息。") }}</p>
            </div>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.template-workspace {
  container: template-editor / inline-size;
}

@container template-editor (min-width: 52rem) {
  .template-layout-external {
    grid-template-columns: minmax(0, 1.25fr) minmax(18rem, 1fr);
  }
}

:deep(.cm-editor) {
  font-size: 13px;
}

:deep(.cm-scroller) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

:deep(.cm-focused) {
  outline: none;
}
</style>
