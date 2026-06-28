'use strict'

const { getReplicationConfig } = require('../config/replication-config')
const { isAmcpFanoutMirrorActive } = require('./amcp-fanout')
const { peerHttpRequest } = require('./peer-client')
const { exportProgramPlayheads } = require('./playhead-export')

/** @type {ReturnType<typeof setInterval>|null} */
let _timer = null
/** @type {object|null} */
let _ctx = null
/** @type {import('./replication-service').ReplicationRuntime|null} */
let _runtime = null

function normalizeClipId(clip) {
	return String(clip || '')
		.trim()
		.replace(/^["']|["']$/g, '')
		.toUpperCase()
}

/**
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 */
function startPlayheadSync(ctx, runtime) {
	stopPlayheadSync()
	_ctx = ctx
	_runtime = runtime
	const repl = getReplicationConfig(ctx.config)
	if (!repl.playheadSync?.enabled) return
	if (!isAmcpFanoutMirrorActive(ctx.config)) return

	const intervalMs = Math.max(250, parseInt(String(repl.playheadSync.sampleIntervalMs ?? 500), 10) || 500)
	_timer = setInterval(() => {
		void tickPlayheadSync(ctx, runtime).catch((e) => {
			if (typeof ctx.log === 'function') {
				ctx.log('debug', `[replication] playhead-sync: ${e?.message || e}`)
			}
		})
	}, intervalMs)
	if (_timer.unref) _timer.unref()
}

function stopPlayheadSync() {
	if (_timer) {
		clearInterval(_timer)
		_timer = null
	}
	_ctx = null
	_runtime = null
}

/**
 * @param {object} leaderLayers
 * @param {object} followerLayers
 * @returns {{ layer: string, driftMs: number, leaderFrame: number, clip: string }|null}
 */
function worstLayerDrift(leaderLayers, followerLayers) {
	let worst = null
	for (const [layerKey, leaderEntry] of Object.entries(leaderLayers || {})) {
		if (leaderEntry.state !== 'playing') continue
		const followerEntry = followerLayers?.[layerKey]
		if (!followerEntry || followerEntry.state !== 'playing') continue
		if (normalizeClipId(leaderEntry.clip) !== normalizeClipId(followerEntry.clip)) continue
		const driftMs = Math.round((leaderEntry.timeSec - followerEntry.timeSec) * 1000)
		if (!worst || Math.abs(driftMs) > Math.abs(worst.driftMs)) {
			worst = {
				layer: layerKey,
				driftMs,
				leaderFrame: leaderEntry.frame,
				clip: leaderEntry.clip,
			}
		}
	}
	return worst
}

/**
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 */
async function tickPlayheadSync(ctx, runtime) {
	const repl = getReplicationConfig(ctx.config)
	if (!repl.playheadSync?.enabled || !isAmcpFanoutMirrorActive(ctx.config)) return
	if (runtime.roleState?.getRole() !== 'leader') return
	if (!runtime.peerReachable || !runtime.peerCasparConnection?.isConnected) return
	if (!repl.peer?.host || !repl.peer?.token) return

	const softMs = Math.max(50, parseInt(String(repl.playheadSync.softThresholdMs ?? 150), 10) || 150)
	const minGapMs = Math.max(1000, parseInt(String(repl.playheadSync.minCorrectionIntervalMs ?? 5000), 10) || 5000)
	const maxPerMin = Math.max(1, parseInt(String(repl.playheadSync.maxCorrectionsPerMinute ?? 6), 10) || 6)

	const now = Date.now()
	if (!runtime._playheadSync) {
		runtime._playheadSync = {
			lastDriftMs: 0,
			lastCorrectionAt: 0,
			correctionsWindowStart: now,
			correctionsInWindow: 0,
			consecutiveOverSoft: 0,
		}
	}
	const st = runtime._playheadSync

	const local = await exportProgramPlayheads(ctx)
	const remoteRes = await peerHttpRequest(repl.peer, '/api/replication/playhead-export', {
		timeoutMs: 4000,
	})
	if (!remoteRes.ok || !remoteRes.json?.channels) return

	let maxDriftMs = 0
	/** @type {{ channel: string, layer: string, driftMs: number, leaderFrame: number }|null} */
	let target = null

	for (const [chKey, localCh] of Object.entries(local.channels)) {
		const remoteCh = remoteRes.json.channels[chKey]
		if (!remoteCh?.layers) continue
		const w = worstLayerDrift(localCh.layers, remoteCh.layers)
		if (!w) continue
		if (Math.abs(w.driftMs) > Math.abs(maxDriftMs)) {
			maxDriftMs = w.driftMs
			target = { channel: chKey, layer: w.layer, driftMs: w.driftMs, leaderFrame: w.leaderFrame }
		}
	}

	st.lastDriftMs = maxDriftMs
	runtime.playheadDriftMs = maxDriftMs

	if (!target || Math.abs(target.driftMs) < softMs) {
		st.consecutiveOverSoft = 0
		return
	}

	st.consecutiveOverSoft += 1
	if (st.consecutiveOverSoft < 2) return

	if (now - st.lastCorrectionAt < minGapMs) return
	if (now - st.correctionsWindowStart > 60_000) {
		st.correctionsWindowStart = now
		st.correctionsInWindow = 0
	}
	if (st.correctionsInWindow >= maxPerMin) return

	const peer = runtime.peerCasparConnection
	if (!peer?.enqueueCorrection) return

	const cmd = `PLAY ${target.channel}-${target.layer} SEEK ${target.leaderFrame}`
	peer.enqueueCorrection(cmd)

	st.lastCorrectionAt = now
	st.correctionsInWindow += 1
	st.consecutiveOverSoft = 0
	runtime.playheadLastCorrectionAt = now
	runtime.playheadCorrectionsTotal = (runtime.playheadCorrectionsTotal || 0) + 1

	if (typeof ctx.log === 'function') {
		ctx.log(
			'debug',
			`[replication] playhead correction ch=${target.channel} layer=${target.layer} drift=${target.driftMs}ms → SEEK ${target.leaderFrame}`,
		)
	}
}

function getPlayheadSyncStatus(runtime) {
	const st = runtime?._playheadSync
	return {
		driftMs: runtime?.playheadDriftMs ?? st?.lastDriftMs ?? 0,
		lastCorrectionAt: runtime?.playheadLastCorrectionAt ?? st?.lastCorrectionAt ?? 0,
		correctionsTotal: runtime?.playheadCorrectionsTotal ?? 0,
	}
}

module.exports = {
	startPlayheadSync,
	stopPlayheadSync,
	tickPlayheadSync,
	getPlayheadSyncStatus,
	exportProgramPlayheads,
}
