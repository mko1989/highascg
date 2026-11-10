'use strict'

/**
 * WO-1029 plan 07 (Wave B, C6) — the sender side of dest.* calls: a press on a screen that is not (only) on this server
 * goes to the server(s) it is cabled on, node to node (signed calls, cluster-call.js), and the owner runs it through its
 * own route (dest-actions.js). Active only while `cluster.channelsWhereCabled` is on HERE; flag off = nothing changes.
 *
 *   routeFor(ctx, { screenIdx | destId }) → { local: true, idx, destId, also: [owners elsewhere] }   (here; `also` = backup)
 *                                         | { owners: [{ id, name, online, caps }], idx, destId }    (elsewhere)
 *                                         | { nobody: true, idx, destId }                           (cabled nowhere / unknown)
 *   sendDest(ctx, target, action, args, { timeoutMs, legacy? }) → [{ id, name, ok, status, error, body, skipped? }]
 *       to EVERY owner (a destination cabled on two servers is driven on both). An offline owner, or one without the
 *       `dest-actions` capability (older build), is reported (`skipped`), never silently dropped; `legacy` = the call an
 *       older owner understands instead (look.take), when there is one.
 *   relayIfNotHere(ctx, q, action, args, opts) → null (the screen is here: run it) | the HTTP reply built from the owners'
 *       answers. Body: the owner's own JSON + `via: [{ id, name, ok, status, error, skipped? }]`.
 *         200            at least one owner did it and none that was asked failed
 *         owner's status every asked owner answered an error (404 look missing there, 409 …)
 *         502 DEST_PARTIAL / DEST_UNREACHABLE   some failed / nobody answered (timeout, refused)
 *         503 DEST_UNREACHABLE  every owner is offline
 *         409 NOT_HERE   nobody owns it, or every owner is an older build (today's answer, `via` says why)
 *   backupPlan(ctx, q, action, args) + finishDest(reply, plan) — a screen HERE that is also cabled elsewhere (hot backup):
 *       master (or no master among the owners) → runs here and sends the same call to the other owners in parallel
 *       (`via` added to the answer); a follower whose master also owns it → the press goes to the master (`fanout`, 1 s:
 *       it drives every owner, this one included) — no answer → run here, answer `diverged: true` (owner answer 3).
 *   relayAll(ctx, action, args) → per remote screen results, for the "all screens" presses (FTB all, test card master).
 *   relayOwners(ctx, action, args) → one call per owner of remote screens (`all: true`), for timeline "every screen".
 *
 * No loops: a dest.* call runs on the owner inside `runAsRemote` (AsyncLocalStorage): nothing it does is relayed or
 * forwarded again. A `fanout` call (a backup box handing its press to the master) runs as a local press on the master.
 * Who may press: any linked server, subject to the OWNER's `accept_remote` duty (checked by cluster-call.js). A future
 * per-link "peers / one operator" rule hooks into `sendDest` (refuse before calling) and dest-actions.js `guard`.
 */

const { AsyncLocalStorage } = require('node:async_hooks')
const { JSON_HEADERS, jsonBody } = require('../api/response')
const CAP = 'dest-actions'
const RELAY_MS = 4000
const BACKUP_MS = 1000

const store = new AsyncLocalStorage()
/** The dest.* call this code runs for ({ from, fanout }), or null for a press made on this server. */
const remotePress = () => store.getStore() || null
const runAsRemote = (meta, fn) => store.run({ ...meta }, fn)

const reply = (status, body) => ({ status, headers: JSON_HEADERS, body: jsonBody(body) })
const nh = () => require('../api/screen-not-here')

function cwcOn(ctx) {
	const sc = require('../config/screen-channels')
	if (!sc.channelsWhereCabledEnabled(ctx?.config)) return false
	try {
		return require('../config/routing').getChannelMap(ctx.config || {}).channelsWhereCabled === true
	} catch {
		return false
	}
}

const ownerIndex = (ctx) => ctx?._clusterOwnership?.ownerIndex || require('./dest-owners').ownerIndexOf(ctx)

async function ownersFor(ctx, destId) {
	const idx = ownerIndex(ctx)
	if (!idx || !destId) return []
	try {
		await idx.warm()
	} catch {
		/* last known cables */
	}
	return idx.ownersOf(destId)
}

/** The signed call API: tests set `ctx._destCall`; a server uses routes-cluster callOf (only once the cluster runs). */
function callApi(ctx) {
	if (ctx?._destCall) return ctx._destCall
	if (!ctx?._cluster) return null
	return require('../api/routes-cluster').callOf(ctx)
}

const masterView = (ctx) => {
	try {
		return ctx?._clusterMaster?.view?.() || {}
	} catch {
		return {}
	}
}

