/**
 * Effect registry — catalog of all CasparCG mixer effects.
 * Each entry defines the type key, display label, icon, category, default params,
 * and parameter schema for building inspector UI editors.
 *
 * @see Client-master/src/Core/Commands/ (official CasparCG Client mixer commands)
 * @see Client-master/src/Common/Global.h Mixer:: namespace for defaults
 * @see 22_WO_MIXER_EFFECTS.md
 */

/**
 * Blend modes available in CasparCG.
 * @type {string[]}
 */
export const BLEND_MODES = [
	'normal', 'add', 'alpha', 'multiply', 'overlay',
	'screen', 'hardlight', 'softlight', 'difference',
]

/**
 * Chroma key presets available in CasparCG.
 * @type {string[]}
 */
export const CHROMA_KEY_TYPES = ['None', 'Green', 'Blue']

/**
 * @typedef {object} EffectParamSchema
 * @property {string} key - Parameter key stored in params
 * @property {string} label - Display label
 * @property {'float'|'int'|'select'|'bool'} type - Editor type
 * @property {number} [min] - Minimum value (float/int)
 * @property {number} [max] - Maximum value (float/int)
 * @property {number} [step] - Step value
 * @property {number} [decimals] - Decimal places
 * @property {string[]} [options] - Select options
 * @property {*} [default] - Default value
 */

/**
 * @typedef {object} EffectDefinition
 * @property {string} type - Unique type key (used in effects array on clips/layers)
 * @property {string} label - Display name in the Effects tab and inspector
 * @property {string} icon - Emoji icon for the effect
 * @property {string} category - Grouping category (compositing, color, geometry, keying)
 * @property {object} defaults - Default parameter values
 * @property {EffectParamSchema[]} schema - Parameter schema for building editors
 * @property {string} amcpCommand - The AMCP mixer sub-command (lowercase)
 */

