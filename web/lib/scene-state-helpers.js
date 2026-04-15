import { fullFill } from './fill-math.js'

/** @returns {import('./fill-math.js').FillLike} */
function defaultFill() {
	return { ...fullFill() }
}

/** @returns {object} */
export function defaultTransition() {
	// MIX + frames ≈ fade to program when taking a look (Caspar load transition).
	return { type: 'MIX', duration: 12, tween: 'linear' }
}

/**
 * @returns {import('./scene-state.js').LayerConfig}
 */
/**
 * PRV uses the same Caspar layer numbers as PGM (layer 9 = black CG; content uses scene layerNumber).
 * @param {import('./scene-state.js').Scene | null | undefined} scene
 * @param {number} layerIndex
 */
export function previewChannelLayerForSceneLayer(scene, layerIndex) {
	const L = scene?.layers?.[layerIndex]
	return L?.layerNumber ?? 10
}

export function defaultLayerConfig(layerNumber) {
	return {
		layerNumber,
		source: null,
		loop: false,
		/** Output bus stereo pair — same options as timeline clip inspector. */
		audioRoute: '1+2',
		/** 0–1; use with {@link muted} */
		volume: 1,
		muted: false,
		/** Straight alpha: MIXER KEYER on layer (PNG/ProRes with alpha, etc.) */
		straightAlpha: false,
		/** 'native' | 'fill-canvas' | 'horizontal' | 'vertical' | 'stretch' — how media fits the layer rect (see layer inspector). */
		contentFit: 'native',
		/** When true (default), changing W or H in the inspector keeps content aspect (from media resolution when known). */
		aspectLocked: true,
		fill: defaultFill(),
		opacity: 1,
		rotation: 0,
		transition: null,
		/** Fade out opacity over N frames when a non-looping clip reaches its end. */
		fadeOnEnd: { enabled: false, frames: 12 },
		/** PIP overlay effect — HTML template composited above this layer. @see pip-overlay-registry.js */
		pipOverlay: null,
	}
}

export function newId() {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
	return `sc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * @param {object} s
 * @returns {import('./scene-state.js').Scene}
 */
export function migrateScene(s) {
	const id = s.id || newId()
	const layers = Array.isArray(s.layers)
		? s.layers.map((l, i) => {
				const base = {
					...defaultLayerConfig(l.layerNumber ?? 10 + i),
					...l,
					fill: { ...defaultFill(), ...(l.fill || {}) },
					transition: l.transition ?? null,
				}
				if (base.contentFit == null) {
					base.contentFit = l.fillNativeAspect === false ? 'stretch' : 'native'
				}
				if (base.aspectLocked == null) base.aspectLocked = true
				if (!base.fadeOnEnd || typeof base.fadeOnEnd !== 'object') {
					base.fadeOnEnd = { enabled: false, frames: 12 }
				}
				if (base.pipOverlay === undefined) base.pipOverlay = null
				return base
			})
		: []
	return {
		id,
		name: s.name || 'Untitled look',
		layers,
		defaultTransition: { ...defaultTransition(), ...(s.defaultTransition || {}) },
	}
}

export { defaultFill }
