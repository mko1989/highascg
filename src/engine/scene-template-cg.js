/**
 * Scene look layers that reference Caspar HTML templates (TLS) must use CG ADD/PLAY/UPDATE,
 * not LOADBG/PLAY — templates are CG producers, not media clips.
 * @see docs/wiki/api/cg.md
 */

'use strict'

const { param } = require('../caspar/amcp-utils')
const { isTemplateClip } = require('../state/playback-tracker-media')
const { resolveTemplateCgHostLayer, channelMapFromCtx, TEMPLATE_CG_OVERLAY_LAYER_BASE } = require('./cg-routing')

/**
 * WO-207: Track per-channel Sets of added template CG host layers.
 * When `buildSceneTemplateCgAmcpLines` emits ADD lines, record the host.
 * On reconnect/startup sweep, clear untracked hosts (orphans) and remove from tracking.
 * @type {Map<number, Set<number>>}
 */
const _trackedTemplateHostsByChannel = new Map()

/**
 * Hosts quarantined at Caspar disconnect. They no longer vouch for continuity
 * (getTrackedTemplateHosts reads only the tracked map) but are kept so the reconnect INFO
 * gather can restore the ones whose host layer still runs a producer — a TCP-only blip
 * leaves casparcg-server (and its loaded templates) running, and the old blanket clear
 * made the next take of the same look CLEAR+ADD+PLAY, visibly restarting the on-air intro.
 * @type {Map<number, Set<number>>}
 */
const _quarantinedTemplateHostsByChannel = new Map()

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
 * @param {{ fadeDurFrames?: number, fadeTween?: string }} [opts] when fadeDurFrames > 0 the template
 *   is CROSSFADED in on its own host layer instead of cutting. This mirrors the global-border
 *   pattern (add hidden → tween up, same layer): template CG lands on a fixed 700+ overlay layer
 *   that the bank crossfade never touches, so without an explicit opacity ramp here it always pops
 *   at full opacity — a hard cut — while the media layers around it mix. The `MIXER … OPACITY 0 0`
 *   MUST precede the CG ADD so the template plays hidden; the tween to 1 follows the PLAY.
 * @returns {string[]}
 */
