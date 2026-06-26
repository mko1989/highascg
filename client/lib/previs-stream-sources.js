/**
 * Previs stream-source manager (WO-17 Phase 4 / T3.1 multi-source).
 *
 * Owns one `VideoTextureBinding` per distinct "source" (PGM, PRV, Channel N, …) and
 * shares it across every mesh that maps that source. Reference-counted: the binding is
 * disposed when the last consumer releases it.
 *
 * Why a manager:
 *   - Multiple meshes may want PGM mapped simultaneously (e.g. an LED wall + a side
 *     monitor prop). Creating a fresh `VideoTexture` per mesh would cause N redundant
 *     GPU uploads per frame — sharing one keeps cost flat.
 *   - PRV / channel sources need the same placeholder → live-upgrade probe logic as PGM;
 *     consolidating into one factory avoids duplicating that lifecycle per caller.
 *   - The source registry is defined once (usually in the keystone component) and passed
 *     in — per-source `findVideo()` lookups keep the manager decoupled from the DOM.
 *
 * This file does NOT know about meshes, materials, or Three.js scene graphs. Scene-model
 * code (`previs-scene-model.js`) asks for a binding, wires it to a material, and releases
 * it on tag removal.
 */

import { createPgmVideoTexture } from './previs-video-texture.js'

/**
 * @typedef {Object} PrevisStreamSource
 * @property {string} id                             Stable id used as the tag `.source` value.
 * @property {string} label                          Display label for inspector dropdowns.
 * @property {() => HTMLVideoElement | null} findVideo
 *   Look up the current `<video>` element for this source. Called lazily at acquire time
 *   and on `refreshVideoSources()` so late-mounted preview panels are picked up.
 */

/**
 * @typedef {Object} PrevisStreamManagerHandle
 * @property {(sourceId: string) => (import('./previs-video-texture.js').VideoTextureBinding | null)} acquire
 *   Get (or lazily create) a binding for the given source. Returns `null` if the source
 *   id isn't registered. Each call bumps the refcount — pair every `acquire()` with
 *   exactly one `release()`.
 * @property {(sourceId: string) => void} release
 *   Decrement refcount. When it hits zero the binding is disposed and removed.
 * @property {() => void} refreshVideoSources
 *   Re-run `findVideo()` on every live binding. Call after the host DOM (PGM/PRV cells)
 *   is known to have remounted.
 * @property {() => Array<{ id: string, label: string }>} listSources
 *   Snapshot of all registered sources — feed directly into inspector `<select>` rows.
 * @property {() => void} dispose
 *   Release every binding and clear the registry. Idempotent.
 * @property {() => void} tick
 *   Forward to each binding's `tick()` (canvas downscale path when capped).
 * @property {() => Array<{ id: string, label: string, live: boolean, acquired: boolean }>} getStreamStatuses
 *   Snapshot of registered sources vs active bindings (for inspector pipeline UI).
 */

/**
 * @param {typeof import('three')} THREE
 * @param {ReadonlyArray<PrevisStreamSource>} sources
 * @param {{ getMaxVideoLongEdge?: () => number }} [opts]
 * @returns {PrevisStreamManagerHandle}
 */
export function createPrevisStreamManager(THREE, sources, opts) {
	if (!THREE) throw new Error('createPrevisStreamManager: THREE required')
	const options = opts || {}
	const getMaxVideoLongEdge = typeof options.getMaxVideoLongEdge === 'function' ? options.getMaxVideoLongEdge : () => 0
	/** @type {Map<string, PrevisStreamSource>} */
	const sourceMap = new Map()
	for (const s of sources || []) {
		if (!s || !s.id) continue
		sourceMap.set(s.id, s)
	}

	/** @type {Map<string, { binding: import('./previs-video-texture.js').VideoTextureBinding, refCount: number }>} */
	const bindings = new Map()
	let disposed = false

	function acquire(sourceId) {
		if (disposed) return null
		const src = sourceMap.get(sourceId)
		if (!src) return null
		let entry = bindings.get(sourceId)
		if (!entry) {
			const videoEl = src.findVideo ? src.findVideo() : null
			const binding = createPgmVideoTexture(videoEl, THREE, { getMaxVideoLongEdge })
			entry = { binding, refCount: 0 }
			bindings.set(sourceId, entry)
		}
		entry.refCount++
		return entry.binding
	}

	function release(sourceId) {
		const entry = bindings.get(sourceId)
		if (!entry) return
		entry.refCount--
		if (entry.refCount <= 0) {
			try { entry.binding.dispose() } catch (err) { console.warn('[previs-stream] dispose threw', err) }
			bindings.delete(sourceId)
		}
	}

	function refreshVideoSources() {
		if (disposed) return
		for (const [id, entry] of bindings.entries()) {
			const src = sourceMap.get(id)
			if (!src || !src.findVideo) continue
			try { entry.binding.setSource(src.findVideo()) } catch (err) { console.warn('[previs-stream] setSource threw', err) }
		}
	}

	function listSources() {
		return Array.from(sourceMap.values()).map((s) => ({ id: s.id, label: s.label }))
	}

	function tick() {
		if (disposed) return
		for (const entry of bindings.values()) {
			try {
				if (entry.binding && typeof entry.binding.tick === 'function') entry.binding.tick()
			} catch (err) {
				console.warn('[previs-stream] tick threw', err)
			}
		}
	}

	function getStreamStatuses() {
		return Array.from(sourceMap.values()).map((s) => {
			const entry = bindings.get(s.id)
			return {
				id: s.id,
				label: s.label,
				live: entry ? !!entry.binding.isLive : false,
				acquired: !!entry,
			}
		})
	}

	function dispose() {
		if (disposed) return
		disposed = true
		for (const entry of bindings.values()) {
			try { entry.binding.dispose() } catch {}
		}
		bindings.clear()
	}

	return { acquire, release, refreshVideoSources, listSources, dispose, tick, getStreamStatuses }
}
