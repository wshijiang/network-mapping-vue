const families = { windows: 'Windows', linux: 'Linux', bsd: 'BSD', macos: 'macOS', unix: 'Unix' }
const distributions = { ubuntu: 'Ubuntu', debian: 'Debian', centos: 'CentOS', freebsd: 'FreeBSD', openbsd: 'OpenBSD', netbsd: 'NetBSD' }

export function osLabel(os) {
  if (!os) return '暂无识别结果'
  if (os.status === 'pending') return '识别中'
  if (os.status === 'conflict') return '证据冲突'
  if (os.status !== 'identified' || !os.family) return '未知'
  return [families[os.family] || os.family, distributions[os.distribution] || os.distribution, os.version].filter(Boolean).join(' · ')
}

export function osConfidence(os) {
  if (os?.status !== 'identified') return ''
  return { high: '高', medium: '中', low: '低' }[os.confidence] || ''
}

export const osCsvHeaders = ['系统家族', '系统发行版', '系统版本', '系统识别状态', '系统置信度', '系统判断对象', '系统证据时间', '系统证据过期']

export function osCsvValues(os, formatTime) {
  if (!os) return osCsvHeaders.map(() => '')
  const identified = os.status === 'identified'
  return [
    identified ? os.family || '' : '', identified ? os.distribution || '' : '', identified ? os.version || '' : '',
    os.status || '', identified ? os.confidence || '' : '', os.inference_scope || '',
    os.observed_at == null ? '' : formatTime(os.observed_at), os.stale ? '是' : '否',
  ]
}
