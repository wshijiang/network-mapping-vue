<script setup>
import { computed } from 'vue'
import { osLabel, osConfidence } from '@/utils/osDetection'
import { formatDateTime } from '@/utils/systemTime'

const props = defineProps({ value: { type: Object, default: null } })
const label = computed(() => osLabel(props.value))
const confidence = computed(() => osConfidence(props.value))
const evidence = computed(() => props.value?.evidence?.slice(0, 32) || [])
const evidenceTime = computed(() => props.value?.observed_at == null ? '' : formatDateTime(new Date(props.value.observed_at)))
</script>

<template>
  <details v-if="value" class="min-w-28 text-xs">
    <summary class="cursor-pointer leading-6" :class="value.status === 'conflict' ? 'text-warning' : ''">
      <span>{{ label }}</span>
      <span v-if="confidence" class="ml-1 opacity-60">置信度{{ confidence }}</span>
      <span v-if="value.stale" class="ml-1 text-warning">证据可能过期</span>
    </summary>
    <div class="my-2 max-w-xl space-y-2 rounded-lg border border-base-300 bg-base-200/50 p-3 whitespace-normal">
      <p>{{ value.inference_scope === 'host_estimate' ? '根据当前可见服务推测宿主机系统，容器、代理或多个后端可能影响结果。' : '这是当前服务运行环境的系统线索。' }}</p>
      <p v-if="value.status === 'pending'">后台正在处理已有服务证据，稍后刷新查看。</p>
      <p v-else-if="value.status === 'conflict'">发现不同系统的返回特征，请结合各端口证据判断。</p>
      <p v-else-if="value.status === 'unknown'">现有返回特征不足以判断系统。</p>
      <p v-if="evidenceTime" class="opacity-60">证据时间：{{ evidenceTime }}</p>
      <ul v-if="evidence.length" class="space-y-2">
        <li v-for="(item, index) in evidence" :key="index" class="border-t border-base-300 pt-2">
          <div>{{ item.port }}/{{ item.module }} · {{ item.rule_id }}</div>
          <pre class="mt-1 whitespace-pre-wrap break-all font-mono">{{ item.excerpt }}</pre>
          <div class="mt-1 break-all opacity-60">{{ item.field_path }}</div>
          <div v-if="item.observation_ref" class="break-all opacity-60">观察记录：{{ item.observation_ref }}</div>
        </li>
      </ul>
      <p class="opacity-50">规则版本：{{ value.ruleset_version }}；置信度为规则分级。</p>
    </div>
  </details>
  <span v-else class="text-xs opacity-50">{{ label }}</span>
</template>
