/**
 * Scene state — layer stack mutations (mixed into SceneState).
 */

import {
	defaultTransition,
	defaultLayerConfig,
	nextLayerNumber,
	LOOK_FULL_MESSAGE,
	LOOK_LAYER_FIRST,
	LOOK_LAYER_STEP,
} from './scene-state-helpers.js'
import { showAppToast } from './app-toast.js'
import { applySceneLayerDefaults } from './editor-defaults.js'
import * as LayerLogic from './scene-state-layer-logic.js'

/** @param {import('./scene-state.js').SceneState} SceneStateClass */
export function mixinSceneStateLayerOps(SceneStateClass) {
	Object.assign(SceneStateClass.prototype, {
		/** WO-160: lowest free number ≥ 10, or -1 when the look is full (see scene-state-helpers.js). */
		nextLayerNumber(scene) {
			return nextLayerNumber(scene)
		},

		addLayer(sceneId) {
			const s = this.getScene(sceneId)
			if (!s) return -1
			const n = this.nextLayerNumber(s)
			if (n < 0) {
				try {
					showAppToast(LOOK_FULL_MESSAGE, 'warn')
				} catch {
					/* non-DOM context (tests) */
				}
				return -1
			}
			const layer = defaultLayerConfig(n)
			applySceneLayerDefaults(layer)
			s.layers.push(layer)
			this._save()
			return s.layers.length - 1
		},

		removeLayer(sceneId, layerIndex) {
			const s = this.getScene(sceneId)
			if (s && layerIndex >= 0 && layerIndex < s.layers.length) {
				s.layers.splice(layerIndex, 1)
				this._save()
			}
		},

		reorderLayers(sceneId, fromVisualIndex, toVisualIndex) {
			const s = this.getScene(sceneId)
			if (!s?.layers?.length) return
			const next = LayerLogic.reorderLayers(
				s.layers,
				fromVisualIndex,
				toVisualIndex,
				LOOK_LAYER_FIRST,
				LOOK_LAYER_STEP,
			)
			if (next) {
				s.layers = next
				this._save()
			}
		},

		setLayerSource(sceneId, layerIndex, source) {
			const s = this.getScene(sceneId)
			const L = s?.layers?.[layerIndex]
			if (!L) return
			L.source = source
			if (source?.value && /\.(jpe?g|png|gif|bmp|webp|tiff?)$/i.test(String(source.value))) L.loop = false
			this._save()
		},

		patchLayer(sceneId, layerIndex, patch) {
			const L = this.getScene(sceneId)?.layers?.[layerIndex]
			if (L) {
				LayerLogic.patchLayer(L, patch)
				this._softSave()
			}
		},

		setDefaultTransition(sceneId, t) {
			const s = this.getScene(sceneId)
			if (s) {
				s.defaultTransition = { ...defaultTransition(), ...s.defaultTransition, ...t }
				this._softSave()
			}
		},
	})
}
