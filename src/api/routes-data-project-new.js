'use strict'

/**
 * POST /api/project/new — split out of routes-data-project-handlers.js (WO-918, 500-line limit). Builds the starter
 * show (src/engine/new-project.js) and adopts it into the running system, then tells every client.
 */
const { JSON_HEADERS, jsonBody } = require('./response')
const { createNewProject } = require('../engine/new-project')
const { releaseProjectHardware } = require('../engine/project-hardware-hold')
const { maskProjectStreamCredentials } = require('../engine/project-stream-credentials')
const { scheduleProjectSyncBroadcast } = require('./routes-data-project-sync')

async function handleProjectNew(ctx) {
	try {
		const { project, slug } = await createNewProject(ctx)
		releaseProjectHardware(slug) // WO-821: New applies its starter hardware
		if (ctx.artnetReceiver?.reconfigureFromProject) {
			ctx.artnetReceiver.reconfigureFromProject(project)
		} else if (ctx.artnetReceiver) {
			ctx.artnetReceiver.reconfigure()
		}
		if (typeof ctx._wsBroadcast === 'function') {
			try {
				ctx._wsBroadcast('change', { path: 'hardwareConfig', value: { applied: true } })
				scheduleProjectSyncBroadcast(ctx, project)
				if (typeof ctx.getState === 'function') {
					const st = ctx.getState()
					if (st?.channelMap) {
						ctx._wsBroadcast('change', { path: 'channelMap', value: st.channelMap })
					}
				}
			} catch (e) {
				if (typeof ctx.log === 'function') {
					ctx.log('warn', '[project] WebSocket broadcast failed: ' + (e?.message || e))
				}
			}
		}
		if (typeof ctx.onProjectSavedForReplication === 'function') {
			try {
				ctx.onProjectSavedForReplication(project)
			} catch (e) {
				if (typeof ctx.log === 'function') ctx.log('warn', '[replication] project push: ' + (e?.message || e))
			}
		}
		try {
			const { refreshComposePreviewConsumers } = require('../preview/compose-preview-consumer')
			void refreshComposePreviewConsumers(ctx).catch((e) => {
				if (typeof ctx.log === 'function') {
					ctx.log('warn', `[compose-preview] refresh after new project: ${e?.message || e}`)
				}
			})
		} catch {
			/* optional */
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, slug, activeSlug: slug, project: maskProjectStreamCredentials(project) }),
		}
	} catch (e) {
		return {
			status: 500,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: false, error: e?.message || 'New project failed' }),
		}
	}
}

module.exports = { handleProjectNew }
