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
 * WO-207: Track per-channel Sets of added template CG host layers.
 * When `buildSceneTemplateCgAmcpLines` emits ADD lines, record the host.
 * On reconnect/startup sweep, clear untracked hosts (orphans) and remove from tracking.
 * @type {Map<number, Set<number>>}
 */
const _trackedTemplateHostsByChannel = new Map()

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
	// WO-207 T207.2: record this host as added (tracked removal on teardown or on take without the template)
	recordTemplateHostAdded(channel, hostLayer)
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

/**
 * WO-196 T196.2: compare two template specs to detect continuity.
 * Same cgName (template type) on the same host layer means the timer identity is preserved.
 * @param {{ cgName?: string } | null} incoming
 * @param {{ cgName?: string } | null} current
 * @returns {boolean}
 */
function isSameTemplateSpec(incoming, current) {
	if (!incoming || !current) return false
	const inCg = String(incoming.cgName || '').trim().toLowerCase()
	const curCg = String(current.cgName || '').trim().toLowerCase()
	return inCg === curCg && inCg.length > 0
}

/**
 * WO-196 T196.2: emit only a CG UPDATE line (no CLEAR/ADD) to preserve running timer state.
 * This is used when the incoming take has the same template on the same host layer as the current scene.
 * @param {number} channel
 * @param {number} logicalOrHostLayer
 * @param {{ cgName: string, data?: string }} spec
 * @returns {string[]}
 */
function buildSceneTemplateCgUpdateOnlyLines(channel, logicalOrHostLayer, spec) {
	const cgName = String(spec?.cgName || '').trim()
	if (!cgName) return []
	const hostLayer = resolveTemplateCgHostLayer(logicalOrHostLayer, cgName)
	const cl = `${channel}-${hostLayer}`
	const dataStr = typeof spec?.data === 'string' && spec.data.length > 0 ? spec.data : '{}'
	return [`CG ${cl} UPDATE 0 ${param(dataStr)}`]
}

/**
 * WO-207 T207.2: Record a template CG host layer as added on this channel.
 * Called after buildSceneTemplateCgAmcpLines emit via sendPipOverlayLinesSerial.
 * @param {number} channel
 * @param {number} hostLayer
 */
function recordTemplateHostAdded(channel, hostLayer) {
	const n = Number(channel)
	const h = Number(hostLayer)
	if (!Number.isFinite(n) || n < 1 || !Number.isFinite(h) || h < 1) return
	if (!_trackedTemplateHostsByChannel.has(n)) {
		_trackedTemplateHostsByChannel.set(n, new Set())
	}
	_trackedTemplateHostsByChannel.get(n).add(h)
}

/**
 * WO-207: Get the Set of tracked template host layers for a channel.
 * @param {number} channel
 * @returns {Set<number>}
 */
function getTrackedTemplateHosts(channel) {
	const n = Number(channel)
	if (!Number.isFinite(n) || n < 1) return new Set()
	return _trackedTemplateHostsByChannel.get(n) || new Set()
}

/**
 * WO-207 T207.2: Clear tracked hosts for a channel (call after teardown clears them from Caspar).
 * @param {number} channel
 * @param {Set<number>} [hostsToUntrack] — if provided, only untrack these hosts; else clear all
 */
function untrackTemplateHosts(channel, hostsToUntrack) {
	const n = Number(channel)
	if (!Number.isFinite(n) || n < 1) return
	if (!hostsToUntrack || hostsToUntrack.size === 0) {
		_trackedTemplateHostsByChannel.delete(n)
		return
	}
	const tracked = _trackedTemplateHostsByChannel.get(n)
	if (!tracked) return
	for (const h of hostsToUntrack) {
		tracked.delete(h)
	}
	if (tracked.size === 0) {
		_trackedTemplateHostsByChannel.delete(n)
	}
}

/**
 * WO-207 T207.3: Get all tracked template hosts across all channels (for startup/reconnect sweep).
 * @returns {Map<number, Set<number>>} — copy of tracked hosts by channel
 */
function getAllTrackedTemplateHosts() {
	const result = new Map()
	for (const [ch, hosts] of _trackedTemplateHostsByChannel.entries()) {
		result.set(ch, new Set(hosts))
	}
	return result
}

module.exports = {
	isSceneTemplateLayer,
	resolveCgTemplateName,
	extractTemplateCgData,
	buildSceneTemplateCgAmcpLines,
	buildSceneTemplateCgClearLines,
	buildClearTemplateCgOnOtherProgramChannelsLines,
	buildSceneTemplateCgSpec,
	isSameTemplateSpec,
	buildSceneTemplateCgUpdateOnlyLines,
	resolveTemplateCgHostLayer,
	// WO-207 T207.2: tracked host lifecycle
	recordTemplateHostAdded,
	getTrackedTemplateHosts,
	untrackTemplateHosts,
	getAllTrackedTemplateHosts,
}
