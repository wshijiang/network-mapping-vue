<script setup>
import { tr } from '../i18n/index.js'

import { formatDateTime as formatSystemDateTime } from '../i18n/time.js'
import { computed, onMounted, ref, useId } from 'vue'
import AppAlert from '@/components/AppAlert.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import http from '@/utils/http'

const formFieldId = useId()
const confirmDialog = ref(null)
const alerts = ref([])
const users = ref([])
const stats = ref({ total: 0, active: 0, disabled: 0, locked: 0, activeSessions: 0 })
const pagination = ref({ page: 1, pageSize: 20, total: 0, totalPages: 1 })
const filters = ref({ query: '', role: '', status: 'all' })
const loading = ref(false)
const initialLoadFailed = ref(false)
const actionUserId = ref(null)
const creating = ref(false)
const createDialog = ref(null)
const deleteDialog = ref(null)
const loginDialog = ref(null)
const allowlistDialog = ref(null)
const deleteTarget = ref(null)
const deleteConfirmation = ref('')
const showPassword = ref(false)
const createForm = ref(emptyCreateForm())
const loginTarget = ref(null)
const loginRecords = ref([])
const loginRecordsLoading = ref(false)
const loginRecordsFailed = ref(false)
const loginOutcome = ref('')
const loginPagination = ref({ page: 1, pageSize: 10, total: 0, totalPages: 1 })
const allowlistTarget = ref(null)
const allowlistText = ref('')
const allowlistLoading = ref(false)
const allowlistSaving = ref(false)
const maximumAllowlistEntries = ref(64)

const allowlistEntries = computed(() => (
  [...new Set(allowlistText.value.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean))]
))

function emptyCreateForm() {
  return { username: '', email: '', password: '', role: 2 }
}

function pushAlert(type, title, description = '', timeout = 7000) {
  alerts.value.unshift({ id: crypto.randomUUID(), type, title, description, timeout })
}

function closeAlert(id) {
  alerts.value = alerts.value.filter((alert) => alert.id !== id)
}

function apiMessage(error, fallback) {
  if (error?.response?.status === 403) return tr("仅管理员可以执行此操作。")
  return error?.response?.data?.message || fallback
}

function formatTime(value) {
  if (value === null || value === undefined || value === '') return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return formatSystemDateTime(date)
}

function statusInfo(status) {
  const values = {
    active: { get label() { return tr("正常") }, class: 'badge-success' },
    disabled: { get label() { return tr("已禁用") }, class: 'badge-error' },
    locked: { get label() { return tr("登录锁定") }, class: 'badge-warning' },
    deleted: { get label() { return tr("已删除") }, class: 'badge-ghost' }
  }
  return values[status] || { label: status || tr("未知"), class: 'badge-ghost' }
}

function loginMethodLabel(value) {
  return value === 'password_totp' ? tr("密码 + 2FA") : tr("密码")
}

function loginReasonLabel(value) {
  return {
    get invalid_credentials() { return tr("用户名或密码错误") },
    get invalid_totp() { return tr("2FA 验证码错误") },
    get ip_not_allowlisted() { return tr("登录 IP 不在白名单中") },
    get legacy_login_failure() { return tr("旧版登录失败") }
  }[value] || '--'
}

const hasUsers = computed(() => users.value.length > 0)
const canDelete = computed(() => (
  deleteTarget.value && deleteConfirmation.value === deleteTarget.value.username
))

async function loadUsers({ page = pagination.value.page, silent = false } = {}) {
  if (loading.value) return
  loading.value = true
  try {
    const params = {
      page,
      pageSize: pagination.value.pageSize,
      status: filters.value.status
    }
    if (filters.value.query.trim()) params.query = filters.value.query.trim()
    if (filters.value.role) params.role = Number(filters.value.role)
    const response = await http.get('/api/admin/users', { params })
    if (response.data?.success !== true || !Array.isArray(response.data?.data)) {
      throw new Error(tr("服务器未返回有效用户列表"))
    }
    users.value = response.data.data
    stats.value = response.data.stats || stats.value
    pagination.value = response.data.pagination || pagination.value
    initialLoadFailed.value = false
  } catch (error) {
    console.error('load managed users failed', error)
    initialLoadFailed.value = users.value.length === 0
    if (!silent) pushAlert('error', tr("用户列表加载失败"), apiMessage(error, tr("请稍后重试。")))
  } finally {
    loading.value = false
  }
}

