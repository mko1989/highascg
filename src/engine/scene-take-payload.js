'use strict'

/**
 * WO-598 C1 — build the take/stage `incomingScene` payload ON THE SERVER from a stored look, so native
 * clients (Godot, WO-593) and Companion can take by id without re-implementing the web client's
 * builder. Mirrors `buildIncomingScenePayload()` (client/components/scenes-shared.js:274) and imports the
 * SAME pure client helpers (lower thirds, PIP overlays, dB scale, PGM-only transitions) so that logic has
 * one source. Parity with the real web builder is pinned by tools/smoke/smoke-wo598-take-payload-parity.test.js.
 *
 * Deliberate differences from the web builder:
 *  - no `playSeekFrames`: the take engine resolves relative starts itself and its own OSC read already
 *    wins over the client's value (src/engine/scene-play-seek.js:247-256, WO-582);
 *  - the authoring canvas is the target main's `channelMap.programResolutions[main]` (the web client feeds
 *    the same array into sceneState.setCanvasResolutions — client/lib/app-ws-handlers.js:84).
 */

const path = require('path')
const { pathToFileURL } = require('url')
const { REPO_ROOT } = require('../repo-paths')

const FALLBACK_CANVAS = { w: 1920, h: 1080 } // client/lib/scene-state-persistence-logic.js:12
const CLIENT_LIB = ['lower-third-cg-data', 'pip-overlay-registry', 'audio-volume-scale', 'transition-presets']

let helpersPromise = null

/** The pure client/lib ES modules (no DOM, no singletons — checked 2026-10-17). */
function loadClientHelpers() {
	if (!helpersPromise) {
		helpersPromise = Promise.all(
			CLIENT_LIB.map((n) => import(pathToFileURL(path.join(REPO_ROOT, 'client', 'lib', `${n}.js`)).href)),
		).then(([lt, pip, vol, tr]) => ({ lt, pip, vol, tr }))
	}
	return helpersPromise
}

const clone = (v) => JSON.parse(JSON.stringify(v))

function canvasForMain(channelMap, mainIdx) {
	const r = channelMap?.programResolutions?.[mainIdx]
	return r?.w > 0 && r?.h > 0 ? { w: r.w, h: r.h } : { ...FALLBACK_CANVAS }
}

function buildLayerRow(l, h) {
	const ltCfg = h.lt.isLowerThirdSource(l.source) ? h.lt.resolveLayerLowerThirdConfig(l) : null
	const row = {
		layerNumber: l.layerNumber,
		source: l.source
			? {
					type: l.source.type,
					value: l.source.value,
					isPlaceholder: !!l.source.isPlaceholder,
					template: l.source.template,
					...(l.source.parameters != null ? { parameters: l.source.parameters } : {}),
					/* WO-601: playback_timers.html reads its config from scene.live (template/playback_timers.js) */
					...(l.source.timersConfig && typeof l.source.timersConfig === 'object' ? { timersConfig: JSON.parse(JSON.stringify(l.source.timersConfig)) } : {}),
					...(ltCfg ? { lowerThirdConfig: clone(ltCfg) } : {}),
				}
			: null,
		loop: !!l.loop,
		straightAlpha: !!l.straightAlpha,
		contentFit: l.contentFit || (l.fillNativeAspect === false ? 'stretch' : 'native'),
		aspectLocked: l.aspectLocked !== false,
		fill: l.fill ? { ...l.fill } : undefined,
		opacity: l.opacity ?? 1,
		rotation: l.rotation ?? 0,
		transition: l.transition ? { ...l.transition } : null,
		audioRoute: l.audioRoute || '1+2',
		muted: !!l.muted,
		volume: l.volume != null ? l.volume : 1,
		volumeDb: h.vol.linearGainToCasparDb(l.muted ? 0 : l.volume != null ? l.volume : 1),
		fadeOnEnd:
			l.fadeOnEnd && typeof l.fadeOnEnd === 'object'
				? { enabled: !!l.fadeOnEnd.enabled, frames: l.fadeOnEnd.frames ?? 12 }
				: { enabled: false, frames: 12 },
		sourceMode: l.sourceMode || 'single',
		playlist: Array.isArray(l.playlist) ? clone(l.playlist) : [],
		playlistTransition: l.playlistTransition ? { ...l.playlistTransition } : { type: 'MIX', duration: 12, tween: 'linear' },
		playlistLoop: l.playlistLoop !== false,
		playlistAdvance: l.playlistAdvance || 'auto',
		...(Number(l.playlistFadeFrames) > 0 ? { playlistFadeFrames: Number(l.playlistFadeFrames) } : {}), // WO-766 ↘
		...(l.startBehaviour === 'beginning' || l.startBehaviour === 'relativeToPrevious' ? { startBehaviour: l.startBehaviour } : {}),
		...(l.trimInMs != null ? { trimInMs: l.trimInMs } : {}),
		...(l.trimOutMs != null ? { trimOutMs: l.trimOutMs } : {}),
	}
	if (Array.isArray(l.effects) && l.effects.length > 0) row.effects = clone(l.effects)
	const pipOverlays = h.pip.getPipOverlaysFromLayer(l)
	if (pipOverlays.length > 0) row.pipOverlays = clone(pipOverlays)
	/* WO-601: countdown layers keep their own flat cgData (= countdownConfig). The LT branch below accepts ANY
	 * object cgData (resolveLayerLowerThirdCgData) and replaced it with lower-third defaults on every take. */
	if (String(l.source?.value || '').toLowerCase().replace(/\\/g, '/').includes('countdown/countdown')) {
		if (l.cgData && typeof l.cgData === 'object') row.cgData = clone(l.cgData)
	} else if (ltCfg || h.lt.resolveLayerLowerThirdCgData(l)) {
		row.cgData = h.lt.buildLowerThirdCasparCgData(ltCfg || l.source?.lowerThirdConfig || {})
	} else if (l.templateData && typeof l.templateData === 'object') {
		row.templateData = clone(l.templateData)
	} else if (l.source?.type === 'template' && l.source?.data && typeof l.source.data === 'object') {
		row.cgData = clone(l.source.data)
	} else if (h.lt.isLowerThirdSource(l.source) && !h.lt.isStudioLowerThirdSource(l.source)) {
		// WO-663: a studio export with no operator text keeps none — the server takes it with its baked values
		row.cgData = { data: {}, style: {} }
	}
	return row
}

