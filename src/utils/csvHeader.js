// Pure CSV header helpers for the data-import wizard. No dependencies: only the
// first slice of a file is ever decoded, so large uploads stay out of memory.

const DEFAULT_MAX_BYTES = 65536

// Trim + lowercase is the single normalization rule shared with the backend
// alias table (DATA_IMPORT_PLAN.md §4).
export function normalizeHeader(value) {
  return String(value ?? '').trim().toLowerCase()
}

async function readSliceText(slice) {
  if (typeof slice.text === 'function') return slice.text()
  // FileReader fallback for environments without Blob.text().
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error || new Error('CSV header read failed'))
    reader.readAsText(slice)
  })
}

// Quote-aware scan of the FIRST logical CSV record (RFC4180). Handles quoted
// fields containing commas, CR/LF and escaped "" pairs. `complete` is true only
// when an unquoted record terminator was reached inside the decoded text.
function parseFirstRecord(text) {
  const fields = []
  let field = ''
  let inQuotes = false
  let complete = false
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        inQuotes = false
        index += 1
        continue
      }
      field += char
      index += 1
      continue
    }
    if (char === '"') {
      inQuotes = true
      index += 1
      continue
    }
    if (char === ',') {
      fields.push(field)
      field = ''
      index += 1
      continue
    }
    if (char === '\r' || char === '\n') {
      // CRLF, LF and lone CR all terminate the record; only the first is needed.
      fields.push(field)
      complete = true
      break
    }
    field += char
    index += 1
  }
  if (!complete) fields.push(field)
  return { fields, complete }
}

// Read only file.slice(0, maxBytes), strip a UTF-8 BOM and parse the header row.
// truncated=true means the first record did not finish inside the slice (the UI
// surfaces an error instead of guessing at a partial header).
export async function readCsvHeader(file, maxBytes = DEFAULT_MAX_BYTES) {
  if (!file || typeof file.slice !== 'function') throw new Error('A File or Blob is required')
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : DEFAULT_MAX_BYTES
  const slice = file.slice(0, limit)
  const raw = await readSliceText(slice)
  const text = raw.startsWith('\uFEFF') ? raw.slice(1) : raw
  const { fields, complete } = parseFirstRecord(text)
  const wholeFileRead = slice.size >= file.size
  return {
    headers: text.length === 0 ? [] : fields,
    truncated: !complete && !wholeFileRead,
  }
}

// Derive required-missing / duplicate-assignment / ignored columns from a concrete
// mapping. Used both to summarize auto-match and to re-validate live edits.
export function validateHeaderMapping(fileHeaders, schemaHeaders, mapping) {
  const files = Array.isArray(fileHeaders) ? fileHeaders : []
  const schema = Array.isArray(schemaHeaders) ? schemaHeaders : []
  const map = mapping && typeof mapping === 'object' ? mapping : {}
  const unmatchedRequired = schema
    .filter((header) => header.required && !map[header.name])
    .map((header) => header.name)
  const byFileHeader = new Map()
  for (const [internal, fileHeader] of Object.entries(map)) {
    if (!fileHeader) continue
    if (!byFileHeader.has(fileHeader)) byFileHeader.set(fileHeader, [])
    byFileHeader.get(fileHeader).push(internal)
  }
  const conflicts = [...byFileHeader.entries()]
    .filter(([, internals]) => internals.length > 1)
    .map(([fileHeader, internals]) => ({ fileHeader, internals }))
  const used = new Set(Object.values(map).filter(Boolean))
  const ignoredFileHeaders = files.filter((fileHeader) => !used.has(fileHeader))
  return { unmatchedRequired, conflicts, ignoredFileHeaders }
}

// Auto-pair file columns to internal headers by normalized exact name or alias.
// A internal header matched by two or more file columns is a conflict: it is left
// unmapped so the user must choose explicitly (DATA_IMPORT_PLAN.md §4 / §9.2).
export function autoMatchHeaders(fileHeaders, schemaHeaders) {
  const files = Array.isArray(fileHeaders) ? fileHeaders : []
  const schema = Array.isArray(schemaHeaders) ? schemaHeaders : []
  const normalizedFiles = files.map(normalizeHeader)
  const mapping = {}
  const claimed = new Set()
  const conflicts = []
  for (const header of schema) {
    const candidates = new Set([normalizeHeader(header.name), ...(header.aliases || []).map(normalizeHeader)])
    const matches = []
    normalizedFiles.forEach((normalized, index) => {
      if (candidates.has(normalized)) matches.push(index)
    })
    if (matches.length === 1) {
      const index = matches[0]
      // A file column already claimed by another internal header stays ambiguous.
      if (!claimed.has(index)) {
        mapping[header.name] = files[index]
        claimed.add(index)
      }
    } else if (matches.length > 1) {
      conflicts.push({ internal: header.name, fileHeaders: matches.map((index) => files[index]) })
    }
  }
  const { unmatchedRequired, ignoredFileHeaders } = validateHeaderMapping(files, schema, mapping)
  return { mapping, unmatchedRequired, ignoredFileHeaders, conflicts }
}