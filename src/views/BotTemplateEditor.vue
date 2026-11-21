<script setup>
import { tr } from '../i18n/index.js'

import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import DOMPurify from 'dompurify'
import http from '@/utils/http'
import { notificationEvents, providerLabel, deliveryReason } from '@/utils/notifications'
import TemplateCodeEditor from '@/components/TemplateCodeEditor.vue'
import TemplateVariables from '@/components/TemplateVariables.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import { formatDateTime } from '../i18n/time.js'

const props = defineProps({
  provider: { type: String, required: true },
  initialEvent: { type: String, default: '' },
  externalNavigation: { type: Boolean, default: false },
  eventVariants: { type: Array, default: () => [] },
})
const emit = defineEmits(['selected'])
const formFieldId = useId()
const event = ref(props.initialEvent || notificationEvents[0].value)
const detail = ref(null)
const source = ref({format:'text',titleTemplate:'',bodyTemplate:''})
const saved = ref(JSON.stringify(source.value))
const loading = ref(false)
const busy = ref(false)
const previewing = ref(false)
const preview = ref(null)
const previewTab = ref('rendered')
const previewError = ref('')
const error = ref('')
const notice = ref('')
const channels = ref([])
const channelId = ref('')
const channelError = ref('')
const sampleSeverity = ref('warning')
const testing = ref(false)
const testDelivery = ref(null)
const testNotice = ref('')
const bodyEditor = shallowRef(null)
const titleInput = ref(null)
const activeField = ref('body')
const hasUnsavedChanges = computed(() => saved.value !== JSON.stringify(source.value))
const confirmDialog = ref(null)
useUnsavedChanges(hasUnsavedChanges, async () => { await act('draft'); return !hasUnsavedChanges.value }, confirmDialog)
defineExpose({
  hasUnsavedChanges, selectEvent, restoreVersion, loading,
  versions: computed(() => detail.value?.versions || []),
  busy: computed(() => busy.value || loading.value || testing.value),
})
let disposed = false
let timer
let previewSequence = 0
let previewAbort
let testTimer
let testSequence = 0
const requests = new Set()
const clone = value => JSON.parse(JSON.stringify(value))
const base = computed(() => `/api/notifications/templates/${props.provider}/${event.value}`)
const status = computed(() => ({get draft() { return tr("草稿") },get published() { return tr("已发布") },get default() { return tr("内置默认") }}[detail.value?.status] || tr("历史")))
const canPublish = computed(() => detail.value && (detail.value.status === 'draft' || hasUnsavedChanges.value))
const previewDocument = computed(() => {
  const html = (preview.value?.htmlBody || '').replaceAll('<tg-spoiler>', '<span class="spoiler">').replaceAll('</tg-spoiler>', '</span>')
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS:['b','i','u','s','a','code','pre','blockquote','span','hr'], ALLOWED_ATTR:['class'] })
  const card = props.provider === 'feishu' && preview.value?.payload?.msg_type === 'interactive'
  const headerColor = { red:'#fde2e2', orange:'#fff0d4', green:'#dff3e5', blue:'#e3edff' }[preview.value?.payload?.card?.header?.template] || '#e3edff'
  const content = card ? `<article class="message-card">${clean}</article>` : clean
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font:14px/1.6 system-ui;white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;color:#172b4d;background:${card ? '#f4f5f7' : '#fff'}}a{color:#1769d2;text-decoration:underline}pre,code{background:#f1f3f5}blockquote{border-left:3px solid #aaa;margin-left:0;padding-left:12px}.spoiler{background:#cbd5e1;color:#64748b}.message-card{border:1px solid #dfe3e8;border-radius:8px;overflow:hidden;padding:16px;background:#fff}.message-card>b:first-child{display:block;margin:-16px -16px 8px;padding:12px 16px;background:${headerColor};font-size:16px}</style></head><body>${content}</body></html>`
})

