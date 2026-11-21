<script setup>
import { tr } from '../i18n/index.js'

import { computed, nextTick, reactive, ref } from 'vue'
import MailTemplateEditor from './MailTemplateEditor.vue'
import BotTemplateEditor from './BotTemplateEditor.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { notificationProviders } from '@/utils/notifications'
import { formatDateTime } from '../i18n/time.js'

const provider = ref('email')
const editor = ref(null)
const confirmDialog = ref(null)
const mailTemplates = ref([])
const eventDefinitions = [
  { value: 'login_success', get label() { return tr("登录成功") }, botEvents: ['user.login'] },
  { value: 'health_alert', get label() { return tr("健康告警") }, botEvents: ['health.alert'] },
  { value: 'scanner_outage', get label() { return tr("扫描器掉线与恢复") }, botEvents: ['scanner.offline', 'scanner.recovered'] },
  { value: 'report_weekly', get label() { return tr("平台周报") }, botEvents: ['report.weekly'] },
  { value: 'report_monthly', get label() { return tr("平台月报") }, botEvents: ['report.monthly'] },
]
const selectedEvent = ref(eventDefinitions[0].value)
const botSelections = reactive({ feishu: 'user.login', telegram: 'user.login' })
const switching = ref(false)
const navigationDisabled = computed(() => switching.value || Boolean(editor.value?.busy))
const historyVersions = computed(() => editor.value?.versions || [])
const historyLoading = computed(() => switching.value || !editor.value || Boolean(editor.value.loading))
const events = computed(() => eventDefinitions.map(item => {
  const mail = mailTemplates.value.find(template => template.templateKey === item.value)
  return { ...item, label: mail?.displayName || item.label, hasDraft: provider.value === 'email' && mail?.hasDraft }
}))
const activeEvent = computed(() => events.value.find(item => item.value === selectedEvent.value))
const initialBotEvent = computed(() => activeEvent.value.botEvents.includes(botSelections[provider.value])
  ? botSelections[provider.value]
  : activeEvent.value.botEvents[0])
const botVariants = computed(() => activeEvent.value.botEvents.length > 1 ? activeEvent.value.botEvents.map(value => ({
  value,
  label: value === 'scanner.recovered' ? tr("恢复") : tr("掉线"),
})) : [])

function syncSelection(value) {
  const item = eventDefinitions.find(item => provider.value === 'email'
    ? item.value === value
    : item.botEvents.includes(value))
  if (!item) return
  selectedEvent.value = item.value
  if (provider.value !== 'email') botSelections[provider.value] = value
}

async function selectProvider(value) {
  if (value === provider.value || navigationDisabled.value || !notificationProviders.some(item => item.value === value)) return
  switching.value = true
  try {
    if (editor.value?.hasUnsavedChanges && !await confirmDialog.value.ask({ message: tr("当前模板有未保存修改，确定切换通知渠道吗？"), confirmText: tr("放弃修改"), danger: true })) return
    provider.value = value
    await nextTick()
  } finally {
    switching.value = false
  }
}
async function selectEvent(value) {
  if (value === selectedEvent.value || navigationDisabled.value) return
  const item = events.value.find(item => item.value === value)
  if (!item) return
  switching.value = true
  try {
    if (provider.value === 'email') await editor.value?.selectTemplate(value)
    else await editor.value?.selectEvent(item.botEvents[0])
  } finally {
    switching.value = false
  }
}
async function selectProviderFromDropdown(event) {
  await selectProvider(event.target.value)
  event.target.value = provider.value
}
async function selectEventFromDropdown(event) {
  await selectEvent(event.target.value)
  event.target.value = selectedEvent.value
}
async function restoreVersion(version) {
  if (navigationDisabled.value || !historyVersions.value.some(item => item.version === version && item.status !== 'draft')) return
  switching.value = true
  try {
    await editor.value?.restoreVersion(version)
  } finally {
    switching.value = false
  }
}
</script>

