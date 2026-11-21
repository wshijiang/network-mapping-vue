// Parse the service-identification envelope (port.data) into display-ready
// blocks for the asset-detail expansion panel. Raw probe JSON is never dumped:
// scalar fields become label/value pairs, string arrays become badge lists,
// and HTTP/TLS structures are curated into readable fields.
const SKIP_KEYS = new Set(['body', 'body_sha256', 'random', 'session_id', 'ticket', 'key_material', 'master_secret', 'pre_master_secret', 'verify_data', 'rsa_params', 'client_finished', 'server_finished', 'client_key_exchange', 'extension_identifiers', 'key_share', 'compression_method', 'heartbeat', 'ocsp_stapling', 'secure_renegotiation', 'extended_master_secret', 'handshake_log', 'observation_ref', 'field_path', 'rule_id', 'module'])

export function prettifyKey(key) {
  return String(key).replaceAll('_', ' ')
}

// Scalar/string-array fields of a probe result, minus noise and secrets.
// Returns [{ key, value, kind: 'scalar' | 'list' }].
export function scalarFields(result, skip = []) {
  const skipKeys = new Set([...SKIP_KEYS, ...skip])
  const fields = []
  for (const [key, value] of Object.entries(result || {})) {
    if (skipKeys.has(key)) continue
    if (['string', 'number', 'boolean'].includes(typeof value)) {
      if (value === '' || value == null) continue
      fields.push({ key, value, kind: 'scalar' })
    } else if (Array.isArray(value) && value.length && value.every((item) => ['string', 'number'].includes(typeof item))) {
      fields.push({ key, value, kind: 'list' })
    }
  }
  return fields
}

// Curated HTTP/HTTPS response fields (body excluded: shown as Banner instead).
export function httpFields(response) {
  if (!response) return []
  const request = response.request || {}
  const headers = response.headers || {}
  const pairs = [
    ['status_line', response.status_line ?? response.status_code],
    ['protocol', response.protocol],
    ['request', request.method && request.url ? `${request.method} ${request.url}` : null],
    ['server', headers.server],
    ['content_type', headers.content_type],
    ['content_length', response.content_length >= 0 ? response.content_length : null],
    ['body_truncated', response.body_truncated === true ? true : null],
  ]
  return pairs.filter(([, value]) => value != null && value !== '').map(([key, value]) => ({ key, value, kind: 'scalar' }))
}

// First TLS log found in the evidence (https keeps it under the request,
// native TLS probes under result.tls). Returns null when absent.
export function tlsLog(port) {
  for (const item of port?.data?.evidence || []) {
    const log = item?.result?.tls || item?.result?.response?.request?.tls_log
    if (log && typeof log === 'object') return log
  }
  return null
}

export function tlsSummary(port) {
  const log = tlsLog(port)
  if (!log) return null
  const hello = log.handshake_log?.server_hello || {}
  const certEntry = (log.handshake_log?.server_certificates || [])[0] || {}
  const certificate = certEntry.certificate || {}
  const certFields = scalarFields(certificate, ['certificate', 'chain'])
  const san = certificate.san || certificate.subject_alt_names || []
  return {
    completed: log.handshake_completed_successfully === true,
    helloFields: scalarFields(hello, ['supported_versions']),
    supportedVersions: Array.isArray(hello.supported_versions) ? hello.supported_versions : [],
    certFields,
    san: Array.isArray(san) ? san : [],
    validationFields: scalarFields(certEntry.validation || {}),
    ja3s: log.ja3s || null,
  }
}

// Per-module parsed evidence blocks: HTTP curated, native protocols generic.
// The standalone `tls` module is covered by tlsSummary, so it is not repeated.
export function evidenceBlocks(port) {
  return (port?.data?.evidence || [])
    .filter((item) => item?.module && item?.result && item.module !== 'tls')
    .map((item) => ({
      module: item.module,
      truncated: item.truncated === true,
      fields: item.result.response ? httpFields(item.result.response) : scalarFields(item.result),
    }))
}

export function serviceEnvelope(port) {
  const data = port?.data
  if (!data) return null
  return {
    probe: data.selected_probe || null,
    reason: data.selection_reason || null,
    confidence: Number.isFinite(Number(data.confidence)) ? Number(data.confidence) : null,
    attempts: Number.isFinite(Number(data.attempt_count)) ? Number(data.attempt_count) : null,
  }
}