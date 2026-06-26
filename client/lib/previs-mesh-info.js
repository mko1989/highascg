/**
 * Previs mesh introspection + tagging (WO-17).
 *
 * Small, dependency-injected helpers that operate on Three.js meshes/groups. Ported from
 * `work/references/show_creator/SceneViewer.tsx` (`getMeshInfo` + material-cloning helper)
 * and the mesh-tagging convention described in `work/references/show_creator/README.md`.
 *
 * Why dependency-injected (`THREE` passed in):
 *   - The `three` package is an **optional** dependency (`HIGHASCG_PREVIS=1` only). Pulling
 *     it into this file via `import` would break non-previs boots at module-load time.
 *   - Callers that already have a THREE instance (e.g. `previs-pgm-3d.js`) pass it in.
 *   - Pure introspection helpers (e.g. `readScreenTag`) don't need THREE at all.
 *
 * See `src/previs/types.js` for `ModelMeshInfo` / `ScreenTag`.
 */

/**
 * @typedef {Object} Vec3Tuple    Array triple `[x, y, z]` — compatible with Show Creator's store.
 * @typedef {[number, number, number]} Vec3Tuple
 */

/**
 * @typedef {Object} ModelMeshInfo
 * @property {string} name
 * @property {string} uuid
 * @property {Vec3Tuple} position      World position.
 * @property {Vec3Tuple} rotation      World rotation (Euler XYZ, radians).
 * @property {Vec3Tuple} scale         World scale.
 * @property {{ min: Vec3Tuple, max: Vec3Tuple }} boundingBox   World-space AABB.
 * @property {number} worldWidth       Absolute bounding-box X in world space.
 * @property {number} worldHeight      Absolute bounding-box Y.
 * @property {number} worldDepth       Absolute bounding-box Z.
 */

/**
 * @typedef {Object} ScreenTag
 * @property {string} screenId               Stable id — matches a `ScreenRegion.id`.
 * @property {'regular' | 'irregular'} [type]
 * @property {string} [virtualCanvasId]      Identifies which virtual canvas feeds this mesh.
 * @property {string} [source]               Stream id (`pgm`, `prv`, …) for video binding.
 * @property {{ canvasX: number, canvasY: number, canvasWidth: number, canvasHeight: number }} [canvasRegion]
 *   Sub-rect of the global virtual canvas (px). Omitted = full canvas.
 * @property {Record<string, unknown>} [extra]
 */

const SCREEN_TAG_KEY = 'highascg.screen'

/**
 * Extract world-space transform + bounding box info from a single mesh. THREE passed in so
 * this module stays valid when three.js isn't installed.
 *
 * @param {any} mesh                                  A `THREE.Mesh`.
 * @param {typeof import('three')} THREE              Three.js namespace.
 * @returns {ModelMeshInfo}
 */
function getMeshInfo(mesh, THREE) {
	if (!mesh || !mesh.geometry) {
		throw new Error('getMeshInfo: mesh with geometry required')
	}
	mesh.geometry.computeBoundingBox()
	const box = mesh.geometry.boundingBox || new THREE.Box3()

	const worldPos = new THREE.Vector3()
	mesh.getWorldPosition(worldPos)

	const worldScale = new THREE.Vector3()
	mesh.getWorldScale(worldScale)

	const worldQuat = new THREE.Quaternion()
	mesh.getWorldQuaternion(worldQuat)
	const worldEuler = new THREE.Euler().setFromQuaternion(worldQuat)

	const size = new THREE.Vector3()
	box.getSize(size)
	size.multiply(worldScale)

	return {
		name: mesh.name || 'Unnamed Mesh',
		uuid: mesh.uuid,
		position: [worldPos.x, worldPos.y, worldPos.z],
		rotation: [worldEuler.x, worldEuler.y, worldEuler.z],
		scale: [worldScale.x, worldScale.y, worldScale.z],
		boundingBox: {
			min: [
				box.min.x * worldScale.x + worldPos.x,
				box.min.y * worldScale.y + worldPos.y,
				box.min.z * worldScale.z + worldPos.z,
			],
			max: [
				box.max.x * worldScale.x + worldPos.x,
				box.max.y * worldScale.y + worldPos.y,
				box.max.z * worldScale.z + worldPos.z,
			],
		},
		worldWidth: Math.abs(size.x),
		worldHeight: Math.abs(size.y),
		worldDepth: Math.abs(size.z),
	}
}

/**
 * Walk every `THREE.Mesh` descendant (including `root` itself if it's a mesh) and invoke
 * `fn(mesh, index)`. Returns the number of meshes visited — useful for debug logging.
 *
 * @param {any} root
 * @param {(mesh: any, index: number) => void} fn
 * @returns {number}
 */
function traverseMeshes(root, fn) {
	if (!root || typeof root.traverse !== 'function') return 0
	let i = 0
	root.traverse((child) => {
		if (child && child.isMesh) {
			fn(child, i++)
		}
	})
	return i
}

/**
 * Tag a mesh as a "screen surface" so the previs pipeline can find it later and map a
 * virtual canvas onto it. Uses a namespaced userData key so we don't collide with other
 * libraries (Three.js editors, R3F tooling, etc.).
 *
 * @param {any} mesh
 * @param {ScreenTag} tag
 */
function tagScreenMesh(mesh, tag) {
	if (!mesh) return
	if (!mesh.userData) mesh.userData = {}
	mesh.userData[SCREEN_TAG_KEY] = { ...tag }
}

/**
 * Remove the screen tag from a mesh. Also drops the shared `interactive` flag if present,
 * to match Show Creator's behaviour when a mesh is demoted to a plain decorative prop.
 *
 * @param {any} mesh
 */
