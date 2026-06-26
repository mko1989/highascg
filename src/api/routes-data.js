/**
 * POST /api/project/save|load, GET /api/project, /api/data/store|retrieve|list|remove
 * Project JSON is stored locally on disk (.highascg-state.json).
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const persistence = require('../utils/persistence')
const {
	loadFullProject,
	validateIncomingProject,
	persistProject,
} = require('../engine/project-scenes')
const projectStore = require('../engine/project-store')
const {
	injectHardwareConfigToProject,
	applyHardwareConfigFromProject,
} = require('../engine/project-hardware-config')

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
		ctx._wsBroadcast('project_sync', project)
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
			ctx._wsBroadcast('project_sync', project)
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

/** Full project object — same shape as POST /api/project/save body `project`. */
const PROJECT_DISK_KEY = 'web_project'

async function loadProjectMerged(_ctx) {
	return loadFullProject()
}

async function handleProject(path, body, ctx) {
	const b = parseBody(body)
	if (path === '/api/project/save') {
		const project = b.project
		if (!project || typeof project !== 'object') {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Missing project' }) }
		}
		injectHardwareConfigToProject(ctx, project)
		projectStore.migrateLegacySingleProject(persistence)
		const slug = projectStore.projectSlugFromName(project.name)
		const prevSlug = projectStore.getActiveSlug(persistence)
		const existing = projectStore.readProjectFile(slug)
		const allowReplace = b.force === true || b.allowReplace === true
		const check = validateIncomingProject(project, existing, { allowReplace })
		if (!check.ok) {
			if (typeof ctx.log === 'function') {
				ctx.log(
					'warn',
					`[project] save rejected (${check.reason}) incoming=${check.details?.incomingSavedAt || project.savedAt || '?'} stored=${check.details?.storedSavedAt || existing?.savedAt || '?'}`,
				)
			}
			return {
				status: 409,
				headers: JSON_HEADERS,
				body: jsonBody({
					error:
						check.reason === 'unrelated_scene_set'
							? 'Project save rejected: looks do not match the stored project (stale client tab?)'
							: 'Project save rejected: payload is older than the stored project',
					reason: check.reason,
					...(check.details || {}),
				}),
			}
		}
		persistProject(ctx, project, { writeAutosave: true })
		if (ctx.artnetReceiver?.reconfigureFromProject) {
			ctx.artnetReceiver.reconfigureFromProject(project)
		} else if (ctx.artnetReceiver) {
			ctx.artnetReceiver.reconfigure()
		}
		if (b.broadcastProject !== false && typeof ctx._wsBroadcast === 'function') {
			scheduleProjectSyncBroadcast(ctx, project)
		}
		if (typeof ctx.onProjectSavedForReplication === 'function') {
			try {
				ctx.onProjectSavedForReplication(project)
			} catch (e) {
				if (typeof ctx.log === 'function') ctx.log('warn', '[replication] project push: ' + (e?.message || e))
			}
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				slug,
				activeSlug: slug,
				created: !existing,
			}),
		}
	}
	if (path === '/api/project/load') {
		const reqSlug = b.slug != null ? String(b.slug).trim() : ''
		projectStore.migrateLegacySingleProject(persistence)
		const slug = reqSlug || projectStore.getActiveSlug(persistence)
		let project = slug ? projectStore.readProjectFile(slug) : null
		if (!project && !reqSlug) project = await loadProjectMerged(ctx)
		if (!project) {
			return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'No project stored' }) }
		}
		const activeSlug =
			reqSlug ||
			(project.slug && String(project.slug).trim()) ||
			projectStore.projectSlugFromName(project.name)
		projectStore.setActiveSlug(persistence, activeSlug)
		
		applyHardwareConfigFromProject(ctx, project)
		try {
			const { ensureLiveAudioRouting } = require('../config/routing-setup')
			void ensureLiveAudioRouting(ctx).catch((e) => {
				if (typeof ctx.log === 'function') {
					ctx.log('warn', `[project] Live audio routing: ${e?.message || e}`)
				}
			})
		} catch {
			/* optional */
		}

		return { status: 200, headers: JSON_HEADERS, body: jsonBody(project) }
	}
	if (path === '/api/project/autosave') {
		const project = b.project
		if (!project || typeof project !== 'object') {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Missing project' }) }
		}
		injectHardwareConfigToProject(ctx, project)
		projectStore.migrateLegacySingleProject(persistence)
		const slug = projectStore.projectSlugFromName(project.name)
		const prevSlug = projectStore.getActiveSlug(persistence)
		const existing = projectStore.readProjectFile(slug)
		const check = validateIncomingProject(project, existing)
		if (!check.ok) {
			if (typeof ctx.log === 'function') {
				const lvl = check.reason === 'stale_saved_at' ? 'debug' : 'warn'
				const detail =
					check.reason === 'stale_saved_at'
						? `incoming=${check.details?.incomingSavedAt || project.savedAt || '?'} stored=${check.details?.storedSavedAt || existing?.savedAt || '?'}`
						: `looks ${check.details?.incomingLookCount ?? '?'} vs stored ${check.details?.storedLookCount ?? '?'}`
				ctx.log(lvl, `[project] autosave skipped (${check.reason}) ${detail}`)
			}
			return {
				status: 409,
				headers: JSON_HEADERS,
				body: jsonBody({
					error:
						check.reason === 'empty_over_nonempty'
							? 'Autosave rejected: empty project would erase stored looks (reload the page)'
							: check.reason === 'unrelated_scene_set'
								? 'Autosave rejected: browser project does not match stored looks (close stale tabs or reload)'
								: 'Autosave rejected: payload is older than the stored project',
					reason: check.reason,
					...(check.details || {}),
				}),
			}
		}
		try {
			persistProject(ctx, project, { writeAutosave: true })
			if (ctx.artnetReceiver?.reconfigureFromProject) {
				ctx.artnetReceiver.reconfigureFromProject(project)
			} else if (ctx.artnetReceiver) {
				ctx.artnetReceiver.reconfigure()
			}
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
		} catch (e) {
			return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: e.message }) }
		}
	}
	return null
}

