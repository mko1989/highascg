'use strict'

const fs = require('fs')
const path = require('path')

const { REPO_ROOT } = require('../repo-paths')
const projectStore = require('./project-store')
const { pushProjectSlugToVolumes } = require('./project-volume-sync')

/**
 * Active project: `projects/<activeSlug>.json`, merged only with autosave for the **same** slug.
 * Other slugs on disk are left untouched when the name changes.
 * @returns {object | null}
 */
function loadFullProject() {
	try {
		const persistence = require('../utils/persistence')
		projectStore.migrateLegacySingleProject(persistence)
		const slug = projectStore.getActiveSlug(persistence)
		let fromFile = slug ? projectStore.readProjectFile(slug) : null
		if (!fromFile) {
			const project = persistence.get('web_project')
			if (project && typeof project === 'object') {
				fromFile = project
				const inferred = projectStore.projectSlugFromName(project.name)
				if (inferred && !slug) projectStore.setActiveSlug(persistence, inferred)
			}
		}
		if (!fromFile) return null
		const activeSlug =
			slug || projectStore.projectSlugFromName(fromFile.name) || String(fromFile.slug || '')
		const fromAutosave =
			projectStore.readAutosaveFile(activeSlug) ||
			projectStore.readLegacyAutosaveIfMatches(activeSlug)
		if (fromAutosave) return pickNewerFullProject(fromFile, fromAutosave)
		return fromFile
	} catch (_) {
		return null
	}
}

/** @param {object | null} fromPersist @param {object | null} fromAutosave */
function projectSceneCount(project) {
	const scenes = project?.scenes?.scenes
	return Array.isArray(scenes) ? scenes.length : 0
}

/** Prefer non-empty looks; then newer `savedAt`. */
function pickNewerFullProject(fromPersist, fromAutosave) {
	if (!fromPersist) return fromAutosave || null
	if (!fromAutosave) return fromPersist
	const cP = projectSceneCount(fromPersist)
	const cA = projectSceneCount(fromAutosave)
	if (cP > 0 && cA === 0) return fromPersist
	if (cA > 0 && cP === 0) return fromAutosave
	const tP = Date.parse(fromPersist.savedAt || '') || 0
	const tA = Date.parse(fromAutosave.savedAt || '') || 0
	return tP >= tA ? fromPersist : fromAutosave
}

/**
 * `project.scenes` envelope only (looks + globalBorders + presets).
 */
function loadProjectScenes() {
	const project = loadFullProject()
	if (project?.scenes && typeof project.scenes === 'object') {
		return project.scenes
	}
	return null
}

/**
 * @param {object | null | undefined} envelope — `sceneState.getExportData()` shape
 */
function extractSceneDeckFromProjectScenes(envelope) {
	if (!envelope || typeof envelope !== 'object') return null
	const scenes = Array.isArray(envelope.scenes) ? envelope.scenes : []
	const looks = scenes
		.map((s) => ({
			id: String(s?.id != null ? s.id : ''),
			name: String(s?.name != null ? s.name : 'Untitled look'),
			...(s?.mainScope != null && String(s.mainScope).trim()
				? { mainScope: String(s.mainScope) }
				: {}),
		}))
		.filter((x) => x.id)
	let previewSceneId = envelope.previewSceneId
	if (previewSceneId == null && Array.isArray(envelope.previewSceneIdByMain)) {
		const idx = Number(envelope.activeScreenIndex) || 0
		previewSceneId = envelope.previewSceneIdByMain[idx] ?? null
	}
	return {
		looks,
		previewSceneId:
			previewSceneId != null && String(previewSceneId).trim() ? String(previewSceneId).trim() : null,
		layerPresets: Array.isArray(envelope.layerPresets) ? envelope.layerPresets : [],
		lookPresets: Array.isArray(envelope.lookPresets) ? envelope.lookPresets : [],
		...(scenes.length ? { sceneSnapshots: scenes } : {}),
	}
}

/**
 * Scene deck for Companion / GET /api/state — always from saved project, not stale memory.
 * @param {object} ctx
 */