function applyFilters() {
  loadUsers({ page: 1 })
}

function clearFilters() {
  filters.value = { query: '', role: '', status: 'all' }
  loadUsers({ page: 1 })
}

function openCreateDialog() {
  createForm.value = emptyCreateForm()
  showPassword.value = false
  createDialog.value?.showModal()
}

function closeCreateDialog() {
  createDialog.value?.close()
}

function validateCreateForm() {
  const usernameLength = createForm.value.username.trim().length
  if (usernameLength < 3 || usernameLength > 64) return tr("用户名长度必须为 3-64 个字符")
  const passwordLength = createForm.value.password.length
  if (passwordLength < 12 || passwordLength > 256) return tr("密码长度必须为 12-256 个字符")
  return ''
}

async function createUser() {
  if (creating.value) return
  const validationMessage = validateCreateForm()
  if (validationMessage) {
    pushAlert('warning', tr("创建信息不完整"), validationMessage)
    return
  }
  creating.value = true
  try {
    await http.post('/api/admin/users', {
      username: createForm.value.username.trim(),
      email: createForm.value.email.trim() || null,
      password: createForm.value.password,
      role: Number(createForm.value.role)
    })
    closeCreateDialog()
    pushAlert('success', tr("用户已创建"), tr("{0} 现在可以登录系统。", [createForm.value.username.trim()]), 5000)
    await loadUsers({ page: 1, silent: true })
  } catch (error) {
    console.error('create managed user failed', error)
    pushAlert('error', tr("创建用户失败"), apiMessage(error, tr("请检查输入后重试。")))
  } finally {
    creating.value = false
  }
}

async function runUserAction(user, request, successTitle, successDescription = '') {
  if (actionUserId.value !== null) return false
  actionUserId.value = user.id
  try {
    const response = await request()
    pushAlert('success', successTitle, response.data?.message || successDescription, 5000)
    await loadUsers({ silent: true })
    return true
  } catch (error) {
    console.error('managed user action failed', error)
    pushAlert('error', tr("用户操作失败"), apiMessage(error, tr("请稍后重试。")))
    return false
  } finally {
    actionUserId.value = null
  }
}

async function toggleUser(user) {
  const enabled = user.status === 'disabled'
  const actionLabel = enabled ? tr("启用") : tr("禁用")
  const warning = enabled
    ? tr("确定启用用户“{0}”吗？", [user.username])
    : tr("确定禁用用户“{0}”吗？该用户的现有会话会立即失效。", [user.username])
  if (!await confirmDialog.value.ask({ message: warning, confirmText: actionLabel, danger: !enabled })) return
  runUserAction(
    user,
    () => http.patch(`/api/admin/users/${user.id}/status`, { enabled }),
    tr("用户已{0}", [actionLabel])
  )
}

async function kickUser(user) {
  if (!await confirmDialog.value.ask({ message: tr("确定踢出用户“{0}”吗？该用户需要重新登录。", [user.username]), confirmText: tr("踢出"), danger: true })) return
  runUserAction(
    user,
    () => http.post(`/api/admin/users/${user.id}/kick`),
    tr("用户会话已处理")
  )
}

function openDeleteDialog(user) {
  deleteTarget.value = user
  deleteConfirmation.value = ''
  deleteDialog.value?.showModal()
}

function closeDeleteDialog() {
  deleteDialog.value?.close()
  deleteTarget.value = null
  deleteConfirmation.value = ''
}

async function deleteUser() {
  const user = deleteTarget.value
  if (!user || !canDelete.value) return
  const deleted = await runUserAction(
    user,
    () => http.delete(`/api/admin/users/${user.id}`),
    tr("用户已删除"),
    tr("账号已软删除，历史任务和审计记录得到保留。")
  )
  if (deleted) closeDeleteDialog()
}

