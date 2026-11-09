'use strict'

/**
 * WO-1012 stage B2 — a Zoom source (presenter / share / gallery) as a LAYER on a channel Caspar already runs, so
 * enabling or disabling a source is a PLAY / STOP with no Caspar restart. The live input is `route://<ch>-<layer>`.
 *
 * Where the layers go (resolveZoomPlacement):
 *   1. A shared Zoom host channel that another Zoom entry already owns (`hostOn: 'zoom_channel'`): stay there.
 *   2. Else the first DeckLink input channel (`hostOn: 'decklink_input'`, `hostSlot`): an existing 1080p input channel
 *      with no screen or DeckLink output. Nothing to create, so no restart.
 *   3. Else ONE shared Zoom host channel for all three sources, created by the generator (one Apply & restart, once).
 * One fixed layer per source (ZOOM_LAYERS 21/22/23): clear of the DeckLink slot layers (1–8) and the live-audio layer 10.
 *
 * The layer plays at MIXER OPACITY 0. A layer route (`route://ch-layer`) carries the producer's own frame without the
 * layer's mixer transform (Caspar core/video_channel.cpp routesCb: `draw_frame::pop(foreground)`), so the route keeps
 * the full picture while the host channel's own composite (its thumbnail PRINT, compose preview, `route://<ch>`) stays
 * the DeckLink input. Live-proven 09.11 (WO-1012 stage B2). A layer route also carries only that layer's audio.
 *
 * Stored `extraLiveSources` entry:
 *   { type: 'zoom', routeType: 'zoom_host', source, ring: 'zoom-<source>', hostOn, hostSlot?, hostChannel, hostLayer,
 *     sourceId: 'zoom_<source>', label: 'Zoom <source>', value: 'route://<ch>-<layer>', hostRole: 'zoom_host' }
 * Only `hostOn: 'zoom_channel'` entries own (pin, generate) a channel (host-live-sources.js listHostLiveChannelEntries).
 * A DeckLink-hosted entry follows its input channel through a channel renumber: the placement is resolved from the
 * channel map at play / replay time, and the route heal re-points the stored value (live-source-route-heal.js).
 * Stage-B entries (no `hostOn`, their own channel) are legacy: they own nothing and are moved on the next save / heal.
 */

const fs = require('fs')
const { getRouteString } = require('./routing-map')

const ZOOM_SOURCES = ['presenter', 'share', 'gallery']
const ZOOM_HOST_ROLE = 'zoom_host'
/** One fixed layer per source on the host channel. */
const ZOOM_LAYERS = { presenter: 21, share: 22, gallery: 23 }
const ON_DECKLINK = 'decklink_input'
const ON_ZOOM_CHANNEL = 'zoom_channel'

/** @param {string} source */
function zoomRingName(source) {
	return `zoom-${source}`
}

/**
 * @param {object} item
 * @returns {boolean}
 */
function isZoomHostCandidate(item) {
	if (!item || typeof item !== 'object') return false
	return item.routeType === ZOOM_HOST_ROLE || item.type === 'zoom'
}

/**
 * The Zoom source an entry plays: `source`, else the `zoom_<source>` sourceId, else the `shm://zoom-<source>` value.
 * @param {object} item
 * @returns {string} '' when it names none of the three
 */
function zoomSourceOf(item) {
	const candidates = [
		item?.source,
		String(item?.sourceId || '').replace(/^zoom_/, ''),
		String(item?.value || '').replace(/^shm:\/\/zoom-/i, ''),
	]
	for (const c of candidates) {
		const s = String(c || '').trim().toLowerCase()
		if (ZOOM_SOURCES.includes(s)) return s
	}
	return ''
}

/** True for the entry that owns (pins, generates) the shared Zoom host channel. */
function ownsZoomChannel(item) {
	if (!isZoomHostCandidate(item) || item.hostOn !== ON_ZOOM_CHANNEL) return false
	const ch = parseInt(String(item.hostChannel ?? ''), 10)
	return Number.isFinite(ch) && ch >= 1
}

function zoomEntriesOf(config) {
	return (Array.isArray(config?.extraLiveSources) ? config.extraLiveSources : []).filter(isZoomHostCandidate)
}

/** DeckLink input channels of the map, in slot order: [{ slot, channel }]. */
function decklinkInputs(map) {
	return (Array.isArray(map?.inputChannels) ? map.inputChannels : [])
		.filter((e) => e && e.kind === 'decklink' && Number(e.channel) >= 1)
		.map((e) => ({ slot: Number(e.slot), channel: Number(e.channel) }))
		.sort((a, b) => a.slot - b.slot)
}

/**
 * Where `item`'s layer goes under the CURRENT config (see the header). Pure apart from the channel map.
 * @param {object} config
 * @param {object} item — the entry (its source picks the layer)
 * @param {object} [map] — a getChannelMap(config) result, when the caller has one
 * @returns {{ hostOn: string, slot?: number, channel: number, layer: number }|null} null for an unknown source
 */
