'use strict'

const { createLogger } = require('./logger')
const logBuffer = require('./log-buffer')

/**
 * Logger that writes structured records to the in-memory HighAsCG log buffer (Web UI + support bundle).
 * @param {string} category
 * @param {'debug'|'info'|'warn'|'error'} [minLevel]
 */
function createBufferedLogger(category, minLevel = 'info') {
	return createLogger({
		category,
		minLevel,
		onLine: (record) => logBuffer.appendHighasLine(record),
	})
}

module.exports = {
	createBufferedLogger,
	system: createBufferedLogger('system', 'info'),
	osDisplay: createBufferedLogger('os-display', 'info'),
	config: createBufferedLogger('config', 'info'),
	streaming: createBufferedLogger('streaming', 'info'),
	amcp: createBufferedLogger('amcp', 'info'),
}
