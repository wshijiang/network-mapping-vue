<script setup>
import { computed, ref } from 'vue'
import { tr } from '../i18n/index.js'
import http from '@/utils/http'
import AccessVerification from './AccessVerification.vue'

const emit = defineEmits(['saved'])
const dialog = ref(null)
const verification = ref(null)
const user = ref(null)
const form = ref(null)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const scanners = ref([])
const roles = [
  { id: 2, label: '普通用户' },
  { id: 3, label: '只读用户' },
  { id: 4, label: '审计用户' },
]
const permissions = [
  { id: 'read_results', label: '读取本人任务与结果', roles: [2, 3] },
  { id: 'create_scan', label: '创建扫描', roles: [2] },
  { id: 'cancel_scan', label: '取消本人扫描', roles: [2] },
  { id: 'retry_scan', label: '重试本人扫描', roles: [2] },
  { id: 'export_results', label: '导出本人扫描结果', roles: [2, 3] },
  { id: 'read_audit', label: '读取审计日志', roles: [4] },
  { id: 'export_audit', label: '导出审计日志', roles: [4] },
]
const available = computed(() => permissions.filter(permission => permission.roles.includes(form.value?.role)))
const withScan = computed(() => form.value?.permissions.includes('create_scan'))
const withAudit = computed(() => form.value?.role === 4)

function message(failure) {
  return failure?.response?.data?.error?.message || failure?.response?.data?.message || tr('权限操作失败，请稍后重试。')
}

async function open(target) {
  user.value = target
  error.value = ''
  form.value = null
  loading.value = true
  dialog.value.showModal()
  try {
    const [access, nodes] = await Promise.all([
      http.get(`/api/admin/users/${target.id}/access`),
      http.get('/api/scanner/list'),
    ])
    if (user.value !== target || !dialog.value.open) return
    const { role, version, policy } = access.data.data
    scanners.value = nodes.data.data || []
    form.value = {
      role, version, legacy: policy === null, reason: '',
      permissions: [...(policy?.permissions || [])],
      scanners: [...(policy?.scanners || [])],
      targetCidrs: (policy?.target_cidrs || []).join('\n'),
      domains: (policy?.domains || []).join('\n'),
      profiles: (policy?.profiles || []).join('\n'),
      auditCategories: (policy?.audit_categories || []).join('\n'),
      maxPriority: policy?.max_priority ?? 0,
      maxTargets: policy?.max_targets || 256,
      maxPorts: policy?.max_ports || 100,
      portRanges: (policy?.port_ranges || []).join(", "),
      maxActive: policy?.max_active_tasks || 5,
      tasksPerDay: policy?.tasks_per_day || 25,
      expiresAt: policy?.expires_at || '',
    }
  } catch (failure) {
    if (user.value === target) error.value = message(failure)
  } finally {
    if (user.value === target) loading.value = false
  }
}

function roleChanged() {
  form.value.permissions = form.value.permissions.filter(id => available.value.some(permission => permission.id === id))
}

function entries(input) {
  return [...new Set(input.split(/[\s,]+/).filter(Boolean))]
}

