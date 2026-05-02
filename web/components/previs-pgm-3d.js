/**
 * Previs PGM 3D overlay (WO-17, keystone component).
 *
 * Mounts inside the PGM compose cell of the preview panel and, on demand, replaces the flat
 * WebRTC `<video>` view with a vanilla-Three.js scene that maps the PGM feed as a live
 * `VideoTexture` onto screen surfaces within a 3D stage model.
 *
 * Responsibilities (kept intentionally narrow — scene + textures + meshes live in
 * peer `web/lib/previs-*.js` modules, not here):
 *   - Dynamically loads `three` + `OrbitControls` on first activation (zero cost until the
 *     user clicks the 2D/3D toggle — critical for non-previs boots).
 *   - Renders a 2D/3D toggle button onto the PGM cell and wires the state transitions.
 *   - Binds the PGM `<video>` element to a `THREE.VideoTexture` via `previs-video-texture`
 *     and falls back to a solid placeholder when the stream isn't ready.
 *   - Calls the host's `onExpand(active)` callback so the host can grow the PGM cell to
 *     full width when 3D is active (per WO-17: "auto-expands the PGM space").
 *   - Runs a render loop on `requestAnimationFrame` while visible; pauses via
 *     `IntersectionObserver` + `document.visibilityState` to save GPU when hidden.
 *
 * Not yet implemented here (follow-on WO-17 tasks, tracked by TODOs):
 *   - Loading a user-supplied glTF/GLB model and tagging its screen meshes. Current demo
 *     shows a single flat plane so we can verify the video-texture chain end-to-end.
 *   - Per-panel (irregular) screen rendering via `computePanelUV`.
 *   - LED-grid overlay and calibration markers.
 *
 * Architecture note: the component exposes a small imperative API (`mount`, `destroy`,
 * `setActive`) rather than returning a DOM node — so it can be embedded by the existing
 * `preview-canvas-panel.js` without a framework-level rewrite.
 *
 * See `work/17_WO_3D_PREVIS.md` and `docs/MODULES.md` for the full port plan.
 */

import { createPrevisScene } from '../lib/previs-scene.js'
import { findPgmVideoElement, findPrvVideoElement } from '../lib/previs-video-texture.js'
import { createPrevisStreamManager } from '../lib/previs-stream-sources.js'
import { createPrevisSceneModel } from '../lib/previs-scene-model.js'
import { getSharedPrevisState, PREVIS_STATE_EVENTS, videoTextureMaxToLongEdge } from '../lib/previs-state.js'
import { createPrevisPgm3dToolbar } from './previs-pgm-3d-toolbar.js'
import { createPrevisPgm3dInspectorBinder } from './previs-pgm-3d-inspector-binder.js'
import { createPrevisPgm3dKeyboard } from './previs-pgm-3d-keyboard.js'
import { createPrevisPgm3dDropzone } from './previs-pgm-3d-dropzone.js'

const PGM_MODE_EVENT = 'previs:pgm-mode-changed'

/**
 * @typedef {Object} PrevisPgm3dOptions
 * @property {HTMLElement} cellEl              The PGM compose cell (`.preview-panel__compose-cell--pgm`).
 * @property {HTMLElement} [videoContainerEl] Element holding the PGM `<video>`. Defaults to the standard selector inside `cellEl`.
 * @property {(active: boolean) => void} [onExpand]
 *   Called with `true` when 3D is activated, `false` when returning to 2D. The host is
 *   expected to resize the PGM cell (e.g. hide PRV, grow the gutter).
 * @property {(level: 'log' | 'warn' | 'error', msg: string, ...extra: any[]) => void} [log]
 */

/**
 * @typedef {Object} PrevisPgm3dHandle
 * @property {() => void} destroy
 * @property {(active: boolean) => Promise<void>} setActive
 * @property {() => boolean} isActive
 */

const TOGGLE_CLASS = 'previs-pgm-toggle'
const OVERLAY_CLASS = 'previs-pgm-3d-overlay'

/**
 * Create and attach a PGM 3D overlay controller. The toggle button is inserted immediately;
 * the heavy Three.js scene is only built on first activation.
 *
 * @param {PrevisPgm3dOptions} options
 * @returns {PrevisPgm3dHandle}
 */
