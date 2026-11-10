'use strict'

/**
 * WO-1029 plan 07 C8 — the RECEIVER of `dest.air` (publisher: dest-air.js): what is on the screens cabled on a linked
 * server, by screen index, for `GET /api/state` `scene.remoteLive` and WS `cluster:dest-air`.
 *
 * Kept: the newest message per (source server, destination). A message from the same source carrying an older sender
 * time than the held one (both the SENDER's clock: comparable) arriving within REORDER_MS is dropped.
 * Unknown (never stale-as-fresh): no message for EXPIRE_MS (by the receiver's own receipt times), the exchange's
 * expiry, or the source going offline on the cluster poll (at once). An unknown entry carries no content.
 * Unlinked (the exchange's `drop`): its destinations go (null).
 *
 * Clock independence (project rule for every cross-box message): a sender `at` is never compared with this server's
 * clock. Each timed field becomes `age = (now − receivedAt) + (msg.at − field.at)` — the first term is ours, the
 * second is the sender's — and `at` in the view is that moment on THIS server's clock (`receivedAt − (msg.at − field.at)`).
 * Network transit (< 1 ms on a LAN) is not counted.
 */

const { getChannelMap } = require('../config/routing')
const sc = require('../config/screen-channels')

const EXPIRE_MS = 15000
const REORDER_MS = 2000
const WS_COALESCE_MS = 100
const MAX_DESTS = 64

/** Tests inject a clock per box (`ctx._destAirNow`); the two boxes' clocks are never compared. */
const nowOf = (ctx) => (typeof ctx?._destAirNow === 'function' ? ctx._destAirNow() : Date.now())

const initialState = () => ({ remote: new Map(), wsTimer: null, wsSig: '' })

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)
const str = (v, max = 200) => String(v ?? '').slice(0, max)

/** One sent destination → a clean copy (untrusted input from the wire). */
function clean(d) {
	const look = (x) => (x && typeof x === 'object' && x.sceneId ? { sceneId: str(x.sceneId), name: str(x.name), at: num(x.at) } : null)
	const tl = d.timeline && typeof d.timeline === 'object' && d.timeline.id ? d.timeline : null
	const h = d.holder && typeof d.holder === 'object' ? d.holder : null
	return {
		destId: str(d.destId),
		screen: Number.isInteger(d.screen) && d.screen >= 0 ? d.screen : null,
		pgm: look(d.pgm),
		prv: look(d.prv),
		testcard: d.testcard === true,
		ftb: d.ftb === true,
		timeline: tl ? { id: str(tl.id), state: str(tl.state, 16), position_ms: num(tl.position_ms) ?? 0, at: num(tl.at) } : null,
		holder: h ? { server: str(h.server), seq: num(h.seq) ?? 0, at: num(h.at) } : null,
		clips: (Array.isArray(d.clips) ? d.clips.slice(0, 4) : [])
			.filter((c) => c && typeof c === 'object' && c.clip)
			.map((c) => ({ bus: c.bus === 'prv' ? 'prv' : 'pgm', layer: num(c.layer), clip: str(c.clip, 500), position_s: num(c.position_s) ?? 0,
				length_s: num(c.length_s), paused: c.paused === true, loop: c.loop === true, at: num(c.at) })),
		at: num(d.at),
	}
}

/** The exchange handler. `why`: '' (a message), 'expired' (15 s silent), 'dropped' (unlinked). */
function received(ctx, st, data, source, why) {
	if (!source?.id) return
	const t = nowOf(ctx)
	if (why === 'dropped') {
		for (const [k, r] of st.remote) if (r.source.id === source.id) st.remote.delete(k)
	} else if (why === 'expired') {
		for (const r of st.remote.values()) if (r.source.id === source.id) r.unknown = true
	} else {
		const msgAt = num(data?.at)
		const list = Array.isArray(data?.destinations) ? data.destinations.slice(0, MAX_DESTS) : null
		if (msgAt == null || !list) return
		const seen = new Set()
		for (const raw of list) {
			if (!raw || typeof raw !== 'object' || !raw.destId) continue
			const d = clean(raw)
			const k = `${source.id}|${d.destId}`
			const held = st.remote.get(k)
			if (held && msgAt < held.msgAt && t - held.recvAt < REORDER_MS) continue // an older message overtaken
			seen.add(k)
			st.remote.set(k, { source: { id: str(source.id), name: str(source.name) }, d, msgAt, recvAt: t, unknown: false })
		}
		// a destination the source no longer lists is no longer cabled there
		for (const [k, r] of st.remote) if (r.source.id === source.id && !seen.has(k) && !list.some((x) => x?.destId === r.d.destId)) st.remote.delete(k)
	}
	push(ctx, st)
}

