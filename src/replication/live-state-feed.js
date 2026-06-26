'use strict'

const liveSceneState = require('../state/live-scene-state')

/**
 * @param {object} ctx
 * @returns {object}
 */
function buildLivePlayoutIntent(ctx) {
	const channels = liveSceneState.getAll()
	/** @type {Record<string, { sceneId: string, updatedAt: number }>} */
	const channelIntent = {}
	for (const [ch, entry] of Object.entries(channels)) {
		if (!entry?.sceneId) continue
		channelIntent[ch] = { sceneId: entry.sceneId, updatedAt: entry.updatedAt || 0 }
	}

	let timeline = null
	if (ctx.timelineEngine && typeof ctx.timelineEngine.getPlaybackState === 'function') {
		try {
			timeline = ctx.timelineEngine.getPlaybackState()
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
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {object} ctx
 */
function snapshotLiveState(runtime, ctx) {
	runtime.liveStateSeq += 1
	const intent = buildLivePlayoutIntent(ctx)
	runtime.lastLiveIntent = {
		seq: runtime.liveStateSeq,
		at: Date.now(),
		intent,
	}
	return runtime.lastLiveIntent
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
		broadcastLiveState(runtime, runtime.peerWsClients)
	}
}

module.exports = {
	buildLivePlayoutIntent,
	snapshotLiveState,
	broadcastLiveState,
	markLiveStateDirty,
}