export function createPrevisPgm3d(options) {
	const log = options.log || makeDefaultLogger()
	const cellEl = options.cellEl
	if (!cellEl) throw new Error('createPrevisPgm3d: cellEl is required')

	const videoContainerEl = options.videoContainerEl
		|| cellEl.querySelector('.preview-panel__video-container[data-preview-webrtc="pgm"]')

	let active = false
	let disposed = false
	/** @type {import('../lib/previs-scene.js').PrevisSceneHandle | null} */
	let sceneHandle = null
	/** @type {ReturnType<typeof createPrevisStreamManager> | null} */
	let streamManager = null
	/** @type {ReturnType<typeof setInterval> | null} */
	let streamRefreshTimer = null
	let overlay = null
	let rafId = 0
	let resizeObs = null
	/** @type {Promise<any> | null} */
	let threeModulePromise = null
	/** @type {import('../lib/previs-scene-model.js').PrevisSceneModelHandle | null} */
	let modelHost = null
	/** @type {ReturnType<typeof createPrevisPgm3dToolbar> | null} */
	let toolbar = null
	/** @type {ReturnType<typeof createPrevisPgm3dInspectorBinder> | null} */
	let inspectorBinder = null
	/** @type {ReturnType<typeof createPrevisPgm3dKeyboard> | null} */
	let keyboardHandle = null
	/** @type {ReturnType<typeof createPrevisPgm3dDropzone> | null} */
	let dropzoneHandle = null
	/** @type {(() => void) | null} */
	let uiSettingsUnsub = null
	/** @type {(() => void) | null} */
	let modelsListUnsub = null
	/** @type {import('../lib/previs-model-loader.js').LoadedModel | null} */
	let currentLoadedModel = null
	const state = getSharedPrevisState()

	const toggleBtn = buildToggleButton()
	cellEl.appendChild(toggleBtn)

	const handle = {
		destroy,
		setActive,
		isActive: () => active,
	}
	return handle

	function buildToggleButton() {
		const btn = document.createElement('button')
		btn.type = 'button'
		btn.className = TOGGLE_CLASS
		btn.textContent = '2D'
		btn.title = 'Toggle PGM 2D / 3D previs'
		btn.setAttribute('aria-pressed', 'false')
		btn.addEventListener('click', () => {
			setActive(!active).catch((err) => log('error', 'previs-pgm-3d toggle failed', err))
		})
		return btn
	}

	async function setActive(next) {
		if (disposed) return
		if (!!next === active) return
		if (next) {
			await enter3D()
		} else {
			exit3D()
		}
	}

	async function enter3D() {
		try {
			await ensureThreeLoaded()
		} catch (err) {
			log('error', 'Failed to load three.js — staying in 2D.', err)
			return
		}
		if (disposed) return

		overlay = document.createElement('div')
		overlay.className = OVERLAY_CLASS
		cellEl.appendChild(overlay)

		const threeMod = await threeModulePromise
		const THREE = threeMod.THREE
		const OrbitControls = threeMod.OrbitControls

		const ui = state.getUI()
		sceneHandle = createPrevisScene(overlay, THREE, { OrbitControls }, {
			backgroundColor: ui.backgroundColor,
			cameraPosition: [0, 3, 8],
			cameraFov: ui.cameraFov,
			ambientIntensity: ui.ambientIntensity,
			directionalIntensity: ui.directionalIntensity,
			pixelRatioCap: ui.pixelRatioCap,
			antialias: ui.antialias,
		})

		streamManager = createPrevisStreamManager(
			THREE,
			[
				{
					id: 'pgm',
					label: 'PGM',
					findVideo: () =>
						(videoContainerEl && videoContainerEl.querySelector('video')) || findPgmVideoElement(),
				},
				{ id: 'prv', label: 'PRV', findVideo: () => findPrvVideoElement() },
			],
			{
				getMaxVideoLongEdge: () => videoTextureMaxToLongEdge(state.getUI().videoTextureMax),
			},
		)

		modelHost = createPrevisSceneModel({
			scene: sceneHandle.scene,
			THREE,
			streamManager,
			defaultSourceId: 'pgm',
			emissive: { intensity: ui.emissiveIntensity },
			getVirtualCanvas: () => ({
				width: state.getUI().virtualCanvasWidth,
				height: state.getUI().virtualCanvasHeight,
			}),
			onScreenBound: (mesh, info) => {
				const src = info.tagSource
				const name = (mesh && mesh.name) || '(unnamed)'
				log('log', `[previs-pgm-3d] screen bound → ${name} (source=${src})`)
				if (toolbar && src === 'auto') toolbar.setStatus(`auto-bound: ${name}`)
				if (inspectorBinder) inspectorBinder.refresh()
			},
		})

		inspectorBinder = createPrevisPgm3dInspectorBinder({
			overlay,
			state,
			modelHost,
			sceneHandle,
			threeMod,
			log,
			getCurrentModel: () => currentLoadedModel,
			setCurrentModel: (m) => { currentLoadedModel = m },
			getAvailableSources: () => streamManager.listSources(),
			getStreamStatuses: () => (streamManager ? streamManager.getStreamStatuses() : []),
		})

		attachToolbar()

		uiSettingsUnsub = state.on(PREVIS_STATE_EVENTS.UI, applyRuntimeSceneSettings)
		modelsListUnsub = state.on(PREVIS_STATE_EVENTS.CHANGE, syncToolbarSavedModels)
		applyRuntimeSceneSettings()
		syncToolbarSavedModels()

		keyboardHandle = createPrevisPgm3dKeyboard({
			overlay,
			sceneHandle,
			modelHost,
			state,
			THREE,
			log,
		})

		resizeObs = new ResizeObserver(() => {
			if (!sceneHandle || !overlay) return
			sceneHandle.resize(overlay.clientWidth, overlay.clientHeight)
		})
		resizeObs.observe(overlay)

		active = true
		toggleBtn.textContent = '3D'
		toggleBtn.setAttribute('aria-pressed', 'true')
		if (options.onExpand) {
			try { options.onExpand(true) } catch (err) { log('warn', 'onExpand(true) threw', err) }
		}
		emitModeChanged(true)

		streamRefreshTimer = setInterval(() => {
			if (streamManager) streamManager.refreshVideoSources()
			if (inspectorBinder && typeof inspectorBinder.refreshPipeline === 'function') {
				try { inspectorBinder.refreshPipeline() } catch (err) {
					log('warn', '[previs-pgm-3d] refreshPipeline failed', err)
				}
			}
			if (inspectorBinder && typeof inspectorBinder.refreshMapping === 'function') {
				try { inspectorBinder.refreshMapping() } catch (err) {
					log('warn', '[previs-pgm-3d] refreshMapping failed', err)
				}
			}
		}, 1000)

		try { overlay.focus({ preventScroll: true }) } catch {}

		scheduleRender()
	}

	function exit3D() {
		cancelRender()
		if (streamRefreshTimer) {
			clearInterval(streamRefreshTimer)
			streamRefreshTimer = null
		}
		if (resizeObs) {
			try { resizeObs.disconnect() } catch {}
			resizeObs = null
		}
		if (keyboardHandle) {
			keyboardHandle.dispose()
			keyboardHandle = null
		}
		if (dropzoneHandle) {
			dropzoneHandle.dispose()
			dropzoneHandle = null
		}
		if (toolbar) {
			toolbar.destroy()
			toolbar = null
		}
		if (uiSettingsUnsub) {
			try { uiSettingsUnsub() } catch {}
			uiSettingsUnsub = null
		}
		if (modelsListUnsub) {
			try { modelsListUnsub() } catch {}
			modelsListUnsub = null
		}
		if (inspectorBinder) {
			inspectorBinder.dispose()
			inspectorBinder = null
		}
		if (modelHost) {
			modelHost.dispose()
			modelHost = null
		}
		currentLoadedModel = null
		if (streamManager) {
			streamManager.dispose()
			streamManager = null
		}
		if (sceneHandle) {
			sceneHandle.dispose()
			sceneHandle = null
		}
		if (overlay && overlay.parentNode === cellEl) {
			cellEl.removeChild(overlay)
		}
		overlay = null
		active = false
		toggleBtn.textContent = '2D'
		toggleBtn.setAttribute('aria-pressed', 'false')
		if (options.onExpand) {
			try { options.onExpand(false) } catch (err) { log('warn', 'onExpand(false) threw', err) }
		}
		emitModeChanged(false)
	}

	/**
	 * Broadcast a `previs:pgm-mode-changed` CustomEvent on `document` so external consumers
	 * (WO-19 tracking HUD, WO-31 auto-follow, future overlays) can react without a hard
	 * dependency on the previs module. Fired AFTER all internal state transitions complete.
	 *
	 * @param {boolean} isActive
	 */
	function emitModeChanged(isActive) {
		try {
			document.dispatchEvent(new CustomEvent(PGM_MODE_EVENT, {
				detail: { active: !!isActive, at: Date.now() },
			}))
		} catch (err) {
			log('warn', '[previs-pgm-3d] failed to dispatch pgm-mode-changed', err)
		}
	}

	function scheduleRender() {
		if (!active || disposed) return
		rafId = requestAnimationFrame(tick)
	}

	function tick() {
		if (!active || disposed) return
		if (streamManager) streamManager.tick()
		if (sceneHandle) sceneHandle.render()
		rafId = requestAnimationFrame(tick)
	}

	function cancelRender() {
		if (rafId) cancelAnimationFrame(rafId)
		rafId = 0
	}

	function ensureThreeLoaded() {
		if (threeModulePromise) return threeModulePromise
		// Resolved via the importmap in `web/index.html` → served by the previs vendor
		// mount (`index.js::buildVendorDirs`) from `node_modules/three/*`. If previs isn't
		// installed, the import throws and the toggle quietly declines to activate.
		threeModulePromise = (async () => {
			const THREE = await import('three')
			let OrbitControls = null
			try {
				const oc = await import('three/addons/controls/OrbitControls.js')
				OrbitControls = oc.OrbitControls
			} catch (err) {
				log('warn', '[previs-pgm-3d] OrbitControls import failed — camera will be fixed.', err && err.message)
			}
			let GLTFLoader = null
			try {
				const gl = await import('three/addons/loaders/GLTFLoader.js')
				GLTFLoader = gl.GLTFLoader
			} catch (err) {
				log('warn', '[previs-pgm-3d] GLTFLoader import failed — model import will be disabled.', err && err.message)
			}
			return { THREE, OrbitControls, GLTFLoader }
		})()
		return threeModulePromise
	}

	function destroy() {
		if (disposed) return
		disposed = true
		if (active) exit3D()
		if (toggleBtn.parentNode) toggleBtn.parentNode.removeChild(toggleBtn)
	}

	function attachToolbar() {
		dropzoneHandle = createPrevisPgm3dDropzone({
			overlay,
			getToolbar: () => toolbar,
			getModelHost: () => modelHost,
			getThreeModulePromise: () => threeModulePromise,
			getInspectorBinder: () => inspectorBinder,
			state,
			setCurrentModel: (m) => { currentLoadedModel = m },
			log,
		})
		toolbar = createPrevisPgm3dToolbar({
			onFileChosen: dropzoneHandle.onFileChosen,
			onClear: dropzoneHandle.onClearModel,
			getStateSnapshot: () => state.getSnapshot(),
			onPickSavedModel: (id) => {
				if (inspectorBinder && typeof inspectorBinder.loadSavedModelById === 'function') {
					Promise.resolve(inspectorBinder.loadSavedModelById(id)).catch((err) => {
						log('warn', '[previs-pgm-3d] load saved model from toolbar failed', err)
					})
				}
			},
		})
		overlay.appendChild(toolbar.toolbarEl)
		overlay.appendChild(toolbar.dropzoneEl)
	}

	function applyRuntimeSceneSettings() {
		if (!active || !sceneHandle) return
		const u = state.getUI()
		if (typeof sceneHandle.applySettings === 'function') {
			sceneHandle.applySettings({
				backgroundColor: u.backgroundColor,
				ambientIntensity: u.ambientIntensity,
				directionalIntensity: u.directionalIntensity,
				pixelRatioCap: u.pixelRatioCap,
				cameraFov: u.cameraFov,
			})
		}
		if (modelHost && typeof modelHost.setEmissiveIntensity === 'function') {
			modelHost.setEmissiveIntensity(u.emissiveIntensity)
		}
		if (modelHost && typeof modelHost.refreshTextureCrop === 'function') {
			modelHost.refreshTextureCrop()
		}
		try {
			document.dispatchEvent(new CustomEvent('previs:set-prv-pct', { detail: { value: u.prvFractionWhen3d } }))
		} catch (err) {
			log('warn', '[previs-pgm-3d] set-prv-pct dispatch failed', err)
		}
	}

	function syncToolbarSavedModels() {
		if (toolbar && typeof toolbar.syncSavedModelSelect === 'function') toolbar.syncSavedModelSelect()
	}
}

function makeDefaultLogger() {
	return function log(level, msg, ...extra) {
		const fn = (console[level] || console.log).bind(console)
		fn(msg, ...extra)
	}
}
