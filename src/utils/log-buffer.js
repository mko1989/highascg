'use strict'

const {
	normalizeLogRecord,
	parseFilterList,
	recordMatchesFilters,
} = require('./log-record')

/** @type {Array<{ ts: string, level: string, category: string, message: string, line: string }>} */
const _lines = []
const DEFAULT_MAX = 4000

let _maxLines = DEFAULT_MAX
/** @type {((record: { ts: string, level: string, category: string, message: string, line: string }) => void) | null} */
let _onNewLine = null

/**
 * @param {number} [n]
 */
function setMaxLines(n) {
	const v = parseInt(String(n || DEFAULT_MAX), 10)
	_maxLines = Number.isFinite(v) && v >= 100 && v <= 50000 ? v : DEFAULT_MAX
}

/**
 * @param {((record: object) => void) | null} fn
 */
function setOnNewLine(fn) {
	_onNewLine = typeof fn === 'function' ? fn : null
}

/**
 * @param {string | object} lineOrRecord
 */
function appendHighasLine(lineOrRecord) {
	const record = normalizeLogRecord(lineOrRecord)
	if (!record.message && !record.line) return
	_lines.push(record)
	while (_lines.length > _maxLines) _lines.shift()
	if (_onNewLine) {
		try {
			_onNewLine(record)
		} catch (_) {
			/* non-fatal */
		}
	}
}

function clearHighasLines() {
	_lines.length = 0
}

/**
 * @param {number | { lines?: number, categories?: string | Set<string> | null, levels?: string | Set<string> | null, format?: 'text' | 'records' }} [opts]
 * @returns {string[] | object[]}
 */
function getHighasLines(opts = 500) {
	const options = typeof opts === 'number' ? { lines: opts } : opts || {}
	const cap = Math.min(
		_lines.length,
		Math.max(1, parseInt(String(options.lines ?? 500), 10) || 500),
	)
	const categories =
		options.categories instanceof Set
			? options.categories
			: parseFilterList(typeof options.categories === 'string' ? options.categories : null)
	const levels =
		options.levels instanceof Set
			? options.levels
			: parseFilterList(typeof options.levels === 'string' ? options.levels : null)
	const filters = { categories, levels }
	const filtered = _lines.filter((r) => recordMatchesFilters(r, filters))
	const slice = filtered.slice(-cap)
	if (options.format === 'records') return slice.map((r) => ({ ...r }))
	return slice.map((r) => r.line)
}

/**
 * @param {number} [n]
 * @returns {object[]}
 */
function getHighasRecords(n = 5000) {
	return /** @type {object[]} */ (getHighasLines({ lines: n, format: 'records' }))
}

module.exports = {
	appendHighasLine,
	clearHighasLines,
	getHighasLines,
	getHighasRecords,
	setMaxLines,
	setOnNewLine,
}
