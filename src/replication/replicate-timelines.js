'use strict'

const fs = require('fs')
const path = require('path')
const { getReplicationConfig } = require('../config/replication-config')
const { peerPost, SYNC_REQUEST_TIMEOUT_MS } = require('./peer-client')

const REPO_ROOT = path.resolve(__dirname, '../..')
const TIMELINES_DIR = path.join(REPO_ROOT, 'timelines')

/**
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {string} timelineId
 * @param {object} timeline
 */
async function pushTimelineToPeer(ctx, runtime, timelineId, timeline) {
	if (runtime.roleState.getRole() !== 'leader') return { ok: false, skipped: true }
	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled || !repl.peer.host) return { ok: false, skipped: true }

	const res = await peerPost(
		repl.peer,
		'/api/replication/timelines',
		{
			pairId: repl.pairId,
			timelineId,
			timeline,
		},
		{ timeoutMs: SYNC_REQUEST_TIMEOUT_MS },
	)
	return { ok: res.ok, status: res.status }
}

/**
 * @param {object} ctx
 * @param {object} body
 */
async function receiveTimelineFromPeer(ctx, body) {
	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled) return { ok: false, error: 'replication disabled' }
	if (body.pairId !== repl.pairId) return { ok: false, error: 'pairId mismatch' }

	const timelineId = String(body.timelineId || '').trim()
	if (!timelineId) return { ok: false, error: 'missing timelineId' }

	if (body.deleted) {
		const filePath = path.join(TIMELINES_DIR, `${timelineId}.json`)
		try {
			if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
		} catch {
			/* ignore */
		}
		if (ctx.timelineEngine) ctx.timelineEngine.delete(timelineId)
		return { ok: true, timelineId, deleted: true }
	}

	const timeline = body.timeline
	if (!timeline) return { ok: false, error: 'missing timeline' }

	fs.mkdirSync(TIMELINES_DIR, { recursive: true })
	const filePath = path.join(TIMELINES_DIR, `${timelineId}.json`)
	fs.writeFileSync(filePath, JSON.stringify(timeline, null, 2), 'utf8')

	const eng = ctx.timelineEngine
	if (eng) {
		if (eng.get(timelineId)) eng.update(timelineId, timeline)
		else eng.create({ ...timeline, id: timelineId })
	}

	return { ok: true, timelineId }
}

module.exports = { pushTimelineToPeer, receiveTimelineFromPeer, TIMELINES_DIR }
