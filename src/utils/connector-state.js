'use strict'

/**
 * WO-1084 — the seam over "which screens are plugged in": every reader of connector state for the screen gate goes
 * through here, so a test bed can inject any warehouse / show situation without touching hardware.
 *
 *   HIGHASCG_CONNECTOR_STATE=<file.json>   { "heads": [{ name, connected, active, x, y, width, height }],
 *                                            "drm": { "card0-DP-2": "connected", … } }
 *                                          replaces BOTH reads below (the harness rewrites the file between steps).
 *   HIGHASCG_OPERATOR_OUTPUT_FILE=<file>   where the operator's screen name(s) live (default ~/.highascg/run/…).
 *
 * Live reads:
 *   heads — `xrandr --current` on :0 (no output re-probe: `--query` / `--verbose` freeze X input ~180-370 ms per call,
 *           WO-397). null when X cannot be read: the gate then starts everything (fail open).
 *   drm   — /sys/class/drm/card*-<conn>/status, only for CHANGE detection (cheap, no X round trip). On NVIDIA these
 *           names are offset from the xrandr names (card0-DP-2 = DP-3), so they never identify a head.
 *
 * The operator's screen is written by node (src/system/operator-output-file.js) whenever it settles it — the boot
 * answer, every casparcg.config write, a hot-plug — and read by the run.sh gate tool, which has no config of its own.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { parseXrandrOutputStates } = require('./xrandr-unplanned-heads')

function fixture() {
	const file = process.env.HIGHASCG_CONNECTOR_STATE
	if (!file) return null
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'))
	} catch {
		return { heads: null, drm: {} }
	}
}

const toHead = (h) => ({
	name: String(h?.name || ''),
	connected: h?.connected !== false,
	active: h?.active !== false && Number(h?.width) > 0 && Number(h?.height) > 0,
	x: Number(h?.x) || 0,
	y: Number(h?.y) || 0,
	width: Number(h?.width) || 0,
	height: Number(h?.height) || 0,
})

/** PURE. `xrandr --current` text → heads (every output line, connected or not). */
function headsFromXrandr(text) {
	return [...parseXrandrOutputStates(text).values()].map(toHead)
}

/**
 * Every output X knows, with its live geometry; null when unknown.
 * @returns {Array<{ name: string, connected: boolean, active: boolean, x: number, y: number, width: number, height: number }>|null}
 */
function readHeads() {
	const fx = fixture()
	if (fx) return Array.isArray(fx.heads) ? fx.heads.map(toHead) : null
	try {
		const out = execFileSync('xrandr', ['--current'], {
			env: {
				...process.env,
				DISPLAY: process.env.DISPLAY || ':0',
				XAUTHORITY: process.env.XAUTHORITY || path.join(os.homedir(), '.Xauthority'),
			},
			encoding: 'utf8',
			timeout: 5000,
			stdio: ['ignore', 'pipe', 'ignore'],
		})
		const heads = headsFromXrandr(out)
		return heads.length ? heads : null
	} catch {
		return null
	}
}

/** DRM connector → status ("connected" / "disconnected"), for change detection only. */
function readDrmStatuses(drmPath = '/sys/class/drm') {
	const fx = fixture()
	if (fx) return new Map(Object.entries(fx.drm || {}).map(([k, v]) => [k, String(v)]))
	const out = new Map()
	let ents
	try {
		ents = fs.readdirSync(drmPath)
	} catch {
		return out
	}
	for (const ent of ents) {
		if (!/^card\d+-(DP|HDMI|DVI|VGA|eDP)-[A-Z]?-?\d+$/i.test(ent)) continue
		try {
			out.set(ent, fs.readFileSync(path.join(drmPath, ent, 'status'), 'utf8').trim())
		} catch {
			out.set(ent, 'unknown')
		}
	}
	return out
}

let _testFile = null
/** The box's file; a private temp file under `node --test` (a smoke must never tell the next launch whose screen to keep clear). */
function operatorOutputFile() {
	if (process.env.HIGHASCG_OPERATOR_OUTPUT_FILE) return process.env.HIGHASCG_OPERATOR_OUTPUT_FILE
	if (process.env.NODE_TEST_CONTEXT) {
		if (!_testFile) _testFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'highascg-test-operator-output-')), 'operator-output.json')
		return _testFile
	}
	return path.join(os.homedir(), '.highascg', 'run', 'operator-output.json')
}

/** The operator's screen name(s) as node last wrote them; [] when unknown. */
function readOperatorNames(file = operatorOutputFile()) {
	try {
		const j = JSON.parse(fs.readFileSync(file, 'utf8'))
		return (Array.isArray(j?.names) ? j.names : []).map(String).filter(Boolean)
	} catch {
		return []
	}
}

/** Write them (tmp + rename). Returns true when the content changed. */
function writeOperatorNames(names, file = operatorOutputFile(), extra = {}) {
	const list = [...new Set((names || []).map(String).filter(Boolean))]
	if (JSON.stringify(readOperatorNames(file)) === JSON.stringify(list)) return false
	fs.mkdirSync(path.dirname(file), { recursive: true })
	const tmp = `${file}.${process.pid}.tmp`
	fs.writeFileSync(tmp, `${JSON.stringify({ names: list, at: new Date().toISOString(), ...extra })}\n`)
	fs.renameSync(tmp, file)
	return true
}

module.exports = {
	headsFromXrandr,
	readHeads,
	readDrmStatuses,
	operatorOutputFile,
	readOperatorNames,
	writeOperatorNames,
}
