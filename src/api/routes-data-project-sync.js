'use strict'

const { maskProjectStreamCredentials } = require('../engine/project-stream-credentials')

/** @type {ReturnType<typeof setTimeout> | null} */
let _projectSyncBroadcastTimer = null
/** @type {{ ctx: object, project: object } | null} */
let _projectSyncBroadcastPending = null

const PROJECT_SYNC_DEBOUNCE_MS = Math.max(
	0,
	Math.min(5000, parseInt(process.env.HIGHASCG_PROJECT_SYNC_DEBOUNCE_MS || '150', 10) || 150),
)

function flushProjectSyncBroadcast() {
	if (_projectSyncBroadcastTimer) {
		clearTimeout(_projectSyncBroadcastTimer)
		_projectSyncBroadcastTimer = null
	}
	const pending = _projectSyncBroadcastPending
	_projectSyncBroadcastPending = null
	if (!pending?.ctx || typeof pending.project !== 'object') return
	const { ctx, project } = pending
	if (typeof ctx._wsBroadcast !== 'function') return
	try {
		ctx._wsBroadcast('project_sync', maskProjectStreamCredentials(project))
	} catch (e) {
		if (typeof ctx.log === 'function') {
			ctx.log('warn', '[project] WebSocket broadcast failed: ' + (e?.message || e))
		}
	}
}

function scheduleProjectSyncBroadcast(ctx, project) {
	if (typeof ctx?._wsBroadcast !== 'function') return
	if (PROJECT_SYNC_DEBOUNCE_MS <= 0) {
		try {
			ctx._wsBroadcast('project_sync', maskProjectStreamCredentials(project))
		} catch (e) {
			if (typeof ctx.log === 'function') {
				ctx.log('warn', '[project] WebSocket broadcast failed: ' + (e?.message || e))
			}
		}
		return
	}
	_projectSyncBroadcastPending = { ctx, project }
	if (_projectSyncBroadcastTimer) clearTimeout(_projectSyncBroadcastTimer)
	_projectSyncBroadcastTimer = setTimeout(flushProjectSyncBroadcast, PROJECT_SYNC_DEBOUNCE_MS)
}

module.exports = {
	flushProjectSyncBroadcast,
	scheduleProjectSyncBroadcast,
}
