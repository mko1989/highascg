'use strict'

/** @typedef {'debug'|'info'|'warn'|'error'} LogLevel */
/** @typedef {'system'|'config'|'os-display'|'amcp'|'playback'|'streaming'|'audio'|'network'|'artnet'|'replication'|'websocket'|'device'|'sync'|'debug'} LogCategory */

/**
 * Local time like Caspar: `2026-04-09 20:40:36.262` (no trailing Z).
 * @returns {string}
 */
function formatTimestampCasparStyle() {
	const d = new Date()
	const pad = (n, w = 2) => String(n).padStart(w, '0')
	const Y = d.getFullYear()
	const M = pad(d.getMonth() + 1)
	const D = pad(d.getDate())
	const h = pad(d.getHours())
	const mi = pad(d.getMinutes())
	const s = pad(d.getSeconds())
	const ms = pad(d.getMilliseconds(), 3)
	return `${Y}-${M}-${D} ${h}:${mi}:${s}.${ms}`
}
/** @typedef {'system'|'config'|'os-display'|'amcp'|'playback'|'streaming'|'audio'|'network'|'artnet'|'replication'|'websocket'|'device'|'sync'|'debug'} LogCategory */

/** @type {LogCategory[]} */
const LOG_CATEGORIES = [
	'system',
	'config',
	'os-display',
	'amcp',
	'playback',
	'streaming',
	'audio',
	'network',
	'artnet',
	'replication',
	'websocket',
	'device',
	'sync',
	'debug',
]

/** @type {Set<string>} */
const CATEGORY_SET = new Set(LOG_CATEGORIES)

/** @type {Record<string, LogCategory>} */
const TAG_CATEGORY_MAP = {
	'[OS-Config]': 'os-display',
	'[Config]': 'config',
	'[ArtNet]': 'artnet',
	'[Audio]': 'audio',
	'[Streaming]': 'streaming',
	'[NDI]': 'streaming',
	'[replication]': 'replication',
	'[scene-take]': 'playback',
	'[global-border]': 'playback',
	'[WS]': 'websocket',
	'[Sync]': 'sync',
	'[Shutdown]': 'system',
	'[Main]': 'system',
}

const LEGACY_LINE_RE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\] \(HACG\) \[(\w+)\] (.*)$/

/**
 * @param {string} msg
 * @param {LogLevel} [level]
 * @returns {LogCategory}
 */
function inferCategoryFromMessage(msg, level = 'info') {
	const text = String(msg || '')
	for (const [tag, cat] of Object.entries(TAG_CATEGORY_MAP)) {
		if (text.includes(tag)) return cat
	}
	const lower = text.toLowerCase()
	if (/\bxrandr\b/.test(lower)) return 'os-display'
	if (/\bamcp\b/i.test(text) || /^>> |^<< /.test(text)) return 'amcp'
	if (/\b(exfat|rsync)\b/i.test(text)) return 'sync'
	if (/\b(decklink|gpu|device view|device-view)\b/i.test(text)) return 'device'
	if (level === 'debug') return 'debug'
	return 'system'
}

/**
 * @param {string} level
 * @returns {LogLevel}
 */
function normalizeLevel(level) {
	const l = String(level || 'info').toLowerCase()
	if (l === 'debug' || l === 'info' || l === 'warn' || l === 'error') return l
	return 'info'
}

/**
 * @param {string} category
 * @returns {LogCategory}
 */
function normalizeCategory(category) {
	const c = String(category || 'system').toLowerCase()
	return CATEGORY_SET.has(c) ? /** @type {LogCategory} */ (c) : 'system'
}

/**
 * @param {LogLevel} level
 * @param {string} message
 * @returns {string}
 */
function formatRecordLine(level, message) {
	const ts = formatTimestampCasparStyle()
	const lvl = normalizeLevel(level)
	return `[${ts}] (HACG) [${lvl}] ${message}`
}

/**
 * @param {{ ts?: string, level?: LogLevel, category?: LogCategory, message?: string, line?: string }} partial
 * @returns {{ ts: string, level: LogLevel, category: LogCategory, message: string, line: string }}
 */
function normalizeLogRecord(partial) {
	if (typeof partial === 'string') return parseLegacyLine(partial)
	const level = normalizeLevel(partial.level)
	const message = String(partial.message ?? partial.line ?? '')
	const category = partial.category
		? normalizeCategory(partial.category)
		: inferCategoryFromMessage(message, level)
	const ts = partial.ts || formatTimestampCasparStyle()
	const line = partial.line || formatRecordLine(level, message)
	return { ts, level, category, message, line }
}

/**
 * @param {string} line
 * @returns {{ ts: string, level: LogLevel, category: LogCategory, message: string, line: string }}
 */
function parseLegacyLine(line) {
	const text = String(line || '')
	const m = text.match(LEGACY_LINE_RE)
	if (m) {
		const level = normalizeLevel(m[2])
		const message = m[3]
		return {
			ts: m[1],
			level,
			category: inferCategoryFromMessage(message, level),
			message,
			line: text,
		}
	}
	const level = 'info'
	return {
		ts: formatTimestampCasparStyle(),
		level,
		category: inferCategoryFromMessage(text, level),
		message: text,
		line: text,
	}
}

/**
 * @param {string | null | undefined} raw
 * @returns {Set<string> | null}
 */
function parseFilterList(raw) {
	if (raw == null || raw === '') return null
	const items = String(raw)
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean)
	return items.length ? new Set(items) : null
}

/**
 * @param {{ ts: string, level: LogLevel, category: LogCategory }} record
 * @param {{ categories?: Set<string>|null, levels?: Set<string>|null }} [filters]
 */
function recordMatchesFilters(record, filters = {}) {
	if (filters.categories && !filters.categories.has(record.category)) return false
	if (filters.levels && !filters.levels.has(record.level)) return false
	return true
}

module.exports = {
	LOG_CATEGORIES,
	inferCategoryFromMessage,
	normalizeLogRecord,
	parseLegacyLine,
	parseFilterList,
	recordMatchesFilters,
	formatRecordLine,
	formatTimestampCasparStyle,
	normalizeLevel,
	normalizeCategory,
}