async function routeFor(ctx, q = {}) {
	const t = nh().screenTarget(ctx, q)
	const destId = t.destId || q.destId || null
	if (!cwcOn(ctx)) return { local: true, idx: t.idx, destId, also: [] }
	const owners = await ownersFor(ctx, destId)
	if (t.here) return { local: true, idx: t.idx, destId, also: owners }
	return owners.length ? { owners, idx: t.idx, destId } : { nobody: true, idx: t.idx, destId }
}

const errOf = (r) => String(r?.json?.error || r?.error || (r?.status ? `HTTP ${r.status}` : 'no answer'))

function withDeadline(p, ms) {
	let timer
	const t = new Promise((res) => {
		timer = setTimeout(() => res({ ok: false, status: 0, error: `no answer in ${ms} ms` }), ms)
	})
	return Promise.race([p, t]).finally(() => clearTimeout(timer))
}

async function sendDest(ctx, target, action, args = {}, { timeoutMs = RELAY_MS, legacy = null } = {}) {
	const api = callApi(ctx)
	const owners = target?.owners || []
	if (!api) return owners.map((o) => ({ id: o.id, name: o.name, ok: false, status: 0, error: 'linked servers not running here', skipped: true }))
	const seq = typeof api.nextSeq === 'function' && target.destId ? api.nextSeq(target.destId) : undefined
	const one = async (o) => {
		const base = { id: o.id, name: o.name || o.id }
		if (!o.online) return { ...base, ok: false, status: 0, error: 'offline', skipped: true, reason: 'offline' }
		const has = (o.caps || []).includes(CAP)
		if (!has && !legacy) return { ...base, ok: false, status: 0, error: `older build (no ${CAP})`, skipped: true, reason: 'no-cap' }
		const [a, x] = has ? [action, { ...args, destId: target.destId, ttlMs: timeoutMs }] : [legacy.action, legacy.args] // ttlMs: how long this sender waits (dest-actions.js drops a late arrival)
		const sent = Promise.resolve()
			.then(() => api.call(o.id, a, x, { quiet: true, timeoutMs, ...(has && seq != null ? { seq } : {}) }))
			.catch((e) => ({ ok: false, status: 0, error: String(e?.message || e) }))
		const r = await withDeadline(sent, timeoutMs + 1000)
		const ok = !!r?.ok && Number(r.status) < 400
		return { ...base, ok, status: Number(r?.status) || 0, error: ok ? '' : errOf(r), body: r?.json && typeof r.json === 'object' ? r.json : null, ...(has ? {} : { legacy: legacy.action }) }
	}
	return Promise.all(owners.map(one))
}

const viaOf = (results) => results.map((r) => ({ id: r.id, name: r.name, ok: r.ok, status: r.status, error: r.error || '', ...(r.skipped ? { skipped: true } : {}), ...(r.legacy ? { legacy: r.legacy } : {}) }))

/** The HTTP answer for one screen relayed to its owners (rules in the header). */
async function relayReply(ctx, t, results) {
	const via = viaOf(results)
	const screen = `Screen ${Number(t?.idx) + 1}`
	const tried = results.filter((r) => !r.skipped)
	const good = tried.filter((r) => r.ok)
	const bad = tried.filter((r) => !r.ok)
	const why = (list) => list.map((r) => `${r.name}: ${r.error}`).join('; ')
	if (good.length && !bad.length) return reply(200, { ...(good[0].body || {}), ok: true, via })
	if (!tried.length) {
		if (results.length && results.every((r) => r.reason === 'no-cap')) {
			const base = await nh().notHereReply(ctx, t)
			return reply(409, { ...JSON.parse(base.body), via })
		}
		return reply(503, { ok: false, error: `${screen} is on ${why(results)}`, code: 'DEST_UNREACHABLE', screen: t?.idx ?? null, via })
	}
	if (good.length) return reply(502, { ok: false, error: `${screen}: done on ${good.map((r) => r.name).join(', ')}, failed on ${why(bad)}`, code: 'DEST_PARTIAL', screen: t?.idx ?? null, via })
	const answered = bad.find((r) => r.status >= 400)
	if (answered) return reply(answered.status, { ...(answered.body || {}), ok: false, error: `${screen} (${answered.name}): ${answered.error}`, screen: t?.idx ?? null, via })
	return reply(502, { ok: false, error: `${screen}: ${why(bad)}`, code: 'DEST_UNREACHABLE', screen: t?.idx ?? null, via })
}

async function relayIfNotHere(ctx, q, action, args = {}, opts = {}) {
	const t = nh().screenTarget(ctx, q)
	if (t.here) return null
	if (remotePress() || !cwcOn(ctx)) return nh().notHereReply(ctx, t) // never re-relayed (no loops)
	const plan = await routeFor(ctx, { screenIdx: t.idx })
	if (!plan.owners) return nh().notHereReply(ctx, t)
	return relayReply(ctx, t, await sendDest(ctx, plan, action, args, opts))
}

