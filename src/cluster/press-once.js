'use strict'

/**
 * WO-1106 C19 — one press lands once on a hot-backup screen.
 *
 * A follower F whose screen is also cabled on the master M hands its press to M (dest-route.js backupPlan `fanout`,
 * look-relay.js `look.take`) and waits BACKUP_MS (1 s). M takes it and forwards the same press to every other owner of
 * that screen, F included. When M's take ran longer than F's wait, F took it locally ("diverged") AND then ran M's
 * forwarded copy: the take landed twice on F's screen.
 *
 * Every such press gets a `pressId` at its origin (F). It travels with the hand-over to M and with M's forward back to F.
 *   F (this ledger, `ctx._pressOnce`): the first of { F's local fallback, M's forwarded copy } claims the pressId; the
 *     second does not run — a forwarded copy answers `{ ok: true, duplicate: true }`; a local fallback whose forwarded
 *     copy already ran answers that copy's result instead of taking again.
 *   M: F tells M (signed info `dest.ran { pressId }`, fire and forget) that it ran the press itself. M then does not
 *     forward that press back to F (dest-route.js backupPlan) and drops the AMCP lines of that take to F's Caspar
 *     (cluster-fanout.js, by the take's async context: linked servers without channels-where-cabled).
 * Bounded by count (MAX entries per ledger, oldest dropped first), no clock window: a pressId is random and used once.
 */

const crypto = require('crypto')

const MAX = 512
const PRESS_ID_RE = /^[0-9A-Za-z_-]{8,64}$/

const newPressId = () => crypto.randomBytes(12).toString('hex')
const validId = (v) => (typeof v === 'string' && PRESS_ID_RE.test(v) ? v : '')

function bounded(map, key, value) {
	map.delete(key)
	map.set(key, value)
	while (map.size > MAX) map.delete(map.keys().next().value)
}

function ledgerOf(ctx) {
	if (!ctx._pressOnce) ctx._pressOnce = { claims: new Map(), ranAtOrigin: new Map() }
	return ctx._pressOnce
}

/**
 * F: the local fallback after the master did not answer → null (claimed: take it here) | { by, answer } (the master's
 * forwarded copy already ran here: its answer, a Promise of { status, body }).
 */
function claimHere(ctx, pressId) {
	const id = validId(pressId)
	if (!id) return null
	const l = ledgerOf(ctx)
	const prior = l.claims.get(id)
	if (prior) return prior
	bounded(l.claims, id, { by: 'here', answer: null })
	return null
}

/** F: a forwarded copy (dest-actions.js) → run() once; a pressId already claimed → the duplicate answer, not run. */
function runOnce(ctx, pressId, run, dupBody = {}) {
	const id = validId(pressId)
	if (!id) return run()
	const l = ledgerOf(ctx)
	if (l.claims.has(id)) {
		ctx?.log?.('info', `[cluster] press ${id} already ran here: its copy is not run again`)
		return Promise.resolve({ status: 200, body: { ok: true, duplicate: true, ...dupBody } })
	}
	const answer = Promise.resolve().then(run)
	bounded(l.claims, id, { by: 'forward', answer })
	return answer
}

/** M: the origin `from` reported it ran `pressId` itself (signed info `dest.ran`). */
function noteRanAtOrigin(ctx, pressId, from) {
	const id = validId(pressId)
	if (!id || !from) return false
	bounded(ledgerOf(ctx).ranAtOrigin, id, String(from))
	return true
}

/** M: did server `from` report running `pressId` itself? */
const ranAtOrigin = (ctx, pressId, from) => !!validId(pressId) && !!from && ctx?._pressOnce?.ranAtOrigin.get(pressId) === String(from)

/**
 * M, cluster-fanout.js: the linked server whose Caspar must not get the lines being sent now — the origin of the press
 * this code runs for (dest-route.js remotePress), once it reported running that press itself. '' = none.
 */
function suppressedTarget(ctx) {
	const r = require('./dest-route').remotePress()
	return r?.pressId && ranAtOrigin(ctx, r.pressId, r.from) ? String(r.from) : ''
}

/** The signed info a server answers `dest.ran` with (routes-cluster.js callOf `info`). */
const info = (ctx) => ({
	'dest.ran': async (args, peer) => {
		const ok = noteRanAtOrigin(ctx, args?.pressId, peer?.id)
		return ok ? { status: 200, body: { ok: true } } : { status: 400, body: { ok: false, error: 'pressId required' } }
	},
})

/**
 * F: tell the master it ran `pressId` itself (fire and forget; an older master answers "unknown action": ignored).
 * @param {(action: string, args: object, opts: object) => Promise<object>} callMaster
 */
function tellRan(callMaster, pressId) {
	if (!validId(pressId) || typeof callMaster !== 'function') return
	Promise.resolve()
		.then(() => callMaster('dest.ran', { pressId }, { quiet: true, timeoutMs: 2000 }))
		.catch(() => {})
}

module.exports = { MAX, newPressId, validId, claimHere, runOnce, noteRanAtOrigin, ranAtOrigin, suppressedTarget, info, tellRan }
