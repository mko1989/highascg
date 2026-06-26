/**
 * Lower-third CG payload helpers — scene take (`layer.cgData`) and `/api/lower-thirds/*`.
 * Matches lt-engine.js field mapping: primary `name`, secondary `title` when both are set.
 */

export const DEFAULT_LOWER_THIRD_CONFIG = {
	title: '',
	subtitle: '',
	primaryColor: '#4fc3f7',
	textColor: '#ffffff',
	position: 'left',
	fontFamily: 'arial',
	titleFontSize: 46,
	subtitleFontSize: 27,
	renderScale: 100,
	displayDurationSec: 10,
}

/** System / Caspar-safe font choices (stored by `id` in config). */
export const LOWER_THIRD_FONT_OPTIONS = [
	{ id: 'arial', label: 'Arial', stack: "Arial, 'Helvetica Neue', Helvetica, sans-serif" },
	{ id: 'helvetica', label: 'Helvetica', stack: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
	{ id: 'georgia', label: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
	{ id: 'times', label: 'Times New Roman', stack: '"Times New Roman", Times, serif' },
	{ id: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
	{ id: 'trebuchet', label: 'Trebuchet MS', stack: '"Trebuchet MS", Helvetica, sans-serif' },
	{ id: 'impact', label: 'Impact', stack: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif' },
]

/**
 * @param {string} [fontFamilyId]
 * @returns {string} CSS font-family stack
 */
export function resolveLowerThirdFontStack(fontFamilyId) {
	const id = String(fontFamilyId || DEFAULT_LOWER_THIRD_CONFIG.fontFamily).toLowerCase()
	const found = LOWER_THIRD_FONT_OPTIONS.find((o) => o.id === id)
	return found ? found.stack : LOWER_THIRD_FONT_OPTIONS[0].stack
}

/** Debounced CG UPDATE from inspector edits (ms). */
export const LOWER_THIRD_CG_UPDATE_DEBOUNCE_MS = 450

/**
 * @param {unknown} value
 * @param {number} [fallback=10]
 * @returns {number}
 */
export function parseLowerThirdDisplayDurationSec(value, fallback = 10) {
	if (value === '' || value == null) return fallback
	const n = parseFloat(String(value))
	if (!Number.isFinite(n)) return fallback
	return Math.max(0, n)
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function parsePositiveNumber(value, fallback) {
	if (value === '' || value == null) return fallback
	const n = parseFloat(String(value))
	if (!Number.isFinite(n)) return fallback
	return Math.max(0, n)
}

/**
 * @param {object|null|undefined} source
 * @returns {boolean}
 */
export function isLowerThirdSource(source) {
	if (!source?.value) return false
	const v = String(source.value).toLowerCase().replace(/\\/g, '/')
	return v.includes('lower-thirds/lt-') || v.includes('lower_thirds/lt-')
}

/**
 * @param {string|null|undefined} srcValue
 * @returns {string}
 */
export function deriveTemplateId(srcValue) {
	if (!srcValue) return ''
	const m = String(srcValue).match(/lt-[\w-]+/i)
	return m ? m[0].toLowerCase() : ''
}

/**
 * @param {object} [config] — `lowerThirdConfig` from layer source
 * @returns {{ data: Record<string, string>, style: Record<string, string | number> }}
 */
export function buildLowerThirdCgData(config = {}) {
	const merged = { ...DEFAULT_LOWER_THIRD_CONFIG, ...config }
	const data = {}
	// Preserve internal / leading / trailing spaces — do not trim.
	const name = String(merged.title ?? merged.name ?? '')
	const secondary = String(merged.subtitle ?? merged.role ?? '')
	data.name = name
	data.title = secondary

	const style = {}
	const durationSec = parseLowerThirdDisplayDurationSec(merged.displayDurationSec)
	const titleFontSize = parsePositiveNumber(merged.titleFontSize, DEFAULT_LOWER_THIRD_CONFIG.titleFontSize)
	const subtitleFontSize = parsePositiveNumber(merged.subtitleFontSize, DEFAULT_LOWER_THIRD_CONFIG.subtitleFontSize)
	const renderScale = parsePositiveNumber(merged.renderScale, DEFAULT_LOWER_THIRD_CONFIG.renderScale)
	const fontFamilyId = String(merged.fontFamily || DEFAULT_LOWER_THIRD_CONFIG.fontFamily).toLowerCase()

	if (merged.primaryColor) style.primaryColor = merged.primaryColor
	if (merged.textColor) style.textColor = merged.textColor
	if (merged.position) style.position = merged.position
	style.displayDurationSec = durationSec
	style.titleFontSize = titleFontSize
	style.subtitleFontSize = subtitleFontSize
	style.renderScale = renderScale
	// Caspar AMCP / XML — send font id only (CSS stacks with commas break UPDATE commands).
	style.fontFamilyId = fontFamilyId

	// Mirror style into data — scene take / Caspar XML often flatten UPDATE payloads.
	data.displayDurationSec = String(durationSec)
	if (style.primaryColor) data.primaryColor = style.primaryColor
	if (style.textColor) data.textColor = style.textColor
	if (style.position) data.position = style.position
	data.titleFontSize = String(titleFontSize)
	data.subtitleFontSize = String(subtitleFontSize)
	data.renderScale = String(renderScale)
	data.fontFamily = fontFamilyId
	data.fontFamilyId = fontFamilyId

	return { data, style }
}

/**
 * Flat + nested cgData for scene take / Caspar (no comma-heavy style.fontFamily).
 * @param {object} [config]
 */
export function buildLowerThirdCasparCgData(config = {}) {
	const { data, style } = buildLowerThirdCgData(config)
	const safeStyle = { ...style }
	delete safeStyle.fontFamily
	return {
		...data,
		...safeStyle,
		data,
		style: safeStyle,
	}
}

/**
 * Body for `/api/lower-thirds/*` — includes routing + optional auto-hide duration.
 * @param {object} config
 * @param {{ channel?: number, layer?: number, templateHostLayer?: number, templateId?: string }} [routing]
 */
export function buildLowerThirdApiPayload(config, routing = {}) {
	const { data, style } = buildLowerThirdCgData(config)
	const safeStyle = { ...style }
	delete safeStyle.fontFamily
	return {
		...routing,
		data,
		style: safeStyle,
		displayDurationSec: style.displayDurationSec,
	}
}

/**
 * Ensure cgData uses the `{ data, style }` wrapper expected by scene take / Caspar CG.
 * @param {object} cgData
 * @returns {{ data: object, style: object }}
 */
export function normalizeLowerThirdCgData(cgData) {
	if (!cgData || typeof cgData !== 'object') {
		return { data: {}, style: {} }
	}
	if (cgData.data != null || cgData.style != null) {
		return {
			data: cgData.data && typeof cgData.data === 'object' ? { ...cgData.data } : {},
			style: cgData.style && typeof cgData.style === 'object' ? { ...cgData.style } : {},
		}
	}
	const {
		primaryColor,
		textColor,
		position,
		displayDurationSec,
		titleFontSize,
		subtitleFontSize,
		renderScale,
		fontFamily,
		fontFamilyId,
		name,
		title,
		subtitle,
		role,
		f0,
		f1,
		...rest
	} = cgData
	const data = { ...rest }
	if (name != null) data.name = name
	else if (f0 != null) data.f0 = f0
	else if (title != null && subtitle == null && role == null) data.title = title
	if (subtitle != null) data.subtitle = subtitle
	else if (role != null) data.role = role
	else if (f1 != null) data.f1 = f1
	else if (name != null && title != null) data.title = title

	const style = {}
	if (primaryColor) style.primaryColor = primaryColor
	if (textColor) style.textColor = textColor
	if (position) style.position = position
	style.displayDurationSec = parseLowerThirdDisplayDurationSec(displayDurationSec)
	if (titleFontSize != null) style.titleFontSize = parsePositiveNumber(titleFontSize, DEFAULT_LOWER_THIRD_CONFIG.titleFontSize)
	if (subtitleFontSize != null) {
		style.subtitleFontSize = parsePositiveNumber(subtitleFontSize, DEFAULT_LOWER_THIRD_CONFIG.subtitleFontSize)
	}
	if (renderScale != null) style.renderScale = parsePositiveNumber(renderScale, DEFAULT_LOWER_THIRD_CONFIG.renderScale)
	if (fontFamilyId) style.fontFamilyId = String(fontFamilyId)
	else if (fontFamily) {
		const id = String(fontFamily).toLowerCase()
		if (LOWER_THIRD_FONT_OPTIONS.some((o) => o.id === id)) {
			style.fontFamilyId = id
		}
	}
	return { data, style }
}

/**
 * Reverse {@link buildLowerThirdCgData} for inspector hydration / take merge.
 * @param {object} cgData
 * @returns {typeof DEFAULT_LOWER_THIRD_CONFIG}
 */
export function lowerThirdConfigFromCgData(cgData) {
	const { data, style } = normalizeLowerThirdCgData(cgData)
	const config = { ...DEFAULT_LOWER_THIRD_CONFIG }

	const primary = data.name ?? data.f0 ?? null
	const secondary = data.subtitle ?? data.role ?? data.f1 ?? null
	if (primary != null) config.title = String(primary)
	if (secondary != null) {
		config.subtitle = String(secondary)
	} else if (data.title != null && primary == null) {
		config.title = String(data.title)
	} else if (data.title != null && primary != null) {
		config.subtitle = String(data.title)
	}

	if (style.primaryColor) config.primaryColor = style.primaryColor
	if (style.textColor) config.textColor = style.textColor
	if (style.position) config.position = style.position
	if (style.displayDurationSec != null) {
		config.displayDurationSec = parseLowerThirdDisplayDurationSec(style.displayDurationSec)
	} else if (data.displayDurationSec != null) {
		config.displayDurationSec = parseLowerThirdDisplayDurationSec(data.displayDurationSec)
	}
	if (style.titleFontSize != null) {
		config.titleFontSize = parsePositiveNumber(style.titleFontSize, DEFAULT_LOWER_THIRD_CONFIG.titleFontSize)
	} else if (data.titleFontSize != null) {
		config.titleFontSize = parsePositiveNumber(data.titleFontSize, DEFAULT_LOWER_THIRD_CONFIG.titleFontSize)
	}
	if (style.subtitleFontSize != null) {
		config.subtitleFontSize = parsePositiveNumber(style.subtitleFontSize, DEFAULT_LOWER_THIRD_CONFIG.subtitleFontSize)
	} else if (data.subtitleFontSize != null) {
		config.subtitleFontSize = parsePositiveNumber(data.subtitleFontSize, DEFAULT_LOWER_THIRD_CONFIG.subtitleFontSize)
	}
	if (style.renderScale != null) {
		config.renderScale = parsePositiveNumber(style.renderScale, DEFAULT_LOWER_THIRD_CONFIG.renderScale)
	} else if (data.renderScale != null) {
		config.renderScale = parsePositiveNumber(data.renderScale, DEFAULT_LOWER_THIRD_CONFIG.renderScale)
	}
	if (data.fontFamily) {
		config.fontFamily = String(data.fontFamily).toLowerCase()
	} else if (style.fontFamilyId) {
		config.fontFamily = String(style.fontFamilyId).toLowerCase()
	}
	return config
}

/**
 * Whether a lower-third config differs from untouched defaults.
 * @param {object} [config]
 */
export function lowerThirdConfigHasEditorContent(config) {
	const c = { ...DEFAULT_LOWER_THIRD_CONFIG, ...(config || {}) }
	if (c.title !== '' || c.subtitle !== '') return true
	if (c.primaryColor !== DEFAULT_LOWER_THIRD_CONFIG.primaryColor) return true
	if (c.textColor !== DEFAULT_LOWER_THIRD_CONFIG.textColor) return true
	if (c.position !== DEFAULT_LOWER_THIRD_CONFIG.position) return true
	if (parseLowerThirdDisplayDurationSec(c.displayDurationSec) !== DEFAULT_LOWER_THIRD_CONFIG.displayDurationSec) {
		return true
	}
	if (parsePositiveNumber(c.titleFontSize, DEFAULT_LOWER_THIRD_CONFIG.titleFontSize) !== DEFAULT_LOWER_THIRD_CONFIG.titleFontSize) {
		return true
	}
	if (
		parsePositiveNumber(c.subtitleFontSize, DEFAULT_LOWER_THIRD_CONFIG.subtitleFontSize) !==
		DEFAULT_LOWER_THIRD_CONFIG.subtitleFontSize
	) {
		return true
	}
	if (parsePositiveNumber(c.renderScale, DEFAULT_LOWER_THIRD_CONFIG.renderScale) !== DEFAULT_LOWER_THIRD_CONFIG.renderScale) {
		return true
	}
	if (String(c.fontFamily || DEFAULT_LOWER_THIRD_CONFIG.fontFamily).toLowerCase() !== DEFAULT_LOWER_THIRD_CONFIG.fontFamily) {
		return true
	}
	return false
}

/**
 * @param {object} [cgData]
 */
export function cgDataHasLowerThirdEditorContent(cgData) {
	if (!cgData || typeof cgData !== 'object') return false
	return lowerThirdConfigHasEditorContent(lowerThirdConfigFromCgData(cgData))
}

/**
 * Editor config for a lower-third layer (`source.lowerThirdConfig` or derived from `cgData`).
 * @param {object} layer
 * @returns {typeof DEFAULT_LOWER_THIRD_CONFIG | null}
 */
export function resolveLayerLowerThirdConfig(layer) {
	if (!layer || typeof layer !== 'object') return null
	const src = layer.source
	if (src?.lowerThirdConfig && typeof src.lowerThirdConfig === 'object') {
		return { ...DEFAULT_LOWER_THIRD_CONFIG, ...src.lowerThirdConfig }
	}
	const cg = resolveLayerLowerThirdCgData(layer)
	if (!cg) return isLowerThirdSource(src) ? { ...DEFAULT_LOWER_THIRD_CONFIG } : null
	if (cgDataHasLowerThirdEditorContent(cg)) return lowerThirdConfigFromCgData(cg)
	return isLowerThirdSource(src) ? { ...DEFAULT_LOWER_THIRD_CONFIG } : null
}

/**
 * Resolve cgData for a scene layer (explicit `layer.cgData` or `source.lowerThirdConfig`).
 * @param {object} layer
 * @returns {{ data: object, style: object } | null}
 */
export function resolveLayerLowerThirdCgData(layer) {
	if (!layer || typeof layer !== 'object') return null
	if (layer.cgData && typeof layer.cgData === 'object') {
		return normalizeLowerThirdCgData(layer.cgData)
	}
	const src = layer.source
	if (!src || typeof src !== 'object') return null
	if (src.cgData && typeof src.cgData === 'object') {
		return normalizeLowerThirdCgData(src.cgData)
	}
	if (src.lowerThirdConfig && typeof src.lowerThirdConfig === 'object') {
		return buildLowerThirdCgData(src.lowerThirdConfig)
	}
	if (isLowerThirdSource(src)) {
		return buildLowerThirdCgData(src.lowerThirdConfig || {})
	}
	return null
}
