/**
 * WO-277 — adopt a freshly loaded project into the RUNNING system.
 *
 * `POST /api/project/load` used to do three things only: write the active-slug pointer, make the
 * media dir, and kick live audio routing. Everything else that a *restart* with that slug selected
 * would rebuild kept serving the previous project:
 *
 *  - `ctx.sceneDeck` (the in-memory deck mirror) is only ever rewritten by `persistProject`
 *    (engine/project-scenes.js:208-217), `applyLiveSceneDeckToCtx` (engine/project-scenes-transform.js:71)
 *    and `createNewProject` (engine/new-project.js:79) — never by load. Because
 *    `buildSceneDeckForApi` prefers `ctx.sceneDeck.sceneSnapshots` over the on-disk envelope
 *    (engine/project-scenes-transform.js:126), `GET /api/state` and the Companion bridge kept
 *    answering with the OLD project's looks after a switch, and the next `/api/project/autosave`
 *    ran `enrichProjectScenesFromLiveDeck` (engine/project-scenes-load.js:119) which stuffs those
 *    stale snapshots into the NEW project envelope.
 *  - `liveScenesByProgramChannel` (state/live-scene-state.js:14) still pointed at look ids that no
 *    longer exist in the new project.
 *  - the `web_project` persistence mirror (written by persistProject, engine/project-scenes.js:187)
 *    stayed on the previous project, so the `loadFullProject` fallback
 *    (engine/project-scenes-load.js:64) would resurrect it.
 *  - none of the boot-time staging ran: `restagePersistedPreviewLooks` / `warmLookDeckThumbnails`
 *    (config/routing-setup.js:473,544), artnet reconfigure, compose-preview refresh.
 *
 * Ordering is deliberate: every synchronous adoption lands BEFORE the first broadcast, so no client
 * can observe scenes from project B while `scene.live` / channelMap still describe project A.
 *
 * @module engine/project-activate
 */
'use strict'

const projectStore = require('./project-store')
const { extractSceneDeckFromProjectScenes, sceneIdSet } = require('./project-scenes-transform')
const { persistSceneDeckForCtx } = require('../state/live-deck-state')
const { applyHardwareConfigFromProject } = require('./project-hardware-config')

/**
 * Channel-assignment fingerprint. Two configs with the same signature produce the same
 * `<channels>` block, so Caspar does not need restarting between them.
 * @param {object} config
 * @returns {string}
 */
function channelLayoutSignature(config) {
	try {
		const { getChannelMap } = require('../config/routing')
		const map = getChannelMap(config || {})
		return JSON.stringify({
			screenCount: map.screenCount ?? null,
			programChannels: map.programChannels ?? null,
			previewChannels: map.previewChannels ?? null,
			switcherBus1Channels: map.switcherBus1Channels ?? null,
			inputsCh: map.inputsCh ?? null,
			inputChannels: map.inputChannels ?? null,
			decklinkInputChannels: map.decklinkInputChannels ?? null,
			liveAudioInputChannels: map.liveAudioInputChannels ?? null,
			v4l2InputChannels: map.v4l2InputChannels ?? null,
			audioOnlyChannels: map.audioOnlyChannels ?? null,
			multiviewCh: map.multiviewCh ?? null,
			multiviewChannels: map.multiviewChannels ?? null,
			streamingCh: map.streamingCh ?? null,
			operatorGuiChannels: map.operatorGuiChannels ?? null,
		})
	} catch {
		return ''
	}
}

/**
 * Replace the in-memory deck mirror with the loaded project's envelope.
 *
 * Unlike `persistProject` this does NOT carry the previous `previewSceneId` forward: on a project
 * switch that id belongs to the outgoing project and would resolve to nothing.
 *
 * @param {object} ctx
 * @param {object} project
 * @returns {{ adopted: boolean, lookCount: number, previewSceneId: string | null }}
 */
