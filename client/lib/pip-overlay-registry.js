/**
 * PIP Overlay registry — catalog of HTML-template-based overlay effects for PIP layers.
 * CG runs on {@link resolvePipOverlayCasparLayer} in the reserved 260–979 band (WO-160).
 *
 * @see 25_WO_PIP_OVERLAY_EFFECTS.md
 */

/** PIP overlay band base — must match server `src/engine/look-layer-ranges.js`. */
export const PIP_OVERLAY_BAND_BASE = 260

/** Max stacked HTML overlays above one PIP (border + shadow + …). WO-160: 8 → 4. */
export const PIP_OVERLAY_MAX_STACK = 4

/** Look layer band bounds — must match server `src/engine/look-layer-ranges.js`. */
const LOOK_LAYER_MIN = 10
const LOOK_LAYER_MAX = 99
const BANK_B_OFFSET = 100
const CONTENT_INDEX_MAX = 2 * (LOOK_LAYER_MAX - LOOK_LAYER_MIN + 1) - 1

/**
 * Compact index of a look content physical layer (WO-160): bank A 10–99 → 0–89,
 * bank B 110–199 → 90–179. Out-of-band input is clamped.
 * Must match `pipOverlayContentIndex` in src/engine/pip-overlay-utils.js.
 */
function pipOverlayContentIndex(contentPhysicalLayer) {
	const p = Number(contentPhysicalLayer)
	if (!Number.isFinite(p)) return 0
	const idx =
		p <= LOOK_LAYER_MAX
			? p - LOOK_LAYER_MIN
			: LOOK_LAYER_MAX - LOOK_LAYER_MIN + 1 + (p - (BANK_B_OFFSET + LOOK_LAYER_MIN))
	return Math.max(0, Math.min(CONTENT_INDEX_MAX, Math.round(idx)))
}

/**
 * PIP overlay Caspar layer — pure function of content physical layer + stack index
 * (`260 + compactIndex * 4 + stackIndex` → 260–979, both banks).
 * Must match {@link ../../src/engine/pip-overlay-utils.js overlayLayerSlot}.
 */
export function overlayLayerSlot(contentLayer, stackIndex = 0) {
	const i = Math.max(0, Math.min(PIP_OVERLAY_MAX_STACK - 1, stackIndex | 0))
	return PIP_OVERLAY_BAND_BASE + pipOverlayContentIndex(contentLayer) * PIP_OVERLAY_MAX_STACK + i
}

/**
 * Same as {@link overlayLayerSlot}. `nextContentLayer` is accepted for call-site
 * compatibility but ignored (WO-160) — slots no longer depend on neighbouring layers.
 * @param {number|undefined} _nextContentLayer — deprecated, unused
 */
export function resolvePipOverlayCasparLayer(contentPhysicalLayer, stackIndex, _nextContentLayer) {
	return overlayLayerSlot(contentPhysicalLayer, stackIndex)
}

export function overlayLayer(contentLayer) {
	return overlayLayerSlot(contentLayer, 0)
}

/**
 * Normalize layer storage: `pipOverlays[]` or legacy single `pipOverlay`.
 * @param {object | null | undefined} layer
 * @returns {{ type: string, params: object }[]}
 */
export function getPipOverlaysFromLayer(layer) {
	if (!layer || typeof layer !== 'object') return []
	if (Array.isArray(layer.pipOverlays) && layer.pipOverlays.length) {
		return layer.pipOverlays.filter((o) => o && typeof o === 'object' && o.type)
	}
	if (layer.pipOverlay && typeof layer.pipOverlay === 'object' && layer.pipOverlay.type) {
		return [layer.pipOverlay]
	}
	return []
}

/**
 * @typedef {object} PipOverlayParamSchema
 * @property {string} key
 * @property {string} label
 * @property {'float'|'int'|'select'|'bool'|'color'} type
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {number} [decimals]
 * @property {string[]} [options]
 * @property {*} [default]
 */

/**
 * @typedef {object} PipOverlayDefinition
 * @property {string} type
 * @property {string} label
 * @property {string} icon
 * @property {string} template - CasparCG template name (without .html)
 * @property {object} defaults
 * @property {PipOverlayParamSchema[]} schema
 */

