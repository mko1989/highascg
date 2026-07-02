/**
 * Excel / CSV roster import for lower-third inspector (row picker → Title / Subtitle).
 */

/** Max upload size for roster spreadsheets (ReDoS / memory guard, WO-105). */
export const ROSTER_MAX_BYTES = 2 * 1024 * 1024
/** Parse timeout for workbook load (ms). */
export const ROSTER_PARSE_TIMEOUT_MS = 15_000

/** @typedef {{ firstName?: string, surname?: string, subtitle?: string }} LowerThirdRosterMapping */
/** @typedef {{ fileName?: string, importedAt?: string, headers: string[], mapping: LowerThirdRosterMapping, rows: Record<string, string>[] }} LowerThirdRoster */

const NONE = ''
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function cellString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function collapseSpaces(s) {
	return String(s || '')
		.replace(/\s+/g, ' ')
		.trim()
}

/**
 * @param {string} key
 * @param {number} index
 */
function safeHeaderKey(key, index) {
	const k = cellString(key) || `Column ${index + 1}`
	return UNSAFE_KEYS.has(k) ? `Column ${index + 1}` : k
}

/**
 * @param {string[]} headers
 * @param {unknown[]} cells
 */
function rowFromCells(headers, cells) {
	/** @type {Record<string, string>} */
	const row = Object.create(null)
	headers.forEach((h, i) => {
		row[h] = cellString(cells[i])
	})
	return row
}

/**
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function withParseTimeout(promise, ms, label) {
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
		}),
	])
}

/**
 * @param {string[]} headers
 * @returns {LowerThirdRosterMapping}
 */
export function guessRosterMapping(headers) {
	const norm = headers.map((h) => ({
		raw: h,
		low: String(h || '').trim().toLowerCase(),
	}))
	const pick = (...needles) => {
		for (const n of needles) {
			const hit = norm.find((h) => h.low === n || h.low.includes(n))
			if (hit) return hit.raw
		}
		return ''
	}
	return {
		firstName: pick('first name', 'firstname', 'first', 'name', 'given'),
		surname: pick('surname', 'last name', 'lastname', 'last', 'family'),
		subtitle: pick('title', 'role', 'job', 'position', 'subtitle'),
	}
}

/**
 * @param {Record<string, string>} row
 * @param {LowerThirdRosterMapping} mapping
 * @returns {string}
 */
export function buildPrimaryLine(row, mapping) {
	const parts = []
	if (mapping.firstName) parts.push(cellString(row[mapping.firstName]))
	if (mapping.surname) parts.push(cellString(row[mapping.surname]))
	return collapseSpaces(parts.join(' '))
}

/**
 * @param {Record<string, string>} row
 * @param {LowerThirdRosterMapping} mapping
 * @returns {{ title: string, subtitle: string }}
 */
export function mapRowToLowerThirdConfig(row, mapping) {
	const title = buildPrimaryLine(row, mapping)
	let subtitle = ''
	if (mapping.subtitle) subtitle = cellString(row[mapping.subtitle])
	return { title, subtitle }
}

/**
 * @param {string} text
 * @returns {{ headers: string[], rows: Record<string, string>[] }}
 */
function parseCsvText(text) {
	const lines = String(text || '')
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.split('\n')
		.filter((line) => line.trim() !== '')
	if (!lines.length) return { headers: [], rows: [] }

	const delimiter = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ','
	const parseLine = (line) => {
		const out = []
		let cur = ''
		let inQuotes = false
		for (let i = 0; i < line.length; i++) {
			const ch = line[i]
			if (ch === '"') {
				if (inQuotes && line[i + 1] === '"') {
					cur += '"'
					i++
				} else {
					inQuotes = !inQuotes
				}
				continue
			}
			if (ch === delimiter && !inQuotes) {
				out.push(cur)
				cur = ''
				continue
			}
			cur += ch
		}
		out.push(cur)
		return out.map((c) => c.trim())
	}

	const headers = parseLine(lines[0]).map((h, i) => safeHeaderKey(h, i))
	const rows = []
	for (let li = 1; li < lines.length; li++) {
		const cells = parseLine(lines[li])
		if (cells.every((c) => !c.trim())) continue
		rows.push(rowFromCells(headers, cells))
	}
	return { headers, rows }
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ headers: string[], rows: Record<string, string>[] }>}
 */
