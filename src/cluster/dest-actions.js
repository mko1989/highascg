'use strict'

/**
 * WO-1029 plan 07 (Wave B, C5) — the receiver of node-to-node dest.* calls (POST /api/cluster/call, cluster-call.js).
 *
 * A linked server presses on one of THIS server's screens, addressed by destination id (`args.destId`). The call
 * resolves destId → this server's screen index (`mainScreenIndex` of its own shared list) → its own channels, and runs
 * THIS server's own route handler for that screen: a remote press is a local press (live state, journal, GUI broadcast
 * all happen here as for a local press; owner D3). It runs inside dest-route.js `runAsRemote`, so nothing it does is
 * relayed or forwarded again (no loops) — except `fanout: true` on the master: a backup box handing its press over
 * (plan 3.7); the master then drives every other owner of that destination too.
 *
 *   dest.take     { destId, sceneId, bus?: 'program'|'preview', forceCut?, transitionOverride?, timersVisibility? }
 *                 → routes-scene-take-look handleTakeLook (mainIdx = the screen here, `relayed`: never handed on)
 *   dest.preview  { destId, body }  → routes-scene-preview-push handlePreviewPush (the client's body, mainIdx here)
 *   dest.clear    { destId, bus: 'preview'|'program', cut? }  → PRV clear / the preset's program fade (look-preset)
 *   dest.ftb      { destId, body: { durationFrames?, tween?, framerate? } }  → routes-ftb (that one screen)
 *   dest.testcard { destId, on }   → routes-led-test-control `channel` by screen index
 *   dest.media    { destId, op: 'take'|'audio-only-stop', body }  → routes-scene-take / -take-audio-only by screenIdx
 *   dest.layer    { destId, op: 'layer-reload'|'layer-scrub', body } → routes-scene-layer-tools / -layer-scrub
 *   dest.mixer    { destId, op: 'mixer-nudge', body } → routes-preview-nudge (PRV / PGM geometry nudge)
 *   dest.timeline { destId, op: 'play'|'take'|'pause'|'stop'|'seek'|'loop', timelineId, body, all? } → routes-timeline;
 *                 play / take route the timeline to this screen (`all`: to every screen here)
 *   dest.state    { destId }  (info list: a query, not locked by accept_remote) → what this screen shows here
 *
 * Answers `{ status, body: object }` (cluster-call.js). Unknown destination → 404 DEST_UNKNOWN_HERE; in the list but
 * not cabled here → 409 NOT_HERE with its owners (screen-not-here.js). `accept_remote` off → 403 (cluster-call.js).
 *
 * Last press wins (`meta.seq`, the sender's per-destination order, cluster-call.js nextSeq): a call older than the last
 * one applied for that destination — from the same sender always, from another sender within STALE_WINDOW_MS — is
 * answered `{ ok: true, stale: true }` and not run; an equal seq from two senders: the higher sender id wins. The
 * window keeps two servers whose clocks differ (no NTP on show LANs) from locking each other out: only presses that
 * really raced are ordered. Retries are de-duplicated by `meta.opId` in the transport before this runs.
 *
 * Late arrival: a call that reaches the handler after its sender stopped waiting (`args.ttlMs`, the sender's timeout —
 * e.g. this node was frozen and reads the queued request when it thaws) is answered 409 DEST_EXPIRED and not run: the
 * operator was already told "unreachable", the press must not land seconds later. Its age is estimated without comparing
 * clocks: (local arrival − sender ts) minus the smallest such value seen from that sender in the last BASE_MS (the clock
 * offset plus the fastest delivery). The very first call from a sender has no baseline and always runs. A sender whose
 * clock stepped (its stamps stop rising in step with arrival) is rebased within a few presses (WO-1106 C21, lateBy).
 */

const once = require('./press-once')

const STALE_WINDOW_MS = 2000
const BASE_MS = 10 * 60 * 1000
/** WO-1106 C21: lateness after a sender's clock step (lateBy). */
const SPREAD_MS = 250 // presses read closer together than this came in one burst (a thaw), never a clock step
const IN_STEP_MS = 500 // two presses' stamps rose with their arrival within this
const IN_STEP_SPAN_MS = 2000 // … over at least this long, before a sender of unknown lateness gets a baseline again
const REBASE_AFTER = 3
const TIMELINE_OPS = new Set(['play', 'take', 'pause', 'stop', 'seek', 'loop'])