function adoptSceneDeckFromProject(ctx, project) {
	const deck = extractSceneDeckFromProjectScenes(project?.scenes)
	if (!deck) {
		// A project with no scenes envelope must still clear the previous project's deck.
		ctx.sceneDeck = { looks: [], sceneSnapshots: [], previewSceneId: null, layerPresets: [], lookPresets: [] }
		persistSceneDeckForCtx(ctx)
		return { adopted: true, lookCount: 0, previewSceneId: null }
	}
	ctx.sceneDeck = {
		looks: deck.looks,
		sceneSnapshots: Array.isArray(deck.sceneSnapshots) ? deck.sceneSnapshots : [],
		previewSceneId: deck.previewSceneId,
		layerPresets: deck.layerPresets,
		lookPresets: deck.lookPresets,
	}
	persistSceneDeckForCtx(ctx)
	return { adopted: true, lookCount: deck.looks.length, previewSceneId: deck.previewSceneId }
}

/**
 * Drop persisted per-channel live-scene entries whose look id is not in the incoming project.
 * Entries whose id still resolves are kept — reloading the same project must not black anything out.
 *
 * @param {object} project
 * @param {{ getAll: Function, clearChannel: Function }} [liveSceneStateModule] — injectable for tests
 * @returns {Promise<string[]>} channels cleared
 */
async function pruneLiveScenesNotInProject(project, liveSceneStateModule) {
	const liveSceneState = liveSceneStateModule || require('../state/live-scene-state')
	const ids = sceneIdSet(project)
	const all = liveSceneState.getAll() || {}
	const cleared = []
	for (const ch of Object.keys(all)) {
		const sceneId = all[ch]?.sceneId != null ? String(all[ch].sceneId).trim() : ''
		if (!sceneId) continue
		if (ids.has(sceneId)) continue
		await liveSceneState.clearChannel(ch)
		cleared.push(String(ch))
	}
	return cleared
}

/**
 * Fire-and-forget re-staging that needs a live AMCP connection. Never throws.
 * @param {object} ctx
 */
function scheduleLiveRestage(ctx) {
	const warn = (m) => {
		if (typeof ctx.log === 'function') ctx.log('warn', m)
	}
	try {
		const { ensureLiveAudioRouting } = require('../config/routing-setup')
		void ensureLiveAudioRouting(ctx).catch((e) => warn(`[project] Live audio routing: ${e?.message || e}`))
	} catch {
		/* optional */
	}
	try {
		const { refreshComposePreviewConsumers } = require('../preview/compose-preview-consumer')
		void refreshComposePreviewConsumers(ctx).catch((e) =>
			warn(`[compose-preview] refresh after project load: ${e?.message || e}`),
		)
	} catch {
		/* optional */
	}
	try {
		const { restagePersistedPreviewLooks, warmLookDeckThumbnails } = require('../config/routing-setup')
		void Promise.resolve()
			.then(() => restagePersistedPreviewLooks(ctx))
			.catch((e) => warn(`[project] Preview re-stage after load: ${e?.message || e}`))
		void Promise.resolve()
			.then(() => warmLookDeckThumbnails(ctx))
			.catch((e) => warn(`[project] Look thumb warm after load: ${e?.message || e}`))
	} catch {
		/* optional */
	}
	try {
		// Owner request 2026-07-26: the project carries the operator compose placement — re-apply
		// it (routes + FILLs + holes + broadcast) so every client's tiles restore with the show.
		// The just-activated project is already on disk here, so read it back rather than thread
		// it through (this helper is also reached from restage paths without the envelope).
		const { applyProjectComposeLayout } = require('../system/operator-gui-channel')
		const { loadFullProject } = require('./project-scenes-load')
		void Promise.resolve()
			.then(() => applyProjectComposeLayout(ctx, loadFullProject()))
			.catch((e) => warn(`[project] Compose layout re-apply after load: ${e?.message || e}`))
	} catch {
		/* optional */
	}
}

/**
 * Bring the running system onto `project`. Safe to call with a plain stub ctx (offline tests).
 *
 * @param {object} ctx
 * @param {object} project — the merged project envelope that was just loaded from disk
 * @param {{ applyHardware?: boolean, broadcastProject?: boolean, restage?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, slug: string, lookCount: number, previewSceneId: string | null,
 *   clearedLiveChannels: string[], restartRequired: boolean, restartReason: string | null }>}
 */
