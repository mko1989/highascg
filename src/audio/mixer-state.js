'use strict'

/**
 * WO-604 — audio mixer console state on the server (fader gains, mutes, solos), so every client
 * sees the same console. The web kept this in browser localStorage (`casparcg_audio_mixer_v1`,
 * client/lib/audio-mixer-state.js); the Godot client reads it from `GET /api/audio/mixer`.
 *
 * Keys are the web's strip keys: `pgm:<ch>` / `prv:<ch>` (masters), `input:<ch>` (dedicated input
 * strips), `pgm:<ch>:layer:<n>` (layer strips). Look-layer volume / mute stays on the look itself
 * (scene data) — this store only holds strips no look owns.
 */

const persistence = require('../utils/persistence')

const STATE_KEY = 'audioMixer'
const KEY_RE = /^(pgm|prv|input):\d+(:layer:\d+)?$/

/** @param {unknown} key */
function isMixerKey(key) {
	return typeof key === 'string' && KEY_RE.test(key)
}

/** @returns {{ gains: Record<string, number>, muted: Record<string, boolean>, solos: string[] }} */
function snapshot() {
	const raw = persistence.get(STATE_KEY)
	const j = raw && typeof raw === 'object' ? raw : {}
	const gains = {}
	for (const [k, v] of Object.entries(j.gains && typeof j.gains === 'object' ? j.gains : {})) {
		if (isMixerKey(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) gains[k] = v
	}
	const muted = {}
	for (const [k, v] of Object.entries(j.muted && typeof j.muted === 'object' ? j.muted : {})) {
		if (isMixerKey(k) && v === true) muted[k] = true
	}
	const solos = Array.isArray(j.solos) ? j.solos.filter(isMixerKey) : []
	return { gains, muted, solos }
}

function save(next, ctx) {
	persistence.set(STATE_KEY, next)
	if (typeof ctx?._wsBroadcast === 'function') ctx._wsBroadcast('change', { path: 'audioMixer', value: next })
	return next
}

/** @param {string} key @param {number} gain linear */
function setGain(ctx, key, gain) {
	if (!isMixerKey(key)) return snapshot()
	const s = snapshot()
	s.gains[key] = Math.max(0, Number(gain) || 0)
	return save(s, ctx)
}

/** @param {string} key @param {boolean} muted */
function setMuted(ctx, key, muted) {
	if (!isMixerKey(key)) return snapshot()
	const s = snapshot()
	if (muted) s.muted[key] = true
	else delete s.muted[key]
	return save(s, ctx)
}

/** @param {unknown[]} keys */
function setSolos(ctx, keys) {
	const s = snapshot()
	s.solos = [...new Set((Array.isArray(keys) ? keys : []).filter(isMixerKey))]
	return save(s, ctx)
}

/**
 * The web's soloKeyToTarget: layer keys solo one layer, channel keys (`prv:2`) the whole channel.
 * @param {string} key
 * @returns {{ channel: number, layer?: number }}
 */
function soloKeyToTarget(key) {
	const parts = String(key).split(':')
	const channel = parseInt(parts[1], 10)
	const layer = parts.length >= 4 ? parseInt(parts[3], 10) : NaN
	return Number.isFinite(layer) ? { channel, layer } : { channel }
}

module.exports = { STATE_KEY, isMixerKey, snapshot, setGain, setMuted, setSolos, soloKeyToTarget }
