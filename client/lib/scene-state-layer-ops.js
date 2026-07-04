/**
 * Scene state — layer stack mutations (mixed into SceneState).
 */

import { defaultTransition, defaultLayerConfig, LOOK_LAYER_FIRST, LOOK_LAYER_STEP } from './scene-state-helpers.js'
import { applySceneLayerDefaults } from './editor-defaults.js'
import * as LayerLogic from './scene-state-layer-logic.js'

/** @param {import('./scene-state.js').SceneState} SceneStateClass */
export function mixinSceneStateLayerOps(SceneStateClass) {
	Object.assign(SceneStateClass.prototype, {
		nextLayerNumber(scene) {
			const used = new Set(
				(scene.layers || [])
					.map((l) => Number(l.layerNumber))
					.filter((n) => Number.isFinite(n) && n >= LOOK_LAYER_FIRST && n % LOOK_LAYER_STEP === 0),
			)
			let c = LOOK_LAYER_FIRST
			while (used.has(c)) c += LOOK_LAYER_STEP
			return c
		},

		addLayer(sceneId) {
			const s = this.getScene(sceneId)
			if (!s) return -1
			const layer = defaultLayerConfig(this.nextLayerNumber(s))
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
