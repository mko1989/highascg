/**
 * Previs video-texture lifecycle (WO-17).
 *
 * Wraps the work of binding a `THREE.VideoTexture` to an existing `<video>` element and
 * cleaning it up safely. The video element is provided by the caller — in HighAsCG that's
 * the WebRTC PGM `<video>` created by `web/lib/webrtc-client.js::createLiveView()`. We do
 * **not** create a second stream; textures share frames with the main PGM preview cell.
 *
 * Fallback ladder (all handled here):
 *   1. Live WebRTC PGM `<video>` with `srcObject` → `THREE.VideoTexture` (no extra cost).
 *   2. Video element not ready (no stream / readyState < HAVE_CURRENT_DATA) → a black
 *      1×1 `DataTexture` placeholder so the 3D scene never shows a flashing "missing
 *      texture" pink. Re-checked on a 500 ms timer until the video becomes usable.
 *   3. Caller disposes → every GPU resource (texture, placeholder) is released.
 *
 * Ported loosely from `work/references/show_creator/ScreenSystem.tsx` (~lines 580-700) —
 * minus the URL-loading path, since we always reuse an existing element.
 */

const PROBE_INTERVAL_MS = 500

/**
 * @typedef {Object} VideoTextureBinding
 * @property {any} texture                         Current live texture — never null.
 * @property {boolean} isLive                      `true` once the video is producing frames.
 * @property {(videoEl: HTMLVideoElement | null) => void} setSource
 *   Swap the source video element at runtime (e.g. when PGM channel changes).
 * @property {(fn: (texture: any) => void) => (() => void)} onTextureChanged
 *   Subscribe to texture swaps — fired whenever `binding.texture` is reassigned
 *   (placeholder → live or live → placeholder). Returns an unsubscribe function.
 *   Materials using this binding should update `material.map` + `material.needsUpdate`.
 * @property {() => void} tick                    Call every animation frame (cheap no-op when uncapped `VideoTexture` path).
 * @property {() => { width: number, height: number } | null} getVideoFrameDimensions
 *   Decoded video size when available (`videoWidth`/`videoHeight`); `null` if no frames yet.
 * @property {() => void} dispose                  Release GPU + timers.
 */

/**
 * Create a video→texture binding that automatically upgrades from placeholder to live
 * texture when the source video becomes playable. Safe to call before the `<video>` has a
 * `srcObject`.
 *
 * @param {HTMLVideoElement | null} initialVideoEl
 * @param {typeof import('three')} THREE
 * @param {{
 *   placeholderColor?: [number, number, number],
 *   onLiveChanged?: (isLive: boolean) => void,
 *   getMaxVideoLongEdge?: () => number,
 * }} [opts]
 *   When `getMaxVideoLongEdge` returns a value &gt; 0, frames are copied to a `CanvasTexture`
 *   at that max long-edge (reduces GPU upload size). `0` keeps the fast `VideoTexture` path.
 * @returns {VideoTextureBinding}
 */
