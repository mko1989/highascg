/**
 * Excel / CSV roster import for lower-third inspector (row picker → Title / Subtitle).
 */

/** @typedef {{ firstName?: string, surname?: string, subtitle?: string }} LowerThirdRosterMapping */
/** @typedef {{ fileName?: string, importedAt?: string, headers: string[], mapping: LowerThirdRosterMapping, rows: Record<string, string>[] }} LowerThirdRoster */

const NONE = ''

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

	const headers = parseLine(lines[0]).map((h, i) => h || `Column ${i + 1}`)
	const rows = []
	for (let li = 1; li < lines.length; li++) {
		const cells = parseLine(lines[li])
		if (cells.every((c) => !c.trim())) continue
		const row = {}
		headers.forEach((h, i) => {
			row[h] = cellString(cells[i])
		})
		rows.push(row)
	}
	return { headers, rows }
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ headers: string[], rows: Record<string, string>[] }>}
 */
async function parseXlsxBuffer(buffer) {
	const XLSX = await import('xlsx')
	const wb = XLSX.read(buffer, { type: 'array' })
	const sheetName = wb.SheetNames[0]
	if (!sheetName) return { headers: [], rows: [] }
	const sheet = wb.Sheets[sheetName]
	const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
	if (!Array.isArray(matrix) || !matrix.length) return { headers: [], rows: [] }

	const headerRow = (matrix[0] || []).map((h, i) => cellString(h) || `Column ${i + 1}`)
	const rows = []
	for (let ri = 1; ri < matrix.length; ri++) {
		const line = matrix[ri]
		if (!Array.isArray(line)) continue
		if (line.every((c) => !cellString(c))) continue
		const row = {}
		headerRow.forEach((h, i) => {
			row[h] = cellString(line[i])
		})
		rows.push(row)
	}
	return { headers: headerRow, rows }
}

/**
 * @param {File} file
 * @returns {Promise<{ headers: string[], rows: Record<string, string>[] }>}
 */
export async function parseSpreadsheetFile(file) {
	const name = String(file?.name || '').toLowerCase()
	const buf = await file.arrayBuffer()

	if (name.endsWith('.csv') || name.endsWith('.txt')) {
		const text = new TextDecoder('utf-8').decode(buf)
		return parseCsvText(text)
	}

	if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
		try {
			return await parseXlsxBuffer(buf)
		} catch (e) {
			console.warn('[lower-third-roster] xlsx parse failed, trying CSV', e)
		}
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
	const headers = Array.isArray(raw.headers) ? raw.headers.map((h) => String(h)) : []
	const rows = Array.isArray(raw.rows)
		? raw.rows.filter((r) => r && typeof r === 'object').map((r) => ({ ...r }))
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
