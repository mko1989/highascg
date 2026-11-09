'use strict'

/**
 * WO-1012 — the Zoom desktop client's X11 windows on :0 (WM_CLASS "zoom"), for the Zoom device: which ones are on
 * screen, how big, whether they are hidden under the operator GUI (_NET_WM_STATE_BELOW), and a guessed role.
 *
 * One shell call lists them all (Zoom keeps ~5–30 unmapped helper windows; one xwininfo + xprop per window in a single
 * process instead of a spawn each). `parseWindowDump` is pure for the smoke test.
 *
 * Roles are a guess from the title — the operator assigns windows to sources in the Zoom inspector, the guess only
 * pre-selects: "Zoom Workplace …" = the home window, "Zoom Meeting" = a meeting window (Speaker or Gallery; with
 * "Use dual monitors" Zoom opens two), a title naming a share = the shared screen. Tiny windows (toolbars, the
 * share border, tooltips) are dropped.
 */

const { execFile } = require('child_process')
const { promisify } = require('util')
const { displaySessionEnv } = require('../utils/x-display-session-runtime-env')

const execFileAsync = promisify(execFile)
const MIN_W = 240
const MIN_H = 160

const DUMP_SCRIPT =
	'for w in $(xdotool search --class zoom 2>/dev/null); do echo "@@ $w"; xwininfo -id "$w" 2>/dev/null; ' +
	'xprop -id "$w" _NET_WM_STATE _NET_WM_NAME _NET_WM_PID 2>/dev/null; done'

/** @param {string} title */
function guessRole(title) {
	const t = String(title || '')
	if (/^zoom workplace/i.test(t) || /^zoom\s*-\s*(free|pro|licensed)/i.test(t)) return 'home'
	if (/share|screen|whiteboard/i.test(t)) return 'share'
	if (/^zoom meeting/i.test(t) || /^zoom$/i.test(t)) return 'meeting'
	return 'other'
}

/**
 * @param {string} text output of DUMP_SCRIPT
 * @returns {Array<{ id: string, title: string, x: number, y: number, width: number, height: number, mapped: boolean,
 *   below: boolean, pid: number, role: string }>} on-screen windows of a useful size, biggest first
 */
function parseWindowDump(text) {
	const out = []
	for (const block of String(text || '').split(/^@@ /m).slice(1)) {
		const id = parseInt(block, 10)
		if (!(id > 0)) continue
		const num = (re) => {
			const m = block.match(re)
			return m ? parseInt(m[1], 10) : 0
		}
		const name = block.match(/^_NET_WM_NAME\(UTF8_STRING\) = "(.*)"$/m)
		const state = block.match(/^_NET_WM_STATE\(ATOM\) = (.*)$/m)
		const w = {
			id: '0x' + id.toString(16),
			title: name ? name[1].replace(/\\"/g, '"') : '',
			x: num(/Absolute upper-left X:\s+(-?\d+)/),
			y: num(/Absolute upper-left Y:\s+(-?\d+)/),
			width: num(/^\s*Width:\s+(\d+)/m),
			height: num(/^\s*Height:\s+(\d+)/m),
			mapped: /Map State:\s+IsViewable/.test(block),
			below: !!state && /_NET_WM_STATE_BELOW/.test(state[1]),
			pid: num(/^_NET_WM_PID\(CARDINAL\) = (\d+)/m),
		}
		if (!w.mapped || w.width < MIN_W || w.height < MIN_H) continue
		out.push({ ...w, role: guessRole(w.title) })
	}
	return out.sort((a, b) => b.width * b.height - a.width * a.height)
}

/** @param {{ exec?: Function }} [deps] */
async function listZoomWindows(deps = {}) {
	const exec = deps.exec || execFileAsync
	try {
		const { stdout } = await exec('sh', ['-c', DUMP_SCRIPT], { env: displaySessionEnv(), timeout: 5000, maxBuffer: 4 << 20 })
		return parseWindowDump(stdout)
	} catch {
		return []
	}
}

/** The operator GUI window's rect on :0 (where hidden Zoom windows sit, under it), or null when it is not up. */
async function operatorGuiRect(deps = {}) {
	const exec = deps.exec || execFileAsync
	try {
		const { stdout } = await exec(
			'sh',
			['-c', 'for w in $(xdotool search --name "^HighAsCG Operator" 2>/dev/null); do xwininfo -id "$w"; done'],
			{ env: displaySessionEnv(), timeout: 4000 }
		)
		for (const block of stdout.split(/xwininfo: Window id:/).slice(1)) {
			if (!/Map State:\s+IsViewable/.test(block)) continue
			const n = (re) => parseInt((block.match(re) || [])[1] || '0', 10)
			const r = { x: n(/Absolute upper-left X:\s+(-?\d+)/), y: n(/Absolute upper-left Y:\s+(-?\d+)/), width: n(/^\s*Width:\s+(\d+)/m), height: n(/^\s*Height:\s+(\d+)/m) }
			if (r.width >= 640 && r.height >= 360) return r
		}
	} catch {
		/* no GUI */
	}
	return null
}

module.exports = { listZoomWindows, parseWindowDump, guessRole, operatorGuiRect }
