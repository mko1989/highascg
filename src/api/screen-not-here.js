'use strict'

/**
 * WO-1029 plan 07 (C1c) — a request that addresses a screen with NO channel on this server.
 *
 * With `cluster.channelsWhereCabled` on, `programChannels[i]` / `previewChannels[i]` are null at the index of a screen
 * cabled on other servers (config/screen-channels.js). A route that gets such a screen (by screen index, by
 * destination id, or by its program/preview channel number on a server where that number does not exist) answers
 *
 *   409 { error: 'Screen N is not on this server: it is on <names>' | 'Screen N is not cabled on any server',
 *         code: 'NOT_HERE', screen: <0-based idx>, destId, owners: [server ids] }
 *
 * — never executed on another screen's channel, never a 200 that did nothing, never a 500. A later step relays the
 * request to an owner; the typed 409 is what that step hooks into. "All screens" operations act on the local screens
 * and list the others in the answer (`notHere: [{ screen, destId, owners }]`, `notHereList`).
 *
 * Flag off: every helper here is inert (`screenTarget().here` is true, `notHereFor` resolves null, `notHereList` is []).
 *
 *   screenTarget(ctx, { screenIdx | channel | destId }) → { here, pgm, prv, idx, destId, owners: [{ id, name }] }
 *       `channel` (a Caspar number) only maps to a screen when it is a PGM/PRV bus HERE; otherwise idx is null and
 *       `here` is true (the ordinary "no such channel" answer of the route stays in charge).
 *   notHereFor(ctx, query)   → Promise<409 reply | null>   — the one-liner for routes: `const nh = await notHereFor(...)`
 *   channelForScreen(ctx, body, relay?) → { channel } | { reply }   body.channel, else body.screenIdx → its PGM (409 when a
 *                              hole; with `relay` { action, args } the owner's answer, dest-route.js)
 *   notHereReply(ctx, x)     → Promise<409 reply>   x: a screenTarget, an `e.code === 'NOT_HERE'` error, or the
 *                              `{ notHere: true, screenIdx }` result the engine returns
 *   isNotHere(x)             → x is one of those two engine shapes
 *   notHereList(ctx)         → [{ screen, destId, owners: [server ids] }] for every screen not on this server
 */

const { JSON_HEADERS, jsonBody } = require('./response')
const { getChannelMap } = require('../config/routing')
const sc = require('../config/screen-channels')

const mapOf = (ctx) => getChannelMap(ctx?.config || {})
const holeRuleOn = (ctx, map) => sc.channelsWhereCabledEnabled(ctx?.config) && map?.channelsWhereCabled === true

/** WO-1029 Wave B: the one owner lookup (cluster/dest-owners.js), shared with the ownership gate and dest-route. */
const ownerIndex = (ctx) => ctx?._clusterOwnership?.ownerIndex || require('../cluster/dest-owners').ownerIndexOf(ctx)

/** Linked servers' cables, refreshed when older than 15 s (never creates the cluster just to answer a refusal). */
async function warmOwners(ctx) {
	try {
		await ownerIndex(ctx)?.warm()
	} catch {
		/* no cluster layer: owners stay empty ("not cabled on any server") */
	}
}

function ownersOf(ctx, destId) {
	if (!destId) return []
	return (ownerIndex(ctx)?.ownersOf(destId) || []).map((o) => ({ id: o.id, name: o.name }))
}

/** The destination id of a screen index: the map's own `screenHosts`, else the shared list's main entry. */
function destOfScreen(ctx, map, idx) {
	const id = sc.screenHost(map, idx)?.destId
	if (id) return id
	for (const d of ctx?.config?.screenDestinations?.destinations || []) {
		if (d && Math.max(0, parseInt(String(d.mainScreenIndex ?? 0), 10) || 0) === idx && /^pgm|^pgm_prv$/.test(String(d.mode || 'pgm_prv'))) return d.id || null
	}
	return null
}

function screenTarget(ctx, q = {}) {
	const map = mapOf(ctx)
	const on = holeRuleOn(ctx, map)
	let idx = null
	if (q.screenIdx != null && q.screenIdx !== '' && Number.isFinite(Number(q.screenIdx))) idx = Math.floor(Number(q.screenIdx))
	else if (q.destId) {
		const h = (map.screenHosts || []).find((x) => x?.destId === q.destId)
		if (h) idx = h.idx
	} else if (q.channel != null) {
		const s = sc.screenOfChannel(map, q.channel)
		if (s) idx = s.idx
	}
	if (!on) {
		if (idx == null || idx < 0) return { here: true, pgm: null, prv: null, idx, destId: q.destId || null, owners: [] }
		return { here: true, pgm: map.programCh(idx + 1), prv: map.previewCh(idx + 1), idx, destId: null, owners: [] }
	}
	if (idx == null || idx < 0 || idx >= map.screenCount) return { here: true, pgm: null, prv: null, idx, destId: q.destId || null, owners: [] }
	const s = sc.screenChannels(map, idx)
	const destId = destOfScreen(ctx, map, idx)
	return { here: s.here, pgm: s.pgm, prv: s.prv, idx, destId, owners: s.here ? [] : ownersOf(ctx, destId) }
}

