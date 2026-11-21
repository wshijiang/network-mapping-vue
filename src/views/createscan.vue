<script setup>
import { tr } from '../i18n/index.js'

import { computed, onMounted, ref, watch, useId } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import http from '@/utils/http'
import { parseScanTargets, targetTypeLabel } from '@/utils/scanTargets'
import { automaticServiceRequirements, automaticProbeOptions, supportsRequiredServices } from '@/utils/serviceDetection'
import { routingLocation, routingReason } from '@/utils/scanRouting'

const formFieldId = useId()
const LEGACY_DRAFT_KEY = 'createscan_draft'
const scanProfiles = [
  {value: 'udp_inventory', get title() { return tr("UDP 服务识别") }, get description() { return tr("仅向明确的 UDP 端口发送最小发现请求；最多 256 个地址、32 个端口，超时不判定端口状态。") }, ipOnly: true},
  {
    value: 'vulnerability_scan',
    get title() { return tr("全部") },
    get description() { return tr("依次发现端口、识别服务并使用审核过的 Nuclei 模板扫描漏洞。") },
    get domainDescription() { return tr("先查询并归档 DNS 记录，再对授权范围内的解析地址执行端口、服务和漏洞扫描。") }
  },
  {
    value: 'port_only',
    get title() { return tr("仅端口") },
    get description() { return tr("只发现开放端口，不启动服务识别或漏洞扫描。") },
    get domainDescription() { return tr("先解析域名，再对授权范围内的解析地址发现开放端口。") }
  },
  {
    value: 'service_inventory',
    get title() { return tr("服务识别") },
    get description() { return tr("发现开放端口并完成服务识别，不执行漏洞扫描。") },
    get domainDescription() { return tr("先解析域名，再对授权范围内的解析地址发现端口并识别服务。") }
  },
  {
    value: 'dns_records',
    get title() { return tr("仅 DNS") },
    get description() { return tr("只查询并归档 DNS 记录，不扫描解析地址。") },
    domainOnly: true
  }
]

const targetInput = ref('')
const targetTouched = ref(false)
const port = ref('')
const level = ref(1)
const remark = ref('')
const alerts = ref([])
const submitting = ref(false)
const dispatchMode = ref('automatic')
const scannerIds = ref([])
const scanners = ref([])
const scannersLoading = ref(false)
const placement = ref(null)
const placementLoading = ref(false)
let placementRequest = 0
const requiredServices = computed(() => automaticServiceRequirements(scanProfile.value))
const probeServerName=ref('')
const dohPath=ref('/dns-query')
const probeCaPem=ref('')
const modbusUnitId=ref(1)
const s7Tsap=ref(258)
const mqttVersion=ref(4)
const serviceProbeOptions = computed(() => isDnsTask.value ? {} : automaticProbeOptions(scanProfile.value, {
  serverName: probeServerName.value, caPem: probeCaPem.value, dohPath: dohPath.value,
  modbusUnitId: modbusUnitId.value, s7Tsap: s7Tsap.value, mqttVersion: mqttVersion.value
}))
const scanProfile = ref('vulnerability_scan')
const webContentEnabled = ref(true)
const dnsResolverMode = ref('system')
const dnsResolvers = ref([])
const dnsResolverPresets = ref([])
const selectedDnsResolverIds = ref([])
const defaultScanProfile = ref('vulnerability_scan')
const scanSettingsLoading = ref(true)
const targetValidation = computed(() => parseScanTargets(targetInput.value))
const targetType = computed(() => targetValidation.value.valid ? targetValidation.value.type : null)
const isDnsTask = computed(() => targetType.value === 'domain')
const targetValidationVisible = computed(() => targetTouched.value || targetInput.value.trim() !== '')
const targetSummary = computed(() => {
  const result = targetValidation.value
  if (!result.valid) return result.message
  const separator = {
    get comma() { return tr("逗号分隔") },
    get newline() { return tr("换行分隔") },
    get single() { return tr("单个目标") }
  }[result.separator]
  return tr("已识别 {0}，共 {1} 个目标，{2}", [targetTypeLabel(result.type), result.targets.length, separator])
})
const selectedScanProfile = computed(() => scanProfiles.find((profile) => profile.value === scanProfile.value))
const selectedScanProfileTitle = computed(() => selectedScanProfile.value?.title || tr("未选择"))
const selectedScanProfileDescription = computed(() => (
  isDnsTask.value && selectedScanProfile.value?.domainDescription
    ? selectedScanProfile.value.domainDescription
    : selectedScanProfile.value?.description || ''
))
const scanRequiresPort = computed(() => scanProfile.value !== 'dns_records')
const selectedDnsResolvers = computed(() => {
  if (dnsResolverMode.value === 'preset') {
    const selected = new Set(selectedDnsResolverIds.value)
    return dnsResolverPresets.value.filter((resolver) => selected.has(resolver.id))
  }
  return dnsResolverMode.value === 'specified' ? dnsResolvers.value : []
})
const dispatchModeSummary = computed(() => {
  if (dispatchMode.value === 'selected') {
    return scannerIds.value.length > 0 ? tr("已指定 {0} 台扫描器", [scannerIds.value.length]) : tr("指定扫描器")
  }
  if (dispatchMode.value === 'all') return tr("全部扫描器")
  return tr("自动分配")
})

