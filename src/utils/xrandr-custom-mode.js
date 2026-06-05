'use strict'

const { execFileSync } = require('child_process')
const { runTimingGenerator, parseModelineFromGeneratorOutput } = require('./modeline-timings')

/** @param {string} text */
function parseModelineFromCvtOutput(text) {
	return parseModelineFromGeneratorOutput(text)
}

/**
 * Optional refresh encoded after WxH in RandR names, e.g. `5120x1024_50.00` → 50.
 * @param {string} token
 * @param {string} wxhLower e.g. `5120x1024`
 * @returns {number|null}
 */
function rateHintFromModeSuffix(token, wxhLower) {
	const s = String(token).toLowerCase()
	const w = String(wxhLower).toLowerCase()
	if (!s.startsWith(w) || s.length <= w.length) return null
	const rest = s.slice(w.length)
	const m = rest.match(/^_([0-9.]+)/)
	if (!m) return null
	const v = parseFloat(m[1])
	return Number.isFinite(v) ? v : null
}

/**
 * Choose a `--mode` token already listed for this output when the plan is plain `WxH`
 * (EDID name, prior `--newmode`, or suffixed `WxH_50.00`). Avoids redundant `cvt` when the server already has the timing.
 *
 * @param {string} plannedWxH e.g. `5120x1024`
 * @param {Set<string>|null|undefined} avail tokens from `xrandr --query` (full names + bare WxH)
 * @param {number|null} safeRate optional Hz from layout
 * @returns {string|null}
 */
function pickBestExistingModeForPlan(plannedWxH, avail, safeRate) {
	if (!plannedWxH || !avail || avail.size === 0) return null
	if (avail.has(plannedWxH)) return plannedWxH
	const pm = String(plannedWxH).match(/^(\d+)x(\d+)$/i)
	if (!pm) return null
	const pw = parseInt(pm[1], 10)
	const ph = parseInt(pm[2], 10)
	if (!Number.isFinite(pw) || !Number.isFinite(ph) || pw <= 0 || ph <= 0) return null
	const wxhKey = `${pw}x${ph}`
	const candidates = []
	for (const t of avail) {
		const mm = String(t).match(/^(\d+)x(\d+)/i)
		if (!mm) continue
		if (parseInt(mm[1], 10) !== pw || parseInt(mm[2], 10) !== ph) continue
		candidates.push(t)
	}
	if (candidates.length === 0) return null
	if (candidates.length === 1) return candidates[0]
	if (safeRate != null && Number.isFinite(safeRate)) {
		let best = null
		let bestD = Number.POSITIVE_INFINITY
		for (const t of candidates) {
			const hz = rateHintFromModeSuffix(t, wxhKey)
			if (hz == null) continue
			const d = Math.abs(hz - safeRate)
			if (d < bestD - 1e-6 || (Math.abs(d - bestD) < 1e-6 && (best == null || t.length < best.length))) {
				bestD = d
				best = t
			}
		}
		if (best != null && bestD <= 1.5) return best
	}
	candidates.sort((a, b) => a.length - b.length || a.localeCompare(b))
	return candidates[0]
}

function readCreateMissingModes(config) {
	if (!config || typeof config !== 'object') return false
	const k = 'os_xrandr_create_missing_modes'
	if (Object.prototype.hasOwnProperty.call(config, k)) {
		const v = config[k]
		return v === true || v === 'true' || v === 1 || v === '1'
	}
	const cs = config.casparServer && typeof config.casparServer === 'object' ? config.casparServer : null
	if (cs && Object.prototype.hasOwnProperty.call(cs, k)) {
		const v = cs[k]
		return v === true || v === 'true' || v === 1 || v === '1'
	}
	return false
}

/**
 * Pick a conservative EDID-style `WxH` mode to switch to before `--rmmode`, so the server drops the old definition.
 * @param {Set<string>|null|undefined} availableModes
 * @returns {string|null}
 */
function pickStripFallbackMode(availableModes) {
	if (!availableModes || !(availableModes instanceof Set)) return null
	for (const m of availableModes) {
		if (typeof m === 'string' && /^\d+x\d+$/.test(m)) return m
	}
	return null
}

/**
 * Remove an existing mode name from the server so `--newmode` can reuse it (same cvt name, new timings).
 * Switches `output` away from that mode first when possible.
 * @param {{ output: string, modeName: string, env: NodeJS.ProcessEnv, logger?: { warn?: Function, info?: Function }, availableModes?: Set<string> }} p
 */