async function parseXlsxBuffer(buffer) {
	let ExcelJS
	try {
		ExcelJS = (await import('exceljs')).default
	} catch {
		throw new Error('Excel (.xlsx) support is not installed — save as CSV or install optional dependencies')
	}
	const wb = new ExcelJS.Workbook()
	await withParseTimeout(wb.xlsx.load(buffer), ROSTER_PARSE_TIMEOUT_MS, 'Roster workbook load')
	const sheet = wb.worksheets[0]
	if (!sheet) return { headers: [], rows: [] }

	/** @type {string[]} */
	const headerRow = []
	/** @type {Record<string, string>[]} */
	const rows = []
	let headerLen = 0

	sheet.eachRow((row, rowNumber) => {
		const values = row.values
		const cells = Array.isArray(values) ? values.slice(1) : []
		if (rowNumber === 1) {
			headerLen = Math.max(cells.length, 1)
			for (let i = 0; i < headerLen; i++) {
				headerRow.push(safeHeaderKey(cells[i], i))
			}
			return
		}
		if (!headerRow.length) return
		if (cells.every((c) => !cellString(c))) return
		while (cells.length < headerRow.length) cells.push('')
		rows.push(rowFromCells(headerRow, cells))
	})

	if (!headerRow.length) return { headers: [], rows: [] }
	return { headers: headerRow, rows }
}

/**
 * @param {File} file
 * @returns {Promise<{ headers: string[], rows: Record<string, string>[] }>}
 */
export async function parseSpreadsheetFile(file) {
	const name = String(file?.name || '').toLowerCase()
	const buf = await file.arrayBuffer()
	if (buf.byteLength > ROSTER_MAX_BYTES) {
		throw new Error(`Roster file too large (max ${Math.round(ROSTER_MAX_BYTES / (1024 * 1024))} MB)`)
	}

	if (name.endsWith('.csv') || name.endsWith('.txt')) {
		const text = new TextDecoder('utf-8').decode(buf)
		return parseCsvText(text)
	}

	if (name.endsWith('.xls') && !name.endsWith('.xlsx')) {
		throw new Error('Legacy .xls is not supported — save the sheet as .xlsx or CSV')
	}

	if (name.endsWith('.xlsx')) {
		return parseXlsxBuffer(buf)
	}

	try {
		return await parseXlsxBuffer(buf)
	} catch {
		const text = new TextDecoder('utf-8').decode(buf)
		return parseCsvText(text)
	}
}

/**
 * @param {string} fileName
 * @param {string[]} headers
 * @param {Record<string, string>[]} rows
 * @param {LowerThirdRosterMapping} [mapping]
 * @returns {LowerThirdRoster}
 */
export function buildRosterFromParsed(fileName, headers, rows, mapping) {
	const map = mapping && typeof mapping === 'object' ? { ...mapping } : guessRosterMapping(headers)
	return {
		fileName: String(fileName || '').trim() || 'import',
		importedAt: new Date().toISOString(),
		headers: headers.slice(),
		mapping: map,
		rows: rows.map((r) => ({ ...r })),
	}
}

/**
 * @param {LowerThirdRoster | null | undefined} roster
 * @param {string} [filter]
 * @returns {Record<string, string>[]}
 */
export function filterRosterRows(roster, filter) {
	if (!roster?.rows?.length) return []
	const q = String(filter || '').trim().toLowerCase()
	if (!q) return roster.rows
	return roster.rows.filter((row) =>
		Object.values(row).some((v) => String(v || '').toLowerCase().includes(q)),
	)
}

/**
 * @param {unknown} raw
 * @returns {LowerThirdRoster | null}
 */
export function normalizeLowerThirdRoster(raw) {
	if (!raw || typeof raw !== 'object') return null
	const headers = Array.isArray(raw.headers) ? raw.headers.map((h, i) => safeHeaderKey(h, i)) : []
	const rows = Array.isArray(raw.rows)
		? raw.rows
				.filter((r) => r && typeof r === 'object')
				.map((r) => {
					const out = Object.create(null)
					for (const [k, v] of Object.entries(r)) {
						const key = safeHeaderKey(k, 0)
						out[key] = cellString(v)
					}
					return out
				})
		: []
	if (!headers.length && !rows.length) return null
	const mapping = raw.mapping && typeof raw.mapping === 'object' ? { ...raw.mapping } : guessRosterMapping(headers)
	return {
		fileName: String(raw.fileName || '').trim() || 'import',
		importedAt: String(raw.importedAt || ''),
		headers: headers.length ? headers : Object.keys(rows[0] || {}),
		mapping,
		rows,
	}
}
