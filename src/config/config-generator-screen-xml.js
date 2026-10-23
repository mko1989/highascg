'use strict'

const { escapeXml, isCustomLiveProfile, casparBoolEnabled, readMultiviewSetting } = require('./config-generator-utils')

/**
 * WO-716 (owner 23.10.26: "vsync should always be off, gpu-texture enabled per channel"): every Caspar
 * `<screen>` consumer this generator writes — PGM, PRV head, multiview, operator GUI, both build profiles —
 * carries these two lines, and neither is a setting. Vsync on made NVIDIA spin-wait in glXSwapBuffers on the
 * consumer thread (78 % of a core per consumer, WO-715 A/B); frame pacing comes from GL sync (WO-407/444).
 * `screen_N_vsync` / `multiview_vsync` may still sit in saved settings: they are ignored.
 */
const SCREEN_VSYNC_XML = '<vsync>false</vsync>'
/** WO-502: bind the mixer's GPU texture instead of a per-frame host round trip — see the PGM function. */
const SCREEN_GPU_TEXTURE_XML = '<gpu-texture>true</gpu-texture>'

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
 * @param {{ nextDevice: number, posX: number, posY: number, dims: { width: number, height: number }, stretch: string, windowed: boolean, alwaysOnTop: boolean, borderless: boolean }} ctx
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
			SCREEN_VSYNC_XML,
			`<always-on-top>${alwaysOnTop}</always-on-top>`,
			`<borderless>${borderless}</borderless>`,
			SCREEN_GPU_TEXTURE_XML,
		].join('\n                    ')
	}
	const extras = buildScreenConsumerExtrasXml(config, n)
	const keyOnly = config[`screen_${n}_key_only`] === true || config[`screen_${n}_key_only`] === 'true'
	const interactive = config[`screen_${n}_interactive`] === true || config[`screen_${n}_interactive`] === 'true'
	const sbsKey = config[`screen_${n}_sbs_key`] === true || config[`screen_${n}_sbs_key`] === 'true'
	const highBitdepth = config[`screen_${n}_high_bitdepth`] === true || config[`screen_${n}_high_bitdepth`] === 'true'
	const colourSpace = String(config[`screen_${n}_colour_space`] || '').trim()
	const forceLinear = casparBoolEnabled(config[`screen_${n}_force_linear_filter`], false)
	const lines = [`<device>${nextDevice}</device>`]
	if (extras) lines.push(extras)
	lines.push(
		`<stretch>${stretch}</stretch>`,
		`<windowed>${windowed}</windowed>`,
		`<key-only>${keyOnly}</key-only>`,
		SCREEN_VSYNC_XML,
		`<borderless>${borderless}</borderless>`,
		`<interactive>${interactive}</interactive>`,
		`<always-on-top>${alwaysOnTop}</always-on-top>`,
		`<x>${posX}</x><y>${posY}</y>`,
		`<width>${dims.width}</width><height>${dims.height}</height>`,
		`<sbs-key>${sbsKey}</sbs-key>`
	)
	if (colourSpace) lines.push(`<colour-space>${escapeXml(colourSpace)}</colour-space>`)
	lines.push(`<force-linear-filter>${forceLinear ? 'true' : 'false'}</force-linear-filter>`)
	lines.push(`<high-bitdepth>${highBitdepth ? 'true' : 'false'}</high-bitdepth>`)
	/* WO-502: always on, unconditionally — not a per-screen setting. Binds the mixer's existing GPU
	 * texture instead of round-tripping every frame through host memory: `screen_consumer.cpp`
	 * picks gpu_strategy (:918, `in_frame.texture()->bind(0)`) over host_strategy (:875, a
	 * full-frame `std::memcpy` + re-upload EVERY frame — 37.7 MB/frame on a 6144x1536 channel, all
	 * of it on Caspar's SINGLE shared GL thread, which WO-502 measured as the box-wide ceiling).
	 * Owner measured on the box: 93.6 % -> 100.3 % of realtime and GPU 100 % -> 75 %, with all seven
	 * channels still running. Owner decision 21.09.2026: no known downside on this box, so it is
	 * forced on rather than exposed as a toggle. */
	lines.push(SCREEN_GPU_TEXTURE_XML)
	return lines.join('\n                    ')
}

/**
 * Inner XML for multiview `<screen>` — matches {@link buildProgramScreenConsumerInnerXml} for `custom_live`
 * (aspect-ratio, mipmaps, colour-space, …) using `multiview_*` keys.
 * @param {Record<string, unknown>} config
 * @param {{ nextDevice: number, posX: number, posY: number, dims: { width: number, height: number }, stretch: string, windowed: boolean, alwaysOnTop: boolean, borderless: boolean }} ctx
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
			SCREEN_VSYNC_XML,
			`<always-on-top>${alwaysOnTop}</always-on-top>`,
			`<borderless>${borderless}</borderless>`,
			SCREEN_GPU_TEXTURE_XML,
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
	const highBitdepth = (config[`multiview_${idx}_high_bitdepth`] ?? config.multiview_high_bitdepth) === true || 
	                    (config[`multiview_${idx}_high_bitdepth`] ?? config.multiview_high_bitdepth) === 'true'
	const colourSpace = String(config[`multiview_${idx}_colour_space`] || config.multiview_colour_space || '').trim()
	const forceLinear = casparBoolEnabled(readMultiviewSetting(config, idx, 'force_linear_filter'), false)
	const lines = [`<device>${nextDevice}</device>`]
	if (extrasStr) lines.push(extrasStr)
	lines.push(
		`<stretch>${stretch}</stretch>`,
		`<windowed>${windowed}</windowed>`,
		`<key-only>${keyOnly}</key-only>`,
		SCREEN_VSYNC_XML,
		`<borderless>${borderless}</borderless>`,
		`<interactive>${interactive}</interactive>`,
		`<always-on-top>${alwaysOnTop}</always-on-top>`,
		`<x>${posX}</x><y>${posY}</y>`,
		`<width>${dims.width}</width><height>${dims.height}</height>`,
		`<sbs-key>${sbsKey}</sbs-key>`
	)
	if (colourSpace) lines.push(`<colour-space>${escapeXml(colourSpace)}</colour-space>`)
	lines.push(`<force-linear-filter>${forceLinear ? 'true' : 'false'}</force-linear-filter>`)
	lines.push(`<high-bitdepth>${highBitdepth ? 'true' : 'false'}</high-bitdepth>`)
	/* WO-502: same forced-on gpu-texture as the program screen consumer — see that function. */
	lines.push(SCREEN_GPU_TEXTURE_XML)
	return lines.join('\n                    ')
}

module.exports = {
	buildScreenConsumerExtrasXml,
	buildProgramScreenConsumerInnerXml,
	buildMultiviewScreenConsumerInnerXml,
	SCREEN_VSYNC_XML,
	SCREEN_GPU_TEXTURE_XML,
}
