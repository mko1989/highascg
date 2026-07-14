/**
 * Timer instances — project-level named countdown/timer instances reusable across looks (WO-208).
 * Stores `project.timers = [{ id, name, config, canonicalLayerByScreen }]`, persisted like scenes.
 *
 * Timer instances provide:
 * - Named subtimers under the countdown template (draggable into looks)
 * - Auto-created when a countdown layer is first configured
 * - Canonical layer allocation per screen (same screen + layer = one continuous timer across looks)
 * - Config linking: layers bound to a timer read config from the instance; edits propagate to all bound layers
 */

import { newId } from './scene-state-helpers.js'

// Default countdown config — mirrors inspector-countdown.js:DEFAULT_COUNTDOWN_CONFIG
const DEFAULT_TIMER_CONFIG = {
	mode: 'duration',
	durationSec: 300,
	targetTime: '18:00:00',
	format: 'auto',
	amberThresholdSec: 60,
	redThresholdSec: 15,
	position: 'center',
	hideTimer: false,
	timerFontSize: 15,
	auxFontSize: 5,
	timerColor: '#ffffff',
	amberColor: '#ffb300',
	redColor: '#ff3b30',
	auxColor: '#ffffff',
	auxTop: '',
	auxMiddle: '',
	auxBottom: '',
}

/**
 * Create a new timer instance from a countdown layer.
 * @param {object} layer — the countdown layer (has source.countdownConfig)
 * @param {number} mainIdx — the main/screen index
 * @returns {object} new timer { id, name, config, canonicalLayerByScreen }
 */
export function createTimerFromLayer(layer, mainIdx) {
	return {
		id: newId(),
		name: `Timer #${Date.now() % 100}`, // Will be renumbered later
		config: { ...DEFAULT_TIMER_CONFIG, ...(layer?.source?.countdownConfig || {}) },
		canonicalLayerByScreen: mainIdx >= 0 ? { [String(mainIdx)]: layer.layerNumber } : {},
	}
}

/**
 * Get a timer by id.
 * @param {object} sceneState
 * @param {string} id
 * @returns {object | null}
 */
export function getTimer(sceneState, id) {
	if (!sceneState.timers) sceneState.timers = []
	return sceneState.timers.find((t) => t && t.id === id) || null
}

/**
 * Rename a timer instance (updates only the instance; layers already have source.label copied).
 * @param {object} sceneState
 * @param {string} id
 * @param {string} newName
 * @returns {boolean} true if renamed
 */
export function renameTimer(sceneState, id, newName) {
	if (!sceneState.timers) sceneState.timers = []
	const timer = sceneState.timers.find((t) => t && t.id === id)
	if (!timer) return false
	const trimmed = String(newName || '').trim()
	if (!trimmed) return false
	timer.name = trimmed
	return true
}

/**
 * Get or allocate the canonical layer number for a timer on a specific screen.
 * On first use, records the layer number; on reuse, returns the same number.
 * If the layer number is already taken by ANOTHER layer in the look, falls back to next free.
 * @param {object} sceneState
 * @param {string} timerId
 * @param {number} mainIdx — screen index
 * @param {number} preferredNum — desired layer number (usually from first placement)
 * @param {object} scene — the target look (to check for layer conflicts)
 * @returns {{ layerNumber: number, isNewAllocation: boolean, fallback: boolean }}
 */
export function ensureCanonicalLayer(sceneState, timerId, mainIdx, preferredNum, scene) {
	if (!sceneState.timers) sceneState.timers = []
	const timer = sceneState.timers.find((t) => t && t.id === timerId)
	if (!timer) return { layerNumber: preferredNum, isNewAllocation: false, fallback: false }

	const mIdx = String(Math.max(0, Math.min(3, mainIdx)))
	const canon = timer.canonicalLayerByScreen || {}

	// Already allocated for this screen?
	if (canon[mIdx] != null) {
		return { layerNumber: Number(canon[mIdx]), isNewAllocation: false, fallback: false }
	}

	// Check if preferred number is available in the target look
	const usedLayers = new Set((scene?.layers || []).map((l) => Number(l.layerNumber)).filter(Number.isFinite))
	let allocNum = preferredNum
	let fallback = false

	// If preferred is taken, find next free
	if (usedLayers.has(preferredNum)) {
		fallback = true
		for (let n = preferredNum + 1; n <= 99; n++) {
			if (!usedLayers.has(n)) {
				allocNum = n
				break
			}
		}
	}

	// Record the allocation
	timer.canonicalLayerByScreen = { ...canon, [mIdx]: allocNum }
	return { layerNumber: allocNum, isNewAllocation: true, fallback }
}

/**
 * List all timer instances in the project.
 * @param {object} sceneState
 * @returns {Array<object>}
 */
export function listTimers(sceneState) {
	return (sceneState?.timers || []).filter((t) => t && typeof t.id === 'string')
}

/**
 * Compute the set of scenes/layers that reference a given timerId.
 * @param {object} sceneState
 * @param {string} timerId
 * @returns {Array<{ sceneId: string, layerIndex: number, layer: object }>}
 */
export function findBoundLayers(sceneState, timerId) {
	const results = []
	for (const scene of sceneState.scenes || []) {
		if (!scene || !scene.id) continue
		for (let i = 0; i < (scene.layers?.length || 0); i++) {
			const layer = scene.layers[i]
			if (layer?.source?.countdownTimerId === timerId) {
				results.push({ sceneId: scene.id, layerIndex: i, layer })
			}
		}
	}
	return results
}
