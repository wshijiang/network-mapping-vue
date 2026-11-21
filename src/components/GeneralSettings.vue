<script setup>
import { tr } from '../i18n/index.js'

import { computed, nextTick, onMounted, onBeforeUnmount, ref, useId, watch } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import http from '@/utils/http'
import { applyTimeSettings, offsetLabel } from '../i18n/time.js'

const formFieldId = useId()
const emit = defineEmits(['dirty'])
const document = ref({ timezone: 'Asia/Shanghai', hourCycle: '24', dateFormat: 'YYYY-MM-DD' })
const saved = ref(null)
const revision = ref(0)
const timezones = ref([])
const search = ref('')
const timezoneDropdown = ref(null)
const timezoneTrigger = ref(null)
const timezoneSearch = ref(null)
const timezoneOpen = ref(false)
const activeOption = ref(-1)
const timezoneListId = `timezone-list-${useId()}`
const loading = ref(true)
const failed = ref(false)
const saving = ref(false)
const alert = ref(null)
const now = ref(Date.now())
let clockTimer
const dirty = computed(() => saved.value !== null && JSON.stringify(document.value) !== JSON.stringify(saved.value))
watch(dirty, (value) => emit('dirty', value))
const labels = { get 'Asia/Shanghai'() { return tr("中国大陆") }, get 'Asia/Hong_Kong'() { return tr("中国香港") }, get 'Asia/Macau'() { return tr("中国澳门") }, get 'Asia/Taipei'() { return tr("中国台湾") }, get UTC() { return tr("协调世界时") }, get 'Asia/Tokyo'() { return tr("日本") }, get 'Asia/Singapore'() { return tr("新加坡") }, get 'America/New_York'() { return tr("美国纽约") }, get 'Europe/London'() { return tr("英国伦敦") } }
function label(zone) {
  return `${labels[zone.id] ? `${labels[zone.id]} · ` : ''}${zone.id} · ${offsetLabel(zone.offsetSeconds * 1000)}`
}
const options = computed(() => timezones.value.filter((zone) => label(zone).toLowerCase().includes(search.value.trim().toLowerCase())))
const selected = computed(() => timezones.value.find((zone) => zone.id === document.value.timezone))
// 当前是否处于夏令时：与同年 1/7 月偏移的较小值（标准时）比较。
// 无夏令时的时区返回 null，界面不显示任何冬夏令时字样。
const dstState = computed(() => {
  if (!selected.value?.observesDst) return null
  try {
    const offsetAt = (date) => {
      const name = new Intl.DateTimeFormat('en-US', { timeZone: document.value.timezone, timeZoneName: 'longOffset' })
        .formatToParts(date).find((part) => part.type === 'timeZoneName')?.value || 'GMT'
      const match = name.match(/GMT([+-])(\d{2}):?(\d{2})?/)
      if (!match) return 0
      const minutes = Number(match[2]) * 60 + Number(match[3] || 0)
      return match[1] === '-' ? -minutes : minutes
    }
    const current = new Date(now.value)
    const year = current.getUTCFullYear()
    const standard = Math.min(offsetAt(new Date(Date.UTC(year, 0, 1))), offsetAt(new Date(Date.UTC(year, 6, 1))))
    return offsetAt(current) > standard ? 'summer' : 'winter'
  } catch {
    return null
  }
})
function resetActiveOption() {
  const selectedIndex = options.value.findIndex((zone) => zone.id === document.value.timezone)
  activeOption.value = selectedIndex >= 0 ? selectedIndex : options.value.length ? 0 : -1
}
function scrollActiveOption() {
  nextTick(() => timezoneDropdown.value?.querySelector(`[data-option-index="${activeOption.value}"]`)?.scrollIntoView({ block: 'nearest' }))
}
watch(search, () => { resetActiveOption(); scrollActiveOption() })
async function openTimezone() {
  if (saving.value) return
  search.value = ''
  resetActiveOption()
  timezoneOpen.value = true
  await nextTick()
  timezoneSearch.value?.focus()
  scrollActiveOption()
}
function closeTimezone(restoreFocus = false) {
  timezoneOpen.value = false
  if (restoreFocus) timezoneTrigger.value?.focus()
}
function selectTimezone(zone) {
  document.value.timezone = zone.id
  closeTimezone(true)
}
function timezoneKeydown(event) {
  if (event.isComposing) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeTimezone(true)
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!options.value.length) return
    const step = event.key === 'ArrowDown' ? 1 : -1
    activeOption.value = (activeOption.value + step + options.value.length) % options.value.length
    scrollActiveOption()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    if (options.value[activeOption.value]) selectTimezone(options.value[activeOption.value])
  }
}
function timezoneFocusout(event) {
  if (!timezoneDropdown.value?.contains(event.relatedTarget)) closeTimezone()
}
function timezonePointerdown(event) {
  if (!timezoneDropdown.value?.contains(event.target)) closeTimezone()
}
watch(saving, (value) => { if (value) closeTimezone() })
const preview = computed(() => {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: document.value.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now.value).map(({ type, value }) => [type, value]))
    const date = document.value.dateFormat === 'DD/MM/YYYY' ? `${parts.day}/${parts.month}/${parts.year}` : [parts.year, parts.month, parts.day].join(document.value.dateFormat === 'YYYY/MM/DD' ? '/' : '-')
    const time = new Intl.DateTimeFormat('zh-CN', { timeZone: document.value.timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: document.value.hourCycle === '12' ? 'h12' : 'h23' }).format(now.value)
    return `${date} ${time}`
  } catch { return tr("请选择有效时区") }
})
function apply(data) {
  document.value = { ...data.document }
  saved.value = { ...data.document }
  revision.value = data.revision
}
async function load() {
  loading.value = true
  failed.value = false
  try {
    const [settings, zones] = await Promise.all([http.get('/api/config/runtime/general'), http.get('/api/system/timezones')])
    if (!settings.data?.success || !zones.data?.success) throw new Error(tr("时区设置加载失败"))
    apply(settings.data.data)
    timezones.value = zones.data.data.filter((zone) => {
      try { new Intl.DateTimeFormat('en', { timeZone: zone.id }); return true } catch { return false }
    })
  } catch (e) {
    failed.value = true
    alert.value = { type: 'error', get title() { return tr("时区设置加载失败") }, description: e.response?.data?.message || tr("请稍后重试。") }
  } finally { loading.value = false }
}
async function save() {
  if (saving.value || loading.value || failed.value) return false
  if (!dirty.value) return true
  saving.value = true
  try {
    const response = await http.post('/api/config/runtime/general', { expectedRevision: revision.value, document: document.value, get changeReason() { return tr("更新系统时区设置") } })
    if (!response.data?.success) throw new Error(tr("服务器未确认保存成功"))
    apply(response.data.data)
    applyTimeSettings(response.data.data)
    alert.value = { type: 'success', get title() { return tr("时区设置已保存") }, get description() { return tr("页面时间、统计、邮件及未来报告计划将使用所选时区，历史报告保留原时区。") } }
    return true
  } catch (e) {
    alert.value = { type: 'error', get title() { return tr("时区设置保存失败") }, description: e.response?.data?.message || e.message }
    return false
  } finally { saving.value = false }
}
defineExpose({ save })
onMounted(() => {
  load()
  clockTimer = window.setInterval(() => { now.value = Date.now() }, 1000)
  window.addEventListener('pointerdown', timezonePointerdown)
})
onBeforeUnmount(() => {
  window.clearInterval(clockTimer)
  window.removeEventListener('pointerdown', timezonePointerdown)
})
</script>

