<script setup>
import { tr } from '../i18n/index.js'

import { computed } from 'vue'
const model = defineModel({ type: Object, required: true })
defineProps({ global: Boolean })
const stream = computed({ get: () => model.value.stream === null ? 'inherit' : String(model.value.stream), set: value => { model.value.stream = value === 'inherit' ? null : value === 'true' } })
function addHeader() { model.value.headers.push({ name: '', value: '', configured: false, remove: false }) }
</script>

<template>
  <div class="space-y-4">
    <div class="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3">
      <label class="form-control text-sm">{{ tr("网络代理") }}<select v-model="model.proxy_mode" class="select select-bordered mt-1 w-full"><option v-if="!global" value="inherit">{{ tr("继承 LLM 全局") }}</option><option value="system">{{ tr("跟随平台全局") }}</option><option value="direct">{{ tr("直连") }}</option><option value="custom">{{ tr("指定代理") }}</option></select><span class="mt-1 text-xs opacity-60">{{ tr("“继承 LLM 全局”使用上方 LLM 全局代理；“跟随平台全局”使用系统设置中的全局网络代理。") }}</span></label>
      <label v-if="model.proxy_mode === 'custom'" class="form-control min-w-0 text-sm">{{ tr("代理地址") }}<input v-model="model.proxy_url" class="input input-bordered mt-1 w-full" type="text" autocomplete="off" :required="!model.proxy_configured" :placeholder="model.proxy_configured ? tr(&quot;已保存，留空保留&quot;) : &#39;http(s) / socks5 / socks5h&#39;" /><span class="mt-1 text-xs opacity-60">{{ tr("输入的代理地址明文显示；支持代理认证，已保存地址留空保留。") }}</span></label>
      <label class="form-control text-sm">{{ tr("流式传输") }}<select v-model="stream" class="select select-bordered mt-1 w-full"><option v-if="!global" value="inherit">{{ tr("继承全局") }}</option><option value="true">{{ tr("开启") }}</option><option value="false">{{ tr("关闭") }}</option></select></label>
      <label class="form-control text-sm">Session<select v-model="model.session_mode" class="select select-bordered mt-1 w-full"><option v-if="!global" value="inherit">{{ tr("继承全局") }}</option><option value="disabled">{{ tr("关闭") }}</option><option value="auto">{{ tr("按会话自动生成") }}</option><option value="fixed">{{ tr("固定值") }}</option></select></label>
      <label v-if="['auto', 'fixed'].includes(model.session_mode)" class="form-control min-w-0 text-sm">{{ tr("Session 头名称") }}<input v-model="model.session_header" required maxlength="100" class="input input-bordered mt-1 w-full" placeholder="x-opencode-session" /></label>
      <label v-if="model.session_mode === 'fixed'" class="form-control min-w-0 text-sm">{{ tr("Session 固定值") }}<input v-model="model.session_value" type="password" autocomplete="new-password" maxlength="1024" :required="!model.session_configured" class="input input-bordered mt-1 w-full" :placeholder="model.session_configured ? tr(&quot;已保存，留空保留&quot;) : tr(&quot;输入固定值&quot;)" /></label>
    </div>
    <p v-if="['auto', 'fixed'].includes(model.session_mode)" class="text-xs opacity-60">{{ tr("OpenCode 兼容头可用 x-opencode-session；session 用于路由与缓存，对话历史由应用发送。") }}</p>
    <div class="flex flex-wrap items-end justify-between gap-3">
      <label class="form-control min-w-0 text-sm">{{ tr("自定义请求头") }}<select v-model="model.headers_mode" class="select select-bordered mt-1 w-full"><option v-if="!global" value="merge">{{ tr("与全局合并，同名覆盖") }}</option><option value="replace">{{ tr("使用此处的请求头") }}</option><option value="disabled">{{ tr("禁用额外请求头") }}</option></select></label>
      <button v-if="model.headers_mode !== 'disabled'" type="button" class="btn btn-outline btn-sm" @click="addHeader">{{ tr("添加请求头") }}</button>
    </div>
    <div v-if="model.headers_mode !== 'disabled'" class="space-y-2">
      <div v-for="(header, index) in model.headers" :key="index" class="flex min-w-0 flex-wrap items-center gap-2">
        <input v-model="header.name" required maxlength="100" class="input input-bordered input-sm min-w-0 flex-1" :aria-label="tr(&quot;请求头 {0} 名称&quot;, [index + 1])" :placeholder="tr(&quot;头名称&quot;)" />
        <input v-if="!header.remove" v-model="header.value" type="password" autocomplete="new-password" :required="!header.configured" maxlength="8192" class="input input-bordered input-sm min-w-0 flex-1" :aria-label="tr(&quot;请求头 {0} 值&quot;, [index + 1])" :placeholder="header.configured ? tr(&quot;已保存，留空保留&quot;) : tr(&quot;头值&quot;)" />
        <label v-if="!global && model.headers_mode === 'merge'" class="flex items-center gap-2 text-xs"><input v-model="header.remove" type="checkbox" class="checkbox checkbox-xs" />{{ tr("移除继承项") }}</label>
        <button type="button" class="btn btn-ghost btn-sm" :aria-label="tr(&quot;删除请求头 {0}&quot;, [index + 1])" @click="model.headers.splice(index, 1)">{{ tr("删除") }}</button>
      </div>
      <p class="text-xs opacity-60">{{ tr("头名称不区分大小写。Authorization 可覆盖 API Key 生成的认证头；删除行会清除该项。") }}</p>
    </div>
  </div>
</template>
