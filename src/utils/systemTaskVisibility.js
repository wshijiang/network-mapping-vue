// "显示系统任务" preference for the task list. Persisted in localStorage and
// remembered for one month (30 days) after the last state change; once stale
// the list falls back to the default (system tasks hidden).
const STORAGE_KEY = 'network_mapping_task_include_system'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export function loadSystemTaskVisibility(now = Date.now()) {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (!parsed || typeof parsed.value !== 'boolean' || !Number.isFinite(parsed.updatedAt)) return false
    if (now - parsed.updatedAt > MAX_AGE_MS) return false
    return parsed.value
  } catch {
    return false
  }
}

export function saveSystemTaskVisibility(value, now = Date.now()) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ value: Boolean(value), updatedAt: now }))
  } catch { /* unavailable storage keeps the in-memory choice for this visit */ }
}