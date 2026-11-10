'use strict'

/**
 * WO-1029 plan 07 (C1a) — "screen index → Caspar channel" for maps that may have HOLES.
 *
 * With `cluster.channelsWhereCabled` on, a server creates channels only for the screens it outputs (cabled here,
 * config/destination-cabling.js). The screen index stays the cluster-wide key: `programChannels[i]` /
 * `previewChannels[i]` are `null` at the index of a screen that is not on this server (a HOLE). A hole must surface
 * as `null` — never as another screen's channel (the old `programCh(n)` fell back to screen 1's channel).
 *
 * Every helper takes either map shape: a `getChannelMap()` result (config/routing-map.js) or the `/api/state`
 * `channelMap` JSON (config/channel-map-from-ctx.js) — they read the ARRAYS, not the accessor functions. Screen
 * indices here are 0-based (`mainScreenIndex`); `programCh(n)` / `previewCh(n)` on the map are 1-based.
 *
 *   screenChannels(map, idx)      → { idx, here, pgm, prv }      hole: { here: false, pgm: null, prv: null }
 *                                                                  out of range: same as a hole
 *   isScreenHere(map, idx)        → boolean                       hole / out of range: false
 *   localScreens(map)             → number[]  the 0-based indices this server outputs (holes skipped) — use it for
 *                                             every "for each screen" loop (FTB all, zoom feeds, live-scene
 *                                             invalidation, timeline screen sets …) instead of `i < screenCount`
 *   localProgramChannels(map)     → number[]  PGM channels of local screens, in screen order
 *   localPreviewChannels(map)     → number[]  PRV channels of local screens that have one
 *   screenOfChannel(map, ch)      → { idx, bus: 'pgm'|'prv' } | null   null for a channel that is no screen bus here
 *   screenHost(map, idx)          → { idx, destId, here, pgm, prv }   `map.screenHosts[idx]` when the rule is on; else
 *                                   synthesized (destId null, here = has a PGM channel)
 *   hasHoles(map)                 → boolean  true only while the rule is on and at least one screen is elsewhere
 *   channelsWhereCabledEnabled(config) → boolean  the device-local flag (`cluster.channelsWhereCabled === true`)
 *
 * Callers decide what a hole means for them (skip it; a typed 409 NOT_HERE in a route until the dest.* relay
 * exists — plan 07 C1c / C6). Never substitute `programChannels[0]` or `(idx + 1) * 2`.
 *
 * makeBusAccessors() builds the map's own `programCh` / `previewCh` (routing-map.js uses it; not for consumers).
 */

const toCh = (v) => {
	const n = Number(v)
	return Number.isFinite(n) && n >= 1 ? n : null
}

/** The flag lives in this server's own config (top-level `cluster`, device-local: config-classify.js). */
function channelsWhereCabledEnabled(config) {
	const c = config && typeof config === 'object' ? config.cluster : null
	return !!(c && typeof c === 'object' && (c.channelsWhereCabled === true || c.channelsWhereCabled === 'true'))
}

function screenChannels(map, idx) {
	const i = Number(idx)
	const pgm = Number.isInteger(i) && i >= 0 ? toCh(map?.programChannels?.[i]) : null
	const prv = pgm != null ? toCh(map?.previewChannels?.[i]) : null
	return { idx: i, here: pgm != null, pgm, prv }
}

const isScreenHere = (map, idx) => screenChannels(map, idx).here

function screenCountOf(map) {
	const n = Number(map?.screenCount)
	const len = Array.isArray(map?.programChannels) ? map.programChannels.length : 0
	return Number.isFinite(n) && n >= 0 ? Math.min(n, len) : len
}

function localScreens(map) {
	const out = []
	for (let i = 0; i < screenCountOf(map); i++) if (isScreenHere(map, i)) out.push(i)
	return out
}

const localProgramChannels = (map) => localScreens(map).map((i) => screenChannels(map, i).pgm)

const localPreviewChannels = (map) =>
	localScreens(map)
		.map((i) => screenChannels(map, i).prv)
		.filter((c) => c != null)

function screenOfChannel(map, ch) {
	const c = toCh(ch)
	if (c == null) return null
	for (const i of localScreens(map)) {
		const s = screenChannels(map, i)
		if (s.pgm === c) return { idx: i, bus: 'pgm' }
		if (s.prv === c) return { idx: i, bus: 'prv' }
	}
	return null
}

function screenHost(map, idx) {
	const h = Array.isArray(map?.screenHosts) ? map.screenHosts[idx] : null
	if (h && typeof h === 'object') return { ...h }
	const s = screenChannels(map, idx)
	return { idx: s.idx, destId: null, here: s.here, pgm: s.here, prv: s.prv != null }
}

const hasHoles = (map) => map?.channelsWhereCabled === true && localScreens(map).length < screenCountOf(map)

/**
 * `programCh(n)` / `previewCh(n)` (1-based) for a channel map. `holey` (the rule is on): a hole or an index out of
 * range is `null`. Off: exactly the legacy behaviour (`programChannels[n-1] || programChannels[0]`), so the ~100
 * smokes and every flag-off box keep their answers; holes cannot exist then.
 */
function makeBusAccessors(lists, activeBuses, holey) {
	const { programChannels, previewChannels, switcherBusMode, switcherBus1Channels, switcherBusChannels } = lists
	const programCh = holey
		? (n) => (n >= 1 && n <= programChannels.length ? (programChannels[n - 1] ?? null) : null)
		: (n) => programChannels[n - 1] || programChannels[0]
	const previewCh = (n) => {
		const idx = n - 1
		if (idx >= 0 && idx < previewChannels.length) {
			if (holey && programChannels[idx] == null) return null
			if (switcherBusMode && activeBuses) {
				const pgm = programChannels[idx]
				const active = Number(activeBuses[String(pgm)] || switcherBus1Channels[idx])
				const bus1 = Number(switcherBus1Channels[idx])
				const bus2 = Number(switcherBusChannels[idx])
				if (bus1 > 0 && bus2 > 0) return active === bus1 ? bus2 : bus1
			}
			return previewChannels[idx]
		}
		return null
	}
	return { programCh, previewCh }
}

module.exports = {
	channelsWhereCabledEnabled,
	screenChannels,
	isScreenHere,
	localScreens,
	localProgramChannels,
	localPreviewChannels,
	screenOfChannel,
	screenHost,
	hasHoles,
	makeBusAccessors,
}
