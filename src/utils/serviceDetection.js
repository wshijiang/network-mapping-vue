export const nativeServices = [
  { value: 'dns', label: 'DNS TCP' },
  { value: 'vnc', label: 'VNC' },
  { value: 'dot', label: 'DoT' },
  { value: 'doh', label: 'DoH' },
  { value: 'modbus', label: 'Modbus TCP' },
  { value: 'enip', label: 'EtherNet/IP TCP' },
  { value: 's7', label: 'S7' },
  { value: 'opcua', label: 'OPC UA TCP' },
  { value: 'mqtt', label: 'MQTT' },
  { value: 'mqtts', label: 'MQTTS' }
]
export const udpServices = [
  { value: 'dns_udp', label: 'DNS UDP' },
  { value: 'enip_udp', label: 'EtherNet/IP UDP' },
  { value: 'bacnet', label: 'BACnet/IP' }
]
// Retired passive-UDP protocols; kept only so historical results and old
// scanner capabilities still render a friendly label.
const retiredPassiveServices = [
  { value: 'opcua_pubsub', label: 'OPC UA UADP' },
  { value: 'enip_io', label: 'EtherNet/IP I/O' }
]
const protocols = [...nativeServices, ...udpServices, ...retiredPassiveServices]
export function automaticServiceRequirements(profile) {
  if (profile === 'udp_inventory') return udpServices.map(service => service.value)
  return []
}

export function automaticProbeOptions(profile, values = {}) {
  if (!['service_inventory', 'vulnerability_scan'].includes(profile)) return {}
  const options = {}
  if (values.serverName?.trim()) options.server_name = values.serverName.trim()
  if (values.caPem?.trim()) options.tls_ca_pem = values.caPem.trim()
  if (values.dohPath?.trim() && values.dohPath.trim() !== '/dns-query') options.doh_path = values.dohPath.trim()
  if (Number(values.modbusUnitId ?? 1) !== 1) options.modbus_unit_id = Number(values.modbusUnitId)
  if (Number(values.s7Tsap ?? 258) !== 258) options.s7_tsap = Number(values.s7Tsap)
  if (Number(values.mqttVersion ?? 4) !== 4) options.mqtt_version = Number(values.mqttVersion)
  return options
}

export function supportsRequiredServices(scanner, required = []) {
  const capabilities = scanner?.scan_capabilities
  if (required.length && (!Number.isInteger(capabilities?.max_service_probes)
    || capabilities.max_service_probes < required.length)) return false
  return required.every(service => Array.isArray(capabilities?.service_protocols)
    && capabilities.service_protocols.includes(service))
}
export function serviceLabel(service) {
  if (service === 'dns') return 'DNS'
  if (service === 'enip') return 'EtherNet/IP'
  if (service === 'opcua') return 'OPC UA'
  return protocols.find(item => item.value === service)?.label || service || '-'
}
export function nativeEvidence(data) {
  if (data?.schema_version !== 2 || !Array.isArray(data.evidence)) return []
  return data.evidence.filter(item => protocols.some(p => p.value === item?.module)
    && item?.result && !item.truncated).slice(0, 2)
}
