'use strict'

const { peerPost } = require('./peer-client')
const { getReplicationRuntime } = require('./replication-service')

/**
 * Notify replication layer after timeline CRUD on the leader.
 * @param {object} ctx
 * @param {string} timelineId
 * @param {object|null} timeline
 * @param {{ deleted?: boolean }} [opts]
 */
function notifyTimelineReplication(ctx, timelineId, timeline, opts = {}) {
	const runtime = getReplicationRuntime(ctx)
	if (!runtime || runtime.roleState.getRole() !== 'leader') return
	const repl = ctx?.config?.replication
	if (!repl?.enabled || !repl?.peer?.host) return

	if (opts.deleted) {
		void peerPost(repl.peer, '/api/replication/timelines', {
			pairId: repl.pairId,
			timelineId,
			deleted: true,
		})
		return
	}

	if (timeline) void peerPost(repl.peer, '/api/replication/timelines', {
		pairId: repl.pairId,
		timelineId,
		timeline,
	})
}

module.exports = { notifyTimelineReplication }
