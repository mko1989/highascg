/**
 * WO-572 Part C — server-side "what audio-only look is live/preview on channel X", parallel to
 * live-scene-state.js. Deliberately a separate map/broadcast path (scene.liveAudioOnly, not
 * scene.live): a channel can have one live VIDEO look and one live AUDIO-ONLY look at the same
 * time (that's the whole point — audio-only looks are additive, they never touch the video look),
 * and live-scene-state.js's `all[ch] = {...}` is a single-slot-per-channel overwrite that would
 * otherwise clobber whichever kind took second.
 */

'use strict'

const persistence = require('../utils/persistence')
const { runSerialized } = require('../utils/async-serial-queue')

const KEY = 'liveAudioOnlyLooksByChannel'

function _all() {
	const raw = persistence.get(KEY)
	return raw && typeof raw === 'object' ? raw : {}
}

/**
 * @param {number|string} channel
 * @returns {{ sceneId: string, scene: object, updatedAt: number } | null}
 */
function getChannel(channel) {
	const n = parseInt(channel, 10)
	if (!Number.isFinite(n) || n < 1) return null
	return _all()[String(n)] || null
}

/**
 * @param {number|string} channel
 * @param {{ sceneId: string, scene: object, updatedAt?: number }} entry
 * @returns {Promise<void>}
 */
function setChannel(channel, entry) {
	return runSerialized(() => {
		const n = parseInt(channel, 10)
		if (!Number.isFinite(n) || n < 1) return
		const all = { ..._all() }
		all[String(n)] = {
			sceneId: entry.sceneId,
			scene: entry.scene,
			updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now(),
		}
		persistence.set(KEY, all)
	})
}

/**
 * @param {number|string} channel
 * @returns {Promise<void>}
 */
function clearChannel(channel) {
	return runSerialized(() => {
		const n = parseInt(channel, 10)
		if (!Number.isFinite(n) || n < 1) return
		const all = { ..._all() }
		delete all[String(n)]
		persistence.set(KEY, all)
	})
}

/** @returns {Record<string, { sceneId: string, scene: object, updatedAt: number }>} */
function getAll() {
	return { ..._all() }
}

/**
 * @param {{ _wsBroadcast?: (type: string, payload: object) => void }} ctx
 */
function broadcastAudioOnlyLive(ctx) {
	if (!ctx?._wsBroadcast) return
	ctx._wsBroadcast('change', { path: 'scene.liveAudioOnly', value: getAll() })
}

module.exports = {
	getChannel,
	setChannel,
	clearChannel,
	getAll,
	broadcastAudioOnlyLive,
	KEY,
}