<template>
  <div class="page-shell">
    <ConfirmDialog ref="confirmDialog" />
    <div class="mb-4">
      <h1 class="page-title">{{ tr("通知模板") }}</h1>
      <p class="mt-1 text-xs opacity-60">{{ tr("分别配置邮件、飞书和 Telegram 的模板。各渠道独立保存和发布，同类渠道共用对应事件的已发布模板。") }}</p>
    </div>
    <div class="grid min-w-0 items-start gap-5 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav :aria-label="tr(&quot;通知模板分类&quot;)" class="card card-border min-w-0 border-base-300 bg-base-100 p-3 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
        <fieldset class="fieldset min-w-0 w-full lg:hidden">
          <legend class="fieldset-legend"><label for="notification-template-provider">{{ tr("通知模板") }}</label></legend>
          <select id="notification-template-provider" :value="provider" class="select min-w-0 w-full max-w-full" :disabled="navigationDisabled" @change="selectProviderFromDropdown">
            <option v-for="item in notificationProviders" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </fieldset>
        <ul class="menu provider-menu hidden w-full p-0 lg:flex">
          <li class="menu-title">{{ tr("通知模板") }}</li>
          <li v-for="item in notificationProviders" :key="item.value">
            <button type="button" :class="{ 'menu-active': provider === item.value }" :aria-current="provider === item.value ? 'true' : undefined" :disabled="navigationDisabled" @click="selectProvider(item.value)">{{ item.label }}</button>
          </li>
        </ul>
        <div class="divider my-2" role="separator"></div>
        <fieldset class="fieldset min-w-0 w-full lg:hidden">
          <legend class="fieldset-legend"><label for="notification-template-event">{{ tr("通知事件") }}</label></legend>
          <select id="notification-template-event" :value="selectedEvent" class="select min-w-0 w-full max-w-full" :disabled="navigationDisabled" @change="selectEventFromDropdown">
            <option v-for="item in events" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </fieldset>
        <ul class="menu provider-menu hidden w-full p-0 lg:flex">
          <li class="menu-title">{{ tr("通知事件") }}</li>
          <li v-for="item in events" :key="item.value">
            <button type="button" class="flex min-w-0 justify-between gap-2" :class="{ 'menu-active': selectedEvent === item.value }" :aria-current="selectedEvent === item.value ? 'true' : undefined" :disabled="navigationDisabled" @click="selectEvent(item.value)">
              <span class="min-w-0">{{ item.label }}</span>
              <span v-if="selectedEvent === item.value && editor?.hasUnsavedChanges" class="badge badge-warning badge-xs shrink-0">{{ tr("未保存") }}</span>
              <span v-else-if="item.hasDraft" class="badge badge-warning badge-xs shrink-0">{{ tr("草稿") }}</span>
            </button>
          </li>
        </ul>
        <div class="divider my-2" role="separator"></div>
        <section aria-labelledby="notification-template-history" class="min-w-0">
          <h2 id="notification-template-history" class="menu-title px-3">{{ tr("历史版本") }}</h2>
          <p v-if="historyLoading" class="px-3 py-3 text-xs opacity-60" role="status">{{ tr("正在读取历史版本…") }}</p>
          <div v-else-if="historyVersions.length" class="max-h-64 space-y-2 overflow-y-auto overscroll-contain px-1" tabindex="0" :aria-label="tr(&quot;模板历史版本列表&quot;)">
            <div v-for="version in historyVersions" :key="version.version" class="min-w-0 rounded-lg border border-base-300 p-2 text-xs">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="font-medium">{{ tr("版本") }} {{ version.version }}</span>
                <span class="badge badge-xs" :class="version.status === 'published' ? 'badge-success' : version.status === 'draft' ? 'badge-warning' : 'badge-ghost'">{{ {draft:tr("草稿"),published:tr("已发布"),archived:tr("历史")}[version.status] || tr("历史") }}</span>
              </div>
              <p class="mt-1 break-all opacity-60">{{ formatDateTime(version.updateAt || version.createdAt || version.createAt) }}</p>
              <button v-if="version.status !== 'draft'" type="button" class="btn btn-ghost btn-xs mt-2 w-full" :disabled="navigationDisabled" @click="restoreVersion(version.version)">{{ tr("恢复为草稿") }}</button>
            </div>
          </div>
          <p v-else class="px-3 py-3 text-xs opacity-60">{{ tr("尚无历史版本，当前使用内置模板。") }}</p>
        </section>
      </nav>
      <section class="template-editor min-w-0" :aria-label="tr(&quot;模板编辑器&quot;)">
        <MailTemplateEditor v-if="provider === 'email'" ref="editor" external-navigation :initial-template-key="selectedEvent" @templates-loaded="mailTemplates = $event" @selected="syncSelection" />
        <BotTemplateEditor v-else :key="provider" ref="editor" :provider="provider" external-navigation :initial-event="initialBotEvent" :event-variants="botVariants" @selected="syncSelection" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.provider-menu {
  --menu-active-bg: color-mix(in oklab, var(--color-base-content) 10%, transparent);
  --menu-active-fg: var(--color-base-content);
}

.template-editor > :deep(.p-5) {
  padding: 0;
}
</style>