/** @type {EffectDefinition[]} */
export const MIXER_EFFECTS = [
	{
		type: 'blend_mode',
		label: 'Blend Mode',
		icon: '🎨',
		category: 'compositing',
		amcpCommand: 'blend',
		defaults: { mode: 'normal' },
		schema: [
			{ key: 'mode', label: 'Mode', type: 'select', options: BLEND_MODES, default: 'normal' },
		],
	},
	{
		type: 'brightness',
		label: 'Brightness',
		icon: '☀️',
		category: 'color',
		amcpCommand: 'brightness',
		defaults: { value: 1 },
		schema: [
			{ key: 'value', label: 'Brightness', type: 'float', min: 0, max: 2, step: 0.01, decimals: 2, default: 1 },
		],
	},
	{
		type: 'contrast',
		label: 'Contrast',
		icon: '◑',
		category: 'color',
		amcpCommand: 'contrast',
		defaults: { value: 1 },
		schema: [
			{ key: 'value', label: 'Contrast', type: 'float', min: 0, max: 2, step: 0.01, decimals: 2, default: 1 },
		],
	},
	{
		type: 'saturation',
		label: 'Saturation',
		icon: '🌈',
		category: 'color',
		amcpCommand: 'saturation',
		defaults: { value: 1 },
		schema: [
			{ key: 'value', label: 'Saturation', type: 'float', min: 0, max: 2, step: 0.01, decimals: 2, default: 1 },
		],
	},
	{
		type: 'levels',
		label: 'Levels',
		icon: '📊',
		category: 'color',
		amcpCommand: 'levels',
		defaults: { minIn: 0, maxIn: 1, gamma: 1, minOut: 0, maxOut: 1 },
		schema: [
			{ key: 'minIn', label: 'Min In', type: 'float', min: 0, max: 1, step: 0.01, decimals: 2, default: 0 },
			{ key: 'maxIn', label: 'Max In', type: 'float', min: 0, max: 1, step: 0.01, decimals: 2, default: 1 },
			{ key: 'gamma', label: 'Gamma', type: 'float', min: 0, max: 4, step: 0.01, decimals: 2, default: 1 },
			{ key: 'minOut', label: 'Min Out', type: 'float', min: 0, max: 1, step: 0.01, decimals: 2, default: 0 },
			{ key: 'maxOut', label: 'Max Out', type: 'float', min: 0, max: 1, step: 0.01, decimals: 2, default: 1 },
		],
	},
	{
		type: 'chroma_key',
		label: 'Chroma Key',
		icon: '🟩',
		category: 'keying',
		amcpCommand: 'chroma',
		defaults: { key: 'None', threshold: 0.34, softness: 0.44, spill: 1, blur: 0 },
		schema: [
			{ key: 'key', label: 'Key', type: 'select', options: CHROMA_KEY_TYPES, default: 'None' },
			{ key: 'threshold', label: 'Threshold', type: 'float', min: 0, max: 1, step: 0.01, decimals: 2, default: 0.34 },
			{ key: 'softness', label: 'Softness', type: 'float', min: 0, max: 1, step: 0.01, decimals: 2, default: 0.44 },
			{ key: 'spill', label: 'Spill', type: 'float', min: 0, max: 2, step: 0.01, decimals: 2, default: 1 },
			{ key: 'blur', label: 'Blur', type: 'float', min: 0, max: 2, step: 0.01, decimals: 2, default: 0 },
		],
	},
	{
		type: 'crop',
		label: 'Crop',
		icon: '✂️',
		category: 'geometry',
		amcpCommand: 'crop',
		defaults: { left: 0, top: 0, right: 1, bottom: 1 },
		schema: [
			{ key: 'left', label: 'Left', type: 'float', min: 0, max: 1, step: 0.01, decimals: 3, default: 0 },
			{ key: 'top', label: 'Top', type: 'float', min: 0, max: 1, step: 0.01, decimals: 3, default: 0 },
			{ key: 'right', label: 'Right', type: 'float', min: 0, max: 1, step: 0.01, decimals: 3, default: 1 },
			{ key: 'bottom', label: 'Bottom', type: 'float', min: 0, max: 1, step: 0.01, decimals: 3, default: 1 },
		],
	},
	{
		type: 'clip_mask',
		label: 'Clip (Mask)',
		icon: '🎭',
		category: 'geometry',
		amcpCommand: 'clip',
		defaults: { left: 0, width: 1, top: 0, height: 1 },
		schema: [
			{ key: 'left', label: 'Left', type: 'float', min: 0, max: 1, step: 0.01, decimals: 3, default: 0 },
			{ key: 'width', label: 'Width', type: 'float', min: 0, max: 1, step: 0.01, decimals: 3, default: 1 },
			{ key: 'top', label: 'Top', type: 'float', min: 0, max: 1, step: 0.01, decimals: 3, default: 0 },
			{ key: 'height', label: 'Height', type: 'float', min: 0, max: 1, step: 0.01, decimals: 3, default: 1 },
		],
	},
	{
		type: 'perspective',
		label: 'Perspective',
		icon: '📐',
		category: 'geometry',
		amcpCommand: 'perspective',
		defaults: { ulX: 0, ulY: 0, urX: 1, urY: 0, lrX: 1, lrY: 1, llX: 0, llY: 1 },
		schema: [
			{ key: 'ulX', label: 'Upper-Left X', type: 'float', min: -1, max: 2, step: 0.01, decimals: 3, default: 0 },
			{ key: 'ulY', label: 'Upper-Left Y', type: 'float', min: -1, max: 2, step: 0.01, decimals: 3, default: 0 },
			{ key: 'urX', label: 'Upper-Right X', type: 'float', min: -1, max: 2, step: 0.01, decimals: 3, default: 1 },
			{ key: 'urY', label: 'Upper-Right Y', type: 'float', min: -1, max: 2, step: 0.01, decimals: 3, default: 0 },
			{ key: 'lrX', label: 'Lower-Right X', type: 'float', min: -1, max: 2, step: 0.01, decimals: 3, default: 1 },
			{ key: 'lrY', label: 'Lower-Right Y', type: 'float', min: -1, max: 2, step: 0.01, decimals: 3, default: 1 },
			{ key: 'llX', label: 'Lower-Left X', type: 'float', min: -1, max: 2, step: 0.01, decimals: 3, default: 0 },
			{ key: 'llY', label: 'Lower-Left Y', type: 'float', min: -1, max: 2, step: 0.01, decimals: 3, default: 1 },
		],
	},
	{
		type: 'grid',
		label: 'Grid',
		icon: '⊞',
		category: 'geometry',
		amcpCommand: 'grid',
		defaults: { resolution: 2 },
		schema: [
			{ key: 'resolution', label: 'Columns', type: 'int', min: 1, max: 16, step: 1, decimals: 0, default: 2 },
		],
	},
	{
		type: 'keyer',
		label: 'Keyer (Alpha)',
		icon: '🔑',
		category: 'keying',
		amcpCommand: 'keyer',
		defaults: { enabled: true },
		schema: [
			{ key: 'enabled', label: 'Enable Keyer', type: 'bool', default: true },
		],
	},
	{
		type: 'rotation',
		label: 'Rotation',
		icon: '🔄',
		category: 'geometry',
		amcpCommand: 'rotation',
		defaults: { degrees: 0 },
		schema: [
			{ key: 'degrees', label: 'Degrees', type: 'float', min: -360, max: 360, step: 0.5, decimals: 1, default: 0 },
		],
	},
	{
		type: 'anchor',
		label: 'Anchor Point',
		icon: '⚓',
		category: 'geometry',
		amcpCommand: 'anchor',
		defaults: { x: 0, y: 0 },
		schema: [
			{ key: 'x', label: 'X', type: 'float', min: -1, max: 2, step: 0.01, decimals: 3, default: 0 },
			{ key: 'y', label: 'Y', type: 'float', min: -1, max: 2, step: 0.01, decimals: 3, default: 0 },
		],
	},
]

/**
 * Map of effect type → definition for fast lookup.
 * @type {Map<string, EffectDefinition>}
 */
export const EFFECT_MAP = new Map(MIXER_EFFECTS.map((e) => [e.type, e]))

/**
 * Category ordering for the Effects tab in the sources panel.
 * @type {Array<{ id: string, label: string }>}
 */