const targetAddressFamily = computed(() => {
  if (targetType.value === 'ipv4') return 'ipv4'
  if (targetType.value === 'ipv6') return 'ipv6'
  if (targetType.value === 'domain') return 'ipv4'
  return null
})

function scannerSupportsProfile(scanner) {
  const requiredProfile = isDnsTask.value ? 'dns_records' : scanProfile.value
  const profiles = scanner.scan_capabilities?.profiles
  return Array.isArray(profiles) && profiles.includes(requiredProfile)
}

function scannerSupportsTarget(scanner) {
  if (!scannerSupportsProfile(scanner) || !supportsRequiredServices(scanner, requiredServices.value)) return false
  if (isDnsTask.value
    && dnsResolverMode.value !== 'system'
    && scanner.scan_capabilities?.explicit_dns_resolvers !== true) return false
  if (isDnsTask.value
    && selectedDnsResolvers.value.some((resolver) => resolver.ip?.includes(':'))
    && !(scanner.supports_ipv6 === true && scanner.ipv6_ready === true)) return false
  if (targetAddressFamily.value === 'ipv6') {
    return scanner.supports_ipv6 === true && scanner.ipv6_ready === true
  }
  if (targetAddressFamily.value === 'ipv4') {
    return scanner.supports_ipv4 === true && scanner.ipv4_ready === true
  }
  return targetAddressFamily.value !== 'mixed'
}

watch([targetAddressFamily, scanProfile, dnsResolverMode, selectedDnsResolvers, requiredServices, serviceProbeOptions], () => {
  const compatibleIds = new Set(scanners.value.filter(scannerSupportsTarget).map((item) => item.scanner_id))
  scannerIds.value = scannerIds.value.filter((id) => compatibleIds.has(id))
})

watch(targetType, (value) => {
  if (value === 'domain') { if(scanProfile.value === 'udp_inventory') scanProfile.value=defaultScanProfile.value }
  if (value !== 'domain' && scanProfile.value === 'dns_records') {
    scanProfile.value = defaultScanProfile.value
  }
})

watch(scanProfile, (value) => {
  if (value === 'dns_records') port.value = ''
  if(value === 'udp_inventory') port.value=''
})

const targetInputRef = ref(null)
const portInputRef = ref(null)
const hasUnsavedChanges = computed(() => (
  targetInput.value.trim() !== ''
  || port.value.trim() !== ''
  || level.value !== 1
  || remark.value.trim() !== ''
  || dispatchMode.value !== 'automatic'
  || scannerIds.value.length > 0
  || Object.keys(serviceProbeOptions.value).length > 0
  || scanProfile.value !== defaultScanProfile.value
  || dnsResolverMode.value !== 'system'
  || dnsResolvers.value.length > 0
  || selectedDnsResolverIds.value.length > 0
))

function addDnsResolver() {
  if (dnsResolvers.value.length >= 8) return
  const index = dnsResolvers.value.length + 1
  dnsResolvers.value.push({ id: `dns-${index}`, label: tr("DNS 服务器 {0}", [index]), ip: '', port: 53, transport: 'udp' })
}

function removeDnsResolver(index) {
  dnsResolvers.value.splice(index, 1)
}

function resetForm() {
  targetInput.value = ''
  targetTouched.value = false
  port.value = ''
  level.value = 1
  remark.value = ''
  dispatchMode.value = 'automatic'
  scannerIds.value = []
  probeServerName.value=''
  dohPath.value='/dns-query'
  probeCaPem.value=''
  modbusUnitId.value=1
  s7Tsap.value=258
  mqttVersion.value=4
  scanProfile.value = defaultScanProfile.value
  dnsResolverMode.value = 'system'
  dnsResolvers.value = []
  selectedDnsResolverIds.value = []
}

