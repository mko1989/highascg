'use strict'

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }

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
 * @param {{ minLevel?: 'debug'|'info'|'warn'|'error', onLine?: (line: string) => void }} [options]
 */
function createLogger(options = {}) {
	const min = LEVELS[options.minLevel || 'debug'] ?? 0
	const onLine = typeof options.onLine === 'function' ? options.onLine : null
	/** @param {'debug'|'info'|'warn'|'error'} level */
	function log(level, msg) {
		if ((LEVELS[level] ?? 0) < min) return
		const line = formatLine(level, msg)
		if (onLine) onLine(line)
		if (level === 'error') console.error(line)
		else if (level === 'warn') console.warn(line)
		else console.log(line)
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

module.exports = { createLogger, defaultLogger, formatLine, formatTimestampCasparStyle }
