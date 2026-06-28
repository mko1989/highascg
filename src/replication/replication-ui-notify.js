'use strict'

/**
 * Nudge operator UI (header L/F badge) to poll replication status immediately.
 * @param {object} ctx
 * @param {string} [hint]
 */
function notifyReplicationStatusChanged(ctx, hint = '') {
	try {
		if (typeof ctx?._wsBroadcast === 'function') {
			ctx._wsBroadcast('replication_status', {
				hint: String(hint || '').trim() || 'changed',
				at: Date.now(),
			})
		}
	} catch {
		/* optional */
	}
}

module.exports = { notifyReplicationStatusChanged }
