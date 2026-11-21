<script setup>
import { tr } from '../i18n/index.js'

import { computed, onMounted, ref, useId } from 'vue'
import AssetTags from '../components/AssetTags.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import http from '../utils/http'

const formFieldId = useId()
const confirmDialog = ref(null)
const categories = ref([])
const tags = ref([])
const loading = ref(false)
const actionLoading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const canManage = ref(false)

const searchText = ref('')
const categoryFilter = ref('')
const kindFilter = ref('')

const categoryDialogRef = ref(null)
const categoryForm = ref({ id: null, name: '', description: '', sort_order: 0 })
const tagDialogRef = ref(null)
const tagForm = ref({ id: null, name: '', category_id: '', kind: 'info', description: '' })

const ipInput = ref('')
const loadedIp = ref('')
const assignedTags = ref([])
const assetLoading = ref(false)
const assetError = ref('')
const selectedTagId = ref('')

const filteredTags = computed(() => {
  const query = searchText.value.trim().toLocaleLowerCase()
  return tags.value.filter((tag) => {
    if (categoryFilter.value && tag.category_id !== Number(categoryFilter.value)) return false
    if (kindFilter.value && tag.kind !== kindFilter.value) return false
    if (!query) return true
    return [tag.name, tag.description, tag.category_name]
      .filter(Boolean)
      .some((value) => value.toLocaleLowerCase().includes(query))
  })
})

const assignedTagIds = computed(() => new Set(assignedTags.value.map((tag) => tag.id)))
const availableTags = computed(() => tags.value.filter((tag) => !assignedTagIds.value.has(tag.id)))
const totalAssignments = computed(() => tags.value.reduce((total, tag) => total + Number(tag.assignment_count || 0), 0))

function clearMessages() {
  errorMessage.value = ''
  successMessage.value = ''
}

function apiMessage(error, fallback) {
  return error.response?.data?.message || fallback
}

async function loadCatalog() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [categoryResponse, tagResponse] = await Promise.all([
      http.get('/api/tag-categories'),
      http.get('/api/tags'),
    ])
    categories.value = categoryResponse.data?.data?.items || []
    tags.value = tagResponse.data?.data?.items || []
    canManage.value = Boolean(categoryResponse.data?.data?.can_manage && tagResponse.data?.data?.can_manage)
  } catch (error) {
    errorMessage.value = apiMessage(error, tr("标签数据加载失败。"))
  } finally {
    loading.value = false
  }
}

function openCategoryDialog(category = null) {
  clearMessages()
  categoryForm.value = category
    ? {
        id: category.id,
        name: category.name,
        description: category.description || '',
        sort_order: category.sort_order || 0,
      }
    : { id: null, name: '', description: '', sort_order: 0 }
  categoryDialogRef.value?.showModal()
}

async function saveCategory() {
  const payload = {
    name: categoryForm.value.name.trim(),
    description: categoryForm.value.description.trim() || null,
    sort_order: Number(categoryForm.value.sort_order) || 0,
  }
  if (!payload.name) {
    errorMessage.value = tr("请输入分类名称。")
    return
  }
  actionLoading.value = true
  clearMessages()
  try {
    if (categoryForm.value.id) {
      await http.patch(`/api/tag-categories/${categoryForm.value.id}`, payload)
      successMessage.value = tr("分类已更新。")
    } else {
      await http.post('/api/tag-categories', payload)
      successMessage.value = tr("分类已创建。")
    }
    categoryDialogRef.value?.close()
    await loadCatalog()
  } catch (error) {
    errorMessage.value = apiMessage(error, tr("分类保存失败。"))
  } finally {
    actionLoading.value = false
  }
}

async function deleteCategory(category) {
  if (!await confirmDialog.value.ask({ message: tr("确定停用分类“{0}”吗？", [category.name]), confirmText: tr("停用"), danger: true })) return
  actionLoading.value = true
  clearMessages()
  try {
    await http.delete(`/api/tag-categories/${category.id}`)
    successMessage.value = tr("分类已停用。")
    await loadCatalog()
  } catch (error) {
    errorMessage.value = apiMessage(error, tr("分类停用失败。"))
  } finally {
    actionLoading.value = false
  }
}

