/**
 * Parse Companion page/row/column coordinates for timeline flags (WO-75).
 */

const MAX_COORD = 9999

/**
 * @param {string} raw — e.g. "1 2 1", "1/2/1", "12-0-15"
 * @returns {{ page: number, row: number, column: number } | null}
 */
export function parseCompanionLocationInput(raw) {
	const s = String(raw ?? '').trim()
	if (!s) return null
	const parts = s.split(/[\s/,/-]+/).filter(Boolean)
	if (parts.length !== 3) return null
	const page = parseInt(parts[0], 10)
	const row = parseInt(parts[1], 10)
	const column = parseInt(parts[2], 10)
	if (!Number.isFinite(page) || !Number.isFinite(row) || !Number.isFinite(column)) return null
	if (page < 1 || page > MAX_COORD) return null
	if (row < -MAX_COORD || row > MAX_COORD || column < -MAX_COORD || column > MAX_COORD) return null
	return { page, row, column }
}

/**
 * @param {number} page
 * @param {number} row
 * @param {number} column
 */
export function formatCompanionLocation(page, row, column) {
	return `${page} ${row} ${column}`
}

/**
 * @param {string | number} raw
 * @param {{ min?: number, max?: number, allowNegative?: boolean }} [opts]
 * @returns {number | null}
 */
export function parseCompanionCoordField(raw, opts = {}) {
	const s = String(raw ?? '').trim()
	if (s === '') return null
	const n = parseInt(s, 10)
	if (!Number.isFinite(n)) return null
	const min = opts.min ?? (opts.allowNegative ? -MAX_COORD : 0)
	const max = opts.max ?? MAX_COORD
	if (n < min || n > max) return null
	return n
}

/**
 * @param {object} flag
 */
export function flagCompanionCoords(flag) {
	return {
		page: flag?.companionPage ?? 1,
		row: flag?.companionRow ?? 0,
		column: flag?.companionColumn ?? 0,
	}
}
