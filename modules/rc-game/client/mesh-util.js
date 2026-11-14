/* global document */
/**
 * Small three.js helpers shared by the RC game's builders (WO-1074): a coloured-triangle batch (one draw call per
 * batch), unlit vertex-colour materials, canvas textures, freezing and disposing groups.
 */
import * as THREE from 'three'

/** Collects coloured triangles (non-indexed) into one BufferGeometry. */
export class TriBatch {
	constructor() {
		this.pos = []
		this.col = []
	}
	tri(a, b, c, rgb) {
		this.pos.push(...a, ...b, ...c)
		for (let i = 0; i < 3; i++) this.col.push(...rgb)
	}
	quad(a, b, c, d, rgb) {
		this.tri(a, b, c, rgb)
		this.tri(a, c, d, rgb)
	}
	get empty() {
		return this.pos.length === 0
	}
	geometry() {
		const g = new THREE.BufferGeometry()
		g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
		g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
		g.computeBoundingSphere()
		return g
	}
	/** Mesh with an unlit vertex-colour material (null when empty). */
	mesh(mat) {
		return this.empty ? null : new THREE.Mesh(this.geometry(), mat)
	}
}

/** Unlit vertex-colour material, pulled towards the camera by `offset` steps (decals on the road). */
export function flatMat(offset = 0, extra = {}) {
	return new THREE.MeshBasicMaterial({
		vertexColors: true,
		side: THREE.DoubleSide,
		polygonOffset: offset !== 0,
		polygonOffsetFactor: -offset,
		polygonOffsetUnits: -offset * 4,
		...extra,
	})
}

/** A canvas (w × h) drawn by `draw(ctx, w, h)` → texture. */
export function canvasTexture(w, h, draw) {
	const c = document.createElement('canvas')
	c.width = w
	c.height = h
	const ctx = c.getContext('2d')
	if (ctx) draw(ctx, w, h)
	const tex = new THREE.CanvasTexture(c)
	tex.colorSpace = THREE.SRGBColorSpace
	return tex
}

/** No per-frame matrix updates for static content. */
export function freezeGroup(g) {
	g.traverse((o) => {
		o.matrixAutoUpdate = false
		o.updateMatrix()
	})
	return g
}

export function disposeGroup(g) {
	g?.traverse((o) => {
		o.geometry?.dispose?.()
		const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
		for (const m of mats) {
			m.map?.dispose?.()
			m.dispose?.()
		}
	})
}

/** sRGB hex → linear [r, g, b] for vertex colours. */
export function lin(hex) {
	const c = new THREE.Color(hex)
	return [c.r, c.g, c.b]
}