function log(ctx, lvl, msg) {
	ctx?.log?.(lvl, `[cluster] ${msg}`)
}

async function backupPlan(ctx, q, action, args = {}) {
	if (!cwcOn(ctx)) return null
	const remote = remotePress()
	if (remote && !remote.fanout) return null
	const t = nh().screenTarget(ctx, q)
	if (!t.here || t.idx == null) return null
	const others = await ownersFor(ctx, t.destId)
	if (!others.length) return null
	const m = masterView(ctx)
	const masterOwner = !remote && !m.is_master && m.master_id ? others.find((o) => o.id === m.master_id) : null
	if (masterOwner) {
		const [r] = await sendDest(ctx, { destId: t.destId, owners: [masterOwner] }, action, { ...args, fanout: true }, { timeoutMs: BACKUP_MS })
		if (r && !r.skipped && r.status > 0) return { reply: await relayReply(ctx, t, [r]) }
		log(ctx, 'warn', `screen ${t.idx + 1}: ${masterOwner.name} did not take ${action} (${r?.error || 'no answer'}) — run here, the backup diverged`)
		return { diverged: true }
	}
	return { forward: sendDest(ctx, { destId: t.destId, owners: others }, action, args), wait: !remote }
}

function mergeBody(res, extra) {
	if (!res || Number(res.status) >= 400) return res
	let body
	try {
		body = typeof res.body === 'string' ? JSON.parse(res.body || '{}') : res.body || {}
	} catch {
		body = {}
	}
	return { ...res, headers: res.headers || JSON_HEADERS, body: jsonBody({ ...body, ...extra }) }
}

async function finishDest(ctx, res, plan) {
	if (!plan) return res
	if (plan.diverged) return mergeBody(res, { diverged: true })
	if (!plan.forward) return res
	if (!plan.wait) {
		// a fanout press from the backup box: it waits at most 1 s for this answer, so the backups are not awaited
		plan.forward.then((rs) => rs.filter((r) => !r.ok).forEach((r) => log(ctx, 'warn', `backup ${r.name}: ${r.error}`))).catch(() => {})
		return res
	}
	const results = await plan.forward
	return mergeBody(res, { via: viaOf(results) })
}

/** "All screens" presses: every remote screen through its owners, and the other owners of local backup screens. */
async function relayAll(ctx, action, args = {}) {
	if (!cwcOn(ctx) || remotePress()) return []
	await nh().warmOwners(ctx)
	const map = require('../config/routing').getChannelMap(ctx.config || {})
	const n = Number(map.screenCount) || 0
	const m = masterView(ctx)
	const jobs = []
	for (let i = 0; i < n; i++) {
		const plan = await routeFor(ctx, { screenIdx: i })
		const t = { idx: i, destId: plan.destId }
		if (plan.nobody) continue
		let owners = plan.owners || plan.also || []
		// a local backup screen: its other owners only when this press is the master's (a follower's master blacks them)
		if (plan.local && !m.is_master && m.master_id && owners.some((o) => o.id === m.master_id)) owners = []
		if (!owners.length) continue
		jobs.push(
			sendDest(ctx, { destId: plan.destId, owners }, action, args).then(async (rs) => {
				if (rs.every((x) => x.reason === 'no-cap')) return null // older builds: stays in `notHere`, as before
				const r = await relayReply(ctx, t, rs)
				const body = JSON.parse(r.body)
				return { screen: i, destId: plan.destId, here: !!plan.local, ok: r.status < 400, status: r.status, ...(r.status < 400 ? {} : { error: body.error }), via: body.via || viaOf(rs) }
			})
		)
	}
	return (await Promise.all(jobs)).filter(Boolean)
}

/** One call per owner of the remote screens (`all: true`, addressed by one destination it owns). */
async function relayOwners(ctx, action, args = {}) {
	if (!cwcOn(ctx) || remotePress()) return []
	await nh().warmOwners(ctx)
	const byOwner = new Map()
	for (const s of nh().notHereList(ctx)) {
		for (const o of await ownersFor(ctx, s.destId)) if (!byOwner.has(o.id)) byOwner.set(o.id, { o, destId: s.destId, screen: s.screen })
	}
	return Promise.all(
		[...byOwner.values()].map(async ({ o, destId, screen }) => {
			const [r] = await sendDest(ctx, { destId, owners: [o] }, action, { ...args, all: true })
			return { server: o.id, name: o.name, ok: r.ok, status: r.status, error: r.error, screen, ...(r.skipped ? { skipped: true } : {}) }
		})
	)
}

module.exports = { CAP, BACKUP_MS, routeFor, sendDest, relayIfNotHere, backupPlan, finishDest, relayAll, relayOwners, runAsRemote, remotePress, cwcOn, viaOf }
