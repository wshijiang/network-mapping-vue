<script setup>
import { methodName, methodPrinciple } from '../utils/detectionMethods.js'
import { tr } from '../i18n/index.js'
import { formatDateTime } from '../i18n/time.js'
import { safeReference } from '../utils/threatIntel'

defineProps({
  products: { type: Array, default: () => [] },
  identification: { type: Object, default: null },
  compact: Boolean,
})
</script>

<template>
  <div v-if="compact && (products.length || identification?.jarm?.fingerprint)" class="flex flex-wrap gap-1">
    <span v-for="product in products" :key="`${product.id}:${product.version || ''}`" class="badge badge-outline badge-sm max-w-full" :class="product.assessment === 'suspected' ? 'badge-warning' : 'badge-ghost'" :title="product.basis === 'historical_certificate_heuristic' ? tr('仅符合历史证书结构，家族归属需复核。') : product.assessment === 'suspected' ? tr('疑似产品') : tr('服务声明')">
      <span class="truncate">{{ product.name }}<template v-if="product.component"> · {{ product.component }}</template><template v-if="product.version"> {{ product.version }}</template><template v-if="product.assessment === 'suspected'"> · {{ tr('疑似') }}</template></span>
    </span>
    <span v-if="identification?.jarm?.fingerprint" class="badge badge-ghost badge-sm" :title="identification.jarm.fingerprint">JARM</span>
    <span v-if="identification?.stale" class="badge badge-ghost badge-xs">{{ tr('证据可能过期') }}</span>
  </div>
  <div v-else-if="!compact && identification" class="space-y-3 text-xs">
    <div class="flex flex-wrap items-center gap-2">
      <h5 class="font-semibold opacity-60">{{ tr('产品识别') }}</h5>
      <span v-if="identification.coverage === 'partial'" class="badge badge-ghost badge-xs">{{ tr('采集证据不完整') }}</span>
      <span v-if="identification.stale" class="badge badge-warning badge-outline badge-xs">{{ tr('证据可能过期') }}</span>
    </div>
    <details v-if="identification.detection_methods?.length" class="rounded-lg border border-base-300 bg-base-200/50 p-3">
      <summary class="cursor-pointer opacity-70">{{ tr('检测方式与基本原理') }}</summary>
      <div class="mt-3 overflow-x-auto">
        <table class="table table-xs">
          <thead><tr><th>{{ tr('检测方式') }}</th><th>{{ tr('是否主动探测') }}</th><th>{{ tr('采集情况') }}</th><th>{{ tr('基本原理') }}</th></tr></thead>
          <tbody><tr v-for="method in identification.detection_methods" :key="method.id">
            <td class="whitespace-nowrap">{{ method.name }}</td>
            <td>{{ method.active_probe ? tr('是') : tr('否') }} · {{ method.additional_probe ? tr('额外握手') : tr('复用已有采集') }}</td>
            <td>{{ method.observed ? tr('已采集') : tr('未采集') }}</td>
            <td class="min-w-48">{{ methodPrinciple(method.principle) }}</td>
          </tr></tbody>
        </table>
      </div>
      <p class="mt-2 opacity-60">{{ tr('主动探测指采集过程；证书和响应特征在本地分析。检测方式不代表已具备对应的 C2 产品规则。') }}</p>
    </details>
    <div v-if="identification.jarm" class="space-y-2 rounded-lg border border-base-300 p-3">
      <div class="flex flex-wrap items-center gap-2"><span class="font-semibold">JARM</span><span class="badge badge-ghost badge-xs">{{ tr('主动采集') }}</span><span class="opacity-60">{{ tr('完成探测 {0}/{1}', [identification.jarm.completed_probes, identification.jarm.expected_probes]) }}</span></div>
      <p v-if="identification.jarm.fingerprint" class="break-all font-mono">{{ identification.jarm.fingerprint }}</p>
      <p v-else class="opacity-70">{{ identification.jarm.status === 'no_response' ? tr('服务端未返回可用的 TLS ServerHello') : tr('JARM 采集不完整，未生成有效指纹') }}</p>
      <p class="opacity-60">{{ tr('JARM 表示 TLS 配置相似性，不能单独确认 C2 家族或恶意用途。') }}</p>
      <p v-if="identification.jarm.sni" class="break-all font-mono">SNI: {{ identification.jarm.sni }}</p>
    </div>
    <p v-if="!products.length" class="opacity-70">{{ identification.status === 'not_matched' ? tr('未匹配已收录的产品规则') : tr('产品识别证据不足') }}</p>
    <article v-for="product in products" :key="`${product.id}:${product.version || ''}`" class="space-y-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-semibold">{{ product.name }}<template v-if="product.component"> · {{ product.component }}</template><template v-if="product.version"> {{ product.version }}</template></span>
        <span class="badge badge-outline badge-xs" :class="product.assessment === 'suspected' ? 'badge-warning' : 'badge-ghost'">{{ product.assessment === 'suspected' ? tr('疑似产品') : tr('服务声明') }}</span>
        <span v-if="product.basis === 'historical_certificate_heuristic'" class="badge badge-ghost badge-xs">{{ tr('历史证书启发式') }}</span>
      </div>
      <p v-if="product.basis === 'historical_certificate_heuristic'" class="opacity-70">{{ tr('仅符合历史证书结构，家族归属需复核。') }}</p>
      <details class="rounded-lg border border-base-300 bg-base-200/50 p-3">
        <summary class="cursor-pointer opacity-70">{{ tr('识别依据') }}</summary>
        <div v-for="(evidence, index) in product.evidence || []" :key="`${evidence.rule_id}:${index}`" class="mt-3 space-y-2">
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <template v-if="evidence.detection_method"><dt class="opacity-60">{{ tr('检测方式') }}</dt><dd>{{ methodName(evidence.detection_method) }}</dd></template>
            <dt class="opacity-60">{{ tr('选用探针') }}</dt><dd class="break-all font-mono">{{ evidence.probe }}</dd>
            <dt class="opacity-60">{{ tr('规则') }}</dt><dd class="break-all font-mono">{{ evidence.rule_id }}</dd>
            <template v-if="evidence.sni"><dt class="opacity-60">SNI</dt><dd class="break-all font-mono">{{ evidence.sni }}</dd></template>
            <template v-if="evidence.http_host"><dt class="opacity-60">Host</dt><dd class="break-all font-mono">{{ evidence.http_host }}</dd></template>
            <template v-for="[field, value] in evidence.details || []" :key="field"><dt class="opacity-60">{{ field }}</dt><dd class="min-w-0 break-all font-mono">{{ value }}</dd></template>
            <dt class="opacity-60">{{ tr('原始证据路径') }}</dt><dd class="min-w-0 break-all font-mono">{{ evidence.field_path }}</dd>
          </dl>
          <a v-if="safeReference(evidence.source_url)" class="link" :href="safeReference(evidence.source_url)" target="_blank" rel="noopener noreferrer">{{ tr('研究来源') }}</a>
        </div>
      </details>
    </article>
    <p v-if="products.some(product => product.assessment === 'suspected')" class="opacity-70">{{ tr('产品候选表示观察到相符的部署特征，尚未确认服务角色或恶意用途。') }}</p>
    <p class="opacity-60">{{ tr('产品规则版本 {0}', [identification.ruleset_revision]) }}<template v-if="identification.observed_at > 0"> · {{ formatDateTime(identification.observed_at) }}</template></p>
  </div>
</template>
