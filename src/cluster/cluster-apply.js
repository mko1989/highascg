'use strict'

/**
 * WO-1029 part 1 — one Apply (restart Caspar) button for every linked server that needs it, and only those.
 *
 * Owner, 10.11: "first it should work on both boxes (if needed of course for another box, also with the harnes to not
 * restart local machine when only dirty config for other box)".
 *
 *   plan()  — per server (this one + every linked one): `dirty` as THAT server decides it (`GET /api/caspar-config/dirty`
 *             through the node relay, cluster-relay.js); an older build without the route → its `/api/state`
 *             `configComparison`; still unknown → `dirty: null` (shown, never applied by itself).
 *   apply() — default: every online server with `dirty: true`; a clean server is NEVER restarted, this box included
 *             (no local apply call at all). `servers` names exactly which; `force` also takes the online servers whose
 *             state is unknown. One at a time: linked (non-master) servers first, the master last. Each server's own
 *             `/api/caspar-config/apply` runs ON that server (node ↔ node relay), so its own air snapshot / restore runs
 *             there. A linked server's failure is reported and the next one runs; this box's failure stops the rest.
 *   Progress: `deps.broadcast(data)` (WS `cluster:apply`); the last run stays readable (`status()`).
 * Shapes: scratchpad APPLY-SHAPES.md / the route list in routes-cluster.js.
 */

const parse = (r) => {
	if (r?.json !== undefined) return r.json
	try {
		return JSON.parse(String(r?.body ?? ''))
	} catch {
		return null
	}
}

/**
 * @param {{ selfId: () => string, selfName: () => string, peers: () => Array<{ id: string, name: string, online: boolean }>,
 *   masterId: () => string, localDirty: () => object, localApply: (body: object) => Promise<{ status: number, body: any }>,
 *   relay: (method: string, id: string, path: string, body?: object) => Promise<{ status: number, body?: any, json?: any }>,
 *   screens?: () => Record<string, string[]>, broadcast?: (data: object) => void, now?: () => number, log?: Function }} deps
 */
