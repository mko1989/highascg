/**
 * Previs 3D model loader (WO-17 T2.1).
 *
 * Loads glTF / GLB files into a ready-to-mount Three.js `Group`, applying Show Creator's
 * prep recipe (shadows + texture-preserving material clone) and normalising so the caller
 * can drop the model into the scene without guessing its units. Also returns mesh metadata
 * that the inspector/tagging UI consumes directly.
 *
 * Deliberately small surface:
 *   - `loadModelFromUrl(url, THREE, GLTFLoader, opts)` — server-persisted model path.
 *   - `loadModelFromFile(file, THREE, GLTFLoader, opts)` — drag-drop / picker path.
 *   - `loadModelFromArrayBuffer(buf, THREE, GLTFLoader, opts)` — lower-level, for tests.
 *
 * All three return the same `LoadedModel` shape.
 *
 * GLTFLoader + THREE are dependency-injected (caller already loaded them in
 * `previs-pgm-3d.js::ensureThreeLoaded`). Keeps this file free of `three` imports so it
 * works in tooling/tests without the optional dep installed.
 *
 * OBJ / FBX fallbacks (WO-17 T2.1 "fallback") are intentionally deferred until the glTF
 * path is proven end-to-end — Capture 2025 emits glTF natively, which covers the primary
 * ingestion route documented in the WO.
 */

import { getMeshInfo, prepareImportedSceneGraph, traverseMeshes } from './previs-mesh-info.js'

const DEFAULT_NORMALIZATION_TARGET_M = 10

/**
 * @typedef {Object} LoadedModel
 * @property {any} root                        `THREE.Group` ready to `scene.add(...)`.
 * @property {Array<import('./previs-mesh-info.js').ModelMeshInfo>} meshInfos
 * @property {number} normalizationFactor      Uniform scale applied to fit the target box. 1 when disabled.
 * @property {{ min: [number,number,number], max: [number,number,number], size: [number,number,number] }} originalBox
 *   Pre-normalisation world-space AABB and extents — useful for "real units" displays.
 * @property {{ meshesPrepared: number, materialsCloned: number }} prep
 */

/**
 * @typedef {Object} LoadModelOptions
 * @property {boolean} [centerAtOrigin=true]   Translate so the model's AABB centre sits on the origin.
 * @property {boolean} [placeOnFloor=true]     After centring, shift up so the AABB's Y-min touches y=0.
 * @property {number} [normalizeToMaxDim=10]   Uniform-scale so the largest AABB extent equals this many metres. Set to 0 to disable.
 * @property {(phase: 'parse'|'prepare', progress: number, msg?: string) => void} [onProgress]
 *   `progress` in 0..1 for `parse`; called once with progress=1 at the end of `prepare`.
 */

/**
 * Parse a glTF JSON + resources URL into a `LoadedModel`. Supports both `.gltf` (JSON +
 * external buffers/textures) and `.glb` (single binary). Loader internals are handled by
 * the injected `GLTFLoader`.
 *
 * @param {string} url
 * @param {typeof import('three')} THREE
 * @param {any} GLTFLoader                    Constructor (`new GLTFLoader()`).
 * @param {LoadModelOptions} [opts]
 * @returns {Promise<LoadedModel>}
 */
function loadModelFromUrl(url, THREE, GLTFLoader, opts) {
	const loader = new GLTFLoader()
	const options = opts || {}
	return new Promise((resolve, reject) => {
		loader.load(
			url,
			(gltf) => {
				try {
					resolve(finaliseGltf(gltf, THREE, options))
				} catch (err) {
					reject(err)
				}
			},
			(xhr) => {
				if (!options.onProgress) return
				const progress = xhr.lengthComputable ? xhr.loaded / xhr.total : 0
				options.onProgress('parse', progress)
			},
			(err) => reject(err),
		)
	})
}

/**
 * Parse a `File`/`Blob` (drag-drop or file picker) into a `LoadedModel`. Internally reads
 * the file as an `ArrayBuffer` and calls `GLTFLoader.parse()` — works for both `.glb` and
 * `.gltf` (single-file gltf-JSON only; external buffers/textures must be embedded).
 *
 * @param {File | Blob} file
 * @param {typeof import('three')} THREE
 * @param {any} GLTFLoader
 * @param {LoadModelOptions} [opts]
 * @returns {Promise<LoadedModel>}
 */
async function loadModelFromFile(file, THREE, GLTFLoader, opts) {
	const options = opts || {}
	if (options.onProgress) options.onProgress('parse', 0, file.name)
	const buffer = await readFileAsArrayBuffer(file)
	if (options.onProgress) options.onProgress('parse', 0.9, file.name)
	const model = await loadModelFromArrayBuffer(buffer, THREE, GLTFLoader, options)
	if (options.onProgress) options.onProgress('parse', 1, file.name)
	return model
}

/**
 * Parse an in-memory glTF binary (`.glb`) or JSON (`.gltf`) buffer. Resource base URL
 * defaults to the document origin — external buffers/images aren't resolvable without
 * one, so prefer `.glb` for file-drag flows.
 *
 * @param {ArrayBuffer} buffer
 * @param {typeof import('three')} THREE
 * @param {any} GLTFLoader
 * @param {LoadModelOptions} [opts]
 * @returns {Promise<LoadedModel>}
 */
