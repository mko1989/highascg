/**
 * CG-only look detection for Looks deck (WO-60).
 * Keep in sync with src/engine/scene-look-kind.js.
 */

import { isLowerThirdSource } from './lower-third-cg-data.js'

/** @type {Set<string>} */
const PLACEHOLDER_VIDEO_TEMPLATES = new Set([
	'color_grid',
	'solid',
	'smpte_bars',
	'aspect_guide',
	'countdown',
	'white_noise',
])

/** @type {Set<string>} */
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
 * @param {string} clipId
 * @returns {boolean}
 */
function looksLikeTemplateClipId(clipId) {
	const id = String(clipId || '').trim()
	if (!id) return false
	if (/^CASPARCG-/i.test(id)) return true
	const lower = id.toLowerCase()
	if (lower.includes('/html/') || lower.includes('/loop-io/')) return true
	return false
}

/**
 * @param {object} layer
 * @returns {boolean}
 */
export function isCgTemplateLayer(layer) {
	if (!layer || typeof layer !== 'object') return false
	const src = layer.source
	const clipId = src?.value ? String(src.value) : ''

	/* Owner 2026-07-27 (+WO-322 philosophy): SHADER templates are visual MEDIA, not CG graphics —
	 * they composite on the look band, fill the frame, and their deck cards must get the normal
	 * media treatment (red PGM border, real thumb) instead of the cg-only violet styling. */
	if (/(^|\/)shaders\//i.test(clipId)) return false

	if (src && typeof src === 'object') {
		const t = String(src.type || '').toLowerCase()
		if (NON_CG_SOURCE_TYPES.has(t)) return false
		if (t === 'template' || t === 'cg' || t === 'html') return true
		if (isLowerThirdSource(src)) return true
		if (t === 'placeholder' || src.isPlaceholder) {
			const tpl = String(src.template || layer.template || '').toLowerCase()
			if (!tpl || PLACEHOLDER_VIDEO_TEMPLATES.has(tpl)) return false
			return true
		}
		if (clipId && looksLikeTemplateClipId(clipId)) return true
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
 * todos27.07.26: the "shaders are media" reclassification (red border, filled thumbs) must NOT
 * cost them the server-rendered CG thumb — a shader is still RENDERED like a template. This is
 * the thumb-eligibility predicate; isCgTemplateLayer stays the styling/border predicate.
 * @param {object} layer
 * @returns {boolean}
 */
export function isCgRenderableLayer(layer) {
	if (isCgTemplateLayer(layer)) return true
	return /(^|\/)shaders\//i.test(String(layer?.source?.value || ''))
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
		if (layerHasContent(fakeLayer) && !isCgRenderableLayer(fakeLayer)) return true
	}
	return false
}

/**
 * @param {object|null|undefined} scene
 * @returns {boolean}
 */
export function isCgOnlyLook(scene) {
	const layers = scene?.layers
	if (!Array.isArray(layers) || layers.length === 0) return false
	let hasContent = false
	for (const layer of layers) {
		if (playlistDisqualifiesCgOnly(layer)) return false
		if (!layerHasContent(layer)) continue
		hasContent = true
		if (!isCgRenderableLayer(layer)) return false
	}
	return hasContent
}
