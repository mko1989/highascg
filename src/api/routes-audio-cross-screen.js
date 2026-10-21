'use strict'

/**
 * WO-604 — cross-screen audio routing composed on the server (web WO-284 audio-cross-screen-apply.js did the
 * validation + AMCP in the browser):
 *   POST /api/audio/cross-screen/plan { sources: [{ channel, layer }] }
 *        → { screens: [{ channel, index }], sources: [{ channel, layer, destLayer, buttons: [{ channel, ok, host, reason, reasonText }] }] }
 *   POST /api/audio/cross-screen { channel, layer, target, enable, current }
 *        → { ok, targets, destLayer, commands } | { ok:false, reason, reasonText, targets }
 * The rules are the web's pure module (client/lib/audio-cross-screen-routing.js, one implementation) fed the server's
 * channel map. Enable = audio-only `route://ch-layer` PLAY on the target program channel's dest layer (300 + ch·1000 +
 * layer, never program content) through host-live-layer.js; disable = STOP + MIXER CLEAR of that layer. Nothing is
 * persisted — the client stores the returned `targets` as the look layer's `audioScreens` (like the web's patchLayer).
 */

const path = require('path')
const { pathToFileURL } = require('url')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { REPO_ROOT } = require('../repo-paths')
const { getRouteMap } = require('./routes-scene-shared')
const { handleHostLiveLayer } = require('./host-live-layer')

let _lib = null
async function lib() {
	if (!_lib) _lib = await import(pathToFileURL(path.join(REPO_ROOT, 'client', 'lib', 'audio-cross-screen-routing.js')).href)
	return _lib
}

function reply(status, payload) {
	return { status, headers: JSON_HEADERS, body: jsonBody(payload) }
}

function programChannels(map) {
	return (Array.isArray(map?.programChannels) ? map.programChannels : []).map(Number).filter((c) => Number.isInteger(c) && c >= 1)
}

/** @param {object} L  @param {object} map  @param {{ channel?: unknown, layer?: unknown }} src */
function planSource(L, map, src) {
	const channel = Number(src?.channel)
	const layer = Number(src?.layer)
	const buttons = programChannels(map).map((target) => {
		const v = L.validateCrossScreenAudioTarget({ sourceChannel: channel, sourceLayer: layer, targetChannel: target, programChannels: map.programChannels, channelMap: map })
		return { channel: target, ok: v.ok, host: v.reason === 'host-channel', reason: v.reason || '', reasonText: v.ok ? '' : L.crossScreenReasonText(v.reason) }
	})
	return { channel, layer, destLayer: L.crossScreenDestLayer(channel, layer), buttons }
}

async function handlePlan(body, ctx) {
	const L = await lib()
	const map = getRouteMap(ctx)
	const b = parseBody(body) || {}
	const sources = (Array.isArray(b.sources) ? b.sources : []).slice(0, 200)
	return reply(200, {
		screens: programChannels(map).map((channel, index) => ({ channel, index })),
		sources: sources.map((s) => planSource(L, map, s)),
	})
}

async function handleToggle(body, ctx) {
	const L = await lib()
	const map = getRouteMap(ctx)
	const b = parseBody(body) || {}
	const current = L.parseCrossScreenTargets(b.current)
	const v = L.validateCrossScreenAudioTarget({ sourceChannel: Number(b.channel), sourceLayer: Number(b.layer), targetChannel: Number(b.target), programChannels: map.programChannels, channelMap: map })
	if (!v.ok) return reply(400, { ok: false, reason: v.reason, reasonText: L.crossScreenReasonText(v.reason), targets: current })
	const enable = b.enable !== false
	const r = await handleHostLiveLayer(ctx, enable
		? { action: 'route', channel: v.targetChannel, layer: v.destLayer, route: v.route, audioOnly: b.audioOnly !== false }
		: { action: 'stop', channel: v.targetChannel, layer: v.destLayer })
	if (!r.ok) return reply(r.status || 502, { ok: false, error: r.error, targets: current })
	return reply(200, { ok: true, targets: L.nextCrossScreenTargets(current, v.targetChannel, enable), destLayer: v.destLayer, commands: r.commands, errors: r.errors })
}

function register(routes) {
	routes.post('/api/audio/cross-screen/plan', ({ body, ctx }) => handlePlan(body, ctx), { requireCaspar: false })
	routes.post('/api/audio/cross-screen', ({ body, ctx }) => handleToggle(body, ctx), { requireCaspar: true })
}

module.exports = { register, handlePlan, handleToggle }
