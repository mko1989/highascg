'use strict'

/**
 * routes-shader-stack.js — Shader Live layer stack (owner 2026-07-27): from the editor, land the
 * PRV shader onto a chosen PGM look-band layer (10–20) with the deck transition.
 *
 *   POST /api/shader-stack { mainIndex, layerNumber, value, transition?: { type, duration } }
 *
 * LOADBG + PLAY with the transition covers both cases in one path: an occupied layer crossfades
 * old→new (exchange), an empty layer fades the shader in from transparent. The producer lands
 * PLAY-hosted (that is what makes the MIX possible); Shader Live's 403 re-host handles later live
 * edits. The live scene state is upserted + broadcast so both GUIs (and the stack panel) follow.
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const liveSceneState = require('../state/live-scene-state')
const { physicalProgramLayer } = require('../engine/scene-transition')
const { getRouteMap, stripEphemeralTakeFields, chainSceneTakeWork } = require('./routes-scene-shared')

const STACK_LAYER_MIN = 10
const STACK_LAYER_MAX = 20

/** @param {string|object} body @param {object} ctx */
async function handlePost(body, ctx) {
	const b = parseBody(body) || {}
	const mainIdx = Math.max(0, parseInt(b.mainIndex, 10) || 0)
	const layerNumber = parseInt(b.layerNumber, 10)
	const value = String(b.value || '').trim()
	if (!value || !Number.isFinite(layerNumber) || layerNumber < STACK_LAYER_MIN || layerNumber > STACK_LAYER_MAX) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: false, error: `value and layerNumber ${STACK_LAYER_MIN}-${STACK_LAYER_MAX} required` }),
		}
	}
	const routeMap = getRouteMap(ctx)
	const channel = routeMap.programChannels?.[mainIdx]
	if (!Number.isFinite(channel)) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: `no program channel for main ${mainIdx}` }) }
	}
	const bank = (ctx.programLayerBankByChannel || {})[String(channel)] === 'b' ? 'b' : 'a'
	const pLayer = physicalProgramLayer(layerNumber, bank)
	const t = b.transition || {}
	const type = String(t.type || 'MIX').toUpperCase()
	const duration = Number.isFinite(Number(t.duration)) ? Math.max(0, Number(t.duration)) : 12
	const loadOpts = {}
	if (type !== 'CUT' && duration > 0) {
		loadOpts.transition = type
		loadOpts.duration = duration
	}

	const run = async () => {
		await ctx.amcp.loadbg(channel, pLayer, value.toLowerCase(), loadOpts)
		await ctx.amcp.play(channel, pLayer)

		/* An exchanged layer may have been a running playlist — kill its channel-scoped runtime
		 * so a stale timer cannot hop the fresh shader away. */
		const entry = liveSceneState.getChannel(channel)
		const scene = entry?.scene
			? JSON.parse(JSON.stringify(entry.scene))
			: { id: `shader-stack-${mainIdx}`, name: 'Shader stack', layers: [] }
		try {
			const { playlistRuntimeKey } = require('../engine/scene-take-lbg-playlist')
			const rtKey = playlistRuntimeKey(channel, scene.id, layerNumber)
			if (ctx.playlistImageTimers?.[rtKey]) {
				clearTimeout(ctx.playlistImageTimers[rtKey])
				delete ctx.playlistImageTimers[rtKey]
			}
			if (ctx.playlistActiveIndices) delete ctx.playlistActiveIndices[rtKey]
		} catch {
			/* playlist engine absent in some test contexts */
		}
		const idx = (scene.layers || []).findIndex((l) => Number(l?.layerNumber) === layerNumber)
		const newSource = { type: 'template', value }
		if (idx >= 0) {
			scene.layers[idx] = { ...scene.layers[idx], source: newSource, sourceMode: 'single', playlist: undefined }
		} else {
			scene.layers.push({ layerNumber, source: newSource, opacity: 1, fill: { x: 0, y: 0, scaleX: 1, scaleY: 1 } })
		}
		await liveSceneState.setChannel(channel, { sceneId: scene.id, scene: stripEphemeralTakeFields(scene) })
		liveSceneState.broadcastSceneLive(ctx, { skipChannelMap: true })
		return { ok: true, channel, pLayer, layerNumber, transition: loadOpts.transition || 'CUT' }
	}

	try {
		/* Serialize with take work on this channel — a stack landing mid-take must not interleave. */
		const result = await chainSceneTakeWork(ctx, channel, run)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(result) }
	} catch (err) {
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: err?.message || String(err) }) }
	}
}

module.exports = { handlePost, STACK_LAYER_MIN, STACK_LAYER_MAX }
