/**
 * Global border command builders.
 */

'use strict'

const fs = require('fs')
const path = require('path')

const { TEMPLATE_MAP, mergePipOverlayParamsWithDefaults } = require('./pip-overlay-utils')
const { deferMixerAmcpLine } = require('../caspar/amcp-utils')

const REPO_ROOT = path.resolve(__dirname, '..', '..')

/** Per-screen border from project (`scenes.globalBorders[screenIndex]`). */
function readGlobalBorderSlot(screenIdx) {
	if (!Number.isFinite(screenIdx) || screenIdx < 0) return null
	try {
		const { loadProjectScenes } = require('./project-scenes')
		const scenes = loadProjectScenes()
		const arr = scenes?.globalBorders
		if (!Array.isArray(arr) || screenIdx >= arr.length) return null
		return arr[screenIdx]
	} catch {
		return null
	}
}

/**
 * Look `globalBorder` does not store layout slices; the inspector saves them on
 * `globalBorders[screenIndex]`. Merge those rects into the border used for PGM output.
 */
function mergeScreenSlicesIntoBorder(lookBorder, screenIdx) {
	if (!lookBorder || typeof lookBorder !== 'object') return lookBorder
	const slot = readGlobalBorderSlot(screenIdx)
	if (!slot || !Array.isArray(slot.slices) || slot.slices.length === 0) return lookBorder
	return { ...lookBorder, slices: slot.slices }
}

/**
 * Normalize the overlay payload for the global border template. The global border
 * spans the entire channel (inner = full canvas), so `side: 'outside'` is meaningless
 * and actually breaks rendering: the template applies a negative margin to push the
 * border out of the body, which the HTML consumer shows as scrollbars and clips the
 * border off-screen. Always force `inside`.
 */
function _forceInside(overlay) {
	if (!overlay || typeof overlay !== 'object') return overlay
	const params = { ...(overlay.params || {}), side: 'inside' }
	return { ...overlay, params }
}

/** JSON for global-border templates: visual params + inner only (no Art-Net / fade / mirror metadata). */
function buildGlobalBorderCgJson(overlay, opts = {}) {
	const ov = _forceInside(overlay)
	const p = mergePipOverlayParamsWithDefaults(ov)
	p.side = 'inside'
	const out = { ...p }
	if (opts.liveFile) out.liveFile = String(opts.liveFile)
	
	if (Array.isArray(ov.slices) && ov.slices.length > 0) {
		out.slices = ov.slices
		// For backward compatibility with templates that only look at .inner:
		// use the first slice as the "inner" rect.
		const s0 = ov.slices[0]
		out.inner = { l: s0.x ?? 0, t: s0.y ?? 0, w: s0.w ?? 1, h: s0.h ?? 1 }
	} else {
		out.inner = { l: 0, t: 0, w: 1, h: 1 }
		out.slices = []
	}

	// Non-visual keys must not reach Caspar CG (templates only read style params).
	for (const k of [
		'enabled',
		'type',
		'artnetListenEnabled',
		'artnetChannelMap',
		'artnetPatch',
		'fadeDuration',
		'mirrorBorderOnPrv',
		'borderPresets',
		'pgmAirSnapshot',
		'activePgmLayer',
	]) {
		delete out[k]
	}
	return JSON.stringify(out)
}

