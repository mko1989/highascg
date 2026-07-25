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

	function readNum(raw, fallback) {
		const n = parseFloat(String(raw))
		return Number.isFinite(n) ? n : fallback
	}

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

	function getCurrentConfig() {
		return {
			mode: modeSelect.value || cfg.mode,
			durationSec: readNum(grp.querySelector('#cd-duration')?.value, cfg.durationSec),
			targetTime: grp.querySelector('#cd-target')?.value ?? cfg.targetTime,
			format: grp.querySelector('#cd-format')?.value ?? cfg.format,
			amberThresholdSec: readNum(grp.querySelector('#cd-amber')?.value, cfg.amberThresholdSec),
			redThresholdSec: readNum(grp.querySelector('#cd-red')?.value, cfg.redThresholdSec),
			position: grp.querySelector('#cd-position')?.value ?? cfg.position,
			hideTimer: !!grp.querySelector('#cd-hide-timer')?.checked,
			timerFontSize: readNum(grp.querySelector('#cd-timer-size')?.value, cfg.timerFontSize),
			auxFontSize: readNum(grp.querySelector('#cd-aux-size')?.value, cfg.auxFontSize),
			timerColor: grp.querySelector('#cd-color-normal')?.value ?? cfg.timerColor,
			amberColor: grp.querySelector('#cd-color-amber')?.value ?? cfg.amberColor,
			redColor: grp.querySelector('#cd-color-red')?.value ?? cfg.redColor,
			auxColor: grp.querySelector('#cd-color-aux')?.value ?? cfg.auxColor,
			auxTop: grp.querySelector('#cd-auxTop')?.value ?? cfg.auxTop,
			auxMiddle: grp.querySelector('#cd-auxMiddle')?.value ?? cfg.auxMiddle,
			auxBottom: grp.querySelector('#cd-auxBottom')?.value ?? cfg.auxBottom,
		}
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
		const nextConfig = getCurrentConfig()
		sceneState.patchLayer(sceneId, layerIndex, {
			source: { ...currentSrc, countdownConfig: nextConfig },
			cgData: { ...nextConfig },
		})
		// WO-208 T208.2: update timer instance config and propagate to all bound layers
		const timer = sceneState.getTimer(timerId)
		if (timer) {
			timer.config = { ...nextConfig }
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
						source: { ...bLayer.source, countdownConfig: nextConfig },
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
