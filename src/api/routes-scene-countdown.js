'use strict'

/**
 * WO-601 countdown inspector (Godot thin client) — POST /api/scene/countdown
 * { sceneId, layerNumber, action: 'set'|'start'|'pause'|'reset', config?, mainIdx? } → the existing
 * /api/countdown/<action> handler with the web inspector's routing (inspector-countdown-controller.js getRouting):
 * the look's edit bus, logical layer = look layer, templateHostLayer 0 (the CG sub-layer the scene take ADDs).
 * `set` carries the config (web flushCgUpdate: { ...routing, ...config }); the transport actions only the routing.
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { editBusChannel } = require('./routes-scene-lower-third')

const ACTIONS = new Set(['set', 'start', 'pause', 'reset'])

function out(status, payload) {
	return { status, headers: JSON_HEADERS, body: jsonBody(payload) }
}

async function handleSceneCountdown(body, ctx, deps = {}) {
	const b = parseBody(body)
	const sceneId = String(b.sceneId || '').trim()
	const ln = Number(b.layerNumber)
	const action = String(b.action || '')
	if (!sceneId || !Number.isFinite(ln)) return out(400, { ok: false, error: 'sceneId and layerNumber required' })
	if (!ACTIONS.has(action)) return out(400, { ok: false, error: `unknown action ${action}` })
	const scene = deps.resolveScene ? deps.resolveScene(sceneId) : require('../engine/project-scenes-transform').resolveLiveSceneById(ctx, sceneId)
	if (!scene) return out(404, { ok: false, error: `look ${sceneId} not found` })
	const getMap = deps.getChannelMap || require('../config/routing').getChannelMap
	const map = getMap(ctx?.config || {}, ctx?.switcherOutputBusByChannel) || {}
	const scope = parseInt(String(scene.mainScope ?? ''), 10)
	const mainIdx = Number.isFinite(Number(b.mainIdx)) ? Math.max(0, Math.floor(Number(b.mainIdx))) : Number.isFinite(scope) ? scope : 0
	const channel = editBusChannel(map, mainIdx)
	if (!channel) return out(200, { ok: false, reason: 'no_channel', mainIdx })
	const routing = { channel, layer: ln, templateHostLayer: 0 }
	const cfg = action === 'set' && b.config && typeof b.config === 'object' ? b.config : {}
	const post = deps.post || ((p, pb) => require('./routes-countdown').handlePost(p, pb, ctx))
	const res = await post(`/api/countdown/${action}`, { ...routing, ...cfg })
	let parsed = {}
	try {
		parsed = typeof res?.body === 'string' ? JSON.parse(res.body) : res?.body || {}
	} catch {}
	return out(res?.status || 500, { ...parsed, ok: (res?.status || 500) < 400 && parsed.ok !== false, action, channel })
}

module.exports = { handleSceneCountdown }
