/**
 * WO-623 — whole-machine CPU busy % from `/proc/stat` (the `cpu` aggregate line), for the Godot
 * performance overlay. `os.loadavg()` (the host-stats `cpu.load*` fields) is a run-queue length, not
 * a utilisation, so the overlay needs this delta. Linux only; elsewhere {@link sampleMachineCpuPct}
 * resolves null.
 */

'use strict'

const fs = require('fs')

/**
 * @param {string} statText contents of /proc/stat
 * @returns {{ idle: number, total: number } | null}
 */
function parseProcStatCpu(statText) {
	const line = String(statText || '')
		.split('\n')
		.find((l) => /^cpu\s/.test(l))
	if (!line) return null
	const v = line.trim().split(/\s+/).slice(1).map(Number)
	if (v.length < 4 || v.some((n) => !Number.isFinite(n))) return null
	/* user nice system idle iowait irq softirq steal [guest guest_nice] — guest time is already
	 * counted inside user/nice, so only the first 8 columns make the total. */
	const total = v.slice(0, 8).reduce((a, b) => a + b, 0)
	const idle = v[3] + (v[4] || 0)
	return { idle, total }
}

/**
 * @param {{ idle: number, total: number } | null} prev
 * @param {{ idle: number, total: number } | null} cur
 * @returns {number | null} busy % (0–100, one decimal)
 */
function machineCpuPct(prev, cur) {
	if (!prev || !cur) return null
	const dt = cur.total - prev.total
	if (dt <= 0) return null
	const busy = dt - (cur.idle - prev.idle)
	return Math.round(Math.min(100, Math.max(0, (busy / dt) * 100)) * 10) / 10
}

/** @type {{ sample: { idle: number, total: number } | null, at: number }} */
let _last = { sample: null, at: 0 }
const MIN_WINDOW_MS = 250

function readSampleSync() {
	try {
		return parseProcStatCpu(fs.readFileSync('/proc/stat', 'utf8'))
	} catch {
		return null
	}
}

/**
 * Busy % since the previous call (a poller gets its own interval as the window). The first call,
 * or one sooner than {@link MIN_WINDOW_MS} after the last, measures a short 200 ms window instead.
 * @returns {Promise<number | null>}
 */
async function sampleMachineCpuPct() {
	const now = Date.now()
	let prev = _last.sample
	if (!prev || now - _last.at < MIN_WINDOW_MS) {
		prev = readSampleSync()
		if (!prev) return null
		await new Promise((r) => setTimeout(r, 200))
	}
	const cur = readSampleSync()
	_last = { sample: cur, at: Date.now() }
	return machineCpuPct(prev, cur)
}

function _resetForTest() {
	_last = { sample: null, at: 0 }
}

module.exports = { parseProcStatCpu, machineCpuPct, sampleMachineCpuPct, _resetForTest }
