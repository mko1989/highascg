/**
 * Layer style clipboard, layer/look presets, and server preset imports for {@link SceneState}.
 */
import { newId } from './scene-state-helpers.js'
import * as LayerLogic from './scene-state-layer-logic.js'
import * as LookLogic from './scene-state-look-logic.js'

export function sceneStateCopyLayerStyle(self, sceneId, layerIndex) {
	const l = self.getScene(sceneId)?.layers?.[layerIndex]
	if (!l) return false
	self._layerStyleClipboard = LayerLogic.getLayerStyleDataFromLayer(l)
	return true
}

export function sceneStateSaveLayerPresetFromLayer(self, sceneId, layerIndex, name) {
	const l = self.getScene(sceneId)?.layers?.[layerIndex]
	if (!l || !String(name || '').trim()) return null
	const id = newId()
	self.layerPresets.push({ id, name: LayerLogic.uniqueLayerPresetName(self.layerPresets, name.trim()), data: LayerLogic.getLayerStyleDataFromLayer(l) })
	self._save()
	return id
}

export function sceneStatePasteLayerStyle(self, sceneId, layerIndex) {
	const L = self.getScene(sceneId)?.layers?.[layerIndex]
	if (!L || !self._layerStyleClipboard) return false
	LayerLogic.applyLayerStyleData(L, self._layerStyleClipboard)
	self._softSave()
	return true
}

export function sceneStateApplyLayerPresetToLayer(self, sceneId, layerIndex, presetId) {
	const p = self.layerPresets.find((x) => x.id === presetId)
	const L = self.getScene(sceneId)?.layers?.[layerIndex]
	if (!p?.data || !L) return false
	LayerLogic.applyLayerStyleData(L, p.data)
	self._softSave()
	return true
}

export function sceneStateRemoveLayerPreset(self, presetId) {
	const i = self.layerPresets.findIndex((p) => p.id === presetId)
	if (i < 0) return false
	self.layerPresets.splice(i, 1)
	self._save()
	return true
}

export function sceneStateSaveLookPreset(self, name, sourceKind) {
	const nameTrim = String(name || '').trim()
	if (!nameTrim) return null

	const items = []
	const targets = self.armedScreenIndices?.length ? self.armedScreenIndices : [self.activeScreenIndex]
	targets.forEach((idx) => {
		const sceneId = sourceKind === 'prv' ? self.previewSceneIdByMain[idx] : (sourceKind === 'pgm' ? self.liveSceneIdByMain[idx] : (sourceKind === 'editing' ? self.editingSceneId : null))
		if (sceneId && self.getScene(sceneId)) {
			items.push({ mainIdx: idx, sceneId, sourceKind })
		}
	})

	if (items.length === 0) return null

	const id = newId()
	const legacyFallback = items[0]
	self.lookPresets.push({
		id,
		name: LookLogic.uniqueLookPresetName(self.lookPresets, nameTrim),
		createdAt: Date.now(),
		items,
		sceneId: legacyFallback.sceneId,
		sourceKind: legacyFallback.sourceKind,
		targetMain: legacyFallback.mainIdx,
	})
	self._save()
	return id
}

export function sceneStateOverwriteLookPreset(self, presetId) {
	const p = self.lookPresets.find((x) => x.id === presetId)
	if (!p) return false
	const sourceKind = p.sourceKind || 'prv'

	const items = []
	const targets = self.armedScreenIndices?.length ? self.armedScreenIndices : [self.activeScreenIndex]
	targets.forEach((idx) => {
		const sceneId = sourceKind === 'prv' ? self.previewSceneIdByMain[idx] : (sourceKind === 'pgm' ? self.liveSceneIdByMain[idx] : (sourceKind === 'editing' ? self.editingSceneId : null))
		if (sceneId && self.getScene(sceneId)) {
			items.push({ mainIdx: idx, sceneId, sourceKind })
		}
	})

	if (items.length === 0) return false

	const legacyFallback = items[0]
	p.items = items
	p.sceneId = legacyFallback.sceneId
	p.sourceKind = legacyFallback.sourceKind
	p.targetMain = legacyFallback.mainIdx
	p.createdAt = Date.now()

	self._save()
	return true
}

export function sceneStateRemoveLookPreset(self, presetId) {
	const i = self.lookPresets.findIndex((p) => p.id === presetId)
	if (i < 0) return false
	self.lookPresets.splice(i, 1)
	self._save()
	return true
}

export function sceneStatePatchLookPreset(self, lookPresetId, patch) {
	const i = self.lookPresets.findIndex((p) => p.id === lookPresetId)
	if (i < 0) return false
	if (patch?.tandem === null) {
		const { tandem: _t, ...rest } = patch
		self.lookPresets[i] = { ...self.lookPresets[i], ...rest }
		delete self.lookPresets[i].tandem
	} else {
		self.lookPresets[i] = { ...self.lookPresets[i], ...patch }
	}
	self._save()
	return true
}

export function sceneStateImportLayerPresetsFromServer(self, list) {
	const next = LayerLogic.importLayerPresetsFromServer(self.layerPresets, list)
	if (!next) return false
	self.layerPresets = next
	self._save()
	return true
}

export function sceneStateImportLookPresetsFromServer(self, list) {
	const next = LookLogic.importLookPresetsFromServer(list)
	if (!next) return false
	self.lookPresets = next
	self._save()
	return true
}