/**
 * @param {object} scene stored look (project.scenes.scenes[i])
 * @param {{ mainIdx: number, channelMap: object, pgmOnly?: boolean }} opts
 * @returns {Promise<object>} incomingScene for POST /api/scene/take
 */
async function buildServerIncomingScene(scene, opts) {
	const h = await loadClientHelpers()
	const mainIdx = Math.max(0, Math.min(3, Number(opts?.mainIdx) || 0))
	const cv = canvasForMain(opts?.channelMap, mainIdx)
	let payload = {
		id: scene.id,
		name: scene.name || 'Untitled look',
		defaultTransition: scene.defaultTransition ? { ...scene.defaultTransition } : { type: 'CUT', duration: 0, tween: 'linear' },
		composeCanvas: { w: cv.w, h: cv.h },
		globalBorder: scene.globalBorder ? clone(scene.globalBorder) : undefined,
		layers: (scene.layers || []).map((l) => buildLayerRow(l, h)),
		...(scene.audioOnlyLook ? { audioOnlyLook: true } : {}),
	}
	if (opts?.pgmOnly === true) {
		const n = h.tr.normalizeTransitionForPgmOnly
		payload = {
			...payload,
			defaultTransition: n(payload.defaultTransition),
			layers: payload.layers.map((l) => ({
				...l,
				transition: l.transition ? n(l.transition) : l.transition,
				playlistTransition: l.playlistTransition ? n(l.playlistTransition) : l.playlistTransition,
			})),
		}
	}
	return payload
}

/**
 * WO-655: routing.getChannelMap() carries no programResolutions, so the server-built take / preview push fell back to
 * a 1920×1080 canvas and letterboxed every look authored on the real program canvas (3072×1024 → x pushed ~235 px).
 * Fill them from the live merged channel map — the one clients author on (GET /api/state channelMap).
 */
function withProgramResolutions(map, ctx) {
	if (Array.isArray(map?.programResolutions) && map.programResolutions.length) return map
	let pr
	try {
		pr = ctx?.state?.getState?.()?.channelMap?.programResolutions
		if (!Array.isArray(pr) && ctx?.config) pr = require('../config/channel-map-from-ctx').buildChannelMap(ctx)?.programResolutions
	} catch (_) {}
	return Array.isArray(pr) && pr.length ? { ...map, programResolutions: pr } : map
}

module.exports = { buildServerIncomingScene, canvasForMain, loadClientHelpers, withProgramResolutions }