function loadModelFromArrayBuffer(buffer, THREE, GLTFLoader, opts) {
	const loader = new GLTFLoader()
	const resourcePath = (typeof window !== 'undefined' && window.location) ? window.location.href : ''
	return new Promise((resolve, reject) => {
		try {
			loader.parse(
				buffer,
				resourcePath,
				(gltf) => {
					try {
						resolve(finaliseGltf(gltf, THREE, opts || {}))
					} catch (err) {
						reject(err)
					}
				},
				(err) => reject(err),
			)
		} catch (err) {
			reject(err)
		}
	})
}

/**
 * Apply Show Creator's prep recipe + normalisation to a freshly-parsed glTF.
 *
 * @param {{ scene: any }} gltf
 * @param {typeof import('three')} THREE
 * @param {LoadModelOptions} opts
 * @returns {LoadedModel}
 */
function finaliseGltf(gltf, THREE, opts) {
	const root = gltf.scene
	if (!root) throw new Error('previs-model-loader: glTF contained no scene')

	const prep = prepareImportedSceneGraph(root, THREE)

	const box = new THREE.Box3().setFromObject(root)
	const boxSize = new THREE.Vector3()
	box.getSize(boxSize)
	const boxMin = box.min.clone()
	const boxMax = box.max.clone()

	const centerAtOrigin = opts.centerAtOrigin !== false
	const placeOnFloor = opts.placeOnFloor !== false
	const normalize = opts.normalizeToMaxDim == null ? DEFAULT_NORMALIZATION_TARGET_M : opts.normalizeToMaxDim

	let normalizationFactor = 1
	if (normalize && normalize > 0) {
		const maxDim = Math.max(boxSize.x, boxSize.y, boxSize.z)
		if (maxDim > 0) {
			normalizationFactor = normalize / maxDim
			root.scale.setScalar(normalizationFactor)
			root.updateMatrixWorld(true)
		}
	}

	if (centerAtOrigin || placeOnFloor) {
		const scaledBox = new THREE.Box3().setFromObject(root)
		const center = new THREE.Vector3()
		scaledBox.getCenter(center)
		if (centerAtOrigin) {
			root.position.x -= center.x
			root.position.z -= center.z
			if (!placeOnFloor) root.position.y -= center.y
		}
		if (placeOnFloor) {
			root.position.y -= scaledBox.min.y
		}
		root.updateMatrixWorld(true)
	}

	const meshInfos = []
	traverseMeshes(root, (mesh) => {
		try {
			meshInfos.push(getMeshInfo(mesh, THREE))
		} catch (err) {
			console.warn('[previs-model-loader] getMeshInfo failed for', mesh.name, err)
		}
	})

	if (opts.onProgress) opts.onProgress('prepare', 1)

	return {
		root,
		meshInfos,
		normalizationFactor,
		originalBox: {
			min: [boxMin.x, boxMin.y, boxMin.z],
			max: [boxMax.x, boxMax.y, boxMax.z],
			size: [boxSize.x, boxSize.y, boxSize.z],
		},
		prep,
	}
}

/**
 * Dispose a previously-loaded model: geometry, materials, textures, and detach from its
 * parent. Matches Show Creator's on-unmount behaviour.
 *
 * @param {LoadedModel | { root: any } | null} model
 */
function disposeModel(model) {
	if (!model || !model.root) return
	traverseMeshes(model.root, (mesh) => {
		if (mesh.geometry && mesh.geometry.dispose) mesh.geometry.dispose()
		disposeMaterial(mesh.material)
	})
	if (model.root.parent) model.root.parent.remove(model.root)
}

function disposeMaterial(material) {
	if (!material) return
	if (Array.isArray(material)) {
		for (const m of material) disposeMaterial(m)
		return
	}
	for (const key of [
		'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
		'emissiveMap', 'envMap', 'lightMap', 'bumpMap', 'displacementMap', 'alphaMap',
	]) {
		const tex = material[key]
		if (tex && tex.dispose && !(tex.userData && tex.userData.highascgKeep)) {
			tex.dispose()
		}
	}
	if (material.dispose) material.dispose()
}

/**
 * Classify a filename / path by extension to pick the right loader path.
 *
 * @param {string} name
 * @returns {'glb' | 'gltf' | 'obj' | 'fbx' | 'unknown'}
 */
function detectModelKind(name) {
	const lower = String(name || '').toLowerCase()
	if (lower.endsWith('.glb')) return 'glb'
	if (lower.endsWith('.gltf')) return 'gltf'
	if (lower.endsWith('.obj')) return 'obj'
	if (lower.endsWith('.fbx')) return 'fbx'
	return 'unknown'
}

function readFileAsArrayBuffer(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(/** @type {ArrayBuffer} */ (reader.result))
		reader.onerror = () => reject(reader.error || new Error('FileReader error'))
		reader.readAsArrayBuffer(file)
	})
}

export {
	DEFAULT_NORMALIZATION_TARGET_M,
	loadModelFromUrl,
	loadModelFromFile,
	loadModelFromArrayBuffer,
	disposeModel,
	detectModelKind,
}
