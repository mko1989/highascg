'use strict'

/**
 * WO-708 / WO-709 — where the Auto director keeps its settings: each slot's head count + PTZ cameras and the home
 * timeout, in ~/.highascg/tracking-auto.json (outside the repo, so Syncthing never fights it). Pins (person keys)
 * stay in memory. HIGHASCG_TRACKING_AUTO_FILE overrides the path; under the Node test runner the default is a
 * private temp dir per process (projects-root.js pattern — the offline suite must never write the live file).
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { underTestRunner } = require('../engine/projects-root')

const SLOTS = 9
const AFTER_S = { dflt: 10, min: 3, max: 600 }
const CAM_RE = /^[A-Za-z0-9_.:-]{1,64}$/

let _testDir = null

function autoFile() {
	if (process.env.HIGHASCG_TRACKING_AUTO_FILE) return path.resolve(process.env.HIGHASCG_TRACKING_AUTO_FILE)
	if (underTestRunner()) {
		if (!_testDir) _testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'highascg-test-tracking-auto-'))
		return path.join(_testDir, 'tracking-auto.json')
	}
	return path.join(os.homedir(), '.highascg', 'tracking-auto.json')
}

/** Settings shape, every field valid: { slots: [{ heads, ptz }] × 9, after_s }. */
function normalizeSettings(src) {
	const s = src && typeof src === 'object' ? src : {}
	const list = Array.isArray(s.slots) ? s.slots : []
	const seen = new Set()
	const slots = []
	for (let k = 0; k < SLOTS; k++) {
		const e = list.find((q) => Number(q?.slot) === k + 1) || {}
		const heads = Number.isInteger(e.heads) && e.heads >= 0 && e.heads <= 999 ? e.heads : 0
		const ptz = (Array.isArray(e.ptz) ? e.ptz : [])
			.map(String)
			.filter((c) => CAM_RE.test(c) && !seen.has(c) && seen.add(c))
		slots.push({ heads, ptz })
	}
	const a = Number(s.home?.after_s)
	const after_s = Number.isFinite(a) ? Math.min(AFTER_S.max, Math.max(AFTER_S.min, a)) : AFTER_S.dflt
	return { slots, after_s }
}

function loadSettings(file = autoFile()) {
	try {
		return normalizeSettings(JSON.parse(fs.readFileSync(file, 'utf8')))
	} catch (_) {
		return normalizeSettings(null)
	}
}

/** Atomic write (tmp + rename). → true, or false when the disk refused it. */
function saveSettings(settings, file = autoFile()) {
	const body = {
		version: 1,
		slots: settings.slots.map((s, i) => ({ slot: i + 1, heads: s.heads, ptz: s.ptz })),
		home: { after_s: settings.after_s },
	}
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true })
		const tmp = `${file}.${process.pid}.tmp`
		fs.writeFileSync(tmp, JSON.stringify(body, null, '\t') + '\n')
		fs.renameSync(tmp, file)
		return true
	} catch (_) {
		return false
	}
}

module.exports = { autoFile, loadSettings, saveSettings, normalizeSettings, SLOTS, AFTER_S, CAM_RE }