async function loadScanSettings() {
  try {
    const response = await http.get('/api/config/scan')
    const profile = response.data?.data?.defaultScanProfile
    if (scanProfiles.some((item) => item.value === profile && item.domainOnly !== true && item.ipOnly !== true)) {
      defaultScanProfile.value = profile
      scanProfile.value = profile
    }
  } catch (error) {
    console.error('load scan settings failed', error)
    showAlert('warning', tr("默认扫描模式加载失败"), tr("本次将使用“全部”模式。"), 7000)
  } finally {
    scanSettingsLoading.value = false
  }
}

async function loadScanners() {
  scannersLoading.value = true
  try {
    const response = await http.get('/api/scanner/list')
    const data = response.data?.data
    if (!Array.isArray(data)) throw new Error('invalid scanner list')
    scanners.value = data.filter((item) => item.is_enable === true)
    const validIds = new Set(scanners.value.map((item) => item.scanner_id))
    scannerIds.value = scannerIds.value.filter((id) => validIds.has(id))
  } catch (error) {
    console.error('load scanners failed', error)
    showAlert('error', tr("扫描器列表加载失败"), tr("指定扫描器暂不可用，请稍后刷新。"), 7000)
  } finally {
    scannersLoading.value = false
  }
}

async function loadDnsResolverPresets() {
  try {
    const response = await http.get('/api/dns/resolvers')
    dnsResolverPresets.value = Array.isArray(response.data?.data) ? response.data.data : []
  } catch (error) {
    console.error('load DNS resolver presets failed', error)
    dnsResolverPresets.value = []
  }
}

onMounted(() => {
  localStorage.removeItem(LEGACY_DRAFT_KEY)
  loadScanners()
  loadScanSettings()
  loadDnsResolverPresets()
})

function closeAlertById(id) {
  alerts.value = alerts.value.filter((alert) => alert.id !== id)
}

function showAlert(type, title, description = '', timeout = 5000) {
  alerts.value.unshift({
    id: crypto.randomUUID(),
    type,
    title,
    description,
    timeout
  })
}