function buildGlobalBorderAmcpLines(channel, layer, overlay, appCtx, opts) {
	if (!overlay?.type) return []
	const ov = _forceInside(overlay)
	const template = TEMPLATE_MAP[ov.type] || 'pip_border'
	const cl = `${channel}-${layer}`
	const { liveFileName } = require('./global-border-live')
	const ch = parseInt(channel, 10)
	const data = buildGlobalBorderCgJson(ov, {
		liveFile: Number.isFinite(ch) && ch >= 1 ? liveFileName(ch) : undefined,
	})
	const escaped = data.replace(/"/g, '\\"')
	const initialOpacity =
		opts && Number.isFinite(Number(opts.initialOpacity)) ? Math.max(0, Math.min(1, Number(opts.initialOpacity))) : 1

	const lines = []
	if (initialOpacity === 0) {
		// Immediate (non-DEFER): must apply before the fade tween line; a deferred OPACITY 0 on COMMIT can fight the fade-in tween.
		lines.push(`MIXER ${cl} OPACITY 0 0`)
	}
	// Many Caspar/CEF builds reject CG UPDATE until after PLAY; some also need an initial UPDATE after PLAY
	// (same sequence as startup-led-test-pattern and led test card routes).
	const updateDur = Math.max(0, Math.floor(Number(opts?.updateDuration) || 0))
	lines.push(
		`CG ${cl} ADD 0 "${template}" 1 "${escaped}"`,
		`CG ${cl} PLAY 0`,
		`CG ${cl} UPDATE 0 "${escaped}"`,
		deferMixerAmcpLine(`MIXER ${cl} FILL 0 0 1 1 0`),
		deferMixerAmcpLine(`MIXER ${cl} KEYER 0`),
	)
	// When starting visible, set final opacity in the same deferred batch as FILL/KEYER.
	if (initialOpacity !== 0) {
		lines.push(deferMixerAmcpLine(`MIXER ${cl} OPACITY ${initialOpacity} 0`))
	}
	return lines
}

function buildGlobalBorderUpdateLines(channel, layer, overlay, opts) {
	if (!overlay?.type) return []
	const ov = _forceInside(overlay)
	const cl = `${channel}-${layer}`
	const data = buildGlobalBorderCgJson(ov)
	const escaped = data.replace(/"/g, '\\"')
	const updateDur = Math.max(0, Math.floor(Number(opts?.updateDuration) || 0))
	// After ADD+PLAY warmed the Flash layer (`buildGlobalBorderAmcpLines`), params should move via UPDATE only —
	// repeating PLAY each drag step spams Caspar logs and stalls CEF.
	return [`CG ${cl} UPDATE 0 "${escaped}"`]
}

function buildGlobalBorderOpacityFadeLine(channel, layer, targetOpacity, durationFrames, tween) {
	const cl = `${channel}-${layer}`
	const target = Math.max(0, Math.min(1, Number(targetOpacity) || 0))
	const dur = Math.max(0, Math.floor(Number(durationFrames) || 0))
	let tail = `${target} ${dur}`
	if (tween) tail += ` ${tween}`
	const line = `MIXER ${cl} OPACITY ${tail}`
	// Defer so the tween runs after the same-channel `MIXER … COMMIT` that applies CG ADD / DEFER fills (otherwise fade-in can be skipped or fight non-deferred ops).
	return dur > 0 ? deferMixerAmcpLine(line) : line
}

function buildGlobalBorderClearLines(channel, layer) {
	const cl = `${channel}-${layer}`
	return [`CG ${cl} CLEAR`, `MIXER ${cl} CLEAR`]
}

/** PGM stack layers for dual-layer preset crossfades (WO-43). */
const GLOBAL_BORDER_LAYER_PGM_A = 998
const GLOBAL_BORDER_LAYER_PGM_B = 996

/**
 * @param {object} border — look `globalBorder` payload (type, params, enabled, …)
 * @returns {object | null} overlay for CG builders
 */
function borderPayloadToOverlay(border) {
	if (!border || typeof border !== 'object') return null
	const type = String(border.type || '').trim()
	if (!type) return null
	const flat = mergePipOverlayParamsWithDefaults(border)
	return _forceInside({
		type,
		enabled: border.enabled !== false,
		params: { ...flat, side: 'inside' },
		slices: Array.isArray(border.slices) ? border.slices : [],
	})
}

/**
 * Prepare `toLayer` with preset data, then crossfade opacity from `fromLayer` → 0 and `toLayer` → 1.
 * @param {'add'|'update'} inactiveMode — UPDATE if the inactive layer already has the template loaded.
 */
function buildGlobalBorderPresetCrossfadeLines(channel, fromLayer, toLayer, border, appCtx, fadeDuration, inactiveMode) {
	const ch = parseInt(channel, 10)
	const fromL = parseInt(fromLayer, 10)
	const toL = parseInt(toLayer, 10)
	const fadeDur = Math.max(0, Math.floor(Number(fadeDuration) || 0))
	const mode = inactiveMode === 'add' ? 'add' : 'update'
	if (!Number.isFinite(ch) || ch < 1 || !Number.isFinite(fromL) || !Number.isFinite(toL)) return []

	const ov = borderPayloadToOverlay(border)
	if (!ov) return []

	const lines = []
	if (mode === 'update') {
		lines.push(...buildGlobalBorderUpdateLines(ch, toL, ov))
	} else {
		lines.push(...buildGlobalBorderAmcpLines(ch, toL, ov, appCtx, { initialOpacity: 0 }))
	}
	lines.push(buildGlobalBorderOpacityFadeLine(ch, fromL, 0, fadeDur))
	lines.push(buildGlobalBorderOpacityFadeLine(ch, toL, 1, fadeDur))
	return lines
}

module.exports = {
	buildGlobalBorderCgJson,
	buildGlobalBorderAmcpLines,
	buildGlobalBorderUpdateLines,
	buildGlobalBorderOpacityFadeLine,
	buildGlobalBorderClearLines,
	buildGlobalBorderPresetCrossfadeLines,
	borderPayloadToOverlay,
	mergeScreenSlicesIntoBorder,
	readGlobalBorderSlot,
	GLOBAL_BORDER_LAYER_PGM_A,
	GLOBAL_BORDER_LAYER_PGM_B,
}
