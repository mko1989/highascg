'use strict'

/**
 * WO-598 C1 — POST /api/scene/take-look { sceneId, mainIdx?, target?: 'program'|'preview', forceCut? }
 *
 * Take (or stage on PRV) a stored look BY ID: the server builds the incomingScene itself
 * (src/engine/scene-take-payload.js — parity-tested against the web builder) and hands the exact body
 * the web client would send to the existing take engine (handleSceneTake). No second take path.
 * Used by the Godot client (WO-593); the web client and Companion keep their current paths until the
 * owner has QA'd this on the box (WO-598 T3).
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

function bad(status, error) {
	return { status, headers: JSON_HEADERS, body: jsonBody({ ok: false, error }) }
}

/**
 * @param {unknown} body
 * @param {object} ctx
 * @param {{ resolveSceneById?: Function, getChannelMap?: Function, take?: Function, withBorder?: Function }} [deps]
 */
async function handleTakeLook(body, ctx, deps = {}) {
	const b = parseBody(body)
	const sceneId = String(b.sceneId || '').trim()
	if (!sceneId) return bad(400, 'sceneId required')
	const resolveScene = deps.resolveSceneById || require('../engine/project-scenes-transform').resolveSceneById
	const scene = resolveScene(sceneId)
	if (!scene) return bad(404, `look ${sceneId} not found in the stored project`)

	const getMap = deps.getChannelMap || require('../config/routing').getChannelMap
	const map = getMap(ctx?.config || {}, ctx?.switcherOutputBusByChannel) || {}
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

	const takeBody = {
		channel: programCh,
		sceneId,
		framerate: fps,
		forceCut: b.forceCut === true,
		useServerLive: true,
		incomingScene,
		...(target === 'preview' ? { target: 'preview' } : {}),
	}
	const take = deps.take || require('./routes-scene-take').handleSceneTake
	return take(takeBody, ctx)
}

module.exports = { handleTakeLook }
