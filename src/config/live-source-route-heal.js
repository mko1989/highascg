/**
 * WO-271 — heal stale `route://` channel numbers after the channel map shifts.
 *
 * Root cause (live 2026-07-18): inserting a new channel (the WO-243 operator_gui channel took
 * index 5) shifts every host channel up, but `extraLiveSources[].value` and persisted multiview
 * layout cells store route strings COPIED at creation time — a "DeckLink 4" source kept
 * `route://5-4` while the input moved to channel 6, so multiview cells (and the operator-GUI
 * mv-editor holes, which parse the same string) routed the operator channel into themselves:
 * black. The routing map's `inputChannels` (kind/slot/sourceId → channel/layer/route) is the
 * single source of truth; everything here re-resolves identity against it.
 */

'use strict'

const routingMap = require('./routing-map')

/** @param {unknown} value @returns {{ channel: number, layer: number|null }|null} */
function parseRouteValue(value) {
	const m = String(value || '').match(/^route:\/\/(\d+)(?:-(\d+))?$/)
	if (!m) return null
	return { channel: parseInt(m[1], 10), layer: m[2] != null ? parseInt(m[2], 10) : null }
}

/**
 * The set of channels a route string may legitimately point at under the CURRENT map.
 * @param {object} map - getChannelMap() result
 * @returns {Set<number>}
 */
function knownRouteChannels(map) {
	const known = new Set()
	for (const c of map?.programChannels || []) if (c != null) known.add(Number(c))
	for (const c of map?.previewChannels || []) if (c != null) known.add(Number(c))
	for (const e of map?.inputChannels || []) if (e?.channel != null) known.add(Number(e.channel))
	return known
}

/**
 * Authoritative inputChannels entry for one extraLiveSources item, by stored identity.
 * @param {object} item
 * @param {object} map
 */
function authoritativeEntryForSource(item, map) {
	const inputs = Array.isArray(map?.inputChannels) ? map.inputChannels : []
	const rt = String(item?.routeType || '').toLowerCase()
	if (rt === 'decklink' && item.decklinkSlot != null) {
		return inputs.find((e) => e.kind === 'decklink' && e.slot === Number(item.decklinkSlot)) || null
	}
	if (rt === 'live_audio' && item.liveAudioSlot != null) {
		return inputs.find((e) => e.kind === 'live_audio' && e.slot === Number(item.liveAudioSlot)) || null
	}
	if (rt === 'v4l2' && item.v4l2Slot != null) {
		return inputs.find((e) => e.kind === 'v4l2' && e.slot === Number(item.v4l2Slot)) || null
	}
	if (rt === 'ndi_host' || rt === 'webpage_host' || rt === 'browser_display') {
		const sid = String(item.sourceId || item.hostSourceId || '').trim()
		if (sid) return inputs.find((e) => e.kind === rt && String(e.sourceId || '') === sid) || null
		const label = String(item.label || '').trim().toLowerCase()
		if (label) return inputs.find((e) => e.kind === rt && String(e.label || '').trim().toLowerCase() === label) || null
	}
	return null
}

/**
 * Rewrite stale channel references on `config.extraLiveSources` in place.
 * @param {object} config - live app config (mutated)
 * @param {(level: string, msg: string) => void} [log]
 * @returns {{ changed: boolean, notes: string[] }}
 */
function healExtraLiveSourceChannels(config, log = () => {}) {
	const notes = []
	const list = Array.isArray(config?.extraLiveSources) ? config.extraLiveSources : []
	if (!list.length) return { changed: false, notes }
	const map = routingMap.getChannelMap(config)
	for (const item of list) {
		const entry = authoritativeEntryForSource(item, map)
		if (!entry || !entry.route) continue
		if (String(item.value || '') === String(entry.route)) continue
		notes.push(`"${item.label || item.routeType}": ${item.value} → ${entry.route}`)
		item.value = entry.route
		if ('inputsChannel' in item) item.inputsChannel = entry.channel
		if ('hostChannel' in item) item.hostChannel = entry.channel
		if ('inputsLayer' in item) item.inputsLayer = entry.layer
		if ('thumbnailChannel' in item) item.thumbnailChannel = entry.channel
		if ('thumbnailLayer' in item) item.thumbnailLayer = entry.layer
	}
	if (notes.length) log('info', `[route-heal] extraLiveSources re-pointed: ${notes.join('; ')}`)
	return { changed: notes.length > 0, notes }
}

