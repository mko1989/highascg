'use strict'

/**
 * WO-1029 part 2 — the air snapshot: what is on this box's outputs right before an Apply restarts Caspar, so the
 * restore (air-snapshot-restore.js) can put it back as soon as Caspar answers again.
 *
 * Owner, 10.11: "hitting that button should grab a full state of the box outputs etc with video frames if running etc
 * and restore it back to screens asap after restart is sucessful".
 *
 * Two sources: Caspar's own `INFO <ch>` per channel (producer, clip, paused, loop, time / length, route source, html
 * URL) and node's state for what Caspar cannot tell (live looks per program channel, the test card, the timeline's
 * position and play state, the stream / recordings node ADDed). Each channel carries its ROLE in the running Caspar
 * (air-snapshot-roles.js, as recorded at the last Caspar connect) so the restore maps by destination, never by number.
 *
 * Persisted (`airSnapshot`, flushed at once) before the restart; armed for the next Caspar (re)connect only; discarded
 * once restored or when older than {@link STALE_MS}. Every outside call is injectable (`deps`) for the offline smoke.
 */

const os = require('os')
const { parseChannelInfo } = require('./air-snapshot-parse')
const { rolesOf, roleKind, rolesToObject } = require('./air-snapshot-roles')

const KEY = 'airSnapshot'
/** A snapshot older than this is not restored (an Apply is 5–30 s; the worst nodm path ~100 s). */
const STALE_MS = 4 * 60 * 1000

function defaultDeps(ctx) {
	return {
		now: () => Date.now(),
		uptimeMs: () => os.uptime() * 1000,
		persistence: ctx?.persistence || require('../utils/persistence'),
		info: async (ch) => require('../caspar/channel-info-xml').infoResponseToXml(await ctx.amcp.info(ch)),
		liveLooks: () => require('../state/live-scene-state').getAll() || {},
		timeline: () => (ctx?.timelineEngine?.getPlayback ? ctx.timelineEngine.getPlayback() : null),
		getChannelMap: (cfg) => require('../config/routing').getChannelMap(cfg),
	}
}

/** Role of each channel in the RUNNING Caspar: recorded at its last connect (ctx._airRolesAtConnect), else now. */
function runningRoles(ctx, deps) {
	const rec = ctx?._airRolesAtConnect
	if (rec && typeof rec === 'object' && Object.keys(rec).length) return rec
	return rolesToObject(rolesOf(ctx?.config || {}, deps.getChannelMap))
}

/** Called on every Caspar connect (caspar-info-ready.js): the roles the config Caspar just started with gives. */
function rememberConnectRoles(ctx, getChannelMap) {
	try {
		ctx._airRolesAtConnect = rolesToObject(rolesOf(ctx.config || {}, getChannelMap))
	} catch {
		/* keep the last one */
	}
}

/** Stream / recordings node started over AMCP (not in casparcg.config). */
function consumersOf(ctx) {
	const s = ctx?.streamingChannelRtmp
	const recs = ctx?.streamingChannelRecords && typeof ctx.streamingChannelRecords === 'object' ? ctx.streamingChannelRecords : {}
	return {
		stream: s?.active ? { active: true, outputId: s.outputId || null } : null,
		records: Object.entries(recs)
			.filter(([, r]) => r?.active)
			.map(([key, r]) => ({ key, outputId: r.outputId || null, path: r.path || r.file || null })),
	}
}

/**
 * Take the snapshot (does not store it). Never throws for one channel: an unreadable channel is listed in `errors`.
 * @param {object} ctx
 * @param {{ reason?: string, deps?: object }} [opts]
 */