function resolveZoomPlacement(config, item, map) {
	const source = zoomSourceOf(item)
	if (!source) return null
	const layer = ZOOM_LAYERS[source]
	const all = zoomEntriesOf(config)
	const owner = [item, ...all].find(ownsZoomChannel)
	if (owner) return { hostOn: ON_ZOOM_CHANNEL, channel: parseInt(String(owner.hostChannel), 10), layer }
	const inputs = decklinkInputs(map || require('./routing-map').getChannelMap(config || {}))
	if (inputs.length) {
		const wanted = [item, ...all].filter((x) => x?.hostOn === ON_DECKLINK).map((x) => Number(x.hostSlot))
		const pick = inputs.find((e) => wanted.includes(e.slot)) || inputs[0]
		return { hostOn: ON_DECKLINK, slot: pick.slot, channel: pick.channel, layer }
	}
	// Lazy: host-live-sources.js requires this module.
	const { suggestNextHostChannel } = require('./host-live-sources')
	return { hostOn: ON_ZOOM_CHANNEL, channel: suggestNextHostChannel(config || {}), layer }
}

/**
 * The placement an entry PLAYS at now: the owner's channel, or the DeckLink input it rides (followed through a
 * renumber). null when it has none yet — a legacy / DeckLink entry on a box with no DeckLink input needs a save
 * (normalize) that gives it the shared Zoom channel, and that channel an Apply.
 * @param {object} config
 * @param {object} item
 * @param {object} [map]
 */
function currentZoomPlacement(config, item, map) {
	const p = resolveZoomPlacement(config, item, map)
	if (!p) return null
	if (p.hostOn === ON_ZOOM_CHANNEL && !ownsZoomChannel(item) && !zoomEntriesOf(config).some(ownsZoomChannel)) return null
	return p
}

/**
 * @param {object} item
 * @param {object} ctx — `{ config }`
 */
function normalizeZoomHostSource(item, ctx) {
	const source = zoomSourceOf(item)
	if (!source) throw new Error(`Zoom source must be one of ${ZOOM_SOURCES.join(', ')}`)
	// A legacy stage-B entry (no hostOn) keeps nothing of its own channel: it is placed afresh.
	const self = item.hostOn ? item : { ...item, hostChannel: undefined, hostLayer: undefined }
	const p = resolveZoomPlacement(ctx?.config || {}, self)
	const sourceId = String(item.sourceId || `zoom_${source}`).trim()
	return {
		type: 'zoom',
		routeType: ZOOM_HOST_ROLE,
		source,
		ring: zoomRingName(source),
		value: getRouteString(p.channel, p.layer),
		label: String(item.label || `Zoom ${source}`).trim() || sourceId,
		hostOn: p.hostOn,
		...(p.slot != null ? { hostSlot: p.slot } : {}),
		hostChannel: p.channel,
		hostLayer: p.layer,
		sourceId,
		interactiveCapable: false,
		hostRole: ZOOM_HOST_ROLE,
	}
}

/**
 * PLAY the ring on the layer, hidden from the host channel's own picture (the layer route still carries it).
 * @param {number} ch
 * @param {number} layer
 * @param {object} item
 * @returns {string[]}
 */
function zoomHostPlayCommands(ch, layer, item) {
	const source = zoomSourceOf(item)
	if (!source) return []
	return [`PLAY ${ch}-${layer} SHM NAME ${zoomRingName(source)}`, `MIXER ${ch}-${layer} OPACITY 0`, `MIXER ${ch} COMMIT`]
}

/** @returns {string[]} */
function zoomHostStopCommands(ch, layer) {
	return [`STOP ${ch}-${layer}`, `MIXER ${ch}-${layer} CLEAR`, `MIXER ${ch} COMMIT`]
}

/**
 * Every configured Zoom source with its current placement (the replay / status list).
 * @param {object} config
 * @returns {{ kind: string, source: string, sourceId: string, channel: number, layer: number, hostOn: string,
 *   slot?: number, route: string, label: string, item: object }[]}
 */
function listZoomLayerEntries(config) {
	const entries = zoomEntriesOf(config)
	if (!entries.length) return []
	const map = require('./routing-map').getChannelMap(config || {})
	const out = []
	for (const item of entries) {
		const p = currentZoomPlacement(config, item, map)
		if (!p) continue
		const source = zoomSourceOf(item)
		out.push({
			kind: ZOOM_HOST_ROLE,
			source,
			sourceId: String(item.sourceId || `zoom_${source}`),
			channel: p.channel,
			layer: p.layer,
			hostOn: p.hostOn,
			...(p.slot != null ? { slot: p.slot } : {}),
			route: getRouteString(p.channel, p.layer),
			label: item.label || `Zoom ${source}`,
			item,
		})
	}
	return out
}