/** @type {PipOverlayDefinition[]} */
export const PIP_OVERLAYS = [
	{
		type: 'border',
		label: 'Border',
		icon: '',
		template: 'pip_border',
		defaults: {
			width: 4,
			color: '#e63946',
			radius: 0,
			opacity: 1,
			side: 'outside',
		},
		schema: [
			{ key: 'side', label: 'Side', type: 'select', options: ['inside', 'outside'], default: 'outside' },
			{ key: 'width', label: 'Width', type: 'float', min: 0, max: 50, step: 1, decimals: 0, default: 4, slider: true },
			{ key: 'color', label: 'Color', type: 'color', default: '#e63946' },
			{ key: 'radius', label: 'Corner Radius', type: 'float', min: 0, max: 50, step: 1, decimals: 0, default: 0, slider: true },
			{ key: 'opacity', label: 'Opacity', type: 'float', min: 0, max: 1, step: 0.05, decimals: 2, default: 1, slider: true },
		],
	},
	{
		type: 'shadow',
		label: 'Drop Shadow',
		icon: '',
		template: 'pip_shadow',
		defaults: {
			blur: 20,
			offsetX: 5,
			offsetY: 5,
			color: 'rgba(0,0,0,0.6)',
			spread: 0,
			radius: 0,
			side: 'outside',
			opacity: 1,
		},
		schema: [
			{ key: 'side', label: 'Side', type: 'select', options: ['inside', 'outside'], default: 'outside' },
			{ key: 'opacity', label: 'Opacity', type: 'float', min: 0, max: 1, step: 0.05, decimals: 2, default: 1, slider: true },
			{ key: 'blur', label: 'Blur', type: 'float', min: 0, max: 100, step: 1, decimals: 0, default: 20, slider: true },
			{ key: 'offsetX', label: 'Offset X', type: 'float', min: -50, max: 50, step: 1, decimals: 0, default: 5, slider: true },
			{ key: 'offsetY', label: 'Offset Y', type: 'float', min: -50, max: 50, step: 1, decimals: 0, default: 5, slider: true },
			{ key: 'color', label: 'Color', type: 'color', default: 'rgba(0,0,0,0.6)' },
			{ key: 'spread', label: 'Spread', type: 'float', min: -20, max: 20, step: 1, decimals: 0, default: 0, slider: true },
			{ key: 'radius', label: 'Corner Radius', type: 'float', min: 0, max: 50, step: 1, decimals: 0, default: 0, slider: true },
		],
	},
	{
		type: 'edge_strip',
		label: 'Edge Strip',
		icon: '',
		template: 'pip_edge_strip',
		defaults: {
			direction: 'cw',
			count: 1,
			thickness: 3,
			color: '#e63946',
			speed: 2,
			length: 28,
			glow: true,
			glowColor: '#ff6b6b',
			glowWidth: 5,
			roundedTips: false,
			side: 'outside',
			opacity: 1,
		},
		schema: [
			{ key: 'side', label: 'Side', type: 'select', options: ['inside', 'outside'], default: 'outside' },
			{ key: 'opacity', label: 'Opacity', type: 'float', min: 0, max: 1, step: 0.05, decimals: 2, default: 1, slider: true },
			{
				key: 'direction',
				label: 'Flow (clockwise vs counter-clockwise around PIP)',
				type: 'select',
				options: ['cw', 'ccw'],
				default: 'cw',
			},
			{
				key: 'count',
				label: 'Concurrent strips (evenly spaced around the frame edge)',
				type: 'int',
				min: 1,
				max: 12,
				step: 1,
				decimals: 0,
				default: 1,
				slider: true,
			},
			{ key: 'thickness', label: 'Thickness', type: 'float', min: 1, max: 20, step: 1, decimals: 0, default: 3, slider: true },
			{ key: 'color', label: 'Color', type: 'color', default: '#e63946' },
			{ key: 'speed', label: 'Loop (sec)', type: 'float', min: 0.1, max: 10, step: 0.1, decimals: 1, default: 2, slider: true },
			{
				key: 'length',
				label: 'Strip length % of edge',
				type: 'float',
				min: 5,
				max: 100,
				step: 1,
				decimals: 0,
				default: 28,
				slider: true,
			},
			{ key: 'glow', label: 'Glow Trail', type: 'bool', default: true },
			{ key: 'glowColor', label: 'Glow Color', type: 'color', default: '#ff6b6b' },
			{ key: 'glowWidth', label: 'Glow Width', type: 'float', min: 1, max: 50, step: 1, decimals: 0, default: 5, slider: true },
			{ key: 'roundedTips', label: 'Rounded Tips', type: 'bool', default: false },
		],
	},
	{
		type: 'glow',
		label: 'Glow',
		icon: '',
		template: 'pip_glow',
		defaults: {
			color: '#e63946',
			intensity: 15,
			width: 0,
			pulse: true,
			pulseSpeed: 2,
			minOpacity: 0.4,
			radius: 0,
			side: 'outside',
			opacity: 1,
		},
		schema: [
			{ key: 'side', label: 'Side', type: 'select', options: ['inside', 'outside'], default: 'outside' },
			{ key: 'opacity', label: 'Opacity', type: 'float', min: 0, max: 1, step: 0.05, decimals: 2, default: 1, slider: true },
			{ key: 'color', label: 'Color', type: 'color', default: '#e63946' },
			{ key: 'intensity', label: 'Intensity (Blur)', type: 'float', min: 1, max: 50, step: 1, decimals: 0, default: 15, slider: true },
			{ key: 'width', label: 'Width (Spread)', type: 'float', min: 0, max: 50, step: 1, decimals: 0, default: 0, slider: true },
			{ key: 'pulse', label: 'Pulse', type: 'bool', default: true },
			{
				key: 'pulseSpeed',
				label: 'Pulse Speed (sec)',
				type: 'float',
				min: 0.5,
				max: 8,
				step: 0.1,
				decimals: 1,
				default: 2,
				slider: true,
			},
			{ key: 'minOpacity', label: 'Min Opacity', type: 'float', min: 0, max: 1, step: 0.05, decimals: 2, default: 0.4, slider: true },
			{ key: 'radius', label: 'Corner Radius', type: 'float', min: 0, max: 50, step: 1, decimals: 0, default: 0, slider: true },
		],
	},
	{
		type: 'router',
		label: 'Router (Multi-Effect)',
		icon: '',
		template: 'pip_router',
		defaults: { radius: 0, effects: [] },
		schema: [
			{ key: 'radius', label: 'Corner Radius', type: 'float', min: 0, max: 50, step: 1, decimals: 0, default: 0, slider: true },
		],
	},
]

/** @type {Map<string, PipOverlayDefinition>} */
export const PIP_OVERLAY_MAP = new Map(PIP_OVERLAYS.map((o) => [o.type, o]))

/** Template filenames that must exist in Caspar's template folder. */
export const PIP_OVERLAY_TEMPLATE_FILES = PIP_OVERLAYS.map((o) => o.template + '.html')

/**
 * Create a default overlay instance.
 * @param {string} type
 * @returns {{ type: string, params: object } | null}
 */
export function createPipOverlayInstance(type) {
	const def = PIP_OVERLAY_MAP.get(type)
	if (!def) return null
	return { type, params: { ...def.defaults } }
}