async function captureAirSnapshot(ctx, { reason = 'apply', deps: injected } = {}) {
	const deps = { ...defaultDeps(ctx), ...(injected || {}) }
	if (!ctx?.amcp && !injected?.info) throw new Error('Caspar not connected')
	const now = deps.now()
	const roles = runningRoles(ctx, deps)
	const labels = rolesOf(ctx?.config || {}, deps.getChannelMap).label
	const channels = []
	const errors = []
	for (const [chKey, role] of Object.entries(roles)) {
		const channel = parseInt(chKey, 10)
		if (!Number.isFinite(channel) || channel < 1) continue
		let parsed
		try {
			parsed = await parseChannelInfo(await deps.info(channel))
		} catch (e) {
			errors.push({ channel, error: e?.message || String(e) })
			continue
		}
		if (!parsed) {
			errors.push({ channel, error: 'INFO not readable' })
			continue
		}
		channels.push({ channel, role, kind: roleKind(role), label: labels.get(role) || role, fps: parsed.fps, layers: parsed.layers })
	}
	const live = deps.liveLooks() || {}
	const looks = []
	for (const [chKey, entry] of Object.entries(live)) {
		const scene = entry?.scene
		if (!scene || !Array.isArray(scene.layers) || !scene.layers.some((l) => l?.source?.value)) continue
		looks.push({ channel: Number(chKey), role: roles[chKey] || '', scene_id: String(scene.id ?? entry.sceneId ?? ''), name: String(scene.name || '') })
	}
	let timeline = null
	try {
		const pb = deps.timeline()
		if (pb?.timelineId) {
			timeline = { id: String(pb.timelineId), playing: !!pb.playing, position_ms: Math.max(0, Number(pb.position) || 0), loop: !!pb.loop }
		}
	} catch (e) {
		errors.push({ what: 'timeline', error: e?.message || String(e) })
	}
	return {
		v: 1,
		id: `air_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
		taken_at: now,
		uptime_ms: deps.uptimeMs(),
		reason,
		roles,
		channels,
		looks,
		card: { active: ctx?._ledTestPatternActive === true, source: ctx?._ledTestCardSource || null },
		timeline,
		consumers: consumersOf(ctx),
		errors,
	}
}

/* ── store: persisted, armed for the next (re)connect, one at a time ── */

function storeSnapshot(snap, persistence) {
	persistence.set(KEY, snap)
	if (typeof persistence.flushSync === 'function') persistence.flushSync() // the apply may take node down with it
}

function discardSnapshot(persistence) {
	if (persistence.get(KEY) == null) return
	if (typeof persistence.remove === 'function') persistence.remove(KEY)
	else persistence.set(KEY, null)
	if (typeof persistence.flushSync === 'function') persistence.flushSync()
}

/**
 * The snapshot this connect may restore, or `{ snap: null, why }`. A reconnect of this node process takes any fresh
 * one; the FIRST connect of a node process (boot keeps WO-1013's "clear") only when the machine did not reboot since
 * (node restarted by the apply path): uptime longer than the snapshot's age.
 * @param {{ reconnect: boolean, persistence: object, now: number, uptimeMs: number }} o
 */
function armedSnapshot({ reconnect, persistence, now, uptimeMs }) {
	const snap = persistence.get(KEY)
	if (!snap || typeof snap !== 'object' || snap.v !== 1) return { snap: null, why: 'none' }
	const age = now - Number(snap.taken_at || 0)
	if (!(age >= 0) || age > STALE_MS) return { snap: null, why: `stale (${Math.round(age / 1000)} s)`, stale: true }
	if (!reconnect && !(uptimeMs > age)) return { snap: null, why: 'box rebooted since the snapshot', stale: true }
	return { snap, why: '' }
}

/* ── the apply route waits for the restore of its own snapshot ── */
const waiters = new Map()
const finished = new Map()

/** Resolves with the restore report, or null after `ms`. */
function waitRestored(id, ms) {
	if (finished.has(id)) return Promise.resolve(finished.get(id))
	return new Promise((resolve) => {
		const list = waiters.get(id) || []
		const t = setTimeout(() => resolve(null), ms)
		if (t.unref) t.unref()
		list.push((r) => {
			clearTimeout(t)
			resolve(r)
		})
		waiters.set(id, list)
	})
}

function reportRestored(id, report) {
	finished.set(id, report)
	if (finished.size > 8) finished.delete(finished.keys().next().value)
	for (const fn of waiters.get(id) || []) fn(report)
	waiters.delete(id)
}

module.exports = {
	KEY,
	STALE_MS,
	captureAirSnapshot,
	rememberConnectRoles,
	consumersOf,
	storeSnapshot,
	discardSnapshot,
	armedSnapshot,
	waitRestored,
	reportRestored,
}
