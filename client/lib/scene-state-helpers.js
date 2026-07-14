import { fullFill } from './fill-math.js'
import {
	AUTO_TRANSITION_DURATION_SENTINEL,
	transitionDurationForFps,
} from './transition-duration.js'

/**
 * Main look clips on PGM/PRV use consecutive layers 10, 11, 12… (WO-160); layers 1–9 are
 * reserved (e.g. black CG, channel chrome). PIP overlay CG lives in its own band (260+),
 * timelines at 210+ — must match server `src/engine/look-layer-ranges.js`.
 */
export const LOOK_LAYER_FIRST = 10
export const LOOK_LAYER_STEP = 1
/** Bank-A look stack upper bound (90 layers/look; timeline band starts at 210). */
export const LOOK_LAYER_MAX = 99

/** @param {number} n */
export function isValidLookLayerNumber(n) {
	const num = Math.round(Number(n))
	return Number.isFinite(num) && num >= LOOK_LAYER_FIRST && num <= LOOK_LAYER_MAX
}

/**
 * Lowest free layer number ≥ 10 for a new layer in this look (WO-160 consecutive scheme).
 * @param {{ layers?: Array<{ layerNumber?: number }> } | null | undefined} scene
 * @returns {number} the next free number, or -1 when the look is full (90 layers)
 */
export function nextLayerNumber(scene) {
	const used = new Set(
		(scene?.layers || []).map((l) => Number(l?.layerNumber)).filter((n) => Number.isFinite(n)),
	)
	for (let c = LOOK_LAYER_FIRST; c <= LOOK_LAYER_MAX; c++) {
		if (!used.has(c)) return c
	}
	return -1
}

/** Operator feedback when {@link nextLayerNumber} returns -1. */
export const LOOK_FULL_MESSAGE = `Look is full (${LOOK_LAYER_MAX - LOOK_LAYER_FIRST + 1} layers)`

/** @returns {import('./fill-math.js').FillLike} */
function defaultFill() {
	return { ...fullFill() }
}

/** @param {number} [fps] — when set, duration is half fps; otherwise auto sentinel until fps is known */
export function defaultTransition(fps) {
	// MIX + frames ≈ fade to program when taking a look (Caspar load transition).
	const duration =
		fps != null ? transitionDurationForFps(fps) : AUTO_TRANSITION_DURATION_SENTINEL
	return { type: 'MIX', duration, tween: 'linear' }
}

/**
 * @returns {import('./scene-state.js').LayerConfig}
 */
/**
 * PRV uses the same Caspar layer numbers as PGM (layer 9 = black CG; look clips at 10, 11, 12…; PIP/CG in the 260+ band).
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
		/** Source audio channel selection for route sources (e.g. route://): 'all' | '1+2' | '3+4' | '5+6' | '7+8'. */
		routeSourceAudio: 'all',
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
		sourceMode: 'single',
		playlist: [],
		playlistTransition: { type: 'MIX', duration: AUTO_TRANSITION_DURATION_SENTINEL, tween: 'linear' },
		playlistLoop: true,
		playlistAdvance: 'auto',
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
 * WO-160 one-way migration: renumber layers to consecutive-from-10 (10, 11, 12, …) by
 * current ascending layerNumber order unless they already are. Legacy decade looks
 * (10/20/30) and >99 overflow (100/110/…) fold into the sequence; z-order is preserved
 * (z derives from layerNumber, and renumbering is order-preserving).
 * @param {Array<Record<string, unknown>>} mapped
 */
function consecutiveAlignIfNeeded(mapped) {
	if (!Array.isArray(mapped) || mapped.length === 0) return mapped
	const nums = mapped.map((l) => Number(l.layerNumber))
	const allFinite = nums.every((n) => Number.isFinite(n))
	const unique = new Set(nums).size === nums.length
	if (
		allFinite &&
		unique &&
		Math.min(...nums) === LOOK_LAYER_FIRST &&
		Math.max(...nums) === LOOK_LAYER_FIRST + mapped.length - 1
	) {
		return mapped
	}
	const sorted = [...mapped].sort((a, b) => (Number(a.layerNumber) || 0) - (Number(b.layerNumber) || 0))
	console.warn('[scene-migrate] WO-160: look layers renumbered to consecutive numbers from 10 (one-way)')
	return sorted.map((l, i) => ({
		...l,
		layerNumber: LOOK_LAYER_FIRST + i * LOOK_LAYER_STEP,
	}))
}

export function migrateScene(s) {
	const id = s.id || newId()
	const layers = consecutiveAlignIfNeeded(
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
					if (base.sourceMode == null) base.sourceMode = 'single'
					if (!Array.isArray(base.playlist)) base.playlist = []
					if (!base.playlistTransition || typeof base.playlistTransition !== 'object') {
						base.playlistTransition = { type: 'MIX', duration: AUTO_TRANSITION_DURATION_SENTINEL, tween: 'linear' }
					}
					if (base.playlistLoop == null) base.playlistLoop = true
					if (base.playlistAdvance == null) base.playlistAdvance = 'auto'
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
		globalBorder: s.globalBorder ? {
			...s.globalBorder,
			params: { ...(s.globalBorder.params || {}), side: 'inside' }, // enforce inside
			slices: Array.isArray(s.globalBorder.slices) ? s.globalBorder.slices : [],
			artnetPatch: { startChannel: 1, universe: 0, ...(s.globalBorder.artnetPatch || {}) },
			activePgmLayer: Number(s.globalBorder.activePgmLayer) === 996 ? 996 : 998,
		} : {
			enabled: false,
			type: 'border',
			params: { side: 'inside' },
			slices: [],
			artnetPatch: { startChannel: 1, universe: 0 }
		}
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
