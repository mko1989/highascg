/**
 * Previs Three.js scene factory (WO-17).
 *
 * Builds the vanilla Three.js equivalent of `SceneViewer.tsx`'s R3F `<Canvas>` contents:
 *   - scene + perspective camera + renderer
 *   - ambient + directional lights (matching SceneViewer's intensities)
 *   - infinite floor grid (matching the `@react-three/drei` `<Grid>` look)
 *   - OrbitControls (dynamically imported so bundlers tree-shake when previs is off)
 *
 * Extracted from `previs-pgm-3d.js` so the component file stays under 500 lines and the
 * scene setup is reusable — e.g. the future stage-layout modal can mount the same base.
 *
 * THREE and OrbitControls are passed in to decouple this file from the heavy optional
 * `three` dependency; see `previs-mesh-info.js` for the rationale.
 */

/**
 * @typedef {Object} PrevisSceneOptions
 * @property {number} [backgroundColor=0x111111]
 * @property {[number, number, number]} [cameraPosition=[0, 5, 12]]
 * @property {number} [cameraFov=50]
 * @property {number} [cameraNear=0.05]
 * @property {number} [cameraFar=1000]
 * @property {boolean} [enableShadows=true]
 * @property {boolean} [enableGrid=true]
 * @property {number} [pixelRatioCap=2]
 * @property {boolean} [antialias=true]
 * @property {number} [ambientIntensity=0.4]
 * @property {number} [directionalIntensity=1.0]
 */

/**
 * @typedef {Object} PrevisSceneHandle
 * @property {any} scene
 * @property {any} camera
 * @property {any} renderer
 * @property {any | null} controls                Populated once OrbitControls are attached.
 * @property {(width: number, height: number) => void} resize
 * @property {() => void} render                  One-shot render — call from a RAF loop.
 * @property {(attach: boolean) => void} setControlsEnabled
 * @property {(patch: Partial<{ backgroundColor: number, ambientIntensity: number, directionalIntensity: number, pixelRatioCap: number, cameraFov: number }>) => void} applySettings
 * @property {() => void} dispose
 */

/**
 * Build a previs scene inside `container`. The canvas is appended to the container — callers
 * are responsible for sizing the container (e.g. flexbox / absolute positioning). The
 * returned `handle.resize(w, h)` must be called whenever the container changes size.
 *
 * @param {HTMLElement} container
 * @param {typeof import('three')} THREE
 * @param {{ OrbitControls?: any }} [deps]
 * @param {PrevisSceneOptions} [options]
 * @returns {PrevisSceneHandle}
 */