/**
 * Route heal (live-source-route-heal.js): re-point a Zoom entry at its current placement — a DeckLink input that moved,
 * or a legacy stage-B entry. Mutates `item`; returns the note, or '' when nothing changed.
 * @param {object} item
 * @param {object} config
 * @param {object} [map]
 */
function healZoomEntry(item, config, map) {
	const p = currentZoomPlacement(config, item, map)
	if (!p) return ''
	const route = getRouteString(p.channel, p.layer)
	if (item.value === route && item.hostOn === p.hostOn && Number(item.hostChannel) === p.channel) return ''
	const note = `"${item.label || 'Zoom'}": ${item.value} → ${route}`
	Object.assign(item, { value: route, hostOn: p.hostOn, hostChannel: p.channel, hostLayer: p.layer })
	if (p.slot != null) item.hostSlot = p.slot
	else delete item.hostSlot
	if ('thumbnailChannel' in item) item.thumbnailChannel = p.channel
	if ('thumbnailLayer' in item) item.thumbnailLayer = p.layer
	return note
}

// ── the applied casparcg.config vs the placement (is the channel really there, with that role?) ──

const applied = { path: '', mtimeMs: -1, size: -1, roles: new Map() }

/**
 * Channel → role text from the "<!-- HighAsCG: Caspar channel N: <role>" comments of the APPLIED casparcg.config (the
 * file Caspar starts from). Re-read only when its mtime / size change.
 * @returns {Map<number, string>}
 */
function appliedChannelRoles(ctx) {
	try {
		const p = require('../api/routes-caspar-config').resolveCasparConfigWritePath(ctx)
		const st = fs.statSync(p)
		if (applied.path === p && applied.mtimeMs === st.mtimeMs && applied.size === st.size) return applied.roles
		const roles = new Map()
		for (const m of fs.readFileSync(p, 'utf8').matchAll(/<!-- HighAsCG: Caspar channel (\d+): ([^\n]*)/g)) {
			roles.set(parseInt(m[1], 10), m[2])
		}
		Object.assign(applied, { path: p, mtimeMs: st.mtimeMs, size: st.size, roles })
		return roles
	} catch {
		return new Map()
	}
}

/** @returns {Set<number>|null} null when nothing is known about the running Caspar yet */
function runningChannels(ctx) {
	const ids = ctx?.gatheredInfo?.channelIds
	if (!Array.isArray(ids) || ids.length === 0) return null
	return new Set(ids.map(Number))
}

/**
 * True when the running Caspar has the placement's channel IN THAT ROLE: the applied config declares it as DeckLink
 * input <slot> (or as the Zoom host), and the running Caspar has the channel. This keeps a PLAY off a channel the
 * config map has renumbered but Caspar has not been restarted for (a pending Apply), e.g. onto the monitor channel.
 * @param {object} ctx
 * @param {{ hostOn: string, slot?: number, channel: number }} p
 */
function zoomHostChannelReady(ctx, p) {
	if (!p) return false
	const role = appliedChannelRoles(ctx).get(p.channel) || ''
	const roleOk = p.hostOn === ON_DECKLINK ? new RegExp(`^DeckLink input ${p.slot}\\b`).test(role) : /^Zoom host\b/.test(role)
	const running = runningChannels(ctx)
	return roleOk && (running == null || running.has(p.channel))
}

/**
 * Reconnect replay (host-live-sources-setup.js): PLAY every configured Zoom layer whose host channel is ready. A Zoom
 * failure never triggers the host-live auto-apply (no Caspar restart from here).
 * @param {object} self — app context (amcp, config, log, gatheredInfo)
 * @param {ReturnType<typeof listZoomLayerEntries>} entries
 */
async function replayZoomLayers(self, entries) {
	const played = []
	const failed = []
	for (const e of entries) {
		if (!zoomHostChannelReady(self, e)) {
			failed.push({ sourceId: e.sourceId, channel: e.channel, cmd: '(skipped)', message: 'zoom_host_channel_not_applied' })
			continue
		}
		let ok = true
		for (const cmd of zoomHostPlayCommands(e.channel, e.layer, e.item)) {
			try {
				await self.amcp.raw(cmd)
			} catch (err) {
				failed.push({ sourceId: e.sourceId, channel: e.channel, cmd, message: err?.message || String(err) })
				ok = false
				break
			}
		}
		if (ok) played.push({ sourceId: e.sourceId, channel: e.channel, kind: ZOOM_HOST_ROLE })
	}
	return { played, failed }
}

module.exports = {
	ZOOM_SOURCES,
	isZoomHostCandidate,
	zoomSourceOf,
	ownsZoomChannel,
	normalizeZoomHostSource,
	zoomHostPlayCommands,
	zoomHostStopCommands,
	listZoomLayerEntries,
	healZoomEntry,
	zoomHostChannelReady,
	replayZoomLayers,
}
