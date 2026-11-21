import { onBeforeUnmount, onMounted, unref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { tr } from '../i18n/index.js'

// `confirmDialog` is an optional ref to a ConfirmDialog instance; when present
// the route-leave prompts use the shared modal, otherwise they fall back to
// the native confirm (e.g. pages without a dialog mounted).
export function useUnsavedChanges(isDirty, saveChanges, confirmDialog) {
  let allowNextNavigation = false

  function hasUnsavedChanges() {
    return Boolean(unref(isDirty))
  }

  function handleBeforeUnload(event) {
    if (!hasUnsavedChanges()) return
    event.preventDefault()
    event.returnValue = ''
  }

  onMounted(() => window.addEventListener('beforeunload', handleBeforeUnload))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', handleBeforeUnload))

  onBeforeRouteLeave(async () => {
    if (allowNextNavigation) {
      allowNextNavigation = false
      return true
    }
    if (!hasUnsavedChanges()) return true

    const dialog = unref(confirmDialog)
    const shouldSave = dialog?.ask
      ? await dialog.ask({ title: tr("未保存的修改"), message: tr("当前页面有未保存的修改。是否保存后离开？"), confirmText: tr("保存后离开") })
      : window.confirm('当前页面有未保存的修改。是否保存后离开？')
    if (shouldSave) {
      try {
        const saved = await saveChanges()
        return saved !== false && !hasUnsavedChanges()
      } catch (error) {
        console.error('save before leaving failed', error)
        return false
      }
    }

    return dialog?.ask
      ? await dialog.ask({ title: tr("未保存的修改"), message: tr("修改尚未保存，确定放弃修改并离开吗？"), confirmText: tr("放弃修改并离开"), danger: true })
      : window.confirm('修改尚未保存，确定放弃修改并离开吗？')
  })

  return {
    allowNextRouteLeave() {
      allowNextNavigation = true
    }
  }
}