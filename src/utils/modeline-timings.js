'use strict'

const { execFileSync } = require('child_process')

/**
 * @param {string} text
 * @returns {{ modeName: string, timings: string[] } | null}
 */
function parseModelineFromGeneratorOutput(text) {
	const line = String(text || '')
		.split('\n')
		.map((l) => l.trim())
		.find((l) => /^Modeline\s+"/.test(l))
	if (!line) return null
	const m = line.match(/^Modeline\s+"([^"]+)"\s+(.+)$/)
	if (!m) return null
	const timings = m[2]
		.trim()
		.split(/\s+/)
		.filter((t) => t.length > 0)
	if (!timings.length) return null
	return { modeName: m[1].trim(), timings }
}

/**
 * @param {'cvt'|'cvt_r'|'gtf'} kind
 * @param {number} w
 * @param {number} h
 * @param {number} hz
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function runTimingGenerator(kind, w, h, hz, env) {
	const k = String(kind || 'cvt').toLowerCase().replace(/-/g, '_')
	let bin
	/** @type {string[]} */
	let args
	if (k === 'gtf') {
		bin = 'gtf'
		args = [String(w), String(h), String(hz)]
	} else if (k === 'cvt_r') {
		bin = 'cvt'
		args = ['-r', String(w), String(h), String(hz)]
	} else {
		bin = 'cvt'
		args = [String(w), String(h), String(hz)]
	}
	return execFileSync(bin, args, { env: env || process.env, encoding: 'utf8', maxBuffer: 65536 })
}

/**
 * @param {{ timings: string[] }} parsed
 * @returns {object|null}
 */
function breakdownCvtStyleTimings(parsed) {
	const t = parsed?.timings
	if (!Array.isArray(t) || t.length < 9) return null
	const dotClock = parseFloat(t[0])
	const hDisplay = parseInt(t[1], 10)
	const hSyncStart = parseInt(t[2], 10)
	const hSyncEnd = parseInt(t[3], 10)
	const hTotal = parseInt(t[4], 10)
	const vDisplay = parseInt(t[5], 10)
	const vSyncStart = parseInt(t[6], 10)
	const vSyncEnd = parseInt(t[7], 10)
	const vTotal = parseInt(t[8], 10)
	const flags = t.slice(9).join(' ')
	if (![dotClock, hDisplay, hSyncStart, hSyncEnd, hTotal, vDisplay, vSyncStart, vSyncEnd, vTotal].every(Number.isFinite)) {
		return null
	}
	const framePixels = hTotal * vTotal
	const activePixels = hDisplay * vDisplay
	const approxHz = framePixels > 0 ? (dotClock * 1e6) / framePixels : null
	return {
		dotClockMhz: dotClock,
		hDisplay,
		hSyncStart,
		hSyncEnd,
		hTotal,
		vDisplay,
		vSyncStart,
		vSyncEnd,
		vTotal,
		flags: flags || null,
		activePixels,
		framePixels,
		approxHz,
	}
}

/**
 * Rough dot-clock tier for UI (not cable certification).
 * @param {number} mhz
 * @returns {{ key: string, short: string }}
 */
function classifyPixelClockBandwidth(mhz) {
	if (!Number.isFinite(mhz) || mhz <= 0) {
		return { key: 'unknown', short: '?' }
	}
	if (mhz <= 165) return { key: 'single_link', short: 'SL' }
	if (mhz <= 330) return { key: 'dual_link', short: 'DL' }
	if (mhz <= 600) return { key: 'uhd4k', short: '4K' }
	return { key: 'uhd8k', short: '8K' }
}

/** @param {unknown} v */
function normalizeTimingKind(v) {
	const s = String(v || 'cvt').trim().toLowerCase().replace(/-/g, '_')
	if (s === 'gtf') return 'gtf'
	if (s === 'cvt_r' || s === 'reduced' || s === 'cvt_rb') return 'cvt_r'
	return 'cvt'
}

/**
 * @param {object} config
 * @param {string} outputSysId
 * @returns {'cvt'|'cvt_r'|'gtf'}
 */
function readOsTimingSourceForOutput(config, outputSysId) {
	const sid = String(outputSysId || '').trim()
	if (!sid || !config || typeof config !== 'object') return 'cvt'
	const cs = config.casparServer && typeof config.casparServer === 'object' ? config.casparServer : null
	for (let n = 1; n <= 8; n++) {
		if (String(config[`screen_${n}_system_id`] || '').trim() === sid) {
			const raw = config[`screen_${n}_os_timing_source`] ?? (cs && cs[`screen_${n}_os_timing_source`])
			return normalizeTimingKind(raw)
		}
	}
	if (String(config.multiview_system_id || '').trim() === sid) {
		return normalizeTimingKind(config.multiview_os_timing_source)
	}
	return 'cvt'
}

/**
 * @param {'cvt'|'cvt_r'|'gtf'} kind
 * @param {number} w
 * @param {number} h
 * @param {number} hz
 * @param {NodeJS.ProcessEnv} [env]
 */
function buildModelinePreview(kind, w, h, hz, env) {
	const text = runTimingGenerator(kind, w, h, hz, env)
	const parsed = parseModelineFromGeneratorOutput(text)
	if (!parsed) {
		return { ok: false, error: 'No Modeline in generator output', raw: text }
	}
	const breakdown = breakdownCvtStyleTimings(parsed)
	const band = breakdown ? classifyPixelClockBandwidth(breakdown.dotClockMhz) : null
	return {
		ok: true,
		kind: normalizeTimingKind(kind),
		raw: text,
		modeName: parsed.modeName,
		timings: parsed.timings,
		breakdown,
		bandwidth: band,
	}
}

module.exports = {
	parseModelineFromGeneratorOutput,
	runTimingGenerator,
	breakdownCvtStyleTimings,
	classifyPixelClockBandwidth,
	normalizeTimingKind,
	readOsTimingSourceForOutput,
	buildModelinePreview,
}
