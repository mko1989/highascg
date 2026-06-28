'use strict'

const fs = require('fs')
const path = require('path')
const { stripDeviceLocalFromProject, mergeSharedProjectIntoLocal } = require('../config/config-classify')
const projectStore = require('../engine/project-store')
const { persistProject } = require('../engine/project-scenes')
const { scheduleProjectSyncBroadcast } = require('../api/routes-data')
const { getReplicationConfig } = require('../config/replication-config')
const { peerPost, SYNC_REQUEST_TIMEOUT_MS } = require('./peer-client')
const { applyHardwareConfigToCtx } = require('../engine/project-hardware-config')
const {
	seedProjectHardwareFromLocalProfile,
	applyLocalMachineProfileToConfig,
	regenerateFollowerCasparFromDeviceView,
} = require('./follower-machine-profile')

/**
 * Activate a replicated project on this server (disk + in-memory deck + UI broadcast).
 * @param {object} ctx
 * @param {object} merged
 * @param {string} slug
 */
async function commitReplicatedProject(ctx, merged, slug) {
	const persistence = ctx.persistence || require('../utils/persistence')
	const activeSlug = String(slug || projectStore.projectSlugFromName(merged?.name) || '').trim()
	if (!activeSlug) return merged
	const previousSlug = projectStore.getActiveSlug(persistence)
	const slugChanged = String(previousSlug || '') !== activeSlug

	projectStore.setActiveSlug(persistence, activeSlug)
	persistProject(ctx, merged, { writeAutosave: true, pushVolumes: false })

	applyLocalMachineProfileToConfig(ctx, merged?.hardwareConfig)
	if (merged?.hardwareConfig?.screenDestinations) {
		applyHardwareConfigToCtx(ctx, { screenDestinations: merged.hardwareConfig.screenDestinations })
	}

	let caspar = null
	// Only regenerate/restart Caspar when the active show slug changes — not on every leader save.
	if (slugChanged) {
		try {
			caspar = await regenerateFollowerCasparFromDeviceView(ctx)
		} catch (e) {
			if (typeof ctx.log === 'function') {
				ctx.log('warn', '[replication] follower caspar regenerate: ' + (e?.message || e))
			}
		}
	}

	if (typeof ctx.log === 'function') {
		let casparNote = 'caspar unchanged (use Regenerate Caspar from Device View after wiring outputs)'
		if (slugChanged) {
			casparNote = caspar?.ok
				? 'casparcg.config regenerated from local Device View'
				: 'caspar regenerate skipped or failed — use Regenerate Caspar from Device View'
		}
		ctx.log('info', `[replication] Show synced (active slug=${activeSlug}). ${casparNote}.`)
	}
	scheduleProjectSyncBroadcast(ctx, merged)
	return merged
}

/**
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {object} project
 */
async function pushProjectToPeer(ctx, runtime, project) {
	if (runtime.roleState.getRole() !== 'leader') return { ok: false, skipped: true }
	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled || !repl.peer.host) return { ok: false, skipped: true }

	const slug = projectStore.getActiveSlug(ctx.persistence || require('../utils/persistence'))
	const payload = {
		pairId: repl.pairId,
		slug,
		project: stripDeviceLocalFromProject(project),
	}

	const res = await peerPost(repl.peer, '/api/replication/project', payload, {
		timeoutMs: SYNC_REQUEST_TIMEOUT_MS,
	})
	if (res.ok) {
		runtime.projectsPushed += 1
		try {
			const { syncProjectMediaViaSyncthing } = require('./sync-project-media')
			const { getLocalSyncthingDeviceId } = require('./syncthing-client')
			const peerPing = await require('./peer-client').peerPing(repl.peer)
			const followerSyncthingId = peerPing.json?.syncthingDeviceId
			if (followerSyncthingId) {
				await syncProjectMediaViaSyncthing(project, followerSyncthingId, { asLeader: true })
			}
		} catch {
			/* optional syncthing refresh */
		}
	}
	return { ok: res.ok, status: res.status, error: res.error }
}

/**
 * @param {object} ctx
 * @param {object} body — { pairId, slug, project }
 */
async function receiveProjectFromPeer(ctx, body) {
	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled) return { ok: false, error: 'replication disabled' }
	if (body.pairId !== repl.pairId) return { ok: false, error: 'pairId mismatch' }

	const slug = String(body.slug || projectStore.getActiveSlug(ctx.persistence || require('../utils/persistence')) || 'default').trim()
	const project = body.project
	if (!project || typeof project !== 'object') return { ok: false, error: 'missing project' }

	// Defense in depth: never apply machine profile from peer (device graph, GPU ports, caspar host).
	const safeProject = stripDeviceLocalFromProject(project)

	const filePath = projectStore.projectFilePath(slug)
	fs.mkdirSync(path.dirname(filePath), { recursive: true })

	let existing = null
	try {
		if (fs.existsSync(filePath)) {
			existing = JSON.parse(fs.readFileSync(filePath, 'utf8'))
		}
	} catch {
		existing = null
	}

	existing = seedProjectHardwareFromLocalProfile(ctx, existing)

	const merged = mergeSharedProjectIntoLocal(existing, safeProject)
	await commitReplicatedProject(ctx, merged, slug)

	if (typeof ctx.log === 'function') {
		ctx.log('info', `[replication] received project slug=${slug} (active)`)
	}
	return { ok: true, slug, activeSlug: slug }
}

/**
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 */
async function reconcileProjectsToPeer(ctx, runtime) {
	if (runtime.roleState.getRole() !== 'leader') return
	try {
		const { loadFullProject } = require('../engine/project-scenes')
		const project = await loadFullProject()
		await pushProjectToPeer(ctx, runtime, project)
	} catch (e) {
		if (typeof ctx.log === 'function') {
			ctx.log('warn', '[replication] reconcile projects: ' + (e?.message || e))
		}
	}
}

module.exports = { pushProjectToPeer, receiveProjectFromPeer, reconcileProjectsToPeer, commitReplicatedProject }
