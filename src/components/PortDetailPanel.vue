<script setup>
import { computed } from 'vue'
import { tr } from '../i18n/index.js'
import { formatDateTime } from '../i18n/time.js'
import { evidenceBlocks, prettifyKey, serviceEnvelope, tlsSummary } from '@/utils/portEvidence'
import { serviceLabel } from '@/utils/serviceDetection'
import OsFingerprint from '@/components/OsFingerprint.vue'
import WebTechnologies from '@/components/WebTechnologies.vue'
import AssetFavicon from '@/components/AssetFavicon.vue'
import C2ServiceFingerprint from '@/components/C2ServiceFingerprint.vue'
import ServiceProducts from '@/components/ServiceProducts.vue'

// Parsed, sectioned expansion panel for an asset port row. Responsive block
// grid; every block renders structured fields instead of raw probe JSON.
const props = defineProps({
  port: { type: Object, required: true },
  ip: { type: String, default: '' },
})

const FIELD_LABELS = {
  get status_line() { return tr("状态") },
  get request() { return tr("请求") },
  get server() { return tr("服务器") },
  get content_type() { return tr("内容类型") },
  get content_length() { return tr("正文大小") },
  get body_truncated() { return tr("正文已截断") },
  get server_version() { return tr("服务版本") },
  get protocol_version() { return tr("协议版本") },
  get cipher_suite() { return tr("加密套件") },
  get alpn_protocol() { return tr("ALPN 协议") },
  get subject() { return tr("主体") },
  get issuer() { return tr("颁发者") },
  get not_before() { return tr("有效期起") },
  get not_after() { return tr("有效期止") },
  get self_signed() { return tr("自签名") },
  get fingerprint() { return tr("指纹") },
  get serial() { return tr("序列号") },
  get capability_flags() { return tr("能力标志") },
  get status_flags() { return tr("状态标志") },
}
const MONO_KEYS = new Set(['request', 'ja3s', 'fingerprint', 'serial', 'icon_md5'])
const DATE_KEYS = new Set(['not_before', 'not_after'])
const REASON_LABELS = {
  get protocol_handshake() { return tr("协议握手") },
  get passive_observation() { return tr("被动观察") },
}

function fieldLabel(key) {
  return FIELD_LABELS[key] || prettifyKey(key)
}
function fieldValue(key, value) {
  if (typeof value === 'boolean') return value ? tr("是") : tr("否")
  if (DATE_KEYS.has(key)) {
    const ms = typeof value === 'number' ? (value > 1e12 ? value : value * 1000) : Date.parse(value)
    if (Number.isFinite(ms)) return formatDateTime(new Date(ms))
  }
  return String(value)
}

const envelope = computed(() => serviceEnvelope(props.port))
const blocks = computed(() => evidenceBlocks(props.port).filter((block) => block.fields.length || block.truncated))
const tls = computed(() => tlsSummary(props.port))
const hasOs = computed(() => props.port.os && props.port.os.status && props.port.os.status !== 'unknown')
const hasWeb = computed(() => ['identified', 'partial'].includes(props.port.web?.status))
const hasWebAssets = computed(() => Boolean(props.port.favicon || props.port.icon_md5 || props.port.js_names?.length))
const hasFingerprintMatch = computed(() => props.port.c2_fingerprint?.status === 'matched' || Boolean(props.port.last_c2_fingerprint))
const hasAnything = computed(() => Boolean(envelope.value || blocks.value.length || tls.value || hasOs.value || hasWeb.value || hasWebAssets.value || props.port.banner || hasFingerprintMatch.value))
</script>

