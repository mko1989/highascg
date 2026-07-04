'use strict'

const SHOW_REVISION_RECONCILE_MIN_MS = Math.max(
	10_000,
	parseInt(process.env.HIGHASCG_REPL_SHOW_REVISION_RECONCILE_MS || '60000', 10) || 60_000,
)

/**
 * Follower ping fallback (WO-79 Phase B): pull project when leader revision advances.
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {object|null|undefined} peerPing
 */
function maybeReconcileShowRevisionFromPing(ctx, runtime, peerPing) {
	if (!runtime || runtime.roleState?.getRole() !== 'follower') return
	const peerRevision = peerPing?.activeShowRevision
	if (!peerRevision || typeof peerRevision !== 'string') return
	if (peerRevision === runtime.lastAppliedShowRevision) return
	if (runtime._showRevisionReconcileInFlight) return

	const now = Date.now()
	const lastAt = runtime.lastShowRevisionReconcileAt || 0
	if (now - lastAt < SHOW_REVISION_RECONCILE_MIN_MS) return

	runtime._showRevisionReconcileInFlight = true
	runtime.lastShowRevisionReconcileAt = now

	const { reconcileFromLeader } = require('./replication-reconcile')
	void reconcileFromLeader(ctx, runtime)
		.then((out) => {
			if (out?.ok && typeof ctx.log === 'function') {
				ctx.log(
					'info',
					`[replication] show revision fallback pull (${peerRevision} ≠ ${runtime.lastAppliedShowRevision || 'none'})`,
				)
			}
		})
		.catch((e) => {
			if (typeof ctx.log === 'function') {
				ctx.log('warn', '[replication] show revision fallback: ' + (e?.message || e))
			}
		})
		.finally(() => {
			runtime._showRevisionReconcileInFlight = false
		})
}

/**
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {object} project
 */
function noteFollowerAppliedShowRevision(runtime, project) {
	if (!runtime || !project) return
	const { computeActiveShowRevision } = require('./active-show-revision')
	const { revision, savedAt } = computeActiveShowRevision(project)
	if (revision) runtime.lastAppliedShowRevision = revision
	if (savedAt) runtime.lastShowReceivedAt = savedAt
	runtime.lastShowReceivedAtMs = Date.now()
}

module.exports = {
	SHOW_REVISION_RECONCILE_MIN_MS,
	maybeReconcileShowRevisionFromPing,
	noteFollowerAppliedShowRevision,
}
