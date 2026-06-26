/**
 * Look/Scene logic for SceneState.
 */
import {
	defaultTransition,
	migrateScene,
	newId,
} from './scene-state-helpers.js'
import {
	buildLowerThirdCasparCgData,
	cgDataHasLowerThirdEditorContent,
	isLowerThirdSource,
	resolveLayerLowerThirdConfig,
} from './lower-third-cg-data.js'

export function uniqueLookNameForDuplicate(scenes, baseName) {
	const base = String(baseName || '').trim() || 'Look'
	const stem = `${base} (copy)`
	const taken = new Set(scenes.map((x) => String(x.name || '').trim().toLowerCase()))
	if (!taken.has(stem.toLowerCase())) return stem
	for (let n = 2; n < 1000; n++) {
		const candidate = `${base} (copy ${n})`
		if (!taken.has(candidate.toLowerCase())) return candidate
	}
	return `${base} (copy ${Date.now()})`
}

export function uniqueLookPresetName(presets, baseName) {
	const base = String(baseName || '').trim() || 'Look preset'
	const taken = new Set(presets.map((p) => String(p.name || '').trim().toLowerCase()))
	if (!taken.has(base.toLowerCase())) return base
	for (let n = 2; n < 1000; n++) {
		const candidate = `${base} (${n})`
		if (!taken.has(candidate.toLowerCase())) return candidate
	}
	return `${base} ${Date.now()}`
}

export function importLookPresetsFromServer(list) {
	if (!Array.isArray(list) || list.length === 0) return null
	const sk = (v) => (v === 'prv' || v === 'pgm' || v === 'editing' ? v : 'editing')
	const next = list
		.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.sceneId === 'string')
		.map((p) => {
			const o = {
				id: p.id,
				name: p.name,
				createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
				sceneId: p.sceneId,
				sourceKind: sk(p.sourceKind),
				targetMain: typeof p.targetMain === 'number' && p.targetMain >= 0 ? p.targetMain : 0,
			}
			if (Array.isArray(p.items) && p.items.length > 0) {
				o.items = p.items
					.filter((it) => it && typeof it.sceneId === 'string')
					.map((it) => ({
						mainIdx: typeof it.mainIdx === 'number' && it.mainIdx >= 0 ? Math.floor(it.mainIdx) : 0,
						sceneId: String(it.sceneId),
						sourceKind: sk(it.sourceKind),
					}))
			}
			return o
		})
	return next.length > 0 ? next : null
}

function preserveLowerThirdEditorFields(prevLayers, incomingLayers) {
	return incomingLayers.map((incoming, i) => {
		const merged = JSON.parse(JSON.stringify(incoming))
		const prev = prevLayers?.[i]
		if (!isLowerThirdSource(merged?.source) && !isLowerThirdSource(prev?.source)) return merged

		const effectiveCg =
			cgDataHasLowerThirdEditorContent(merged.cgData) || !prev?.cgData
				? merged.cgData
				: prev.cgData

		const ltCfg = resolveLayerLowerThirdConfig({
			...merged,
			cgData: effectiveCg,
			source: {
				...(prev?.source || {}),
				...(merged.source || {}),
				lowerThirdConfig: merged.source?.lowerThirdConfig ?? prev?.source?.lowerThirdConfig,
				lowerThirdRoster: merged.source?.lowerThirdRoster ?? prev?.source?.lowerThirdRoster,
			},
		})
		if (!ltCfg) return merged

		merged.source = {
			...(merged.source || prev?.source || {}),
			lowerThirdConfig: ltCfg,
			lowerThirdRoster: merged.source?.lowerThirdRoster ?? prev?.source?.lowerThirdRoster,
		}
		merged.cgData = buildLowerThirdCasparCgData(ltCfg)
		return merged
	})
}

export function applySceneFromTakePayload(scene, payload) {
	if (!scene || !payload || typeof payload !== 'object') return false
	let any = false
	if (Array.isArray(payload.layers)) {
		const prevLayers = scene.layers
		scene.layers = preserveLowerThirdEditorFields(prevLayers, payload.layers)
		any = true
	}
	if (payload.defaultTransition != null) {
		scene.defaultTransition = { ...defaultTransition(), ...payload.defaultTransition }
		any = true
	}
	if (typeof payload.name === 'string' && payload.name.trim()) {
		scene.name = payload.name.trim()
		any = true
	}
	return any
}
