'use strict'

/**
 * WO-1029 plan 06 S13 — the stable name of a live input on ONE server: `<kind>:<id>`, never a channel number.
 *
 *   decklink:<slot>           a DeckLink input slot (1-based, as in `decklink_input_<slot>_*`)
 *   live_audio:<slot>         a live audio input slot
 *   v4l2:<slot>               a V4L2 capture slot
 *   ndi_host:<sourceId>       a host channel playing an NDI source
 *   webpage_host:<sourceId>   a host channel playing a web page
 *   browser_display:<sourceId> a host channel grabbing a browser display
 *   zoom_host:<sourceId>      a Zoom host layer
 *
 * A channel number moves whenever a channel is added before it (WO-271) and differs between linked servers (WO-1027);
 * the key does not. Across servers an input is `{ server, input: <key> }` (cluster-device-view.js). The routing map's
 * `inputChannels` rows (kind / slot / sourceId → channel / layer / route) resolve a key to today's channel on the box
 * that owns the input (live-source-route-heal.js `authoritativeEntryForSource`).
 */

const SLOT_KINDS = new Set(['decklink', 'live_audio', 'v4l2'])
const SOURCE_KINDS = new Set(['ndi_host', 'webpage_host', 'browser_display', 'zoom_host'])
const KEY_RE = /^([a-z0-9_]+):(.+)$/

const slotOf = (v) => {
	const n = parseInt(String(v ?? ''), 10)
	return Number.isFinite(n) && n >= 1 ? n : null
}
const keyOf = (kind, id) => (kind && id != null && String(id) !== '' ? `${kind}:${id}` : null)

/** The key of an `extraLiveSources` item (its routeType + stored identity), or null when it has none. */
function inputKeyOfSource(item) {
	const rt = String(item?.routeType || '').toLowerCase()
	if (rt === 'decklink') return keyOf(rt, slotOf(item.decklinkSlot))
	if (rt === 'live_audio') return keyOf(rt, slotOf(item.liveAudioSlot))
	if (rt === 'v4l2') return keyOf(rt, slotOf(item.v4l2Slot))
	if (SOURCE_KINDS.has(rt)) return keyOf(rt, String(item.sourceId || item.hostSourceId || '').trim() || null)
	return null
}

/** The key of a routing-map `inputChannels` row ({ kind, slot | sourceId }), or null. */
function inputKeyOfEntry(entry) {
	const kind = String(entry?.kind || '').toLowerCase()
	if (SLOT_KINDS.has(kind)) return keyOf(kind, slotOf(entry.slot))
	if (SOURCE_KINDS.has(kind)) return keyOf(kind, String(entry.sourceId || '').trim() || null)
	return null
}

/** The key of a DeckLink connector set to input (`dlsdi_<n>`, `caspar.ioDirection: 'in'`), or null. */
function inputKeyOfConnector(c) {
	if (c?.kind !== 'decklink_io' || String(c?.caspar?.ioDirection || '').toLowerCase() !== 'in') return null
	const m = String(c.id || '').match(/^dlsdi_(\d+)$/)
	return keyOf('decklink', slotOf(m ? m[1] : c.externalRef))
}

/** 'decklink:3' → { kind: 'decklink', slot: 3 }; 'ndi_host:cam' → { kind, sourceId }; anything else → null. */
function parseInputKey(key) {
	const m = String(key || '').match(KEY_RE)
	if (!m) return null
	if (SLOT_KINDS.has(m[1])) return slotOf(m[2]) ? { kind: m[1], slot: slotOf(m[2]) } : null
	if (SOURCE_KINDS.has(m[1])) return { kind: m[1], sourceId: m[2] }
	return null
}

/** The `inputChannels` row of a key under a channel map (getChannelMap()), or null. */
function entryForInputKey(key, map) {
	const k = String(key || '')
	if (!parseInputKey(k)) return null
	return (Array.isArray(map?.inputChannels) ? map.inputChannels : []).find((e) => inputKeyOfEntry(e) === k) || null
}

module.exports = { inputKeyOfSource, inputKeyOfEntry, inputKeyOfConnector, parseInputKey, entryForInputKey }