async function request(method, url, data) {
  const controller = new AbortController()
  requests.add(controller)
  try {
    const response = await http({method,url,data,signal:controller.signal})
    if (!response.data?.success) throw new Error(response.data?.message || tr("服务器未确认操作成功"))
    return response.data.data
  } finally { requests.delete(controller) }
}
function apply(value) {
  detail.value = value
  source.value = clone(value.source)
  saved.value = JSON.stringify(value.source)
}
async function load() {
  loading.value = true
  error.value = ''
  preview.value = null
  try {
    const value = await request('GET', base.value)
    if (!disposed) apply(value)
  } catch (e) { if (!disposed) error.value = e.response?.data?.message || e.message || tr("模板加载失败") }
  finally { if (!disposed) loading.value = false }
}
async function selectEvent(value) {
  if (value === event.value || loading.value || busy.value || testing.value) return
  if (hasUnsavedChanges.value && !await confirmDialog.value.ask({ message: tr("当前模板有未保存修改，确定切换事件吗？"), confirmText: tr("放弃修改"), danger: true })) return
  clearTimeout(timer)
  previewAbort?.abort()
  previewSequence++
  clearTimeout(testTimer)
  testSequence++
  testDelivery.value = null
  testNotice.value = ''
  event.value = value
  emit('selected', value)
  detail.value = null
  notice.value = ''
  await load()
}
async function selectStateFromDropdown(change) {
  if (props.eventVariants.some(item => item.value === change.target.value)) await selectEvent(change.target.value)
  change.target.value = event.value
}
async function refreshPreview() {
  if (disposed) return
  clearTimeout(timer)
  previewAbort?.abort()
  const sequence = ++previewSequence
  const controller = new AbortController()
  previewAbort = controller
  previewing.value = true
  preview.value = null
  previewError.value = ''
  try {
    const response = await http.post(`${base.value}/preview?severity=${sampleSeverity.value}`, clone(source.value), {signal:controller.signal})
    if (disposed || sequence !== previewSequence) return
    if (!response.data?.success) throw new Error(response.data?.message || tr("预览失败"))
    preview.value = response.data.data
  } catch (e) {
    if (!disposed && sequence === previewSequence && !controller.signal.aborted) previewError.value = e.response?.data?.message || e.message || tr("预览失败")
  } finally { if (!disposed && sequence === previewSequence) previewing.value = false }
}
watch(source, () => {
  clearTimeout(timer)
  previewSequence++
  previewAbort?.abort()
  preview.value = null
  previewError.value = ''
  if (!disposed && !loading.value && detail.value) timer = setTimeout(refreshPreview, 450)
}, {deep:true, flush:'post'})
watch(loading, value => { if (!value && detail.value) refreshPreview() })
watch(sampleSeverity, () => { if (detail.value && !loading.value) refreshPreview() })

async function loadChannels() {
  channelError.value = ''
  try {
    const value = await request('GET','/api/notifications/channels')
    if (disposed) return
    channels.value = value.filter(c => c.provider === props.provider && c.enabled)
    if (!channels.value.some(c => c.id === channelId.value)) channelId.value = channels.value[0]?.id || ''
  } catch (e) { if (!disposed) channelError.value = e.response?.data?.message || tr("测试渠道加载失败") }
}
async function pollTest(id, sequence, attempt = 0) {
  if (disposed || sequence !== testSequence) return
  try {
    const value = await request('GET',`/api/notifications/deliveries/${id}`)
    if (disposed || sequence !== testSequence) return
    testDelivery.value = value
    if (value.status === 'sent') testNotice.value = tr("测试消息已发送，请在实际客户端检查样式。")
    else if (['failed','cancelled'].includes(value.status)) testNotice.value = tr("测试投递{0}：{1}", [value.status === 'failed' ? '失败' : '已取消', deliveryReason(value.last_error)])
    else if (attempt < 29) testTimer = setTimeout(() => pollTest(id,sequence,attempt+1),2000)
    else testNotice.value = tr("测试仍在排队或重试，请前往通知渠道的投递记录查看。")
  } catch (e) {
    if (!disposed && sequence === testSequence) testNotice.value = tr("测试已入队，暂时无法读取状态，请在通知渠道的投递记录查看。")
  }
}
async function sendTest() {
  if (testing.value || busy.value || loading.value || !channelId.value || !detail.value) return
  testing.value = true
  clearTimeout(testTimer)
  const sequence = ++testSequence
  testNotice.value = ''
  testDelivery.value = null
  try {
    const value = await request('POST',`${base.value}/test`,{channelId:channelId.value,source:clone(source.value),severity:sampleSeverity.value})
    if (disposed || sequence !== testSequence) return
    testNotice.value = tr("测试已入队，正在等待投递结果。")
    testDelivery.value = {id:value.delivery_id,status:'pending'}
    await pollTest(value.delivery_id,sequence)
  } catch (e) {
    if (!disposed && sequence === testSequence) testNotice.value = e.response?.data?.message || e.message || tr("测试发送失败")
  } finally { if (!disposed) testing.value = false }
}
function insertVariable(key) {
  const token = `{{ ${key} }}`
  if (activeField.value === 'title') {
    const input = titleInput.value
    const start = input?.selectionStart ?? source.value.titleTemplate.length
    const end = input?.selectionEnd ?? start
    source.value.titleTemplate = source.value.titleTemplate.slice(0,start)+token+source.value.titleTemplate.slice(end)
    nextTick(() => { input?.focus(); input?.setSelectionRange(start+token.length,start+token.length) })
  } else if (bodyEditor.value) {
    const view = bodyEditor.value, selection = view.state.selection.main
    view.dispatch({changes:{from:selection.from,to:selection.to,insert:token},selection:{anchor:selection.from+token.length}})
    view.focus()
  }
}

