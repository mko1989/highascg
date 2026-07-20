'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const persistence = require('../utils/persistence')
const {
	loadProjectForSlug,
	validateIncomingProject,
	persistProject,
	enrichProjectScenesFromLiveDeck,
} = require('../engine/project-scenes')
const projectStore = require('../engine/project-store')
const {
	withProjectCredential,
	projectHasStreamKey,
	readProjectCredential,
	maskProjectStreamCredentials,
} = require('../engine/project-stream-credentials')
const {
	injectHardwareConfigToProject,
	applyHardwareConfigToCtx,
	hardwareConfigHasOperatorData,
} = require('../engine/project-hardware-config')
const { ensureProjectMediaDir } = require('../media/project-media-root')
const { createNewProject } = require('../engine/new-project')
const { scheduleProjectSyncBroadcast } = require('./routes-data-project-sync')
const { retireSlugWithReplication } = require('./routes-data-project-slug')
const { loadProjectMerged } = require('./routes-data-project-read')

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
			await persistProject(ctx, project, { writeAutosave: true })
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
	if (path === '/api/project/streaming-credentials') {
		// WO-261 T261.3: the ONLY write path for stream credentials — they land in the active project
		// and only there. Empty streamKey keeps the stored key (empty-keeps); clearKey blanks it.
		projectStore.migrateLegacySingleProject(persistence)
		const slug = projectStore.getActiveSlug(persistence)
		const existing = slug ? projectStore.readProjectFile(slug) : null
		if (!existing || typeof existing !== 'object') {
			return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'No active project to store credentials' }) }
		}
		const key = String(b.outputId || '').trim() || 'streamingChannel'
		const next = withProjectCredential(existing, key, {
			rtmpServerUrl: b.rtmpServerUrl,
			streamKey: b.streamKey,
			clearKey: b.clearKey === true || b.clearKey === 'true',
		})
		try {
			await persistProject(ctx, next, { writeAutosave: true, authoritativeCredentials: true })
		} catch (e) {
			if (typeof ctx.log === 'function') ctx.log('error', '[project] credentials persist failed: ' + (e?.message || e))
			return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: 'Credential save failed', detail: e?.message || String(e) }) }
		}
		if (typeof ctx.onProjectSavedForReplication === 'function') {
			try {
				ctx.onProjectSavedForReplication(next)
			} catch (e) {
				if (typeof ctx.log === 'function') ctx.log('warn', '[replication] credential push: ' + (e?.message || e))
			}
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				outputId: key,
				rtmpServerUrl: readProjectCredential(next, key).rtmpServerUrl,
				hasStreamKey: projectHasStreamKey(next, key),
			}),
		}
	}
	if (path === '/api/project/load') {
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
		// WO-277: adopt the project into the RUNNING system (deck mirror, live-scene prune, artnet,
		// broadcasts, PRV re-stage + thumb warm). Without this the load only moved the slug pointer
		// and everything downstream kept serving the previous project until a service restart.
		const { activateLoadedProject } = require('../engine/project-activate')
		const activation = await activateLoadedProject(ctx, project, {
			applyHardware: b.applyHardware === true,
			broadcastProject: b.broadcastProject === true,
		})

		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				...maskProjectStreamCredentials(project),
				...(recoveredFromAutosave ? { _recoveredFromAutosave: true } : {}),
				_activation: {
					slug: activation.slug,
					lookCount: activation.lookCount,
					clearedLiveChannels: activation.clearedLiveChannels,
					restartRequired: activation.restartRequired,
					restartReason: activation.restartReason,
				},
			}),
		}
	}
	if (path === '/api/project/new') {
		try {
			const { project, slug } = await createNewProject(ctx)
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
				await persistProject(ctx, renamed, { writeAutosave: true })
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
			await persistProject(ctx, renamed, { writeAutosave: true })
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
			const result = await persistProject(ctx, project, { writeAutosave: true })
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

module.exports = {
	handleProject,
}