watch([targetInput, port, scanProfile, dnsResolverMode, selectedDnsResolvers, requiredServices, serviceProbeOptions], () => { placement.value = null; placementRequest++ })
async function previewPlacement() {
  if(scanProfile.value==='udp_inventory' && !port.value.trim()) {showAlert('warning',tr("请填写 UDP 端口"));return}
  const targets = targetValidation.value
  if (!targets.valid || targets.targets.length > 100) { showAlert('warning', tr("请先填写有效目标"), tr("分配预览支持最多 100 个明确目标。")); return }
  const request = ++placementRequest
  placementLoading.value = true
  try {
    const response = await http.post('/api/task/placement-preview', {
      targets: targets.targets, scan_profile: isDnsTask.value ? 'dns_records' : scanProfile.value,
      port: port.value.trim() || (isDnsTask.value ? '53' : scanProfile.value === 'udp_inventory' ? '' : '1-65535'), required_services: requiredServices.value, service_probe_options:serviceProbeOptions.value, dns_resolvers: isDnsTask.value ? selectedDnsResolvers.value : []
    })
    if (request === placementRequest) placement.value = response.data?.data || null
  } catch (error) { if (request === placementRequest) showAlert('warning', tr("分配预览暂不可用"), error.response?.data?.message || tr("请稍后重试。")) }
  finally { placementLoading.value = false }
}
async function submitTask() {
  if (submitting.value) return false
  if (scanSettingsLoading.value) return false
  targetTouched.value = true
  if (!targetInputRef.value?.reportValidity()) return false
  const validatedTargets = targetValidation.value
  if (!validatedTargets.valid) {
    showAlert('warning', tr("目标格式不正确"), validatedTargets.message)
    return false
  }
  if (!isDnsTask.value && scanProfile.value === 'dns_records') {
    showAlert('warning', tr("仅 DNS 模式不可用"), tr("仅 DNS 模式只能用于域名目标。"))
    return false
  }
  if (scanProfile.value === 'udp_inventory' && !port.value.trim()) {showAlert('warning',tr("请填写端口"));return false}
  if (scanRequiresPort.value && port.value && !portInputRef.value?.reportValidity()) return false
  if (dispatchMode.value === 'selected' && scannerIds.value.length === 0) {
    showAlert('warning', tr("请选择扫描器"), tr("指定扫描器模式至少需要选择一台扫描器。"))
    return false
  }

  try {
    submitting.value = true
    const submittingDnsTask = validatedTargets.type === 'domain'
    if (isDnsTask.value && dnsResolverMode.value !== 'system') {
      const taskResolvers = selectedDnsResolvers.value
      if (taskResolvers.length === 0) {
        showAlert('warning', tr("请添加 DNS 服务器"), tr("指定 DNS 服务器模式至少需要添加一台服务器。"))
        return false
      }
      if (taskResolvers.length > 8) {
        showAlert('warning', tr("DNS 服务器过多"), tr("单次任务最多可选择 8 台 DNS 服务器。"))
        return false
      }
      const resolverIds = new Set()
      for (const resolver of taskResolvers) {
        const id = resolver.id.trim()
        const ip = resolver.ip.trim()
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !resolver.label.trim() || !ip || !['udp', 'tcp'].includes(resolver.transport)) {
          showAlert('warning', tr("DNS 服务器配置无效"), tr("请填写 ID、名称、IP 地址和 UDP 或 TCP 传输协议。"))
          return false
        }
        if (resolverIds.has(id.toLowerCase())) {
          showAlert('warning', tr("DNS 服务器 ID 重复"), tr("每台 DNS 服务器需要唯一 ID。"))
          return false
        }
        resolverIds.add(id.toLowerCase())
      }
    }
    const payload = submittingDnsTask
      ? {
          domains: validatedTargets.targets,
          level: Number(level.value),
          remark: remark.value.trim() ? remark.value.trim() : null,
          scan_profile: scanProfile.value,
          dispatch_mode: dispatchMode.value,
          scanner_ids: dispatchMode.value === 'selected' ? scannerIds.value : [],
          port: scanRequiresPort.value && port.value.trim() ? port.value.trim() : null,
          dns_resolvers: dnsResolverMode.value !== 'system'
            ? selectedDnsResolvers.value.map((item) => ({
                id: item.id.trim(), label: item.label.trim(), ip: item.ip.trim(),
                port: Number(item.port) || 53, transport: item.transport
              }))
            : [],
          web_content_enabled: ['service_inventory', 'vulnerability_scan'].includes(scanProfile.value) ? webContentEnabled.value : undefined
        }
      : {
          required_services: requiredServices.value,
          service_probe_options:serviceProbeOptions.value,
          web_content_enabled: ['service_inventory', 'vulnerability_scan'].includes(scanProfile.value) ? webContentEnabled.value : undefined,
          ip: validatedTargets.targets.join(','),
          port: port.value.trim(),
          level: Number(level.value),
          remark: remark.value.trim() ? remark.value.trim() : null,
          dispatch_mode: dispatchMode.value,
          scanner_ids: dispatchMode.value === 'selected' ? scannerIds.value : [],
          scan_profile: scanProfile.value,
        }

    const response = await http.post(submittingDnsTask ? '/api/task/create-dns' : '/api/task/create', payload, {
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (response.status === 200) {
      resetForm()
      showAlert('success', submittingDnsTask ? tr("创建 DNS 任务成功") : tr("创建扫描任务成功"), response.data?.data?.task_ids?.length > 1 ? tr("已按地域拆分为 {0} 个独立任务。", [response.data.data.task_ids.length]) : tr("任务已提交到扫描队列。"), 5000)
      return true
    } else {
      showAlert('error', tr("创建扫描失败"), tr("服务器未接受本次创建请求。"), 7000)
      return false
    }
  } catch (error) {
    console.error('create scan task failed', error)
    const message = error?.response?.data?.message
    showAlert(
      'error',
      tr("创建扫描失败"),
      typeof message === 'string' && message.trim()
        ? message
        : tr("请检查网络连接或服务器运行状态。"),
      7000
    )
    return false
  } finally {
    submitting.value = false
  }
}

const confirmDialog = ref(null)
useUnsavedChanges(hasUnsavedChanges, submitTask, confirmDialog)
</script>

<template>
  <ConfirmDialog ref="confirmDialog" />
  <div class="pointer-events-none fixed right-4 top-20 z-50 flex w-[calc(100vw-2rem)] flex-col items-end gap-2 sm:w-auto">
    <AppAlert
      v-for="alert in alerts"
      :key="alert.id"
      class="pointer-events-auto"
      :type="alert.type"
      :title="alert.title"
      :description="alert.description"
      :timeout="alert.timeout"
      @close="closeAlertById(alert.id)"
    />
  </div>

  <div class="page-shell">
    <h1 class="page-title mb-5">{{ tr("创建任务") }}</h1>
    <div class="card bg-base-100 card-border border-base-300 w-full p-5">
      <div class="grid grid-cols-1 gap-4">
        <fieldset class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label for="create_task_targets" class="input_items_required">{{ tr("扫描目标") }}</label></legend>
          <textarea
            id="create_task_targets"
            ref="targetInputRef"
            v-model="targetInput"
            class="textarea w-full min-h-32"
            :class="targetValidationVisible && !targetValidation.valid ? 'textarea-error' : ''"
            required
            spellcheck="false"
            :placeholder="tr(&quot;输入 IPv4/CIDR、IPv6/CIDR 或域名；多个目标使用逗号或换行分隔&quot;)"
            :aria-invalid="targetValidationVisible && !targetValidation.valid"
            aria-describedby="create_task_targets_help"
            @blur="targetTouched = true"
          ></textarea>
          <span
            id="create_task_targets_help"
            class="label text-wrap text-xs"
            :class="targetValidationVisible && !targetValidation.valid ? 'text-error' : 'text-base-content/60'"
          >
            {{ targetValidationVisible
              ? targetSummary
              : tr("逗号和换行均可作为分隔符，但一次只能使用一种；域名至少包含一个点，标签限 63 字节、总长限 253 字节。") }}
          </span>
        </fieldset>

        <div class="space-y-3">
          <details name="create-task-options" class="create-task-accordion collapse collapse-arrow border border-base-300 bg-base-100" open>
            <summary class="collapse-title min-h-0 py-3 pr-12">
              <span class="block font-medium">{{ tr("扫描模式") }}</span>
              <span class="mt-0.5 block text-xs text-base-content/60">
                {{ scanSettingsLoading ? tr("正在读取系统默认模式...") : tr("当前：{0}", [selectedScanProfileTitle]) }}
              </span>
            </summary>
            <div class="collapse-content">
              <fieldset class="pt-1" :disabled="scanSettingsLoading">
                <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <label
                    v-for="profile in scanProfiles.filter(p=>!isDnsTask || !p.ipOnly)"
                    :key="profile.value"
                    class="flex items-start gap-2 rounded-lg border border-transparent bg-base-200/50 p-3"
                    :class="[
                      scanProfile === profile.value ? 'border-base-content/60' : '',
                      profile.domainOnly && !isDnsTask ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'
                    ]"
                  >
                    <input
                      v-model="scanProfile"
                      class="radio radio-sm mt-0.5"
                      type="radio"
                      :value="profile.value"
                      :disabled="profile.domainOnly && !isDnsTask"
                    />
                    <span>
                      <span class="block font-medium">{{ profile.title }}</span>
                      <span class="mt-1 block text-xs leading-5 opacity-60">
                        {{ isDnsTask && profile.domainDescription ? profile.domainDescription : profile.description }}
                      </span>
                      <span v-if="profile.domainOnly && !isDnsTask" class="mt-1 block text-xs text-warning">{{ tr("仅域名目标可选") }}</span>
                    </span>
                  </label>
                </div>
                <p class="mt-2 text-xs opacity-60">
                  {{ scanSettingsLoading ? tr("正在读取系统默认模式...") : selectedScanProfileDescription }}
                </p>
              </fieldset>
              <fieldset v-if="['service_inventory', 'vulnerability_scan', 'udp_inventory'].includes(scanProfile)" class="fieldset mt-3 rounded-lg bg-base-200/50 p-3">
                <legend class="fieldset-legend">{{ tr("自动服务识别") }}</legend>
                <p v-if="scanProfile === 'udp_inventory'" class="text-xs opacity-60">{{ tr("自动尝试 DNS、EtherNet/IP 和 BACnet/IP（仅 IPv4），无需选择协议。请填写最多 32 个明确的 UDP 端口；仅确认匹配响应，超时不标记端口开放或关闭。") }}</p>
                <template v-else>
                  <p class="text-xs opacity-60">{{ tr("自动识别扫描器支持的全部 TCP 服务协议，无需逐项选择。根据端口与响应进行探测，非标准端口的覆盖受节点识别策略和探测预算限制。") }}</p>
                  <label class="label mt-2 cursor-pointer justify-start gap-2">
                    <input v-model="webContentEnabled" type="checkbox" class="checkbox checkbox-sm" />
                    <span class="text-sm">{{ tr("抓取网页内容（favicon / JS / 正文）") }}</span>
                  </label>
                  <p class="text-xs opacity-60">{{ tr("默认开启，并发异步抓取；支持 icon_md5、js_name、js_md5 搜索与图标展示。关闭后本任务不产生网页资产数据。") }}</p>
                  <details class="collapse collapse-arrow rounded-lg bg-base-100">
                    <summary class="collapse-title min-h-0 py-3 text-sm font-medium">{{ tr("高级识别参数（可选）") }}</summary>
                    <div class="collapse-content">
                      <div class="grid gap-3 sm:grid-cols-2">
                        <label class="fieldset"><span class="label">{{ tr("TLS 服务名 / SNI（可选）") }}</span><input v-model="probeServerName" class="input input-sm w-full" maxlength="253" placeholder="dns.example.com" /><span class="text-xs opacity-60">{{ tr("用于 DoT、DoH 和 MQTTS 的证书校验；连接仍固定到目标 IP。") }}</span></label>
                        <label class="fieldset"><span class="label">{{ tr("DoH 路径") }}</span><input v-model="dohPath" class="input input-sm w-full" maxlength="256" placeholder="/dns-query" /></label>
                        <label class="fieldset sm:col-span-2"><span class="label">{{ tr("额外受信 CA（PEM，可选）") }}</span><textarea v-model="probeCaPem" class="textarea w-full font-mono text-xs" maxlength="65536" placeholder="-----BEGIN CERTIFICATE-----"></textarea><span class="text-xs opacity-60">{{ tr("仅接受公开 CA 证书；默认验证证书，不提交客户端私钥。") }}</span></label>
                      </div>
                      <div class="grid gap-3 sm:grid-cols-3">
                        <label class="fieldset"><span class="label">Modbus Unit ID</span><input v-model.number="modbusUnitId" type="number" min="0" max="255" class="input input-sm w-full" /></label>
                        <label class="fieldset"><span class="label">{{ tr("S7 TSAP（十进制）") }}</span><input v-model.number="s7Tsap" type="number" min="0" max="65535" class="input input-sm w-full" /><span class="text-xs opacity-60">{{ tr("默认 258（0x0102），不枚举机架或插槽。") }}</span></label>
                        <label class="fieldset"><span class="label">{{ tr("MQTT 协议版本") }}</span><select v-model.number="mqttVersion" class="select select-sm w-full"><option :value="4">3.1.1</option><option :value="5">5.0</option></select></label>
                      </div>
                      <p class="text-xs opacity-60">{{ tr("参数用于相应协议的自动识别，不限制协议范围。工业探测仅进行最小握手或设备标识查询，不读取过程数据或执行控制写入。") }}</p>
                    </div>
                  </details>
                </template>
              </fieldset>
              <div v-if="isDnsTask" class="mt-3 rounded-lg bg-base-200/50 p-3 text-sm">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p class="font-medium">{{ tr("解析服务器") }}</p>
                    <p class="mt-1 text-xs text-base-content/60">{{ tr("指定多台服务器后，将对同一域名记录进行逐台对比。") }}</p>
                  </div>
                  <select v-model="dnsResolverMode" class="select select-sm w-full sm:w-auto">
                    <option value="system">{{ tr("使用扫描器系统 DNS") }}</option>
                    <option v-if="dnsResolverPresets.length" value="preset">{{ tr("选择常用 DNS 服务器") }}</option>
                    <option value="specified">{{ tr("临时指定 DNS 服务器") }}</option>
                  </select>
                </div>
                <div v-if="dnsResolverMode === 'preset'" class="mt-3 grid gap-2 sm:grid-cols-2">
                  <label v-for="resolver in dnsResolverPresets" :key="resolver.id" class="label cursor-pointer justify-start gap-3 rounded-lg border border-base-300 bg-base-100 px-3">
                    <input v-model="selectedDnsResolverIds" type="checkbox" class="checkbox checkbox-sm" :value="resolver.id" :disabled="!selectedDnsResolverIds.includes(resolver.id) && selectedDnsResolverIds.length >= 8" />
                    <span><span class="block font-medium">{{ resolver.label }}</span><span class="text-xs opacity-60">{{ resolver.ip }}:{{ resolver.port }}/{{ resolver.transport }}</span></span>
                  </label>
                </div>
                <div v-if="dnsResolverMode === 'specified'" class="mt-3 space-y-2">
                  <div v-for="(resolver, index) in dnsResolvers" :key="index" class="grid gap-2 rounded-lg border border-base-300 bg-base-100 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_6rem_6rem_auto]">
                    <input v-model="resolver.id" class="input input-sm w-full" maxlength="64" :placeholder="tr(&quot;ID，如 dns-1&quot;)" />
                    <input v-model="resolver.label" class="input input-sm w-full" maxlength="128" :placeholder="tr(&quot;名称&quot;)" />
                    <input v-model="resolver.ip" class="input input-sm w-full" :placeholder="tr(&quot;IP 地址&quot;)" />
                    <input v-model.number="resolver.port" class="input input-sm w-full" type="number" min="1" max="65535" :aria-label="tr(&quot;DNS 端口&quot;)" />
                    <select v-model="resolver.transport" class="select select-sm w-full" :aria-label="tr(&quot;DNS 传输协议&quot;)"><option value="udp">UDP</option><option value="tcp">TCP</option></select>
                    <button type="button" class="btn btn-ghost btn-sm text-error" @click="removeDnsResolver(index)">{{ tr("删除") }}</button>
                  </div>
                  <button type="button" class="btn btn-outline btn-sm" :disabled="dnsResolvers.length >= 8" @click="addDnsResolver">{{ tr("添加 DNS 服务器") }}</button>
                </div>
              </div>
            </div>
          </details>

          <details name="create-task-options" class="create-task-accordion collapse collapse-arrow border border-base-300 bg-base-100">
            <summary class="collapse-title min-h-0 py-3 pr-12">
              <span class="block font-medium">{{ tr("执行扫描器") }}</span>
              <span class="mt-0.5 block text-xs text-base-content/60">{{ tr("当前：") }}{{ dispatchModeSummary }}</span>
            </summary>
            <div class="collapse-content">
              <fieldset class="pt-1">
                <p v-if="isDnsTask" class="mb-2 text-xs text-base-content/60"> {{ tr("所选扫描器执行域名 DNS 阶段；解析地址生成的 IP 子任务继续按地址族和扫描能力调度。") }} </p>
                <div class="grid gap-2 md:grid-cols-3">
                  <label class="flex cursor-pointer items-start gap-2 rounded-lg bg-base-200/50 p-3">
                    <input v-model="dispatchMode" class="radio radio-sm mt-0.5" type="radio" value="automatic" />
                    <span><span class="block font-medium">{{ tr("自动分配") }}</span><span class="text-xs opacity-60">{{ tr("按地域、能力和历史反馈分配") }}</span></span>
                  </label>
                  <label class="flex cursor-pointer items-start gap-2 rounded-lg bg-base-200/50 p-3">
                    <input v-model="dispatchMode" class="radio radio-sm mt-0.5" type="radio" value="selected" />
                    <span><span class="block font-medium">{{ tr("指定扫描器") }}</span><span class="text-xs opacity-60">{{ tr("选择一台或多台分别执行") }}</span></span>
                  </label>
                  <label class="flex cursor-pointer items-start gap-2 rounded-lg bg-base-200/50 p-3">
                    <input v-model="dispatchMode" class="radio radio-sm mt-0.5" type="radio" value="all" />
                    <span><span class="block font-medium">{{ tr("全部扫描器") }}</span><span class="text-xs opacity-60">{{ tr("所有已启用扫描器各执行一次，离线设备上线后执行") }}</span></span>
                  </label>
                </div>
                <div v-if="dispatchMode === 'automatic'" class="mt-3 space-y-2">
                  <button type="button" class="btn btn-outline btn-sm" :disabled="placementLoading || !targetValidation.valid" @click="previewPlacement"><span v-if="placementLoading" class="loading loading-spinner loading-xs"></span>{{ tr("预览扫描器分配") }}</button>
                  <div v-if="placement" class="rounded-lg bg-base-200/50 p-3 text-sm">
                    <p>{{ tr("目标地域：") }}{{ routingLocation(placement.target_geo) }}</p>
                    <p v-if="!placement.enabled" class="mt-1 opacity-70">{{ tr("智能分配已关闭，任务由兼容扫描器领取。") }}</p>
                    <p v-else-if="!placement.preferred_scanner_id" class="mt-1 opacity-70">{{ tr("当前暂无空闲兼容节点，任务提交后排队等待。") }}</p>
                    <div v-for="candidate in placement.candidates.slice(0, 5)" :key="candidate.scanner_id" class="mt-2 flex flex-wrap gap-2">
                      <span class="font-medium">{{ candidate.name }}</span><span v-if="candidate.scanner_id === placement.preferred_scanner_id && placement.enabled" class="badge badge-sm badge-success">{{ tr("推荐") }}</span>
                      <span class="opacity-70">{{ routingLocation(candidate.geo) }} · {{ candidate.reasons.map(routingReason).join('、') }}</span>
                    </div>
                    <p class="mt-2 text-xs opacity-60">{{ tr("预览基于当前状态，实际领取时重新校验。") }}</p>
                  </div>
                </div>
                <div v-if="dispatchMode === 'selected'" class="mt-3 rounded-lg border border-base-300 p-3">
                  <div v-if="scannersLoading" class="flex items-center gap-2 text-sm opacity-70"><span class="loading loading-spinner loading-xs"></span>{{ tr("加载扫描器...") }}</div>
                  <div v-else-if="scanners.length === 0" class="text-sm opacity-70">{{ tr("暂无已启用扫描器") }}</div>
                  <div v-else class="grid gap-2 md:grid-cols-2">
                    <label v-for="scanner in scanners" :key="scanner.scanner_id" class="flex items-center gap-3 rounded-lg bg-base-200/50 px-3 py-2" :class="scannerSupportsTarget(scanner) ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'">
                      <input v-model="scannerIds" class="checkbox checkbox-sm" type="checkbox" :value="scanner.scanner_id" :disabled="!scannerSupportsTarget(scanner)" />
                      <span class="min-w-0">
                        <span class="block truncate text-sm font-medium">{{ scanner.name || tr("未命名扫描器") }}</span>
                        <span class="block truncate text-xs opacity-60">{{ scanner.location || tr("未设置位置") }} · {{ scanner.is_online ? tr("在线") : tr("离线") }} · IPv4 {{ scanner.ipv4_ready ? tr("可用") : tr("不可用") }} / IPv6 {{ scanner.ipv6_ready ? tr("可用") : tr("不可用") }} · {{ scannerSupportsProfile(scanner) ? (isDnsTask ? tr("支持 DNS 阶段") : tr("支持当前模式")) : (isDnsTask ? tr("不支持 DNS 阶段") : tr("不支持当前模式")) }}</span>
                      </span>
                    </label>
                  </div>
                </div>
              </fieldset>
            </div>
          </details>

        </div>

        <fieldset v-if="scanRequiresPort" class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label for="create_task_port" class="input_items_required">{{ isDnsTask ? tr("解析 IP 的目标端口") : tr("目标端口") }}</label></legend>
          <input
            id="create_task_port"
            ref="portInputRef"
            v-model="port"
            class="task_input_items peer w-full"
            type="text"
            :placeholder="scanProfile === &#39;udp_inventory&#39; ? tr(&quot;请填写明确的 UDP 端口，如 53,44818,47808&quot;) : isDnsTask ? tr(&quot;请输入解析 IP 的目标端口，留空默认全端口&quot;) : tr(&quot;请输入目标端口，留空默认全端口&quot;)"
            pattern="^((6553[0-5]|655[0-2]\d|65[0-4]\d{2}|6[0-4]\d{3}|[1-5]\d{4}|[1-9]\d{0,3})(-(6553[0-5]|655[0-2]\d|65[0-4]\d{2}|6[0-4]\d{3}|[1-5]\d{4}|[1-9]\d{0,3}))?)(,((6553[0-5]|655[0-2]\d|65[0-4]\d{2}|6[0-4]\d{3}|[1-5]\d{4}|[1-9]\d{0,3})(-(6553[0-5]|655[0-2]\d|65[0-4]\d{2}|6[0-4]\d{3}|[1-5]\d{4}|[1-9]\d{0,3}))?))*$"
          />
          <div class="max-h-0 overflow-hidden opacity-0 transition-all duration-200 ease-in-out peer-[&:not(:placeholder-shown):invalid]:mt-1 peer-[&:not(:placeholder-shown):invalid]:max-h-10 peer-[&:not(:placeholder-shown):invalid]:opacity-100 text-error text-xs"> {{ tr("请输入正确的端口") }} </div>
        </fieldset>

        <fieldset class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label :for="`${formFieldId}-2`">{{ tr("优先级") }}</label></legend>
          <select :id="`${formFieldId}-2`" v-model.number="level" class="select w-full">
            <option value="1">{{ tr("低级") }}</option>
            <option value="0">{{ tr("最低（与系统自动生成扫描任务级别一致）") }}</option>
            <option value="2">{{ tr("中级") }}</option>
            <option value="3">{{ tr("高级") }}</option>
            <option value="4">{{ tr("紧急") }}</option>
          </select>
        </fieldset>

        <fieldset class="fieldset min-w-0 w-full">
          <legend class="fieldset-legend"><label for="create_task_remark" class="text-base-content/60">{{ tr("备注") }}</label></legend>
          <textarea
            id="create_task_remark"
            v-model="remark"
            class="textarea w-full"
            :placeholder="tr(&quot;备注，最长不超过 200 个字符&quot;)"
            maxlength="200"
          ></textarea>
        </fieldset>
      </div>

      <div class="flex justify-end mt-3">
        <button id="task_submit" class="btn rounded-lg btn-neutral w-full md:w-auto" :disabled="submitting || scanSettingsLoading" @click="submitTask">
          {{ submitting ? tr("提交中...") : tr("提交") }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.task_input_items,
.textarea,
.select {
  text-align: left;
}

.task_input_items::placeholder,
.textarea::placeholder {
  text-align: left;
}

.create-task-accordion {
  transition:
    border-color 200ms ease,
    box-shadow 200ms ease;
}

.create-task-accordion[open] {
  border-color: color-mix(in oklab, var(--color-neutral) 35%, var(--color-base-300));
  box-shadow: 0 1px 3px color-mix(in oklab, var(--color-base-content) 8%, transparent);
}

.create-task-accordion > summary {
  transition: background-color 200ms ease;
}

.create-task-accordion > summary:hover {
  background-color: color-mix(in oklab, var(--color-base-content) 5%, transparent);
}

</style>
