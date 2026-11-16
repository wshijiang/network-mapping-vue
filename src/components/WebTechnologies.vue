<script setup>
import { tr } from '../i18n/index.js'

import { computed } from 'vue'
import { webLabel } from '@/utils/webDetection'
import { formatDateTime } from '../i18n/time.js'
import WebTechnologyLabel from '@/components/WebTechnologyLabel.vue'

const props = defineProps({ value: { type: Object, default: null }, compact: { type: Boolean, default: false } })
const label = computed(() => webLabel(props.value))
const technologies = computed(() => ['identified', 'partial'].includes(props.value?.status) && Array.isArray(props.value?.technologies) ? props.value.technologies.slice(0, 64) : [])
const confidence = { get high() { return tr("高") }, get medium() { return tr("中") }, get low() { return tr("低") } }
const usage = { get referenced_resource() { return tr("页面引用资源") }, get response_marker() { return tr("响应特征") }, get multiple_evidence_types() { return tr("多种证据") } }
</script>

<template>
  <template v-if="compact">
    <span v-if="technologies.length" class="flex flex-wrap items-center gap-2 text-xs">
      <WebTechnologyLabel v-for="technology in technologies" :key="technology.id" :technology="technology" />
    </span>
    <span v-else class="text-xs opacity-50">-</span>
  </template>
  <details v-else-if="value && value.status !== 'not_web'" class="min-w-32 text-xs">
    <summary class="cursor-pointer leading-6">
      <span v-if="technologies.length" class="inline-flex flex-wrap items-center gap-x-2 gap-y-1 align-middle">
        <WebTechnologyLabel v-for="technology in technologies.slice(0, 3)" :key="technology.id" :technology="technology" />
        <span v-if="technologies.length > 3">{{ tr("等") }} {{ technologies.length }} {{ tr("项") }}</span>
      </span>
      <span v-else>{{ label }}</span>
      <span v-if="value.status === 'partial' && technologies.length" class="ml-1 text-warning">{{ tr("证据不完整") }}</span>
      <span v-if="value.stale" class="ml-1 text-warning">{{ tr("证据可能过期") }}</span>
    </summary>
    <div class="my-2 max-w-xl space-y-2 rounded-lg border border-base-300 bg-base-200/50 p-3 whitespace-normal">
      <p>{{ tr("根据扫描时该 IP 端点的 HTTP 响应识别；域名虚拟主机和隐藏依赖可能具有不同的技术栈。") }}</p>
      <p v-if="value.status === 'pending'">{{ tr("后台正在处理已有证据，稍后刷新查看。") }}</p>
      <p v-else-if="value.status === 'unsupported'">{{ tr("当前证据格式暂不支持识别。") }}</p>
      <p v-else-if="!technologies.length">{{ tr("现有证据不足以识别框架或组件。") }}</p>
      <p v-if="value.truncated" class="text-warning">{{ tr("采集或解析存在截断，结果可能不完整。") }}</p>
      <p v-if="value.observed_at != null" class="opacity-60">{{ tr("证据时间：") }}{{ formatDateTime(new Date(value.observed_at)) }}</p>
      <ul v-if="technologies.length" class="space-y-3">
        <li v-for="technology in technologies" :key="technology.id" class="border-t border-base-300 pt-2">
          <p class="font-medium"><WebTechnologyLabel :technology="technology" /> <span class="font-normal opacity-60">{{ tr("置信度") }}{{ confidence[technology.confidence] || technology.confidence }} · {{ usage[technology.usage] || technology.usage }}</span></p>
          <p v-if="technology.version_conflict" class="text-warning">{{ tr("存在多个版本线索，请查看证据。") }}</p>
          <div v-for="(item, index) in technology.evidence?.slice(0, 8) || []" :key="index" class="mt-2">
            <div class="opacity-60">{{ item.module }} · {{ item.rule_id }}</div>
            <pre class="whitespace-pre-wrap break-all font-mono">{{ item.excerpt }}</pre>
            <div class="break-all opacity-60">{{ item.field_path }}</div>
            <div v-if="item.observation_ref" class="break-all opacity-60">{{ tr("观察记录：") }}{{ item.observation_ref }}</div>
          </div>
        </li>
      </ul>
      <p class="opacity-50">{{ tr("规则版本：") }}{{ value.ruleset_version }}{{ tr("。置信度为规则分级；引用资源不代表运行时使用。") }}</p>
    </div>
  </details>
  <span v-else class="text-xs opacity-50">{{ label }}</span>
</template>
