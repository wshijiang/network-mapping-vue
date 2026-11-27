<script setup>
import { tr } from '../i18n/index.js'

import { computed, ref } from 'vue'
import IntelEvidenceQuote from './IntelEvidenceQuote.vue'
import { originLabel, safeReference, attackLabel, roleLabel } from '../utils/threatIntel'
import { formatDateTime } from '../i18n/time.js'
const props = defineProps({ intel: { type: Object, default: null }, label: { type: String, get default() { return tr("情报") } } })
const dialog = ref(null)
const matches = computed(() => [...(props.intel?.matches || []), ...(props.intel?.expired_matches || []), ...[...(props.intel?.asn_context?.matches || []), ...(props.intel?.asn_context?.expired_matches || [])].map(match => ({ ...match, asnContext: true }))])
const observationLabels = {
  get http_request() { return tr('扫描请求 URL') },
  get http_redirect() { return tr('响应声明的重定向 URL') },
  get http_body_sha256() { return tr('HTTP 响应正文 SHA-256') },
  get javascript_sha256() { return tr('JavaScript 文件 SHA-256') },
}
</script>

<template>
  <span v-if="intel" class="inline-flex items-center gap-1">
    <span v-if="!intel.available" class="badge badge-ghost badge-sm" :title="tr(&quot;情报存储暂时不可用，此状态不表示目标正常&quot;)">{{ tr("情报暂不可用") }}</span>
    <button v-else-if="intel.risk || intel.expired_matches?.length" type="button" class="badge badge-sm cursor-pointer" :class="intel.risk === 'malicious' ? 'badge-error' : intel.risk ? 'badge-warning' : 'badge-ghost'" @click="dialog?.showModal()">{{ label }}：{{ intel.risk === 'malicious' ? tr("恶意") : intel.risk ? tr("可疑") : tr("已过期") }}</button>
    <button v-if="intel.available && (intel.asn_context?.risk || intel.asn_context?.expired_matches?.length)" type="button" class="badge badge-outline badge-sm cursor-pointer" :class="intel.asn_context.risk ? 'badge-warning' : 'badge-ghost'" @click="dialog?.showModal()">{{ tr("所属 ASN：") }}{{ intel.asn_context.risk === 'malicious' ? tr("恶意报告") : intel.asn_context.risk ? tr("可疑报告") : tr("已过期") }}</button>
    <dialog ref="dialog" class="modal">
      <div class="modal-box w-11/12 max-w-3xl text-left whitespace-normal">
        <h2 class="text-lg font-semibold">{{ label }}{{ tr("命中证据") }}</h2>
        <p class="mt-2 text-sm opacity-65">{{ tr("标记仅适用于下列 IOC 的精确范围。组织归因来自已接纳的具体报告；共享软件不会自动产生组织标签。过期证据保留供追溯，不贡献当前风险。") }}</p>
        <article v-for="match in matches" :key="match.id" class="mt-4 rounded border border-base-300 p-3 space-y-2 text-sm">
          <div class="flex flex-wrap gap-2"><span class="badge badge-outline">{{ match.type }}</span><code class="break-all">{{ match.value }}</code></div>
          <p v-if="observationLabels[match.observation_basis]" class="flex flex-wrap items-center gap-2">
            <span class="badge badge-ghost badge-sm">{{ observationLabels[match.observation_basis] }}</span>
            <span v-if="intel.observed_at" class="opacity-65">{{ formatDateTime(intel.observed_at) }}</span>
          </p>
          <p v-if="match.asnContext" class="text-warning">{{ tr("该证据针对资产所属 ASN，不表示此 IP 被报告直接列名，也不证明流量路径经过该 AS。") }}</p>
          <p>{{ match.source_name }} · {{ originLabel(match) }}</p>
          <p v-if="match.valid_until" :class="match.expired ? 'text-warning' : 'opacity-65'">{{ match.expired ? tr("已过期") : tr("有效期") }}：{{ formatDateTime(match.valid_until) }}</p>
          <p v-if="match.actor">{{ tr("报告归因：") }}{{ match.actor.name }}（{{ match.actor.id }}）</p>
          <p v-else-if="match.payload?.actor_name">{{ tr("报告原名：") }}{{ match.payload.actor_name }}{{ tr("；尚未形成有效标准组织归因。") }}</p>
          <p v-if="match.payload?.malware">{{ tr("软件 / 家族：") }}{{ match.payload.malware }}<span v-if="match.software">（{{ match.software.id }}）</span></p>
          <p v-if="match.payload?.attack_types?.length">{{ tr("攻击行为：") }}{{ match.payload.attack_types.map(attackLabel).join('、') }}</p>
          <p v-if="match.payload?.role">{{ tr("指标角色：") }}{{ roleLabel(match.payload.role) }}</p>
          <p v-if="match.payload?.resource_owner">{{ tr("资源登记方：") }}{{ match.payload.resource_owner }}{{ tr("（不作为攻击者归因）") }}</p>
          <p v-if="match.payload?.confidence != null">{{ tr("来源置信度：") }}{{ match.payload.confidence }}{{ tr("（仅作为来源元数据）") }}</p>
          <p v-if="match.payload?.first_seen || match.payload?.last_seen">{{ tr("首次：") }}{{ match.payload.first_seen || tr("未提供") }} {{ tr("· 最近：") }}{{ match.payload.last_seen || tr("未提供") }}</p>
          <IntelEvidenceQuote v-if="match.payload?.evidence" :payload="match.payload" />
          <a v-if="safeReference(match.payload?.reference)" :href="safeReference(match.payload.reference)" target="_blank" rel="noopener noreferrer" class="link">{{ tr("查看来源") }}</a>
        </article>
        <div class="modal-action"><button type="button" class="btn" @click="dialog?.close()">{{ tr("关闭") }}</button></div>
      </div>
      <form method="dialog" class="modal-backdrop"><button>{{ tr("关闭") }}</button></form>
    </dialog>
  </span>
</template>
