'use strict'

/**
 * WO-868 — renumber stored Caspar channel references when the channel map changes ("Operator GUI first").
 *
 * Channel numbers are derived from the config for everything keyed by screen / role, but a few stores keep them
 * verbatim: `route://N[-L]` strings (looks, multiview cells, live sources), `channel_<N>` output sources (WO-378) and
 * a handful of numeric fields (`hostChannel`, `inputsChannel`, `thumbnailChannel`, `casparChannel`, the virtual
 * camera's `channel`). The remap is built by ROLE identity from two channel maps (old, new) — PGM n, PRV n, operator
 * GUI n, multiview n, an input by kind + slot, a host source by id, audio-only n, monitor, dedicated stream — and is
 * applied as ONE simultaneous substitution (1→2 and 2→3 in the same pass, never 1→2→3). Applying it twice is not
 * idempotent, which is why stores carry a scheme stamp (operator-gui-first.js). Numbers no role claims stay as they are.
 *
 * Pure: no I/O. The switch (src/system/operator-first-switch.js) and the project scheme converter use it.
 */

const ROUTE_RE = /^route:\/\/(\d+)(?:-(\d+))?$/
const CHANNEL_SOURCE_RE = /^channel_(\d+)$/i
/** Numeric fields that always hold a Caspar channel number, wherever they sit. */
const NUMERIC_CHANNEL_KEYS = new Set(['hostChannel', 'inputsChannel', 'thumbnailChannel', 'casparChannel'])
/** String fields that may hold a `channel_<N>` output source (WO-378 vocabulary). */
const CHANNEL_SOURCE_KEYS = new Set(['source', 'videoSource', 'audioSource'])

/**
 * Role key → Caspar channel for one getChannelMap() result.
 * @param {object} map
 * @returns {Map<string, number>}
 */
function channelRoles(map) {
	const roles = new Map()
	const put = (key, ch) => {
		const n = parseInt(String(ch ?? ''), 10)
		if (Number.isFinite(n) && n >= 1 && !roles.has(key)) roles.set(key, n)
	}
	;(map?.programChannels || []).forEach((c, i) => put(`pgm:${i}`, c))
	;(map?.previewChannels || []).forEach((c, i) => put(`prv:${i}`, c))
	;(map?.operatorGuiChannels || []).forEach((c, i) => put(`opgui:${i}`, c))
	;(map?.multiviewChannels || []).forEach((c, i) => put(`mv:${i}`, c))
	for (const e of map?.inputChannels || []) {
		if (!e) continue
		if (e.sourceId != null && String(e.sourceId).trim()) put(`host:${e.kind}:${String(e.sourceId).trim()}`, e.channel)
		else put(`in:${e.kind}:${e.slot}`, e.channel)
	}
	;(map?.audioOnlyChannels || []).forEach((c, i) => put(`audio:${i}`, c))
	put('monitor', map?.monitorCh)
	if (map?.streamingDedicatedChannelSlot) put('stream', map?.streamingCh)
	return roles
}

/**
 * old channel → new channel for every role present in both maps (identity entries included).
 * @param {object} oldMap
 * @param {object} newMap
 * @returns {Map<number, number>}
 */
function buildChannelRemap(oldMap, newMap) {
	const before = channelRoles(oldMap)
	const after = channelRoles(newMap)
	const remap = new Map()
	for (const [role, ch] of before) {
		if (!after.has(role) || remap.has(ch)) continue
		remap.set(ch, after.get(role))
	}
	return remap
}

/** @param {Map<number, number>} remap */
function invertRemap(remap) {
	const out = new Map()
	for (const [a, b] of remap) if (!out.has(b)) out.set(b, a)
	return out
}

/** @param {Map<number, number>} remap */
function isIdentityRemap(remap) {
	for (const [a, b] of remap) if (a !== b) return false
	return true
}

/** @param {Map<number, number>} remap */
function remapToObject(remap) {
	const o = {}
	for (const [a, b] of [...remap.entries()].sort((x, y) => x[0] - y[0])) o[a] = b
	return o
}

/**
 * @param {unknown} n
 * @param {Map<number, number>} remap
 */
function remapChannelNumber(n, remap) {
	const v = typeof n === 'number' ? n : parseInt(String(n ?? ''), 10)
	if (!Number.isFinite(v) || !remap.has(v)) return n
	const out = remap.get(v)
	return typeof n === 'string' ? String(out) : out
}

