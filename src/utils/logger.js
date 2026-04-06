'use strict'

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }

/**
 * @param {string} level
 * @param {string} msg
 */
function formatLine(level, msg) {
	const ts = new Date().toISOString()
	return `[${ts}] [${String(level).toUpperCase()}] ${msg}`
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

module.exports = { createLogger, defaultLogger, formatLine }
