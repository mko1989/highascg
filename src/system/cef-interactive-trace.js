'use strict'

/**
 * CEF bridge trace logging. Enabled by default; set HIGHASCG_CEF_BRIDGE_TRACE=0 to silence.
 * HIGHASCG_CEF_BRIDGE_TRACE=all includes mousemove spam from X11.
 */

function traceEnabled() {
	const v = String(process.env.HIGHASCG_CEF_BRIDGE_TRACE ?? '1').trim().toLowerCase()
	return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off'
}

function traceAllMotion() {
	const v = String(process.env.HIGHASCG_CEF_BRIDGE_TRACE ?? '').trim().toLowerCase()
	return v === 'all' || v === 'verbose'
}

/**
 * @param {Function|undefined} log
 * @param {string} msg
 */
function bridgeTrace(log, msg) {
	if (!traceEnabled()) return
	if (typeof log === 'function') log('info', `[CEF bridge] ${msg}`)
}

/**
 * @param {string} type
 */
function shouldTraceX11Event(type) {
	if (!traceEnabled()) return false
	if (type === 'mousemove') return traceAllMotion()
	return true
}

module.exports = {
	traceEnabled,
	traceAllMotion,
	bridgeTrace,
	shouldTraceX11Event,
}
