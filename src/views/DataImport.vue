<script setup>
import { tr } from '../i18n/index.js'

import { formatDateTime } from '../i18n/time.js'
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import EmptyState from '@/components/EmptyState.vue'
import http from '@/utils/http'
import { autoMatchHeaders, readCsvHeader, validateHeaderMapping } from '@/utils/csvHeader.js'
import {
  IMPORT_STATUSES,
  canCancel,
  canDelete,
  canPause,
  canResume,
  formatRowStats,
  isActiveStatus,
  progressPercent,
  statusMeta,
  validateResumePayload,
} from '@/utils/dataImport.js'

const formFieldId = useId()
const alerts = ref([])

function pushAlert(type, title, description = '', timeout = 7000) {
  alerts.value.unshift({ id: crypto.randomUUID(), type, title, description, timeout })
}

function closeAlert(id) {
  alerts.value = alerts.value.filter((alert) => alert.id !== id)
}

// Timestamps arrive as ISO strings or epoch milliseconds; normalize defensively.
function formatDate(value) {
  if (value === null || value === undefined || value === '') return '-'
  const normalized = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return '-'
  return formatDateTime(date)
}

function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1 }
  return `${size >= 100 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || fallback
}

// ---- Schema (single source of truth for headers, aliases and limits) ----
const schema = ref(null)
const schemaLoading = ref(false)
const schemaError = ref('')

const limits = computed(() => schema.value?.limits || {})
const schemaHeaders = computed(() => schema.value?.headers || [])

async function fetchSchema() {
  schemaLoading.value = true
  schemaError.value = ''
  try {
    const response = await http.get('/api/data-import/schema')
    if (response.data?.success !== true || !Array.isArray(response.data?.data?.headers)) {
      throw new Error(tr('服务器未返回有效数据，请稍后重试。'))
    }
    schema.value = response.data.data
    options.value.batch_size = limits.value.default_batch_size ?? 1000
    options.value.concurrency = limits.value.default_concurrency ?? 2
  } catch (error) {
    console.error('load data-import schema failed', error)
    schemaError.value = errorMessage(error, tr('请检查网络连接后重试。'))
    pushAlert('error', tr('加载头部规范失败'), schemaError.value)
  } finally {
    schemaLoading.value = false
  }
}

// Share the in-flight request so a file selected during the initial load still
// waits for the schema instead of racing past it.
let schemaRequest = null
function loadSchema() {
  if (schema.value) return Promise.resolve()
  if (!schemaRequest) schemaRequest = fetchSchema().finally(() => { schemaRequest = null })
  return schemaRequest
}

// ---- Upload wizard ----
const fileInput = ref(null)
const selectedFile = ref(null)
const fileHeaders = ref([])
const headerTruncated = ref(false)
const headerError = ref('')
const mapping = ref({})
const autoConflicts = ref([])
const submitting = ref(false)
const uploadProgress = ref(null)
const options = ref({
  batch_size: 1000,
  concurrency: 2,
  on_invalid: 'skip',
  overwrite_policy: 'fill',
  fast: false,
  dry_run: false,
})

const fileTooLarge = computed(() => {
  const max = limits.value.max_upload_bytes
  return Boolean(selectedFile.value && max && selectedFile.value.size > max)
})

const mappingIssues = computed(() => validateHeaderMapping(fileHeaders.value, schemaHeaders.value, mapping.value))
const activeConflicts = computed(() => autoConflicts.value.filter((conflict) => !mapping.value[conflict.internal]))
const optionsValidation = computed(() => validateResumePayload(
  { batch_size: options.value.batch_size, concurrency: options.value.concurrency },
  limits.value,
))
const optionsValid = computed(() => (
  optionsValidation.value.valid
  && Boolean(optionsValidation.value.payload.batch_size)
  && Boolean(optionsValidation.value.payload.concurrency)
))
const canImport = computed(() => (
  Boolean(selectedFile.value)
  && Boolean(schema.value)
  && !headerTruncated.value
  && !headerError.value
  && !fileTooLarge.value
  && mappingIssues.value.unmatchedRequired.length === 0
  && mappingIssues.value.conflicts.length === 0
  && optionsValid.value
  && !submitting.value
))

function resetWizard() {
  selectedFile.value = null
  fileHeaders.value = []
  headerTruncated.value = false
  headerError.value = ''
  mapping.value = {}
  autoConflicts.value = []
  uploadProgress.value = null
  if (fileInput.value) fileInput.value.value = ''
}

function runAutoMatch() {
  if (!schema.value || !fileHeaders.value.length) return
  const result = autoMatchHeaders(fileHeaders.value, schemaHeaders.value)
  const base = {}
  for (const header of schemaHeaders.value) base[header.name] = ''
  mapping.value = { ...base, ...result.mapping }
  autoConflicts.value = result.conflicts
}

// If the schema arrives after a file was already parsed (initial-load race or a
// retry), pair the headers once without disturbing manual edits.
watch(schema, (value) => {
  if (value && fileHeaders.value.length && !headerTruncated.value && Object.keys(mapping.value).length === 0) runAutoMatch()
})

async function onFileChange(event) {
  const file = event.target.files?.[0] || null
  fileHeaders.value = []
  headerTruncated.value = false
  headerError.value = ''
  mapping.value = {}
  autoConflicts.value = []
  uploadProgress.value = null
  selectedFile.value = file
  if (!file) return
  if (fileTooLarge.value) {
    headerError.value = tr('文件超过上传限额，请改用服务器 CLI 导入本地文件。')
    return
  }
  try {
    const { headers, truncated } = await readCsvHeader(file)
    fileHeaders.value = headers
    headerTruncated.value = truncated
    if (truncated) {
      headerError.value = tr('CSV 头部异常超长，无法在 64KB 内读取完整首行。')
      return
    }
    if (headers.length === 0) {
      headerError.value = tr('文件为空或缺少头部行。')
      return
    }
    await loadSchema()
    runAutoMatch()
  } catch (error) {
    console.error('read csv header failed', error)
    headerError.value = tr('头部解析失败，请确认文件为 UTF-8 编码的 CSV。')
  }
}

function cleanMapping() {
  return Object.fromEntries(Object.entries(mapping.value).filter(([, fileHeader]) => fileHeader))
}

async function submitImport() {
  if (!canImport.value) return
  const file = selectedFile.value
  submitting.value = true
  uploadProgress.value = null
  try {
    const form = new FormData()
    form.append('file', file)
    form.append('mapping', JSON.stringify(cleanMapping()))
    form.append('batch_size', String(options.value.batch_size))
    form.append('concurrency', String(options.value.concurrency))
    form.append('on_invalid', options.value.on_invalid)
    form.append('overwrite_policy', options.value.overwrite_policy)
    form.append('fast', options.value.fast ? 'true' : 'false')
    form.append('dry_run', options.value.dry_run ? 'true' : 'false')
    const response = await http.post('/api/data-import/tasks', form, {
      timeout: 30 * 60 * 1000,
      onUploadProgress: (event) => {
        if (event.total) uploadProgress.value = Math.min(100, Math.max(1, Math.round((event.loaded * 100) / event.total)))
      },
    })
    if (response.data?.success === true && response.data?.data) {
      pushAlert('success', tr('导入任务已创建'), tr('文件已上传，后台将先校验再分批导入。'))
      resetWizard()
      page.value = 1
      await loadTasks()
    } else {
      pushAlert('error', tr('创建导入任务失败'), response.data?.message || tr('服务器未返回有效数据，请稍后重试。'))
    }
  } catch (error) {
    console.error('create data-import task failed', error)
    pushAlert('error', tr('创建导入任务失败'), errorMessage(error, tr('请检查网络连接后重试。')))
  } finally {
    submitting.value = false
    uploadProgress.value = null
  }
}

// ---- Task list ----
const tasks = ref([])
const total = ref(0)
const listLoading = ref(false)
const initialLoadFailed = ref(false)
const page = ref(1)
const pageSize = ref(20)
const statusFilter = ref('')
let refreshTimer = null
let listRequestSeq = 0

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const pageNumbers = computed(() => Array.from({ length: totalPages.value }, (_, index) => index + 1))
const hasActiveTask = computed(() => tasks.value.some((task) => isActiveStatus(task.status)))

function schedulePolling() {
  if (hasActiveTask.value && !refreshTimer) {
    refreshTimer = window.setInterval(() => loadTasks({ silent: true }), 2000)
  } else if (!hasActiveTask.value && refreshTimer) {
    window.clearInterval(refreshTimer)
    refreshTimer = null
  }
}

async function loadTasks({ silent = false } = {}) {
  // 背景轮询不与在途请求叠加；用户发起的刷新（翻页/筛选/操作后）始终发起，并以序号取代旧请求，
  // 避免在途请求用旧筛选条件覆盖新选择。
  if (silent && listLoading.value) return
  const seq = ++listRequestSeq
  listLoading.value = true
  try {
    const params = { limit: pageSize.value, offset: (page.value - 1) * pageSize.value }
    if (statusFilter.value) params.status = statusFilter.value
    const response = await http.get('/api/data-import/tasks', { params })
    if (seq !== listRequestSeq) return
    const data = response.data?.data
    if (response.data?.success !== true || !Array.isArray(data?.items)) {
      throw new Error(tr('服务器未返回有效数据，请稍后重试。'))
    }
    total.value = Number(data.total) || 0
    // 删除末页最后一条后旧 offset 会取空：收敛页码并重取该页，而非展示空状态。
    if (page.value > totalPages.value) {
      page.value = totalPages.value
      listLoading.value = false
      return loadTasks({ silent })
    }
    tasks.value = data.items
    initialLoadFailed.value = false
  } catch (error) {
    if (seq !== listRequestSeq) return
    console.error('load data-import tasks failed', error)
    initialLoadFailed.value = tasks.value.length === 0
    if (!silent) pushAlert('error', tr('加载导入任务失败'), errorMessage(error, tr('请稍后重试。')))
  } finally {
    if (seq === listRequestSeq) {
      listLoading.value = false
      schedulePolling()
    }
  }
}

function changePage(nextPage) {
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value) return
  page.value = nextPage
  loadTasks()
}

function changeStatusFilter() {
  page.value = 1
  loadTasks()
}

function taskProgress(task) {
  return progressPercent(task.processed_rows, task.total_rows)
}

function overwriteLabel(policy) {
  return policy === 'overwrite' ? tr('覆盖本地') : tr('仅新增/补缺')
}

async function runAction(task, path, { successTitle, confirmKey } = {}) {
  if (confirmKey && !window.confirm(tr(confirmKey))) return
  try {
    const response = await http.post(`/api/data-import/tasks/${task.id}/${path}`)
    if (response.data?.success === true) {
      pushAlert('success', successTitle)
      await loadTasks({ silent: true })
    } else {
      pushAlert('error', tr('操作失败'), response.data?.message || tr('服务器未返回有效数据，请稍后重试。'))
    }
  } catch (error) {
    console.error(`data-import ${path} failed`, error)
    pushAlert('error', tr('操作失败'), errorMessage(error, tr('请检查网络连接后重试。')))
  }
}

function pauseTask(task) {
  return runAction(task, 'pause', { successTitle: tr('任务已暂停') })
}

function cancelTask(task) {
  return runAction(task, 'cancel', {
    successTitle: tr('任务已取消'),
    confirmKey: '取消后已导入数据将保留，确定取消该任务？',
  })
}

async function deleteTask(task) {
  if (!window.confirm(tr('删除后任务记录与文件将被移除，已导入数据保留。确定删除？'))) return
  try {
    const response = await http.delete(`/api/data-import/tasks/${task.id}`)
    if (response.data?.success === true) {
      pushAlert('success', tr('任务已删除'))
      await loadTasks({ silent: true })
    } else {
      pushAlert('error', tr('操作失败'), response.data?.message || tr('服务器未返回有效数据，请稍后重试。'))
    }
  } catch (error) {
    console.error('delete data-import task failed', error)
    pushAlert('error', tr('操作失败'), errorMessage(error, tr('请检查网络连接后重试。')))
  }
}

// ---- Resume modal ----
const resumeTarget = ref(null)
const resumeForm = ref({ batch_size: 1000, concurrency: 2 })
const resumeErrors = ref({})
const resumeSubmitting = ref(false)

function openResume(task) {
  resumeTarget.value = task
  resumeForm.value = { batch_size: task.batch_size ?? 1000, concurrency: task.concurrency ?? 2 }
  resumeErrors.value = {}
}

function closeResume() {
  resumeTarget.value = null
  resumeErrors.value = {}
}

async function submitResume() {
  if (!resumeTarget.value || resumeSubmitting.value) return
  const result = validateResumePayload(resumeForm.value, limits.value)
  resumeErrors.value = result.errors
  if (!result.valid) return
  resumeSubmitting.value = true
  try {
    const response = await http.post(`/api/data-import/tasks/${resumeTarget.value.id}/resume`, result.payload)
    if (response.data?.success === true) {
      pushAlert('success', tr('任务已继续'))
      closeResume()
      await loadTasks({ silent: true })
    } else {
      pushAlert('error', tr('操作失败'), response.data?.message || tr('服务器未返回有效数据，请稍后重试。'))
    }
  } catch (error) {
    console.error('resume data-import task failed', error)
    pushAlert('error', tr('操作失败'), errorMessage(error, tr('请检查网络连接后重试。')))
  } finally {
    resumeSubmitting.value = false
  }
}

// ---- Detail modal ----
const detailTarget = ref(null)
const detailLoading = ref(false)
const detailError = ref('')
const errorSamples = ref([])

async function openDetail(task) {
  detailTarget.value = task
  detailError.value = ''
  errorSamples.value = []
  detailLoading.value = true
  try {
    const [detailResponse, errorsResponse] = await Promise.all([
      http.get(`/api/data-import/tasks/${task.id}`),
      http.get(`/api/data-import/tasks/${task.id}/errors`),
    ])
    if (detailResponse.data?.success === true && detailResponse.data?.data) {
      detailTarget.value = detailResponse.data.data
    }
    if (errorsResponse.data?.success === true && Array.isArray(errorsResponse.data?.data?.samples)) {
      errorSamples.value = errorsResponse.data.data.samples
    }
  } catch (error) {
    console.error('load data-import detail failed', error)
    detailError.value = errorMessage(error, tr('请检查网络连接后重试。'))
  } finally {
    detailLoading.value = false
  }
}

function closeDetail() {
  detailTarget.value = null
  errorSamples.value = []
  detailError.value = ''
}

async function downloadErrors(task) {
  try {
    const response = await http.get(`/api/data-import/tasks/${task.id}/errors.csv`, { responseType: 'blob' })
    const url = URL.createObjectURL(response.data)
    const link = document.createElement('a')
    link.href = url
    link.download = `network-mapping-import-errors-${task.id}.csv`
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('download data-import errors failed', error)
    pushAlert('error', tr('错误报告下载失败'), errorMessage(error, tr('请检查网络连接后重试。')))
  }
}

const detailStats = computed(() => formatRowStats(detailTarget.value))

onMounted(() => {
  loadSchema()
  loadTasks()
})

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
})
</script>

<template>
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

  <div class="page-shell">
    <div class="mb-4">
      <h1 class="page-title">{{ tr("数据导入") }}</h1>
      <p class="text-xs opacity-60">{{ tr("上传 CSV 资产端点文件，核对头部映射后导入资产库。") }}</p>
    </div>

    <div class="flex flex-col gap-5">
      <!-- Upload wizard -->
      <div class="card bg-base-100 card-border border-base-300 p-4">
        <h3 class="font-semibold mb-3">{{ tr("上传向导") }}</h3>

        <div v-if="schemaError && !schema" role="alert" class="alert alert-error alert-soft mb-3 text-sm">
          <span>{{ tr("加载头部规范失败") }}：{{ schemaError }}</span>
          <button class="btn btn-xs btn-ghost" @click="loadSchema">{{ tr("刷新") }}</button>
        </div>

        <fieldset class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label :for="`${formFieldId}-file`">{{ tr("选择 CSV 文件") }} <span class="text-error">*</span></label></legend>
          <input
            :id="`${formFieldId}-file`"
            ref="fileInput"
            type="file"
            accept=".csv,text/csv"
            class="file-input file-input-bordered w-full"
            :disabled="submitting || schemaLoading"
            @change="onFileChange"
          />
          <p class="text-xs opacity-60">
            {{ tr("仅读取文件头部用于配对，点击导入时才上传整个文件。") }}
            <span v-if="limits.max_upload_bytes">{{ tr("上传限额：{0}。", [formatBytes(limits.max_upload_bytes)]) }}</span>
          </p>
        </fieldset>

        <div v-if="selectedFile" class="mt-2 text-xs opacity-70">
          {{ tr("已选择文件：{0}", [selectedFile.name]) }}（{{ formatBytes(selectedFile.size) }}）
        </div>

        <div v-if="headerError" role="alert" class="alert alert-error alert-soft mt-3 text-sm">{{ headerError }}</div>

        <template v-if="selectedFile && fileHeaders.length && !headerTruncated && schema">
          <!-- Mapping table -->
          <div class="mt-4">
            <div class="mb-2 flex items-center justify-between gap-3">
              <h4 class="text-sm font-semibold">{{ tr("头部映射") }}</h4>
              <span class="text-xs opacity-60">{{ tr("自动配对已就绪，可手动调整。") }}</span>
            </div>

            <div v-if="activeConflicts.length" role="alert" class="alert alert-warning alert-soft mb-2 text-xs">
              <span>{{ tr("检测到多个文件列匹配同一内部头部，请手动选择：") }}{{ activeConflicts.map((c) => `${c.internal}（${c.fileHeaders.join(', ')}）`).join('；') }}</span>
            </div>
            <div v-if="mappingIssues.conflicts.length" role="alert" class="alert alert-error alert-soft mb-2 text-xs">
              <span>{{ tr("同一文件列被映射到多个内部头部，请调整。") }}</span>
            </div>

            <div class="overflow-x-auto rounded-box border border-base-300">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>{{ tr("内部头部") }}</th>
                    <th>{{ tr("类型") }}</th>
                    <th>{{ tr("文件头部") }}</th>
                    <th>{{ tr("说明") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="header in schemaHeaders"
                    :key="header.name"
                    :class="{ 'bg-error/10': header.required && !mapping[header.name] }"
                  >
                    <td class="whitespace-nowrap">
                      <code class="text-xs">{{ header.name }}</code>
                      <span v-if="header.required" class="text-error" :title="tr(&quot;必须&quot;)">*</span>
                    </td>
                    <td class="whitespace-nowrap text-xs opacity-70">{{ header.type || '-' }}</td>
                    <td>
                      <select
                        v-model="mapping[header.name]"
                        class="select select-bordered select-sm w-full min-w-40"
                        :class="{ 'select-error': header.required && !mapping[header.name] }"
                        :aria-label="header.name"
                      >
                        <option value="">{{ tr("（忽略）") }}</option>
                        <option v-for="fileHeader in fileHeaders" :key="fileHeader" :value="fileHeader">{{ fileHeader }}</option>
                      </select>
                    </td>
                    <td class="text-xs opacity-60">{{ header.description || '-' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-if="mappingIssues.unmatchedRequired.length" class="mt-2 text-xs text-error">
              {{ tr("必须头部未映射：") }}{{ mappingIssues.unmatchedRequired.join(', ') }}
            </div>
            <div v-if="mappingIssues.ignoredFileHeaders.length" class="mt-2 flex flex-wrap items-center gap-1 text-xs opacity-70">
              <span>{{ tr("将忽略的列：") }}</span>
              <span v-for="fileHeader in mappingIssues.ignoredFileHeaders" :key="fileHeader" class="badge badge-ghost badge-xs">{{ fileHeader }}</span>
            </div>
          </div>

          <!-- Options -->
          <div class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <fieldset class="fieldset min-w-0 w-full">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-batch`">{{ tr("批次大小") }}</label></legend>
              <input
                :id="`${formFieldId}-batch`"
                v-model.number="options.batch_size"
                type="number"
                min="1"
                :max="limits.max_batch_size || 50000"
                class="input input-bordered w-full"
                :class="{ 'input-error': optionsValidation.errors.batch_size }"
                :disabled="submitting"
              />
              <p v-if="optionsValidation.errors.batch_size" class="text-xs text-error">{{ tr(optionsValidation.errors.batch_size.key, optionsValidation.errors.batch_size.values) }}</p>
            </fieldset>

            <fieldset class="fieldset min-w-0 w-full">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-concurrency`">{{ tr("并发") }}</label></legend>
              <input
                :id="`${formFieldId}-concurrency`"
                v-model.number="options.concurrency"
                type="number"
                min="1"
                :max="limits.max_concurrency || 8"
                class="input input-bordered w-full"
                :class="{ 'input-error': optionsValidation.errors.concurrency }"
                :disabled="submitting"
              />
              <p v-if="optionsValidation.errors.concurrency" class="text-xs text-error">{{ tr(optionsValidation.errors.concurrency.key, optionsValidation.errors.concurrency.values) }}</p>
            </fieldset>

            <fieldset class="fieldset min-w-0 w-full">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-invalid`">{{ tr("无效行策略") }}</label></legend>
              <select :id="`${formFieldId}-invalid`" v-model="options.on_invalid" class="select select-bordered w-full" :disabled="submitting">
                <option value="skip">{{ tr("跳过无效行") }}</option>
                <option value="abort">{{ tr("中止导入") }}</option>
              </select>
            </fieldset>

            <fieldset class="fieldset min-w-0 w-full">
              <legend class="fieldset-legend">{{ tr("覆盖策略") }}</legend>
              <label class="label cursor-pointer justify-start gap-2">
                <input v-model="options.overwrite_policy" type="radio" value="fill" class="radio radio-sm" :disabled="submitting" />
                <span class="text-xs">{{ tr("仅新增/补缺（默认，不覆盖扫描结果）") }}</span>
              </label>
              <label class="label cursor-pointer justify-start gap-2">
                <input v-model="options.overwrite_policy" type="radio" value="overwrite" class="radio radio-sm" :disabled="submitting" />
                <span class="text-xs">{{ tr("覆盖本地（按时间新者胜）") }}</span>
              </label>
            </fieldset>

            <label class="label cursor-pointer justify-start gap-2">
              <input v-model="options.fast" type="checkbox" class="checkbox checkbox-sm" :disabled="submitting" />
              <span class="text-xs">{{ tr("快速模式（单遍校验并导入）") }}</span>
            </label>
            <label class="label cursor-pointer justify-start gap-2">
              <input v-model="options.dry_run" type="checkbox" class="checkbox checkbox-sm" :disabled="submitting" />
              <span class="text-xs">{{ tr("试运行（只校验不写入）") }}</span>
            </label>
          </div>

          <div v-if="submitting" role="status" class="mt-3 space-y-1">
            <progress class="progress progress-primary w-full" :value="uploadProgress" max="100" :aria-label="tr(&quot;上传进度&quot;)"></progress>
            <p class="text-xs opacity-70">{{ uploadProgress == null ? tr("正在连接服务器，准备上传…") : uploadProgress < 100 ? tr("正在上传：{0}%", [uploadProgress]) : tr("文件已发送，等待服务器创建任务…") }}</p>
          </div>

          <div class="mt-4 flex items-center gap-3">
            <button class="btn btn-neutral" :disabled="!canImport" @click="submitImport">
              {{ submitting ? tr("上传中") : tr("导入") }}
            </button>
            <button class="btn btn-ghost" :disabled="submitting" @click="resetWizard">{{ tr("重新选择") }}</button>
            <span v-if="!canImport && !submitting && mappingIssues.unmatchedRequired.length" class="text-xs text-error">{{ tr("请映射所有必须头部") }}</span>
          </div>
        </template>
      </div>

      <!-- Task list -->
      <div class="card bg-base-100 card-border border-base-300 p-4">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 class="font-semibold">{{ tr("导入任务") }}</h3>
          <div class="flex items-center gap-2">
            <select v-model="statusFilter" class="select select-bordered select-sm" :aria-label="tr(&quot;状态&quot;)" @change="changeStatusFilter">
              <option value="">{{ tr("全部状态") }}</option>
              <option v-for="status in IMPORT_STATUSES" :key="status" :value="status">{{ tr(statusMeta(status).labelKey) }}</option>
            </select>
            <button class="btn btn-ghost btn-xs" :disabled="listLoading" @click="loadTasks()">
              {{ listLoading ? tr("加载中...") : tr("刷新") }}
            </button>
          </div>
        </div>

        <div v-if="listLoading && tasks.length === 0" class="grid min-h-64 place-items-center rounded-lg bg-base-200/60">
          <span class="loading loading-spinner loading-md"></span>
        </div>

        <EmptyState
          v-else-if="initialLoadFailed"
          type="error"
          :title="tr(&quot;导入任务加载失败&quot;)"
          :message="tr(&quot;无法从服务器获取导入任务，请稍后重试。&quot;)"
        />

        <EmptyState
          v-else-if="tasks.length === 0"
          :title="tr(&quot;暂无导入任务&quot;)"
          :message="tr(&quot;使用上方向导上传 CSV 文件创建第一个导入任务。&quot;)"
        />

        <div v-else class="overflow-x-auto rounded-box border border-base-300">
          <table class="table table-sm whitespace-nowrap">
            <thead>
              <tr>
                <th>{{ tr("文件名") }}</th>
                <th>{{ tr("状态") }}</th>
                <th>{{ tr("覆盖策略") }}</th>
                <th>{{ tr("进度") }}</th>
                <th>{{ tr("行数统计") }}</th>
                <th>{{ tr("创建时间") }}</th>
                <th>{{ tr("操作") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="task in tasks" :key="task.id">
                <td>
                  <div class="max-w-52 truncate" :title="task.file_name">{{ task.file_name }}</div>
                  <div class="text-xs opacity-50">{{ formatBytes(task.file_size) }}</div>
                </td>
                <td>
                  <span class="badge badge-sm" :class="statusMeta(task.status).badgeClass">{{ tr(statusMeta(task.status).labelKey) }}</span>
                  <span v-if="task.dry_run" class="badge badge-ghost badge-xs ml-1">{{ tr("试运行") }}</span>
                </td>
                <td>
                  <span class="badge badge-xs" :class="task.overwrite_policy === 'overwrite' ? 'badge-warning' : 'badge-ghost'">{{ overwriteLabel(task.overwrite_policy) }}</span>
                </td>
                <td>
                  <div v-if="taskProgress(task) === null" class="text-xs opacity-60">{{ tr("统计中") }}</div>
                  <div v-else class="flex items-center gap-2">
                    <progress class="progress progress-primary w-24" :value="taskProgress(task)" max="100" :aria-label="tr(&quot;进度&quot;)"></progress>
                    <span class="text-xs opacity-70">{{ taskProgress(task) }}%</span>
                  </div>
                  <div class="text-xs opacity-50">{{ formatRowStats(task).processed }} / {{ formatRowStats(task).total === null ? '?' : formatRowStats(task).total }}</div>
                </td>
                <td>
                  <div class="flex flex-wrap gap-1 text-xs">
                    <span class="badge badge-success badge-xs">{{ tr("导入") }} {{ formatRowStats(task).imported }}</span>
                    <span class="badge badge-error badge-xs">{{ tr("无效") }} {{ formatRowStats(task).invalid }}</span>
                    <span class="badge badge-ghost badge-xs">{{ tr("重复") }} {{ formatRowStats(task).duplicate }}</span>
                    <span class="badge badge-warning badge-xs">{{ tr("冲突") }} {{ formatRowStats(task).conflict }}</span>
                  </div>
                </td>
                <td class="whitespace-nowrap">{{ formatDate(task.created_at) }}</td>
                <td>
                  <div class="flex flex-wrap gap-1">
                    <button v-if="canPause(task.status)" class="btn btn-ghost btn-xs" @click="pauseTask(task)">{{ tr("暂停") }}</button>
                    <button v-if="canResume(task.status)" class="btn btn-ghost btn-xs" @click="openResume(task)">{{ tr("继续") }}</button>
                    <button v-if="canCancel(task.status)" class="btn btn-ghost btn-xs text-error" @click="cancelTask(task)">{{ tr("取消") }}</button>
                    <button class="btn btn-ghost btn-xs" @click="openDetail(task)">{{ tr("详情") }}</button>
                    <button class="btn btn-ghost btn-xs" @click="downloadErrors(task)">{{ tr("错误报告") }}</button>
                    <button v-if="canDelete(task.status)" class="btn btn-ghost btn-xs text-error" @click="deleteTask(task)">{{ tr("删除") }}</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="!initialLoadFailed && total > 0" class="mt-3 flex items-center justify-between">
          <div class="text-xs opacity-70">{{ tr("第") }} {{ page }} / {{ totalPages }} {{ tr("页") }}</div>
          <div class="join">
            <button class="join-item btn btn-xs" :disabled="page === 1" @click="changePage(page - 1)">{{ tr("上一页") }}</button>
            <button
              v-for="p in pageNumbers"
              :key="p"
              class="join-item btn btn-xs"
              :class="{ 'btn-active': p === page }"
              @click="changePage(p)"
            >
              {{ p }}
            </button>
            <button class="join-item btn btn-xs" :disabled="page === totalPages" @click="changePage(page + 1)">{{ tr("下一页") }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Resume modal -->
    <dialog class="modal" :class="{ 'modal-open': resumeTarget }">
      <div v-if="resumeTarget" class="modal-box">
        <h2 class="text-lg font-semibold">{{ tr("继续任务") }}</h2>
        <p class="mt-1 text-sm opacity-65">{{ tr("调整批次大小与并发后从已提交水位续传。") }}</p>
        <form class="mt-4 grid gap-3" @submit.prevent="submitResume">
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-resume-batch`">{{ tr("批次大小") }}</label></legend>
            <input
              :id="`${formFieldId}-resume-batch`"
              v-model.number="resumeForm.batch_size"
              type="number"
              min="1"
              :max="limits.max_batch_size || 50000"
              class="input input-bordered w-full"
              :class="{ 'input-error': resumeErrors.batch_size }"
              :disabled="resumeSubmitting"
            />
            <p v-if="resumeErrors.batch_size" class="text-xs text-error">{{ tr(resumeErrors.batch_size.key, resumeErrors.batch_size.values) }}</p>
          </fieldset>
          <fieldset class="fieldset min-w-0 w-full">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-resume-concurrency`">{{ tr("并发") }}</label></legend>
            <input
              :id="`${formFieldId}-resume-concurrency`"
              v-model.number="resumeForm.concurrency"
              type="number"
              min="1"
              :max="limits.max_concurrency || 8"
              class="input input-bordered w-full"
              :class="{ 'input-error': resumeErrors.concurrency }"
              :disabled="resumeSubmitting"
            />
            <p v-if="resumeErrors.concurrency" class="text-xs text-error">{{ tr(resumeErrors.concurrency.key, resumeErrors.concurrency.values) }}</p>
          </fieldset>
          <div class="modal-action">
            <button type="button" class="btn btn-ghost" :disabled="resumeSubmitting" @click="closeResume">{{ tr("取消") }}</button>
            <button class="btn btn-neutral" :disabled="resumeSubmitting">{{ resumeSubmitting ? tr("提交中...") : tr("继续") }}</button>
          </div>
        </form>
      </div>
      <button class="modal-backdrop" :aria-label="tr(&quot;关闭&quot;)" @click="closeResume"></button>
    </dialog>

    <!-- Detail modal -->
    <dialog class="modal" :class="{ 'modal-open': detailTarget }">
      <div v-if="detailTarget" class="modal-box max-w-3xl">
        <h2 class="text-lg font-semibold">{{ tr("任务详情") }}</h2>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <span class="badge badge-sm" :class="statusMeta(detailTarget.status).badgeClass">{{ tr(statusMeta(detailTarget.status).labelKey) }}</span>
          <span class="break-all text-sm opacity-70">{{ detailTarget.file_name }}</span>
        </div>

        <div v-if="detailLoading" role="status" class="py-6 text-center opacity-60">{{ tr("加载中...") }}</div>
        <div v-if="detailError" role="alert" class="alert alert-error alert-soft mt-3 text-sm">{{ detailError }}</div>

        <div class="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <div><span class="text-base-content/50">{{ tr("总行数") }}</span><div>{{ detailStats.total === null ? tr("统计中") : detailStats.total }}</div></div>
          <div><span class="text-base-content/50">{{ tr("已处理") }}</span><div>{{ detailStats.processed }}</div></div>
          <div><span class="text-base-content/50">{{ tr("已导入") }}</span><div>{{ detailStats.imported }}</div></div>
          <div><span class="text-base-content/50">{{ tr("无效行") }}</span><div>{{ detailStats.invalid }}</div></div>
          <div><span class="text-base-content/50">{{ tr("重复行") }}</span><div>{{ detailStats.duplicate }}</div></div>
          <div><span class="text-base-content/50">{{ tr("冲突行") }}</span><div>{{ detailStats.conflict }}</div></div>
          <div><span class="text-base-content/50">{{ tr("批次大小") }}</span><div>{{ detailTarget.batch_size }}</div></div>
          <div><span class="text-base-content/50">{{ tr("并发") }}</span><div>{{ detailTarget.concurrency }}</div></div>
          <div><span class="text-base-content/50">{{ tr("覆盖策略") }}</span><div>{{ overwriteLabel(detailTarget.overwrite_policy) }}</div></div>
          <div><span class="text-base-content/50">{{ tr("无效行策略") }}</span><div>{{ detailTarget.on_invalid === 'abort' ? tr("中止导入") : tr("跳过无效行") }}</div></div>
          <div><span class="text-base-content/50">{{ tr("创建时间") }}</span><div>{{ formatDate(detailTarget.created_at) }}</div></div>
          <div><span class="text-base-content/50">{{ tr("开始时间") }}</span><div>{{ formatDate(detailTarget.started_at) }}</div></div>
          <div><span class="text-base-content/50">{{ tr("完成时间") }}</span><div>{{ formatDate(detailTarget.finished_at) }}</div></div>
          <div><span class="text-base-content/50">{{ tr("文件大小") }}</span><div>{{ formatBytes(detailTarget.file_size) }}</div></div>
        </div>

        <div v-if="detailTarget.error_message" class="mt-4">
          <div class="text-sm text-base-content/50">{{ tr("错误信息") }}</div>
          <pre class="mt-1 max-h-40 overflow-auto rounded-box bg-base-200 p-3 text-xs text-error">{{ detailTarget.error_message }}</pre>
        </div>

        <div class="mt-4">
          <div class="mb-2 flex items-center justify-between gap-3">
            <div class="text-sm text-base-content/50">{{ tr("错误样本") }}</div>
            <button class="btn btn-outline btn-xs" @click="downloadErrors(detailTarget)">{{ tr("下载错误报告") }}</button>
          </div>
          <div v-if="!detailLoading && errorSamples.length === 0" class="rounded-box bg-base-200/60 p-3 text-xs opacity-60">
            <p>{{ tr("暂无错误样本") }}</p>
            <p class="mt-1">{{ tr("完整错误报告可点击上方按钮下载。") }}</p>
          </div>
          <div v-else class="overflow-x-auto rounded-box border border-base-300">
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>{{ tr("行号") }}</th>
                  <th>{{ tr("列") }}</th>
                  <th>{{ tr("值") }}</th>
                  <th>{{ tr("原因") }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(sample, index) in errorSamples" :key="index">
                  <td>{{ sample.row }}</td>
                  <td class="whitespace-nowrap">{{ sample.column || '-' }}</td>
                  <td class="max-w-48 truncate" :title="sample.value">{{ sample.value ?? '-' }}</td>
                  <td>{{ sample.reason }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="modal-action"><button class="btn" @click="closeDetail">{{ tr("关闭") }}</button></div>
      </div>
      <button class="modal-backdrop" :aria-label="tr(&quot;关闭详情&quot;)" @click="closeDetail"></button>
    </dialog>
  </div>
</template>