<script setup>
import { computed } from 'vue'
import { methodName, methodPrinciple } from '../utils/detectionMethods.js'
import { tr } from '../i18n/index.js'
import { formatDateTime } from '../i18n/time.js'
import { safeReference } from '../utils/threatIntel'

const props = defineProps({
  products: { type: Array, default: () => [] },
  identification: { type: Object, default: null },
  compact: Boolean,
})

const xmrigStatuses = {
  matched: '摘要已匹配',
  not_matched: '摘要声明了其他挖矿软件',
  not_attempted: '未尝试采集',
  unknown: '本次采集状态未知',
  no_summary: '端点未提供摘要',
  auth_required: '需要认证',
  timeout: '摘要采集超时',
  cancelled: '摘要采集已取消',
  transport_error: '摘要连接失败',
  http_error: '摘要请求失败',
  response_too_large: '摘要超过响应大小限制',
  budget_exceeded: '扫描结果空间不足',
  invalid_response: '摘要格式无效',
}
const xmrigAttempt = computed(() => {
  const attempt = props.identification?.xmrig_attempt
  const observedAt = props.identification?.observed_at || 0
  if ((!attempt || attempt.observed_at < observedAt) && props.products.some(product => product.id === 'xmrig' && product.observation?.stale)) {
    return { status: 'unknown', observed_at: observedAt }
  }
  return Object.hasOwn(xmrigStatuses, attempt?.status) ? attempt : null
})
</script>

