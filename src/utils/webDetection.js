import { tr } from '../i18n/index.js'
export function webLabel(web) {
  if (!web) return tr("暂无识别结果")
  if (web.status === 'pending') return tr("识别中")
  if (web.status === 'not_web') return tr("非 Web 服务")
  if (web.status === 'unsupported') return tr("证据格式暂不支持")
  const technologies = Array.isArray(web.technologies) ? web.technologies : []
  if (!technologies.length) return web.status === 'partial' ? tr("证据不完整") : tr("未识别到组件")
  return technologies.slice(0, 3).map(technologyLabel).join(' · ') + (technologies.length > 3 ? tr(" 等 {0} 项", [technologies.length]) : '')
}

export function technologyLabel(technology) {
  return `${technology.name || technology.id}${technology.version && !technology.version_conflict ? ` ${technology.version}` : ''}${technology.version_conflict ? tr("（版本冲突）") : ''}`
}

export const webCsvHeaders = ['技术栈', 'Web 识别状态', 'Web 证据时间', 'Web 证据过期', 'Web 规则版本']
export function webCsvValues(web, formatTime) {
  if (!web) return webCsvHeaders.map(() => '')
  const technologies = ['identified', 'partial'].includes(web.status) && Array.isArray(web.technologies) ? web.technologies : []
  return [technologies.map(technologyCsvLabel).join('；'), web.status || '', web.observed_at == null ? '' : formatTime(web.observed_at), web.stale ? '是' : '否', web.ruleset_version || '']
}

function technologyCsvLabel(technology) {
  return `${technology.name || technology.id}${technology.version && !technology.version_conflict ? ` ${technology.version}` : ''}${technology.version_conflict ? '（版本冲突）' : ''}`
}