/**
 * Re-resolve one multiview cell's stale route source by identity. Returns the healed route
 * string, or null when the source is absent/still valid/unresolvable.
 * @param {{ id?: string, type?: string, label?: string, source?: string }} cell
 * @param {object} map - getChannelMap() result
 * @returns {string|null}
 */
function healMultiviewCellSource(cell, map) {
	const parsed = parseRouteValue(cell?.source)
	if (!parsed) return null
	const inputs = Array.isArray(map?.inputChannels) ? map.inputChannels : []
	// Identity first: after a channel-map shift a stale number can COLLIDE with a different
	// now-valid channel, so a resolvable identity (decklink slot / label) always wins.
	if (String(cell.type || '') === 'decklink') {
		let slot = null
		const idM = cell.id?.match(/decklink_(\d+)/)
		if (idM) slot = parseInt(idM[1], 10) + 1
		if (slot == null) {
			const lblM = String(cell.label || '').match(/decklink\s*(\d+)/i)
			if (lblM) slot = parseInt(lblM[1], 10)
		}
		if (slot == null && parsed.layer != null) slot = parsed.layer
		const entry = inputs.find((e) => e.kind === 'decklink' && e.slot === slot)
		if (entry?.route) return Number(entry.channel) === parsed.channel ? null : entry.route
	}
	const label = String(cell.label || '').trim().toLowerCase()
	if (label) {
		const byLabel = inputs.find((e) => String(e.label || '').trim().toLowerCase() === label)
		if (byLabel?.route) return Number(byLabel.channel) === parsed.channel ? null : byLabel.route
	}
	// No identity resolved — a number the current map still knows needs no heal.
	if (knownRouteChannels(map).has(parsed.channel)) return null
	return null
}

/**
 * Heal every persisted multiview layout (persistence keys `multiviewLayout[_n]` and the in-memory
 * mirrors) so clients and re-applies see current channels.
 * @param {object} ctx
 * @returns {{ healedKeys: string[] }}
 */
function healPersistedMultiviewLayouts(ctx) {
	const log = typeof ctx?.log === 'function' ? (level, msg) => ctx.log(level, msg) : () => {}
	/** @type {string[]} */
	const healedKeys = []
	let map
	try {
		map = routingMap.getChannelMap(ctx.config)
	} catch {
		return { healedKeys }
	}
	const healBody = (body, keyName) => {
		if (!body || !Array.isArray(body.layout)) return false
		let changed = false
		for (const cell of body.layout) {
			const healed = healMultiviewCellSource(cell, map)
			if (healed) {
				log('info', `[route-heal] multiview ${keyName} cell "${cell.label || cell.id}": ${cell.source} → ${healed}`)
				cell.source = healed
				changed = true
			}
		}
		return changed
	}
	let persistence
	try {
		persistence = ctx?.persistence || require('../utils/persistence')
	} catch {
		persistence = null
	}
	const all = (persistence && persistence.getAll && persistence.getAll()) || {}
	for (const key of Object.keys(all)) {
		if (key !== 'multiviewLayout' && !/^multiviewLayout_\d+$/.test(key)) continue
		if (healBody(all[key], key)) {
			try {
				persistence.set(key, all[key])
				healedKeys.push(key)
			} catch {
				/* persistence write failure is non-fatal — reapply still uses the healed object */
			}
		}
	}
	if (healBody(ctx?._multiviewLayout, '_multiviewLayout')) healedKeys.push('_multiviewLayout')
	const mem = ctx?._multiviewLayouts
	if (mem && typeof mem === 'object') {
		for (const k of Object.keys(mem)) {
			if (healBody(mem[k], `_multiviewLayouts[${k}]`)) healedKeys.push(`_multiviewLayouts[${k}]`)
		}
	}
	return { healedKeys }
}

module.exports = {
	parseRouteValue,
	knownRouteChannels,
	authoritativeEntryForSource,
	healExtraLiveSourceChannels,
	healMultiviewCellSource,
	healPersistedMultiviewLayouts,
}
