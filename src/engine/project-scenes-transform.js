'use strict'

const { loadProjectScenes } = require('./project-scenes-load')

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
 * Apply live scene_deck_sync payload to in-memory ctx (before disk persist completes).
 *
 * @param {object} ctx
 * @param {{ looks?: object[], sceneSnapshots?: object[], previewSceneId?: string | null, layerPresets?: object[], lookPresets?: object[] }} data
 */
function applyLiveSceneDeckToCtx(ctx, data) {
	if (!ctx || !data || typeof data !== 'object') return
	const sceneSnapshots = Array.isArray(data.sceneSnapshots)
		? data.sceneSnapshots.filter((s) => s && typeof s === 'object' && s.id != null && String(s.id).trim())
		: []
	const looksRaw = Array.isArray(data.looks) ? data.looks : []
	const looksFromSnaps = sceneSnapshots.map((s) => ({
		id: String(s.id).trim(),
		name: String(s.name != null ? s.name : 'Untitled look'),
		...(s.mainScope != null && String(s.mainScope).trim()
			? { mainScope: String(s.mainScope) }
			: {}),
	}))
	const looksById = new Map()
	for (const raw of looksRaw) {
		if (!raw || raw.id == null) continue
		const id = String(raw.id).trim()
		if (!id) continue
		looksById.set(id, raw)
	}
	for (const meta of looksFromSnaps) {
		looksById.set(meta.id, { ...looksById.get(meta.id), ...meta })
	}
	const prvRaw = data.previewSceneId
	const previewSceneId =
		prvRaw != null && String(prvRaw).trim()
			? String(prvRaw).trim()
			: ctx.sceneDeck?.previewSceneId != null && String(ctx.sceneDeck.previewSceneId).trim()
				? String(ctx.sceneDeck.previewSceneId).trim()
				: null
	ctx.sceneDeck = {
		looks: [...looksById.values()],
		sceneSnapshots,
		previewSceneId,
		layerPresets: Array.isArray(data.layerPresets)
			? data.layerPresets
			: ctx.sceneDeck?.layerPresets || [],
		lookPresets: Array.isArray(data.lookPresets) ? data.lookPresets : ctx.sceneDeck?.lookPresets || [],
	}
}

function sceneHasTakeableLayers(scene) {
	return !!(scene && Array.isArray(scene.layers) && scene.layers.some((l) => l?.source?.value))
}

/** Fill missing layer payloads from saved project when deck sync only has id/name metadata. */
function mergeSceneWithProjectLayers(scene, projectScene) {
	if (!projectScene) return scene
	if (sceneHasTakeableLayers(scene)) return scene
	if (!sceneHasTakeableLayers(projectScene)) return scene || projectScene
	return {
		...projectScene,
		...scene,
		layers: projectScene.layers,
		name: scene.name ?? projectScene.name,
		mainScope: scene.mainScope ?? projectScene.mainScope,
	}
}

function enrichDeckScenesWithProject(deckScenes, projectEnvelope) {
	const projList = Array.isArray(projectEnvelope?.scenes) ? projectEnvelope.scenes : []
	const byId = new Map(projList.map((s) => [String(s.id).trim(), s]))
	return (deckScenes || []).map((s) => {
		const id = String(s?.id ?? '').trim()
		return mergeSceneWithProjectLayers(s, byId.get(id))
	})
}

/**
 * Scene deck for Companion / GET /api/state.
 * Live WS-synced deck (ctx.sceneDeck) wins over on-disk project for look names.
 * @param {object} ctx
 */
function buildSceneDeckForApi(ctx) {
	const projectEnv = loadProjectScenes()
	const fromProject = extractSceneDeckFromProjectScenes(projectEnv)
	const rawDeck =
		ctx?.sceneDeck && typeof ctx.sceneDeck === 'object' && Array.isArray(ctx.sceneDeck.looks)
			? ctx.sceneDeck
			: null
	const livePreview =
		rawDeck?.previewSceneId != null && String(rawDeck.previewSceneId).trim()
			? String(rawDeck.previewSceneId).trim()
			: null

	if (rawDeck && Array.isArray(rawDeck.sceneSnapshots) && rawDeck.sceneSnapshots.length) {
		const enrichedSnaps = enrichDeckScenesWithProject(rawDeck.sceneSnapshots, projectEnv)
		const live = extractSceneDeckFromProjectScenes({
			scenes: enrichedSnaps,
			previewSceneId: livePreview ?? rawDeck.previewSceneId,
			layerPresets: rawDeck.layerPresets,
			lookPresets: rawDeck.lookPresets,
		})
		if (live) {
			return {
				...live,
				previewSceneId: livePreview || live.previewSceneId || null,
			}
		}
	}

	if (rawDeck && Array.isArray(rawDeck.looks) && rawDeck.looks.length) {
		if (fromProject) {
			const nameById = new Map(
				rawDeck.looks.map((l) => [String(l?.id ?? '').trim(), l]).filter(([id]) => id),
			)
			const scenes = enrichDeckScenesWithProject(
				(fromProject.sceneSnapshots || []).map((s) => {
					const meta = nameById.get(String(s?.id ?? '').trim())
					return meta
						? {
								...s,
								name: meta.name ?? s.name,
								mainScope: meta.mainScope ?? s.mainScope,
							}
						: s
				}),
				projectEnv,
			)
			const live = extractSceneDeckFromProjectScenes({
				scenes,
				previewSceneId: livePreview ?? fromProject.previewSceneId,
				layerPresets: rawDeck.layerPresets ?? fromProject.layerPresets,
				lookPresets: rawDeck.lookPresets ?? fromProject.lookPresets,
			})
			if (live) {
				return {
					...live,
					previewSceneId: livePreview || live.previewSceneId || null,
				}
			}
		}
		const live = extractSceneDeckFromProjectScenes({
			scenes: rawDeck.looks.map((l) => ({
				id: l.id,
				name: l.name,
				mainScope: l.mainScope,
			})),
			previewSceneId: livePreview,
			layerPresets: rawDeck.layerPresets,
			lookPresets: rawDeck.lookPresets,
		})
		if (live) {
			return {
				...live,
				previewSceneId: livePreview || live.previewSceneId || null,
			}
		}
	}

	if (!fromProject) {
		return {
			looks: [],
			previewSceneId: livePreview,
			layerPresets: [],
			lookPresets: [],
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

module.exports = {
	extractSceneDeckFromProjectScenes,
	buildSceneDeckForApi,
	resolveSceneById,
	applyLiveSceneDeckToCtx,
	sceneIdSet,
}