<template>
  <div v-if="compact && (products.length || identification?.jarm?.fingerprint)" class="flex min-w-0 flex-wrap gap-1">
    <span v-for="product in products" :key="`${product.id}:${product.version || ''}`" class="badge badge-outline badge-sm max-w-full" :class="product.assessment === 'suspected' ? 'badge-warning' : 'badge-ghost'" :title="product.observation?.stale ? tr('历史证据') : product.basis === 'historical_certificate_heuristic' ? tr('仅符合历史证书结构，家族归属需复核。') : product.assessment === 'suspected' ? tr('疑似产品') : tr('服务声明')">
      <span class="truncate">{{ product.name }}<template v-if="product.component"> · {{ product.component }}</template><template v-if="product.version">{{ " " + product.version }}</template><template v-if="product.assessment === 'suspected'"> · {{ tr('疑似') }}</template><template v-if="product.observation?.stale"> · {{ tr('历史证据') }}</template></span>
    </span>
    <span v-if="identification?.jarm?.fingerprint" class="badge badge-ghost badge-sm" :title="identification.jarm.fingerprint">JARM</span>
    <span v-if="identification?.stale" class="badge badge-ghost badge-xs">{{ tr('证据可能过期') }}</span>
  </div>
  <div v-else-if="!compact && identification" class="min-w-0 space-y-3 text-xs">
    <div class="flex flex-wrap items-center gap-2">
      <h5 class="font-semibold opacity-60">{{ tr('产品识别') }}</h5>
      <span v-if="identification.coverage === 'partial'" class="badge badge-ghost badge-xs">{{ tr('采集证据不完整') }}</span>
      <span v-if="identification.stale" class="badge badge-warning badge-outline badge-xs">{{ tr('证据可能过期') }}</span>
    </div>
    <details v-if="identification.detection_methods?.length">
      <summary class="cursor-pointer leading-6 opacity-70">{{ tr('检测方式与基本原理') }}</summary>
      <div class="my-2 min-w-0 space-y-2 rounded-lg border border-base-300 bg-base-200/50 p-3">
        <div class="overflow-x-auto">
          <table class="table table-xs table-zebra">
            <thead>
              <tr>
                <th scope="col">{{ tr('检测方式') }}</th>
                <th scope="col">{{ tr('是否主动探测') }}</th>
                <th scope="col">{{ tr('采集情况') }}</th>
                <th scope="col">{{ tr('基本原理') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="method in identification.detection_methods" :key="method.id">
                <th scope="row" class="whitespace-nowrap font-medium">{{ method.name }}</th>
                <td>{{ method.active_probe ? tr('是') : tr('否') }} · {{ method.additional_probe ? tr(method.id === 'http_fingerprint' ? '额外 HTTP 请求' : '额外握手') : tr('复用已有采集') }}</td>
                <td><span class="badge badge-ghost badge-xs whitespace-nowrap">{{ method.observed ? tr('已采集') : tr('未采集') }}</span></td>
                <td class="min-w-36">{{ methodPrinciple(method.principle) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="opacity-60">{{ tr('主动探测指采集过程；证书和响应特征在本地分析。检测方式不代表已具备对应的 C2 产品规则。') }}</p>
      </div>
    </details>
    <div v-if="identification.jarm" class="space-y-2 rounded-lg border border-base-300 bg-base-200/50 p-3">
      <div class="flex flex-wrap items-center gap-2"><span class="font-semibold">JARM</span><span class="badge badge-ghost badge-xs">{{ tr('主动采集') }}</span><span class="opacity-60">{{ tr('完成探测 {0}/{1}', [identification.jarm.completed_probes, identification.jarm.expected_probes]) }}</span></div>
      <p v-if="identification.jarm.fingerprint" class="break-all font-mono">{{ identification.jarm.fingerprint }}</p>
      <p v-else class="opacity-70">{{ identification.jarm.status === 'no_response' ? tr('服务端未返回可用的 TLS ServerHello') : tr('JARM 采集不完整，未生成有效指纹') }}</p>
      <p class="opacity-60">{{ tr('JARM 表示 TLS 配置相似性，不能单独确认 C2 家族或恶意用途。') }}</p>
      <p v-if="identification.jarm.sni" class="break-all font-mono">SNI: {{ identification.jarm.sni }}</p>
    </div>
    <div v-if="xmrigAttempt" class="flex flex-wrap items-center gap-2">
      <span class="font-semibold">{{ tr('XMRig 摘要') }}</span>
      <span class="badge badge-ghost badge-xs">{{ tr(xmrigStatuses[xmrigAttempt.status]) }}</span>
      <span v-if="xmrigAttempt.status_code" class="opacity-60">HTTP {{ xmrigAttempt.status_code }}</span>
      <span v-if="xmrigAttempt.host" class="break-all font-mono">{{ xmrigAttempt.host }}</span>
      <span v-if="xmrigAttempt.observed_at > 0" class="opacity-60">{{ formatDateTime(xmrigAttempt.observed_at) }}</span>
    </div>
    <p v-if="!products.length" class="opacity-70">{{ identification.status === 'not_matched' ? tr('未匹配已收录的产品规则') : tr('产品识别证据不足') }}</p>
    <article v-for="product in products" :key="`${product.id}:${product.version || ''}`" class="space-y-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-semibold">{{ product.name }}<template v-if="product.component"> · {{ product.component }}</template><template v-if="product.version">{{ " " + product.version }}</template></span>
        <span class="badge badge-outline badge-xs" :class="product.assessment === 'suspected' ? 'badge-warning' : 'badge-ghost'">{{ product.assessment === 'suspected' ? tr('疑似产品') : tr('服务声明') }}</span>
        <span v-if="product.category === 'mining_software'" class="badge badge-ghost badge-xs">{{ tr('挖矿软件') }}</span>
        <span v-if="product.observation?.stale" class="badge badge-warning badge-outline badge-xs">{{ tr('历史证据') }}</span>
        <span v-if="product.basis === 'historical_certificate_heuristic'" class="badge badge-ghost badge-xs">{{ tr('历史证书启发式') }}</span>
      </div>
      <p v-if="product.observation?.observed_at > 0" class="opacity-60">{{ tr('最后确认时间 {0}', [formatDateTime(product.observation.observed_at)]) }}</p>
      <p v-if="product.basis === 'historical_certificate_heuristic'" class="opacity-70">{{ tr('仅符合历史证书结构，家族归属需复核。') }}</p>
      <details v-if="product.evidence?.length">
        <summary class="cursor-pointer leading-6 opacity-70">{{ tr('识别依据') }}</summary>
        <div class="my-2 space-y-2 rounded-lg border border-base-300 bg-base-200/50 p-3">
          <div v-for="(evidence, index) in product.evidence" :key="`${evidence.rule_id}:${index}`" class="space-y-2 border-t border-base-300 pt-2 first:border-0 first:pt-0">
            <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
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
        </div>
      </details>
    </article>
    <p v-if="products.some(product => product.assessment === 'suspected')" class="opacity-70">{{ tr('产品候选表示观察到相符的部署特征，尚未确认服务角色或恶意用途。') }}</p>
    <p class="opacity-60">{{ tr('产品规则版本 {0}', [identification.ruleset_revision]) }}<template v-if="identification.observed_at > 0"> · {{ formatDateTime(identification.observed_at) }}</template></p>
  </div>
</template>
