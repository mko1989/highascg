/**
 * CG-only look detection — shared server + smoke-test logic (WO-60).
 */

'use strict'

const { isTemplateClip } = require('../state/playback-tracker-media')

/** Placeholder fills that are full-screen test patterns, not CG templates. */
const PLACEHOLDER_VIDEO_TEMPLATES = new Set([
	'color_grid',
	'solid',
	'smpte_bars',
	'aspect_guide',
	'countdown',
	'white_noise',
])

const NON_CG_SOURCE_TYPES = new Set([
	'media',
	'live',
	'live_audio',
	'timeline',
	'browser',
	'route',
	'ndi',
	'video',
	'image',
	'audio',
	'effect',
])

/**
 * @param {object|null|undefined} source
 * @returns {boolean}
 */
function isLowerThirdSourceValue(source) {
	if (!source?.value) return false
	const v = String(source.value).toLowerCase().replace(/\\/g, '/')
	return v.includes('lower-thirds/lt-') || v.includes('lower_thirds/lt-') || /^lt-[a-z0-9-]+$/i.test(v)
}

/**
 * @param {object} layer
 * @param {object} [ctx]
 * @returns {boolean}
 */
function isCgTemplateLayer(layer, ctx) {
	if (!layer || typeof layer !== 'object') return false
	const src = layer.source
	const clipId = src?.value ? String(src.value) : ''

	if (src && typeof src === 'object') {
		const t = String(src.type || '').toLowerCase()
		if (NON_CG_SOURCE_TYPES.has(t)) return false
		if (t === 'template' || t === 'cg' || t === 'html') return true
		if (isLowerThirdSourceValue(src)) return true
		if (t === 'placeholder' || src.isPlaceholder) {
			const tpl = String(src.template || layer.template || '').toLowerCase()
			if (!tpl || PLACEHOLDER_VIDEO_TEMPLATES.has(tpl)) return false
			return true
		}
		if (clipId && isTemplateClip(clipId, ctx)) return true
		if (clipId && /^CASPARCG-/i.test(clipId)) return true
	}

	if (layer.cgData != null && layer.cgData !== '') return true
	if (layer.templateData != null && layer.templateData !== '') return true
	if (layer.template && !PLACEHOLDER_VIDEO_TEMPLATES.has(String(layer.template).toLowerCase())) return true

	return false
}

/**
 * @param {object} layer
 * @returns {boolean}
 */
function layerHasContent(layer) {
	if (!layer || typeof layer !== 'object') return false
	if (layer.cgData != null && layer.cgData !== '') return true
	if (layer.templateData != null && layer.templateData !== '') return true
	if (layer.template && String(layer.template).trim()) return true
	const src = layer.source
	if (!src || typeof src !== 'object') return false
	if (src.value != null && String(src.value).trim() !== '') return true
	if (src.isPlaceholder || src.type === 'placeholder') return true
	return false
}

/**
 * @param {object} layer
 * @returns {boolean}
 */
function playlistDisqualifiesCgOnly(layer) {
	if (String(layer?.sourceMode || '') !== 'list') return false
	const list = Array.isArray(layer.playlist) ? layer.playlist : []
	for (const item of list) {
		const fakeLayer = { source: item?.source || item, template: item?.template }
		if (layerHasContent(fakeLayer) && !isCgTemplateLayer(fakeLayer)) return true
	}
	return false
}

/**
 * @param {object|null|undefined} scene
 * @param {object} [ctx]
 * @returns {boolean}
 */
function isCgOnlyLook(scene, ctx) {
	const layers = scene?.layers
	if (!Array.isArray(layers) || layers.length === 0) return false
	let hasContent = false
	for (const layer of layers) {
		if (playlistDisqualifiesCgOnly(layer)) return false
		if (!layerHasContent(layer)) continue
		hasContent = true
		if (!isCgTemplateLayer(layer, ctx)) return false
	}
	return hasContent
}

module.exports = {
	PLACEHOLDER_VIDEO_TEMPLATES,
	isLowerThirdSourceValue,
	isCgTemplateLayer,
	isCgOnlyLook,
	layerHasContent,
}