function openTagDialog(tag = null) {
  clearMessages()
  tagForm.value = tag
    ? {
        id: tag.id,
        name: tag.name,
        category_id: tag.category_id || '',
        kind: tag.kind,
        description: tag.description || '',
      }
    : {
        id: null,
        name: '',
        category_id: categories.value[0]?.id || '',
        kind: 'info',
        description: '',
      }
  tagDialogRef.value?.showModal()
}

async function saveTag() {
  const payload = {
    name: tagForm.value.name.trim(),
    category_id: Number(tagForm.value.category_id),
    kind: tagForm.value.kind,
    description: tagForm.value.description.trim() || null,
  }
  if (!payload.name || !payload.category_id) {
    errorMessage.value = tr("请选择分类并填写标签名称。")
    return
  }
  actionLoading.value = true
  clearMessages()
  try {
    if (tagForm.value.id) {
      await http.patch(`/api/tags/${tagForm.value.id}`, payload)
      successMessage.value = tr("标签已更新。")
    } else {
      await http.post('/api/tags', payload)
      successMessage.value = tr("标签已创建。")
    }
    tagDialogRef.value?.close()
    await loadCatalog()
    if (loadedIp.value) await loadAssetTags(loadedIp.value)
  } catch (error) {
    errorMessage.value = apiMessage(error, tr("标签保存失败。"))
  } finally {
    actionLoading.value = false
  }
}

async function deleteTag(tag) {
  const count = Number(tag.assignment_count || 0)
  const impact = count ? tr("，并从 {0} 个地址绑定中移除", [count]) : ''
  if (!await confirmDialog.value.ask({ message: tr("确定停用标签“{0}”吗{1}？", [tag.name, impact]), confirmText: tr("停用"), danger: true })) return
  actionLoading.value = true
  clearMessages()
  try {
    await http.delete(`/api/tags/${tag.id}`)
    successMessage.value = tr("标签已停用。")
    await loadCatalog()
    assignedTags.value = assignedTags.value.filter((item) => item.id !== tag.id)
  } catch (error) {
    errorMessage.value = apiMessage(error, tr("标签停用失败。"))
  } finally {
    actionLoading.value = false
  }
}

async function loadAssetTags(ip = ipInput.value) {
  const address = String(ip || '').trim()
  if (!address) {
    assetError.value = tr("请输入 IPv4 或 IPv6 地址。")
    return
  }
  assetLoading.value = true
  assetError.value = ''
  selectedTagId.value = ''
  try {
    const response = await http.get('/api/assets/tags', { params: { ip: address } })
    loadedIp.value = response.data?.data?.ip || address
    ipInput.value = loadedIp.value
    assignedTags.value = response.data?.data?.tags || []
  } catch (error) {
    loadedIp.value = ''
    assignedTags.value = []
    assetError.value = apiMessage(error, tr("资产标签加载失败。"))
  } finally {
    assetLoading.value = false
  }
}

async function assignTag() {
  if (!loadedIp.value || !selectedTagId.value) return
  assetLoading.value = true
  assetError.value = ''
  try {
    const response = await http.post('/api/assets/tags', {
      ip: loadedIp.value,
      tag_id: Number(selectedTagId.value),
    })
    const tag = response.data?.data?.tag
    if (tag && !assignedTagIds.value.has(tag.id)) assignedTags.value.push(tag)
    selectedTagId.value = ''
    await loadCatalog()
  } catch (error) {
    assetError.value = apiMessage(error, tr("标签绑定失败。"))
  } finally {
    assetLoading.value = false
  }
}

async function removeAssetTag(tag) {
  if (!loadedIp.value) return
  assetLoading.value = true
  assetError.value = ''
  try {
    await http.delete(`/api/assets/tags/${tag.id}`, { params: { ip: loadedIp.value } })
    assignedTags.value = assignedTags.value.filter((item) => item.id !== tag.id)
    await loadCatalog()
  } catch (error) {
    assetError.value = apiMessage(error, tr("标签解绑失败。"))
  } finally {
    assetLoading.value = false
  }
}

onMounted(loadCatalog)
</script>

