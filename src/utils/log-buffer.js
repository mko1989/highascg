'use strict'

/** @type {string[]} */
const _lines = []
const DEFAULT_MAX = 4000

let _maxLines = DEFAULT_MAX
/** @type {((line: string) => void) | null} */
let _onNewLine = null

/**
 * @param {number} [n]
 */
function setMaxLines(n) {
	const v = parseInt(String(n || DEFAULT_MAX), 10)
	_maxLines = Number.isFinite(v) && v >= 100 && v <= 50000 ? v : DEFAULT_MAX
}

/**
 * Register a callback invoked synchronously for every new line appended.
 * Used to push log lines to WebSocket clients in real time.
 * @param {((line: string) => void) | null} fn
 */
function setOnNewLine(fn) {
	_onNewLine = typeof fn === 'function' ? fn : null
}

/**
 * @param {string} line
 */
function appendHighasLine(line) {
	if (typeof line !== 'string' || !line) return
	_lines.push(line)
	while (_lines.length > _maxLines) _lines.shift()
	if (_onNewLine) {
		try {
			_onNewLine(line)
		} catch (_) {
			/* non-fatal */
		}
	}
}

function clearHighasLines() {
	_lines.length = 0
}

/**
 * @param {number} [n]
 * @returns {string[]}
 */
function getHighasLines(n = 500) {
	const cap = Math.min(_lines.length, Math.max(1, parseInt(String(n), 10) || 500))
	return _lines.slice(-cap)
}

module.exports = {
	appendHighasLine,
	clearHighasLines,
	getHighasLines,
	setMaxLines,
	setOnNewLine,
}
