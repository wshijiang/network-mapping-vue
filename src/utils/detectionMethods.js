import { tr } from '../i18n/index.js'

export function methodName(id) {
  return ({ jarm: 'JARM', tls_certificate: 'TLS Certificate', http_fingerprint: 'HTTP Fingerprint', protocol_fingerprint: 'Protocol Fingerprint' })[id] || id
}

export function methodPrinciple(id) {
  switch (id) {
    case 'tls_server_response': return tr('通过 10 组 TLS ClientHello 的服务端响应生成 TLS 配置指纹。')
    case 'certificate_metadata': return tr('分析叶证书的主题、颁发者、有效期和公钥等元数据。')
    case 'http_response': return tr('分析 HTTP 响应状态、响应头和内容特征。')
    case 'application_protocol': return tr('根据应用层握手与协议响应识别服务。')
    default: return id
  }
}
