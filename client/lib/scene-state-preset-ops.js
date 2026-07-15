/**
 * Scene state — layer/look preset wrapper methods (mixed into SceneState).
 * Extracted from scene-state.js (WO-221 Phase A mechanical split); follows the
 * scene-state-layer-ops.js mixin pattern established in WO-114.
 */

import {
	sceneStateCopyLayerStyle,
	sceneStateSaveLayerPresetFromLayer,
	sceneStatePasteLayerStyle,
	sceneStateApplyLayerPresetToLayer,
	sceneStateRemoveLayerPreset,
	sceneStateSaveLookPreset,
	sceneStateOverwriteLookPreset,
	sceneStateRemoveLookPreset,
	sceneStatePatchLookPreset,
	sceneStateImportLayerPresetsFromServer,
	sceneStateImportLookPresetsFromServer,
} from './scene-state-preset-actions.js'

/** @param {import('./scene-state.js').SceneState} SceneStateClass */
export function mixinSceneStatePresetOps(SceneStateClass) {
	Object.assign(SceneStateClass.prototype, {
		copyLayerStyle(sceneId, layerIndex) {
			return sceneStateCopyLayerStyle(this, sceneId, layerIndex)
		},

		hasLayerStyleClipboard() { return this._layerStyleClipboard != null },
		getLayerPresets() { return this.layerPresets },

		saveLayerPresetFromLayer(sceneId, layerIndex, name) {
			return sceneStateSaveLayerPresetFromLayer(this, sceneId, layerIndex, name)
		},

		pasteLayerStyle(sceneId, layerIndex) {
			return sceneStatePasteLayerStyle(this, sceneId, layerIndex)
		},

		applyLayerPresetToLayer(sceneId, layerIndex, presetId) {
			return sceneStateApplyLayerPresetToLayer(this, sceneId, layerIndex, presetId)
		},

		removeLayerPreset(presetId) {
			return sceneStateRemoveLayerPreset(this, presetId)
		},

		getLookPresets() { return this.lookPresets },

		saveLookPreset(name, sourceKind) {
			return sceneStateSaveLookPreset(this, name, sourceKind)
		},

		overwriteLookPreset(presetId) {
			return sceneStateOverwriteLookPreset(this, presetId)
		},

		removeLookPreset(presetId) {
			return sceneStateRemoveLookPreset(this, presetId)
		},

		patchLookPreset(lookPresetId, patch) {
			return sceneStatePatchLookPreset(this, lookPresetId, patch)
		},

		importLayerPresetsFromServer(list) {
			return sceneStateImportLayerPresetsFromServer(this, list)
		},

		importLookPresetsFromServer(list) {
			return sceneStateImportLookPresetsFromServer(this, list)
		},
	})
}
