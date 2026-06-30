'use strict'

const { getReplicationConfig } = require('../config/replication-config')

const PROJECT_PUSH_DEBOUNCE_MS = Math.max(
	500,
	parseInt(process.env.HIGHASCG_REPL_PROJECT_PUSH_DEBOUNCE_MS || '3000', 10) || 3000,
)

/** @type {ReturnType<typeof setTimeout> | null} */
let _timer = null
/** @type {{ ctx: object, project: object } | null} */
let _pending = null

/**
 * Flush debounced leader project push (autosave path).
 */
function flushProjectPushToPeer() {
	if (_timer) {
		clearTimeout(_timer)
		_timer = null
	}
	const item = _pending
	_pending = null
	if (!item?.ctx || !item?.project || typeof item.project !== 'object') return

	const { ctx, project } = item
	const runtime = ctx._replication
	if (!runtime || runtime.roleState?.getRole() !== 'leader') return

	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled || !repl.peer?.host) return

	const { pushProjectToPeer } = require('./replicate-projects')
	void pushProjectToPeer(ctx, runtime, project, { reason: 'autosave' }).catch((e) => {
		if (typeof ctx.log === 'function') {
			ctx.log('warn', '[replication] debounced project push: ' + (e?.message || e))
		}
	})
}

/**
 * Debounced push after leader autosave — coalesces rapid edits (WO-79).
 * @param {object} ctx
 * @param {object} project
 */
function scheduleProjectPushToPeer(ctx, project) {
	if (!ctx || !project || typeof project !== 'object') return
	const runtime = ctx._replication
	if (!runtime || runtime.roleState?.getRole() !== 'leader') return

	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled || !repl.peer?.host) return

	_pending = { ctx, project }
	if (_timer) clearTimeout(_timer)
	_timer = setTimeout(flushProjectPushToPeer, PROJECT_PUSH_DEBOUNCE_MS)
}

function cancelScheduledProjectPushToPeer() {
	if (_timer) {
		clearTimeout(_timer)
		_timer = null
	}
	_pending = null
}

module.exports = {
	PROJECT_PUSH_DEBOUNCE_MS,
	scheduleProjectPushToPeer,
	cancelScheduledProjectPushToPeer,
	flushProjectPushToPeer,
}