export const EFFECT_CATEGORIES = [
	{ id: 'compositing', label: 'Compositing' },
	{ id: 'color', label: 'Color' },
	{ id: 'keying', label: 'Keying' },
	{ id: 'geometry', label: 'Geometry' },
]

/**
 * Create a new default effect instance from the registry.
 * @param {string} effectType
 * @returns {{ type: string, params: object } | null}
 */
export function createEffectInstance(effectType) {
	const def = EFFECT_MAP.get(effectType)
	if (!def) return null
	return {
		type: effectType,
		params: { ...def.defaults },
	}
}

/**
 * Build the AMCP mixer command body for a single effect.
 * Returns an object suitable for POST /api/mixer/{command}.
 * @param {string} effectType
 * @param {object} params
 * @param {number} channel
 * @param {number} layer
 * @returns {{ command: string, body: object } | null}
 */
export function effectToAmcpBody(effectType, params, channel, layer) {
	const def = EFFECT_MAP.get(effectType)
	if (!def) return null
	const merged = { ...def.defaults, ...params }
	const base = { channel, layer }

	switch (effectType) {
		case 'blend_mode':
			return { command: 'blend', body: { ...base, mode: merged.mode } }
		case 'brightness':
			return { command: 'brightness', body: { ...base, value: merged.value } }
		case 'contrast':
			return { command: 'contrast', body: { ...base, value: merged.value } }
		case 'saturation':
			return { command: 'saturation', body: { ...base, value: merged.value } }
		case 'levels':
			return { command: 'levels', body: { ...base, minIn: merged.minIn, maxIn: merged.maxIn, gamma: merged.gamma, minOut: merged.minOut, maxOut: merged.maxOut } }
		case 'chroma_key':
			return { command: 'chroma', body: { ...base, key: merged.key, threshold: merged.threshold, softness: merged.softness, spill: merged.spill, blur: merged.blur } }
		case 'crop':
			return { command: 'crop', body: { ...base, left: merged.left, top: merged.top, right: merged.right, bottom: merged.bottom } }
		case 'clip_mask':
			return { command: 'clip', body: { ...base, x: merged.left, y: merged.top, xScale: merged.width, yScale: merged.height } }
		case 'perspective':
			return { command: 'perspective', body: { ...base, ulX: merged.ulX, ulY: merged.ulY, urX: merged.urX, urY: merged.urY, lrX: merged.lrX, lrY: merged.lrY, llX: merged.llX, llY: merged.llY } }
		case 'grid':
			return { command: 'grid', body: { ...base, resolution: merged.resolution } }
		case 'keyer':
			return { command: 'keyer', body: { ...base, keyer: merged.enabled ? 1 : 0 } }
		case 'rotation':
			return { command: 'rotation', body: { ...base, degrees: merged.degrees } }
		case 'anchor':
			return { command: 'anchor', body: { ...base, x: merged.x, y: merged.y } }
		default:
			return null
	}
}

/**
 * Build raw AMCP mixer command lines for a single effect (for batchSend).
 * @param {string} effectType
 * @param {object} params
 * @param {string} cl - "channel-layer" string e.g. "1-10"
 * @returns {string[] | null}
 */
export function effectToAmcpLines(effectType, params, cl) {
	const def = EFFECT_MAP.get(effectType)
	if (!def) return null
	const p = { ...def.defaults, ...params }

	switch (effectType) {
		case 'blend_mode':
			return [`MIXER ${cl} BLEND ${String(p.mode || 'Normal').toUpperCase()}`]
		case 'brightness':
			return [`MIXER ${cl} BRIGHTNESS ${p.value} 0`]
		case 'contrast':
			return [`MIXER ${cl} CONTRAST ${p.value} 0`]
		case 'saturation':
			return [`MIXER ${cl} SATURATION ${p.value} 0`]
		case 'levels':
			return [`MIXER ${cl} LEVELS ${p.minIn} ${p.maxIn} ${p.gamma} ${p.minOut} ${p.maxOut} 0`]
		case 'chroma_key':
			return [`MIXER ${cl} CHROMA ${p.key} ${p.threshold} ${p.softness} ${p.spill} ${p.blur}`]
		case 'crop':
			return [`MIXER ${cl} CROP ${p.left} ${p.top} ${p.right} ${p.bottom} 0`]
		case 'clip_mask':
			return [`MIXER ${cl} CLIP ${p.left} ${p.top} ${p.width} ${p.height} 0`]
		case 'perspective':
			return [`MIXER ${cl} PERSPECTIVE ${p.ulX} ${p.ulY} ${p.urX} ${p.urY} ${p.lrX} ${p.lrY} ${p.llX} ${p.llY} 0`]
		case 'grid':
			return [`MIXER ${cl} GRID ${p.resolution} 0`]
		case 'keyer':
			return [`MIXER ${cl} KEYER ${p.enabled ? 1 : 0}`]
		case 'rotation':
			return [`MIXER ${cl} ROTATION ${p.degrees} 0`]
		case 'anchor':
			return [`MIXER ${cl} ANCHOR ${p.x} ${p.y} 0`]
		default:
			return null
	}
}
