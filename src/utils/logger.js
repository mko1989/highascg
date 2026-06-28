'use strict'

const { inferCategoryFromMessage, normalizeCategory, normalizeLevel, formatTimestampCasparStyle } = require('./log-record')

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }

/**
 * @param {string} level
 * @param {string} msg
 */
function formatLine(level, msg) {
	const ts = formatTimestampCasparStyle()
	const lvl = String(level).toLowerCase()
	return `[${ts}] (HACG) [${lvl}] ${msg}`
}

/**
 * @param {{ minLevel?: 'debug'|'info'|'warn'|'error', category?: string, onLine?: (line: string | object) => void }} [options]
 */
function createLogger(options = {}) {
	const min = LEVELS[options.minLevel || 'debug'] ?? 0
	const onLine = typeof options.onLine === 'function' ? options.onLine : null
	const defaultCategory = normalizeCategory(options.category || 'system')
	/** @param {'debug'|'info'|'warn'|'error'} level */
	function log(level, msg) {
		if ((LEVELS[level] ?? 0) < min) return
		const message = String(msg)
		const record = {
			ts: formatTimestampCasparStyle(),
			level: normalizeLevel(level),
			category:
				defaultCategory !== 'system'
					? defaultCategory
					: inferCategoryFromMessage(message, level),
			message,
			line: formatLine(level, message),
		}
		if (onLine) onLine(record)
		if (level === 'error') console.error(record.line)
		else if (level === 'warn') console.warn(record.line)
		else console.log(record.line)
	}
	return {
		debug: (msg) => log('debug', msg),
		info: (msg) => log('info', msg),
		warn: (msg) => log('warn', msg),
		error: (msg) => log('error', msg),
	}
}

/** Default logger (debug and up) */
const defaultLogger = createLogger()

module.exports = { createLogger, defaultLogger, formatLine, formatTimestampCasparStyle: require('./log-record').formatTimestampCasparStyle }
