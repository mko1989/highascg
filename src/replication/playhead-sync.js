'use strict'

const { getReplicationConfig } = require('../config/replication-config')
const { isAmcpFanoutMirrorActive } = require('./amcp-fanout')
const { peerHttpRequest } = require('./peer-client')
const { exportProgramPlayheads } = require('./playhead-export')

/** @type {ReturnType<typeof setInterval>|null} */
let _timer = null

function normalizeClipId(clip) {
	return String(clip || '')
		.trim()
		.replace(/^["']|["']$/g, '')
		.toUpperCase()
}

function clipBaseName(clip) {
	const n = normalizeClipId(clip)
	if (!n) return ''
	const slash = Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\'))
	return slash >= 0 ? n.slice(slash + 1) : n
}

function clipsCompatible(leaderClip, followerClip) {
	const la = clipBaseName(leaderClip)
	const lb = clipBaseName(followerClip)
	if (la && lb && la === lb) return true
	if (normalizeClipId(leaderClip) === normalizeClipId(followerClip)) return true
	return false
}

/**
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 */
function startPlayheadSync(ctx, runtime) {
	stopPlayheadSync()
	if (!isAmcpFanoutMirrorActive(ctx.config)) return
	const repl = getReplicationConfig(ctx.config)

	const intervalMs = Math.max(2000, parseInt(String(repl.playheadSync?.sampleIntervalMs ?? 5000), 10) || 5000)
	_timer = setInterval(() => {
		void tickPlayheadSync(ctx, runtime).catch((e) => {
			if (typeof ctx.log === 'function') {
				ctx.log('debug', `[replication] playhead-drift: ${e?.message || e}`)
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
		if (normalizeClipId(leaderEntry.clip) !== normalizeClipId(followerEntry.clip)) {
			if (!clipsCompatible(leaderEntry.clip, followerEntry.clip)) continue
		}
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
 * Measure leader vs follower playhead drift only — never sends AMCP corrections.
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 */
function normalizeFramerateKey(fr) {
	const s = String(fr || '').trim()
	if (!s) return ''
	const slash = s.indexOf('/')
	if (slash > 0) {
		const num = parseInt(s.slice(0, slash), 10)
		const den = parseInt(s.slice(slash + 1), 10)
		if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
			return String(Math.round((num / den) * 1000) / 1000)
		}
	}
	const n = parseFloat(s)
	return Number.isFinite(n) ? String(n) : s
}

/**
 * @param {Record<string, { framerate?: string }>} channels
 * @returns {Record<string, string>}
 */
function frameratesFromChannels(channels) {
	/** @type {Record<string, string>} */
	const out = {}
	for (const [chKey, ch] of Object.entries(channels || {})) {
		if (ch?.framerate) out[chKey] = String(ch.framerate)
	}
	return out
}

async function tickPlayheadSync(ctx, runtime) {
	const repl = getReplicationConfig(ctx.config)
	if (!isAmcpFanoutMirrorActive(ctx.config)) return
	if (runtime.roleState?.getRole() !== 'leader') return
	if (!runtime.peerReachable || !repl.peer?.host || !repl.peer?.token) return

	if (!runtime._playheadSync) {
		runtime._playheadSync = { lastDriftMs: 0, lastSampleAt: 0, fpsMismatch: [] }
	}
	const st = runtime._playheadSync

	const local = await exportProgramPlayheads(ctx)
	const remoteRes = await peerHttpRequest(repl.peer, '/api/replication/playhead-export', {
		timeoutMs: 4000,
	})
	if (!remoteRes.ok || !remoteRes.json?.channels) return

	let maxDriftMs = 0
	/** @type {Array<{ channel: string, leader: string, follower: string }>} */
	const fpsMismatch = []
	for (const [chKey, localCh] of Object.entries(local.channels)) {
		const remoteCh = remoteRes.json.channels[chKey]
		if (!remoteCh) continue
		const lf = normalizeFramerateKey(localCh.framerate)
		const rf = normalizeFramerateKey(remoteCh.framerate)
		if (lf && rf && lf !== rf) {
			fpsMismatch.push({ channel: chKey, leader: localCh.framerate, follower: remoteCh.framerate })
		}
		if (!remoteCh.layers) continue
		const w = worstLayerDrift(localCh.layers, remoteCh.layers)
		if (!w) continue
		if (Math.abs(w.driftMs) > Math.abs(maxDriftMs)) maxDriftMs = w.driftMs
	}

	st.lastDriftMs = maxDriftMs
	st.lastSampleAt = Date.now()
	st.fpsMismatch = fpsMismatch
	st.leaderFramerates = frameratesFromChannels(local.channels)
	st.followerFramerates = frameratesFromChannels(remoteRes.json.channels)
	runtime.playheadDriftMs = maxDriftMs

	const softThreshold = repl.playheadSync?.softThresholdMs ?? 150
	if (typeof ctx.log === 'function' && Math.abs(maxDriftMs) >= softThreshold) {
		ctx.log('debug', `[replication] playhead drift ${maxDriftMs}ms (measure only, no correction)`)
	}
	if (typeof ctx.log === 'function' && fpsMismatch.length) {
		ctx.log(
			'warn',
			`[replication] program channel fps mismatch leader vs follower: ${fpsMismatch.map((m) => `ch${m.channel} ${m.leader}/${m.follower}`).join(', ')}`,
		)
	}
}

function getPlayheadSyncStatus(runtime) {
	const st = runtime?._playheadSync
	return {
		driftMs: runtime?.playheadDriftMs ?? st?.lastDriftMs ?? 0,
		lastSampleAt: st?.lastSampleAt ?? 0,
		correctionsTotal: 0,
		fpsMismatch: st?.fpsMismatch ?? [],
		leaderFramerates: st?.leaderFramerates ?? {},
		followerFramerates: st?.followerFramerates ?? {},
	}
}

module.exports = {
	startPlayheadSync,
	stopPlayheadSync,
	tickPlayheadSync,
	getPlayheadSyncStatus,
	exportProgramPlayheads,
}