/** A route reply → { status, body: object }. */
function asObj(r) {
	if (!r || typeof r !== 'object') return { status: 200, body: { ok: true } }
	let body = r.body
	if (typeof body === 'string' || Buffer.isBuffer(body)) {
		try {
			body = JSON.parse(String(body))
		} catch {
			body = { text: String(body) }
		}
	}
	return { status: r.status || 200, body: body && typeof body === 'object' ? body : { ok: true } }
}

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
const json = (v) => JSON.stringify(v)

/**
 * @param {object} ctx  the server ctx
 * @param {{ routes?: object, now?: () => number, isMaster?: () => boolean }} [deps]  routes: handler overrides (tests)
 */
function createDestActions(ctx, deps = {}) {
	const now = deps.now || (() => performance.now())
	const isMaster = deps.isMaster || (() => ctx?._clusterMaster?.view?.()?.is_master === true)
	const last = new Map() // destId → { seq, from, at }
	const bySender = new Map() // destId \n sender → last seq applied
	const R = deps.routes || {}
	const route = (name, fallback) => R[name] || fallback

	/** destId → { idx } | { reply } */
	async function resolve(destId) {
		const list = ctx?.config?.screenDestinations?.destinations
		const d = Array.isArray(list) ? list.find((x) => x && x.id === destId) : null
		if (!d) return { reply: { status: 404, body: { ok: false, error: `destination ${destId} is not in this server's list`, code: 'DEST_UNKNOWN_HERE', destId } } }
		const idx = Math.max(0, parseInt(String(d.mainScreenIndex ?? 0), 10) || 0)
		const nh = require('../api/screen-not-here')
		const t = nh.screenTarget(ctx, { screenIdx: idx })
		if (!t.here) return { reply: asObj(await nh.notHereReply(ctx, t)) }
		return { idx, t }
	}

	function stale(destId, from, seq) {
		if (!Number.isSafeInteger(seq)) return null
		const mine = bySender.get(`${destId}\n${from}`)
		if (mine != null && seq <= mine) return { seq: mine, from }
		const l = last.get(destId)
		if (l && l.from !== from && now() - l.at < STALE_WINDOW_MS && (seq < l.seq || (seq === l.seq && from < l.from))) return { seq: l.seq, from: l.from }
		return null
	}

	function record(destId, from, seq) {
		if (!Number.isSafeInteger(seq)) return
		bySender.set(`${destId}\n${from}`, seq)
		const l = last.get(destId)
		if (!l || l.from === from || seq > l.seq || (seq === l.seq && from > l.from) || now() - l.at >= STALE_WINDOW_MS) last.set(destId, { seq, from, at: now() })
	}

	const holder = new Map() // destId → { from, name, seq, action, at (wall clock) }
	const base = new Map() // sender → { d: smallest (arrival − ts), at, ts, t (the last press), over, unsure }
	const wall = deps.wall || (() => performance.timeOrigin + performance.now())

	/**
	 * ms this call arrived after its sender gave up, or 0 (see the header: no clock comparison).
	 * WO-1106 C21: the baseline used to only go down — after the sender's clock stepped back (or its stamp stuck at
	 * last + 1 until its clock caught up again, an older build) every press from it was refused DEST_EXPIRED for up to
	 * BASE_MS. Now the sender's stamp must rise in step with arrival:
	 *   - two presses in a row over the ttl, SPREAD_MS apart and in step with each other (same lateness) → the clock
	 *     moved, not the delivery: rebase on this press and run it;
	 *   - REBASE_AFTER presses in a row over the ttl, SPREAD_MS apart (the stamp is not rising with time at all) → the
	 *     lateness of this sender is unknown: its presses run (as a first press does) until its stamp rises in step again
	 *     over IN_STEP_SPAN_MS, which starts a new baseline.
	 * Presses read together after a freeze (arrival < SPREAD_MS apart) never count: a frozen node still drops them.
	 */
	function lateBy(from, ts, ttlMs) {
		if (!Number.isSafeInteger(ts) || !(Number(ttlMs) > 0)) return 0
		const ttl = Number(ttlMs)
		const t = wall()
		const d = t - ts
		const b = base.get(from)
		if (!b || t - b.at > BASE_MS) {
			base.set(from, { d, at: t, ts, t, over: 0, unsure: false })
			return 0
		}
		const dt = t - b.t
		const inStep = Math.abs(dt - (ts - b.ts)) <= IN_STEP_MS
		b.ts = ts
		b.t = t
		if (b.unsure) {
			if (inStep && dt >= IN_STEP_SPAN_MS) Object.assign(b, { d, at: t, over: 0, unsure: false })
			return 0
		}
		if (d < b.d) b.d = d
		const age = d - b.d
		if (age < ttl) {
			b.over = 0
			return 0
		}
		if (dt < SPREAD_MS) return Math.round(age) // read together with the one before (a thaw): late, not counted
		const steady = b.over > 0 && inStep
		b.over++
		if (steady) {
			Object.assign(b, { d, at: t, over: 0 }) // the same lateness twice, a press apart: the sender's clock moved
			return 0
		}
		if (b.over >= REBASE_AFTER) {
			Object.assign(b, { over: 0, unsure: true })
			return 0
		}
		return Math.round(age)
	}

	const press = (name, run) => async (args, peer, meta = {}) => {
		const a = obj(args)
		const destId = String(a.destId || '')
		if (!destId) return { status: 400, body: { ok: false, error: 'destId required' } }
		const r = await resolve(destId)
		if (r.reply) return r.reply
		const from = String(peer?.id || peer?.name || '')
		const late = lateBy(from, meta?.ts, a.ttlMs)
		if (late) return { status: 409, body: { ok: false, error: `press arrived ${late} ms late (its sender stopped waiting after ${a.ttlMs} ms): not run`, code: 'DEST_EXPIRED', destId } }
		const seq = meta?.seq ?? null
		const old = stale(destId, from, seq)
		if (old) return { status: 200, body: { ok: true, stale: true, destId, last: old } }
		// WO-1106 C19: a press with a pressId runs once here — the master's forwarded copy of a press this server already
		// took itself (its master answered too late) is answered `duplicate` and not run (press-once.js)
		const pressId = once.validId(a.pressId)
		return once.runOnce(ctx, pressId, async () => {
			record(destId, from, seq)
			holder.set(destId, { from, name: peer?.name || from, seq, action: name, at: Date.now() })
			// plan 07 C8: the last press on an owned screen travels in dest.air as its `holder` (both GUIs show who drives it)
			try {
				require('./dest-air').noteHolder(ctx, destId, { server: from, seq })
			} catch {
				/* advisory */
			}
			const { runAsRemote } = require('./dest-route')
			const fanout = a.fanout === true && isMaster()
			return asObj(await runAsRemote({ from, fanout, ...(pressId ? { pressId } : {}) }, () => run(r.idx, a)))
		}, { destId })
	}

	const take = (idx, a) => {
		const target = a.bus === 'preview' || a.target === 'preview' ? 'preview' : 'program'
		const o = { sceneId: String(a.sceneId || '').trim(), mainIdx: idx, target, relayed: true }
		if (a.forceCut === true) o.forceCut = true
		if (a.transitionOverride && typeof a.transitionOverride === 'object') o.transitionOverride = a.transitionOverride
		if (a.timersVisibility && typeof a.timersVisibility === 'object') o.timersVisibility = a.timersVisibility
		return route('takeLook', (b) => require('../api/routes-scene-take-look').handleTakeLook(b, ctx))(o)
	}

	const actions = {
		'dest.take': press('dest.take', take),
		'dest.preview': press('dest.preview', (idx, a) =>
			route('previewPush', (b) => require('../api/routes-scene-preview-push').handlePreviewPush(b, ctx))({ ...obj(a.body), mainIdx: idx })
		),
		'dest.clear': press('dest.clear', (idx, a) =>
			a.bus === 'program'
				? route('clearProgram', (i, cut) => require('../api/routes-scene-look-preset').clearDestination(ctx, i, 'program', cut, null))(idx, a.cut !== false)
				: route('clearPreview', (b) => require('../api/routes-scene-preview').handlePreviewLiveClear(b, ctx))({ mainIndex: idx })
		),
		'dest.ftb': press('dest.ftb', (idx, a) => {
			const { durationFrames, tween, framerate } = obj(a.body)
			return route('ftb', (p, b) => require('../api/routes-ftb').handlePost(p, b, ctx))('/api/ftb', json({ durationFrames, tween, framerate, screenIdx: idx }))
		}),
		'dest.testcard': press('dest.testcard', (idx, a) =>
			route('testcard', (op, b) => require('../api/routes-led-test-control').handlePost(op, b, ctx))('channel', json({ screenIdx: idx, enabled: a.on === true }))
		),
		'dest.media': press('dest.media', (idx, a) => {
			const { channel: _c, takeGroup: _g, ...b } = obj(a.body)
			const body = { ...b, screenIdx: idx }
			if (a.op === 'audio-only-stop') return route('audioOnlyStop', (x) => require('../api/routes-scene-take-audio-only').handleAudioOnlyLookStop(x, ctx))(body)
			if (a.op === 'take') return route('sceneTake', (x) => require('../api/routes-scene-take').handleSceneTake(x, ctx))(body)
			return { status: 400, body: { ok: false, error: `unknown media op "${a.op}"` } }
		}),
		'dest.layer': press('dest.layer', (idx, a) => {
			const body = { ...obj(a.body), mainIdx: idx }
			if (a.op === 'layer-reload') return route('layerReload', (x) => require('../api/routes-scene-layer-tools').handleLayerReload(x, ctx))(body)
			if (a.op === 'layer-scrub') return route('layerScrub', (x) => require('../api/routes-scene-layer-scrub').handleLayerScrub(x, ctx))(body)
			return { status: 400, body: { ok: false, error: `unknown layer op "${a.op}"` } }
		}),
		'dest.mixer': press('dest.mixer', (idx, a) => {
			if (a.op !== 'mixer-nudge') return { status: 400, body: { ok: false, error: `unknown mixer op "${a.op}"` } }
			return route('nudge', (x) => require('../api/routes-preview-nudge').handlePreviewMixerNudge(x, ctx))({ ...obj(a.body), mainIndex: idx })
		}),
		'dest.timeline': press('dest.timeline', (idx, a) => {
			const op = String(a.op || '')
			const id = String(a.timelineId || '')
			if (!TIMELINE_OPS.has(op) || !id || id.includes('/')) return { status: 400, body: { ok: false, error: 'timelineId and a timeline op required' } }
			const body = { ...obj(a.body) }
			if (op === 'play' || op === 'take') {
				const eng = ctx?.timelineEngine
				const st = body.sendTo && typeof body.sendTo === 'object' ? body.sendTo : eng?._sendToFor?.(id) || {}
				body.sendTo = { ...st, screenIdx: a.all === true ? null : idx }
			}
			return route('timeline', (m, p, b) => require('../api/routes-timeline').handle(m, p, b, ctx))('POST', `/api/timelines/${encodeURIComponent(id)}/${op}`, json(body))
		}),
	}

	/** dest.state — what this screen shows here (live look per bus, test card, timeline, the last remote press). */
	async function state(args) {
		const destId = String(obj(args).destId || '')
		if (!destId) return { status: 400, body: { ok: false, error: 'destId required' } }
		const r = await resolve(destId)
		if (r.reply) return r.reply
		const live = require('../state/live-scene-state')
		const entry = (ch) => {
			const e = ch ? live.getChannel(ch) : null
			return e ? { channel: ch, sceneId: e.sceneId || null, name: e.scene?.name || null } : ch ? { channel: ch, sceneId: null } : null
		}
		let timeline = null
		try {
			const pb = ctx?.timelineEngine?.getPlayback?.()
			if (pb?.timelineId) timeline = { id: pb.timelineId, playing: pb.playing === true, position: pb.position ?? null }
		} catch {
			timeline = null
		}
		return {
			status: 200,
			body: { ok: true, destId, screen: r.idx, pgm: entry(r.t.pgm), prv: entry(r.t.prv), testcard: ctx?._ledTestPatternActive === true, timeline, holder: holder.get(destId) || null },
		}
	}

	return { actions, info: { 'dest.state': async (args) => state(args) } }
}

/** One receiver per server process (the actions and the `dest.state` info share its press order and holders). */
function destActionsOf(ctx) {
	if (!ctx._destActions) ctx._destActions = createDestActions(ctx)
	return ctx._destActions
}

module.exports = { createDestActions, destActionsOf }
