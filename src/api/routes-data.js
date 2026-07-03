/**
 * POST /api/project/save|load, GET /api/project, /api/data/store|retrieve|list|remove
 * Project JSON is stored locally on disk (.highascg-state.json).
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const persistence = require('../utils/persistence')
const {
	loadFullProject,
	loadProjectForSlug,
	validateIncomingProject,
	persistProject,
	enrichProjectScenesFromLiveDeck,
} = require('../engine/project-scenes')
const projectStore = require('../engine/project-store')
const {
	injectHardwareConfigToProject,
	applyHardwareConfigFromProject,
	applyHardwareConfigToCtx,
	hardwareConfigHasOperatorData,
} = require('../engine/project-hardware-config')
const { ensureProjectMediaDir, getProjectMediaRelId, getProjectMediaRoot } = require('../media/project-media-root')
const { createNewProject } = require('../engine/new-project')

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

/**
 * Move slug to trash and notify replication peers (WO-106).
 * @param {object} ctx
 * @param {string} slug
 * @param {{ reason?: string, replacementSlug?: string | null }} [opts]
 */
function retireSlugWithReplication(ctx, slug, opts = {}) {
	const s = String(slug || '').trim()
	if (!s) return false
	const moved = projectStore.retireProjectSlug(s)
	try {
		const { notifyProjectSlugRetired } = require('../replication/project-tombstone')
		notifyProjectSlugRetired(ctx, { slug: s, reason: opts.reason || 'delete', replacementSlug: opts.replacementSlug })
	} catch {
		/* replication optional */
	}
	return moved
}

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
		try {
			persistProject(ctx, project, { writeAutosave: true })
		} catch (e) {
			if (typeof ctx.log === 'function') {
				ctx.log('error', '[project] save persist failed: ' + (e?.message || e))
			}
			return {
				status: 500,
				headers: JSON_HEADERS,
				body: jsonBody({ error: 'Project save failed', detail: e?.message || String(e) }),
			}
		}
		if (prevSlug && prevSlug !== slug) {
			try {
				retireSlugWithReplication(ctx, prevSlug, { reason: 'rename', replacementSlug: slug })
			} catch (e) {
				if (typeof ctx.log === 'function') {
					ctx.log('warn', `[project] retire previous slug ${prevSlug}: ${e?.message || e}`)
				}
			}
		}
		ensureProjectMediaDir(ctx.config, slug)
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
		// Client sends `id` (vite dev + project-files.js); docs use `slug`.
		const reqSlug =
			b.slug != null
				? String(b.slug).trim()
				: b.id != null
					? String(b.id).trim()
					: ''
		projectStore.migrateLegacySingleProject(persistence)
		const slug = reqSlug || projectStore.getActiveSlug(persistence)
		let project = null
		let recoveredFromAutosave = false
		if (reqSlug) {
			const fromFile = loadProjectForSlug(reqSlug, { mergeAutosave: false })
			const merged = loadProjectForSlug(reqSlug, { mergeAutosave: true })
			project = merged
			if (fromFile && merged && merged !== fromFile) {
				const tMain = Date.parse(fromFile.savedAt || '') || 0
				const tMerged = Date.parse(merged.savedAt || '') || 0
				recoveredFromAutosave = tMerged > tMain
			}
		} else {
			project = await loadProjectMerged(ctx)
		}
		if (!project) {
			return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'No project stored' }) }
		}
		const activeSlug =
			reqSlug ||
			(project.slug && String(project.slug).trim()) ||
			projectStore.projectSlugFromName(project.name)
		projectStore.setActiveSlug(persistence, activeSlug)
		ensureProjectMediaDir(ctx.config, activeSlug)
		if (b.applyHardware === true) {
			applyHardwareConfigFromProject(ctx, project)
		}
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

		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				...project,
				...(recoveredFromAutosave ? { _recoveredFromAutosave: true } : {}),
			}),
		}
	}
	if (path === '/api/project/new') {
		try {
			const { project, slug } = createNewProject(ctx)
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
				body: jsonBody({ ok: true, slug, activeSlug: slug, project }),
			}
		} catch (e) {
			return {
				status: 500,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: false, error: e?.message || 'New project failed' }),
			}
		}
	}
	if (path === '/api/project/apply-hardware') {
		const hc =
			b.hardwareConfig && typeof b.hardwareConfig === 'object'
				? b.hardwareConfig
				: b.project?.hardwareConfig && typeof b.project.hardwareConfig === 'object'
					? b.project.hardwareConfig
					: null
		if (!hc) {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: false, error: 'Missing hardwareConfig' }),
			}
		}
		if (!hardwareConfigHasOperatorData(hc)) {
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: true, applied: false, skipped: 'empty hardwareConfig' }),
			}
		}
		const applied = applyHardwareConfigToCtx(ctx, hc)
		if (!applied) {
			return {
				status: 500,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: false, error: 'Failed to apply hardwareConfig' }),
			}
		}
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
		if (typeof ctx._wsBroadcast === 'function') {
			try {
				ctx._wsBroadcast('change', { path: 'hardwareConfig', value: { applied: true } })
			} catch {
				/* optional */
			}
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, applied: true }),
		}
	}
	if (path === '/api/project/rename') {
		const fromSlug = String(b.fromSlug || b.slug || '').trim()
		const newName = String(b.name || b.newName || '').trim()
		if (!fromSlug || !newName) {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({ error: 'Missing fromSlug and name' }),
			}
		}
		const toSlug = projectStore.projectSlugFromName(newName)
		const existing = projectStore.readProjectFile(fromSlug)
		if (!existing) {
			return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Project not found' }) }
		}
		if (fromSlug === toSlug) {
			const renamed = { ...existing, name: newName, savedAt: new Date().toISOString() }
			try {
				persistProject(ctx, renamed, { writeAutosave: true })
			} catch (e) {
				return {
					status: 500,
					headers: JSON_HEADERS,
					body: jsonBody({ error: e?.message || 'Rename failed' }),
				}
			}
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: true, slug: toSlug, activeSlug: toSlug }),
			}
		}
		const renamed = {
			...existing,
			name: newName,
			savedAt: new Date().toISOString(),
		}
		try {
			persistProject(ctx, renamed, { writeAutosave: true })
			retireSlugWithReplication(ctx, fromSlug, { reason: 'rename', replacementSlug: toSlug })
		} catch (e) {
			return {
				status: 500,
				headers: JSON_HEADERS,
				body: jsonBody({ error: e?.message || 'Rename failed' }),
			}
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, slug: toSlug, activeSlug: toSlug, previousSlug: fromSlug }),
		}
	}
	if (path === '/api/project/autosave') {
		let project = b.project
		if (!project || typeof project !== 'object') {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Missing project' }) }
		}
		project = enrichProjectScenesFromLiveDeck(project, ctx)
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
			const result = persistProject(ctx, project, { writeAutosave: true })
			if (prevSlug && prevSlug !== slug) {
				try {
					retireSlugWithReplication(ctx, prevSlug, { reason: 'rename', replacementSlug: slug })
				} catch (e) {
					if (typeof ctx.log === 'function') {
						ctx.log('warn', `[project] retire previous slug ${prevSlug}: ${e?.message || e}`)
					}
				}
			}
			if (ctx.artnetReceiver?.reconfigureFromProject) {
				ctx.artnetReceiver.reconfigureFromProject(project)
			} else if (ctx.artnetReceiver) {
				ctx.artnetReceiver.reconfigure()
			}
			try {
				const { scheduleProjectPushToPeer } = require('../replication/project-push-debounce')
				scheduleProjectPushToPeer(ctx, project)
			} catch (e) {
				if (typeof ctx.log === 'function') {
					ctx.log('warn', '[replication] autosave schedule push: ' + (e?.message || e))
				}
			}
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: true, slug: result.slug, activeSlug: result.slug }),
			}
		} catch (e) {
			if (typeof ctx.log === 'function') {
				ctx.log('error', '[project] autosave persist failed: ' + (e?.message || e))
			}
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
	const activeProjectMedia =
		activeSlug && ctx.config
			? {
					relId: getProjectMediaRelId(activeSlug, ctx.config),
					absPath: getProjectMediaRoot(ctx.config, persistence, activeSlug),
				}
			: null
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			activeSlug: activeSlug || null,
			activeProjectMedia,
			projects: projects.map((p) => ({
				...p,
				active: p.slug === activeSlug,
				mediaFolder: p.slug ? getProjectMediaRelId(p.slug, ctx.config) : null,
			})),
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

/** GET /api/project/file/:slug and …/download — read JSON without activating slug. */
async function handleProjectFile(path) {
	const m = path.match(/^\/api\/project\/file\/([^/]+)(\/download)?$/)
	if (!m) return null
	const slug = decodeURIComponent(m[1]).trim()
	if (!slug) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Missing project slug' }) }
	}
	projectStore.migrateLegacySingleProject(persistence)
	const project = projectStore.readProjectFile(slug)
	if (!project) {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Project file not found' }) }
	}
	const body = jsonBody(project)
	if (m[2]) {
		return {
			status: 200,
			headers: {
				...JSON_HEADERS,
				'Content-Disposition': `attachment; filename="${slug}.json"`,
			},
			body,
		}
	}
	return { status: 200, headers: JSON_HEADERS, body }
}

async function handleProjectDelete(path) {
	const m = path.match(/^\/api\/project\/([^/]+)$/)
	if (!m) return null
	const slug = decodeURIComponent(m[1]).trim()
	if (!slug || slug === 'list' || slug === 'file' || slug === 'save' || slug === 'load') {
		return null
	}
	projectStore.migrateLegacySingleProject(persistence)
	const existing = projectStore.readProjectFile(slug)
	if (!existing) {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Project not found' }) }
	}
	const activeSlug = projectStore.getActiveSlug(persistence)
	if (activeSlug === slug) {
		return {
			status: 409,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'Cannot delete the active project — load another project first' }),
		}
	}
	const moved = retireSlugWithReplication(ctx, slug, { reason: 'delete' })
	if (!moved) {
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: 'Failed to move project to trash' }) }
	}
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, slug, trashed: true }) }
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
	handleProjectFile,
	handleProjectList,
	handleProjectDelete,
	handleData,
	loadProjectMerged,
	flushProjectSyncBroadcast,
	scheduleProjectSyncBroadcast,
}
