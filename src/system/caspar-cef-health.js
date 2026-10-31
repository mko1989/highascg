'use strict'

/**
 * WO-881 — Caspar running without its HTML producer (CEF) is a show failure nothing used to surface: AMCP and PLAY look
 * healthy while every shader, template and the LED test card answer 404 for hours. The supervisor (run.sh,
 * casparcg-supervisor-lib.sh caspar_cef_on_fail) restarts Caspar once; when that start fails too it writes
 * ~/.highascg/run/caspar-cef-failed and leaves Caspar running. This polls that file and carries its text as
 * `cefFailed` in `caspar.connection` (the GUI's connection eye turns red with the reason); a clean start removes it.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const POLL_MS = 5000

function healthFile() {
	return process.env.CASPAR_CEF_HEALTH_FILE || path.join(os.homedir(), '.highascg', 'run', 'caspar-cef-failed')
}

/** The warning text, or '' when Caspar's CEF is fine (no file). */
function readCefFailed(file = healthFile()) {
	try {
		return fs.readFileSync(file, 'utf8').trim()
	} catch {
		return ''
	}
}

/**
 * @param {{ _casparStatus?: object, _wsBroadcast?: Function, log?: Function }} ctx
 * @returns {() => void} stop
 */
function startCasparCefHealthWatch(ctx, { file = healthFile(), pollMs = POLL_MS } = {}) {
	let last = null
	const tick = () => {
		const now = readCefFailed(file)
		if (now === last) return
		last = now
		ctx._casparStatus = { ...(ctx._casparStatus || {}), cefFailed: now }
		if (now) ctx.log?.('error', `[caspar] ${now}`)
		if (typeof ctx._wsBroadcast === 'function') ctx._wsBroadcast('change', { path: 'caspar.connection', value: ctx._casparStatus })
	}
	tick()
	const t = setInterval(tick, pollMs)
	if (t.unref) t.unref()
	return () => clearInterval(t)
}

module.exports = { startCasparCefHealthWatch, readCefFailed }