function createClusterApply(deps) {
	const now = deps.now || (() => Date.now())
	const broadcast = (data) => {
		try {
			deps.broadcast?.(data)
		} catch {
			/* a WS hiccup never stops an apply */
		}
	}
	let running = null
	let last = null

	/** One linked server's dirty state, as it decides it. */
	async function peerDirty(p) {
		const base = { reachable: true, build: 'current' }
		// WO-1029 C0: a peer that advertises caps without `apply` is an older build: no probe. No caps = probe the route as before.
		const known = deps.peerCaps ? deps.peerCaps(p.id) : []
		const r = known.length && !known.includes('apply') ? { status: 404 } : await deps.relay('GET', p.id, '/api/caspar-config/dirty')
		const j = parse(r)
		if (r.status === 200 && j && typeof j.dirty === 'boolean') {
			const reasons = Array.isArray(j.reasons) ? j.reasons : []
			return { ...base, dirty: j.dirty, reasons, reason: j.dirty ? reasons.map((x) => x.text || x.code).join('; ') || 'needs apply' : 'clean' }
		}
		if (r.status === 404) {
			const st = parse(await deps.relay('GET', p.id, '/api/state'))
			const cc = st?.configComparison
			if (cc && cc.serverConfigDriven && typeof cc.aligned === 'boolean') {
				const issues = Array.isArray(cc.issues) ? cc.issues : []
				return { reachable: true, build: 'old', dirty: !cc.aligned, reasons: cc.aligned ? [] : [{ code: 'running_differs', text: issues.slice(0, 3).join(' · ') }],
					reason: cc.aligned ? 'clean (older build: running config only)' : `older build: ${issues[0] || 'running config differs'}` }
			}
			return { reachable: !!st, build: 'old', dirty: null, reasons: [], reason: 'older build: state unknown' }
		}
		if (!r.status || r.status >= 500) return { reachable: false, build: 'unknown', dirty: null, reasons: [], reason: `not reached (${j?.error || `HTTP ${r.status || 0}`})` }
		return { reachable: true, build: 'unknown', dirty: null, reasons: [], reason: j?.error || `HTTP ${r.status}` }
	}

	/** Servers in APPLY ORDER: linked non-master servers, this box (when not master), the master. */
	async function plan() {
		const selfId = deps.selfId()
		const masterId = deps.masterId() || ''
		const screens = (() => {
			try {
				return deps.screens?.() || {}
			} catch {
				return {}
			}
		})()
		let local
		try {
			local = deps.localDirty()
		} catch (e) {
			local = { dirty: null, reasons: [], error: e?.message || String(e) }
		}
		const selfRow = {
			id: selfId, name: deps.selfName() || 'this server', self: true, master: masterId === selfId, online: true, reachable: true,
			dirty: typeof local.dirty === 'boolean' ? local.dirty : null, reasons: local.reasons || [], build: 'current',
			reason: local.error ? `unknown: ${local.error}` : local.dirty ? (local.reasons || []).map((x) => x.text || x.code).join('; ') || 'needs apply' : 'clean',
		}
		const peers = await Promise.all(
			(deps.peers() || []).map(async (p) => {
				const row = { id: p.id, name: p.name || p.id, self: false, master: p.id === masterId, online: p.online === true }
				if (!row.online) return { ...row, reachable: false, dirty: null, reasons: [], build: 'unknown', reason: 'offline' }
				try {
					return { ...row, ...(await peerDirty(p)) }
				} catch (e) {
					return { ...row, reachable: false, dirty: null, reasons: [], build: 'unknown', reason: `not reached (${e?.message || e})` }
				}
			}),
		)
		const rows = [...peers.filter((r) => !r.master), ...(selfRow.master ? [] : [selfRow]), ...peers.filter((r) => r.master), ...(selfRow.master ? [selfRow] : [])]
		return rows.map((r) => ({ ...r, screens: screens[r.id] || [], apply: r.dirty === true && r.online }))
	}

	const view = () => ({ running: !!running, run: running || last })

	function skipReason(row) {
		if (!row.online) return 'offline'
		if (row.dirty === false) return 'clean'
		if (row.build === 'old') return 'old build'
		return 'unknown'
	}

	async function applyOne(row) {
		const body = { force: true } // its own dirty check (or the operator) said so: past the "unchanged" gate
		const r = row.self ? await deps.localApply(body) : await deps.relay('POST', row.id, '/api/caspar-config/apply', body)
		const j = parse(r) || {}
		const ok = r.status === 200 && j.ok !== false
		const hasRestore = Object.prototype.hasOwnProperty.call(j, 'restored')
		return {
			applied: true, skipped: null, ok, status: r.status || 0,
			error: ok ? '' : j.error || j.detail || `HTTP ${r.status || 0}`,
			message: j.message || '',
			restored: hasRestore ? j.restored : null,
			restored_reason: hasRestore ? j.restored_reason || '' : r.status === 200 ? 'older build: no air snapshot' : '',
		}
	}

	/**
	 * @param {{ servers?: string[], force?: boolean, wait?: boolean }} [body]
	 * @returns {Promise<{ status: number, body: object }>}
	 */
	async function apply(body = {}) {
		if (running) return { status: 409, body: { error: 'an apply is already running', run_id: running.run_id } }
		const run = { run_id: `apply_${now().toString(36)}`, started_at: now(), finished_at: null, order: [], results: [], ok: null }
		running = run // claimed before the first await: a second press is refused, not queued
		let rows
		try {
			rows = await plan()
		} catch (e) {
			running = null
			return { status: 502, body: { error: `plan failed: ${e?.message || e}` } }
		}
		const selfId = deps.selfId()
		const named = Array.isArray(body.servers) ? body.servers.map((s) => (String(s) === 'self' ? selfId : String(s))) : null
		const unknown = named ? named.filter((id) => !rows.some((r) => r.id === id)) : []
		if (unknown.length) {
			running = null
			return { status: 400, body: { error: 'not a linked server', unknown } }
		}
		const wanted = (r) => (named ? named.includes(r.id) : r.dirty === true || (body.force === true && r.dirty == null))
		run.order = rows.filter((r) => wanted(r) && r.online).map((r) => r.id)
		broadcast({ run_id: run.run_id, phase: 'start', order: run.order, servers: rows })
		const work = (async () => {
			try {
				return await runAll()
			} finally {
				running = null
			}
		})()
		async function runAll() {
			let stopped = false
			const total = run.order.length
			for (const row of rows) {
				const base = { id: row.id, name: row.name, self: row.self }
				if (!wanted(row) || !row.online || stopped) {
					const skipped = stopped && wanted(row) && row.online ? 'stopped' : wanted(row) ? 'offline' : skipReason(row)
					run.results.push({ ...base, applied: false, skipped, ok: skipped === 'clean', status: 0, error: '', message: '', restored: null, restored_reason: '' })
					continue
				}
				const index = run.order.indexOf(row.id)
				broadcast({ run_id: run.run_id, phase: 'server', id: row.id, name: row.name, state: 'applying', index, total })
				deps.log?.('info', `[cluster-apply] ${row.name}: applying (${row.reason})`)
				let res
				try {
					res = await applyOne(row)
				} catch (e) {
					res = { applied: true, skipped: null, ok: false, status: 0, error: e?.message || String(e), message: '', restored: null, restored_reason: '' }
				}
				const result = { ...base, ...res }
				run.results.push(result)
				deps.log?.(res.ok ? 'info' : 'warn', `[cluster-apply] ${row.name}: ${res.ok ? 'applied' : `FAILED — ${res.error}`}`)
				broadcast({ run_id: run.run_id, phase: 'server', id: row.id, name: row.name, state: 'done', index, total, result })
				if (!res.ok && row.self) stopped = true // this box's own failure: the rest waits for the operator
			}
			run.finished_at = now()
			run.ok = run.results.every((r) => !r.applied || r.ok) && !run.results.some((r) => r.skipped === 'stopped')
			run.ms = run.finished_at - run.started_at
			broadcast({ run_id: run.run_id, phase: 'done', ok: run.ok, ms: run.ms, results: run.results })
			last = run
			return run
		}
		if (body.wait === false) {
			work.catch(() => {})
			return { status: 202, body: { accepted: true, run_id: run.run_id, order: run.order } }
		}
		const done = await work
		return { status: 200, body: done }
	}

	return { plan, apply, status: view }
}

module.exports = { createClusterApply }