function buildSceneDeckForApi(ctx) {
	const fromProject = extractSceneDeckFromProjectScenes(loadProjectScenes())
	const rawDeck =
		ctx?.sceneDeck && typeof ctx.sceneDeck === 'object' && Array.isArray(ctx.sceneDeck.looks)
			? ctx.sceneDeck
			: { looks: [] }
	const livePreview =
		rawDeck.previewSceneId != null && String(rawDeck.previewSceneId).trim()
			? String(rawDeck.previewSceneId).trim()
			: null
	if (!fromProject) {
		return {
			...rawDeck,
			looks: Array.isArray(rawDeck.looks) ? rawDeck.looks : [],
			previewSceneId: livePreview,
			layerPresets: Array.isArray(rawDeck.layerPresets) ? rawDeck.layerPresets : [],
			lookPresets: Array.isArray(rawDeck.lookPresets) ? rawDeck.lookPresets : [],
		}
	}
	return {
		...fromProject,
		previewSceneId: livePreview || fromProject.previewSceneId || null,
	}
}

/**
 * @param {string} sceneId
 * @returns {object | null}
 */
function resolveSceneById(sceneId) {
	if (sceneId == null || !String(sceneId).trim()) return null
	const id = String(sceneId).trim()
	const envelope = loadProjectScenes()
	const scenes = Array.isArray(envelope?.scenes) ? envelope.scenes : []
	return scenes.find((s) => s && String(s.id) === id) || null
}

/** @param {object | null | undefined} project */
function sceneIdSet(project) {
	const scenes = project?.scenes?.scenes
	if (!Array.isArray(scenes)) return new Set()
	const ids = scenes
		.map((s) => (s?.id != null ? String(s.id).trim() : ''))
		.filter(Boolean)
	return new Set(ids)
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
 * Reject saves that would roll back to an older project (e.g. Companion cached state).
 * @param {object} incoming
 * @param {object | null} existing
 */
function isProjectSaveNewerOrEqual(incoming, existing) {
	if (!existing || typeof existing !== 'object') return true
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
		return {
			ok: false,
			reason: 'stale_saved_at',
			details: {
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
 * @param {object} ctx
 * @param {object} project
 * @param {{ writeAutosave?: boolean }} [opts]
 * @returns {boolean}
 */
function persistProject(ctx, project, opts = {}) {
	if (!ctx || !project || typeof project !== 'object') return false
	const persistence = ctx.persistence || require('../utils/persistence')
	const slug = projectStore.projectSlugFromName(project.name)
	projectStore.migrateLegacySingleProject(persistence)
	const stamped = projectStore.withProjectSlug(project, slug)
	try {
		projectStore.writeProjectFile(slug, stamped)
		projectStore.setActiveSlug(persistence, slug)
	} catch (e) {
		if (typeof ctx.log === 'function') {
			ctx.log('warn', '[project] projects/ write: ' + (e?.message || e))
		}
	}
	persistence.set('web_project', stamped)
	if (opts.writeAutosave !== false) {
		try {
			projectStore.writeAutosaveFile(slug, stamped)
		} catch (e) {
			if (typeof ctx.log === 'function') {
				ctx.log('warn', '[project] autosave write: ' + (e?.message || e))
			}
		}
	}
	try {
		pushProjectSlugToVolumes(slug, {
			log: typeof ctx.log === 'function' ? ctx.log.bind(ctx) : undefined,
		})
	} catch (e) {
		if (typeof ctx.log === 'function') {
			ctx.log('warn', '[project] volume push: ' + (e?.message || e))
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
		try {
			persistence.set('scene_deck', {
				looks: deck.looks,
				previewSceneId: ctx.sceneDeck.previewSceneId,
				layerPresets: deck.layerPresets,
				lookPresets: deck.lookPresets,
			})
		} catch (_) {}
	}
	return true
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
	persistProject(ctx, project, { writeAutosave: true })
	return project
}

module.exports = {
	loadFullProject,
	pickNewerFullProject,
	projectSceneCount,
	loadProjectScenes,
	extractSceneDeckFromProjectScenes,
	buildSceneDeckForApi,
	resolveSceneById,
	isProjectSaveNewerOrEqual,
	isLikelyStaleProjectReplace,
	validateIncomingProject,
	sceneIdSet,
	persistProject,
	mergeDeckSyncIntoProject,
}
