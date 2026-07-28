import { defaultVideoModeForProjectFps, resolveProjectFpsFromSettings } from '../lib/project-fps.js'
import { edgeOutputLayer } from '../lib/device-view-output-layer.js'

export const STANDARD_VIDEO_MODES = [
	'PAL', 'NTSC', '576p2500', '720p2398', '720p2400', '720p2500', '720p2997', '720p3000', '720p5000', '720p5994', '720p6000',
	'1080i5000', '1080i5994', '1080i6000', '1080p2398', '1080p2400', '1080p2500', '1080p2997', '1080p3000', '1080p5000', '1080p5994', '1080p6000',
	'1556p2398', '1556p2400', '1556p2500', '2160p2398', '2160p2400', '2160p2500', '2160p2997', '2160p3000', '2160p5000', '2160p5994', '2160p6000',
	'dci1080p2398', 'dci1080p2400', 'dci1080p2500', 'dci2160p2398', 'dci2160p2400', 'dci2160p2500',
]

/** Matches server `src/config/config-modes.js` — used for OS override / xrandr pixel mode from Caspar video mode. */
export const CASPAR_VIDEO_MODE_SPECS = {
	PAL: { width: 720, height: 576, fps: 25 },
	NTSC: { width: 720, height: 486, fps: 29.97 },
	'576p2500': { width: 720, height: 576, fps: 25 },
	'720p2398': { width: 1280, height: 720, fps: 23.98 },
	'720p2400': { width: 1280, height: 720, fps: 24 },
	'720p2500': { width: 1280, height: 720, fps: 25 },
	'720p5000': { width: 1280, height: 720, fps: 50 },
	'720p2997': { width: 1280, height: 720, fps: 29.97 },
	'720p5994': { width: 1280, height: 720, fps: 59.94 },
	'720p3000': { width: 1280, height: 720, fps: 30 },
	'720p6000': { width: 1280, height: 720, fps: 60 },
	'1080p2398': { width: 1920, height: 1080, fps: 23.98 },
	'1080p2400': { width: 1920, height: 1080, fps: 24 },
	'1080p2500': { width: 1920, height: 1080, fps: 25 },
	'1080p5000': { width: 1920, height: 1080, fps: 50 },
	'1080p2997': { width: 1920, height: 1080, fps: 29.97 },
	'1080p5994': { width: 1920, height: 1080, fps: 59.94 },
	'1080p3000': { width: 1920, height: 1080, fps: 30 },
	'1080p6000': { width: 1920, height: 1080, fps: 60 },
	'1080i5000': { width: 1920, height: 1080, fps: 50 },
	'1080i5994': { width: 1920, height: 1080, fps: 59.94 },
	'1080i6000': { width: 1920, height: 1080, fps: 60 },
	'1556p2398': { width: 2048, height: 1556, fps: 23.98 },
	'1556p2400': { width: 2048, height: 1556, fps: 24 },
	'1556p2500': { width: 2048, height: 1556, fps: 25 },
	'2160p2398': { width: 3840, height: 2160, fps: 23.98 },
	'2160p2400': { width: 3840, height: 2160, fps: 24 },
	'2160p2500': { width: 3840, height: 2160, fps: 25 },
	'2160p2997': { width: 3840, height: 2160, fps: 29.97 },
	'2160p3000': { width: 3840, height: 2160, fps: 30 },
	'2160p5000': { width: 3840, height: 2160, fps: 50 },
	'2160p5994': { width: 3840, height: 2160, fps: 59.94 },
	'2160p6000': { width: 3840, height: 2160, fps: 60 },
	'dci1080p2398': { width: 2048, height: 1080, fps: 23.98 },
	'dci1080p2400': { width: 2048, height: 1080, fps: 24 },
	'dci1080p2500': { width: 2048, height: 1080, fps: 25 },
	'dci2160p2398': { width: 4096, height: 2160, fps: 23.98 },
	'dci2160p2400': { width: 4096, height: 2160, fps: 24 },
	'dci2160p2500': { width: 4096, height: 2160, fps: 25 },
}

/**
 * @param {string} modeId
 * @param {{ customWidth?: number, customHeight?: number, customFps?: number }} [opts]
 * @returns {{ osMode: string, osRate: number } | null}
 */