function stripExistingXrandrModeByName(p) {
	const { output, modeName, env, logger, availableModes } = p
	const fallback = pickStripFallbackMode(availableModes)
	const base = ['--display', ':0', '--output', output]
	try {
		if (fallback) {
			execFileSync('xrandr', [...base, '--mode', fallback], { env, encoding: 'utf8', maxBuffer: 65536 })
		} else {
			execFileSync('xrandr', [...base, '--auto'], { env, encoding: 'utf8', maxBuffer: 65536 })
		}
	} catch (e) {
		if (logger && logger.warn) {
			logger.warn(`[OS-Config] Could not switch ${output} before replacing mode ${modeName}: ${e.message}`)
		}
	}
	try {
		execFileSync('xrandr', ['--display', ':0', '--delmode', output, modeName], { env, encoding: 'utf8', maxBuffer: 65536 })
	} catch (_) {}
	try {
		execFileSync('xrandr', ['--display', ':0', '--rmmode', modeName], { env, encoding: 'utf8', maxBuffer: 65536 })
	} catch (_) {}
}

/**
 * Create an xrandr mode via `cvt` + `--newmode` + `--addmode` when EDID does not list it.
 * If the mode name already exists (e.g. reapplied layout), switches the output away, `--delmode` / `--rmmode`, then recreates.
 * @param {{ output: string, width: number, height: number, refreshHz: number, env: NodeJS.ProcessEnv, logger?: object, availableModes?: Set<string>, timingKind?: string }} args
 * @returns {string|null} xrandr mode name (e.g. `1920x1080_50.00`) or null on failure
 */
function tryAddXrandrModeFromCvt({ output, width, height, refreshHz, env, logger, availableModes, timingKind }) {
	const W = parseInt(String(width), 10)
	const H = parseInt(String(height), 10)
	const r = Number(refreshHz)
	if (!Number.isFinite(W) || !Number.isFinite(H) || W < 64 || H < 64 || W > 8192 || H > 8192) return null
	const hz = Number.isFinite(r) && r > 0 && r < 240 ? r : 60
	const kindRaw = String(timingKind || 'cvt').toLowerCase().replace(/-/g, '_')
	const kind = kindRaw === 'gtf' ? 'gtf' : kindRaw === 'cvt_r' ? 'cvt_r' : 'cvt'
	let cvtText = ''
	try {
		cvtText = runTimingGenerator(kind, W, H, hz, env)
	} catch (e) {
		if (logger) logger.warn(`[OS-Config] ${kind} modeline generator failed: ${e.message}`)
		return null
	}
	const parsed = parseModelineFromCvtOutput(cvtText)
	if (!parsed) {
		if (logger) logger.warn(`[OS-Config] Could not parse Modeline from ${kind} output`)
		return null
	}
	const { modeName, timings } = parsed
	const newmodeArgs = ['--display', ':0', '--newmode', modeName, ...timings]
	let didReplace = false
	try {
		execFileSync('xrandr', newmodeArgs, { env, encoding: 'utf8', maxBuffer: 65536 })
	} catch (e) {
		if (logger && logger.info) {
			logger.info(`[OS-Config] xrandr --newmode failed for ${modeName} (${e.message}); attempting replace via delmode/rmmode`)
		}
		stripExistingXrandrModeByName({ output, modeName, env, logger, availableModes })
		didReplace = true
		try {
			execFileSync('xrandr', newmodeArgs, { env, encoding: 'utf8', maxBuffer: 65536 })
		} catch (e2) {
			if (logger && logger.warn) {
				logger.warn(`[OS-Config] xrandr --newmode failed for ${modeName} after replace attempt: ${e2.message}`)
			}
			return null
		}
	}
	try {
		execFileSync('xrandr', ['--display', ':0', '--addmode', output, modeName], { env, encoding: 'utf8', maxBuffer: 65536 })
	} catch (e) {
		try {
			execFileSync('xrandr', ['--display', ':0', '--delmode', output, modeName], { env, encoding: 'utf8', maxBuffer: 65536 })
			execFileSync('xrandr', ['--display', ':0', '--addmode', output, modeName], { env, encoding: 'utf8', maxBuffer: 65536 })
		} catch (e2) {
			if (logger && logger.warn) {
				logger.warn(`[OS-Config] xrandr --addmode failed for ${output} ${modeName}: ${e2.message}`)
			}
			return null
		}
	}
	if (logger) {
		const tag = didReplace ? 'replaced' : 'registered'
		logger.info(`[OS-Config] ${tag} custom mode ${modeName} on ${output} (${W}x${H} @ ${hz} Hz) via ${kind}`)
	}
	return modeName
}

module.exports = {
	parseModelineFromCvtOutput,
	tryAddXrandrModeFromCvt,
	readCreateMissingModes,
	pickStripFallbackMode,
	pickBestExistingModeForPlan,
	rateHintFromModeSuffix,
}
