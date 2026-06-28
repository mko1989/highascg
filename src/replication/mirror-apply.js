'use strict'

const { getChannelMap } = require('../config/routing')
const { loadFullProject } = require('../engine/project-scenes')
const { runSceneTakeLbg } = require('../engine/scene-take-lbg')
const { localApplyTime } = require('./sync-clock')
const { findSceneInProject } = require('./project-scene-lookup')
const liveSceneState = require('../state/live-scene-state')
const { layerHasContent } = require('../engine/scene-transition')

/** @type {Map<string, number>} */
const _lastAppliedByChannel = new Map()

function exitLayersWouldBeEmpty(takeResult) {
	const diff = takeResult?.diff
	if (!diff || typeof diff !== 'object') return true
	if (typeof diff.exit === 'number') return diff.exit <= 0
	return !Array.isArray(diff.exit) || diff.exit.length <= 0
}
/** @type {string|null} */
let _lastTimelineKey = null

function resetMirrorApplyDedup() {
	_lastAppliedByChannel.clear()
	_lastTimelineKey = null
}

function intentAlreadyMirrored(intent) {
	const channels = intent?.channels || {}
	const keys = Object.keys(channels)
	if (!keys.length) return false
	for (const [screenKey, entry] of Object.entries(channels)) {
		if (!entry?.sceneId) return false
		if (_lastAppliedByChannel.get(screenKey) !== entry.updatedAt) return false
	}
	return true
}

/**
 * @param {object} ctx
 * @param {object|null} timelinePb
 */
async function applyTimelinePlayback(ctx, timelinePb) {
	if (!timelinePb?.timelineId || !ctx.timelineEngine) return
	const eng = ctx.timelineEngine
	const id = timelinePb.timelineId
	const key = JSON.stringify({
		id,
		playing: !!timelinePb.playing,
		position: Math.floor(timelinePb.position ?? 0),
		loop: !!timelinePb.loop,
	})
	if (_lastTimelineKey === key) return
	_lastTimelineKey = key

	if (!timelinePb.playing) {
		eng.pause(id)
		return
	}

	eng.setLoop(id, !!timelinePb.loop)
	const pos = timelinePb.position != null ? Number(timelinePb.position) : 0
	if (timelinePb.sendTo && typeof timelinePb.sendTo === 'object') eng.setSendTo(timelinePb.sendTo)
	eng.play(id, Number.isFinite(pos) && pos >= 0 ? pos : 0)
}

/**
 * @param {object} ctx
 * @param {object} livePacket — { seq, intent }
 * @param {import('../config/replication-config').ReplicationConfig} repl
 */