async function save() {
  const value = await request('POST', `${base.value}/draft`, {expectedRevision:detail.value.revision,source:clone(source.value)})
  if (!disposed) apply(value)
}
async function act(action, version) {
  if (busy.value || loading.value || testing.value || !detail.value) return
  if (action === 'restore' && hasUnsavedChanges.value && !await confirmDialog.value.ask({ message: tr("恢复历史版本会替换未保存修改，确定继续吗？"), confirmText: tr("继续"), danger: true })) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    if (action === 'draft' || (action === 'publish' && hasUnsavedChanges.value)) await save()
    if (disposed) return
    if (action !== 'draft') {
      const value = await request('POST', `${base.value}/${action}`, {expectedRevision:detail.value.revision,version})
      if (!disposed) apply(value)
    }
    if (!disposed) {
      notice.value = action === 'publish' ? tr("模板已发布，后续领取的通知使用此版本。") : action === 'restore' ? tr("历史版本已恢复为草稿，发布后生效。") : tr("草稿已保存，实际通知继续使用已发布版本。")
      await refreshPreview()
    }
  } catch (e) { if (!disposed) error.value = e.response?.data?.message || e.message || tr("模板操作失败") }
  finally { if (!disposed) busy.value = false }
}
async function reset() {
  if (hasUnsavedChanges.value && !await confirmDialog.value.ask({ message: tr("载入默认模板会替换未保存修改，确定继续吗？"), confirmText: tr("继续"), danger: true })) return
  source.value = clone(detail.value.defaultSource)
}
function restoreVersion(version) {
  return act('restore', version)
}
async function reload() {
  if (hasUnsavedChanges.value && !await confirmDialog.value.ask({ message: tr("重新加载会放弃本地修改，确定继续吗？"), confirmText: tr("放弃修改"), danger: true })) return
  load()
}
onMounted(() => Promise.allSettled([load(),loadChannels()]))
onBeforeUnmount(() => {
  disposed = true
  clearTimeout(timer)
  previewSequence++
  previewAbort?.abort()
  clearTimeout(testTimer)
  testSequence++
  requests.forEach(c => c.abort())
})
</script>

