'use strict'

const { STANDARD_VIDEO_MODES } = require('./config-modes')
const { readScreenConfigValue } = require('./config-modes')

/** Standard broadcast project frame rates (Hz). */
const STANDARD_PROJECT_FPS = [23.98, 24, 25, 29.97, 30, 50, 59.94, 60]

const DEFAULT_VIDEO_MODE_BY_FPS = {
	23.98: '1080p2398',
	24: '1080p2400',
	25: '1080p2500',
	29.97: '1080p2997',
	30: '1080p3000',
	50: '1080p5000',
	59.94: '1080p5994',
	60: '1080p6000',
}

/**
 * @param {unknown} fps
 * @returns {number}
 */
function normalizeProjectFps(fps) {
	const n = parseFloat(String(fps))
	if (!Number.isFinite(n) || n <= 0) return 50
	let best = 50
	let bestDiff = Infinity
	for (const s of STANDARD_PROJECT_FPS) {
		const d = Math.abs(s - n)
		if (d < bestDiff) {
			bestDiff = d
			best = s
		}
	}
	return best
}

/**
 * @param {number} fps
 * @returns {string}
 */
function defaultVideoModeForProjectFps(fps) {
	const n = normalizeProjectFps(fps)
	return DEFAULT_VIDEO_MODE_BY_FPS[n] || '1080p5000'
}

/**
 * @param {string} mode
 * @param {number} fps
 * @returns {boolean}
 */
function videoModeMatchesProjectFps(mode, fps) {
	const id = String(mode || '').trim()
	if (!id) return false
	const std = STANDARD_VIDEO_MODES[id]
	if (!std) return false
	return Math.abs(std.fps - normalizeProjectFps(fps)) < 0.06
}

/**
 * Infer project fps from legacy config when `machineProfile` is absent.
 * @param {object} cfg
 * @returns {number}
 */
function inferProjectFpsFromConfig(cfg) {
	if (!cfg || typeof cfg !== 'object') return 50
	const mp = cfg.machineProfile
	if (mp && mp.defaultProjectFps != null) return normalizeProjectFps(mp.defaultProjectFps)
	const mode = readScreenConfigValue(cfg, 1, 'mode') || cfg.casparServer?.screen_1_mode || '1080p5000'
	const std = STANDARD_VIDEO_MODES[String(mode)]
	if (std?.fps > 0) return normalizeProjectFps(std.fps)
	const dests = cfg.screenDestinations?.destinations
	if (Array.isArray(dests) && dests[0]?.fps > 0) return normalizeProjectFps(dests[0].fps)
	return 50
}

/**
 * @param {object} cfg
 * @returns {number}
 */
function resolveProjectFps(cfg) {
	return inferProjectFpsFromConfig(cfg)
}

/**
 * When project fps changes, update outputs that still inherit the previous default.
 * @param {object} cfg — mutated in place
 * @param {number} newFps
 * @param {number} [oldFps]
 */
function applyProjectFpsToInheritedOutputs(cfg, newFps, oldFps) {
	if (!cfg || typeof cfg !== 'object') return
	const prev = normalizeProjectFps(oldFps ?? inferProjectFpsFromConfig(cfg))
	const next = normalizeProjectFps(newFps)
	if (prev === next) return
	const nextMode = defaultVideoModeForProjectFps(next)
	if (!cfg.machineProfile || typeof cfg.machineProfile !== 'object') cfg.machineProfile = {}
	cfg.machineProfile.defaultProjectFps = next

	if (!cfg.casparServer || typeof cfg.casparServer !== 'object') cfg.casparServer = {}
	const screenCount = Math.max(1, Math.min(4, parseInt(String(cfg.casparServer.screen_count ?? cfg.screen_count ?? 1), 10) || 1))
	for (let n = 1; n <= screenCount; n++) {
		const key = `screen_${n}_mode`
		const cur = String(cfg.casparServer[key] || readScreenConfigValue(cfg, n, 'mode') || '')
		if (!cur || videoModeMatchesProjectFps(cur, prev)) {
			cfg.casparServer[key] = nextMode
		}
	}
	const mv = String(cfg.casparServer.multiview_mode || '')
	if (!mv || videoModeMatchesProjectFps(mv, prev)) {
		cfg.casparServer.multiview_mode = nextMode
	}

	const sd = cfg.screenDestinations
	if (sd && Array.isArray(sd.destinations)) {
		for (const d of sd.destinations) {
			if (!d || typeof d !== 'object') continue
			const inherits = d.inheritsProjectFps !== false
			const curMode = String(d.videoMode || '')
			if (inherits && (!curMode || videoModeMatchesProjectFps(curMode, prev))) {
				d.videoMode = nextMode
				d.inheritsProjectFps = true
				const std = STANDARD_VIDEO_MODES[nextMode]
				if (std) {
					d.width = std.width
					d.height = std.height
					d.fps = std.fps
				}
			}
		}
	}
}

module.exports = {
	STANDARD_PROJECT_FPS,
	normalizeProjectFps,
	defaultVideoModeForProjectFps,
	videoModeMatchesProjectFps,
	inferProjectFpsFromConfig,
	resolveProjectFps,
	applyProjectFpsToInheritedOutputs,
}
