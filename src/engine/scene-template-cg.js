/**
 * Scene look layers that reference Caspar HTML templates (TLS) must use CG ADD/PLAY/UPDATE,
 * not LOADBG/PLAY — templates are CG producers, not media clips.
 * @see docs/wiki/api/cg.md
 */

'use strict'

const { param } = require('../caspar/amcp-utils')
const { isTemplateClip } = require('../state/playback-tracker-media')
const { resolveTemplateCgHostLayer, channelMapFromCtx } = require('./cg-routing')

/**
 * @param {object} layer
 * @param {string} clipId
 * @param {object} [ctx]
 * @returns {boolean}
 */
function isSceneTemplateLayer(layer, clipId, ctx) {
	const t = String(layer?.source?.type || '').toLowerCase()
	if (t === 'template' || t === 'cg') return true
	return isTemplateClip(clipId, ctx)
}

/**
 * TLS id → Caspar CG ADD template name (verified against Caspar 2.6).
 * Paths: lowercase (`casparcg-templates-main/loop-io/one-liner`).
 * Root templates: lowercase (`color_bg`, `black`).
 * @param {string} tlsId
 * @returns {string}
 */
function resolveCgTemplateName(tlsId) {
	const id = String(tlsId || '')
		.trim()
		.replace(/^"(.*)"$/, '$1')
	if (!id) return ''
	if (id.includes('/')) return id.toLowerCase()
	return id.toLowerCase()
}

/**
 * Minimal CG JSON when a look layer has no `cgData` / `templateData` (template-specific).
 * @type {Record<string, string>}
 */
const DEFAULT_LT_CG_DATA = JSON.stringify({
	data: { title: 'Name', subtitle: 'Title' },
	style: { textColor: '#ffffff', primaryColor: 'lightblue', position: 'left' },
})

const DEFAULT_CG_DATA_BY_TEMPLATE = {
	'casparcg-guide-html-template-master/html/lower-third.1': JSON.stringify({
		data: { title: 'Title', subtitle: 'Subtitle' },
		style: { textColor: '#ffffff', primaryColor: '#e30613' },
	}),
	'lower-thirds/lt-classic-box': DEFAULT_LT_CG_DATA,
	'lower-thirds/lt-slide-bar': DEFAULT_LT_CG_DATA,
	'lower-thirds/lt-minimal-fade': DEFAULT_LT_CG_DATA,
	'lower-thirds/lt-split-color': DEFAULT_LT_CG_DATA,
	'lower-thirds/lt-frosted-glass': DEFAULT_LT_CG_DATA,
	'lower-thirds/lt-underline-reveal': DEFAULT_LT_CG_DATA,
	'lower-thirds/lt-tag-badge': DEFAULT_LT_CG_DATA,
	'lower-thirds/lt-gradient-wave': DEFAULT_LT_CG_DATA,
	'lower-thirds/lt-corner-bracket': DEFAULT_LT_CG_DATA,
}

/**
 * @param {object} layer
 * @param {string} [cgName]
 * @returns {string}
 */
function extractTemplateCgData(layer, cgName) {
	const raw =
		layer?.cgData ??
		layer?.templateData ??
		layer?.source?.data ??
		layer?.source?.cgData ??
		layer?.params
	if (raw == null || raw === '') {
		const key = String(cgName || '').toLowerCase()
		if (DEFAULT_CG_DATA_BY_TEMPLATE[key]) return DEFAULT_CG_DATA_BY_TEMPLATE[key]
		if (key.startsWith('studio/lt-')) return DEFAULT_LT_CG_DATA
		return '{}'
	}
	if (typeof raw === 'string') return raw
	try {
		return JSON.stringify(raw)
	} catch {
		return '{}'
	}
}

/**
 * @param {number} channel
 * @param {number} logicalOrHostLayer — scene layerNumber; mapped to 700+ overlay host
 * @param {{ cgName: string, data?: string, playOnLoad?: boolean }} spec
 * @returns {string[]}
 */
function buildSceneTemplateCgAmcpLines(channel, logicalOrHostLayer, spec) {
	const cgName = String(spec?.cgName || '').trim()
	if (!cgName) return []
	const hostLayer = resolveTemplateCgHostLayer(logicalOrHostLayer, cgName)
	const cl = `${channel}-${hostLayer}`
	const dataStr =
		typeof spec?.data === 'string' && spec.data.length > 0 ? spec.data : '{}'
	const playOnLoad = spec?.playOnLoad !== false ? 1 : 0
	const tpl = cgName.includes('/') ? `"${cgName}"` : cgName
	return [
		`CG ${cl} CLEAR`,
		`CG ${cl} ADD 0 ${tpl} ${playOnLoad} ${param(dataStr)}`,
		`CG ${cl} PLAY 0`,
		`CG ${cl} UPDATE 0 ${param(dataStr)}`,
	]
}

/**
 * Clear template CG host layer on a single channel (no ADD).
 * @param {number} channel
 * @param {number} logicalOrHostLayer
 * @param {string} cgName
 * @returns {string[]}
 */
function buildSceneTemplateCgClearLines(channel, logicalOrHostLayer, cgName) {
	const name = String(cgName || '').trim()
	if (!name) return []
	const hostLayer = resolveTemplateCgHostLayer(logicalOrHostLayer, name)
	const cl = `${channel}-${hostLayer}`
	return [`CG ${cl} CLEAR`]
}

/**
 * When taking template CG on one program output, clear the same overlay slot on other PGM channels
 * so stale lower-thirds / HTML from preview edits do not stay on air elsewhere.
 * @param {number} targetChannel
 * @param {number} logicalOrHostLayer
 * @param {{ cgName: string }} spec
 * @param {object} [ctx]
 * @returns {string[]}
 */
function buildClearTemplateCgOnOtherProgramChannelsLines(targetChannel, logicalOrHostLayer, spec, ctx) {
	const target = Number(targetChannel)
	if (!Number.isFinite(target) || target <= 0) return []
	const map = channelMapFromCtx(ctx)
	const programs = Array.isArray(map.programChannels) ? map.programChannels : []
	const lines = []
	for (const ch of programs) {
		const n = Number(ch)
		if (!Number.isFinite(n) || n <= 0 || n === target) continue
		lines.push(...buildSceneTemplateCgClearLines(n, logicalOrHostLayer, spec?.cgName))
	}
	return lines
}

/**
 * @param {object} layer
 * @param {string} tlsId
 * @param {object} [ctx]
 * @returns {{ tlsId: string, cgName: string, data: string, playOnLoad: boolean } | null}
 */
function buildSceneTemplateCgSpec(layer, tlsId, ctx) {
	if (!isSceneTemplateLayer(layer, tlsId, ctx)) return null
	const cgName = resolveCgTemplateName(tlsId)
	if (!cgName) return null
	return {
		tlsId: String(tlsId),
		cgName,
		data: extractTemplateCgData(layer, cgName),
		playOnLoad: true,
	}
}

module.exports = {
	isSceneTemplateLayer,
	resolveCgTemplateName,
	extractTemplateCgData,
	buildSceneTemplateCgAmcpLines,
	buildSceneTemplateCgClearLines,
	buildClearTemplateCgOnOtherProgramChannelsLines,
	buildSceneTemplateCgSpec,
	resolveTemplateCgHostLayer,
}
