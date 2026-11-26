<script setup>
import { tr } from '../i18n/index.js'
import { formatDateTime } from '../i18n/time.js'

defineProps({
  value: { type: Object, required: true },
  previous: { type: Object, default: null },
  stale: Boolean,
})

const rules = {
  get cobalt_strike_default_certificate() { return tr('Cobalt Strike Team Server 默认证书') },
  get asyncrat_family_certificate_template() { return tr('AsyncRAT / DcRAT 默认证书模板') },
}
const fields = {
  sha256: 'SHA-256',
  get subject_dn() { return tr('主体') },
  get issuer_dn() { return tr('颁发者') },
  get self_signed() { return tr('自签名') },
  get not_after() { return tr('有效期止') },
  get signature_algorithm() { return tr('签名算法') },
  get http_response() { return tr('同一次握手的 HTTP 响应') },
}
</script>

<template>
  <section class="rounded-lg border border-base-300/60 bg-base-100 p-3 text-xs">
    <h4 class="mb-2 flex flex-wrap items-center gap-2 font-semibold">
      {{ tr('服务端指纹') }}
      <span v-if="value.status === 'matched'" class="badge badge-warning badge-xs">{{ tr('指纹命中') }}</span>
      <span v-else class="badge badge-ghost badge-xs">{{ value.status === 'not_matched' ? tr('未命中') : tr('证据不足') }}</span>
    </h4>
    <p v-if="stale" class="mb-2 text-warning">{{ tr('指纹证据早于最近端口观察，待复核。') }}</p>
    <template v-for="assessment in [value, previous]" :key="assessment === value ? 'current' : 'previous'">
      <div v-if="assessment" :class="assessment === previous ? 'mt-3 border-t border-base-300 pt-3' : ''">
        <p v-if="assessment === previous" class="mb-1 font-semibold">{{ tr('上次指纹命中') }}</p>
        <p class="opacity-70">
          {{ tr('指纹规则版本 {0}', [assessment.ruleset_version]) }}
          <template v-if="assessment.observed_at > 0"> · {{ formatDateTime(new Date(assessment.observed_at)) }}</template>
        </p>
        <p v-if="assessment.recomputed" class="opacity-70">{{ tr('由原始扫描记录按当前规则重算。') }}</p>
        <article v-for="hit in assessment.matches || []" :key="`${hit.rule_id}:${hit.evidence_path}`" class="mt-2">
          <h5 class="font-semibold">{{ rules[hit.rule_id] || hit.rule_id }}</h5>
          <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt class="opacity-60">{{ tr('选用探针') }}</dt><dd class="font-mono">{{ hit.probe }}</dd>
            <template v-if="hit.sni"><dt class="opacity-60">SNI</dt><dd class="break-all font-mono">{{ hit.sni }}</dd></template>
            <template v-if="hit.http_host"><dt class="opacity-60">Host</dt><dd class="break-all font-mono">{{ hit.http_host }}</dd></template>
            <template v-for="[field, evidence] in hit.evidence" :key="field">
              <dt class="opacity-60">{{ fields[field] || field }}</dt><dd class="min-w-0 break-all font-mono">{{ evidence }}</dd>
            </template>
            <dt class="opacity-60">{{ tr('原始证据路径') }}</dt><dd class="min-w-0 break-all font-mono">{{ hit.evidence_path }}</dd>
          </dl>
          <p class="mt-1 flex flex-wrap gap-x-3">
            <a class="link" :href="hit.source_url" target="_blank" rel="noopener noreferrer">{{ tr('指纹研究来源') }}</a>
            <a v-if="assessment.task_id" class="link" :href="`/task/${assessment.task_id}`">{{ tr('扫描任务') }}</a>
          </p>
        </article>
      </div>
    </template>
  </section>
</template>
