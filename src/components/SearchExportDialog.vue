<script setup>
import { tr } from '../i18n/index.js'

import { computed, onBeforeUnmount, ref } from 'vue'
import http from '@/utils/http'
import { groupFields, validateExportPayload } from '@/utils/dataExport.js'

// Shared by the search page (fixed query, page window available) and the
// data-export page (editable query, all-scope only). Opened via ref.open().
const emit = defineEmits(['submitted'])

const dialogRef = ref(null)
const query = ref('')
const queryEditable = ref(false)
const page = ref(null)
const sortField = ref('last_seen')
const sortOrder = ref('desc')
const scope = ref('all')
const catalog = ref([])
const defaultFields = ref([])
const limits = ref({})
const selected = ref([])
const schemaLoading = ref(false)
const schemaError = ref('')
const matchedTotal = ref(null)
const previewLoading = ref(false)
const previewError = ref('')
const submitting = ref(false)
const submitError = ref('')
let previewSeq = 0
let previewTimer = null
let schemaRequest = null

const groups = computed(() => groupFields(catalog.value))
const selectedSet = computed(() => new Set(selected.value))
const orderedSelection = computed(() => catalog.value.filter((field) => selectedSet.value.has(field.key)).map((field) => field.key))
const pageAvailable = computed(() => Boolean(page.value))
const overLimit = computed(() => scope.value === 'all'
  && matchedTotal.value != null
  && Number(limits.value.max_rows) > 0
  && matchedTotal.value > Number(limits.value.max_rows))
const validation = computed(() => validateExportPayload({
  query: query.value,
  scope: scope.value,
  offset: page.value?.offset,
  limit: page.value?.limit,
  fields: orderedSelection.value,
  matched_total: matchedTotal.value,
}, limits.value))
const canSubmit = computed(() => validation.value.valid
  && !submitting.value
  && !schemaLoading.value
  && (scope.value === 'page' || (matchedTotal.value != null && !previewLoading.value && !previewError.value)))

function loadSchema() {
  if (catalog.value.length) return Promise.resolve()
  if (!schemaRequest) {
    schemaLoading.value = true
    schemaError.value = ''
    schemaRequest = http.get('/api/data-export/schema')
      .then((response) => {
        const data = response.data?.data
        if (response.data?.success !== true || !Array.isArray(data?.fields)) throw new Error('invalid schema')
        catalog.value = data.fields
        defaultFields.value = Array.isArray(data.default_fields) ? data.default_fields : data.fields.map((field) => field.key)
        limits.value = data.limits || {}
        selected.value = [...defaultFields.value]
      })
      .catch(() => { schemaError.value = tr('导出字段目录加载失败，请稍后重试。') })
      .finally(() => { schemaLoading.value = false; schemaRequest = null })
  }
  return schemaRequest
}

async function runPreview() {
  const sequence = ++previewSeq
  previewLoading.value = true
  previewError.value = ''
  matchedTotal.value = null
  try {
    const response = await http.post('/api/data-export/preview', { query: query.value.trim() })
    if (sequence !== previewSeq) return
    if (response.data?.success !== true) throw new Error('invalid preview')
    matchedTotal.value = Number(response.data?.data?.matched_total) || 0
  } catch (error) {
    if (sequence !== previewSeq) return
    previewError.value = error.response?.data?.message || tr('匹配条数预览失败，请稍后重试。')
  } finally {
    if (sequence === previewSeq) previewLoading.value = false
  }
}

function schedulePreview() {
  clearTimeout(previewTimer)
  if (scope.value !== 'all' || !queryEditable.value) return
  previewTimer = setTimeout(() => {
    if (query.value.trim()) runPreview()
  }, 500)
}

async function open(options = {}) {
  query.value = options.query || ''
  queryEditable.value = Boolean(options.queryEditable)
  page.value = options.page || null
  sortField.value = options.sortField || 'last_seen'
  sortOrder.value = options.sortOrder || 'desc'
  scope.value = page.value ? (options.initialScope || 'page') : 'all'
  submitError.value = ''
  previewError.value = ''
  matchedTotal.value = null
  if (catalog.value.length) selected.value = [...defaultFields.value]
  dialogRef.value?.showModal()
  await loadSchema()
  if (catalog.value.length && !selected.value.length) selected.value = [...defaultFields.value]
  if (scope.value === 'all' && query.value.trim()) runPreview()
}

function close() {
  dialogRef.value?.close()
}

function setScope(value) {
  scope.value = value
  submitError.value = ''
  if (value === 'all' && matchedTotal.value == null && !previewLoading.value && query.value.trim()) runPreview()
}

function onQueryInput() {
  submitError.value = ''
  // 语句一变立即作废在途预览：否则 debounce 窗口内旧响应会回填旧语句的条数，
  // 解除提交限制并使上限校验作用于错误条数；切到本页再切回全部也会复用该旧值。
  previewSeq += 1
  previewLoading.value = false
  previewError.value = ''
  matchedTotal.value = null
  if (scope.value === 'all') schedulePreview()
}

function toggleField(key) {
  selected.value = selectedSet.value.has(key)
    ? selected.value.filter((value) => value !== key)
    : [...selected.value, key]
}

function toggleGroup(group, checked) {
  const keys = new Set(group.fields.map((field) => field.key))
  selected.value = checked
    ? [...new Set([...selected.value, ...keys])]
    : selected.value.filter((key) => !keys.has(key))
}

function groupChecked(group) {
  return group.fields.every((field) => selectedSet.value.has(field.key))
}