function untagScreenMesh(mesh) {
	if (!mesh || !mesh.userData) return
	delete mesh.userData[SCREEN_TAG_KEY]
	if (mesh.userData.interactive) delete mesh.userData.interactive
}

/**
 * Read back a screen tag (may be `undefined`).
 *
 * @param {any} mesh
 * @returns {ScreenTag | undefined}
 */
function readScreenTag(mesh) {
	if (!mesh || !mesh.userData) return undefined
	return mesh.userData[SCREEN_TAG_KEY]
}

/**
 * Scan a subtree and return a Map of `screenId → mesh` for every tagged mesh. Meshes with
 * duplicate screenIds log a warning and keep the first one (more-deterministic than
 * silently overwriting).
 *
 * @param {any} root
 * @param {(msg: string) => void} [warn]
 * @returns {Map<string, any>}
 */
function findTaggedScreenMeshes(root, warn) {
	/** @type {Map<string, any>} */
	const map = new Map()
	traverseMeshes(root, (mesh) => {
		const tag = readScreenTag(mesh)
		if (!tag || !tag.screenId) return
		if (map.has(tag.screenId)) {
			if (warn) warn(`[previs] duplicate screen tag "${tag.screenId}" on mesh "${mesh.name}"; keeping first.`)
			return
		}
		map.set(tag.screenId, mesh)
	})
	return map
}

/**
 * Mark a mesh (and optionally its descendants) as interactive — used by the builder UI to
 * opt-in to click handling. Mirrors Show Creator's `userData.interactive = true` pattern.
 *
 * @param {any} mesh
 * @param {boolean} on
 * @param {{ recursive?: boolean }} [opts]
 */
function setMeshInteractive(mesh, on, opts) {
	const recursive = !!(opts && opts.recursive)
	const apply = (m) => {
		if (!m.userData) m.userData = {}
		if (on) m.userData.interactive = true
		else delete m.userData.interactive
	}
	if (!mesh) return
	apply(mesh)
	if (recursive && typeof mesh.traverse === 'function') {
		mesh.traverse((child) => {
			if (child !== mesh && child.isMesh) apply(child)
		})
	}
}

/**
 * Clone a Three.js material while preserving ALL texture maps (the default `.clone()`
 * drops some references). Ported from SceneViewer.tsx. Handles MeshStandardMaterial,
 * MeshPhysicalMaterial, and MeshBasicMaterial — which covers everything glTF loaders emit.
 *
 * Any material type not in that list returns a plain `.clone()` — still usable, but any
 * missing texture copies should be reported by the caller for review.
 *
 * @param {any} material
 * @param {typeof import('three')} THREE
 * @returns {any}
 */
function cloneMaterialPreservingTextures(material, THREE) {
	if (!material) return material
	const cloned = material.clone()

	if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
		if (material.map) cloned.map = material.map
		if (material.normalMap) cloned.normalMap = material.normalMap
		if (material.roughnessMap) cloned.roughnessMap = material.roughnessMap
		if (material.metalnessMap) cloned.metalnessMap = material.metalnessMap
		if (material.aoMap) cloned.aoMap = material.aoMap
		if (material.emissiveMap) cloned.emissiveMap = material.emissiveMap
		if (material.envMap) cloned.envMap = material.envMap
		if (material.lightMap) cloned.lightMap = material.lightMap
		if (material.bumpMap) cloned.bumpMap = material.bumpMap
		if (material.displacementMap) cloned.displacementMap = material.displacementMap
		if (material.alphaMap) cloned.alphaMap = material.alphaMap

		cloned.color = material.color.clone()
		cloned.emissive = material.emissive.clone()
		cloned.roughness = material.roughness
		cloned.metalness = material.metalness
		cloned.opacity = material.opacity
		cloned.transparent = material.transparent
		cloned.side = material.side
		cloned.needsUpdate = true
		return cloned
	}

	if (material instanceof THREE.MeshBasicMaterial) {
		if (material.map) cloned.map = material.map
		if (material.alphaMap) cloned.alphaMap = material.alphaMap
		if (material.envMap) cloned.envMap = material.envMap
		if (material.lightMap) cloned.lightMap = material.lightMap
		if (material.aoMap) cloned.aoMap = material.aoMap
		cloned.color = material.color.clone()
		cloned.needsUpdate = true
		return cloned
	}

	return cloned
}

/**
 * Walk a freshly-loaded glTF scene graph and apply Show Creator's default prep:
 *   - enable cast/receive shadows on every mesh
 *   - clone every material (preserving textures) so per-instance tweaks don't bleed back
 *     into cached loader resources
 *
 * @param {any} root
 * @param {typeof import('three')} THREE
 * @returns {{ meshesPrepared: number, materialsCloned: number }}
 */
function prepareImportedSceneGraph(root, THREE) {
	let meshesPrepared = 0
	let materialsCloned = 0
	traverseMeshes(root, (mesh) => {
		meshesPrepared++
		mesh.castShadow = true
		mesh.receiveShadow = true
		if (Array.isArray(mesh.material)) {
			mesh.material = mesh.material.map((m) => {
				materialsCloned++
				return cloneMaterialPreservingTextures(m, THREE)
			})
		} else if (mesh.material) {
			materialsCloned++
			mesh.material = cloneMaterialPreservingTextures(mesh.material, THREE)
		}
	})
	return { meshesPrepared, materialsCloned }
}

export {
	SCREEN_TAG_KEY,
	getMeshInfo,
	traverseMeshes,
	tagScreenMesh,
	untagScreenMesh,
	readScreenTag,
	findTaggedScreenMeshes,
	setMeshInteractive,
	cloneMaterialPreservingTextures,
	prepareImportedSceneGraph,
}
