<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { verificationAdapter } from '@/utils/humanVerification.js'

const props = defineProps({
  config: { type: Object, required: true },
  action: { type: String, default: 'login' },
  theme: { type: String, default: 'auto' },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['token'])
const container = ref(null)
const state = ref('loading')
const errorMessage = ref('')
let controller = null
let generation = 0
let mounted = false

function invalidate() {
  emit('token', '')
  state.value = 'waiting'
}

async function restart() {
  const current = ++generation
  controller?.remove()
  controller = null
  emit('token', '')
  errorMessage.value = ''
  state.value = 'loading'
  const isActive = () => mounted && generation === current
  try {
    const created = await verificationAdapter(props.config)(container.value, {
      siteKey: props.config.widget.site_key,
      action: props.action,
      theme: props.theme,
      size: props.config.widget.size,
    }, {
      token: (token) => {
        emit('token', token)
        errorMessage.value = ''
        state.value = 'ready'
      },
      invalidated: invalidate,
      error: (message) => {
        emit('token', '')
        errorMessage.value = message
        state.value = 'error'
      },
    }, isActive)
    if (!isActive()) { created?.remove(); return }
    controller = created
    if (state.value === 'loading') state.value = 'waiting'
  } catch (error) {
    if (!isActive()) return
    state.value = 'error'
    errorMessage.value = error.message || '验证组件暂不可用，请重试。'
  }
}

function reset() {
  emit('token', '')
  if (controller) controller.reset()
  else if (mounted) restart()
}

onMounted(() => { mounted = true; restart() })
watch(() => [props.config, props.action, props.theme], () => { if (mounted) restart() })
onBeforeUnmount(() => {
  mounted = false
  generation += 1
  controller?.remove()
  controller = null
  emit('token', '')
})
defineExpose({ reset })
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2" aria-label="人机验证" :aria-busy="state === 'loading'">
    <div ref="container" class="min-w-0 max-w-full" />
    <p v-if="state === 'loading'" class="text-sm opacity-70" role="status">正在加载验证…</p>
    <p v-else-if="state === 'waiting'" class="text-sm opacity-70" role="status">请完成人机验证</p>
    <p v-if="errorMessage" class="text-error text-sm" role="alert">{{ errorMessage }}</p>
    <button v-if="state === 'error'" type="button" class="btn btn-outline btn-sm self-start" :disabled="busy" @click="restart">重新验证</button>
  </div>
</template>
