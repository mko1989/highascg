import { fullFill } from './fill-math.js'

/** Main look clips on PGM/PRV use 10, 20, 30…; layers 1–9 are reserved (e.g. black CG, channel chrome); 11–19 sit above layer 10 for PIP/CG, 21–29 above 20, etc. */
export const LOOK_LAYER_FIRST = 10
export const LOOK_LAYER_STEP = 10

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
 * PRV uses the same Caspar layer numbers as PGM (layer 9 = black CG; look clips at 10, 20, 30…; PIP/cg in the band above each base).
 * @param {import('./scene-state.js').Scene | null | undefined} scene
 * @param {number} layerIndex
 */
export function previewChannelLayerForSceneLayer(scene, layerIndex) {
	const L = scene?.layers?.[layerIndex]
	return L?.layerNumber ?? LOOK_LAYER_FIRST
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
		/** Stacked PIP overlay effects (border, shadow, …). @see pip-overlay-registry.js */
		pipOverlays: [],
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
/**
 * @param {Array<Record<string, unknown>>} mapped
 */
function decadeAlignIfNeeded(mapped) {
	if (!Array.isArray(mapped) || mapped.length === 0) return mapped
	const allDecade = mapped.every((l) => {
		const n = Number(l.layerNumber)
		return Number.isFinite(n) && n >= LOOK_LAYER_FIRST && n % LOOK_LAYER_STEP === 0
	})
	const nums = mapped.map((l) => Number(l.layerNumber)).filter((n) => Number.isFinite(n))
	const unique = new Set(nums).size === nums.length
	if (allDecade && unique) return mapped
	const sorted = [...mapped].sort((a, b) => (a.layerNumber ?? 0) - (b.layerNumber ?? 0))
	return sorted.map((l, i) => ({
		...l,
		layerNumber: LOOK_LAYER_FIRST + i * LOOK_LAYER_STEP,
	}))
}

export function migrateScene(s) {
	const id = s.id || newId()
	const layers = decadeAlignIfNeeded(
		Array.isArray(s.layers)
			? s.layers.map((l, i) => {
					const f = { ...defaultFill(), ...(l.fill || {}) }
					if (!Number.isFinite(f.x)) f.x = 0
					if (!Number.isFinite(f.y)) f.y = 0
					if (!Number.isFinite(f.scaleX)) f.scaleX = 1
					if (!Number.isFinite(f.scaleY)) f.scaleY = 1
					const base = {
						...defaultLayerConfig(l.layerNumber ?? LOOK_LAYER_FIRST + i),
						...l,
						fill: f,
						transition: l.transition ?? null,
					}
					if (base.contentFit == null) {
						base.contentFit = l.fillNativeAspect === false ? 'stretch' : 'native'
					}
					if (base.aspectLocked == null) base.aspectLocked = true
					if (!base.fadeOnEnd || typeof base.fadeOnEnd !== 'object') {
						base.fadeOnEnd = { enabled: false, frames: 12 }
					}
					if (!Array.isArray(base.pipOverlays)) {
						if (base.pipOverlay && typeof base.pipOverlay === 'object' && base.pipOverlay.type) {
							base.pipOverlays = [
								{
									type: base.pipOverlay.type,
									params: { ...(base.pipOverlay.params || {}) },
								},
							]
						} else {
							base.pipOverlays = []
						}
					}
					delete base.pipOverlay
					return base
				})
			: []
	)
	return {
		id,
		name: s.name || 'Untitled look',
		layers,
		mainScope: normalizeMainScopeFromImport(s),
		defaultTransition: { ...defaultTransition(), ...(s.defaultTransition || {}) },
	}
}

/**
 * Per-main scope: which PGM/PRV space owns this look, or `all` for every main.
 * Legacy projects omit this → `all` so existing looks stay visible on every main after upgrade.
 * @param {object} s
 * @returns {'all' | '0' | '1' | '2' | '3'}
 */
function normalizeMainScopeFromImport(s) {
	const raw = s.mainScope
	if (raw === 'all') return 'all'
	if (raw == null || raw === '') return 'all'
	const t = String(raw).trim()
	if (t === 'all') return 'all'
	if (/^[0-3]$/.test(t)) return /** @type {'0' | '1' | '2' | '3'} */ (t)
	return 'all'
}

export { defaultFill }
