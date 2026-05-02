'use strict'

const { escapeXml, isCustomLiveProfile } = require('./config-generator-utils')

/**
 * PR #1718: optional `<aspect-ratio>`, `<enable-mipmaps>` inside `<screen>` (custom build only).
 * @param {Record<string, unknown>} config
 * @param {number} screenIdx1
 * @returns {string} fragment lines (no outer wrapper)
 */
function buildScreenConsumerExtrasXml(config, screenIdx1) {
	if (!isCustomLiveProfile(config)) return ''
	const n = screenIdx1
	const parts = []
	const ar = String(config[`screen_${n}_aspect_ratio`] || '').trim()
	if (ar) parts.push(`<aspect-ratio>${escapeXml(ar)}</aspect-ratio>`)
	const mm = config[`screen_${n}_enable_mipmaps`] === true || config[`screen_${n}_enable_mipmaps`] === 'true'
	if (mm) parts.push('<enable-mipmaps>true</enable-mipmaps>')
	return parts.length ? parts.join('\n                    ') : ''
}

/**
 * Inner XML for PGM `<screen>` (device, geometry, flags). Custom build uses extended tag order and PR #1718 fields.
 * @param {Record<string, unknown>} config
 * @param {number} n - 1-based screen index
 * @param {{ nextDevice: number, posX: number, posY: number, dims: { width: number, height: number }, stretch: string, windowed: boolean, vsync: boolean, alwaysOnTop: boolean, borderless: boolean }} ctx
 * @returns {string}
 */
function buildProgramScreenConsumerInnerXml(config, n, ctx) {
	const {
		nextDevice,
		posX,
		posY,
		dims,
		stretch,
		windowed,
		vsync,
		alwaysOnTop,
		borderless,
	} = ctx
	if (!isCustomLiveProfile(config)) {
		return [
			`<device>${nextDevice}</device>`,
			`<x>${posX}</x><y>${posY}</y>`,
			`<width>${dims.width}</width><height>${dims.height}</height>`,
			`<stretch>${stretch}</stretch>`,
			`<windowed>${windowed}</windowed>`,
			`<vsync>${vsync}</vsync>`,
			`<always-on-top>${alwaysOnTop}</always-on-top>`,
			`<borderless>${borderless}</borderless>`,
		].join('\n                    ')
	}
	const extras = buildScreenConsumerExtrasXml(config, n)
	const keyOnly = config[`screen_${n}_key_only`] === true || config[`screen_${n}_key_only`] === 'true'
	const interactive = config[`screen_${n}_interactive`] === true || config[`screen_${n}_interactive`] === 'true'
	const sbsKey = config[`screen_${n}_sbs_key`] === true || config[`screen_${n}_sbs_key`] === 'true'
	const colourSpace = String(config[`screen_${n}_colour_space`] || '').trim()
	const forceLinear =
		config[`screen_${n}_force_linear_filter`] !== false && config[`screen_${n}_force_linear_filter`] !== 'false'
	const lines = [`<device>${nextDevice}</device>`]
	if (extras) lines.push(extras)
	lines.push(
		`<stretch>${stretch}</stretch>`,
		`<windowed>${windowed}</windowed>`,
		`<key-only>${keyOnly}</key-only>`,
		`<vsync>${vsync}</vsync>`,
		`<borderless>${borderless}</borderless>`,
		`<interactive>${interactive}</interactive>`,
		`<always-on-top>${alwaysOnTop}</always-on-top>`,
		`<x>${posX}</x><y>${posY}</y>`,
		`<width>${dims.width}</width><height>${dims.height}</height>`,
		`<sbs-key>${sbsKey}</sbs-key>`
	)
	if (colourSpace) lines.push(`<colour-space>${escapeXml(colourSpace)}</colour-space>`)
	lines.push(`<force-linear-filter>${forceLinear ? 'true' : 'false'}</force-linear-filter>`)
	return lines.join('\n                    ')
}

