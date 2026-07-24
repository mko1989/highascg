'use strict'

const projectStore = require('./project-store')
const { ensureProjectMediaDir, normalizeProjectMediaRefs } = require('../media/project-media-root')
const { pushProjectSlugToVolumes } = require('./project-volume-sync')
const { persistSceneDeckForCtx } = require('../state/live-deck-state')
const { loadFullProject } = require('./project-scenes-load')
const {
	extractSceneDeckFromProjectScenes,
	applyLiveSceneDeckToCtx,
	sceneIdSet,
} = require('./project-scenes-transform')

/** Debounce disk writes from WebSocket `scene_deck_sync` (default 750ms). */
const SCENE_DECK_SYNC_DEBOUNCE_MS = Math.max(
	0,
	Math.min(10_000, parseInt(process.env.HIGHASCG_SCENE_DECK_SYNC_DEBOUNCE_MS || '750', 10) || 750),
)

/** @type {ReturnType<typeof setTimeout> | null} */
let _deckSyncPersistTimer = null
/** @type {{ ctx: object, project: object } | null} */
let _deckSyncPersistPending = null

function flushDeckSyncPersist() {
	if (_deckSyncPersistTimer) {
		clearTimeout(_deckSyncPersistTimer)
		_deckSyncPersistTimer = null
	}
	const pending = _deckSyncPersistPending
	_deckSyncPersistPending = null
	if (!pending?.ctx || !pending?.project) return
	/* WO-329: bumpRev:false — deck-sync merges must not outrun HTTP clients' rev echo. */
	void persistProject(pending.ctx, pending.project, { writeAutosave: true, pushVolumes: false, bumpRev: false }).catch((e) => {
		if (typeof pending.ctx?.log === 'function') {
			pending.ctx.log('warn', '[project] deck sync persist: ' + (e?.message || e))
		}
	})
}

function scheduleDeckSyncPersist(ctx, project) {
	_deckSyncPersistPending = { ctx, project }
	if (SCENE_DECK_SYNC_DEBOUNCE_MS <= 0) {
		flushDeckSyncPersist()
		return
	}
	if (_deckSyncPersistTimer) clearTimeout(_deckSyncPersistTimer)
	_deckSyncPersistTimer = setTimeout(flushDeckSyncPersist, SCENE_DECK_SYNC_DEBOUNCE_MS)
	if (_deckSyncPersistTimer.unref) _deckSyncPersistTimer.unref()
}

/**
 * Detect a different show being pushed with a fresh `savedAt` (stale browser tab / autosave timer).
 * @param {object} incoming
 * @param {object | null | undefined} existing
 */
function isLikelyStaleProjectReplace(incoming, existing) {
	if (!incoming || !existing) return false
	const exIds = sceneIdSet(existing)
	const inIds = sceneIdSet(incoming)
	if (exIds.size === 0 || inIds.size === 0) return false
	let overlap = 0
	for (const id of inIds) {
		if (exIds.has(id)) overlap++
	}
	if (overlap === 0) return true
	const minSize = Math.min(exIds.size, inIds.size)
	return minSize >= 3 && overlap / minSize < 0.25
}

/**
 * WO-329: both sides carry a server-issued monotonic `rev` → compare THAT (clock-skew
 * immune). A missing rev on either side (older tab across the deploy, hand-made JSON)
 * falls back to the legacy wall-clock `savedAt` compare — accept-once grace, the next
 * persist stamps a rev.
 * @param {object} incoming
 * @param {object | null} existing
 */
function projectRevOf(p) {
	const r = Number(p?.rev)
	return Number.isFinite(r) && r > 0 ? Math.floor(r) : null
}

/**
 * Reject saves that would roll back to an older project (e.g. Companion cached state).
 * @param {object} incoming
 * @param {object | null} existing
 */
function isProjectSaveNewerOrEqual(incoming, existing) {
	if (!existing || typeof existing !== 'object') return true
	const rIn = projectRevOf(incoming)
	const rEx = projectRevOf(existing)
	if (rIn != null && rEx != null) return rIn >= rEx
	const tIn = Date.parse(incoming?.savedAt || '') || 0
	const tEx = Date.parse(existing.savedAt || '') || 0
	if (!tIn || !tEx) return true
	return tIn >= tEx
}

/**
 * @param {object} incoming
 * @param {object | null | undefined} existing
 * @param {{ allowReplace?: boolean }} [opts]
 * @returns {{ ok: true } | { ok: false, reason: string, details?: object }}
 */
function validateIncomingProject(incoming, existing, opts = {}) {
	const storedLooks = sceneIdSet(existing).size
	const incomingLooks = sceneIdSet(incoming).size
	if (!opts.allowReplace && storedLooks > 0 && incomingLooks === 0) {
		return {
			ok: false,
			reason: 'empty_over_nonempty',
			details: { storedLookCount: storedLooks, incomingLookCount: 0 },
		}
	}
	if (!isProjectSaveNewerOrEqual(incoming, existing)) {
		const revBased = projectRevOf(incoming) != null && projectRevOf(existing) != null
		return {
			ok: false,
			reason: revBased ? 'stale_rev' : 'stale_saved_at',
			details: {
				storedRev: projectRevOf(existing),
				incomingRev: projectRevOf(incoming),
				storedSavedAt: existing?.savedAt || null,
				incomingSavedAt: incoming?.savedAt || null,
			},
		}
	}
	if (!opts.allowReplace && isLikelyStaleProjectReplace(incoming, existing)) {
		return {
			ok: false,
			reason: 'unrelated_scene_set',
			details: {
				storedLookCount: sceneIdSet(existing).size,
				incomingLookCount: sceneIdSet(incoming).size,
				overlap: [...sceneIdSet(incoming)].filter((id) => sceneIdSet(existing).has(id)).length,
			},
		}
	}
	return { ok: true }
}