async function loadLoginRecords(page = loginPagination.value.page) {
  if (!loginTarget.value || loginRecordsLoading.value) return
  loginRecordsLoading.value = true
  try {
    const params = { page, pageSize: loginPagination.value.pageSize }
    if (loginOutcome.value) params.outcome = loginOutcome.value
    const response = await http.get(`/api/admin/users/${loginTarget.value.id}/login-records`, { params })
    loginRecords.value = response.data?.data || []
    loginPagination.value = response.data?.pagination || loginPagination.value
    loginRecordsFailed.value = false
  } catch (error) {
    console.error('load managed user login records failed', error)
    loginRecordsFailed.value = true
    pushAlert('error', tr("登录记录加载失败"), apiMessage(error, tr("请稍后重试。")))
  } finally {
    loginRecordsLoading.value = false
  }
}

function openLoginDialog(user) {
  loginTarget.value = user
  loginRecords.value = []
  loginOutcome.value = ''
  loginPagination.value = { page: 1, pageSize: 10, total: 0, totalPages: 1 }
  loginRecordsFailed.value = false
  loginDialog.value?.showModal()
  loadLoginRecords(1)
}

function closeLoginDialog() {
  loginDialog.value?.close()
  loginTarget.value = null
  loginRecords.value = []
}

async function openAllowlistDialog(user) {
  allowlistTarget.value = user
  allowlistText.value = ''
  allowlistLoading.value = true
  allowlistDialog.value?.showModal()
  try {
    const response = await http.get(`/api/admin/users/${user.id}/login-ip-allowlist`)
    allowlistText.value = Array.isArray(response.data?.data?.entries)
      ? response.data.data.entries.join('\n')
      : ''
    maximumAllowlistEntries.value = Number(response.data?.limits?.maximumEntries) || 64
  } catch (error) {
    console.error('load managed user login IP allowlist failed', error)
    pushAlert('error', tr("登录白名单加载失败"), apiMessage(error, tr("请稍后重试。")))
    allowlistDialog.value?.close()
  } finally {
    allowlistLoading.value = false
  }
}

function closeAllowlistDialog() {
  if (!allowlistSaving.value) allowlistDialog.value?.close()
}

async function saveManagedAllowlist() {
  if (!allowlistTarget.value || allowlistSaving.value) return
  if (allowlistEntries.value.length > maximumAllowlistEntries.value) {
    pushAlert('warning', tr("登录白名单条目过多"), tr("最多允许 {0} 条地址。", [maximumAllowlistEntries.value]))
    return
  }
  allowlistSaving.value = true
  try {
    const response = await http.put(
      `/api/admin/users/${allowlistTarget.value.id}/login-ip-allowlist`,
      { entries: allowlistEntries.value },
      { validateStatus: () => true }
    )
    if (response.status !== 200 || response.data?.success !== true) {
      pushAlert('error', tr("登录白名单保存失败"), response.data?.message || tr("请检查 IP 和 CIDR 格式后重试。"))
      return
    }
    const count = response.data?.data?.entries?.length || 0
    const managedUser = users.value.find((value) => value.id === allowlistTarget.value.id)
    if (managedUser) managedUser.loginIpAllowlistCount = count
    allowlistDialog.value?.close()
    pushAlert('success', tr("登录白名单已保存"), count ? tr("已配置 {0} 条允许地址。", [count]) : tr("登录来源限制已清空。"), 5000)
  } catch (error) {
    console.error('save managed user login IP allowlist failed', error)
    pushAlert('error', tr("登录白名单保存失败"), apiMessage(error, tr("请稍后重试。")))
  } finally {
    allowlistSaving.value = false
  }
}

onMounted(() => loadUsers({ page: 1 }))
</script>