<template>
  <div class="card bg-base-100 card-border border-base-300 p-4">
    <div class="mb-3 flex items-start justify-between gap-3">
      <div><h3 class="font-semibold">{{ tr("时区设置") }}</h3><p class="mt-1 text-xs opacity-60">{{ tr("统一系统时间显示、统计周期、邮件时间和报告计划。") }}</p></div>
      <button class="btn btn-neutral btn-sm rounded-lg" :class="dirty ? 'visible' : 'invisible'" :disabled="!dirty || loading || saving || failed" @click="save"><span v-if="saving" class="loading loading-spinner loading-xs" />{{ saving ? tr("保存中") : tr("保存") }}</button>
    </div>
    <AppAlert v-if="alert" v-bind="alert" @close="alert = null" />
    <div v-if="loading" class="flex items-center gap-2 py-3 text-sm opacity-60"><span class="loading loading-spinner loading-sm" />{{ tr("正在读取时区设置...") }}</div>
    <div v-else-if="failed" class="alert alert-error"><span>{{ tr("无法读取设置") }}</span><button class="btn btn-sm" @click="load">{{ tr("重新加载") }}</button></div>
    <fieldset v-else :disabled="saving" class="grid gap-4 md:grid-cols-2">
      <fieldset class="fieldset min-w-0 w-full md:col-span-2">
        <legend class="fieldset-legend"><label :for="`${timezoneListId}-trigger`">{{ tr("系统时区") }}</label></legend>
        <div ref="timezoneDropdown" class="dropdown w-full" :class="timezoneOpen ? 'dropdown-open' : 'dropdown-close'" @focusout="timezoneFocusout">
          <button
            :id="`${timezoneListId}-trigger`"
            ref="timezoneTrigger"
            type="button"
            class="select select-bordered w-full min-w-0 max-w-full text-left"
            :aria-label="tr(&quot;系统时区&quot;)"
            aria-haspopup="listbox"
            :aria-expanded="timezoneOpen"
            :aria-controls="timezoneListId"
            @click="timezoneOpen ? closeTimezone() : openTimezone()"
            @keydown.down.prevent="openTimezone"
            @keydown.up.prevent="openTimezone"
            @keydown.esc.prevent="closeTimezone(true)"
          ><span class="block min-w-0 truncate">{{ selected ? label(selected) : document.timezone }}</span></button>
          <div v-if="timezoneOpen" class="dropdown-content z-30 mt-2 w-full max-w-full rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
            <input
              ref="timezoneSearch"
              v-model="search"
              type="search"
              class="input input-bordered mb-2 w-full"
              :placeholder="tr(&quot;搜索地区、时区或 UTC 偏移&quot;)"
              :aria-label="tr(&quot;搜索时区&quot;)"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              :aria-controls="timezoneListId"
              :aria-activedescendant="activeOption >= 0 ? `${timezoneListId}-${activeOption}` : undefined"
              @keydown="timezoneKeydown"
            />
            <ul :id="timezoneListId" role="listbox" :aria-label="tr(&quot;时区选项&quot;)" class="max-h-64 overflow-y-auto">
              <li
                v-for="(zone, index) in options"
                :id="`${timezoneListId}-${index}`"
                :key="zone.id"
                role="option"
                :aria-selected="zone.id === document.timezone"
                :data-option-index="index"
                class="cursor-pointer rounded-lg px-3 py-2 text-sm break-words hover:bg-base-200"
                :class="{ 'bg-base-200': index === activeOption, 'font-semibold': zone.id === document.timezone }"
                @pointerdown.prevent
                @click="selectTimezone(zone)"
                @mousemove="activeOption = index"
              >{{ label(zone) }}</li>
            </ul>
            <p v-if="!options.length" role="status" class="px-3 py-4 text-sm text-base-content/60">{{ tr("没有匹配的时区，请尝试其他关键词。") }}</p>
          </div>
        </div>
      </fieldset>
      <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-1`">{{ tr("时间制式") }}</label></legend><select :id="`${formFieldId}-1`" v-model="document.hourCycle" class="select select-bordered w-full"><option value="24">{{ tr("24 小时制") }}</option><option value="12">{{ tr("12 小时制") }}</option></select></fieldset>
      <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-2`">{{ tr("日期格式") }}</label></legend><select :id="`${formFieldId}-2`" v-model="document.dateFormat" class="select select-bordered w-full"><option value="YYYY-MM-DD">YYYY-MM-DD</option><option value="YYYY/MM/DD">YYYY/MM/DD</option><option value="DD/MM/YYYY">DD/MM/YYYY</option></select></fieldset>
      <div class="min-w-0 text-xs leading-5 opacity-60 md:col-span-2">
        <p class="flex flex-wrap items-center gap-x-1 gap-y-1 break-words">{{ tr("当前时间预览：") }}<span class="font-mono tabular-nums">{{ preview }} · {{ document.timezone }}</span>
          <Transition name="dst-badge">
            <span v-if="dstState" class="badge badge-outline badge-sm">{{ dstState === 'summer' ? tr("夏令时") : tr("冬令时") }}</span>
          </Transition>
        </p>
        <p v-if="selected?.observesDst">{{ tr("此时区按日期自动处理夏令时；遇到重复时间时需选择 UTC 偏移。") }}</p>
        <p>{{ tr("偏移显示为当前日期的偏移。切换时区会重新安排未来报告计划；旧统计缺少原始观测时间时，需先重建分析快照。") }}</p>
      </div>
    </fieldset>
  </div>
</template>

<style scoped>
.dst-badge-enter-active,
.dst-badge-leave-active {
  transition: opacity 150ms ease, transform 150ms ease;
}
.dst-badge-enter-from,
.dst-badge-leave-to {
  opacity: 0;
  transform: scale(0.9);
}
@media (prefers-reduced-motion: reduce) {
  .dst-badge-enter-active,
  .dst-badge-leave-active {
    transition: none;
  }
}
</style>