/** Cluster poll: a source that is offline (or no longer linked) is unknown at once, not 15 s later. */
function peersPolled(ctx, st) {
	if (!st.remote.size) return
	let peers
	try {
		peers = ctx?._cluster?.snapshot?.().peers
	} catch {
		peers = null
	}
	if (!Array.isArray(peers)) return
	const online = new Set(peers.filter((p) => p.online === true).map((p) => p.id))
	let n = 0
	for (const r of st.remote.values()) {
		if (!r.unknown && !online.has(r.source.id)) {
			r.unknown = true
			n++
		}
	}
	if (n) push(ctx, st)
}

/** One record → the client view (ages + this server's clock). */
function entryView(r, idx, t) {
	const base = { server: { ...r.source }, destId: r.d.destId, screen: idx }
	const lag = t - r.recvAt // ours
	const unknown = r.unknown || lag > EXPIRE_MS
	if (unknown) return { ...base, unknown: true, last_seen_age_ms: lag, pgm: null, prv: null, testcard: null, ftb: null, timeline: null, holder: null, clips: [] }
	const timed = (x) => {
		if (!x) return null
		const skew = x.at != null ? r.msgAt - x.at : 0 // the sender's own difference
		return { ...x, at: r.recvAt - skew, age_ms: lag + skew }
	}
	return {
		...base,
		unknown: false,
		age_ms: lag,
		pgm: timed(r.d.pgm),
		prv: timed(r.d.prv),
		testcard: r.d.testcard,
		ftb: r.d.ftb,
		timeline: timed(r.d.timeline),
		holder: timed(r.d.holder),
		clips: r.d.clips.map(timed),
	}
}

/**
 * `scene.remoteLive`: an array by screen index (this server's screen count), null where the screen is here or nobody
 * reported it. Two sources for one screen (a backup cabled on two linked servers): known beats unknown, then newest.
 */
function remoteLive(ctx, st) {
	const map = getChannelMap(ctx?.config || {}, ctx?.switcherOutputBusByChannel)
	const n = Array.isArray(map.programChannels) ? map.programChannels.length : Number(map.screenCount) || 0
	const out = Array.from({ length: n }, () => null)
	const t = nowOf(ctx)
	const idxOf = new Map((map.screenHosts || []).filter((h) => h?.destId).map((h) => [String(h.destId), h.idx]))
	for (const r of st.remote.values()) {
		const idx = idxOf.has(r.d.destId) ? idxOf.get(r.d.destId) : r.d.screen
		if (!Number.isInteger(idx) || idx < 0 || idx >= n || sc.isScreenHere(map, idx)) continue
		const v = entryView(r, idx, t)
		const cur = out[idx]
		if (!cur || (cur.unknown && !v.unknown) || (cur.unknown === v.unknown && (v.age_ms ?? v.last_seen_age_ms) < (cur.age_ms ?? cur.last_seen_age_ms))) out[idx] = v
	}
	return out
}

/** WS `cluster:dest-air` { remoteLive }, coalesced; nothing when only ages moved. */
function push(ctx, st) {
	if (st.wsTimer || typeof ctx?._wsBroadcast !== 'function' || !sc.channelsWhereCabledEnabled(ctx.config)) return
	st.wsTimer = setTimeout(() => {
		st.wsTimer = null
		const list = remoteLive(ctx, st)
		const sig = JSON.stringify(list, (k, v) => (k === 'age_ms' || k === 'last_seen_age_ms' ? undefined : k === 'at' ? Math.round(v / 1000) : v))
		if (sig === st.wsSig) return
		st.wsSig = sig
		ctx._wsBroadcast('cluster:dest-air', { remoteLive: list })
	}, WS_COALESCE_MS)
	st.wsTimer.unref?.()
}

module.exports = { nowOf, EXPIRE_MS, WS_COALESCE_MS, initialState, received, peersPolled, remoteLive }
