/**
 * Previs 3D keyboard shortcuts (WO-17 T4.2).
 *
 * Attaches a focused `keydown` listener on the 3D overlay element. Keys:
 *
 *   1-9       → recall saved camera preset by index (1 = first saved view for the active
 *                 model, skips built-ins). If fewer than N presets exist, the key is a no-op.
 *   F         → frame the currently-selected mesh: fly the camera to a position along the
 *                 current view direction, at a distance proportional to the mesh's bounding
 *                 sphere radius. `modelHost.getSelection()` is the target.
 *   G         → toggle ground grid (`previs-state.ui.grid`).
 *   W         → toggle global wireframe (`previs-state.ui.wireframe`).
 *   Escape    → clear the selection (`modelHost.setSelection(null)`).
 *
 * Keys are ignored when a text input / textarea / contenteditable has focus — this lets
 * the "Save view" text box work normally without the host stealing `F` / `G` / `W`.
 *
 * Returns a `{ dispose() }` handle. The overlay is made focusable (`tabIndex = 0`) on
 * attach so clicks into it route keys here.
 */

/**
 * @typedef {Object} PrevisKeyboardOptions
 * @property {HTMLElement} overlay
 * @property {import('../lib/previs-scene.js').PrevisSceneHandle} sceneHandle
 * @property {import('../lib/previs-scene-model.js').PrevisSceneModelHandle} modelHost
 * @property {ReturnType<typeof import('../lib/previs-state.js').createPrevisState>} state
 * @property {any} THREE
 * @property {(level: 'log'|'warn'|'error', msg: string, ...args: any[]) => void} log
 */

/**
 * @param {PrevisKeyboardOptions} opts
 * @returns {{ dispose: () => void }}
 */
export function createPrevisPgm3dKeyboard(opts) {
	const { overlay, sceneHandle, modelHost, state, THREE, log } = opts
	if (!overlay) throw new Error('createPrevisPgm3dKeyboard: overlay required')

	const prevTabIndex = overlay.tabIndex
	if (!overlay.hasAttribute('tabindex')) overlay.tabIndex = 0

	overlay.addEventListener('keydown', onKeyDown)

	return {
		dispose() {
			overlay.removeEventListener('keydown', onKeyDown)
			if (prevTabIndex === -1 || prevTabIndex === undefined) overlay.removeAttribute('tabindex')
			else overlay.tabIndex = prevTabIndex
		},
	}

	function onKeyDown(ev) {
		if (isTextInputFocused()) return
		if (ev.ctrlKey || ev.altKey || ev.metaKey) return
		const key = ev.key
		if (key >= '1' && key <= '9') {
			const idx = Number(key) - 1
			const activeId = state.getSnapshot().activeModelId
			if (!activeId) return
			const presets = state.getPresets(activeId)
			const preset = presets[idx]
			if (!preset) return
			ev.preventDefault()
			if (typeof sceneHandle.flyTo === 'function') {
				sceneHandle.flyTo({ position: preset.position, target: preset.target, fov: preset.fov }, 500)
			}
			log('log', `[previs-keys] recall preset ${idx + 1}: ${preset.name}`)
			return
		}
		if (key === 'f' || key === 'F') {
			ev.preventDefault()
			frameSelection()
			return
		}
		if (key === 'g' || key === 'G') {
			ev.preventDefault()
			const ui = state.getUI()
			state.setUI({ grid: !ui.grid })
			if (sceneHandle.grid) sceneHandle.grid.visible = !ui.grid
			return
		}
		if (key === 'w' || key === 'W') {
			ev.preventDefault()
			const ui = state.getUI()
			const next = !ui.wireframe
			state.setUI({ wireframe: next })
			if (typeof sceneHandle.setWireframe === 'function') sceneHandle.setWireframe(next)
			return
		}
		if (key === 'Escape') {
			ev.preventDefault()
			modelHost.setSelection(null)
		}
	}

	function frameSelection() {
		if (typeof modelHost.getSelection !== 'function') return
		const mesh = modelHost.getSelection()
		if (!mesh) {
			log('log', '[previs-keys] F pressed with no selection')
			return
		}
		if (typeof sceneHandle.flyTo !== 'function' || typeof sceneHandle.getCameraState !== 'function') return

		const box = new THREE.Box3().setFromObject(mesh)
		if (box.isEmpty()) {
			log('warn', '[previs-keys] selection has empty bounding box; ignoring F')
			return
		}
		const center = box.getCenter(new THREE.Vector3())
		const sphere = box.getBoundingSphere(new THREE.Sphere())
		const radius = Math.max(0.25, sphere.radius)
		const snap = sceneHandle.getCameraState()
		const from = new THREE.Vector3(snap.position[0], snap.position[1], snap.position[2])
		const target = new THREE.Vector3(snap.target[0], snap.target[1], snap.target[2])
		const viewDir = from.clone().sub(target).normalize()
		// Fallback direction when camera already sits on the target (degenerate view dir).
		if (!Number.isFinite(viewDir.x) || viewDir.lengthSq() < 1e-6) viewDir.set(0, 0.3, 1).normalize()
		const fovRad = (snap.fov * Math.PI) / 180
		const distance = radius / Math.sin(Math.max(0.1, fovRad) / 2)
		const newPos = center.clone().add(viewDir.multiplyScalar(distance))
		sceneHandle.flyTo(
			{
				position: [newPos.x, newPos.y, newPos.z],
				target: [center.x, center.y, center.z],
				fov: snap.fov,
			},
			500,
		)
		log('log', `[previs-keys] framed selection (radius=${radius.toFixed(2)}m)`)
	}
}

function isTextInputFocused() {
	const el = /** @type {HTMLElement | null} */ (document.activeElement)
	if (!el) return false
	const tag = (el.tagName || '').toUpperCase()
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
	if (/** @type {any} */ (el).isContentEditable) return true
	return false
}