function buildSceneTemplateCgAmcpLines(channel, logicalOrHostLayer, spec, opts = {}) {
	const cgName = String(spec?.cgName || '').trim()
	if (!cgName) return []
	const hostLayer = resolveTemplateCgHostLayer(logicalOrHostLayer, cgName)
	const cl = `${channel}-${hostLayer}`
	const dataStr =
		typeof spec?.data === 'string' && spec.data.length > 0 ? spec.data : '{}'
	const playOnLoad = spec?.playOnLoad !== false ? 1 : 0
	const tpl = cgName.includes('/') ? `"${cgName}"` : cgName
	// WO-207 T207.2: record this host as added (tracked removal on teardown or on take without the
	// template). WO-322: overlay-band (700+) hosts only — a shader's look-band layer must never
	// pollute the tracked-host set (its cleanup rides the look-layer teardown, not the 700+ sweep).
	if (hostLayer >= TEMPLATE_CG_OVERLAY_LAYER_BASE) recordTemplateHostAdded(channel, hostLayer)
	const fadeDur = Number(opts?.fadeDurFrames)
	if (Number.isFinite(fadeDur) && fadeDur > 0) {
		const tw = opts?.fadeTween ? ` ${param(opts.fadeTween)}` : ''
		return [
			`CG ${cl} CLEAR`,
			`MIXER ${cl} OPACITY 0 0`,
			`CG ${cl} ADD 0 ${tpl} ${playOnLoad} ${param(dataStr)}`,
			`CG ${cl} PLAY 0`,
			`CG ${cl} UPDATE 0 ${param(dataStr)}`,
			`MIXER ${cl} OPACITY 1 ${fadeDur}${tw}`,
		]
	}
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
	// A fresh ADD supersedes any pending quarantine verdict for this host.
	_quarantinedTemplateHostsByChannel.get(n)?.delete(h)
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
 * WO-268: forget every tracked (and quarantined) host — records must not vouch for continuity
 * (a WO-196 UPDATE-only take against an empty layer 403s).
 */
function clearAllTrackedTemplateHosts() {
	_trackedTemplateHostsByChannel.clear()
	_quarantinedTemplateHostsByChannel.clear()
}

/**
 * WO-268: move every tracked host into quarantine. Called on Caspar disconnect — until the
 * reconnect INFO gather proves a host layer still runs a producer, its record must not vouch
 * for continuity (Caspar may have restarted with empty layers; takes in the window do the
 * safe full CLEAR+ADD+PLAY).
 */
function quarantineAllTrackedTemplateHosts() {
	for (const [ch, hosts] of _trackedTemplateHostsByChannel.entries()) {
		if (!_quarantinedTemplateHostsByChannel.has(ch)) {
			_quarantinedTemplateHostsByChannel.set(ch, new Set())
		}
		const q = _quarantinedTemplateHostsByChannel.get(ch)
		for (const h of hosts) q.add(h)
	}
	_trackedTemplateHostsByChannel.clear()
}

/**
 * WO-268: resolve quarantined hosts against the per-channel INFO XML gathered on (re)connect
 * (query-cycle.js `gatheredInfo.channelXml`). A host whose layer still has a non-empty
 * foreground producer is restored to tracked (Caspar kept running through a TCP-only blip);
 * everything else is dropped — a genuinely restarted Caspar has empty layers and a wrong keep
 * (UPDATE against an empty layer = nothing on air) is worse than a wrong clear. With no XML
 * yet — the INFO CONFIG path can run setupAllRouting before the connect gather finishes —
 * the quarantine is left in place: unresolved hosts already do not vouch, and the
 * finishConnectionGather pass resolves them once the XML exists.
 * @param {{ gatheredInfo?: { channelXml?: Record<string, string> }, log?: Function }} [ctx]
 */
async function reconcileQuarantinedTemplateHosts(ctx) {
	if (_quarantinedTemplateHostsByChannel.size === 0) return
	const channelXml = ctx?.gatheredInfo?.channelXml || {}
	const hasXml = Object.keys(channelXml).some((k) => String(channelXml[k] || '').trim())
	if (!hasXml) return
	const { parseLayerFgProducerTypesFromChannelXml } = require('../state/live-scene-reconcile')
	let restored = 0
	let dropped = 0
	for (const [ch, hosts] of [..._quarantinedTemplateHostsByChannel.entries()]) {
		_quarantinedTemplateHostsByChannel.delete(ch)
		let types = null
		const xml = channelXml[String(ch)]
		if (xml && String(xml).trim()) {
			try {
				types = await parseLayerFgProducerTypesFromChannelXml(xml)
			} catch {
				types = null
			}
		}
		for (const h of hosts) {
			const t = types ? String(types[String(h)] || '') : ''
			if (t && t !== 'empty') {
				recordTemplateHostAdded(ch, h)
				restored++
			} else {
				dropped++
			}
		}
	}
	if (typeof ctx?.log === 'function' && (restored || dropped)) {
		ctx.log('info', `[template-cg] reconnect tracked-host reconcile: restored ${restored}, dropped ${dropped}`)
	}
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
		_quarantinedTemplateHostsByChannel.delete(n)
		return
	}
	const tracked = _trackedTemplateHostsByChannel.get(n)
	const quarantined = _quarantinedTemplateHostsByChannel.get(n)
	for (const h of hostsToUntrack) {
		tracked?.delete(h)
		quarantined?.delete(h)
	}
	if (tracked && tracked.size === 0) {
		_trackedTemplateHostsByChannel.delete(n)
	}
	if (quarantined && quarantined.size === 0) {
		_quarantinedTemplateHostsByChannel.delete(n)
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
	clearAllTrackedTemplateHosts,
	quarantineAllTrackedTemplateHosts,
	reconcileQuarantinedTemplateHosts,
	getAllTrackedTemplateHosts,
}
