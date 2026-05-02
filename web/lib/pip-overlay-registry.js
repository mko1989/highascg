/**
 * PIP Overlay registry — catalog of HTML-template-based overlay effects for PIP layers.
 * CG runs on {@link resolvePipOverlayCasparLayer} (aligned with video or legacy high band).
 *
 * @see 25_WO_PIP_OVERLAY_EFFECTS.md
 */

export const PIP_OVERLAY_LAYER_OFFSET = 100

/** Max stacked HTML overlays above one PIP (border + shadow + …). */
export const PIP_OVERLAY_MAX_STACK = 8

/** @see src/engine/pip-overlay.js — first PIP/CG layer = content + this (main clip stays on 10, 20, …). */
export const PIP_OVERLAY_ALIGN_GAP = 1

/** @deprecated legacy high-band slot — use resolvePipOverlayCasparLayer */
export function overlayLayerSlot(contentLayer, stackIndex = 0) {
	const i = Math.max(0, Math.min(PIP_OVERLAY_MAX_STACK - 1, stackIndex | 0))
	const base = Number(contentLayer)
	const n = Number.isFinite(base) ? base : 0
	return PIP_OVERLAY_LAYER_OFFSET + n * PIP_OVERLAY_MAX_STACK + i
}

/**
 * Must match {@link ../../src/engine/pip-overlay.js resolvePipOverlayCasparLayer}.
 * @param {number|undefined} nextContentLayer - Min other look layer &gt; this PIP
 */
export function resolvePipOverlayCasparLayer(contentPhysicalLayer, stackIndex, nextContentLayer) {
	const i = Math.max(0, Math.min(PIP_OVERLAY_MAX_STACK - 1, stackIndex | 0))
	const p = Number(contentPhysicalLayer)
	if (!Number.isFinite(p) || p < 0) {
		return PIP_OVERLAY_LAYER_OFFSET + i
	}
	let nx = nextContentLayer
	if (nx == null) {
		nx = p >= 10 && p % 10 === 0 ? p + 10 : p + 1
	} else if (typeof nx === 'string' && nx.trim() === '') {
		nx = 10000
	} else {
		nx = Number(nx)
	}
	if (!Number.isFinite(nx) || nx <= p) {
		nx = 10000
	}
	if (p + PIP_OVERLAY_ALIGN_GAP + i < nx) {
		return p + PIP_OVERLAY_ALIGN_GAP + i
	}
	return PIP_OVERLAY_LAYER_OFFSET + p * PIP_OVERLAY_MAX_STACK + i
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
		icon: '🔲',
		template: 'pip_border',
		defaults: { width: 4, color: '#e63946', radius: 0, opacity: 1, style: 'solid', gradientEnd: '#457b9d' },
		schema: [
			{ key: 'style', label: 'Style', type: 'select', options: ['solid', 'dashed', 'double', 'gradient'], default: 'solid' },
			{ key: 'width', label: 'Width', type: 'float', min: 0, max: 50, step: 1, decimals: 0, default: 4 },
			{ key: 'color', label: 'Color', type: 'color', default: '#e63946' },
			{ key: 'gradientEnd', label: 'Gradient End', type: 'color', default: '#457b9d' },
			{ key: 'radius', label: 'Corner Radius', type: 'float', min: 0, max: 50, step: 1, decimals: 0, default: 0 },
			{ key: 'opacity', label: 'Opacity', type: 'float', min: 0, max: 1, step: 0.05, decimals: 2, default: 1 },
		],
	},
	{
		type: 'shadow',
		label: 'Drop Shadow',
		icon: '🌑',
		template: 'pip_shadow',
		defaults: { blur: 20, offsetX: 5, offsetY: 5, color: 'rgba(0,0,0,0.6)', spread: 0 },
		schema: [
			{ key: 'blur', label: 'Blur', type: 'float', min: 0, max: 100, step: 1, decimals: 0, default: 20 },
			{ key: 'offsetX', label: 'Offset X', type: 'float', min: -50, max: 50, step: 1, decimals: 0, default: 5 },
			{ key: 'offsetY', label: 'Offset Y', type: 'float', min: -50, max: 50, step: 1, decimals: 0, default: 5 },
			{ key: 'color', label: 'Color', type: 'color', default: 'rgba(0,0,0,0.6)' },
			{ key: 'spread', label: 'Spread', type: 'float', min: -20, max: 20, step: 1, decimals: 0, default: 0 },
		],
	},
	{
		type: 'edge_strip',
		label: 'Edge Strip',
		icon: '⚡',
		template: 'pip_edge_strip',
		defaults: {
			direction: 'cw',
			count: 3,
			thickness: 3,
			color: '#e63946',
			speed: 2,
			length: 28,
			glow: true,
			glowColor: '#ff6b6b',
		},
		schema: [
			{
				key: 'direction',
				label: 'Flow (clockwise vs counter-clockwise around PIP)',
				type: 'select',
				options: ['cw', 'ccw'],
				default: 'cw',
			},
			{ key: 'count', label: 'Strips per edge', type: 'float', min: 1, max: 12, step: 1, decimals: 0, default: 3 },
			{ key: 'thickness', label: 'Thickness', type: 'float', min: 1, max: 20, step: 1, decimals: 0, default: 3 },
			{ key: 'color', label: 'Color', type: 'color', default: '#e63946' },
			{ key: 'speed', label: 'Loop (sec)', type: 'float', min: 0.1, max: 10, step: 0.1, decimals: 1, default: 2 },
			{ key: 'length', label: 'Strip length % of edge', type: 'float', min: 5, max: 100, step: 1, decimals: 0, default: 28 },
			{ key: 'glow', label: 'Glow Trail', type: 'bool', default: true },
			{ key: 'glowColor', label: 'Glow Color', type: 'color', default: '#ff6b6b' },
		],
	},
	{
		type: 'glow',
		label: 'Glow',
		icon: '✨',
		template: 'pip_glow',
		defaults: { color: '#e63946', intensity: 15, pulse: true, pulseSpeed: 2, minOpacity: 0.4 },
		schema: [
			{ key: 'color', label: 'Color', type: 'color', default: '#e63946' },
			{ key: 'intensity', label: 'Intensity', type: 'float', min: 1, max: 50, step: 1, decimals: 0, default: 15 },
			{ key: 'pulse', label: 'Pulse', type: 'bool', default: true },
			{ key: 'pulseSpeed', label: 'Pulse Speed (sec)', type: 'float', min: 0.5, max: 8, step: 0.1, decimals: 1, default: 2 },
			{ key: 'minOpacity', label: 'Min Opacity', type: 'float', min: 0, max: 1, step: 0.05, decimals: 2, default: 0.4 },
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