function createPrevisScene(container, THREE, deps, options) {
	const opts = options || {}
	const depsSafe = deps || {}

	const scene = new THREE.Scene()
	scene.background = new THREE.Color(opts.backgroundColor != null ? opts.backgroundColor : 0x111111)

	const width = Math.max(1, container.clientWidth)
	const height = Math.max(1, container.clientHeight)

	const camera = new THREE.PerspectiveCamera(
		opts.cameraFov != null ? opts.cameraFov : 50,
		width / height,
		opts.cameraNear || 0.05,
		opts.cameraFar || 1000,
	)
	const camPos = opts.cameraPosition || [0, 5, 12]
	camera.position.set(camPos[0], camPos[1], camPos[2])
	camera.lookAt(0, 0, 0)

	const renderer = new THREE.WebGLRenderer({ antialias: opts.antialias !== false, alpha: false })
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.pixelRatioCap != null ? opts.pixelRatioCap : 2))
	renderer.setSize(width, height, false)
	renderer.outputColorSpace = THREE.SRGBColorSpace
	if (opts.enableShadows !== false) {
		renderer.shadowMap.enabled = true
		renderer.shadowMap.type = THREE.PCFSoftShadowMap
	}
	renderer.domElement.style.display = 'block'
	renderer.domElement.style.width = '100%'
	renderer.domElement.style.height = '100%'
	container.appendChild(renderer.domElement)

	const lights = addDefaultLights(scene, THREE, {
		ambientIntensity: opts.ambientIntensity,
		directionalIntensity: opts.directionalIntensity,
	})
	const gridHelper = opts.enableGrid === false ? null : addInfiniteGrid(scene, THREE)
	const axesHelper = new THREE.AxesHelper(5)
	axesHelper.visible = false
	scene.add(axesHelper)

	/** @type {any | null} */
	let controls = null
	if (depsSafe.OrbitControls) {
		const OrbitControls = depsSafe.OrbitControls
		controls = new OrbitControls(camera, renderer.domElement)
		controls.enableDamping = true
		controls.dampingFactor = 0.08
		controls.makeDefault = true
	}

	/** @type {{ cancel: () => void } | null} Active camera tween; cancelled on any new flyTo. */
	let activeFlyTween = null

	const handle = {
		scene,
		camera,
		renderer,
		controls,
		grid: gridHelper,
		axes: axesHelper,
		lights,
		resize,
		render,
		setControlsEnabled,
		setWireframe,
		getCameraState,
		flyTo,
		applySettings,
		dispose,
	}

	/**
	 * Toggle wireframe on every mesh in the scene (including imported models). Runs on
	 * demand from the inspector — small scenes, cheap to walk.
	 */
	function setWireframe(on) {
		scene.traverse((obj) => {
			if (!obj.isMesh) return
			const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
			for (const mat of mats) {
				if (mat && 'wireframe' in mat) mat.wireframe = !!on
			}
		})
	}

	function resize(w, h) {
		const safeW = Math.max(1, Math.floor(w))
		const safeH = Math.max(1, Math.floor(h))
		renderer.setSize(safeW, safeH, false)
		camera.aspect = safeW / safeH
		camera.updateProjectionMatrix()
	}

	function render() {
		if (controls && controls.update) controls.update()
		renderer.render(scene, camera)
	}

	function setControlsEnabled(attach) {
		if (!controls) return
		controls.enabled = !!attach
	}

	/**
	 * Snapshot the current camera pose — suitable for storing as a preset. `target` is
	 * read from OrbitControls when present (that's the actual orbit pivot), else from a
	 * ray cast forward from the camera at 5 m.
	 *
	 * @returns {{ position: [number, number, number], target: [number, number, number], fov: number }}
	 */
	function getCameraState() {
		const pos = camera.position
		let tx = 0, ty = 0, tz = 0
		if (controls && controls.target) {
			tx = controls.target.x
			ty = controls.target.y
			tz = controls.target.z
		} else {
			const dir = new THREE.Vector3()
			camera.getWorldDirection(dir)
			tx = pos.x + dir.x * 5
			ty = pos.y + dir.y * 5
			tz = pos.z + dir.z * 5
		}
		return {
			position: [pos.x, pos.y, pos.z],
			target: [tx, ty, tz],
			fov: camera.fov,
		}
	}

	/**
	 * Tween the camera to a target pose over `durationMs`. Handles position + orbit
	 * target + fov together. Cancels any in-flight tween. Uses cubic ease-in-out.
	 *
	 * @param {{ position: [number, number, number], target: [number, number, number], fov?: number }} to
	 * @param {number} [durationMs=500]
	 */
	function flyTo(to, durationMs) {
		if (activeFlyTween) activeFlyTween.cancel()
		const duration = Math.max(1, durationMs || 500)
		const from = getCameraState()
		const startFov = camera.fov
		const endFov = typeof to.fov === 'number' ? to.fov : startFov
		const startTime = performance.now()
		let cancelled = false
		let rafId = 0
		const step = () => {
			if (cancelled) return
			const now = performance.now()
			const t = Math.min(1, (now - startTime) / duration)
			const e = easeInOutCubic(t)
			camera.position.set(
				lerp(from.position[0], to.position[0], e),
				lerp(from.position[1], to.position[1], e),
				lerp(from.position[2], to.position[2], e),
			)
			if (controls && controls.target) {
				controls.target.set(
					lerp(from.target[0], to.target[0], e),
					lerp(from.target[1], to.target[1], e),
					lerp(from.target[2], to.target[2], e),
				)
			}
			camera.fov = lerp(startFov, endFov, e)
			camera.updateProjectionMatrix()
			if (t < 1) rafId = requestAnimationFrame(step)
			else activeFlyTween = null
		}
		rafId = requestAnimationFrame(step)
		activeFlyTween = { cancel: () => { cancelled = true; if (rafId) cancelAnimationFrame(rafId) } }
	}

	/**
	 * Apply runtime scene tweaks from persisted previs UI (background, lights, pixel ratio,
	 * camera FOV). Safe to call while 3D is active.
	 *
	 * @param {Partial<{ backgroundColor: number, ambientIntensity: number, directionalIntensity: number, pixelRatioCap: number, cameraFov: number }>} patch
	 */
	function applySettings(patch) {
		if (!patch || typeof patch !== 'object') return
		if (patch.backgroundColor != null && scene.background && scene.background.setHex) {
			scene.background.setHex(Math.max(0, Math.min(0xffffff, Math.floor(Number(patch.backgroundColor)))))
		}
		if (lights.ambient && patch.ambientIntensity != null && Number.isFinite(patch.ambientIntensity)) {
			lights.ambient.intensity = /** @type {number} */ (patch.ambientIntensity)
		}
		if (lights.directional && patch.directionalIntensity != null && Number.isFinite(patch.directionalIntensity)) {
			lights.directional.intensity = /** @type {number} */ (patch.directionalIntensity)
		}
		if (patch.pixelRatioCap != null) {
			const cap = Number(patch.pixelRatioCap)
			if ([1, 2, 4].includes(cap)) {
				renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap))
			}
		}
		if (patch.cameraFov != null && Number.isFinite(patch.cameraFov)) {
			camera.fov = /** @type {number} */ (patch.cameraFov)
			camera.updateProjectionMatrix()
		}
	}

	function dispose() {
		if (activeFlyTween) { activeFlyTween.cancel(); activeFlyTween = null }
		if (controls && controls.dispose) controls.dispose()
		handle.controls = null
		if (gridHelper) {
			scene.remove(gridHelper)
			if (gridHelper.geometry && gridHelper.geometry.dispose) gridHelper.geometry.dispose()
			if (gridHelper.material && gridHelper.material.dispose) gridHelper.material.dispose()
		}
		if (axesHelper) {
			scene.remove(axesHelper)
			if (axesHelper.geometry && axesHelper.geometry.dispose) axesHelper.geometry.dispose()
			if (axesHelper.material && axesHelper.material.dispose) axesHelper.material.dispose()
		}
		scene.traverse((obj) => {
			if (obj.isMesh) {
				if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose()
				if (obj.material) disposeMaterial(obj.material)
			}
		})
		renderer.dispose()
		if (renderer.domElement.parentNode === container) {
			container.removeChild(renderer.domElement)
		}
	}

	return handle
}

