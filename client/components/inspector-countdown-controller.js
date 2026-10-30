/**
 * Countdown inspector — local config persistence, cross-layer propagation, and debounced CG
 * UPDATE. Split out of inspector-countdown.js (see that file's header for the WO-169/WO-196/
 * WO-208 context this logic serves).
 */

import { api } from '../lib/api-client.js'
import { sceneState } from '../lib/scene-state.js'
import { resolveLookStackChannelForBus, resolveMainIndexForScene } from '../lib/look-stack-amcp-channel.js'

/** Debounced CG UPDATE from inspector edits (ms) — matches lower-third's cadence. */
export const COUNTDOWN_CG_UPDATE_DEBOUNCE_MS = 450

/**
 * @param {object} opts
 * @param {HTMLElement} opts.grp
 * @param {object} opts.cfg
 * @param {HTMLSelectElement} opts.modeSelect
 * @param {string} opts.sceneId
 * @param {number} opts.layerIndex
 * @param {object} opts.layer
 * @param {object} opts.src
 * @param {object} opts.stateStore
 * @param {string} opts.timerId
 */
export function createCountdownFieldController({ grp, cfg, modeSelect, sceneId, layerIndex, layer, src, stateStore, timerId }) {
	let cgUpdateTimer = null
	let cgUpdateInFlight = false
	let cgUpdateQueued = false
	let propagateTimer = null
	let propagateInFlight = false

	/**
	 * Same routing as inspector-lower-third.js's getRouting(): the mapped preview/edit bus
	 * channel for this look's main + the layer's logical layerNumber. `templateHostLayer` is
	 * pinned to 0 to match the CG sub-layer scene take always ADDs template layers at (see
	 * module header) — NOT the 1 that routes-lower-thirds.js's separate standalone flow uses.
	 */
	function getRouting() {
		const cm = stateStore?.getState?.()?.channelMap || {}
		const scene = sceneState.getScene(sceneId)
		const mIdx = resolveMainIndexForScene(scene, sceneState)
		const targetCh =
			resolveLookStackChannelForBus(cm, sceneState, scene, 'edit', mIdx) ??
			Number(cm.programChannels?.[mIdx] ?? cm.playbackChannels?.[mIdx])
		if (!Number.isFinite(targetCh) || targetCh <= 0) {
			console.warn('[countdown] No Caspar channel for main', mIdx + 1)
		}
		return {
			channel: Number.isFinite(targetCh) && targetCh > 0 ? targetCh : Number(cm.programChannels?.[0] ?? 1),
			layer: layer.layerNumber || 10,
			templateHostLayer: 0,
		}
	}

	/**
	 * The inspector-rendered fields only (WO-844: NOT a complete config — see getCurrentConfig). A control that does
	 * not exist (`#cd-duration` is an HMS input, not an id) yields NO key rather than a stale `cfg` copy, so it cannot
	 * overwrite a newer stored value.
	 */
	function readRenderedFields() {
		const val = (sel) => grp.querySelector(sel)?.value
		const num = (sel) => {
			const n = parseFloat(String(val(sel)))
			return Number.isFinite(n) ? n : undefined
		}
		const hide = grp.querySelector('#cd-hide-timer')
		const out = {
			mode: modeSelect.value || undefined,
			durationSec: num('#cd-duration'),
			targetTime: val('#cd-target'),
			format: val('#cd-format'),
			amberThresholdSec: num('#cd-amber'),
			redThresholdSec: num('#cd-red'),
			position: val('#cd-position'),
			hideTimer: hide ? !!hide.checked : undefined,
			timerFontSize: num('#cd-timer-size'),
			auxFontSize: num('#cd-aux-size'),
			timerColor: val('#cd-color-normal'),
			amberColor: val('#cd-color-amber'),
			redColor: val('#cd-color-red'),
			auxColor: val('#cd-color-aux'),
			auxTop: val('#cd-auxTop'),
			auxMiddle: val('#cd-auxMiddle'),
			auxBottom: val('#cd-auxBottom'),
		}
		for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]
		return out
	}

	/**
	 * WO-844: the full countdown config = the stored config (layer + timer instance, so keys this inspector does not
	 * render — posX/posY, timerFontFamily, border — survive) overlaid with the rendered fields and the just-edited
	 * `partial`. It used to be the 17 rendered keys only, and persistLocalConfig replaced the layer, cgData and
	 * timer.config wholesale with it: a Position px edit never persisted (WO-320A) and any font/border set from the
	 * timer panel was wiped by the next edit here.
	 */
	function getCurrentConfig(partial) {
		const scene = sceneState.getScene(sceneId)
		const stored = scene?.layers?.[layerIndex]?.source?.countdownConfig
		const timer = timerId ? sceneState.getTimer(timerId) : null
		return { ...cfg, ...(stored || {}), ...(timer?.config || {}), ...readRenderedFields(), ...(partial || {}) }
	}

	/**
	 * Mirrors inspector-lower-third.js's persistLocalConfig: keeps a structured, inspector-
	 * facing `source.countdownConfig` AND a flat `layer.cgData` (the key extractTemplateCgData
	 * actually reads — src/engine/scene-template-cg.js:71 — so scene take's CG ADD/UPDATE carries
	 * the configured countdown, not `{}`).
	 * WO-208: also propagate config changes to timer instance and all bound layers.
	 */
	function persistLocalConfig(partial) {
		Object.assign(cfg, partial)
		const scene = sceneState.getScene(sceneId)
		const currentSrc = scene?.layers?.[layerIndex]?.source || src
		const nextConfig = getCurrentConfig(partial)
		sceneState.patchLayer(sceneId, layerIndex, {
			source: { ...currentSrc, countdownConfig: nextConfig },
			cgData: { ...nextConfig },
		})
		// WO-208 T208.2: update timer instance config and propagate to all bound layers
		const timer = sceneState.getTimer(timerId)
		if (timer) {
			timer.config = { ...(timer.config || {}), ...nextConfig }
			sceneState._save()
			queueConfigPropagation()
		}
		document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
	}

	function queueConfigPropagation() {
		if (propagateTimer) clearTimeout(propagateTimer)
		propagateTimer = setTimeout(() => {
			propagateTimer = null
			propagateConfigToBoundLayers()
		}, COUNTDOWN_CG_UPDATE_DEBOUNCE_MS)
	}

	async function propagateConfigToBoundLayers() {
		if (propagateInFlight) return
		propagateInFlight = true
		try {
			const bound = sceneState.findBoundLayers(timerId)
			const nextConfig = getCurrentConfig()
			for (const { sceneId: bSceneId, layerIndex: bIdx } of bound) {
				if (bSceneId === sceneId && bIdx === layerIndex) continue // Skip self
				const bLayer = sceneState.getScene(bSceneId)?.layers?.[bIdx]
				if (bLayer?.source) {
					sceneState.patchLayer(bSceneId, bIdx, {
						source: { ...bLayer.source, countdownConfig: { ...(bLayer.source.countdownConfig || {}), ...nextConfig } },
						cgData: { ...nextConfig },
					})
				}
			}
		} catch (err) {
			console.warn('[countdown] propagation failed:', err?.message || err)
		} finally {
			propagateInFlight = false
		}
	}

	function onFieldChange(partial) {
		persistLocalConfig(partial)
		queueCgUpdate()
	}

	function queueCgUpdate() {
		if (cgUpdateTimer) clearTimeout(cgUpdateTimer)
		cgUpdateTimer = setTimeout(() => {
			cgUpdateTimer = null
			flushCgUpdate()
		}, COUNTDOWN_CG_UPDATE_DEBOUNCE_MS)
	}

	async function flushCgUpdate() {
		if (cgUpdateInFlight) {
			cgUpdateQueued = true
			return
		}
		cgUpdateInFlight = true
		try {
			await api.post('/api/countdown/set', { ...getRouting(), ...getCurrentConfig() })
		} catch (err) {
			console.warn('[countdown] auto-update failed:', err?.message || err)
		} finally {
			cgUpdateInFlight = false
			if (cgUpdateQueued) {
				cgUpdateQueued = false
				await flushCgUpdate()
			}
		}
	}

	function clearPendingCgUpdate() {
		if (cgUpdateTimer) clearTimeout(cgUpdateTimer)
	}

	return { onFieldChange, flushCgUpdate, getRouting, clearPendingCgUpdate }
}
