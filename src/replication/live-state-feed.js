'use strict'

const liveSceneState = require('../state/live-scene-state')
const { getChannelMap } = require('../config/routing')

/**
 * @param {object} ctx
 * @returns {object}
 */
function buildLivePlayoutIntent(ctx) {
	const map = getChannelMap(ctx.config || {})
	const all = liveSceneState.getAll()
	/** @type {Record<string, { sceneId: string, updatedAt: number, forceCut?: boolean }>} */
	const channelIntent = {}
	for (let screenIdx = 1; screenIdx <= map.screenCount; screenIdx++) {
		const pgmCh = map.programCh(screenIdx)
		const entry = all[String(pgmCh)]
		if (!entry?.sceneId) continue
		channelIntent[String(screenIdx)] = { sceneId: entry.sceneId, updatedAt: entry.updatedAt || 0 }
	}

	let timeline = null
	if (ctx.timelineEngine && typeof ctx.timelineEngine.getPlayback === 'function') {
		try {
			timeline = ctx.timelineEngine.getPlayback()
		} catch {
			timeline = null
		}
	}

	return {
		channels: channelIntent,
		timeline,
	}
}

/**
 * Fresh playout intent for follower pull — does not advance liveStateSeq.
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {object} ctx
 */
function buildLiveStateForExport(runtime, ctx) {
	const intent = buildLivePlayoutIntent(ctx)
	const now = Date.now()
	if (runtime?.lastLiveIntent?.intent) {
		return {
			seq: runtime.liveStateSeq || 0,
			at: runtime.lastLiveIntent.at,
			intent,
			leaderTimeMs: runtime.lastLiveIntent.leaderTimeMs,
			applyAtLeaderTimeMs: runtime.lastLiveIntent.applyAtLeaderTimeMs,
		}
	}
	return {
		seq: runtime?.liveStateSeq || 0,
		at: now,
		intent,
		leaderTimeMs: now,
		applyAtLeaderTimeMs: now,
	}
}

/**
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {object} ctx
 */
function snapshotLiveState(runtime, ctx) {
	runtime.liveStateSeq += 1
	const intent = buildLivePlayoutIntent(ctx)
	const now = Date.now()
	runtime.lastLiveIntent = {
		seq: runtime.liveStateSeq,
		at: now,
		intent,
		leaderTimeMs: now,
		applyAtLeaderTimeMs: now,
	}
	return runtime.lastLiveIntent
}

/**
 * Broadcast incoming PGM take at transition start so follower can mirror in sync with leader air.
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {object} ctx
 * @param {{ screenIdx: number, sceneId: string, forceCut?: boolean, takeUpdatedAt?: number }} opts
 * @returns {number} takeUpdatedAt stamped on this take
 */
function announceLeaderProgramTake(runtime, ctx, opts) {
	const screenIdx = parseInt(String(opts.screenIdx), 10)
	const sceneId = opts.sceneId ? String(opts.sceneId) : ''
	if (!Number.isFinite(screenIdx) || screenIdx < 1 || !sceneId) return opts.takeUpdatedAt || Date.now()

	const takeUpdatedAt = opts.takeUpdatedAt || Date.now()
	runtime.liveStateSeq += 1
	const intent = buildLivePlayoutIntent(ctx)
	const channelEntry = { sceneId, updatedAt: takeUpdatedAt }
	if (opts.forceCut) channelEntry.forceCut = true
	intent.channels[String(screenIdx)] = channelEntry

	const now = Date.now()
	runtime.lastLiveIntent = {
		seq: runtime.liveStateSeq,
		at: now,
		intent,
		leaderTimeMs: now,
		applyAtLeaderTimeMs: now,
	}
	if (!runtime._replAnnouncedTake) runtime._replAnnouncedTake = {}
	runtime._replAnnouncedTake[String(screenIdx)] = takeUpdatedAt

	if (runtime.roleState.getRole() === 'leader') {
		const peers = runtime.peerWsClients?.size || 0
		if (typeof ctx?.log === 'function') {
			ctx.log(
				'debug',
				`[replication] live_state take-start seq=${runtime.liveStateSeq} screen=${screenIdx} → ${peers} peer ws client(s)`,
			)
		}
		broadcastLiveState(runtime, runtime.peerWsClients)
	}
	return takeUpdatedAt
}

/**
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {Set<import('ws')>} peerSockets
 */
function broadcastLiveState(runtime, peerSockets) {
	if (!runtime.lastLiveIntent || !peerSockets?.size) return
	const payload = JSON.stringify({ type: 'live_state', data: runtime.lastLiveIntent })
	for (const ws of peerSockets) {
		if (ws.readyState === 1) {
			try {
				ws.send(payload)
			} catch {
				/* ignore */
			}
		}
	}
}

/**
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {object} ctx
 */
function markLiveStateDirty(runtime, ctx) {
	snapshotLiveState(runtime, ctx)
	if (runtime.roleState.getRole() === 'leader') {
		const peers = runtime.peerWsClients?.size || 0
		if (typeof ctx?.log === 'function') {
			ctx.log('debug', `[replication] live_state seq=${runtime.liveStateSeq} → ${peers} peer ws client(s)`)
		}
		broadcastLiveState(runtime, runtime.peerWsClients)
	}
}

module.exports = {
	buildLivePlayoutIntent,
	buildLiveStateForExport,
	snapshotLiveState,
	announceLeaderProgramTake,
	broadcastLiveState,
	markLiveStateDirty,
}
