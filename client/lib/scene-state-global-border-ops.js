/**
 * Scene state — global border wrapper methods (mixed into SceneState).
 * Extracted from scene-state.js (WO-221 Phase A mechanical split); follows the
 * scene-state-layer-ops.js mixin pattern established in WO-114.
 */

import {
	sceneStateGetGlobalBorderForScreen,
	sceneStateSetGlobalBorderForScreen,
	sceneStateNoteGlobalBorderPushedToPgm,
	sceneStateGetGlobalBorderPresetSlotCount,
	sceneStateSaveGlobalBorderPresetSlot,
	sceneStateDeleteGlobalBorderPresetSlot,
	sceneStateGetGlobalBorderPreset,
	sceneStateSetGlobalBorder,
} from './scene-state-global-border.js'

/** @param {import('./scene-state.js').SceneState} SceneStateClass */
export function mixinSceneStateGlobalBorderOps(SceneStateClass) {
	Object.assign(SceneStateClass.prototype, {
		getGlobalBorderForScreen(screenIdx) {
			return sceneStateGetGlobalBorderForScreen(this, screenIdx)
		},

		setGlobalBorderForScreen(screenIdx, border) {
			sceneStateSetGlobalBorderForScreen(this, screenIdx, border)
		},

		noteGlobalBorderPushedToPgm(screenIdx, slice) {
			sceneStateNoteGlobalBorderPushedToPgm(this, screenIdx, slice)
		},

		getGlobalBorderPresetSlotCount(screenIdx) {
			return sceneStateGetGlobalBorderPresetSlotCount(this, screenIdx)
		},

		saveGlobalBorderPresetSlot(screenIdx, slotNum, name) {
			sceneStateSaveGlobalBorderPresetSlot(this, screenIdx, slotNum, name)
		},

		deleteGlobalBorderPresetSlot(screenIdx, slotNum) {
			sceneStateDeleteGlobalBorderPresetSlot(this, screenIdx, slotNum)
		},

		getGlobalBorderPreset(screenIdx, slotNum) {
			return sceneStateGetGlobalBorderPreset(this, screenIdx, slotNum)
		},

		setGlobalBorder(sceneId, border) {
			sceneStateSetGlobalBorder(this, sceneId, border)
		},
	})
}
