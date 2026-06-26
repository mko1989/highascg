/**
 * Material helpers for Previs screen surfaces.
 */

export const DEFAULT_EMISSIVE = Object.freeze({ enabled: true, intensity: 1.4, emissiveColor: 0xffffff, roughness: 0.9, metalness: 0.0 })

export function resolveEmissive(input) {
	if (input === false) return { ...DEFAULT_EMISSIVE, enabled: false }
	if (input === true || input == null) return { ...DEFAULT_EMISSIVE }
	return { ...DEFAULT_EMISSIVE, ...input, enabled: input.enabled !== false }
}

export function createScreenMaterial(THREE, texture, cfg) {
	if (!cfg?.enabled || typeof THREE.MeshStandardMaterial !== 'function') return new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })
	const mat = new THREE.MeshStandardMaterial({ map: texture, emissive: new THREE.Color(cfg.emissiveColor), emissiveMap: texture, emissiveIntensity: cfg.intensity, roughness: cfg.roughness, metalness: cfg.metalness, side: THREE.DoubleSide })
	mat.toneMapped = false; return mat
}

export function applyTextureToScreenMaterial(material, tex, cfg) {
	if (!material) return; material.map = tex
	if (cfg?.enabled && 'emissiveMap' in material) material.emissiveMap = tex
	material.needsUpdate = true
}