/**
 * Inner XML for multiview `<screen>` — matches {@link buildProgramScreenConsumerInnerXml} for `custom_live`
 * (aspect-ratio, mipmaps, colour-space, …) using `multiview_*` keys.
 * @param {Record<string, unknown>} config
 * @param {{ nextDevice: number, posX: number, posY: number, dims: { width: number, height: number }, stretch: string, windowed: boolean, vsync: boolean, alwaysOnTop: boolean, borderless: boolean }} ctx
 * @returns {string}
 */
function buildMultiviewScreenConsumerInnerXml(config, ctx) {
	const {
		n,
		nextDevice,
		posX,
		posY,
		dims,
		stretch,
		windowed,
		vsync,
		alwaysOnTop,
		borderless,
	} = ctx
	const idx = n || 1
	if (!isCustomLiveProfile(config)) {
		return [
			`<device>${nextDevice}</device>`,
			`<x>${posX}</x><y>${posY}</y>`,
			`<width>${dims.width}</width><height>${dims.height}</height>`,
			`<stretch>${stretch}</stretch>`,
			`<windowed>${windowed}</windowed>`,
			`<vsync>${vsync}</vsync>`,
			`<always-on-top>${alwaysOnTop}</always-on-top>`,
			`<borderless>${borderless}</borderless>`,
		].join('\n                    ')
	}
	const ar = String(config[`multiview_${idx}_aspect_ratio`] || config.multiview_aspect_ratio || '').trim()
	const mm = (config[`multiview_${idx}_enable_mipmaps`] ?? config.multiview_enable_mipmaps) === true || 
	           (config[`multiview_${idx}_enable_mipmaps`] ?? config.multiview_enable_mipmaps) === 'true'
	const extras = []
	if (ar) extras.push(`<aspect-ratio>${escapeXml(ar)}</aspect-ratio>`)
	if (mm) extras.push('<enable-mipmaps>true</enable-mipmaps>')
	const extrasStr = extras.length ? extras.join('\n                    ') : ''
	const keyOnly = (config[`multiview_${idx}_key_only`] ?? config.multiview_key_only) === true || 
	                (config[`multiview_${idx}_key_only`] ?? config.multiview_key_only) === 'true'
	const interactive = (config[`multiview_${idx}_interactive`] ?? config.multiview_interactive) === true || 
	                    (config[`multiview_${idx}_interactive`] ?? config.multiview_interactive) === 'true'
	const sbsKey = (config[`multiview_${idx}_sbs_key`] ?? config.multiview_sbs_key) === true || 
	               (config[`multiview_${idx}_sbs_key`] ?? config.multiview_sbs_key) === 'true'
	const colourSpace = String(config[`multiview_${idx}_colour_space`] || config.multiview_colour_space || '').trim()
	const forceLinear =
		(config[`multiview_${idx}_force_linear_filter`] ?? config.multiview_force_linear_filter) !== false && 
		(config[`multiview_${idx}_force_linear_filter`] ?? config.multiview_force_linear_filter) !== 'false'
	const lines = [`<device>${nextDevice}</device>`]
	if (extrasStr) lines.push(extrasStr)
	lines.push(
		`<stretch>${stretch}</stretch>`,
		`<windowed>${windowed}</windowed>`,
		`<key-only>${keyOnly}</key-only>`,
		`<vsync>${vsync}</vsync>`,
		`<borderless>${borderless}</borderless>`,
		`<interactive>${interactive}</interactive>`,
		`<always-on-top>${alwaysOnTop}</always-on-top>`,
		`<x>${posX}</x><y>${posY}</y>`,
		`<width>${dims.width}</width><height>${dims.height}</height>`,
		`<sbs-key>${sbsKey}</sbs-key>`
	)
	if (colourSpace) lines.push(`<colour-space>${escapeXml(colourSpace)}</colour-space>`)
	lines.push(`<force-linear-filter>${forceLinear ? 'true' : 'false'}</force-linear-filter>`)
	return lines.join('\n                    ')
}

module.exports = {
	buildScreenConsumerExtrasXml,
	buildProgramScreenConsumerInnerXml,
	buildMultiviewScreenConsumerInnerXml,
}
