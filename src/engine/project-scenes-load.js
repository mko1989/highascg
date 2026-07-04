'use strict'

const projectStore = require('./project-store')

/**
 * Load one project slug from disk.
 * @param {string} slug
 * @param {{ mergeAutosave?: boolean }} [opts] — when true, merge `_autosave/<slug>.json` via `pickNewerFullProject`
 * @returns {object | null}
 */
function loadProjectForSlug(slug, opts = {}) {
	const s = String(slug || '').trim()
	if (!s) return null
	const fromFile = projectStore.readProjectFile(s)
	if (!opts.mergeAutosave) return fromFile
	const fromAutosave =
		projectStore.readAutosaveFile(s) || projectStore.readLegacyAutosaveIfMatches(s)
	if (fromAutosave) return pickNewerFullProject(fromFile, fromAutosave)
	return fromFile
}

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
				console.warn(
					'[project] loadFullProject: using deprecated web_project mirror fallback — re-save via header Save or fix projects/<slug>.json',
				)
				fromFile = project
				const inferred = projectStore.projectSlugFromName(project.name)
				if (inferred && !slug) projectStore.setActiveSlug(persistence, inferred)
			}
		}
		if (!fromFile) return null
		const activeSlug =
			slug || projectStore.projectSlugFromName(fromFile.name) || String(fromFile.slug || '')
		return loadProjectForSlug(activeSlug, { mergeAutosave: true }) || fromFile
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
 * Prefer live WS-synced deck scenes over a possibly stale autosave export (WO-106).
 * @param {object} project
 * @param {object} ctx
 * @returns {object}
 */
function enrichProjectScenesFromLiveDeck(project, ctx) {
	if (!project || typeof project !== 'object' || !ctx?.sceneDeck) return project
	const deck = ctx.sceneDeck
	const snaps = Array.isArray(deck.sceneSnapshots) ? deck.sceneSnapshots : null
	if (!snaps?.length) return project
	const envelope =
		project.scenes && typeof project.scenes === 'object'
			? { ...project.scenes }
			: { scenes: [], layerPresets: [], lookPresets: [] }
	envelope.scenes = snaps
	if (deck.previewSceneId != null && String(deck.previewSceneId).trim()) {
		envelope.previewSceneId = String(deck.previewSceneId).trim()
	}
	if (Array.isArray(deck.layerPresets)) envelope.layerPresets = deck.layerPresets
	if (Array.isArray(deck.lookPresets)) envelope.lookPresets = deck.lookPresets
	return { ...project, scenes: envelope }
}

module.exports = {
	loadFullProject,
	loadProjectForSlug,
	pickNewerFullProject,
	projectSceneCount,
	loadProjectScenes,
	enrichProjectScenesFromLiveDeck,
}