function createPgmVideoTexture(initialVideoEl, THREE, opts) {
	const options = opts || {}
	const color = options.placeholderColor || [0, 0, 0]
	const onLiveChanged = options.onLiveChanged || null
	const getMaxVideoLongEdge = typeof options.getMaxVideoLongEdge === 'function' ? options.getMaxVideoLongEdge : () => 0

	let placeholder = createPlaceholderTexture(THREE, color)
	let liveTexture = null
	/** @type {{ canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D } | null} */
	let canvasBlit = null
	/** @type {HTMLVideoElement | null} */
	let videoEl = null
	/** @type {ReturnType<typeof setInterval> | null} */
	let probeTimer = null
	let isLive = false
	let disposed = false
	/** @type {Set<(texture: any) => void>} */
	const textureListeners = new Set()

	function readCap() {
		try {
			const n = Number(getMaxVideoLongEdge())
			return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
		} catch {
			return 0
		}
	}

	/** Last cap value synced with the live/placeholder path (see `tick` / `setSource`). */
	let lastCapApplied = readCap()

	function onTextureChanged(fn) {
		if (typeof fn !== 'function') return () => {}
		textureListeners.add(fn)
		return () => textureListeners.delete(fn)
	}

	function emitTextureChanged() {
		for (const fn of textureListeners) {
			try { fn(binding.texture) } catch (err) { console.warn('[previs-video-texture] onTextureChanged threw', err) }
		}
	}

	function getVideoFrameDimensions() {
		if (!videoEl) return null
		const width = videoEl.videoWidth
		const height = videoEl.videoHeight
		if (!width || !height) return null
		return { width, height }
	}

	const binding = {
		texture: placeholder,
		isLive: false,
		setSource,
		onTextureChanged,
		tick,
		getVideoFrameDimensions,
		dispose,
	}

	function emitLiveChanged(next) {
		if (next === isLive) return
		isLive = next
		binding.isLive = next
		if (onLiveChanged) {
			try { onLiveChanged(next) } catch (err) { console.warn('[previs-video-texture] onLiveChanged threw', err) }
		}
	}

	function swapToLive() {
		if (!videoEl) return
		if (liveTexture) {
			liveTexture.dispose()
			liveTexture = null
		}
		canvasBlit = null
		const cap = readCap()

		if (!cap) {
			const tex = new THREE.VideoTexture(videoEl)
			tex.colorSpace = THREE.SRGBColorSpace
			tex.minFilter = THREE.LinearFilter
			tex.magFilter = THREE.LinearFilter
			tex.generateMipmaps = false
			liveTexture = tex
			binding.texture = tex
			emitLiveChanged(true)
			emitTextureChanged()
			return
		}

		const vw = videoEl.videoWidth
		const vh = videoEl.videoHeight
		if (!vw || !vh) return

		const { cw, ch } = fitInsideMaxLongEdge(vw, vh, cap)
		const canvas = document.createElement('canvas')
		canvas.width = cw
		canvas.height = ch
		const ctx = canvas.getContext('2d')
		if (!ctx) return
		ctx.drawImage(videoEl, 0, 0, cw, ch)
		const tex = new THREE.CanvasTexture(canvas)
		tex.colorSpace = THREE.SRGBColorSpace
		tex.minFilter = THREE.LinearFilter
		tex.magFilter = THREE.LinearFilter
		tex.generateMipmaps = false
		liveTexture = tex
		canvasBlit = { canvas, ctx }
		binding.texture = tex
		emitLiveChanged(true)
		emitTextureChanged()
	}

	function swapToPlaceholder() {
		if (liveTexture) {
			liveTexture.dispose()
			liveTexture = null
		}
		canvasBlit = null
		binding.texture = placeholder
		emitLiveChanged(false)
		emitTextureChanged()
	}

	/**
	 * Per-frame: refresh canvas downscale when capped; rebuild when `readCap()` changes.
	 */
	function tick() {
		if (disposed) return
		const cap = readCap()
		if (cap !== lastCapApplied) {
			lastCapApplied = cap
			swapToPlaceholder()
			probe()
			return
		}
		if (!cap || !canvasBlit || !liveTexture || !videoEl) return
		if (!videoIsUsable()) return
		const vw = videoEl.videoWidth
		const vh = videoEl.videoHeight
		if (!vw || !vh) return
		const { cw, ch } = fitInsideMaxLongEdge(vw, vh, cap)
		const { canvas, ctx } = canvasBlit
		if (canvas.width !== cw || canvas.height !== ch) {
			canvas.width = cw
			canvas.height = ch
		}
		ctx.drawImage(videoEl, 0, 0, cw, ch)
		liveTexture.needsUpdate = true
	}

	function videoIsUsable() {
		if (!videoEl) return false
		if (!videoEl.srcObject && !videoEl.src) return false
		const HAVE_CURRENT_DATA = 2
		return (videoEl.readyState || 0) >= HAVE_CURRENT_DATA && videoEl.videoWidth > 0 && videoEl.videoHeight > 0
	}

	function probe() {
		if (disposed) return
		const usable = videoIsUsable()
		if (usable && !liveTexture) {
			swapToLive()
		} else if (!usable && liveTexture) {
			swapToPlaceholder()
		}
	}

	function startProbeTimer() {
		if (probeTimer) return
		probeTimer = setInterval(probe, PROBE_INTERVAL_MS)
	}

	function stopProbeTimer() {
		if (!probeTimer) return
		clearInterval(probeTimer)
		probeTimer = null
	}

	function setSource(nextVideoEl) {
		if (disposed) return
		if (nextVideoEl === videoEl) {
			probe()
			return
		}
		videoEl = nextVideoEl
		swapToPlaceholder()
		if (videoEl) {
			probe()
			startProbeTimer()
		} else {
			stopProbeTimer()
		}
		lastCapApplied = readCap()
	}

	function dispose() {
		if (disposed) return
		disposed = true
		stopProbeTimer()
		canvasBlit = null
		if (liveTexture) {
			liveTexture.dispose()
			liveTexture = null
		}
		if (placeholder) {
			placeholder.dispose()
			placeholder = null
		}
		videoEl = null
	}

	setSource(initialVideoEl)
	return binding
}