export function casparVideoModeToOsModeAndRate(modeId, opts) {
	const raw = String(modeId || '').trim()
	const aliases = {
		'1080p50': '1080p5000',
		'720p50': '720p5000',
		'1080p60': '1080p6000',
		'720p60': '720p6000',
		'1080p59.94': '1080p5994',
		'720p59.94': '720p5994',
	}
	const id = aliases[raw] || raw
	if (!id || id === 'custom') {
		const w = Math.max(64, parseInt(String(opts?.customWidth ?? 1920), 10) || 1920)
		const h = Math.max(64, parseInt(String(opts?.customHeight ?? 1080), 10) || 1080)
		const fps = Math.max(1, parseFloat(String(opts?.customFps ?? 50)) || 50)
		return { osMode: `${w}x${h}`, osRate: fps }
	}
	const spec = CASPAR_VIDEO_MODE_SPECS[id]
	if (spec) return { osMode: `${spec.width}x${spec.height}`, osRate: spec.fps }
	const m = id.match(/^(\d+)\s*x\s*(\d+)$/i)
	if (m) {
		const w = parseInt(m[1], 10) || 1920
		const h = parseInt(m[2], 10) || 1080
		const fps = Math.max(1, parseFloat(String(opts?.customFps ?? 50)) || 50)
		return { osMode: `${w}x${h}`, osRate: fps }
	}
	return null
}

const CASPAR_VIDEO_MODE_ALIASES = {
	'1080p50': '1080p5000',
	'720p50': '720p5000',
	'1080p60': '1080p6000',
	'720p60': '720p6000',
	'1080p59.94': '1080p5994',
	'720p59.94': '720p5994',
	'1080p25': '1080p2500',
	'720p25': '720p2500',
	'2160p50': '2160p5000',
	'2160p60': '2160p6000',
}

function fpsNear(a, b) {
	return Math.abs(Number(a) - Number(b)) <= 0.06
}

/**
 * Normalize shorthand / legacy Caspar mode ids to canonical STANDARD_VIDEO_MODES entries.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeCasparVideoModeId(raw) {
	const id = String(raw || '').trim()
	if (!id) return ''
	if (id === 'custom') return 'custom'
	const aliased = CASPAR_VIDEO_MODE_ALIASES[id] || id
	if (STANDARD_VIDEO_MODES.includes(aliased)) return aliased
	const px = aliased.match(/^(\d+)\s*x\s*(\d+)p?([\d.]+)?$/i)
	if (px) {
		const w = parseInt(px[1], 10) || 0
		const h = parseInt(px[2], 10) || 0
		const fps = px[3] ? parseFloat(px[3]) : NaN
		const matched = matchCasparVideoModeFromDimensions(w, h, fps)
		if (matched) return matched
		return 'custom'
	}
	return aliased
}

/**
 * @param {number} width
 * @param {number} height
 * @param {number} [fps]
 * @returns {string | null}
 */
export function matchCasparVideoModeFromDimensions(width, height, fps) {
	const w = Math.max(0, parseInt(String(width), 10) || 0)
	const h = Math.max(0, parseInt(String(height), 10) || 0)
	if (w <= 0 || h <= 0) return null
	const rate = Number.isFinite(Number(fps)) && Number(fps) > 0 ? Number(fps) : null
	for (const mode of STANDARD_VIDEO_MODES) {
		const spec = CASPAR_VIDEO_MODE_SPECS[mode]
		if (!spec) continue
		if (spec.width === w && spec.height === h && (rate == null || fpsNear(spec.fps, rate))) return mode
	}
	return null
}

/**
 * @param {{ resolution?: string, refreshHz?: number, modes?: object[] }} [display]
 * @param {{ mode: string, rate?: string, current?: boolean }[]} [detectedModes]
 * @param {number} [preferredIdx]
 * @returns {{ modeId: string, width?: number, height?: number, fps?: number } | null}
 */
