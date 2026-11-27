<script setup>
import { computed, ref, watch } from 'vue'
import { Bolt, ChevronDown, ChevronsUpDown, ChevronUp } from '@lucide/vue'
import { tr } from '../i18n/index.js'
import { formatDate, timeSettings, timezoneOffsetLabel } from '../i18n/time.js'
import { formatLocation } from '@/utils/location'
import { originLabel } from '@/utils/federation.js'
import { certificateStatus, formatNetworkOwner } from '@/utils/searchFormat'
import { useTableSort } from '@/composables/useTableSort'
import { useColumnResize } from '@/composables/useColumnResize'
import { useColumnVisibility } from '@/composables/useColumnVisibility'
import ColumnSettingsModal from '@/components/ColumnSettingsModal.vue'
import ServiceLabel from '@/components/ServiceLabel.vue'
import AssetTags from '@/components/AssetTags.vue'
import IntelEvidence from '@/components/IntelEvidence.vue'
import OsFingerprint from '@/components/OsFingerprint.vue'
import TechStackCell from '@/components/TechStackCell.vue'
import CellText from '@/components/CellText.vue'
import AutoTooltip from '@/components/AutoTooltip.vue'
import AssetFavicon from '@/components/AssetFavicon.vue'

const props = defineProps({
  items: { type: Array, required: true },
})

// Single source of truth for <colgroup> and <thead>. `natural` columns (port,
// protocol, tech, scan time) keep a predictable width; the rest measure their
// content and compete for surplus space, so overflowing columns widen while
// sparse ones stay compact. Every minimum fits the header label plus chevron.
// computed 而非 setup 常量：tr() 读取响应式 locale，语言切换时表头随页面更新。
const columns = computed(() => [
  { key: 'ip', label: 'IP', default: 170, min: 140 },
  { key: 'port', label: tr("端口"), default: 80, min: 80, natural: true },
  { key: 'protocol', label: tr("协议"), default: 84, min: 84, natural: true },
  { key: 'service', label: tr("服务"), default: 110, min: 96 },
  { key: 'banner', label: 'Banner', default: 160, min: 110 },
  { key: 'os', label: tr("系统线索"), default: 140, min: 112 },
  { key: 'tech', label: tr("技术栈"), default: 180, min: 160, natural: true },
  { key: 'web', label: tr("网页 / TLS"), default: 200, min: 130 },
  { key: 'asn', label: tr("ASN / AS 组织"), default: 160, min: 150 },
  { key: 'location', label: tr("位置"), default: 130, min: 96 },
  { key: 'scan_time', label: tr("扫描时间"), default: 168, min: 160, natural: true },
])

// 列显隐记忆不过期；表头末尾的内嵌 Bolt 按钮打开管理 modal。
const { hiddenKeys, visibleColumns, isDefault, toggle, reset } = useColumnVisibility('network_mapping_search_column_visibility', columns)
const settingsOpen = ref(false)
const columnSettingsRef = ref(null)
function openSettings() {
  settingsOpen.value = true
  columnSettingsRef.value?.open()
}

// 设置按钮绝对定位嵌在最后一个表头单元格内，不单独占列宽，避免挤压数据列。
const lastVisibleKey = computed(() => visibleColumns.value.at(-1)?.key)
const wrapper = ref(null)
const { widths, totalWidth, needsScroll, userResized, refresh, onPointerDown, onKeydown, resetColumn, resetAll } = useColumnResize(visibleColumns, wrapper)
const itemsRef = computed(() => props.items)
const { pageSort, displayItems, toggle: toggleSort } = useTableSort(itemsRef)
watch(itemsRef, () => refresh())
watch(visibleColumns, () => refresh())

function sortIcon(key) {
  if (pageSort.value.key !== key) return ChevronsUpDown
  return pageSort.value.direction === 1 ? ChevronUp : ChevronDown
}
function sortState(key) {
  if (pageSort.value.key !== key) return 'none'
  return pageSort.value.direction === 1 ? 'asc' : 'desc'
}
function ariaSort(key) {
  if (pageSort.value.key !== key) return 'none'
  return pageSort.value.direction === 1 ? 'ascending' : 'descending'
}
function rowKey(item) {
  return `${item.ip_address}-${item.port}-${item.protocol}-${item.scan_time}`
}
</script>