/**
 * @param {number} w
 * @param {number} h
 * @param {number} maxLongEdge
 * @returns {{ cw: number, ch: number }}
 */
function fitInsideMaxLongEdge(w, h, maxLongEdge) {
	const long = Math.max(w, h)
	if (long <= maxLongEdge) return { cw: w, ch: h }
	const scale = maxLongEdge / long
	return {
		cw: Math.max(1, Math.round(w * scale)),
		ch: Math.max(1, Math.round(h * scale)),
	}
}

/**
 * Build a 1×1 solid-colour `DataTexture` as a safe placeholder. Uses `SRGBColorSpace` to
 * match the video-texture path so swapping is visually consistent.
 *
 * @param {typeof import('three')} THREE
 * @param {[number, number, number]} rgb       0..1 per channel.
 * @returns {any}
 */
function createPlaceholderTexture(THREE, rgb) {
	const data = new Uint8Array([
		Math.round(rgb[0] * 255),
		Math.round(rgb[1] * 255),
		Math.round(rgb[2] * 255),
		255,
	])
	const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
	tex.colorSpace = THREE.SRGBColorSpace
	tex.minFilter = THREE.LinearFilter
	tex.magFilter = THREE.LinearFilter
	tex.needsUpdate = true
	return tex
}

/**
 * Find a WebRTC `<video>` for the given stream name (`'pgm'` or `'prv'`) in the current
 * page. The main UI mounts them into `.preview-panel__video-container[data-preview-
 * webrtc="pgm|prv"]` (see `web/components/preview-canvas-panel.js`). Returns `null` when
 * the preview cell is collapsed or the compose layout isn't active.
 *
 * @param {'pgm' | 'prv'} streamName
 * @param {Document | HTMLElement} [root]
 * @returns {HTMLVideoElement | null}
 */
function findWebrtcVideoElement(streamName, root) {
	const scope = /** @type {any} */ (root || document)
	const container = scope.querySelector(`.preview-panel__video-container[data-preview-webrtc="${streamName}"]`)
	if (!container) return null
	return container.querySelector('video')
}

/** Back-compat wrapper — PGM was the only supported stream before WO-17 Phase 4. */
function findPgmVideoElement(root) {
	return findWebrtcVideoElement('pgm', root)
}

function findPrvVideoElement(root) {
	return findWebrtcVideoElement('prv', root)
}

export {
	createPgmVideoTexture,
	createPlaceholderTexture,
	findWebrtcVideoElement,
	findPgmVideoElement,
	findPrvVideoElement,
	fitInsideMaxLongEdge,
}