/**
 * Install ambient + directional lights with Show Creator's intensities (0.4 / 1.0). Matches
 * the `<ambientLight>` + `<directionalLight>` + `<Environment preset="warehouse">` combo,
 * minus the warehouse env map (imported models will look a bit flatter — acceptable for a
 * previs preview; swap in `RoomEnvironment` later if art direction asks).
 *
 * @param {any} scene
 * @param {typeof import('three')} THREE
 * @param {{ ambientIntensity?: number, directionalIntensity?: number }} [opts]
 * @returns {{ ambient: any, directional: any }}
 */
function addDefaultLights(scene, THREE, opts) {
	const o = opts || {}
	const ai = o.ambientIntensity != null && Number.isFinite(o.ambientIntensity) ? o.ambientIntensity : 0.4
	const di = o.directionalIntensity != null && Number.isFinite(o.directionalIntensity) ? o.directionalIntensity : 1.0
	const ambient = new THREE.AmbientLight(0xffffff, ai)
	scene.add(ambient)

	const directional = new THREE.DirectionalLight(0xffffff, di)
	directional.position.set(10, 10, 5)
	directional.castShadow = true
	directional.shadow.mapSize.width = 2048
	directional.shadow.mapSize.height = 2048
	directional.shadow.camera.near = 0.5
	directional.shadow.camera.far = 50
	directional.shadow.camera.left = -15
	directional.shadow.camera.right = 15
	directional.shadow.camera.top = 15
	directional.shadow.camera.bottom = -15
	scene.add(directional)
	return { ambient, directional }
}

/**
 * Drop a `GridHelper`-style floor grid at Y = 0. Uses two layered grids (cellSize=1 + a
 * 5 m section line) to visually match `@react-three/drei`'s `<Grid cellSize={1}
 * sectionSize={5} />`. `GridHelper` is the vanilla-Three equivalent; it doesn't shade
 * fade-out at distance, but at the expected scene scale that's fine.
 *
 * @param {any} scene
 * @param {typeof import('three')} THREE
 * @returns {any}
 */
function addInfiniteGrid(scene, THREE) {
	const size = 60
	const divisions = 60
	const grid = new THREE.GridHelper(size, divisions, 0x666666, 0x444444)
	grid.position.y = 0
	// Stage coords (docs/MODULES.md): +Z is up, so the visual grid lies on the XY plane in
	// stage space. Three.js GridHelper is XZ, so rotate it so +Y(three) = +Z(stage).
	grid.rotation.x = Math.PI / 2
	scene.add(grid)
	return grid
}

function lerp(a, b, t) { return a + (b - a) * t }
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2 }

function disposeMaterial(material) {
	if (Array.isArray(material)) {
		for (const m of material) disposeMaterial(m)
		return
	}
	for (const key of [
		'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
		'emissiveMap', 'envMap', 'lightMap', 'bumpMap', 'displacementMap', 'alphaMap',
	]) {
		const tex = material[key]
		if (tex && tex.dispose && !tex.userData.highascgKeep) tex.dispose()
	}
	if (material.dispose) material.dispose()
}

export {
	createPrevisScene,
	addDefaultLights,
	addInfiniteGrid,
}