async function activateLoadedProject(ctx, project, opts = {}) {
	if (!ctx || !project || typeof project !== 'object') {
		return {
			ok: false,
			slug: '',
			lookCount: 0,
			previewSceneId: null,
			clearedLiveChannels: [],
			restartRequired: false,
			restartReason: null,
		}
	}
	const persistence = ctx.persistence || require('../utils/persistence')
	const slug =
		(project.slug && String(project.slug).trim()) || projectStore.projectSlugFromName(project.name)

	// --- 1. hardware slice (bracketed so we can tell whether Caspar's channel layout moved) ---
	const beforeSig = channelLayoutSignature(ctx.config)
	if (opts.applyHardware === true) {
		try {
			applyHardwareConfigFromProject(ctx, project)
		} catch (e) {
			if (typeof ctx.log === 'function') {
				ctx.log('warn', `[project] hardwareConfig apply failed: ${e?.message || e}`)
			}
		}
	}
	const afterSig = channelLayoutSignature(ctx.config)
	const restartRequired = !!beforeSig && !!afterSig && beforeSig !== afterSig
	const restartReason = restartRequired
		? 'Caspar channel layout changed with this project — regenerate and Apply the CasparCG config, then restart CasparCG.'
		: null

	// --- 2. synchronous state adoption (all of it, before any broadcast) ---
	const deckInfo = adoptSceneDeckFromProject(ctx, project)
	try {
		persistence.set('web_project', projectStore.withProjectSlug(project, slug))
	} catch {
		/* mirror is a fallback only */
	}
	let clearedLiveChannels = []
	try {
		clearedLiveChannels = await pruneLiveScenesNotInProject(project, opts._liveSceneState)
	} catch (e) {
		if (typeof ctx.log === 'function') {
			ctx.log('warn', `[project] live-scene prune failed: ${e?.message || e}`)
		}
	}
	try {
		if (ctx.artnetReceiver?.reconfigureFromProject) ctx.artnetReceiver.reconfigureFromProject(project)
		else if (ctx.artnetReceiver?.reconfigure) ctx.artnetReceiver.reconfigure()
	} catch (e) {
		if (typeof ctx.log === 'function') ctx.log('warn', `[project] artnet reconfigure: ${e?.message || e}`)
	}

	// --- 3. tell clients (state is already consistent at this point) ---
	if (typeof ctx._wsBroadcast === 'function') {
		try {
			require('../state/live-scene-state').broadcastSceneLive(ctx)
		} catch {
			/* optional */
		}
		try {
			ctx._wsBroadcast('change', {
				path: 'project.activated',
				value: {
					slug,
					name: project.name || null,
					lookCount: deckInfo.lookCount,
					clearedLiveChannels,
					restartRequired,
					restartReason,
				},
			})
		} catch {
			/* optional */
		}
		if (opts.broadcastProject === true) {
			try {
				const { scheduleProjectSyncBroadcast } = require('../api/routes-data-project-sync')
				scheduleProjectSyncBroadcast(ctx, project)
			} catch {
				/* optional */
			}
		}
	}

	if (typeof ctx.log === 'function') {
		ctx.log(
			'info',
			`[project] activated ${slug}: ${deckInfo.lookCount} look(s) adopted, ${clearedLiveChannels.length} stale live channel(s) cleared${restartRequired ? ' — CASPAR RESTART REQUIRED' : ''}`,
		)
	}

	// --- 4. AMCP-side re-staging, fire and forget ---
	if (opts.restage !== false) scheduleLiveRestage(ctx)

	return {
		ok: true,
		slug,
		lookCount: deckInfo.lookCount,
		previewSceneId: deckInfo.previewSceneId,
		clearedLiveChannels,
		restartRequired,
		restartReason,
	}
}

module.exports = {
	activateLoadedProject,
	adoptSceneDeckFromProject,
	pruneLiveScenesNotInProject,
	channelLayoutSignature,
}
