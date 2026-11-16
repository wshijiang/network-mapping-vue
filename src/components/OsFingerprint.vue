<script setup>
import { tr } from '../i18n/index.js'

import { computed } from 'vue'
import { osLabel, osConfidence } from '@/utils/osDetection'
import { formatDateTime } from '../i18n/time.js'
import AutoTooltip from '@/components/AutoTooltip.vue'

const props = defineProps({ value: { type: Object, default: null }, compact: { type: Boolean, default: false } })
const label = computed(() => osLabel(props.value))
const confidence = computed(() => osConfidence(props.value))
const compactLabel = computed(() => props.value?.status === 'identified' && props.value?.family ? osLabel(props.value) : '-')
const compactTitle = computed(() => compactLabel.value === '-' ? '' : compactLabel.value + (confidence.value ? ` · ${tr("置信度")}${confidence.value}` : ''))
const evidence = computed(() => props.value?.evidence?.slice(0, 32) || [])
const evidenceTime = computed(() => props.value?.observed_at == null ? '' : formatDateTime(new Date(props.value.observed_at)))
</script>

<template>
  <template v-if="compact">
    <AutoTooltip v-if="compactLabel !== '-'" :content="compactTitle">
      <span class="block truncate text-xs">{{ compactLabel }}</span>
    </AutoTooltip>
    <span v-else class="block text-xs opacity-50">-</span>
  </template>
  <details v-else-if="value" class="min-w-28 text-xs">
    <summary class="cursor-pointer leading-6" :class="value.status === 'conflict' ? 'text-warning' : ''">
      <span>{{ label }}</span>
      <span v-if="confidence" class="ml-1 opacity-60">{{ tr("置信度") }}{{ confidence }}</span>
      <span v-if="value.stale" class="ml-1 text-warning">{{ tr("证据可能过期") }}</span>
    </summary>
    <div class="my-2 max-w-xl space-y-2 rounded-lg border border-base-300 bg-base-200/50 p-3 whitespace-normal">
      <p>{{ value.inference_scope === 'host_estimate' ? tr("根据当前可见服务推测宿主机系统，容器、代理或多个后端可能影响结果。") : tr("这是当前服务运行环境的系统线索。") }}</p>
      <p v-if="value.status === 'pending'">{{ tr("后台正在处理已有服务证据，稍后刷新查看。") }}</p>
      <p v-else-if="value.status === 'conflict'">{{ tr("发现不同系统的返回特征，请结合各端口证据判断。") }}</p>
      <p v-else-if="value.status === 'unknown'">{{ tr("现有返回特征不足以判断系统。") }}</p>
      <p v-if="evidenceTime" class="opacity-60">{{ tr("证据时间：") }}{{ evidenceTime }}</p>
      <ul v-if="evidence.length" class="space-y-2">
        <li v-for="(item, index) in evidence" :key="index" class="border-t border-base-300 pt-2">
          <div>{{ item.port }}/{{ item.module }} · {{ item.rule_id }}</div>
          <pre class="mt-1 whitespace-pre-wrap break-all font-mono">{{ item.excerpt }}</pre>
          <div class="mt-1 break-all opacity-60">{{ item.field_path }}</div>
          <div v-if="item.observation_ref" class="break-all opacity-60">{{ tr("观察记录：") }}{{ item.observation_ref }}</div>
        </li>
      </ul>
      <p class="opacity-50">{{ tr("规则版本：") }}{{ value.ruleset_version }}{{ tr("；置信度为规则分级。") }}</p>
    </div>
  </details>
  <span v-else class="text-xs opacity-50">{{ label }}</span>
</template>
