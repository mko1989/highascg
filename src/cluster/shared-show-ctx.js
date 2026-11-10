'use strict'

/**
 * WO-746 — the shared show (shared-show.js) wired to this server: the active project, the persist path a taken show
 * goes through, the backups, and the Caspar-layout check. routes-cluster.js builds it; tests drive shared-show.js with
 * an in-memory cluster instead (tools/e2e/shared-show-harness.js).
 */

const fs = require('fs')
const path = require('path')
const { fingerprint } = require('./cluster-media')
const { stableJson } = require('./cluster-call')

/** The channel layout of a casparcg.config: its video modes in order. */
const channelModes = (xml) => [...String(xml || '').matchAll(/<video-mode>([^<]*)<\/video-mode>/g)].map((m) => m[1].trim()).join(',')

/**
 * Persist a show as this server's project (persistProject: rev, deck, autosave), apply its screen destinations when
 * they changed, tell the clients. Never touches Caspar (G10).
 */
function commitShow(ctx, project) {
	const { persistProject } = require('../engine/project-scenes')
	const { normalizeScreenDestinations } = require('../config/screen-destinations')
	// WO-919 N2: taking ANOTHER show replaces the live destinations — the open show keeps its own first
	require('../engine/project-switch-stamp').stampOutgoingShowRig(ctx, require('../engine/project-store').projectSlugFromName(project?.name))
	const r = persistProject(ctx, project, { writeAutosave: true, pushVolumes: false })
	const dst = liveDestinationsFor(ctx, project?.hardwareConfig?.screenDestinations)
	if (dst && stableJson(normalizeScreenDestinations(dst)) !== stableJson(normalizeScreenDestinations(ctx.config?.screenDestinations))) {
		require('../engine/project-hardware-config').applyHardwareConfigToCtx(ctx, { screenDestinations: dst })
	}
	ctx.artnetReceiver?.reconfigureFromProject?.(r.project)
	if (!r.unchanged) require('../api/routes-data-project-sync').scheduleProjectSyncBroadcast(ctx, r.project)
	return r
}

/**
 * WO-1029 plan 06: the live destination list a taken show may set here, or null for "leave it".
 *   - S5: while the destination list is shared on its own (shared-show-dests.js), it alone sets the live list — a
 *     show (a follower's New project / Load merged on the master, report 03 F1.3) never does;
 *   - S1: the operator GUI entries of the live config stay as they are (never a peer's port / headless / shm / size);
 *   - a destination cabled here and missing from the show is kept (shared-show-dests-ctx.js guardIncoming).
 */
function liveDestinationsFor(ctx, dst) {
	if (!dst || ctx._clusterDests?.owns()) return null
	const incoming = Array.isArray(dst) ? dst : dst.destinations
	if (!Array.isArray(incoming)) return dst
	const g = require('./shared-show-dests-ctx').guardIncoming(ctx.config, incoming, [])
	for (const c of g.conflicts) ctx.log?.('warn', `[cluster] show: kept destination ${c.destId || ''} here (${c.conflict})`)
	return g.changed ? { ...(Array.isArray(dst) ? {} : dst), destinations: g.list } : null
}

/** projects/_cluster/<slug>.<tag>-<time>.json (box-local: .stignore) → the path shown to the operator. */
function backupProject(slug, project, tag) {
	const dir = path.join(require('../engine/project-store').projectsDir(), '_cluster')
	fs.mkdirSync(dir, { recursive: true })
	const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')
	const name = `${String(slug || 'show').replace(/[^\w.-]/g, '_')}.${tag}-${stamp}.json`
	fs.writeFileSync(path.join(dir, name), JSON.stringify(project, null, 1))
	return `projects/_cluster/${name}`
}

/** G10: does this server's casparcg.config still have the channel layout its (shared) destinations ask for? */
function casparLayoutDiffers(ctx) {
	try {
		const override = String(ctx.config?.casparServer?.casparConfigOverride || '').trim()
		const { buildConfigXml } = require('../config/config-generator')
		const { buildCasparGeneratorFlatConfig } = require('../config/build-caspar-generator-config')
		const want = override || buildConfigXml(buildCasparGeneratorFlatConfig(ctx.config))
		const file = require('../api/routes-caspar-config').resolveCasparConfigWritePath(ctx)
		return channelModes(want) !== channelModes(fs.readFileSync(file, 'utf8'))
	} catch {
		return false
	}
}

/** @param {{ master: () => object, cluster: () => object, call: () => object }} of — routes-cluster.js getters */
function sharedShowDeps(ctx, of) {
	const persistence = ctx.persistence || require('../utils/persistence')
	const projectStore = require('../engine/project-store')
	return {
		store: persistence,
		isMaster: () => of.master().view().is_master === true,
		claim: () => of.master().claim(),
		fpOf: (peer) => fingerprint(peer.device_key),
		peers: () => of.cluster().snapshot().peers,
		call: (id, action, args, o) => of.call().call(id, action, args, o),
		callMaster: (action, args, o) => of.call().callMaster(action, args, o),
		current: () => {
			const project = persistence.get('web_project') // the in-memory mirror persistProject / a load keep
			return project && typeof project === 'object' ? { slug: projectStore.getActiveSlug(persistence) || project.slug, project } : null
		},
		commit: (project) => commitShow(ctx, project),
		backup: backupProject,
		pairEnabled: () => !!require('../config/replication-config').getReplicationConfig(ctx.config).enabled,
		casparApply: () => casparLayoutDiffers(ctx),
		destsShared: () => !!require('./shared-show-dests-ctx').destsOf(ctx)?.owns(), // WO-1029 S5: the list travels on its own
		broadcast: (type, data) => typeof ctx._wsBroadcast === 'function' && ctx._wsBroadcast(type, data),
		log: ctx.log,
	}
}

module.exports = { sharedShowDeps, commitShow, liveDestinationsFor, backupProject, casparLayoutDiffers, channelModes }
