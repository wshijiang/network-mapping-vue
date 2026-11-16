import { tr } from '../i18n/index.js'

// Shared by the search results table and the current-page CSV export.
export function formatNetworkOwner(item) {
  const asn = item.asn ? (/^AS/i.test(item.asn) ? item.asn : `AS${item.asn}`) : ''
  return [asn, item.as_org || item.isp].filter(Boolean).join(' · ') || '-'
}

export function certificateStatus(item) {
  if (!item.tls_subject && !item.tls_not_after && !item.tls_version) return null
  if (item.tls_not_after && Number(item.tls_not_after) <= Date.now()) {
    return { get text() { return tr("证书已过期") }, class: 'badge-error' }
  }
  if (item.tls_self_signed === true) return { get text() { return tr("自签名") }, class: 'badge-warning' }
  return { text: item.tls_version || 'TLS', class: 'badge-success' }
}