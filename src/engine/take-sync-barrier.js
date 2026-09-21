/**
 * Rendezvous barrier for multi-screen takes.
 *
 * A batched take (preset recall / global take on several mains) POSTs one /api/scene/take per
 * PGM channel. Each runs its own staging + LOADBG + Phase A at whatever pace its content allows,
 * so the transitions used to start whenever each channel happened to finish (visible skew between
 * screens). Every take in a group now does its prep, then waits here until ALL takes of the group
 * are ready — Phase B (PLAY + crossfade) is released for all of them together.
 *
 * A take that hands over its Phase B as a `plan` ({@link PhaseBPlan}) does not send it itself: when
 * the group is released, every screen's plan goes out as ONE merged AMCP sequence — all leading
 * `MIXER n COMMIT`s, then a single BEGIN…COMMIT with every screen's PLAY/fade lines (the last
 * batch sent), then the trailing `MIXER n COMMIT`s that fire the tweens. Takes without a plan
 * (timeline-only / shader-only branches, rollback mode) just wait at the gate and send their own.
 *
 * Safety: a take that fails / bails before reaching the barrier calls `leave()` (counts as
 * settled, so nobody waits for it), and the whole wait is capped by TAKE_SYNC_TIMEOUT_MS
 * (measured from the first arrival) so a stuck peer can never hold air.
 */

'use strict'

const DEFAULT_TIMEOUT_MS = 1500
const GROUP_TTL_MS = 15000

/**
 * @typedef {object} PhaseBPlan
 * @property {object} amcp — the AMCP client the take would have sent on
 * @property {number} channel — PGM channel
 * @property {boolean} leadingCommit — send `MIXER <channel> COMMIT` before the batch
 * @property {string[]} block — the PLAY / fade lines (no BEGIN/COMMIT, no `MIXER n COMMIT`)
 * @property {boolean} trailingCommit — send `MIXER <channel> COMMIT` after the batch
 */

/**
 * Send one or more screens' Phase B as a single merged sequence (see file header).
 * @param {PhaseBPlan[]} plans
 */
async function sendMergedPlans(plans) {
	const amcp = plans[0].amcp
	const channelsOf = (key) => [...new Set(plans.filter((p) => p[key]).map((p) => p.channel))]
	const leading = channelsOf('leadingCommit')
	const trailing = channelsOf('trailingCommit')
	if (leading.length) await Promise.all(leading.map((ch) => amcp.mixerCommit(ch)))
	await amcp.batchSendChunked(
		plans.flatMap((p) => p.block),
		{ skipMixerPreCommit: true, forceBatch: true }
	)
	if (trailing.length) await Promise.all(trailing.map((ch) => amcp.mixerCommit(ch)))
}

/** @type {Map<string, { expected: number, settled: number, released: boolean, waiters: Array<{ resolve: () => void, reject: (e: unknown) => void, plan: PhaseBPlan|null }>, timer: NodeJS.Timeout|null }>} */
const groups = new Map()

function timeoutMs() {
	const n = parseInt(process.env.HIGHASCG_TAKE_SYNC_TIMEOUT_MS || '', 10)
	return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TIMEOUT_MS
}

function release(id, g) {
	if (g.released) return
	g.released = true
	if (g.timer) clearTimeout(g.timer)
	g.timer = null
	const waiters = g.waiters.splice(0)
	for (const w of waiters) if (!w.plan) w.resolve()
	const planned = waiters.filter((w) => w.plan)
	if (planned.length) {
		sendMergedPlans(planned.map((w) => w.plan)).then(
			() => planned.forEach((w) => w.resolve()),
			(e) => planned.forEach((w) => w.reject(e))
		)
	}
	// Keep the entry briefly so a straggler arriving after a timeout passes straight through.
	setTimeout(() => groups.delete(id), GROUP_TTL_MS).unref?.()
}

/**
 * @param {unknown} rawGroup — request body `takeGroup`: `{ id: string, size: number }`
 * @returns {{ arrive: () => Promise<void>, leave: () => void, groupId: string } | null}
 *   null when the request is not part of a multi-take group (size < 2 / malformed).
 */
function joinTakeGroup(rawGroup) {
	const id = rawGroup && typeof rawGroup === 'object' ? String(rawGroup.id || '').trim() : ''
	const size = rawGroup && typeof rawGroup === 'object' ? parseInt(rawGroup.size, 10) : 0
	if (!id || !Number.isFinite(size) || size < 2 || size > 64) return null

	let g = groups.get(id)
	if (!g) {
		g = { expected: size, settled: 0, released: false, waiters: [], timer: null }
		groups.set(id, g)
	}
	const group = g
	let done = false

	const settle = () => {
		if (done) return false
		done = true
		group.settled++
		if (group.settled >= group.expected) release(id, group)
		return true
	}

	return {
		groupId: id,
		/**
		 * Resolves once every take in the group has arrived (or left), or on timeout.
		 * With a `plan` the group sends this take's Phase B (merged with the others') and resolves
		 * when that send has completed (rejects if it failed); without one it is a plain gate.
		 * @param {PhaseBPlan} [plan]
		 */
		arrive(plan) {
			if (group.released) {
				done = true
				return plan ? sendMergedPlans([plan]) : Promise.resolve()
			}
			return new Promise((resolve, reject) => {
				group.waiters.push({ resolve, reject, plan: plan || null })
				if (!group.timer) {
					group.timer = setTimeout(() => release(id, group), timeoutMs())
				}
				settle()
			})
		},
		/** Take ended (or failed) without/after arriving — never hold the others for it. */
		leave() {
			settle()
		},
	}
}

/**
 * Run `fn(sync)` for a take that may belong to a group; the slot is always released afterwards
 * (early 400s / failures never make sibling screens wait). `sync` is null outside a group.
 * @template T
 * @param {unknown} rawGroup
 * @param {(sync: ReturnType<typeof joinTakeGroup>) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withTakeGroup(rawGroup, fn) {
	const sync = joinTakeGroup(rawGroup)
	try {
		return await fn(sync)
	} finally {
		sync?.leave()
	}
}

module.exports = { joinTakeGroup, withTakeGroup }