function messageOf(t) {
	const n = t.idx + 1
	return t.owners.length ? `Screen ${n} is not on this server: it is on ${t.owners.map((o) => o.name).join(', ')}` : `Screen ${n} is not cabled on any server`
}

/** `x` → a screenTarget-like { idx, destId, owners } (an engine error / result only knows the screen). */
function asTarget(ctx, x) {
	if (x && Array.isArray(x.owners) && x.idx != null) return x
	const idx = Number(x?.screenIdx ?? x?.screen ?? x?.idx)
	const t = screenTarget(ctx, { screenIdx: Number.isFinite(idx) ? idx : x?.destId ? undefined : 0, destId: x?.destId })
	const idx2 = Number.isFinite(idx) ? idx : t.idx
	return { idx: idx2, destId: x?.destId || t.destId || destOfScreen(ctx, mapOf(ctx), idx2), owners: t.owners.length ? t.owners : ownersOf(ctx, x?.destId) }
}

async function notHereReply(ctx, x) {
	await warmOwners(ctx)
	const t = asTarget(ctx, x)
	if (!t.owners.length && t.destId) t.owners = ownersOf(ctx, t.destId)
	const body = { error: messageOf(t), code: 'NOT_HERE', screen: t.idx, destId: t.destId || null, owners: t.owners.map((o) => o.id) }
	return { status: 409, headers: JSON_HEADERS, body: jsonBody(body) }
}

async function notHereFor(ctx, q) {
	const t = screenTarget(ctx, q)
	return t.here ? null : notHereReply(ctx, t)
}

/**
 * The program channel a request addresses: `body.channel` as it is today, else (new) `body.screenIdx` → that screen's PGM
 * here. → `{ channel }` (NaN = nothing addressed: the route's own "channel required") or `{ reply }` (409 NOT_HERE).
 */
async function channelForScreen(ctx, b, relay = null) {
	if (b.channel == null && b.screenIdx != null && b.screenIdx !== '') {
		const t = screenTarget(ctx, { screenIdx: b.screenIdx })
		// WO-1029 Wave B: `relay` = { action, args } → the screen's owner runs it (dest-route.js), else the 409
		if (!t.here && relay) return { reply: await require('../cluster/dest-route').relayIfNotHere(ctx, { screenIdx: t.idx }, relay.action, relay.args) }
		if (!t.here) return { reply: await notHereReply(ctx, t) }
		if (t.pgm != null) return { channel: t.pgm }
	}
	return { channel: parseInt(b.channel, 10) }
}

/** The reply built from the error alone (http-server.js' catch has no ctx). */
function notHereFromError(e) {
	const idx = Number(e?.screenIdx ?? e?.screen)
	const owners = (Array.isArray(e?.owners) ? e.owners : []).map((o) => (o && typeof o === 'object' ? o.id : o)).filter(Boolean)
	const msg = e?.message || (Number.isFinite(idx) ? `Screen ${idx + 1} is not on this server` : 'Screen is not on this server')
	return { status: 409, headers: JSON_HEADERS, body: jsonBody({ error: msg, code: 'NOT_HERE', screen: Number.isFinite(idx) ? idx : null, destId: e?.destId || null, owners }) }
}

const isNotHere = (x) => !!x && (x.code === 'NOT_HERE' || x.notHere === true)

/** Screens not on this server (flag on), for the "all screens" answers. Owners are the ids last learned. */
function notHereList(ctx) {
	const map = mapOf(ctx)
	if (!holeRuleOn(ctx, map)) return []
	const out = []
	for (let i = 0; i < map.screenCount; i++) {
		if (sc.isScreenHere(map, i)) continue
		const destId = destOfScreen(ctx, map, i)
		out.push({ screen: i, destId, owners: ownersOf(ctx, destId).map((o) => o.id) })
	}
	return out
}

module.exports = { warmOwners, notHereFromError, channelForScreen, screenTarget, notHereFor, notHereReply, isNotHere, notHereList }