<template>
  <div class="pointer-events-none fixed right-4 top-20 z-50 flex w-[calc(100vw-2rem)] flex-col items-end gap-2 sm:w-auto">
    <AppAlert
      v-for="alert in alerts"
      :key="alert.id"
      class="pointer-events-auto"
      :type="alert.type"
      :title="alert.title"
      :description="alert.description"
      :timeout="alert.timeout"
      @close="closeAlert(alert.id)"
    />
  </div>

  <div class="page-shell">
    <ConfirmDialog ref="confirmDialog" />
    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 class="page-title">{{ tr("用户管理") }}</h1>
        <p class="mt-1 text-xs opacity-60">{{ tr("创建账号、控制登录权限，并管理当前有效会话。") }}</p>
      </div>
      <button class="btn btn-neutral btn-sm" @click="openCreateDialog">{{ tr("创建用户") }}</button>
    </div>

    <div class="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <div class="stat rounded-box border border-base-300 bg-base-100 p-4">
        <div class="stat-title text-xs">{{ tr("用户总数") }}</div><div class="stat-value text-2xl">{{ stats.total }}</div>
      </div>
      <div class="stat rounded-box border border-base-300 bg-base-100 p-4">
        <div class="stat-title text-xs">{{ tr("正常用户") }}</div><div class="stat-value text-2xl text-success">{{ stats.active }}</div>
      </div>
      <div class="stat rounded-box border border-base-300 bg-base-100 p-4">
        <div class="stat-title text-xs">{{ tr("已禁用") }}</div><div class="stat-value text-2xl text-error">{{ stats.disabled }}</div>
      </div>
      <div class="stat rounded-box border border-base-300 bg-base-100 p-4">
        <div class="stat-title text-xs">{{ tr("登录锁定") }}</div><div class="stat-value text-2xl text-warning">{{ stats.locked }}</div>
      </div>
      <div class="stat col-span-2 rounded-box border border-base-300 bg-base-100 p-4 lg:col-span-1">
        <div class="stat-title text-xs">{{ tr("有效会话") }}</div><div class="stat-value text-2xl">{{ stats.activeSessions }}</div>
      </div>
    </div>

    <section class="card border border-base-300 bg-base-100 p-4">
      <form class="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[minmax(220px,1fr)_160px_160px_auto]" @submit.prevent="applyFilters">
        <input v-model="filters.query" class="input input-bordered w-full" :placeholder="tr(&quot;搜索用户名或邮箱&quot;)" />
        <select v-model="filters.role" class="select select-bordered w-full">
          <option value="">{{ tr("全部角色") }}</option><option value="1">{{ tr("管理员") }}</option><option value="2">{{ tr("普通用户") }}</option>
        </select>
        <select v-model="filters.status" class="select select-bordered w-full">
          <option value="all">{{ tr("未删除用户") }}</option><option value="active">{{ tr("正常") }}</option><option value="disabled">{{ tr("已禁用") }}</option><option value="locked">{{ tr("登录锁定") }}</option><option value="deleted">{{ tr("已删除") }}</option>
        </select>
        <div class="flex gap-2">
          <button class="btn btn-neutral grow" type="submit" :disabled="loading">{{ tr("查询") }}</button>
          <button class="btn btn-ghost" type="button" :disabled="loading" @click="clearFilters">{{ tr("重置") }}</button>
        </div>
      </form>

      <div v-if="loading && !hasUsers" class="grid min-h-72 place-items-center"><span class="loading loading-spinner loading-md"></span></div>
      <EmptyState v-else-if="initialLoadFailed" type="error" :title="tr(&quot;用户列表加载失败&quot;)" :message="tr(&quot;无法从服务器读取用户信息，请稍后重试。&quot;)" />
      <EmptyState v-else-if="!hasUsers" :title="tr(&quot;没有符合条件的用户&quot;)" :message="tr(&quot;请调整筛选条件，或创建一个新用户。&quot;)" />

      <div v-else class="overflow-x-auto">
        <table class="table table-zebra">
          <thead><tr><th>{{ tr("用户") }}</th><th>{{ tr("角色") }}</th><th>{{ tr("状态") }}</th><th>{{ tr("会话") }}</th><th>{{ tr("最近登录") }}</th><th>{{ tr("创建时间") }}</th><th class="text-right">{{ tr("操作") }}</th></tr></thead>
          <tbody>
            <tr v-for="managedUser in users" :key="managedUser.id">
              <td>
                <div class="font-medium">{{ managedUser.username }} <span v-if="managedUser.isSelf" class="badge badge-outline badge-xs">{{ tr("当前账号") }}</span></div>
                <div class="mt-1 max-w-52 truncate text-xs opacity-60">{{ managedUser.email || tr("未设置邮箱") }}</div>
              </td>
              <td><span class="badge badge-outline">{{ managedUser.role === 1 ? tr("管理员") : tr("普通用户") }}</span></td>
              <td><span class="badge" :class="statusInfo(managedUser.status).class">{{ statusInfo(managedUser.status).label }}</span><div v-if="managedUser.enable2fa" class="mt-1 text-xs opacity-60">{{ tr("已启用 2FA") }}</div></td>
              <td><span class="font-medium">{{ managedUser.activeSessionCount }}</span><span class="ml-1 text-xs opacity-60">{{ tr("个有效会话") }}</span></td>
              <td><div>{{ formatTime(managedUser.lastLoginAt) }}</div><div class="mt-1 text-xs opacity-60">{{ managedUser.lastLoginIp || '--' }}</div></td>
              <td>{{ formatTime(managedUser.createTime) }}</td>
              <td class="text-right">
                <div class="flex flex-wrap justify-end gap-1">
                  <button class="btn btn-ghost btn-xs" @click="openLoginDialog(managedUser)">{{ tr("登录记录") }}</button>
                  <template v-if="managedUser.status !== 'deleted'">
                    <button class="btn btn-ghost btn-xs" @click="openAllowlistDialog(managedUser)"> {{ tr("白名单") }}<span v-if="managedUser.loginIpAllowlistCount" class="badge badge-xs">{{ managedUser.loginIpAllowlistCount }}</span>
                    </button>
                    <button class="btn btn-ghost btn-xs" :disabled="managedUser.isSelf || actionUserId !== null || managedUser.activeSessionCount === 0" @click="kickUser(managedUser)">{{ tr("踢出") }}</button>
                    <button class="btn btn-outline btn-xs" :class="managedUser.status === 'disabled' ? 'btn-success' : 'btn-warning'" :disabled="managedUser.isSelf || actionUserId !== null" @click="toggleUser(managedUser)">{{ managedUser.status === 'disabled' ? tr("启用") : tr("禁用") }}</button>
                    <button class="btn btn-error btn-outline btn-xs" :disabled="managedUser.isSelf || actionUserId !== null" @click="openDeleteDialog(managedUser)">{{ tr("删除") }}</button>
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="hasUsers" class="mt-4 flex flex-col gap-2 border-t border-base-300 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <span class="text-xs opacity-60">{{ tr("共") }} {{ pagination.total }} {{ tr("条，第") }} {{ pagination.page }} / {{ pagination.totalPages }} {{ tr("页") }}</span>
        <div class="join">
          <button class="btn btn-sm join-item" :disabled="pagination.page <= 1 || loading" @click="loadUsers({ page: pagination.page - 1 })">{{ tr("上一页") }}</button>
          <button class="btn btn-sm join-item" :disabled="pagination.page >= pagination.totalPages || loading" @click="loadUsers({ page: pagination.page + 1 })">{{ tr("下一页") }}</button>
        </div>
      </div>
    </section>
  </div>

  <dialog ref="createDialog" class="modal" @close="createForm = emptyCreateForm()">
    <form class="modal-box w-[calc(100vw-2rem)] max-w-lg" @submit.prevent="createUser">
      <h3 class="text-lg font-semibold">{{ tr("创建用户") }}</h3>
      <p class="mt-1 text-xs opacity-60">{{ tr("用户名删除后不能复用；密码只在创建时提交，不会返回前端。") }}</p>
      <div class="mt-5 grid gap-4">
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-1`">{{ tr("用户名") }}</label></legend><input :id="`${formFieldId}-1`" v-model="createForm.username" class="input input-bordered w-full" maxlength="64" autocomplete="off" required /></fieldset>
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-2`">{{ tr("邮箱") }}</label></legend><input :id="`${formFieldId}-2`" v-model="createForm.email" type="email" class="input input-bordered w-full" maxlength="320" :placeholder="tr(&quot;可选&quot;)" /></fieldset>
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-3`">{{ tr("初始密码") }}</label></legend><div class="join w-full"><input :id="`${formFieldId}-3`" v-model="createForm.password" :type="showPassword ? 'text' : 'password'" class="input input-bordered join-item grow" minlength="12" maxlength="256" autocomplete="new-password" required /><button type="button" class="btn join-item" @click="showPassword = !showPassword">{{ showPassword ? tr("隐藏") : tr("显示") }}</button></div><span class="label text-wrap text-xs opacity-60">{{ tr("12-256 个字符") }}</span></fieldset>
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-4`">{{ tr("角色") }}</label></legend><select :id="`${formFieldId}-4`" v-model.number="createForm.role" class="select select-bordered w-full"><option :value="2">{{ tr("普通用户") }}</option><option :value="1">{{ tr("管理员") }}</option></select></fieldset>
      </div>
      <div class="modal-action"><button type="button" class="btn" :disabled="creating" @click="closeCreateDialog">{{ tr("取消") }}</button><button type="submit" class="btn btn-neutral" :disabled="creating"><span v-if="creating" class="loading loading-spinner loading-xs"></span>{{ tr("创建") }}</button></div>
    </form>
    <form method="dialog" class="modal-backdrop"><button :disabled="creating">{{ tr("关闭") }}</button></form>
  </dialog>

  <dialog ref="loginDialog" class="modal" @close="loginTarget = null; loginRecords = []">
    <div v-if="loginTarget" class="modal-box w-[calc(100vw-2rem)] max-w-5xl">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="text-lg font-semibold">{{ loginTarget.username }} {{ tr("的登录记录") }}</h3>
          <p class="mt-1 text-xs opacity-60">{{ tr("包含成功登录和密码、2FA 验证失败的尝试。") }}</p>
        </div>
        <select v-model="loginOutcome" class="select select-bordered select-sm" :disabled="loginRecordsLoading" @change="loadLoginRecords(1)">
          <option value="">{{ tr("全部结果") }}</option><option value="success">{{ tr("成功") }}</option><option value="failure">{{ tr("失败") }}</option>
        </select>
      </div>
      <div v-if="loginRecordsLoading" class="grid min-h-52 place-items-center"><span class="loading loading-spinner loading-md"></span></div>
      <EmptyState v-else-if="loginRecordsFailed" type="error" :title="tr(&quot;登录记录加载失败&quot;)" :message="tr(&quot;请稍后重试。&quot;)" />
      <EmptyState v-else-if="loginRecords.length === 0" :title="tr(&quot;暂无登录记录&quot;)" :message="tr(&quot;该用户还没有可显示的登录事件。&quot;)" />
      <div v-else class="mt-4 overflow-x-auto">
        <table class="table table-zebra">
          <thead><tr><th>{{ tr("时间") }}</th><th>{{ tr("结果") }}</th><th>{{ tr("认证方式") }}</th><th>{{ tr("来源 IP") }}</th><th>{{ tr("说明") }}</th><th>{{ tr("客户端") }}</th></tr></thead>
          <tbody>
            <tr v-for="record in loginRecords" :key="record.eventId">
              <td class="whitespace-nowrap">{{ formatTime(record.occurredAt) }}</td>
              <td><span class="badge badge-sm" :class="record.outcome === 'success' ? 'badge-success' : 'badge-error'">{{ record.outcome === 'success' ? tr("成功") : tr("失败") }}</span></td>
              <td>{{ loginMethodLabel(record.authMethod) }}</td>
              <td class="font-mono text-xs">{{ record.sourceIp || '--' }}</td>
              <td>{{ loginReasonLabel(record.reasonCode) }}</td>
              <td class="max-w-72 truncate text-xs" :title="record.userAgent || ''">{{ record.userAgent || '--' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="loginRecords.length" class="mt-4 flex items-center justify-between border-t border-base-300 pt-4 text-xs">
        <span class="opacity-60">{{ tr("共") }} {{ loginPagination.total }} {{ tr("条，第") }} {{ loginPagination.page }} / {{ loginPagination.totalPages }} {{ tr("页") }}</span>
        <div class="join">
          <button class="btn btn-sm join-item" :disabled="loginPagination.page <= 1 || loginRecordsLoading" @click="loadLoginRecords(loginPagination.page - 1)">{{ tr("上一页") }}</button>
          <button class="btn btn-sm join-item" :disabled="loginPagination.page >= loginPagination.totalPages || loginRecordsLoading" @click="loadLoginRecords(loginPagination.page + 1)">{{ tr("下一页") }}</button>
        </div>
      </div>
      <div class="modal-action"><button class="btn" :disabled="loginRecordsLoading" @click="closeLoginDialog">{{ tr("关闭") }}</button></div>
    </div>
    <form method="dialog" class="modal-backdrop"><button :disabled="loginRecordsLoading">{{ tr("关闭") }}</button></form>
  </dialog>

  <dialog ref="deleteDialog" class="modal" @close="deleteTarget = null; deleteConfirmation = ''">
    <div v-if="deleteTarget" class="modal-box w-[calc(100vw-2rem)] max-w-md">
      <h3 class="text-lg font-semibold text-error">{{ tr("删除用户") }}</h3>
      <p class="mt-3 text-sm">{{ tr("账号将被软删除并立即失去所有会话，历史任务和审计记录会保留。") }}</p>
      <p class="mt-3 text-sm">{{ tr("请输入用户名") }} <strong>{{ deleteTarget.username }}</strong> {{ tr("确认：") }}</p>
      <input v-model="deleteConfirmation" class="input input-bordered mt-2 w-full" autocomplete="off" />
      <div class="modal-action"><button class="btn" :disabled="actionUserId !== null" @click="closeDeleteDialog">{{ tr("取消") }}</button><button class="btn btn-error" :disabled="!canDelete || actionUserId !== null" @click="deleteUser"><span v-if="actionUserId === deleteTarget.id" class="loading loading-spinner loading-xs"></span>{{ tr("确认删除") }}</button></div>
    </div>
    <form method="dialog" class="modal-backdrop"><button :disabled="actionUserId !== null">{{ tr("关闭") }}</button></form>
  </dialog>

  <dialog ref="allowlistDialog" class="modal" @close="allowlistTarget = null; allowlistText = ''">
    <form v-if="allowlistTarget" class="modal-box w-[calc(100vw-2rem)] max-w-xl" @submit.prevent="saveManagedAllowlist">
      <h3 class="text-lg font-semibold">{{ allowlistTarget.username }} {{ tr("的登录 IP 白名单") }}</h3>
      <p class="mt-1 text-xs opacity-60">{{ tr("每行填写一个 IPv4、IPv6 或 CIDR。留空保存可解除因误配置造成的登录限制。") }}</p>
      <div v-if="allowlistLoading" class="skeleton mt-5 h-44 w-full rounded-box"></div>
      <template v-else>
        <fieldset class="fieldset mt-5 min-w-0 w-full">
          <legend class="fieldset-legend"><label for="user-management-allowlist">{{ tr("允许登录的地址") }}</label></legend>
          <textarea
            id="user-management-allowlist"
            v-model="allowlistText"
            class="textarea textarea-bordered min-h-44 w-full font-mono text-sm"
            placeholder="192.0.2.10&#10;10.0.0.0/8&#10;2001:db8::/48"
            :disabled="allowlistSaving"
          ></textarea>
        </fieldset>
        <div class="mt-2 flex justify-between gap-2 text-xs">
          <span class="opacity-60">{{ tr("回环地址和内网地址也必须显式配置。") }}</span>
          <span :class="allowlistEntries.length > maximumAllowlistEntries ? 'text-error' : 'opacity-60'">{{ allowlistEntries.length }} / {{ maximumAllowlistEntries }} {{ tr("条") }}</span>
        </div>
      </template>
      <div class="modal-action">
        <button type="button" class="btn" :disabled="allowlistSaving" @click="closeAllowlistDialog">{{ tr("取消") }}</button>
        <button type="submit" class="btn btn-neutral" :disabled="allowlistLoading || allowlistSaving || allowlistEntries.length > maximumAllowlistEntries">
          <span v-if="allowlistSaving" class="loading loading-spinner loading-xs"></span>{{ tr("保存") }} </button>
      </div>
    </form>
    <form method="dialog" class="modal-backdrop"><button :disabled="allowlistSaving">{{ tr("关闭") }}</button></form>
  </dialog>
</template>
