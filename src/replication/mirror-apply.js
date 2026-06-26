'use strict'

const liveSceneState = require('../state/live-scene-state')
const { loadFullProject } = require('../engine/project-scenes')
const { runSceneTakeLbg } = require('../engine/scene-take-lbg')

/** @type {Map<string, number>} */
const _lastAppliedByChannel = new Map()

/**
 * @param {object} ctx
 * @param {object} livePacket — { seq, intent }
 * @param {import('../config/replication-config').ReplicationConfig} repl
 */
async function applyLiveIntentOnFollower(ctx, livePacket, repl) {
	if (!livePacket?.intent || repl.followerMode !== 'mirror') return { applied: false, reason: 'not_mirror' }
	if (!ctx.amcp) return { applied: false, reason: 'no_amcp' }

	const intent = livePacket.intent
	const channels = intent.channels || {}
	const channelMap = getChannelMap(ctx.config)
	let project = null

	for (const [logicalCh, entry] of Object.entries(channels)) {
		const sceneId = entry?.sceneId
		if (!sceneId) continue
		if (_lastAppliedByChannel.get(logicalCh) === entry.updatedAt) continue

		if (!project) {
			try {
				project = await loadFullProject()
			} catch {
				return { applied: false, reason: 'project_load_failed' }
			}
		}
		const scenes = project?.scenes && typeof project.scenes === 'object' ? project.scenes : {}
		const scene = scenes[sceneId]
		if (!scene) continue

		const pgmCh = parseInt(logicalCh, 10)
		if (!Number.isFinite(pgmCh) || pgmCh < 1) continue

		try {
			await runSceneTakeLbg(ctx.amcp, {
				self: ctx,
				channel: pgmCh,
				sceneId,
				scene,
				skipLayerVisualEquality: true,
				pgmOnly: true,
			})
			_lastAppliedByChannel.set(logicalCh, entry.updatedAt || Date.now())
		} catch (e) {
			if (typeof ctx.log === 'function') {
				ctx.log('warn', `[replication] mirror apply ch=${logicalCh} scene=${sceneId}: ${e?.message || e}`)
			}
		}
	}

	return { applied: true, seq: livePacket.seq }
}

/**
 * Schedule apply using CT-SS-style future trigger (optional).
 * @param {object} ctx
 * @param {object} livePacket
 * @param {import('../config/replication-config').ReplicationConfig} repl
 */
function scheduleLiveIntentApply(ctx, livePacket, repl) {
	if (!repl.scheduledApply) {
		return applyLiveIntentOnFollower(ctx, livePacket, repl)
	}
	const lead = repl.scheduledApplyLeadMs || 1500
	const triggerAt = Date.now() + lead
	const delay = Math.max(0, triggerAt - Date.now())
	return new Promise((resolve) => {
		setTimeout(() => {
			void applyLiveIntentOnFollower(ctx, livePacket, repl).then(resolve)
		}, delay)
	})
}

module.exports = { applyLiveIntentOnFollower, scheduleLiveIntentApply }
