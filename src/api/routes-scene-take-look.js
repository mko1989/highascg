'use strict'

/**
 * WO-598 C1 — POST /api/scene/take-look { sceneId, mainIdx?, target?: 'program'|'preview', forceCut?, transitionOverride? }
 *
 * Take (or stage on PRV) a stored look BY ID: the server builds the incomingScene itself
 * (src/engine/scene-take-payload.js — parity-tested against the web builder) and hands the exact body
 * the web client would send to the existing take engine (handleSceneTake). No second take path.
 * Used by the Godot client (WO-593); the web client and Companion keep their current paths until the
 * owner has QA'd this on the box (WO-598 T3).
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { sanitizeVisibilityMap } = require('../engine/timer-visibility-map')

function bad(status, error) {
	return { status, headers: JSON_HEADERS, body: jsonBody({ ok: false, error }) }
}

/**
 * `timersVisibility` (WO-840): the preset item's `{ [timerId]: boolean }` for this screen, applied on the program channel
 * after the take; a look has none of its own (timers are per screen, RULES.md "Timers").
 * `takeGroup` ({id, size}, WO-782): this take is one screen of a multi-screen recall — passed on to the take engine,
 * whose barrier sends every screen's final PLAY batch together (WO-574). A take that bails out here never reached the
 * engine, so its group slot is released at once (the other screens must not wait out the barrier timeout).
 * @param {unknown} body
 * @param {object} ctx
 * @param {{ resolveSceneById?: Function, getChannelMap?: Function, take?: Function, withBorder?: Function }} [deps]
 */
async function handleTakeLook(body, ctx, deps = {}) {
	const b = parseBody(body)
	const res = await takeLook(b, ctx, deps)
	if (res.status >= 400 && !res.handedToTake) require('../engine/take-sync-barrier').joinTakeGroup(b.takeGroup)?.leave()
	delete res.handedToTake
	return res
}

async function takeLook(b, ctx, deps) {
	const sceneId = String(b.sceneId || '').trim()
	if (!sceneId) return bad(400, 'sceneId required')
	const { resolveLiveSceneById } = require('../engine/project-scenes-transform')
	const scene = deps.resolveSceneById ? deps.resolveSceneById(sceneId) : resolveLiveSceneById(ctx, sceneId)
	if (!scene) return bad(404, `look ${sceneId} not found in the stored project`)

	const getMap = deps.getChannelMap || require('../config/routing').getChannelMap
	const map = require('../engine/scene-take-payload').withProgramResolutions(getMap(ctx?.config || {}, ctx?.switcherOutputBusByChannel) || {}, ctx)
	const scope = parseInt(String(scene.mainScope ?? ''), 10)
	const mainIdx = Number.isFinite(Number(b.mainIdx)) ? Math.max(0, Math.floor(Number(b.mainIdx))) : Number.isFinite(scope) ? scope : 0
	const programCh = Number(map.programChannels?.[mainIdx])
	if (!Number.isFinite(programCh) || programCh <= 0) return bad(400, `no program channel for main ${mainIdx}`)
	const prvCh = Number(map.previewChannels?.[mainIdx])
	const pgmOnly = !(Number.isFinite(prvCh) && prvCh > 0 && prvCh !== programCh)
	const target = b.target === 'preview' ? 'preview' : 'program'
	const fps = map.programResolutions?.[mainIdx]?.fps ?? 50

	const { buildServerIncomingScene } = require('../engine/scene-take-payload')
	let incomingScene = await buildServerIncomingScene(scene, {
		mainIdx,
		channelMap: map,
		pgmOnly: target === 'program' && pgmOnly, // same rule as the web take fan-out (scenes-editor-support.js:178-189)
	})
	const withBorder = deps.withBorder || require('../engine/global-border-control').withScreenGlobalBorderForChannel
	incomingScene = withBorder(incomingScene, ctx, programCh)
	// Look-preset "Take (global)": the deck default replaces the look's own transition (web takeScenesToProgram).
	const tOver = b.transitionOverride && typeof b.transitionOverride === 'object' ? b.transitionOverride : null
	if (tOver && target === 'program') {
		const tp = await import(require('url').pathToFileURL(require('path').join(__dirname, '../../client/lib/transition-presets.js')).href)
		incomingScene = { ...incomingScene, defaultTransition: pgmOnly ? tp.normalizeTransitionForPgmOnly(tOver) : { ...tOver } }
	}

	const takeBody = {
		channel: programCh,
		sceneId,
		framerate: fps,
		forceCut: b.forceCut === true,
		useServerLive: true,
		incomingScene,
		...(target === 'preview' ? { target: 'preview' } : {}),
		// WO-840: a look-preset item's per-screen timer visibility rides the program take (a plain look take sends none).
		...(target === 'program' && sanitizeVisibilityMap(b.timersVisibility) ? { timersVisibility: sanitizeVisibilityMap(b.timersVisibility) } : {}),
		...(b.takeGroup ? { takeGroup: b.takeGroup } : {}),
	}
	const take = deps.take || require('./routes-scene-take').handleSceneTake
	return { ...(await take(takeBody, ctx)), handedToTake: true }
}

module.exports = { handleTakeLook }