<template>
  <main class="page-shell">
    <ConfirmDialog ref="confirmDialog" />
    <div class="space-y-5">
      <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 class="page-title">{{ tr("标签管理") }}</h1>
          <p class="mt-1 text-sm opacity-65">{{ tr("集中维护标签分类与名称，并直接为已收录的 IP 地址打标。") }}</p>
        </div>
        <div v-if="canManage" class="flex flex-wrap gap-2">
          <button class="btn btn-outline btn-sm" :disabled="actionLoading" @click="openCategoryDialog()">{{ tr("新建分类") }}</button>
          <button class="btn btn-neutral btn-sm" :disabled="actionLoading || categories.length === 0" @click="openTagDialog()">{{ tr("新建标签") }}</button>
        </div>
      </div>

      <div v-if="errorMessage" role="alert" class="alert alert-error text-sm"><span>{{ errorMessage }}</span></div>
      <div v-if="successMessage" role="status" class="alert alert-success text-sm"><span>{{ successMessage }}</span></div>
      <div v-if="!loading && !canManage" role="alert" class="alert alert-warning text-sm"><span>{{ tr("当前账号只能查看标签，管理员才可以修改或绑定。") }}</span></div>

      <div class="grid gap-4 sm:grid-cols-3">
        <div class="stat rounded-box border border-base-300 bg-base-100"><div class="stat-title">{{ tr("启用分类") }}</div><div class="stat-value text-2xl">{{ categories.length }}</div></div>
        <div class="stat rounded-box border border-base-300 bg-base-100"><div class="stat-title">{{ tr("启用标签") }}</div><div class="stat-value text-2xl">{{ tags.length }}</div></div>
        <div class="stat rounded-box border border-base-300 bg-base-100"><div class="stat-title">{{ tr("地址绑定") }}</div><div class="stat-value text-2xl">{{ totalAssignments }}</div></div>
      </div>

      <section v-if="canManage" class="card border border-base-300 bg-base-100 shadow-sm">
        <div class="card-body gap-4">
          <div>
            <h2 class="card-title text-base">{{ tr("直接标记地址") }}</h2>
            <p class="text-xs opacity-60">{{ tr("地址必须已经出现在成功的扫描结果中。") }}</p>
          </div>
          <form class="flex flex-col gap-2 sm:flex-row" @submit.prevent="loadAssetTags()">
            <input v-model="ipInput" class="input input-bordered w-full font-mono" :placeholder="tr(&quot;例如：192.0.2.10 或 2001:db8::10&quot;)" />
            <button class="btn btn-neutral" :disabled="assetLoading" type="submit">
              <span v-if="assetLoading" class="loading loading-spinner loading-xs"></span> {{ tr("加载资产") }} </button>
          </form>
          <div v-if="assetError" role="alert" class="alert alert-error text-sm"><span>{{ assetError }}</span></div>
          <div v-if="loadedIp" class="rounded-lg bg-base-200/60 p-4">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div class="text-xs opacity-60">{{ tr("当前地址") }}</div>
                <a class="link font-mono text-sm" :href="`/asset.html?ip=${encodeURIComponent(loadedIp)}`" target="_blank" rel="noopener noreferrer">{{ loadedIp }}</a>
                <div class="mt-3 flex flex-wrap gap-2">
                  <button
                    v-for="tag in assignedTags"
                    :key="tag.id"
                    type="button"
                    class="btn btn-sm"
                    :class="tag.kind === 'malicious' ? 'btn-error' : tag.kind === 'benign' ? 'btn-success' : 'btn-info'"
                    :disabled="assetLoading || !canManage"
                    :title="tr(&quot;{0} · 点击解绑&quot;, [tag.category_name || &#39;未分类&#39;])"
                    @click="removeAssetTag(tag)"
                  >
                    {{ tag.name }} ×
                  </button>
                  <span v-if="assignedTags.length === 0" class="text-sm opacity-60">{{ tr("暂无标签") }}</span>
                </div>
              </div>
              <div v-if="canManage" class="flex w-full max-w-xl flex-col gap-2 sm:flex-row">
                <select v-model="selectedTagId" class="select select-bordered w-full" :disabled="assetLoading || availableTags.length === 0">
                  <option value="">{{ availableTags.length ? tr("选择要绑定的标签") : tr("没有可绑定的标签") }}</option>
                  <optgroup v-for="category in categories" :key="category.id" :label="category.name">
                    <option v-for="tag in availableTags.filter((item) => item.category_id === category.id)" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
                  </optgroup>
                </select>
                <button class="btn btn-neutral" :disabled="assetLoading || !selectedTagId" @click="assignTag">{{ tr("绑定") }}</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="card border border-base-300 bg-base-100 shadow-sm">
        <div class="card-body gap-4">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div><h2 class="card-title text-base">{{ tr("标签库") }}</h2><p class="text-xs opacity-60">{{ tr("风险属性决定标签颜色，并保持“恶意”和“正常”互斥。") }}</p></div>
            <div class="grid gap-2 sm:grid-cols-3">
              <input v-model="searchText" class="input input-bordered input-sm" :placeholder="tr(&quot;搜索名称或描述&quot;)" />
              <select v-model="categoryFilter" class="select select-bordered select-sm"><option value="">{{ tr("全部分类") }}</option><option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option></select>
              <select v-model="kindFilter" class="select select-bordered select-sm"><option value="">{{ tr("全部风险属性") }}</option><option value="info">{{ tr("普通信息") }}</option><option value="malicious">{{ tr("恶意") }}</option><option value="benign">{{ tr("正常") }}</option></select>
            </div>
          </div>

          <div v-if="loading" class="flex justify-center py-12"><span class="loading loading-spinner loading-md"></span></div>
          <div v-else-if="filteredTags.length" class="overflow-x-auto rounded-lg border border-base-300">
            <table class="table table-zebra table-sm">
              <thead><tr><th>{{ tr("标签") }}</th><th>{{ tr("分类") }}</th><th>{{ tr("风险属性") }}</th><th>{{ tr("描述") }}</th><th class="text-right">{{ tr("地址数") }}</th><th v-if="canManage" class="text-right">{{ tr("操作") }}</th></tr></thead>
              <tbody>
                <tr v-for="tag in filteredTags" :key="tag.id">
                  <td><AssetTags :tags="[tag]" /></td>
                  <td>{{ tag.category_name || tr("未分类") }}</td>
                  <td>{{ tag.kind === 'malicious' ? tr("恶意") : tag.kind === 'benign' ? tr("正常") : tr("普通信息") }}</td>
                  <td class="max-w-xs truncate" :title="tag.description">{{ tag.description || '-' }}</td>
                  <td class="text-right tabular-nums">{{ tag.assignment_count || 0 }}</td>
                  <td v-if="canManage" class="text-right"><div class="inline-flex gap-1"><button class="btn btn-ghost btn-xs" :disabled="actionLoading" @click="openTagDialog(tag)">{{ tr("编辑") }}</button><button class="btn btn-ghost btn-xs text-error" :disabled="actionLoading" @click="deleteTag(tag)">{{ tr("停用") }}</button></div></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="py-10 text-center text-sm opacity-60">{{ tr("没有符合条件的标签。") }}</p>
        </div>
      </section>

      <section class="card border border-base-300 bg-base-100 shadow-sm">
        <div class="card-body gap-4">
          <div><h2 class="card-title text-base">{{ tr("分类") }}</h2><p class="text-xs opacity-60">{{ tr("有启用标签的分类不能停用，请先移动或停用其标签。") }}</p></div>
          <div v-if="categories.length" class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div v-for="category in categories" :key="category.id" class="rounded-lg border border-base-300 p-4">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0"><h3 class="truncate font-medium">{{ category.name }}</h3><p class="mt-1 line-clamp-2 text-xs opacity-60">{{ category.description || tr("暂无描述") }}</p></div>
                <span class="badge badge-ghost">{{ category.sort_order }}</span>
              </div>
              <div class="mt-3 flex items-center justify-between text-xs opacity-70"><span v-if="canManage">{{ category.tag_count }} {{ tr("个标签 ·") }} {{ category.assignment_count }} {{ tr("次绑定") }}</span><span v-else>{{ tr("标签分类") }}</span><div v-if="canManage" class="flex gap-1"><button class="btn btn-ghost btn-xs" @click="openCategoryDialog(category)">{{ tr("编辑") }}</button><button class="btn btn-ghost btn-xs text-error" :disabled="category.tag_count > 0" @click="deleteCategory(category)">{{ tr("停用") }}</button></div></div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </main>

  <dialog ref="categoryDialogRef" class="modal">
    <div class="modal-box max-w-lg">
      <h3 class="text-lg font-bold">{{ categoryForm.id ? tr("编辑分类") : tr("新建分类") }}</h3>
      <div v-if="errorMessage" role="alert" class="alert alert-error mt-4 text-sm"><span>{{ errorMessage }}</span></div>
      <div class="mt-4 space-y-3">
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-1`">{{ tr("名称") }}</label></legend><input :id="`${formFieldId}-1`" v-model="categoryForm.name" maxlength="32" class="input input-bordered w-full" /></fieldset>
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label for="tagmanagement-categoryform-description">{{ tr("描述") }}</label></legend><textarea id="tagmanagement-categoryform-description" v-model="categoryForm.description" maxlength="256" rows="3" class="textarea textarea-bordered w-full"></textarea></fieldset>
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-2`">{{ tr("排序") }}</label></legend><input :id="`${formFieldId}-2`" v-model.number="categoryForm.sort_order" type="number" min="-10000" max="10000" class="input input-bordered w-full" /></fieldset>
      </div>
      <div class="modal-action"><button class="btn btn-ghost" :disabled="actionLoading" @click="categoryDialogRef?.close()">{{ tr("取消") }}</button><button class="btn btn-neutral" :disabled="actionLoading" @click="saveCategory">{{ tr("保存") }}</button></div>
    </div>
    <form method="dialog" class="modal-backdrop"><button>{{ tr("关闭") }}</button></form>
  </dialog>

  <dialog ref="tagDialogRef" class="modal">
    <div class="modal-box max-w-lg">
      <h3 class="text-lg font-bold">{{ tagForm.id ? tr("编辑标签") : tr("新建标签") }}</h3>
      <div v-if="errorMessage" role="alert" class="alert alert-error mt-4 text-sm"><span>{{ errorMessage }}</span></div>
      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <fieldset class="fieldset min-w-0 w-full sm:col-span-2"><legend class="fieldset-legend"><label :for="`${formFieldId}-3`">{{ tr("名称") }}</label></legend><input :id="`${formFieldId}-3`" v-model="tagForm.name" maxlength="32" class="input input-bordered w-full" /></fieldset>
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-4`">{{ tr("分类") }}</label></legend><select :id="`${formFieldId}-4`" v-model="tagForm.category_id" class="select select-bordered w-full"><option disabled value="">{{ tr("请选择") }}</option><option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option></select></fieldset>
        <fieldset class="fieldset min-w-0 w-full"><legend class="fieldset-legend"><label :for="`${formFieldId}-5`">{{ tr("风险属性") }}</label></legend><select :id="`${formFieldId}-5`" v-model="tagForm.kind" class="select select-bordered w-full"><option value="info">{{ tr("普通信息") }}</option><option value="malicious">{{ tr("恶意") }}</option><option value="benign">{{ tr("正常") }}</option></select></fieldset>
        <fieldset class="fieldset min-w-0 w-full sm:col-span-2"><legend class="fieldset-legend"><label for="tagmanagement-tagform-description">{{ tr("描述") }}</label></legend><textarea id="tagmanagement-tagform-description" v-model="tagForm.description" maxlength="256" rows="3" class="textarea textarea-bordered w-full"></textarea></fieldset>
      </div>
      <div class="modal-action"><button class="btn btn-ghost" :disabled="actionLoading" @click="tagDialogRef?.close()">{{ tr("取消") }}</button><button class="btn btn-neutral" :disabled="actionLoading" @click="saveTag">{{ tr("保存") }}</button></div>
    </div>
    <form method="dialog" class="modal-backdrop"><button>{{ tr("关闭") }}</button></form>
  </dialog>
</template>