async function handleProjectList(ctx) {
	projectStore.migrateLegacySingleProject(persistence)
	const projects = projectStore.listProjectFiles()
	const activeSlug = projectStore.getActiveSlug(persistence)
	const { getProjectRoots, isVolumeMountedSync } = require('../engine/project-volume-sync')
	const roots = getProjectRoots()
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			activeSlug: activeSlug || null,
			projects,
			volumes: {
				usb: {
					mount: roots.usb,
					mounted: !!(roots.usb && isVolumeMountedSync(roots.usb)),
				},
				bridge: {
					mount: roots.bridge,
					mounted: !!(roots.bridge && isVolumeMountedSync(roots.bridge)),
				},
			},
		}),
	}
}

async function handleProjectGet(ctx) {
	const project = await loadProjectMerged(ctx)
	if (!project) {
		// Startup-safe default: frontend probes /api/project before any save exists.
		// Returning 200 avoids boot warnings/noise and mirrors legacy behavior.
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({}) }
	}
	return { status: 200, headers: JSON_HEADERS, body: jsonBody(project) }
}

async function handleData(path, body, ctx) {
	const m = path.match(/^\/api\/data\/([^/]+)$/)
	if (!m) return null
	return { status: 410, headers: JSON_HEADERS, body: jsonBody({ error: 'AMCP DATA API removed. Use /api/project/save and local persistence.' }) }
}

async function handlePost(path, body, ctx) {
	let result = await handleData(path, body, ctx)
	return result
}

module.exports = {
	handlePost,
	handleProject,
	handleProjectGet,
	handleProjectList,
	handleData,
	loadProjectMerged,
	flushProjectSyncBroadcast,
	scheduleProjectSyncBroadcast,
}
