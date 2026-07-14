/**
 * Server-side “what’s live on program” for scene takes — no idle polling.
 * @see companion-module-casparcg-server/src/live-scene-state.js
 */

'use strict'

const persistence = require('../utils/persistence')
const { getChannelMap } = require('../config/routing')
const { buildChannelMap } = require('../config/channel-map-from-ctx')
const { runSerialized } = require('../utils/async-serial-queue')
const { renumberLookLayersConsecutive } = require('../engine/look-layer-ranges')

const KEY = 'liveScenesByProgramChannel'

/** Channels already logged as WO-160-migrated this process. */
const _liveMigrateLoggedChannels = new Set()

/**
 * WO-160 one-way migration on read: persisted live looks with legacy layer numbering
 * (10/20/30 decades or >99 overflow) renumber to consecutive-from-10 so takes/reconcile
 * never fight the new client numbering. If Caspar still carries content on the old
 * physical layers, reconcile clears the live JSON and the orphan sweep cleans them.
 */
function _migrateLiveScenes(all) {
	for (const ch of Object.keys(all)) {
		const scene = all[ch]?.scene
		if (!scene || !Array.isArray(scene.layers)) continue
		if (renumberLookLayersConsecutive(scene.layers) && !_liveMigrateLoggedChannels.has(ch)) {
			_liveMigrateLoggedChannels.add(ch)
			console.warn(
				`[live-scene] WO-160 migration: ch${ch} persisted live look renumbered to consecutive layer numbers from 10 (one-way, on read)`,
			)
		}
	}
	return all
}

/** @type {((ctx: object) => void)|null} */
let _onSceneLiveBroadcast = null

/** @type {((channel: number, entry: { sceneId: string, scene: object, updatedAt: number }) => void)|null} */
let _onProgramChange = null

/**
 * @param {{ onSceneLiveBroadcast?: (ctx: object) => void }} hooks
 */
function setSceneLiveBroadcastHooks(hooks) {
	_onSceneLiveBroadcast = typeof hooks?.onSceneLiveBroadcast === 'function' ? hooks.onSceneLiveBroadcast : null
}

/**
 * @param {(channel: number, entry: { sceneId: string, scene: object, updatedAt: number }) => void|null} fn
 */
function onProgramChange(fn) {
	_onProgramChange = typeof fn === 'function' ? fn : null
}

function _all() {
	const raw = persistence.get(KEY)
	return raw && typeof raw === 'object' ? _migrateLiveScenes(raw) : {}
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
 * @param {{ sceneId: string, scene: object, updatedAt?: number }} entry
 * @returns {Promise<void>}
 */
function setChannel(channel, entry) {
	return runSerialized(() => {
		const n = parseInt(channel, 10)
		if (!Number.isFinite(n) || n < 1) return
		const ch = String(n)
		const all = { ..._all() }
		all[ch] = {
			sceneId: entry.sceneId,
			scene: entry.scene,
			updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now(),
		}
		persistence.set(KEY, all)
		if (_onProgramChange) {
			try {
				_onProgramChange(n, all[ch])
			} catch {
				/* ignore */
			}
		}
	})
}

/**
 * @returns {Record<string, { sceneId: string, scene: object, updatedAt: number }>}
 */
function getAll() {
	return { ..._all() }
}

/**
 * @param {number|string} channel
 * @returns {Promise<void>}
 */
function clearChannel(channel) {
	return runSerialized(() => {
		const n = parseInt(channel, 10)
		if (!Number.isFinite(n) || n < 1) return
		const ch = String(n)
		const all = { ..._all() }
		delete all[ch]
		persistence.set(KEY, all)
	})
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
	void clearChannel(n)
	return true
}

/**
 * @param {{ _wsBroadcast?: (type: string, payload: object) => void, programLayerBankByChannel?: object }} ctx
 * @param {{ skipChannelMap?: boolean }} [opts]
 */
function broadcastSceneLive(ctx, opts = {}) {
	if (!ctx?._wsBroadcast) return
	ctx._wsBroadcast('change', { path: 'scene.live', value: getAll() })
	ctx._wsBroadcast('change', {
		path: 'scene.programLayerBankByChannel',
		value: ctx.programLayerBankByChannel || {},
	})
	if (opts.skipChannelMap !== true) {
		ctx._wsBroadcast('change', {
			path: 'channelMap',
			value: buildChannelMap(ctx),
		})
	}
	try {
		if (_onSceneLiveBroadcast) _onSceneLiveBroadcast(ctx)
		else require('../companion-bridge/look-air-frames').onSceneLiveBroadcast(ctx)
	} catch {
		/* companion bridge optional */
	}
}

/**
 * @param {{ config?: object, _wsBroadcast?: Function, programLayerBankByChannel?: object }} ctx
 * @param {number|string} channel
 * @returns {boolean}
 */
function notifyProgramMutationMayInvalidateLive(ctx, channel, opts = {}) {
	try {
		require('../preview/compose-preview-activity').onProgramMutation(ctx, channel, opts)
	} catch {
		/* WO-57 optional */
	}
	try {
		require('../media/live-thumbnail-cache').scheduleLiveThumbnailRefresh(ctx, channel)
	} catch {
		/* optional */
	}
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
	onProgramChange,
	setSceneLiveBroadcastHooks,
	KEY,
}
