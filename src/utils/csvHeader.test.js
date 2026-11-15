import assert from 'node:assert/strict'
import { test } from 'node:test'
import { autoMatchHeaders, normalizeHeader, readCsvHeader, validateHeaderMapping } from './csvHeader.js'

const schema = [
  { name: 'ip', required: true, type: 'ip', aliases: ['ip_address', 'ipaddr', 'address', 'host', '目标ip', 'ip地址'], description: '' },
  { name: 'port', required: true, type: 'integer', aliases: ['端口'], description: '' },
  { name: 'protocol', required: true, type: 'enum', aliases: ['proto', '协议'], description: '' },
  { name: 'observed_at', required: true, type: 'timestamp', aliases: ['last_seen', 'time', 'timestamp', '时间', '观测时间'], description: '' },
  { name: 'service', required: false, type: 'text', aliases: ['service_name', '服务'], description: '' },
]

const csvFile = (content) => new File([content], 'assets.csv', { type: 'text/csv' })

test('normalizeHeader trims and lowercases without touching inner text', () => {
  assert.equal(normalizeHeader('  IP_Address '), 'ip_address')
  assert.equal(normalizeHeader('端口'), '端口')
  assert.equal(normalizeHeader(null), '')
  assert.equal(normalizeHeader(undefined), '')
})

test('readCsvHeader strips a UTF-8 BOM', async () => {
  const { headers, truncated } = await readCsvHeader(csvFile('\uFEFFip,port,protocol,observed_at\r\n1,2,tcp,3'))
  assert.deepEqual(headers, ['ip', 'port', 'protocol', 'observed_at'])
  assert.equal(truncated, false)
})

test('readCsvHeader handles CRLF and LF terminators', async () => {
  assert.deepEqual((await readCsvHeader(csvFile('ip,port\r\n1,2'))).headers, ['ip', 'port'])
  assert.deepEqual((await readCsvHeader(csvFile('ip,port\n1,2'))).headers, ['ip', 'port'])
})

test('readCsvHeader keeps commas inside quoted headers', async () => {
  const { headers } = await readCsvHeader(csvFile('"ip,addr",port,protocol,observed_at\n'))
  assert.deepEqual(headers, ['ip,addr', 'port', 'protocol', 'observed_at'])
})

test('readCsvHeader keeps newlines inside quoted headers', async () => {
  const { headers, truncated } = await readCsvHeader(csvFile('"obs\nerved",ip\r\nx,1'))
  assert.deepEqual(headers, ['obs\nerved', 'ip'])
  assert.equal(truncated, false)
})

test('readCsvHeader unescapes doubled quotes inside quoted headers', async () => {
  const { headers } = await readCsvHeader(csvFile('"a""b",c\n'))
  assert.deepEqual(headers, ['a"b', 'c'])
})

test('readCsvHeader flags truncation when the first record exceeds the slice', async () => {
  const longHeader = 'ip,port,protocol,observed_at,service,banner,source\n'
  const { headers, truncated } = await readCsvHeader(csvFile(longHeader + 'x'.repeat(200)), 16)
  assert.equal(truncated, true)
  assert.ok(headers.length >= 1)
})

test('readCsvHeader is not truncated when the record finishes inside the slice of a larger file', async () => {
  const { headers, truncated } = await readCsvHeader(csvFile('ip,port\n' + 'x'.repeat(5000)), 16)
  assert.deepEqual(headers, ['ip', 'port'])
  assert.equal(truncated, false)
})

test('readCsvHeader treats a small file without a trailing newline as complete', async () => {
  const { headers, truncated } = await readCsvHeader(csvFile('ip,port'))
  assert.deepEqual(headers, ['ip', 'port'])
  assert.equal(truncated, false)
})

test('readCsvHeader returns no headers for an empty file', async () => {
  const { headers, truncated } = await readCsvHeader(csvFile(''))
  assert.deepEqual(headers, [])
  assert.equal(truncated, false)
})

test('readCsvHeader only decodes the requested slice', async () => {
  let slicedEnd = null
  const file = csvFile('ip,port\n' + 'x'.repeat(100000))
  const originalSlice = file.slice.bind(file)
  file.slice = (start, end) => { slicedEnd = end; return originalSlice(start, end) }
  await readCsvHeader(file, 1024)
  assert.equal(slicedEnd, 1024)
})

test('autoMatchHeaders pairs exact internal names', () => {
  const result = autoMatchHeaders(['ip', 'port', 'protocol', 'observed_at'], schema)
  assert.deepEqual(result.mapping, { ip: 'ip', port: 'port', protocol: 'protocol', observed_at: 'observed_at' })
  assert.deepEqual(result.unmatchedRequired, [])
  assert.deepEqual(result.ignoredFileHeaders, [])
  assert.deepEqual(result.conflicts, [])
})

test('autoMatchHeaders pairs aliases case-insensitively and preserves original file header text', () => {
  const result = autoMatchHeaders([' IP_Address ', '端口', 'PROTO', 'last_seen', 'extra'], schema)
  assert.deepEqual(result.mapping, { ip: ' IP_Address ', port: '端口', protocol: 'PROTO', observed_at: 'last_seen' })
  assert.deepEqual(result.unmatchedRequired, [])
  assert.deepEqual(result.ignoredFileHeaders, ['extra'])
})

test('autoMatchHeaders reports missing required headers', () => {
  const result = autoMatchHeaders(['ip', 'port'], schema)
  assert.deepEqual(result.mapping, { ip: 'ip', port: 'port' })
  assert.deepEqual(result.unmatchedRequired, ['protocol', 'observed_at'])
})

test('autoMatchHeaders leaves a conflicted internal header unmapped for manual choice', () => {
  const result = autoMatchHeaders(['ip', 'IP', 'port', 'protocol', 'observed_at'], schema)
  assert.equal(result.mapping.ip, undefined)
  assert.deepEqual(result.conflicts, [{ internal: 'ip', fileHeaders: ['ip', 'IP'] }])
  assert.ok(result.unmatchedRequired.includes('ip'))
  assert.deepEqual(result.mapping.port, 'port')
})

test('autoMatchHeaders ignores optional columns that match nothing', () => {
  const result = autoMatchHeaders(['ip', 'port', 'protocol', 'observed_at', '服务', 'unknown'], schema)
  assert.equal(result.mapping.service, '服务')
  assert.deepEqual(result.ignoredFileHeaders, ['unknown'])
})

test('validateHeaderMapping flags a file column assigned to two internal headers', () => {
  const result = validateHeaderMapping(['a', 'b'], schema, { ip: 'a', port: 'a' })
  assert.deepEqual(result.conflicts, [{ fileHeader: 'a', internals: ['ip', 'port'] }])
  assert.deepEqual(result.ignoredFileHeaders, ['b'])
  assert.ok(result.unmatchedRequired.includes('protocol'))
})

test('validateHeaderMapping accepts a complete unique mapping', () => {
  const mapping = { ip: 'a', port: 'b', protocol: 'c', observed_at: 'd' }
  const result = validateHeaderMapping(['a', 'b', 'c', 'd', 'e'], schema, mapping)
  assert.deepEqual(result.unmatchedRequired, [])
  assert.deepEqual(result.conflicts, [])
  assert.deepEqual(result.ignoredFileHeaders, ['e'])
})