export function casparVideoModeFromDetectedDisplay(display, detectedModes, preferredIdx = -1) {
	const modes = Array.isArray(detectedModes) ? detectedModes : []
	let pick = null
	if (preferredIdx >= 0 && preferredIdx < modes.length) pick = modes[preferredIdx]
	if (!pick) pick = modes.find((m) => m?.current) || modes[0] || null
	if (pick?.mode) {
		const mm = String(pick.mode).match(/^(\d+)x(\d+)$/i)
		if (mm) {
			const w = parseInt(mm[1], 10)
			const h = parseInt(mm[2], 10)
			const fps = parseFloat(String(pick.rate || display?.refreshHz || '')) || NaN
			const matched = matchCasparVideoModeFromDimensions(w, h, fps)
			if (matched) return { modeId: matched }
			return {
				modeId: 'custom',
				width: w,
				height: h,
				fps: Number.isFinite(fps) && fps > 0 ? fps : 50,
			}
		}
	}
	const mr = String(display?.resolution || '').match(/^(\d+)x(\d+)$/)
	if (mr) {
		const w = parseInt(mr[1], 10)
		const h = parseInt(mr[2], 10)
		const fps = Number(display?.refreshHz)
		const matched = matchCasparVideoModeFromDimensions(w, h, fps)
		if (matched) return { modeId: matched }
		return {
			modeId: 'custom',
			width: w,
			height: h,
			fps: Number.isFinite(fps) && fps > 0 ? fps : 50,
		}
	}
	return null
}

/**
 * Resolve Video Mode dropdown value for a GPU jack (display only — does not mutate settings).
 * @param {object} opts
 */
export function resolveGpuInspectorVideoMode(opts) {
	const {
		cs = {},
		currentSettings = {},
		screenN = 1,
		conn = null,
		inherited = null,
		detectedDisplay = null,
		uniqueDetectedModes = [],
		defaultModeIdx = 0,
		physicalCasparMode = null,
	} = opts
	const projectMode = defaultVideoModeForProjectFps(resolveProjectFpsFromSettings(currentSettings))
	const keyMode = `screen_${screenN}_mode`
	const savedRaw = cs[keyMode] ?? currentSettings?.casparServer?.[keyMode] ?? currentSettings?.[keyMode]
	const savedNorm = savedRaw != null && String(savedRaw).trim() !== '' ? normalizeCasparVideoModeId(savedRaw) : ''

	const readCustom = (suffix, fallback) => {
		const k = `screen_${screenN}_${suffix}`
		return cs[k] ?? currentSettings?.casparServer?.[k] ?? fallback
	}

	const fromCandidate = (raw, customDims) => {
		const norm = normalizeCasparVideoModeId(raw)
		if (norm === 'custom' || (!STANDARD_VIDEO_MODES.includes(norm) && customDims)) {
			return {
				modeId: 'custom',
				width: customDims?.width ?? 1920,
				height: customDims?.height ?? 1080,
				fps: customDims?.fps ?? 50,
			}
		}
		if (STANDARD_VIDEO_MODES.includes(norm)) return { modeId: norm }
		return null
	}

	const savedCandidate = savedNorm
		? fromCandidate(savedNorm, {
				width: readCustom('custom_width', 1920),
				height: readCustom('custom_height', 1080),
				fps: readCustom('custom_fps', 50),
			})
		: null

	const liveCandidates = []
	if (conn?.caspar?.mode) liveCandidates.push(fromCandidate(conn.caspar.mode, inherited))
	if (inherited?.mode) {
		liveCandidates.push(
			fromCandidate(inherited.mode, {
				width: inherited.width,
				height: inherited.height,
				fps: inherited.fps,
			}),
		)
	}
	if (physicalCasparMode) liveCandidates.push(fromCandidate(physicalCasparMode, inherited))
	const edid = casparVideoModeFromDetectedDisplay(detectedDisplay, uniqueDetectedModes, defaultModeIdx)
	if (edid) liveCandidates.push(edid)

	const genericDefaults = new Set([projectMode, '1080p5000', '720p5000', ''])
	const firstLive = liveCandidates.find((c) => c && c.modeId) || null
	if (savedCandidate?.modeId && genericDefaults.has(savedCandidate.modeId) && firstLive?.modeId) {
		return firstLive
	}
	if (savedCandidate?.modeId && !genericDefaults.has(savedCandidate.modeId)) {
		return savedCandidate
	}
	if (firstLive) return firstLive
	if (savedCandidate) return savedCandidate
	return { modeId: projectMode }
}

/* WO-365: the parser moved to client/lib/device-view-output-layer.js (the cable renderer needed
 * it too and a third copy was one copy too many). Re-exported here so the existing
 * inspector/destination import chain is unchanged. */
export { edgeOutputLayer }
