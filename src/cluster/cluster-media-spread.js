'use strict'

/**
 * WO-1029 plan 07 C10 — Spread: copy each needed media file from a server that has it to each destination owner that
 * lacks it (owner, 10.11: "shared media library with spread needed notice when the file is missing on destination box").
 *
 *   planSpread(needs, { files?, to?, overwrite? })  pure: transfers + skipped rows (newer copy on the target without
 *                                                    `overwrite`, unknown inventory, on no linked server)
 *   createSpreader(deps)                             the run: one at a time (a second start → 409), ONE transfer at a
 *                                                    time, free space on each target checked first (bytes + 5 %),
 *                                                    rate-limited (lower while either end is on air), cancel, one
 *                                                    failure never stops the others. Never deletes: the transports
 *                                                    (cluster-media-transport.js) only ever add / replace files.
 */

const { fmtBytes } = require('../media/media-safe-copy')
const { keyOf } = require('./cluster-media-inventory')
const { pickSource, MTIME_SLACK_S } = require('./cluster-media-needs')

// Rate limit only while anything is on air at either end (rsync --bwlimit unit is KiB/s): 10 MB/s. Idle: no limit
// (a 40 GB clip on GbE ≈ 6 min, not hours). HIGHASCG_MEDIA_SPREAD_ON_AIR_KBPS / _KBPS override (0 = none).
const envKbps = (k, d) => (process.env[k] != null && process.env[k] !== '' && Number.isFinite(Number(process.env[k])) ? Number(process.env[k]) || null : d)
const KBPS = envKbps('HIGHASCG_MEDIA_SPREAD_KBPS', null)
const ON_AIR_KBPS = envKbps('HIGHASCG_MEDIA_SPREAD_ON_AIR_KBPS', Math.round(10e6 / 1024))
const SPACE_MARGIN = 1.05
const PROGRESS_MS = 250

/**
 * @param {object} needs  computeNeeds() result (servers, and the default: every missing / differing / unknown pair)
 * @param {{ files?: string[], to?: string[], overwrite?: boolean, selfId?: string, masterId?: string,
 *   index: Map<string, Map<string, { p, id, s, m }>> }} opts  index: libraryIndex() of every known server
 *   files: an EXPLICIT list — any media file of the library by id, needed or not (the operator's choice; owner 10.11:
 *   "i have big buck on this box … i cant seem to spread it"); `to` then defaults to every server that lacks it
 * @returns {{ transfers: Array<{ id, path, from, to, bytes, mtime, reason }>, skipped: Array<{ id, path, to, error }> }}
 */
