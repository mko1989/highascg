'use strict'

/**
 * WO-712 R3 — exchange: what one server knows goes to the linked servers that do not do that job themselves. It is
 * information, not an action: it rides R2's signed call (cluster-call.js) on the receiver's `info` list, so the
 * receiver's `accept_remote` does not lock it out and no journal line is written per call.
 *
 *   tracking.auto   the Auto director's snapshot (WS `tracking:auto`, WO-708/709). From a server with the `auto` duty
 *                   to every online linked server whose duties say `auto: false`. The receiver re-broadcasts it as WS
 *                   `tracking:auto` tagged `source: { id, name }`, so its overlay (WO-710) shows the tracking server's
 *                   people, and the overlay's buttons go back over R2 (POST /api/cluster/send).
 *   air             R3b: what is on program (`{ program: [{ channel, sceneId, name }] }`, src/cluster/air-state.js).
 *                   From a server without the `zones` duty to every online linked server that has it; the receiver
 *                   runs its "on air" rules on it (R4, `onData` → zone-service `onAir`) and broadcasts WS `cluster:air`.
 *
 * Sender: `offer(topic, data)` on every look (≤ 5 Hz). It sends when the data changed, and every HEARTBEAT_MS anyway,
 * so a receiver can tell a quiet server from a gone one. One call per peer is in flight; while it is, only the newest
 * data waits. A peer that refuses is logged once (and once more when it takes calls again).
 * Receiver: `receive(topic, data, peer)` keeps the newest per source and re-broadcasts it when it changed. A source
 * not heard from for EXPIRE_MS is dropped, re-broadcast empty once (`gone: true`), so the overlay hides; `onData`
 * hears every new data and that empty one.
 */

const HEARTBEAT_MS = 5000
const EXPIRE_MS = 15000

const TOPICS = {
	'tracking.auto': {
		action: 'exchange.tracking_auto',
		ws: 'tracking:auto',
		empty: { persons: [], pool: [] },
		sends: (has) => has('auto'),
		wants: (d) => d.auto === false,
		refuses: (has) => (has('auto') ? 'this server does auto itself' : ''),
	},
	air: {
		action: 'exchange.air',
		ws: 'cluster:air',
		empty: { program: [] },
		sends: (has) => !has('zones'),
		wants: (d) => d.zones === true,
		refuses: (has) => (has('zones') ? '' : 'zone actions are off on this server'),
	},
}

/**
 * @param {{ peers: () => Array<{id:string, name:string, online:boolean|null, duties:object|null}>,
 *   has: (duty: string) => boolean, call: Function, broadcast: (type: string, data: object) => void,
 *   onData?: (topic: string, data: object, source: {id: string, name: string}) => void, now?: () => number,
 *   log?: Function }} deps
 */
function createExchange(deps) {
	const now = deps.now || Date.now
	const out = new Map() // `${topic}|${peer id}` → { json, at, busy, next, failing }
	const inbox = new Map() // `${topic}|${peer id}` → { topic, data, json, at, source }
	let timer = null

	const targets = (t) => deps.peers().filter((p) => p.online && p.duties && t.wants(p.duties))

	/** Sender → how many peers a call was started (or queued) for. */
	function offer(topic, data) {
		const t = TOPICS[topic]
		if (!t || !t.sends(deps.has) || !data || typeof data !== 'object') return 0
		const json = JSON.stringify(data)
		let n = 0
		for (const p of targets(t)) {
			const k = `${topic}|${p.id}`
			if (!out.has(k)) out.set(k, { json: '', at: 0, busy: false, next: null, failing: false })
			const s = out.get(k)
			if (json === s.json && now() - s.at < HEARTBEAT_MS) continue
			n++
			if (s.busy) s.next = { json, data }
			else send(t, p, s, json, data)
		}
		return n
	}

	async function send(t, p, s, json, data) {
		Object.assign(s, { busy: true, json, at: now() }) // a refused send is retried at the next heartbeat, not at 5 Hz
		const r = await deps.call(p.id, t.action, { data }, { quiet: true })
		s.busy = false
		if (!r.ok !== s.failing) {
			s.failing = !r.ok
			const why = r.ok ? 'taking it again' : r.json?.error || r.error || `HTTP ${r.status}`
			deps.log?.(r.ok ? 'info' : 'warn', `[cluster] exchange ${t.action} → ${p.name}: ${why}`)
		}
		const next = s.next
		s.next = null
		if (next && next.json !== s.json) send(t, p, s, next.json, next.data)
	}

	/** Receiver: the `info` action → { status, body }. */
	function receive(topic, data, peer) {
		const t = TOPICS[topic]
		if (!data || typeof data !== 'object' || Array.isArray(data)) {
			return { status: 400, body: { error: 'data must be an object' } }
		}
		const no = t.refuses(deps.has)
		if (no) return { status: 409, body: { error: no } }
		const k = `${topic}|${peer.id}`
		const json = JSON.stringify(data)
		const prev = inbox.get(k)
		const source = { id: peer.id, name: peer.name }
		inbox.set(k, { topic, data, json, at: now(), source })
		if (!prev || prev.json !== json) {
			deps.broadcast(t.ws, { ...data, source })
			deps.onData?.(topic, data, source)
		}
		if (!timer) {
			timer = setInterval(expire, HEARTBEAT_MS)
			timer.unref?.()
		}
		return { status: 200, body: { ok: true } }
	}

	function expire() {
		const t0 = now()
		for (const [k, m] of inbox) {
			if (t0 - m.at <= EXPIRE_MS) continue
			inbox.delete(k)
			const t = TOPICS[m.topic]
			deps.broadcast(t.ws, { ...t.empty, source: m.source, gone: true })
			deps.onData?.(m.topic, { ...t.empty }, m.source)
		}
	}

	/** The newest data a linked server sent on `topic`, tagged with its source (null when none is current). */
	function latest(topic) {
		expire()
		let best = null
		for (const m of inbox.values()) if (m.topic === topic && (!best || m.at > best.at)) best = m
		return best ? { ...best.data, source: best.source } : null
	}

	/** GET /api/cluster/exchange body. */
	function view() {
		expire()
		const t0 = now()
		const topics = Object.fromEntries(Object.keys(TOPICS).map((topic) => [topic, latest(topic)]))
		const sources = [...inbox.values()].map((m) => ({ topic: m.topic, source: m.source, age_ms: t0 - m.at }))
		return { ...topics, sources }
	}

	const info = Object.fromEntries(
		Object.entries(TOPICS).map(([topic, t]) => [t.action, async (args, peer) => receive(topic, args.data, peer)])
	)

	return { offer, receive, expire, latest, view, info }
}

module.exports = { createExchange, TOPICS, HEARTBEAT_MS, EXPIRE_MS }
