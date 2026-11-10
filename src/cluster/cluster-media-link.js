'use strict'

/**
 * WO-1029 plan 07 C10 — the node ↔ node side of the media Spread.
 *
 * Signed calls (cluster-call.js v2 wire and checks: the sender's device key must be linked here, replay guard, opId)
 * on their own path POST /api/cluster/media-call, so the media topics need no change to the main call's allow-list:
 *   media.have         (info) { digest?, offset?, limit? } → this server's inventory page (cluster-media-inventory.js)
 *   media.push         { to: <fingerprint>, path, bytes, throttle_kbps } → 202 { job } | 409 { busy: true }:
 *                      "send this file of yours to that server" (the third server that has the file pushes it)
 *   media.push_status  (info) { job } → { state, bytes, done_bytes, error }
 *   media.push_cancel  { job } → { ok }
 * With enforceAuth on, the path carries the shared password like every node ↔ node request (auth.outboundAuthHeaders).
 * An older build answers 404 there: its inventory is unknown and it cannot push ("update it").
 *
 * Push jobs: ONE transfer at a time per server — this server's own spread copies wait their turn; a remote request
 * while busy is answered 409 { busy } and the asker retries.
 */

const JOBS_KEPT = 16
const POLL_MS = 500
const BUSY_RETRY_MS = 1000
const BUSY_GIVE_UP_MS = 30 * 60 * 1000
const LOST_POLLS = 10

/**
 * @param {{ push: (job: object, o: { signal: AbortSignal, onProgress: (n: number) => void }) => Promise<{ ok, error? }>,
 *   now?: () => number }} deps  push: the actual copy (rsync / loopback) of one file to one server
 */
function createPushJobs(deps) {
	const now = deps.now || Date.now
	const jobs = new Map() // id → job
	let seq = 0
	let busy = null // the running job
	const waiters = []

	const view = (j) => ({ job: j.id, state: j.state, path: j.path, to: j.to, bytes: j.bytes, done_bytes: j.done_bytes, error: j.error })

	async function exec(j) {
		busy = j
		j.state = 'copying'
		let r
		try {
			r = await deps.push(j, { signal: j.ctl.signal, onProgress: (n) => (j.done_bytes = Math.max(0, Number(n) || 0)) })
		} catch (e) {
			r = { ok: false, error: e.message }
		}
		Object.assign(j, r?.ok ? { state: 'done', done_bytes: j.bytes, error: '' } : { state: 'failed', error: j.ctl.signal.aborted ? 'cancelled' : String(r?.error || 'failed') })
		j.ended = now()
		busy = null
		waiters.shift()?.()
		return view(j)
	}

	function make(spec) {
		const j = { id: `pj${now().toString(36)}${++seq}`, path: spec.path, to: spec.to, bytes: Number(spec.bytes) || 0, done_bytes: 0, state: 'queued', error: '',
			throttle_kbps: spec.throttle_kbps ?? null, mtime: spec.mtime ?? null, ctl: new AbortController() }
		jobs.set(j.id, j)
		while (jobs.size > JOBS_KEPT) {
			const old = [...jobs.values()].find((x) => x.state === 'done' || x.state === 'failed')
			if (!old) break
			jobs.delete(old.id)
		}
		return j
	}

	/** This server's own copy: waits for the lock (one transfer at a time), then runs → the final view. */
	async function run(spec, { signal, onProgress } = {}) {
		while (busy) {
			await new Promise((r) => waiters.push(r))
			if (signal?.aborted) return { state: 'failed', error: 'cancelled' }
		}
		const j = make(spec)
		const abort = () => j.ctl.abort()
		signal?.addEventListener?.('abort', abort, { once: true })
		const t = setInterval(() => onProgress?.(j.done_bytes), 250)
		try {
			return await exec(j)
		} finally {
			clearInterval(t)
			signal?.removeEventListener?.('abort', abort)
		}
	}

	/** A linked server's request: started now, or 409 busy. */
	function start(spec) {
		if (busy) return { status: 409, body: { error: 'busy with another transfer', busy: true } }
		const j = make(spec)
		exec(j).catch(() => {})
		return { status: 202, body: { ok: true, job: j.id } }
	}

	const status = (id) => {
		const j = jobs.get(String(id || ''))
		return j ? { status: 200, body: view(j) } : { status: 404, body: { error: 'no such job' } }
	}
	function cancel(id) {
		const j = jobs.get(String(id || ''))
		if (!j) return { status: 404, body: { error: 'no such job' } }
		j.ctl.abort()
		return { status: 200, body: { ok: true } }
	}
	return { run, start, status, cancel, busy: () => !!busy }
}

const sleep = (ms, signal) =>
	new Promise((resolve) => {
		const t = setTimeout(resolve, ms)
		signal?.addEventListener?.('abort', () => (clearTimeout(t), resolve()), { once: true })
	})

const isOld = (r) => r?.status === 404 || /unknown action/i.test(String(r?.json?.error || ''))

/**
 * Asker side: have server `t.from` push `t.path` to `t.to` and follow it → { ok, error? }.
 * @param {object} t  the run's file row ({ from, to, path, bytes })
 * @param {{ signal: AbortSignal, throttleKbps: number, onProgress: Function }} o
 * @param {{ call: (peerId, action, args, opts?) => Promise<{ ok, status, json }>, fingerprintOf: (id) => string,
 *   nameOf: (id) => string, now?: () => number, sleepFn?: Function }} deps
 */
async function remoteCopy(t, o, deps) {
	const now = deps.now || Date.now
	const wait = deps.sleepFn || sleep
	const to = deps.fingerprintOf(t.to)
	if (!to) return { ok: false, error: `${deps.nameOf(t.to)}: identity unknown here (link it again)` }
	const t0 = now()
	let job
	for (;;) {
		if (o.signal.aborted) return { ok: false, error: 'cancelled' }
		const r = await deps.call(t.from, 'media.push', { to, path: t.path, bytes: t.bytes, throttle_kbps: o.throttleKbps, mtime: t.mtime ?? null }, { quiet: true, timeoutMs: 15000 })
		if (r?.ok && r.json?.job) {
			job = String(r.json.job)
			break
		}
		if (isOld(r)) return { ok: false, error: `${deps.nameOf(t.from)} is an older build (cannot push media for this server)` }
		if (r?.status === 409 && r.json?.busy && now() - t0 < BUSY_GIVE_UP_MS) {
			await wait(BUSY_RETRY_MS, o.signal)
			continue
		}
		return { ok: false, error: `${deps.nameOf(t.from)}: ${r?.json?.error || r?.error || 'HTTP ' + r?.status}` }
	}
	let lost = 0
	for (;;) {
		await wait(POLL_MS, o.signal)
		if (o.signal.aborted) {
			await deps.call(t.from, 'media.push_cancel', { job }, { quiet: true })
			return { ok: false, error: 'cancelled' }
		}
		const s = await deps.call(t.from, 'media.push_status', { job }, { quiet: true })
		if (!s?.ok || !s.json) {
			if (++lost >= LOST_POLLS) return { ok: false, error: `${deps.nameOf(t.from)}: lost contact during the copy` }
			continue
		}
		lost = 0
		o.onProgress?.(Number(s.json.done_bytes) || 0)
		if (s.json.state === 'done') return { ok: true }
		if (s.json.state === 'failed') return { ok: false, error: `${deps.nameOf(t.from)}: ${s.json.error || 'failed'}` }
	}
}

module.exports = { createPushJobs, remoteCopy, POLL_MS }