/**
 * `route://N` / `route://N-L` with N remapped; anything else unchanged.
 * @param {unknown} str
 * @param {Map<number, number>} remap
 */
function remapRouteString(str, remap) {
	if (typeof str !== 'string') return str
	const m = str.match(ROUTE_RE)
	if (!m) return str
	const ch = parseInt(m[1], 10)
	if (!remap.has(ch)) return str
	return `route://${remap.get(ch)}${m[2] != null ? `-${m[2]}` : ''}`
}

/**
 * `channel_<N>` with N remapped; anything else unchanged.
 * @param {unknown} str
 * @param {Map<number, number>} remap
 */
function remapChannelSourceName(str, remap) {
	if (typeof str !== 'string') return str
	const m = str.match(CHANNEL_SOURCE_RE)
	if (!m) return str
	const ch = parseInt(m[1], 10)
	return remap.has(ch) ? `channel_${remap.get(ch)}` : str
}

/**
 * Deep copy of `value` with every channel reference remapped in one pass.
 * @param {unknown} value
 * @param {Map<number, number>} remap
 * @param {{ count: number }} [stats] incremented once per changed field
 * @returns {unknown}
 */
function remapDeep(value, remap, stats = { count: 0 }) {
	const walk = (v, key) => {
		if (typeof v === 'string') {
			let out = remapRouteString(v, remap)
			if (out === v && CHANNEL_SOURCE_KEYS.has(key)) out = remapChannelSourceName(v, remap)
			if (out === v && NUMERIC_CHANNEL_KEYS.has(key) && /^\d+$/.test(v)) out = remapChannelNumber(v, remap)
			if (out !== v) stats.count++
			return out
		}
		if (typeof v === 'number') {
			if (!NUMERIC_CHANNEL_KEYS.has(key)) return v
			const out = remapChannelNumber(v, remap)
			if (out !== v) stats.count++
			return out
		}
		if (Array.isArray(v)) return v.map((x) => walk(x, key))
		if (v && typeof v === 'object') {
			const o = {}
			for (const [k, x] of Object.entries(v)) o[k] = walk(x, k)
			// a virtual-camera output taps a Caspar channel by number (v4l2-bridge-config.js `channel`)
			if (o.kind === 'v4l2_out' && o.caspar && typeof o.caspar === 'object' && Number.isFinite(o.caspar.channel)) {
				const ch = remapChannelNumber(o.caspar.channel, remap)
				if (ch !== o.caspar.channel) {
					o.caspar = { ...o.caspar, channel: ch }
					stats.count++
				}
			}
			return o
		}
		return v
	}
	return walk(value, '')
}

/**
 * Re-key an object keyed by channel number (`liveScenesByProgramChannel`, `programLayerBankByChannel` …) and remap
 * its values. Keys that are not channel numbers stay.
 * @param {Record<string, unknown> | null | undefined} obj
 * @param {Map<number, number>} remap
 * @param {{ count: number }} [stats]
 */
function remapChannelKeyedObject(obj, remap, stats = { count: 0 }) {
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj
	const out = {}
	for (const [k, v] of Object.entries(obj)) {
		const n = parseInt(k, 10)
		const nk = String(n) === k && remap.has(n) ? String(remap.get(n)) : k
		if (nk !== k) stats.count++
		out[nk] = remapDeep(v, remap, stats)
	}
	return out
}

/**
 * The app-config slices that store channel numbers, remapped (returns only the slices that changed).
 * @param {object} config
 * @param {Map<number, number>} remap
 * @returns {{ patch: Record<string, unknown>, count: number }}
 */
function remapConfigSlices(config, remap) {
	const patch = {}
	let count = 0
	for (const key of ['extraLiveSources', 'deviceGraph', 'streamingChannel', 'streamOutputs', 'recordOutputs', 'audioRouting']) {
		if (config?.[key] === undefined) continue
		const stats = { count: 0 }
		const next = remapDeep(config[key], remap, stats)
		if (stats.count) {
			patch[key] = next
			count += stats.count
		}
	}
	const vc = config?.virtualCamera
	if (vc && typeof vc === 'object' && vc.channel != null) {
		const ch = remapChannelNumber(vc.channel, remap)
		if (ch !== vc.channel) {
			patch.virtualCamera = { ...vc, channel: ch }
			count++
		}
	}
	return { patch, count }
}

module.exports = {
	channelRoles,
	buildChannelRemap,
	invertRemap,
	isIdentityRemap,
	remapToObject,
	remapDeep,
	remapChannelKeyedObject,
	remapConfigSlices,
}