/**
 * Persist project + optional autosave file; update in-memory deck mirror (no WS broadcast).
 * Main file write must succeed before mirror/autosave updates (WO-106).
 *
 * WO-329: every bumping persist stamps `rev = max(storedRev, incomingRev) + 1` — a server-
 * issued monotonic revision that survives restarts (it lives in the project file) and can
 * never move backwards. `bumpRev: false` (WS deck-sync merges) carries the stored rev
 * through unchanged: deck-sync is a server-internal merge with no HTTP response to hand a
 * new rev back on, and bumping there would instantly strand every HTTP-saving client.
 * @param {object} ctx
 * @param {object} project
 * @param {{ writeAutosave?: boolean, pushVolumes?: boolean, bumpRev?: boolean }} [opts]
 * @returns {{ ok: true, slug: string, rev: number | null, project: object }}
 */
async function persistProject(ctx, project, opts = {}) {
	if (!ctx || !project || typeof project !== 'object') {
		throw new Error('Invalid project persist payload')
	}
	const persistence = ctx.persistence || require('../utils/persistence')
	const slug = projectStore.projectSlugFromName(project.name)
	projectStore.migrateLegacySingleProject(persistence)
	const normalized = normalizeProjectMediaRefs(project, ctx.config, persistence)
	const stamped = projectStore.withProjectSlug(normalized, slug)
	const storedRev = projectRevOf(projectStore.readProjectFile(slug)) || 0
	if (opts.bumpRev !== false) {
		stamped.rev = Math.max(storedRev, projectRevOf(stamped) || 0) + 1
	} else if (projectRevOf(stamped) == null && storedRev > 0) {
		stamped.rev = storedRev
	}
	await projectStore.writeProjectFile(slug, stamped)
	projectStore.setActiveSlug(persistence, slug)
	ensureProjectMediaDir(ctx.config, slug, persistence)
	persistence.set('web_project', stamped)
	if (opts.writeAutosave !== false) {
		try {
			await projectStore.writeAutosaveFile(slug, stamped)
		} catch (e) {
			if (typeof ctx.log === 'function') {
				ctx.log('warn', '[project] autosave write: ' + (e?.message || e))
			}
		}
	}
	if (opts.pushVolumes !== false) {
		try {
			pushProjectSlugToVolumes(slug, {
				log: typeof ctx.log === 'function' ? ctx.log.bind(ctx) : undefined,
			})
		} catch (e) {
			if (typeof ctx.log === 'function') {
				ctx.log('warn', '[project] volume push: ' + (e?.message || e))
			}
		}
	}
	const deck = extractSceneDeckFromProjectScenes(project.scenes)
	if (deck) {
		const prevPreview = ctx.sceneDeck?.previewSceneId
		ctx.sceneDeck = {
			...deck,
			previewSceneId:
				prevPreview != null && String(prevPreview).trim() ? String(prevPreview).trim() : deck.previewSceneId,
		}
		persistSceneDeckForCtx(ctx)
	}
	return { ok: true, slug, rev: projectRevOf(stamped), project: stamped }
}

/**
 * Merge live UI deck sync into canonical project (WebSocket `scene_deck_sync`).
 * @param {object} ctx
 * @param {{ looks?: object[], sceneSnapshots?: object[], previewSceneId?: string | null, layerPresets?: object[], lookPresets?: object[] }} data
 */
function mergeDeckSyncIntoProject(ctx, data) {
	if (!ctx || !data || typeof data !== 'object') return null
	const existing = loadFullProject() || {
		version: 2,
		name: 'Untitled',
		scenes: { scenes: [], layerPresets: [], lookPresets: [] },
	}
	const envelope =
		existing.scenes && typeof existing.scenes === 'object'
			? { ...existing.scenes }
			: { scenes: [], layerPresets: [], lookPresets: [] }
	const snapRaw = data.sceneSnapshots
	const scenes = Array.isArray(snapRaw) && snapRaw.length
		? snapRaw.filter((s) => s && typeof s === 'object' && s.id != null && String(s.id).trim())
		: Array.isArray(envelope.scenes)
			? envelope.scenes
			: []
	envelope.scenes = scenes
	if (Array.isArray(data.layerPresets)) envelope.layerPresets = data.layerPresets
	if (Array.isArray(data.lookPresets)) envelope.lookPresets = data.lookPresets
	const prvRaw = data.previewSceneId
	if (prvRaw != null && String(prvRaw).trim()) {
		envelope.previewSceneId = String(prvRaw).trim()
	}
	const project = {
		...existing,
		savedAt: new Date().toISOString(),
		scenes: envelope,
	}
	const check = validateIncomingProject(project, existing)
	if (!check.ok) {
		if (typeof ctx.log === 'function') {
			ctx.log(
				'warn',
				`[project] scene_deck_sync ignored (${check.reason}) looks ${check.details?.incomingLookCount ?? '?'} vs stored ${check.details?.storedLookCount ?? '?'}`,
			)
		}
		return null
	}
	applyLiveSceneDeckToCtx(ctx, data)
	scheduleDeckSyncPersist(ctx, project)
	return project
}

module.exports = {
	projectRevOf,
	isProjectSaveNewerOrEqual,
	isLikelyStaleProjectReplace,
	validateIncomingProject,
	persistProject,
	mergeDeckSyncIntoProject,
	flushDeckSyncPersist,
	SCENE_DECK_SYNC_DEBOUNCE_MS,
}
