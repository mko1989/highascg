'use strict'

/**
 * WO-604 — audio mixer console state + mute, composed on the server.
 *
 *   GET  /api/audio/mixer  → { ok, gains, muted, solos }   (src/audio/mixer-state.js)
 *   POST /api/audio/mute   { channel, layer? | master: true, muted, key?, volume? }
 *        muted → volume 0; unmuted → `volume`, else the stored gain for `key`, else unity.
 *        With a strip `key` the server keeps the mute (strips no look owns); a look layer's mute
 *        stays on the look and the client sends no key.
 *
 * WO-604 slice 3 — live-input audio routing (src/audio/input-audio-routing.js), DeckLink / v4l2:
 *   GET  /api/audio/inputs/routing → { ok, autoMix, programChannels, inputs[] }  (WS change `audioInputRouting`)
 *   POST /api/audio/inputs/route   { kind, slot, channel, on }   — the Ch button
 *   POST /api/audio/inputs/send    { kind, slot, send }          — afv | always | never
 *   POST /api/audio/auto-mix       { on }
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const mixerState = require('../audio/mixer-state')
const { applyVolume } = require('./routes-audio')
const inputRouting = require('../audio/input-audio-routing')

function handleGet() {
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, ...mixerState.snapshot() }) }
}

/**
 * @param {string} body
 * @param {object} ctx
 */
async function handleMutePost(body, ctx) {
	const b = parseBody(body)
	if (!b || typeof b !== 'object' || typeof b.muted !== 'boolean') {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Expected { channel, layer?, muted: boolean }' }) }
	}
	const channel = parseInt(String(b.channel ?? ''), 10)
	const layer = parseInt(String(b.layer ?? ''), 10)
	if (!Number.isFinite(channel) || channel < 1 || (b.master !== true && (!Number.isFinite(layer) || layer < 1))) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'channel (and layer unless master) must be ≥ 1' }) }
	}
	if (!ctx.amcp) return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
	const key = mixerState.isMixerKey(b.key) ? b.key : null
	const stored = key ? mixerState.snapshot().gains[key] : undefined
	const given = Number(b.volume)
	const volume = b.muted ? 0 : Number.isFinite(given) && given >= 0 ? given : (stored ?? 1)
	try {
		const input = key && b.master !== true ? inputRouting.inputForKey(ctx.config, key) : null
		const r = input
			? await inputRouting.applyInputStrip(ctx, input, { gain: Number.isFinite(given) && given >= 0 ? given : (stored ?? 1), muted: b.muted })
			: await applyVolume(ctx, { channel, layer, master: b.master === true, volume })
		if (key) mixerState.setMuted(ctx, key, b.muted)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, muted: b.muted, volume, result: r }) }
	} catch (e) {
		return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || String(e) }) }
	}
}

function handleRoutingGet(ctx) {
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, ...inputRouting.routingSnapshot(ctx?.config) }) }
}

const INPUT_ACTIONS = {
	'/api/audio/inputs/route': inputRouting.setRoute,
	'/api/audio/inputs/send': inputRouting.setSendPolicy,
	'/api/audio/auto-mix': inputRouting.setAutoMix,
}

/**
 * @param {string} path
 * @param {string} body
 * @param {object} ctx
 */
async function handleInputsPost(path, body, ctx) {
	const b = parseBody(body)
	if (!b || typeof b !== 'object') return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid JSON body' }) }
	try {
		const r = await INPUT_ACTIONS[path](ctx, b)
		if (r.ok) return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		return { status: r.status || 400, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: r.error }) }
	} catch (e) {
		return { status: 502, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: e?.message || String(e) }) }
	}
}

module.exports = { handleGet, handleMutePost, handleRoutingGet, handleInputsPost }