async function applyLiveIntentOnFollower(ctx, livePacket, repl) {
	if (!livePacket?.intent) {
		if (repl.followerMode === 'armed') return { applied: false, reason: 'armed_store_only' }
		return { applied: false, reason: 'no_intent' }
	}
	const { isAmcpFanoutMirrorActive } = require('./amcp-fanout')
	if (isAmcpFanoutMirrorActive(ctx.config)) {
		return { applied: false, reason: 'amcp-fanout', alreadyMirrored: true }
	}
	if (repl.followerMode !== 'mirror' && repl.followerMode !== 'armed') {
		return { applied: false, reason: 'not_mirror' }
	}
	if (repl.followerMode === 'mirror' && !ctx.amcp) return { applied: false, reason: 'no_amcp' }

	const intent = livePacket.intent
	const channels = intent.channels || {}
	const map = getChannelMap(ctx.config || {})
	let project = null
	let channelsApplied = 0

	for (const [screenKey, entry] of Object.entries(channels)) {
		const sceneId = entry?.sceneId
		if (!sceneId) continue
		if (_lastAppliedByChannel.get(screenKey) === entry.updatedAt) continue

		if (!project) {
			try {
				project = await loadFullProject()
			} catch {
				return { applied: false, reason: 'project_load_failed' }
			}
		}
		const scene = findSceneInProject(project, sceneId)
		if (!scene || !Array.isArray(scene.layers) || !scene.layers.some(layerHasContent)) continue

		const screenIdx = parseInt(screenKey, 10)
		if (!Number.isFinite(screenIdx) || screenIdx < 1 || screenIdx > map.screenCount) continue
		const pgmCh = map.programCh(screenIdx)
		if (!Number.isFinite(pgmCh) || pgmCh < 1) continue

		if (repl.followerMode !== 'mirror') continue

		try {
			const live = liveSceneState.getChannel(pgmCh)
			const forceCut = !!entry.forceCut
			const takeResult = await runSceneTakeLbg(ctx.amcp, {
				self: ctx,
				channel: pgmCh,
				incomingScene: scene,
				currentScene: live?.scene || null,
				skipLayerVisualEquality: true,
				pgmOnly: true,
				forceCut,
			})
			const layersApplied = Number(takeResult?.layersApplied ?? takeResult?.takeJobs ?? 0)
			if (layersApplied <= 0 && exitLayersWouldBeEmpty(takeResult)) {
				if (typeof ctx.log === 'function') {
					ctx.log(
						'warn',
						`[replication] mirror apply screen=${screenKey} ch=${pgmCh} scene=${sceneId}: no Caspar layers applied (missing media or unresolved sources?)`,
					)
				}
				continue
			}
			liveSceneState.setChannel(pgmCh, { sceneId: String(sceneId), scene })
			_lastAppliedByChannel.set(screenKey, entry.updatedAt || Date.now())
			channelsApplied += 1
		} catch (e) {
			if (typeof ctx.log === 'function') {
				ctx.log('warn', `[replication] mirror apply screen=${screenKey} ch=${pgmCh} scene=${sceneId}: ${e?.message || e}`)
			}
		}
	}

	if (repl.followerMode === 'mirror' && intent.timeline) {
		await applyTimelinePlayback(ctx, intent.timeline)
	}

	if (typeof ctx.log === 'function' && channelsApplied > 0) {
		ctx.log(
			'info',
			`[replication] mirror applied seq=${livePacket.seq || '?'} screens=${channelsApplied}`,
		)
	}

	return {
		applied: channelsApplied > 0 || intentAlreadyMirrored(intent),
		alreadyMirrored: channelsApplied === 0 && intentAlreadyMirrored(intent),
		seq: livePacket.seq,
		channelsApplied,
	}
}

/**
 * Schedule apply using CT-SS-style future trigger (optional).
 * @param {object} ctx
 * @param {object} livePacket
 * @param {import('../config/replication-config').ReplicationConfig} repl
 */
function scheduleLiveIntentApply(ctx, livePacket, repl, runtime, opts = {}) {
	if (opts.immediate || repl.scheduledApply === false || repl.syncClock === 'immediate') {
		return applyLiveIntentOnFollower(ctx, livePacket, repl)
	}

	const leadMs = Math.max(0, parseInt(String(repl.scheduledApplyLeadMs ?? 250), 10) || 250)
	const useClock =
		repl.syncClock === 'ct-ss' &&
		repl.scheduledApply !== false &&
		livePacket?.applyAtLeaderTimeMs != null &&
		runtime

	if (useClock) {
		const target = localApplyTime(runtime, livePacket.applyAtLeaderTimeMs)
		let delay = Math.max(0, target - Date.now())
		const packetAge = livePacket.at ? Date.now() - livePacket.at : 0
		if (packetAge > leadMs + 500) delay = 0
		if (delay <= 0) return applyLiveIntentOnFollower(ctx, livePacket, repl)
		return new Promise((resolve) => {
			setTimeout(() => {
				void applyLiveIntentOnFollower(ctx, livePacket, repl).then(resolve)
			}, delay)
		})
	}

	return applyLiveIntentOnFollower(ctx, livePacket, repl)
}

module.exports = { applyLiveIntentOnFollower, scheduleLiveIntentApply, applyTimelinePlayback, resetMirrorApplyDedup }