function planSpread(needs, opts = {}) {
	const servers = new Map((needs.servers || []).map((s) => [s.id, s]))
	const name = (id) => servers.get(id)?.name || id
	const selfId = opts.selfId ?? needs.self_id ?? ''
	const index = opts.index || new Map()
	const to = Array.isArray(opts.to) && opts.to.length ? opts.to.map(String) : null
	const rows = new Map((needs.files || []).map((f) => [keyOf(f.id), f]))
	const pairsOf = (f) => [...(f.missing_on || []), ...(f.differs_on || []), ...(f.unknown_on || [])]
	const items = []
	if (Array.isArray(opts.files) && opts.files.length) {
		for (const id of new Set(opts.files.map(String))) {
			const key = keyOf(id)
			const holders = index.get(key)
			const row = rows.get(key)
			const targets = to || (row ? pairsOf(row) : [...servers.keys()].filter((s) => !holders?.has(s)))
			items.push({ key, id: row?.id || id, targets, explicit: true })
		}
	} else {
		for (const f of needs.files || []) {
			const targets = pairsOf(f).filter((t) => !to || to.includes(t))
			if (targets.length) items.push({ key: keyOf(f.id), id: f.id, targets, explicit: false })
		}
	}
	const transfers = []
	const skipped = []
	for (const it of items) {
		const holders = index.get(it.key)
		for (const t of it.targets) {
			const skip = (error, path = '') => skipped.push({ id: it.id, path, to: t, error })
			const s = servers.get(t)
			if (!s) skip('not a linked server')
			else if (!s.online) skip(`${name(t)} is offline`)
			else if (!s.known) skip(`${name(t)}'s inventory is unknown`)
			else if (!holders?.size) skip('on no linked server')
			else {
				const src = pickSource(holders, t, { selfId, masterId: opts.masterId })
				const mine = holders.get(t)
				if (!src) skip('already there', mine?.p)
				else if (mine && mine.s === src.f.s && (Math.abs(mine.m - src.f.m) <= MTIME_SLACK_S || !it.explicit)) skip('already there', mine.p)
				else if (mine && mine.m > src.f.m + MTIME_SLACK_S && !opts.overwrite) skip(`newer on ${name(t)} (overwrite to replace)`, mine.p)
				else transfers.push({ id: src.f.id, path: src.f.p, from: src.id, to: t, bytes: src.f.s, mtime: src.f.m, reason: mine ? 'differs' : 'missing' })
			}
		}
	}
	// this server's own pushes first (no third server involved), then per target, small clips first
	transfers.sort((a, b) => (a.from === selfId ? 0 : 1) - (b.from === selfId ? 0 : 1) || cmp(a.to, b.to) || a.bytes - b.bytes || cmp(a.id, b.id))
	return { transfers, skipped }
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * @param {{ copy: (t: object, o: { signal: AbortSignal, throttleKbps: number, onProgress: (done: number) => void })
 *     => Promise<{ ok: boolean, error?: string }>,
 *   server: (id: string) => { name?: string, free_bytes?: number|null, on_air?: boolean|null, can_throttle?: boolean },
 *   broadcast?: (data: object) => void, onDone?: (run: object) => void, now?: () => number, log?: Function,
 *   newId?: () => string }} deps
 *   copy: one file from t.from to t.to (a local push, or a request to the third server that has it)
 */
function createSpreader(deps) {
	const now = deps.now || Date.now
	const log = (lvl, msg) => deps.log?.(lvl, `[cluster] media spread: ${msg}`)
	let run = null
	let ctl = null
	let lastProgress = 0

	const view = () => (run ? JSON.parse(JSON.stringify(run)) : null)
	const emit = (data) => {
		try {
			deps.broadcast?.(data)
		} catch {
			/* a broadcast never stops a copy */
		}
	}
	const emitFile = (i, force = true) => {
		const t = now()
		if (!force && t - lastProgress < PROGRESS_MS) return
		lastProgress = t
		emit({ event: 'file', run_id: run.id, index: i, file: { ...run.files[i] }, done_bytes: run.done_bytes })
	}
	const nameOf = (id) => deps.server(id)?.name || id

	/** POST /api/cluster/media-spread → { status, body }. */
	function start(plan, opts = {}) {
		if (run?.state === 'running') return { status: 409, body: { error: 'a media spread is already running', run: view() } }
		if (!plan.transfers.length) return { status: 400, body: { error: 'nothing to send', skipped: plan.skipped } }
		const id = deps.newId ? deps.newId() : `ms_${now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
		const row = (t, state, error = '') => ({ id: t.id, path: t.path || '', from: t.from || '', to: t.to, state, bytes: t.bytes || 0, done_bytes: 0, error, reason: t.reason || '', mtime: t.mtime ?? null, throttle_kbps: null })
		run = { id, state: 'running', started_at: now(), ended_at: null, overwrite: opts.overwrite === true,
			files: [...plan.transfers.map((t) => row(t, 'queued')), ...plan.skipped.map((s) => row(s, 'skipped', s.error))], bytes: 0, done_bytes: 0 }
		run.bytes = run.files.filter((f) => f.state === 'queued').reduce((a, f) => a + f.bytes, 0)
		checkSpace()
		ctl = new AbortController()
		emit({ event: 'start', run: view() })
		log('info', `${plan.transfers.length} transfer(s), ${fmtBytes(run.bytes)}`)
		const mine = run
		loop(mine, ctl.signal).catch((e) => log('warn', `stopped: ${e.message}`)).finally(() => finish(mine))
		return { status: 202, body: { run_id: id, run: view() } }
	}

	/** Free space on every target, for all of its files at once (bytes + 5 %); unknown free space is not refused. */
	function checkSpace() {
		const need = new Map()
		for (const f of run.files) if (f.state === 'queued') need.set(f.to, (need.get(f.to) || 0) + f.bytes)
		for (const [to, bytes] of need) {
			const free = deps.server(to)?.free_bytes
			if (free == null || bytes * SPACE_MARGIN <= free) continue
			const error = `not enough space on ${nameOf(to)} (needs ${fmtBytes(bytes * SPACE_MARGIN)}, ${fmtBytes(free)} free)`
			for (const f of run.files) if (f.to === to && f.state === 'queued') Object.assign(f, { state: 'failed', error })
			log('warn', error)
		}
	}

	async function loop(mine, signal) {
		for (let i = 0; i < mine.files.length; i++) {
			const f = mine.files[i]
			if (f.state !== 'queued') continue
			if (signal.aborted) break
			const from = deps.server(f.from) || {}
			const to = deps.server(f.to) || {}
			const onAir = from.on_air === true || to.on_air === true
			if (onAir && ON_AIR_KBPS && to.can_throttle === false) {
				Object.assign(f, { state: 'failed', error: `on air: ${nameOf(f.to)} cannot take a rate-limited copy (update it), not sent unthrottled` })
				emitFile(i)
				continue
			}
			f.throttle_kbps = onAir ? ON_AIR_KBPS : KBPS
			f.state = 'copying'
			emitFile(i)
			const base = mine.done_bytes
			let r
			try {
				r = await deps.copy({ ...f }, {
					signal,
					throttleKbps: f.throttle_kbps,
					onProgress: (done) => {
						f.done_bytes = Math.max(0, Math.min(f.bytes, Number(done) || 0))
						mine.done_bytes = base + f.done_bytes
						emitFile(i, false)
					},
				})
			} catch (e) {
				r = { ok: false, error: e.message }
			}
			if (r?.ok) {
				Object.assign(f, { state: 'done', done_bytes: f.bytes, error: '' })
				mine.done_bytes = base + f.bytes
			} else {
				Object.assign(f, { state: 'failed', error: signal.aborted ? 'cancelled' : String(r?.error || 'copy failed').slice(0, 400) })
				mine.done_bytes = base
				log('warn', `${f.id} → ${nameOf(f.to)}: ${f.error}`)
			}
			emitFile(i)
		}
	}

	function finish(mine) {
		for (const f of mine.files) if (f.state === 'queued' || f.state === 'copying') Object.assign(f, { state: 'skipped', error: 'cancelled' })
		mine.state = ctl?.signal.aborted ? 'cancelled' : 'done'
		mine.ended_at = now()
		const ok = mine.files.filter((f) => f.state === 'done').length
		log('info', `${mine.state}: ${ok}/${mine.files.length} copied`)
		emit({ event: 'done', run: view() })
		try {
			deps.onDone?.(view())
		} catch {
			/* refresh is best effort */
		}
	}

	/** POST /api/cluster/media-spread/cancel → { status, body }. */
	function cancel() {
		if (run?.state !== 'running') return { status: 409, body: { error: 'no media spread is running' } }
		ctl.abort()
		return { status: 200, body: { ok: true, run: view() } }
	}

	return { start, cancel, status: () => ({ running: run?.state === 'running', run: view() }), running: () => run?.state === 'running' }
}

module.exports = { planSpread, createSpreader, ON_AIR_KBPS }
