'use strict'

/** @type {string[]} */
const _lines = []
const DEFAULT_MAX = 4000

let _maxLines = DEFAULT_MAX

/**
 * @param {number} [n]
 */
function setMaxLines(n) {
	const v = parseInt(String(n || DEFAULT_MAX), 10)
	_maxLines = Number.isFinite(v) && v >= 100 && v <= 50000 ? v : DEFAULT_MAX
}

/**
 * @param {string} line
 */
function appendHighasLine(line) {
	if (typeof line !== 'string' || !line) return
	_lines.push(line)
	while (_lines.length > _maxLines) _lines.shift()
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
}
