'use strict'

/**
 * WO-1012 — the env a Zoom client needs, whichever way it is started.
 *
 * The Zoom page (POST /api/zoom/launch) always passed the user-session lines and Zoom audio's PULSE_* lines.
 * The operator dock and the app launcher start Zoom from its .desktop entry and passed neither, so a Zoom opened
 * from the dock had no sound device at all (10.11, live: no XDG_RUNTIME_DIR, no PULSE_SERVER in its environ, no
 * client on the private daemon). prepareZoomAppLaunch closes that: one env for every launch path.
 */

const fs = require('fs')
const path = require('path')

const SYSTEMD_RUN = '/usr/bin/systemd-run'

/** Pure: the user-session lines (WO-780) plus only the PULSE_* lines of zoom-audio's zoomEnv(). */
function zoomClientEnv(audioEnv, uid) {
	const u = Number.isInteger(uid) ? uid : typeof process.getuid === 'function' ? process.getuid() : 1000
	const out = { XDG_RUNTIME_DIR: `/run/user/${u}`, DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${u}/bus` }
	for (const k of ['PULSE_SERVER', 'PULSE_SINK', 'PULSE_SOURCE']) {
		if (audioEnv && typeof audioEnv[k] === 'string' && audioEnv[k]) out[k] = audioEnv[k]
	}
	return out
}

/**
 * The argv that starts `bin` in its own scope of the USER manager, outside highascg.service.
 * The unit is KillMode=mixed: on every node restart (update, crash, Apply) systemd SIGKILLs the whole cgroup, and a
 * Zoom started by node died with it, mid-meeting (10.11, live). `systemd-run --scope` execs the command itself, so
 * the pid, the env and the exit event stay the caller's. Without a user manager the plain argv comes back.
 * @returns {{ bin: string, args: string[], scoped: boolean }}
 */
function userScopeArgv(bin, args = [], deps = {}) {
	const exists = deps.exists || fs.existsSync
	const uid = Number.isInteger(deps.uid) ? deps.uid : typeof process.getuid === 'function' ? process.getuid() : 1000
	if (!exists(SYSTEMD_RUN) || !exists(`/run/user/${uid}/bus`)) return { bin, args, scoped: false }
	return { bin: SYSTEMD_RUN, args: ['--user', '--scope', '--collect', '--quiet', '--', bin, ...args], scoped: true }
}

/** Pure: is this resolved launch the Zoom client? */
function isZoomBin(bin) {
	return path.basename(String(bin || '')) === 'zoom'
}

/**
 * For an `app:<id>` action that resolves to the Zoom client: bring Zoom audio back if it was left on (the private
 * daemon must be up before Zoom looks for a sound server) and return the env to add. Null for any other action.
 * @param {string} action
 * @param {object} ctx
 * @param {{ resolveAppLaunch?: Function, getZoomAudio?: Function }} [deps]
 * @returns {Promise<Record<string,string>|null>}
 */
async function prepareZoomAppLaunch(action, ctx, deps = {}) {
	if (!String(action || '').startsWith('app:')) return null
	let launch
	try {
		launch = (deps.resolveAppLaunch || require('../utils/desktop-app-catalog').resolveAppLaunch)(action)
	} catch {
		return null
	}
	if (!launch || !isZoomBin(launch.bin)) return null
	let audioEnv = {}
	try {
		const audio = (deps.getZoomAudio || require('./zoom-audio').getZoomAudio)(ctx)
		await audio.restore()
		audioEnv = audio.zoomEnv()
	} catch {
		/* Zoom still starts, without the audio lines */
	}
	return zoomClientEnv(audioEnv)
}

module.exports = { zoomClientEnv, isZoomBin, prepareZoomAppLaunch, userScopeArgv }