<template>
  <div class="template-workspace min-w-0 w-full space-y-4 p-5">
    <ConfirmDialog ref="confirmDialog" />
    <div class="alert alert-info text-sm alert-soft"><span>{{ providerLabel(provider) }} {{ tr("支持在线模拟预览。此处未接入官方客户端原样预览，字体、主题、链接提示等以实际客户端为准。预览使用固定示例数据，不会发送消息。") }}</span></div>
    <p v-if="error" role="alert" class="alert alert-error">{{ error }} <button v-if="!busy && !loading" class="btn btn-sm" @click="reload">{{ tr("重新加载") }}</button></p>
    <p v-if="notice" role="status" class="alert alert-success">{{ notice }}</p>
    <div class="template-layout grid min-w-0 grid-cols-1 items-start gap-4" :class="externalNavigation ? 'template-layout-external' : '2xl:grid-cols-[220px_minmax(0,1fr)_minmax(320px,0.8fr)]'">
      <aside v-if="!externalNavigation" class="card card-border min-w-0 border-base-300 bg-base-100 p-4">
        <h2 class="font-semibold">{{ tr("通知事件") }}</h2>
        <ul class="menu mt-2 p-0"><li v-for="item in notificationEvents" :key="item.value"><button :disabled="loading || busy || testing" :class="{active:event === item.value}" @click="selectEvent(item.value)">{{ item.label }}</button></li></ul>
        <div class="divider"></div>
        <h2 class="font-semibold">{{ tr("历史版本") }}</h2>
        <div class="mt-2 max-h-96 space-y-2 overflow-auto">
          <div v-for="version in detail?.versions || []" :key="version.version" class="rounded border border-base-300 p-2 text-xs">
            <p>{{ tr("版本") }} {{ version.version }} · {{ {draft:tr("草稿"),published:tr("已发布"),archived:tr("历史")}[version.status] }}</p>
            <p class="mt-1 opacity-60">{{ formatDateTime(version.createdAt) }}</p>
            <button v-if="version.status !== 'draft'" class="btn btn-ghost btn-xs mt-1" :disabled="busy || loading || testing" @click="act('restore',version.version)">{{ tr("恢复为草稿") }}</button>
          </div>
          <p v-if="!detail?.versions?.length" class="text-xs opacity-60">{{ tr("尚未保存，使用内置事件模板。") }}</p>
        </div>
      </aside>
      <main class="card card-border min-w-0 border-base-300 bg-base-100 p-4">
        <div class="flex flex-wrap items-center justify-between gap-2"><h2 class="font-semibold">{{ providerLabel(provider) }} {{ tr("模板 ·") }} {{ status }}</h2><span v-if="detail?.activeVersion" class="text-xs">{{ tr("已发布 v") }}{{ detail.activeVersion }}</span></div>
        <div v-if="loading" class="py-12 text-center"><span class="loading loading-spinner"></span></div>
        <template v-else-if="detail">
          <p v-if="hasUnsavedChanges" class="mt-2 text-xs text-warning">{{ tr("存在未保存修改") }}</p>
          <div class="mt-3 min-w-0 w-full space-y-4">
            <fieldset class="fieldset min-w-0 w-full" :disabled="busy || testing">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-format`">{{ tr("消息格式") }}</label></legend>
              <select :id="`${formFieldId}-format`" v-model="source.format" class="select min-w-0 w-full max-w-full"><option value="text">{{ tr("纯文本") }}</option><option value="html">{{ provider === 'feishu' ? tr("消息卡片（HTML 富文本）") : tr("HTML 富文本") }}</option><option v-if="provider === 'telegram'" value="rich_html">{{ tr("Telegram 富消息（sendRichMessage）") }}</option></select>
            </fieldset>
            <fieldset class="fieldset min-w-0 w-full" :disabled="busy || testing">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-title`">{{ tr("消息标题") }}</label></legend>
              <input :id="`${formFieldId}-title`" ref="titleInput" v-model="source.titleTemplate" @focus="activeField='title'" maxlength="500" class="input min-w-0 w-full max-w-full font-mono" />
            </fieldset>
            <fieldset v-if="externalNavigation && eventVariants.length > 1" class="fieldset min-w-0 w-full" :disabled="busy || testing">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-state`">{{ tr("通知状态") }}</label></legend>
              <select :id="`${formFieldId}-state`" :value="event" class="select min-w-0 w-full max-w-full" @change="selectStateFromDropdown"><option v-for="variant in eventVariants" :key="variant.value" :value="variant.value">{{ variant.label }}</option></select>
            </fieldset>
            <div><div class="mt-1 overflow-hidden rounded-lg border border-base-300"><TemplateCodeEditor v-model="source.bodyTemplate" :variables="detail.variables" :language="source.format === 'text' ? 'text' : 'html'" :disabled="busy || testing" @ready="bodyEditor=$event.view" @focus="activeField='body'" /></div></div>
          </div>
          <p class="mt-2 text-xs opacity-70">{{ tr("支持 Tera 变量和条件。") }}{{ provider === 'feishu' ? tr("飞书富文本自动转换为消息卡片，支持 b 粗体、i 斜体、s 删除线和 a 超链接；u 下划线标签按普通文本显示。告警按级别显示橙色或红色标题，恢复通知使用绿色。") : tr("HTML 富文本支持 b、i、u、s、a 超链接，另支持独立的 code、pre、blockquote 和 tg-spoiler。") }}{{ tr("换行请直接输入换行符。不支持 CSS、图片、自定义卡片 JSON 或任意网页 HTML。") }}</p>
          <p class="mt-2 text-xs opacity-70">{{ tr("标题以纯文本编辑；事件 ID 自动附加。变量内容自动转义。真实消息超过平台限制时会记录投递失败。") }}</p>
          <div class="mt-3 flex flex-wrap gap-2"><button class="btn btn-sm" :disabled="busy || testing" @click="reset">{{ tr("载入默认模板") }}</button><button class="btn btn-sm" :disabled="busy || testing || !hasUnsavedChanges" @click="act('draft')">{{ tr("保存草稿") }}</button><button class="btn btn-neutral btn-sm" :disabled="busy || testing || !canPublish" @click="act('publish')">{{ busy ? tr("处理中…") : tr("发布模板") }}</button></div>
          <section class="mt-5 border-t border-base-300 pt-4">
            <h3 class="font-semibold">{{ tr("测试发送") }}</h3>
            <p class="mt-1 text-xs opacity-60">{{ tr("将当前编辑内容和所选级别的示例数据发送到实际渠道。不保存、不发布，也不使用真实用户数据。同渠道每 30 秒可测试一次。") }}</p>
            <p v-if="channelError" role="alert" class="mt-2 text-sm text-error">{{ channelError }}</p>
            <fieldset class="fieldset mt-3 min-w-0 w-full" :disabled="testing">
              <legend class="fieldset-legend"><label :for="`${formFieldId}-channel`">{{ tr("测试目标") }}</label></legend>
              <select :id="`${formFieldId}-channel`" v-model="channelId" class="select min-w-0 w-full max-w-full"><option disabled value="">{{ tr("请选择已启用渠道") }}</option><option v-for="channel in channels" :key="channel.id" :value="channel.id">{{ channel.name }}</option></select>
            </fieldset>
            <p v-if="!channels.length" class="mt-2 text-xs">{{ tr("没有可用的") }} {{ providerLabel(provider) }} {{ tr("渠道，请在") }} <router-link class="link" to="/setting/notifications">{{ tr("通知渠道") }}</router-link> {{ tr("中配置并启用。") }}</p>
            <div class="mt-3 flex flex-wrap gap-2"><button class="btn btn-neutral btn-sm" :disabled="testing || busy || loading || !channelId" @click="sendTest">{{ testing ? tr("正在提交…") : tr("发送测试消息") }}</button><button class="btn btn-ghost btn-sm" :disabled="testing" @click="loadChannels">{{ tr("刷新渠道") }}</button></div>
            <p v-if="testNotice" role="status" class="mt-3 text-sm">{{ testNotice }}</p>
            <p v-if="testDelivery" class="mt-1 break-all text-xs opacity-60">{{ tr("投递 ID：") }}{{ testDelivery.id }} · {{ {pending:tr("排队中"),sending:tr("发送中"),sent:tr("已发送"),failed:tr("失败"),cancelled:tr("已取消")}[testDelivery.status] || testDelivery.status }}</p>
          </section>
        </template>
      </main>
      <aside class="min-w-0 space-y-4">
        <TemplateVariables v-if="detail" :key="event" :variables="detail.variables || []" :disabled="busy || testing" class="card card-border border-base-300 bg-base-100 p-4" @insert="insertVariable" />
        <section class="card card-border min-w-0 border-base-300 bg-base-100 p-4">
          <div class="flex flex-wrap items-center justify-between gap-2"><h2 class="font-semibold">{{ tr("在线预览") }}</h2><button class="btn btn-ghost btn-sm" :disabled="loading || busy || !detail" @click="refreshPreview">{{ previewing ? tr("渲染中…") : tr("刷新预览") }}</button></div>
          <fieldset class="fieldset mt-3 min-w-0 w-full" :disabled="testing">
            <legend class="fieldset-legend"><label :for="`${formFieldId}-severity`">{{ tr("示例级别") }}</label></legend>
            <select :id="`${formFieldId}-severity`" v-model="sampleSeverity" class="select min-w-0 w-full max-w-full"><option value="warning">{{ tr("警告（warning）") }}</option><option value="critical">{{ tr("严重（critical）") }}</option></select>
          </fieldset>
          <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div class="tabs tabs-box tabs-xs">
              <button v-for="tab in [{value:&#39;rendered&#39;,label:tr(&quot;效果&quot;)},{value:&#39;text&#39;,label:tr(&quot;文本&quot;)},{value:&#39;payload&#39;,label:tr(&quot;消息数据&quot;)}]" :key="tab.value" class="tab" :class="{'tab-active':previewTab===tab.value}" @click="previewTab=tab.value">{{ tab.label }}</button>
            </div>
          </div>
          <p v-if="previewError" role="alert" class="mt-3 text-sm text-error">{{ previewError }}</p>
          <template v-if="preview">
            <iframe v-if="previewTab==='rendered'" :title="tr(&quot;通知模板模拟预览&quot;)" sandbox="" :srcdoc="previewDocument" class="mt-3 h-[540px] w-full rounded border border-base-300 bg-white"></iframe>
            <pre v-else class="mt-3 h-[540px] overflow-auto whitespace-pre-wrap break-all rounded bg-base-200 p-3 text-xs">{{ previewTab==='text' ? preview.textBody : JSON.stringify(preview.payload,null,2) }}</pre>
          </template>
          <p v-else-if="!previewError" class="mt-5 text-sm opacity-60">{{ previewing ? tr("正在使用示例数据渲染…") : tr("编辑后自动预览。") }}</p>
          <p class="mt-3 text-xs opacity-60">{{ tr("模拟预览不加载外部资源，也不会打开链接；实际链接地址可在消息数据中核对。") }}</p>
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
</style>