<template>
  <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
    <section class="rounded-lg border border-base-300/60 bg-base-100 p-3">
      <h4 class="mb-2 text-xs font-semibold opacity-60">{{ tr("观察与来源") }}</h4>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt class="opacity-60">{{ tr("首次发现") }}</dt><dd class="min-w-0 break-words">{{ formatDateTime(new Date(port.first_seen_at)) }}</dd>
        <dt class="opacity-60">{{ tr("最近发现") }}</dt><dd class="min-w-0 break-words">{{ formatDateTime(new Date(port.last_seen_at)) }}</dd>
        <template v-if="port.service_observed_at"><dt class="opacity-60">{{ tr("服务观察时间") }}</dt><dd class="min-w-0 break-words">{{ formatDateTime(new Date(port.service_observed_at)) }}</dd></template>
        <dt class="opacity-60">{{ tr("来源") }}</dt><dd class="min-w-0 break-words">{{ port.source || '-' }}</dd>
        <template v-if="port.service_source"><dt class="opacity-60">{{ tr("服务：") }}</dt><dd class="min-w-0 break-words">{{ port.service_source }}</dd></template>
        <template v-if="port.task_id"><dt class="opacity-60">{{ tr("任务") }}</dt><dd class="min-w-0 break-all font-mono"><a class="link" :href="`/task/${port.task_id}`">{{ port.task_id }}</a></dd></template>
        <template v-if="port.execution_id"><dt class="opacity-60">{{ tr("执行实例") }}</dt><dd class="min-w-0 break-all font-mono">{{ port.execution_id }}</dd></template>
      </dl>
      <p v-if="port.service_stale" class="mt-2 text-xs text-warning">{{ tr("服务信息早于最近端口观察") }}</p>
    </section>

    <section v-if="envelope || port.product_identification" class="rounded-lg border border-base-300/60 bg-base-100 p-3">
      <h4 class="mb-2 text-xs font-semibold opacity-60">{{ tr("服务识别") }}</h4>
      <dl v-if="envelope" class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <template v-if="envelope.probe"><dt class="opacity-60">{{ tr("选用探针") }}</dt><dd class="min-w-0 break-words">{{ serviceLabel(envelope.probe) }}</dd></template>
        <template v-if="envelope.reason"><dt class="opacity-60">{{ tr("选择依据") }}</dt><dd class="min-w-0 break-words">{{ REASON_LABELS[envelope.reason] || envelope.reason }}</dd></template>
        <template v-if="envelope.confidence != null"><dt class="opacity-60">{{ tr("置信度") }}</dt><dd><span class="badge badge-sm" :class="envelope.confidence >= 80 ? 'badge-success' : envelope.confidence >= 50 ? 'badge-warning' : 'badge-ghost'">{{ envelope.confidence }}</span></dd></template>
        <template v-if="envelope.attempts != null"><dt class="opacity-60">{{ tr("尝试次数") }}</dt><dd>{{ envelope.attempts }}</dd></template>
      </dl>
      <ServiceProducts class="mt-3" :products="port.products || []" :identification="port.product_identification" />
    </section>

    <section v-for="block in blocks" :key="block.module" class="rounded-lg border border-base-300/60 bg-base-100 p-3">
      <h4 class="mb-2 flex items-center gap-2 text-xs font-semibold opacity-60"><span class="badge badge-outline badge-xs">{{ serviceLabel(block.module) }}</span>{{ tr("协议证据") }}</h4>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <template v-for="field in block.fields" :key="field.key">
          <dt class="opacity-60">{{ fieldLabel(field.key) }}</dt>
          <dd v-if="field.kind === 'scalar'" class="min-w-0 break-words" :class="MONO_KEYS.has(field.key) ? 'font-mono' : ''">{{ fieldValue(field.key, field.value) }}</dd>
          <dd v-else class="flex min-w-0 flex-wrap gap-1">
            <span v-for="item in field.value.slice(0, 6)" :key="item" class="badge badge-ghost badge-xs font-mono">{{ item }}</span>
            <span v-if="field.value.length > 6" class="badge badge-ghost badge-xs">+{{ field.value.length - 6 }}</span>
          </dd>
        </template>
      </dl>
      <p v-if="block.truncated" class="mt-2 text-xs text-warning">{{ tr("识别证据已截断") }}</p>
    </section>

    <section v-if="tls" class="rounded-lg border border-base-300/60 bg-base-100 p-3">
      <h4 class="mb-2 flex items-center gap-2 text-xs font-semibold opacity-60">{{ tr("TLS 握手与证书") }}<span class="badge badge-xs" :class="tls.completed ? 'badge-success' : 'badge-ghost'">{{ tls.completed ? tr("握手完成") : tr("未完成") }}</span></h4>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <template v-for="field in tls.helloFields" :key="field.key">
          <dt class="opacity-60">{{ fieldLabel(field.key) }}</dt>
          <dd class="min-w-0 break-words" :class="MONO_KEYS.has(field.key) ? 'font-mono' : ''">{{ fieldValue(field.key, field.value) }}</dd>
        </template>
        <template v-if="tls.supportedVersions.length"><dt class="opacity-60">{{ tr("支持版本") }}</dt><dd class="flex min-w-0 flex-wrap gap-1"><span v-for="version in tls.supportedVersions" :key="version" class="badge badge-ghost badge-xs">{{ version }}</span></dd></template>
        <template v-for="field in tls.certFields" :key="`cert-${field.key}`">
          <dt class="opacity-60">{{ fieldLabel(field.key) }}</dt>
          <dd class="min-w-0 break-words" :class="MONO_KEYS.has(field.key) ? 'font-mono' : ''">{{ fieldValue(field.key, field.value) }}</dd>
        </template>
        <template v-if="tls.san.length"><dt class="opacity-60">{{ tr("备用名称") }}</dt><dd class="flex min-w-0 flex-wrap gap-1"><span v-for="name in tls.san.slice(0, 8)" :key="name" class="badge badge-ghost badge-xs font-mono">{{ name }}</span><span v-if="tls.san.length > 8" class="badge badge-ghost badge-xs">+{{ tls.san.length - 8 }}</span></dd></template>
        <template v-for="field in tls.validationFields" :key="`val-${field.key}`">
          <dt class="opacity-60">{{ fieldLabel(field.key) }}</dt>
          <dd class="min-w-0 break-words">{{ fieldValue(field.key, field.value) }}</dd>
        </template>
        <template v-if="tls.ja3s"><dt class="opacity-60">JA3S</dt><dd class="min-w-0 break-all font-mono">{{ tls.ja3s }}</dd></template>
      </dl>
    </section>

    <section v-if="hasOs" class="rounded-lg border border-base-300/60 bg-base-100 p-3">
      <h4 class="mb-2 text-xs font-semibold opacity-60">{{ tr("系统线索") }}</h4>
      <OsFingerprint :value="port.os" />
    </section>

    <section v-if="hasWeb" class="rounded-lg border border-base-300/60 bg-base-100 p-3">
      <h4 class="mb-2 text-xs font-semibold opacity-60">{{ tr("技术栈") }}</h4>
      <WebTechnologies :value="port.web" inline />
    </section>

    <section v-if="hasWebAssets" class="rounded-lg border border-base-300/60 bg-base-100 p-3">
      <h4 class="mb-2 text-xs font-semibold opacity-60">{{ tr("网页资产") }}</h4>
      <div class="flex items-start gap-3">
        <AssetFavicon v-if="port.favicon" :ip="ip" :port="port.port" :protocol="port.protocol" :icon-md5="port.icon_md5" :size="32" />
        <dl class="grid min-w-0 flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
          <template v-if="port.favicon?.content_type"><dt class="opacity-60">{{ tr("内容类型") }}</dt><dd class="min-w-0 break-words">{{ port.favicon.content_type }}</dd></template>
          <template v-if="port.icon_md5"><dt class="opacity-60">icon_md5</dt><dd class="min-w-0 break-all font-mono">{{ port.icon_md5 }}</dd></template>
          <template v-if="port.js_names?.length"><dt class="opacity-60">JS</dt><dd class="flex min-w-0 flex-wrap gap-1"><span v-for="(name, index) in port.js_names" :key="name" class="badge badge-ghost badge-xs font-mono" :title="port.js_md5s?.[index] || ''">{{ name }}</span></dd></template>
        </dl>
      </div>
    </section>

    <section v-if="port.banner" class="rounded-lg border border-base-300/60 bg-base-100 p-3 md:col-span-2 xl:col-span-3">
      <h4 class="mb-2 text-xs font-semibold opacity-60">Banner</h4>
      <pre class="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">{{ port.banner }}</pre>
    </section>

    <C2ServiceFingerprint
      v-if="!port.product_identification && hasFingerprintMatch && port.c2_fingerprint"
      :value="port.c2_fingerprint"
      :previous="port.last_c2_fingerprint"
      :stale="port.c2_fingerprint_stale"
    />

    <p v-if="!hasAnything" class="text-sm opacity-60 md:col-span-2 xl:col-span-3">{{ tr("暂无可解析的识别证据。") }}</p>
  </div>
</template>
