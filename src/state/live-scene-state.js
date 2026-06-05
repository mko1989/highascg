/**
 * Server-side “what’s live on program” for scene takes — no idle polling.
 * @see companion-module-casparcg-server/src/live-scene-state.js
 */

'use strict'

const persistence = require('../utils/persistence')
const { getChannelMap } = require('../config/routing-map')
const { buildChannelMap } = require('../config/channel-map-from-ctx')

const KEY = 'liveScenesByProgramChannel'

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
	const ch = String(n)
	const all = _all()
	return all[ch] || null
}

/**
 * @param {number|string} channel
 * @param {{ sceneId: string, scene: object }} entry
 */
function setChannel(channel, entry) {
	const n = parseInt(channel, 10)
	if (!Number.isFinite(n) || n < 1) return
	const ch = String(n)
	const all = { ..._all() }
	all[ch] = {
		sceneId: entry.sceneId,
		scene: entry.scene,
		updatedAt: Date.now(),
	}
	persistence.set(KEY, all)
}

/**
 * @returns {Record<string, { sceneId: string, scene: object, updatedAt: number }>}
 */
function getAll() {
	return { ..._all() }
}

/**
 * @param {number|string} channel
 */
function clearChannel(channel) {
	const n = parseInt(channel, 10)
	if (!Number.isFinite(n) || n < 1) return
	const ch = String(n)
	const all = { ..._all() }
	delete all[ch]
	persistence.set(KEY, all)
}

/**
 * @param {Record<string, unknown>} config
 * @param {number|string} channel
 * @returns {boolean}
 */
function invalidateIfProgramChannel(config, channel) {
	const n = parseInt(channel, 10)
	if (!Number.isFinite(n) || n < 1) return false
	const map = getChannelMap(config || {})
	const programs = []
	for (let i = 0; i < map.screenCount; i++) programs.push(map.programCh(i + 1))
	if (!programs.includes(n)) return false
	if (!getChannel(n)) return false
	clearChannel(n)
	return true
}

/**
 * @param {{ _wsBroadcast?: (type: string, payload: object) => void, programLayerBankByChannel?: object }} ctx
 */
function broadcastSceneLive(ctx) {
	if (!ctx?._wsBroadcast) return
	ctx._wsBroadcast('change', { path: 'scene.live', value: getAll() })
	ctx._wsBroadcast('change', {
		path: 'scene.programLayerBankByChannel',
		value: ctx.programLayerBankByChannel || {},
	})
	ctx._wsBroadcast('change', {
		path: 'channelMap',
		value: buildChannelMap(ctx),
	})
}

/**
 * @param {{ config?: object, _wsBroadcast?: Function, programLayerBankByChannel?: object }} ctx
 * @param {number|string} channel
 * @returns {boolean}
 */
function notifyProgramMutationMayInvalidateLive(ctx, channel) {
	if (!invalidateIfProgramChannel(ctx?.config, channel)) return false
	broadcastSceneLive(ctx)
	return true
}

module.exports = {
	getChannel,
	setChannel,
	getAll,
	clearChannel,
	invalidateIfProgramChannel,
	broadcastSceneLive,
	notifyProgramMutationMayInvalidateLive,
	KEY,
}
