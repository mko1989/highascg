'use strict'

const { getReplicationConfig } = require('../config/replication-config')
const { peerHttpRequest, SYNC_REQUEST_TIMEOUT_MS } = require('./peer-client')
const { pushProjectToPeer, reconcileProjectsToPeer, receiveProjectFromPeer } = require('./replicate-projects')
const { pushTimelineToPeer, receiveTimelineFromPeer } = require('./replicate-timelines')
const { applyLiveIntentOnFollower, scheduleLiveIntentApply } = require('./mirror-apply')

/**
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {{ phase?: string, percent?: number, inProgress?: boolean }} patch
 */
function patchInitialSync(runtime, patch) {
	if (!runtime.initialSync) {
		runtime.initialSync = { inProgress: false, phase: 'idle', percent: 100, startedAt: 0 }
	}
	Object.assign(runtime.initialSync, patch)
}

/**
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 */
async function reconcileTimelinesToPeer(ctx, runtime) {
	if (runtime.roleState.getRole() !== 'leader') return
	const eng = ctx.timelineEngine
	if (!eng || typeof eng.getAll !== 'function') return
	const timelines = eng.getAll()
	patchInitialSync(runtime, { inProgress: true, phase: 'timelines', percent: 0, startedAt: Date.now() })
	let done = 0
	for (const tl of timelines) {
		await pushTimelineToPeer(ctx, runtime, tl.id, tl)
		done += 1
		runtime.timelinesPushed = (runtime.timelinesPushed || 0) + 1
		patchInitialSync(runtime, {
			percent: timelines.length ? Math.round((done / timelines.length) * 100) : 100,
		})
	}
	patchInitialSync(runtime, { inProgress: false, phase: 'caught_up', percent: 100 })
}

/**
 * Leader pushes full show-data snapshot to follower.
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 */
async function reconcileAllToPeer(ctx, runtime) {
	if (runtime.roleState.getRole() !== 'leader') return
	patchInitialSync(runtime, { inProgress: true, phase: 'projects', percent: 0, startedAt: Date.now() })
	await reconcileProjectsToPeer(ctx, runtime)
	patchInitialSync(runtime, { phase: 'timelines', percent: 50 })
	await reconcileTimelinesToPeer(ctx, runtime)
}

/**
 * Follower pulls project + timelines from current leader.
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 */
async function reconcileFromLeader(ctx, runtime) {
	if (runtime.roleState.getRole() !== 'follower') return { ok: false, skipped: true }
	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled || !repl.peer.host || !repl.peer.token) return { ok: false, skipped: true }

	patchInitialSync(runtime, { inProgress: true, phase: 'pull_project', percent: 0, startedAt: Date.now() })

	const projRes = await peerHttpRequest(repl.peer, '/api/replication/export/project', {
		timeoutMs: SYNC_REQUEST_TIMEOUT_MS,
	})
	if (!projRes.ok || !projRes.json?.project) {
		patchInitialSync(runtime, { inProgress: false, phase: 'error', percent: 0 })
		return { ok: false, error: projRes.error || 'project export failed' }
	}

	await receiveProjectFromPeer(ctx, {
		pairId: repl.pairId,
		slug: projRes.json.slug,
		project: projRes.json.project,
	})

	try {
		const { installTemplatesFromStaging } = require('./sync-project-media')
		installTemplatesFromStaging()
	} catch {
		/* optional */
	}

	patchInitialSync(runtime, { phase: 'pull_timelines', percent: 40 })

	const tlRes = await peerHttpRequest(repl.peer, '/api/replication/export/timelines', {
		timeoutMs: SYNC_REQUEST_TIMEOUT_MS,
	})
	if (tlRes.ok && Array.isArray(tlRes.json?.timelines)) {
		let done = 0
		const list = tlRes.json.timelines
		for (const item of list) {
			if (!item?.timelineId || !item.timeline) continue
			await receiveTimelineFromPeer(ctx, {
				pairId: repl.pairId,
				timelineId: item.timelineId,
				timeline: item.timeline,
			})
			done += 1
			patchInitialSync(runtime, {
				percent: 40 + (list.length ? Math.round((done / list.length) * 60) : 60),
			})
		}
	}

	patchInitialSync(runtime, { inProgress: false, phase: 'caught_up', percent: 100 })
	if (typeof ctx.log === 'function') ctx.log('info', '[replication] reconciled from leader')

	await applyLiveStateFromLeader(ctx, runtime)
	return { ok: true }
}

/**
 * Pull leader playout intent and mirror on follower (HTTP fallback when WS lagging).
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 */
async function catchUpLiveStateFromLeader(ctx, runtime) {
	return applyLiveStateFromLeader(ctx, runtime, { quiet: true })
}

/**
 * Pull current leader playout intent and mirror on follower (post project sync).
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {{ quiet?: boolean }} [opts]
 */
async function applyLiveStateFromLeader(ctx, runtime, opts = {}) {
	if (runtime.roleState.getRole() !== 'follower') return { ok: false, skipped: true }
	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled || !repl.peer.host || repl.followerMode !== 'mirror') return { ok: false, skipped: true }
	const { isAmcpFanoutMirrorActive } = require('./amcp-fanout')
	if (isAmcpFanoutMirrorActive(ctx.config)) return { ok: true, skipped: true, reason: 'amcp-fanout' }

	const res = await peerHttpRequest(repl.peer, '/api/replication/export/live-state', {
		timeoutMs: SYNC_REQUEST_TIMEOUT_MS,
	})
	if (!res.ok || !res.json?.liveState) return { ok: false, error: res.error || 'live-state export failed' }

	const liveState = res.json.liveState
	runtime.lastLiveIntent = liveState
	if (liveState.seq) runtime.lastPeerLiveSeq = liveState.seq
	const result = await applyLiveIntentOnFollower(ctx, liveState, repl)
	if (result?.channelsApplied > 0 || result?.alreadyMirrored) {
		runtime.lastAppliedSeq = liveState.seq || runtime.lastAppliedSeq
	} else if (!opts.quiet && typeof ctx.log === 'function') {
		ctx.log(
			'debug',
			`[replication] live-state pull seq=${liveState.seq || '?'} — nothing new to mirror`,
		)
	}
	return { ok: true, seq: liveState.seq || null, channelsApplied: result?.channelsApplied || 0 }
}

module.exports = {
	patchInitialSync,
	reconcileTimelinesToPeer,
	reconcileAllToPeer,
	reconcileFromLeader,
	applyLiveStateFromLeader,
	catchUpLiveStateFromLeader,
}
