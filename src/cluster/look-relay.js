'use strict'

/**
 * WO-1029 phase 2a rule 4 — where a PROGRAM look take pressed on a non-master goes (R1 routes-scene-take-look.js,
 * R2 cluster-call-actions.js `look.take`, R3 zone-actions.js), decided by the take's screen (amcp-fanout.js airHeldBy):
 *   own / local screen     → null: taken here (an own screen's press notice goes to the master from the AMCP check)
 *   backup screen (held)   → the master; no answer within BACKUP_MS or unreachable → `{ local: true, diverged: true }`:
 *                            taken here anyway (the hold is lifted until the master's next report), logged once
 *   remote screen          → the master (it plays and forwards); no reachable master → the same signed `look.take`
 *                            straight to an online owner (`relayed`: it takes it LOCALLY, never hands it on);
 *                            nobody → 409 REMOTE_SCREEN
 * Answers `{ status, body: object }` (the caller wraps it) or `{ local: true, diverged?: true }` or null.
 */

const BACKUP_MS = 1000
const REMOTE_MS = 4000

/** A real answer from the other server (status 0 = refused connection / timeout: nobody answered). */
const answered = (r) => !!r && Number(r.status) > 0

/**
 * @param {object} args  relayArgs(...) of the take (`relayed: true`)
 * @param {{ channel, screen, drivenBy, code?, owners? }} held  the screen's verdict (null → null)
 * @param {{ isFollower: () => boolean, callMaster: Function, call: Function, owners: (ids: string[]) => Array<{ id, name,
 *   online }>, diverge: (ch: number) => void, log?: Function }} deps
 */
async function relayLook(args, held, deps) {
	if (!held) return null
	const log = (lvl, msg) => deps.log?.(lvl, `[cluster] ${msg}`)
	const json = (r) => (r?.json && typeof r.json === 'object' ? r.json : { ok: false, error: r?.error || 'no answer' })
	if (held.code !== 'REMOTE_SCREEN') {
		const r = await deps.callMaster('look.take', args, { quiet: true, timeoutMs: BACKUP_MS })
		if (answered(r)) return { status: r.status, body: { ...json(r), viaMaster: true } }
		deps.diverge(held.channel)
		log('warn', `screen ${held.screen}: ${held.drivenBy} did not answer the take in ${BACKUP_MS} ms (${r?.error || 'no answer'}) — taken here, the backup diverged`)
		return { local: true, diverged: true }
	}
	if (deps.isFollower()) {
		const r = await deps.callMaster('look.take', args, { quiet: true, timeoutMs: REMOTE_MS })
		if (answered(r)) return { status: r.status, body: { ...json(r), viaMaster: true } }
	}
	for (const o of deps.owners(held.owners || []).filter((x) => x.online)) {
		const r = await deps.call(o.id, 'look.take', args, { quiet: true, timeoutMs: REMOTE_MS })
		if (answered(r)) return { status: r.status, body: { ...json(r), via: o.name } }
	}
	const { AirHeldError } = require('../replication/air-held')
	const e = new AirHeldError(held)
	return { status: 409, body: { ok: false, error: `${e.message} (no master or owner reachable)`, code: e.code, owners: e.owners, channel: e.channel } }
}

/** The real deps on a server ctx (routes-cluster.js wiring); null while the cluster service never started here. */
function relayDeps(ctx, cluster) {
	if (!cluster) return null
	const call = () => cluster.callOf(ctx)
	return {
		isFollower: () => cluster.isClusterFollower(ctx),
		callMaster: (a, args, o) => {
			const c = call()
			return c.callMaster ? c.callMaster(a, args, o) : Promise.resolve({ ok: false, status: 0 })
		},
		call: (id, a, args, o) => (call().call ? call().call(id, a, args, o) : Promise.resolve({ ok: false, status: 0 })),
		owners: (ids) => (cluster.ownershipOf ? cluster.ownershipOf(ctx).owners(ids) : []),
		diverge: (ch) => ctx?._clusterReport?.diverge?.(ch),
		log: ctx?.log,
	}
}

module.exports = { relayLook, relayDeps }
