/**
 * Scene state — timer instance wrapper methods (mixed into SceneState). WO-208.
 * Extracted from scene-state.js (WO-221 Phase A mechanical split); follows the
 * scene-state-layer-ops.js mixin pattern established in WO-114.
 */

import {
	createTimerFromLayer,
	getTimer,
	renameTimer,
	ensureCanonicalLayer,
	listTimers,
	findBoundLayers,
} from './scene-state-timers.js'

/** @param {import('./scene-state.js').SceneState} SceneStateClass */
export function mixinSceneStateTimerOps(SceneStateClass) {
	Object.assign(SceneStateClass.prototype, {
		createTimer(layer, mainIdx) {
			const timer = createTimerFromLayer(layer, mainIdx)
			this.timers.push(timer)
			this._save()
			return timer
		},

		getTimer(id) {
			return getTimer(this, id)
		},

		renameTimer(id, newName) {
			if (renameTimer(this, id, newName)) {
				this._save()
				return true
			}
			return false
		},

		ensureCanonicalLayer(timerId, mainIdx, preferredNum, scene) {
			return ensureCanonicalLayer(this, timerId, mainIdx, preferredNum, scene)
		},

		listTimers() {
			return listTimers(this)
		},

		findBoundLayers(timerId) {
			return findBoundLayers(this, timerId)
		},
	})
}