<template>
  <div>
    <div v-if="userResized" class="mb-2 flex justify-end">
      <button type="button" class="btn btn-ghost btn-xs" @click="resetAll">{{ tr("重置列宽") }}</button>
    </div>
    <div ref="wrapper" :class="needsScroll ? 'overflow-x-auto overflow-y-clip' : 'overflow-visible'">
      <table class="table table-zebra table-sm table-fixed" :style="{ width: `${totalWidth}px` }">
        <colgroup>
          <col v-for="column in visibleColumns" :key="column.key" :style="{ width: `${widths[column.key] ?? column.default}px` }">
        </colgroup>
        <thead>
          <tr>
            <th v-for="column in visibleColumns" :key="column.key" class="relative" :aria-sort="ariaSort(column.key)">
              <button type="button" class="flex w-full items-center gap-1 overflow-hidden" :class="column.key === lastVisibleKey ? 'pr-7' : ''" @click="toggleSort(column.key)">
                <span class="truncate">{{ column.label }}</span>
                <Transition name="sort-chevron" mode="out-in">
                  <component :is="sortIcon(column.key)" :key="sortState(column.key)" class="size-3.5 shrink-0" aria-hidden="true" />
                </Transition>
              </button>
              <span
                class="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none touch-none"
                role="separator"
                aria-orientation="vertical"
                :tabindex="0"
                :aria-label="tr(&quot;调整列宽&quot;)"
                @pointerdown.prevent="onPointerDown($event, column.key)"
                @dblclick="resetColumn(column.key)"
                @keydown="onKeydown($event, column.key)"
              ></span>
              <button
                v-if="column.key === lastVisibleKey"
                type="button"
                class="btn btn-ghost btn-xs btn-square absolute right-2 top-1/2 -translate-y-1/2"
                :aria-label="tr(&quot;管理显示列&quot;)"
                :title="tr(&quot;管理显示列&quot;)"
                :aria-expanded="settingsOpen"
                @click="openSettings"
              >
                <Bolt class="size-4 transition-transform duration-300 ease-out" :class="settingsOpen ? 'rotate-180' : ''" aria-hidden="true" />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in displayItems" :key="rowKey(item)">
            <template v-for="column in visibleColumns" :key="column.key">
              <td v-if="column.key === 'ip'">
                <div class="space-y-1">
                  <AutoTooltip :content="item.ip_address">
                    <a class="link block truncate font-mono" :href="`/asset.html?ip=${encodeURIComponent(item.ip_address)}`" target="_blank" rel="noopener noreferrer">{{ item.ip_address }}</a>
                  </AutoTooltip>
                  <div v-if="(item.tags || []).length || item.intel || originLabel(item)" class="flex flex-wrap items-center gap-1">
                    <AssetTags :tags="item.tags || []" :limit="3" size="xs" />
                    <IntelEvidence :intel="item.intel" :label="tr(&quot;端点情报&quot;)" />
                    <span v-if="originLabel(item)" class="badge badge-outline badge-xs" :title="(item.federation_sources || []).join(', ')">{{ originLabel(item) }}</span>
                  </div>
                </div>
              </td>
              <td v-else-if="column.key === 'port'">{{ item.port ?? '-' }}</td>
              <td v-else-if="column.key === 'protocol'">{{ item.protocol ?? '-' }}</td>
              <td v-else-if="column.key === 'service'" class="service-cell"><ServiceLabel :service="item.service" :data="item.data" :products="item.products || []" :identification="item.product_identification" /></td>
              <td v-else-if="column.key === 'banner'"><CellText :text="item.banner ?? '-'" /></td>
              <td v-else-if="column.key === 'os'"><OsFingerprint compact :value="item.os" /></td>
              <td v-else-if="column.key === 'tech'"><TechStackCell :web="item.web" /></td>
              <td v-else-if="column.key === 'web'">
                <div v-if="item.title || item.tls_subject || item.tls_version || item.favicon" class="space-y-1">
                  <div class="flex items-center gap-1.5">
                    <AssetFavicon v-if="item.favicon" :ip="item.ip_address" :port="item.port" :protocol="item.protocol" :icon-md5="item.icon_md5" :size="16" />
                    <AutoTooltip v-if="item.title" :content="item.title">
                      <div class="truncate font-medium">{{ item.title }}</div>
                    </AutoTooltip>
                  </div>
                  <div v-if="certificateStatus(item)" class="flex flex-wrap items-center gap-1">
                    <span class="badge badge-sm" :class="certificateStatus(item).class">{{ certificateStatus(item).text }}</span>
                    <span v-if="item.tls_mode" class="badge badge-ghost badge-sm">{{ item.tls_mode }}</span>
                  </div>
                  <AutoTooltip v-if="item.tls_subject" :content="item.tls_subject">
                    <div class="truncate font-mono text-xs opacity-70">{{ item.tls_subject }}</div>
                  </AutoTooltip>
                </div>
                <span v-else>-</span>
              </td>
              <td v-else-if="column.key === 'asn'"><CellText :text="formatNetworkOwner(item)" /></td>
              <td v-else-if="column.key === 'location'"><CellText :text="formatLocation(item)" /></td>
              <td v-else-if="column.key === 'scan_time'" class="whitespace-nowrap">
                <span v-if="item.scan_time" class="inline-flex items-center gap-1">
                  {{ formatDate(item.scan_time) }}
                  <AutoTooltip :content="timeSettings.timezone">
                    <span class="badge badge-ghost badge-xs">{{ timezoneOffsetLabel(item.scan_time) }}</span>
                  </AutoTooltip>
                </span>
                <span v-else>-</span>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
    <ColumnSettingsModal
      ref="columnSettingsRef"
      :columns="columns"
      :hidden-keys="hiddenKeys"
      :is-default="isDefault"
      @toggle="toggle"
      @reset="reset"
      @close="settingsOpen = false"
    />
  </div>
</template>

<style scoped>
/* Keep the industrial-protocol evidence panel from stretching a fixed column:
   overlay it instead of letting min-w-48 widen the table. Detail pages are
   unaffected (this style is scoped to the search table). */
.service-cell {
  position: relative;
}
.service-cell :deep(details > div) {
  position: absolute;
  z-index: 30;
  left: 0;
  top: 100%;
  min-width: 12rem;
  max-width: 20rem;
}

.sort-chevron-enter-active,
.sort-chevron-leave-active {
  transition: opacity 150ms ease, transform 150ms ease;
}
.sort-chevron-enter-from {
  opacity: 0;
  transform: translateY(2px);
}
.sort-chevron-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}
@media (prefers-reduced-motion: reduce) {
  .sort-chevron-enter-active,
  .sort-chevron-leave-active {
    transition: none;
  }
}
</style>