async function save() {
  saving.value = true
  error.value = ''
  const current = form.value
  const body = {
    role: current.role,
    expected_version: current.version,
    reason: current.reason.trim(),
    policy: {
      permissions: current.permissions,
      expires_at: current.expiresAt.trim() || null,
      target_cidrs: withScan.value ? entries(current.targetCidrs) : [],
      domains: withScan.value ? entries(current.domains) : [],
      scanners: withScan.value || current.role !== 4 ? current.scanners : [],
      profiles: withScan.value ? entries(current.profiles) : [],
      max_priority: withScan.value ? current.maxPriority : 0,
      max_targets: withScan.value ? current.maxTargets : 0,
      max_ports: withScan.value ? current.maxPorts : 0,
      port_ranges: withScan.value ? entries(current.portRanges) : [],
      max_active_tasks: withScan.value ? current.maxActive : 0,
      tasks_per_day: withScan.value ? current.tasksPerDay : 0,
      audit_categories: withAudit.value ? entries(current.auditCategories) : [],
    },
  }
  try {
    const url = `/api/admin/users/${user.value.id}/access`
    try {
      await http.put(url, body)
    } catch (failure) {
      if (failure?.response?.data?.error?.code !== 'step_up_required') throw failure
      if (!await verification.value.verify()) return
      await http.put(url, body)
    }
    dialog.value.close()
    emit('saved')
  } catch (failure) {
    error.value = message(failure)
  } finally {
    saving.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <dialog ref="dialog" class="modal" @cancel="saving && $event.preventDefault()" @close="user = null; form = null">
    <form class="modal-box w-[calc(100vw-2rem)] max-w-2xl" @submit.prevent="save">
      <h3 class="text-lg font-semibold">{{ tr('编辑权限') }} · {{ user?.username }}</h3>
      <p v-if="error" class="alert alert-error mt-4" role="alert">{{ error }}</p>
      <div v-if="loading" class="skeleton mt-4 h-32 w-full"></div>
      <template v-if="form">
        <p v-if="form.legacy" class="alert alert-warning mt-4">{{ tr('保存后，此账号将使用显式授权。原有应用凭据和未完成的扫描任务将失效。') }}</p>
        <fieldset class="fieldset mt-4">
          <legend class="fieldset-legend">{{ tr('角色') }}</legend>
          <select v-model.number="form.role" class="select select-bordered w-full" :aria-label="tr('角色')" @change="roleChanged">
            <option v-for="role in roles" :key="role.id" :value="role.id">{{ tr(role.label) }}</option>
          </select>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">{{ tr('允许的操作') }}</legend>
          <label v-for="permission in available" :key="permission.id" class="label">
            <input v-model="form.permissions" class="checkbox checkbox-sm" type="checkbox" :value="permission.id" />
            {{ tr(permission.label) }}
          </label>
        </fieldset>
        <fieldset v-if="form.role !== 4" class="fieldset">
          <legend class="fieldset-legend">{{ tr('授权扫描器') }}</legend>
          <div class="grid max-h-36 gap-2 overflow-auto sm:grid-cols-2">
            <label v-for="node in scanners" :key="node.scanner_id" class="label min-w-0">
              <input v-model="form.scanners" type="checkbox" class="checkbox checkbox-sm" :value="node.scanner_id" />
              <span class="truncate" :title="node.scanner_id">{{ node.name || node.scanner_id }}</span>
            </label>
          </div>
        </fieldset>
        <div v-if="withScan" class="grid gap-2 sm:grid-cols-2">
          <label class="fieldset"><span class="fieldset-legend">{{ tr('授权 CIDR') }}</span><textarea v-model="form.targetCidrs" class="textarea textarea-bordered w-full font-mono" placeholder="192.0.2.0/24"></textarea></label>
          <label class="fieldset"><span class="fieldset-legend">{{ tr('授权域名') }}</span><textarea v-model="form.domains" class="textarea textarea-bordered w-full font-mono" placeholder="example.org"></textarea></label>
          <label class="fieldset sm:col-span-2"><span class="fieldset-legend">{{ tr('授权扫描模式') }}</span><input v-model="form.profiles" class="input input-bordered w-full font-mono" placeholder="port_only, dns_records" required /></label>
          <label class="fieldset"><span class="fieldset-legend">{{ tr('最高优先级') }}</span><input v-model.number="form.maxPriority" class="input input-bordered w-full" type="number" min="0" max="4" required /></label>
          <label class="fieldset"><span class="fieldset-legend">{{ tr('每任务最多目标数') }}</span><input v-model.number="form.maxTargets" class="input input-bordered w-full" type="number" min="1" max="65536" required /></label>
          <label class="fieldset sm:col-span-2"><span class="fieldset-legend">{{ tr('授权端口范围') }}</span><input v-model="form.portRanges" class="input input-bordered w-full font-mono" placeholder="53, 80, 443, 8000-8010" required /></label>
          <label class="fieldset"><span class="fieldset-legend">{{ tr('每任务最多端口数') }}</span><input v-model.number="form.maxPorts" class="input input-bordered w-full" type="number" min="1" max="65535" required /></label>
          <label class="fieldset"><span class="fieldset-legend">{{ tr('最多未完成任务数') }}</span><input v-model.number="form.maxActive" class="input input-bordered w-full" type="number" min="1" max="100" required /></label>
          <label class="fieldset"><span class="fieldset-legend">{{ tr('每 24 小时最多任务数') }}</span><input v-model.number="form.tasksPerDay" class="input input-bordered w-full" type="number" min="1" max="10000" required /></label>
        </div>
        <label v-if="withAudit" class="fieldset"><span class="fieldset-legend">{{ tr('授权审计类别') }}</span><input v-model="form.auditCategories" class="input input-bordered w-full font-mono" placeholder="authorization, user_security, task" /></label>
        <label class="fieldset"><span class="fieldset-legend">{{ tr('到期时间（RFC3339，可留空）') }}</span><input v-model="form.expiresAt" class="input input-bordered w-full" placeholder="2027-01-01T00:00:00+08:00" /></label>
        <label class="fieldset"><span class="fieldset-legend">{{ tr('变更原因') }}</span><textarea v-model="form.reason" class="textarea textarea-bordered w-full" maxlength="500" required></textarea></label>
      </template>
      <div class="modal-action">
        <button type="button" class="btn" :disabled="saving" @click="dialog.close()">{{ tr('取消') }}</button>
        <button type="submit" class="btn btn-neutral" :disabled="!form || saving">{{ tr('保存权限') }}</button>
      </div>
    </form>
  </dialog>
  <AccessVerification ref="verification" />
</template>