function selectAll() {
  selected.value = catalog.value.map((field) => field.key)
}

function resetFields() {
  selected.value = [...defaultFields.value]
}

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  submitError.value = ''
  try {
    const payload = { ...validation.value.payload, sort_field: sortField.value, sort_order: sortOrder.value }
    const response = await http.post('/api/data-export/tasks', payload)
    if (response.data?.success !== true || !response.data?.data) throw new Error('invalid response')
    emit('submitted', response.data.data)
    close()
  } catch (error) {
    submitError.value = error.response?.data?.message || tr('创建导出任务失败，请稍后重试。')
  } finally {
    submitting.value = false
  }
}

onBeforeUnmount(() => {
  clearTimeout(previewTimer)
  previewSeq += 1
})

defineExpose({ open })
</script>

<template>
  <dialog ref="dialogRef" class="modal">
    <div class="modal-box w-[calc(100vw-2rem)] max-w-2xl">
      <h3 class="text-lg font-bold">{{ tr("导出") }}</h3>

      <fieldset class="fieldset mt-3">
        <legend class="fieldset-legend">{{ tr("搜索语句") }}</legend>
        <textarea
          v-model="query"
          class="textarea textarea-bordered w-full font-mono text-sm"
          rows="2"
          :readonly="!queryEditable"
          :aria-label="tr(&quot;搜索语句&quot;)"
          @input="onQueryInput"
        ></textarea>
      </fieldset>

      <fieldset class="fieldset mt-3">
        <legend class="fieldset-legend">{{ tr("导出范围") }}</legend>
        <label class="label cursor-pointer justify-start gap-2" :class="{ 'opacity-50': !pageAvailable }">
          <input type="radio" class="radio radio-sm" :checked="scope === 'page'" :disabled="!pageAvailable || submitting" @change="setScope('page')" />
          <span class="text-sm">{{ tr("本页") }}<template v-if="pageAvailable">（{{ page.count }} {{ tr("条") }}）</template></span>
        </label>
        <label class="label cursor-pointer justify-start gap-2">
          <input type="radio" class="radio radio-sm" :checked="scope === 'all'" :disabled="submitting" @change="setScope('all')" />
          <span class="text-sm">{{ tr("全部") }}</span>
        </label>
        <p class="text-xs opacity-70">
          <template v-if="scope === 'all'">
            <template v-if="previewLoading">{{ tr("正在统计匹配条数…") }}</template>
            <template v-else-if="matchedTotal != null">{{ tr("匹配") }} {{ matchedTotal }} {{ tr("条") }}</template>
            <template v-else-if="previewError"><span class="text-error">{{ previewError }}</span></template>
          </template>
          <template v-else>{{ tr("导出当前分页窗口的结果") }}</template>
          · {{ tr("以本地索引匹配为准，不含未入库的联测展示数据") }}
        </p>
        <p v-if="overLimit" class="text-xs text-error">{{ tr("匹配 {0} 条，超过单任务导出上限 {1} 条，请缩小查询范围", [matchedTotal, limits.max_rows]) }}</p>
      </fieldset>

      <fieldset class="fieldset mt-3">
        <legend class="fieldset-legend">{{ tr("导出字段") }}（{{ orderedSelection.length }}/{{ catalog.length }}）</legend>
        <div v-if="schemaLoading" class="grid min-h-24 place-items-center rounded-lg bg-base-200/60">
          <span class="loading loading-spinner loading-sm"></span>
        </div>
        <p v-else-if="schemaError" class="text-xs text-error">{{ schemaError }}</p>
        <template v-else>
          <div class="mb-2 flex gap-2">
            <button type="button" class="btn btn-ghost btn-xs" :disabled="submitting" @click="selectAll">{{ tr("全选") }}</button>
            <button type="button" class="btn btn-ghost btn-xs" :disabled="submitting" @click="resetFields">{{ tr("恢复默认") }}</button>
          </div>
          <div class="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-base-300 p-3">
            <div v-for="group in groups" :key="group.group">
              <label class="label cursor-pointer justify-start gap-2 py-0.5">
                <input type="checkbox" class="checkbox checkbox-xs" :checked="groupChecked(group)" :disabled="submitting" @change="toggleGroup(group, $event.target.checked)" />
                <span class="text-xs font-semibold">{{ group.group }}</span>
              </label>
              <div class="ml-5 flex flex-wrap gap-x-4 gap-y-1">
                <label v-for="field in group.fields" :key="field.key" class="label cursor-pointer justify-start gap-1.5 py-0.5">
                  <input type="checkbox" class="checkbox checkbox-xs" :checked="selectedSet.has(field.key)" :disabled="submitting" @change="toggleField(field.key)" />
                  <span class="text-xs">{{ field.label }}</span>
                </label>
              </div>
            </div>
          </div>
          <p v-if="validation.errors.fields" class="mt-1 text-xs text-error">{{ tr("至少选择一个导出字段") }}</p>
        </template>
      </fieldset>

      <p v-if="submitError" role="alert" class="mt-3 text-sm text-error">{{ submitError }}</p>

      <div class="modal-action">
        <button type="button" class="btn btn-ghost" :disabled="submitting" @click="close">{{ tr("取消") }}</button>
        <button type="button" class="btn btn-neutral" :disabled="!canSubmit" @click="submit">
          {{ submitting ? tr("提交中…") : tr("提交导出") }}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button :disabled="submitting">{{ tr("关闭") }}</button>
    </form>
  </dialog>
</template>