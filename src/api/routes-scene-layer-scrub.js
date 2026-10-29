'use strict'

/**
 * WO-813 — POST /api/scene/layer-scrub { sceneId, mainIdx?, layerNumber, ms }
 *
 * The look-layer inspector's Trim section (Godot layer_inspector → clip_trim_section.gd; the "Custom" start option it
 * first lived under was removed 29.10 — trim works under both start options) scrubs the layer's clip on PRV while the
 * operator picks trim in / out. It reuses the timeline's paced seek (WO-790 timeline-scrub-gate:
 * one CALL SEEK per Caspar layer in flight, released by OSC file/time, newest target next) on the timeline engine's
 * own gate map, so a timeline drag and a look scrub on the same layer never stack seeks.
 *
 * Only the look's PRV copy is touched: the main's preview channel, and only while that channel holds THIS look with
 * the same clip on the layer (live-scene-state). PGM is never sought. Not on PRV → { onPrv: false, reason } and
 * nothing is sent; the client then says the slider only picks points for the next take.
 *
 * SEEK counts channel frames on this build (WO-592 / WO-787): frame = ms × channel fps / 1000. PRV has no A/B bank
 * offset, so the physical layer is the look's layer number (routes-scene-layer-tools.js handleLayerReload).
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

function out(status, payload) {
	return { status, headers: JSON_HEADERS, body: jsonBody(payload) }
}

let _fallbackEngine = null

/** The timeline engine shares its gate map; without one (tests, early boot) a holder with the same shape. */
function gateEngine(ctx) {
	const eng = ctx?.timelineEngine
	if (eng && eng.self) return eng
	if (!_fallbackEngine || _fallbackEngine.self !== ctx) _fallbackEngine = { self: ctx }
	return _fallbackEngine
}

/** ms in the clip → SEEK frame in channel frames. */
function seekFrameForMs(ms, chFps) {
	return Math.max(0, Math.round((Math.max(0, Number(ms) || 0) * Math.max(1, Number(chFps) || 25)) / 1000))
}

/**
 * @param {unknown} body
 * @param {object} ctx
 * @param {object} [deps] tests: resolveScene, getChannelMap, getStaged, scrubSeek, recordSeek
 */
async function handleLayerScrub(body, ctx, deps = {}) {
	const b = parseBody(body)
	const sceneId = String(b.sceneId || '').trim()
	const ln = Number(b.layerNumber)
	const ms = Number(b.ms)
	if (!sceneId || !Number.isFinite(ln) || !Number.isFinite(ms) || ms < 0) {
		return out(400, { ok: false, error: 'sceneId, layerNumber and ms (≥ 0) required' })
	}
	const scene = deps.resolveScene
		? deps.resolveScene(sceneId)
		: require('../engine/project-scenes-transform').resolveLiveSceneById(ctx, sceneId)
	const layer = (scene?.layers || []).find((l) => Number(l?.layerNumber) === ln)
	const src = String(layer?.source?.value || '')
	if (!src) return out(404, { ok: false, error: `layer ${ln} has no source` })
	if (src.startsWith('route://') || String(layer.source.type || '') === 'template') {
		return out(200, { ok: true, onPrv: false, reason: 'not_a_clip' })
	}
	const map = deps.getChannelMap
		? deps.getChannelMap()
		: require('../engine/scene-take-payload').withProgramResolutions(
				require('../config/routing').getChannelMap(ctx?.config || {}, ctx?.switcherOutputBusByChannel) || {},
				ctx
			)
	const scope = parseInt(String(scene.mainScope ?? ''), 10)
	const mainIdx = Number.isFinite(Number(b.mainIdx))
		? Math.max(0, Math.floor(Number(b.mainIdx)))
		: Number.isFinite(scope)
			? scope
			: 0
	const pgmCh = Number(map.programChannels?.[mainIdx] ?? map.playbackChannels?.[mainIdx])
	const prvCh = Number(map.previewChannels?.[mainIdx])
	if (!(Number.isFinite(prvCh) && prvCh > 0 && prvCh !== pgmCh))
		return out(200, { ok: true, onPrv: false, reason: 'pgm_only' })

	const getStaged = deps.getStaged || ((ch) => require('../state/live-scene-state').getChannel(ch))
	const staged = getStaged(prvCh)
	if (String(staged?.sceneId || '') !== sceneId) return out(200, { ok: true, onPrv: false, reason: 'not_on_prv' })
	const stagedLayer = (staged.scene?.layers || []).find((l) => Number(l?.layerNumber) === ln)
	if (String(stagedLayer?.source?.value || '') !== src)
		return out(200, { ok: true, onPrv: false, reason: 'clip_not_staged' })

	const { resolveChannelFramerateForMixerTween } = require('../engine/scene-transition')
	const chFps = Math.max(1, resolveChannelFramerateForMixerTween(ctx, prvCh, 25))
	const frame = seekFrameForMs(ms, chFps)
	const seek = deps.scrubSeek || require('../engine/timeline-scrub-gate').scrubSeek
	seek(gateEngine(ctx), prvCh, ln, frame, chFps, (err) =>
		ctx?.log?.('warn', `[layer-scrub] CALL ${prvCh}-${ln} SEEK ${frame}: ${err?.message || err}`)
	)
	const record = deps.recordSeek || require('../state/playback-tracker').recordSeek
	record(ctx, prvCh, ln, Math.round(ms)) // the WO-570 matrix tracker follows, like /api/seek
	return out(200, { ok: true, onPrv: true, channel: prvCh, layer: ln, frame, chFps })
}

module.exports = { handleLayerScrub, seekFrameForMs }
