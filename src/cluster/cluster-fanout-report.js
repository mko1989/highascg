'use strict'

/**
 * WO-1029 B1 — the follower drive gate's evidence. A follower blocked every program channel whenever it SAW the master
 * online, even when the master forwarded nothing to it (asymmetric reachability, a held or uncabled destination, an
 * unshared show, a down Caspar link, a program channel the master never maps). Nobody drove those screens.
 *
 * Now the master tells each linked server what it actually forwards to it, node to node (the signed `info` call of
 * cluster-call.js, like cluster-exchange.js; an old build answers "unknown action" and is logged once):
 *
 *   exchange.fanout  { epoch, master: <master fingerprint>, channels: [that server's PGM channels in the plan],
 *                      connected: <the master's AMCP link to that server's Caspar is up> }
 *
 * sent after every cluster poll (cluster-fanout.js status()), also when nothing is forwarded (`channels: []`).
 * The receiver blocks program channel `ch` ONLY while the newest report
 *   - comes from the server that is master in its own view, for the same epoch and master fingerprint,
 *   - is younger than STALE_MS (about two polls),
 *   - is `connected` and lists `ch`.
 * Anything else — no report, a stale one, an old master that sends none, a master state not settled yet, a channel
 * not listed — leaves the channel to this server (owner: "local screen destinations must always be driveable from the
 * local box").
 */

const { fingerprint } = require('./cluster-media')
const { POLL_MS } = require('./cluster-peers')

const ACTION = 'exchange.fanout'
const STALE_MS = 2 * POLL_MS + 2000 // two polls, plus the time a poll itself takes (device views, pulls)

/**
 * @param {{ master: () => object|null, fanout: () => { active: boolean, peers: object }, peers: () => Array<{ id, name,
 *   online }>, call: (id: string, action: string, args: object, opts: object) => Promise<object>, now?: () => number,
 *   log?: Function }} deps
 */
function createFanoutReport(deps) {
	const now = deps.now || Date.now
	const inbox = new Map() // master's peer id → { data, at, name }
	const out = new Map() // peer id → { busy, failing }
	const log = (lvl, msg) => deps.log?.(lvl, `[cluster] ${msg}`)

	/** Master side: one report per online linked server → how many were sent. */
	function publish() {
		const v = deps.master()
		const st = deps.fanout() || { active: false, peers: {} }
		if (!v?.is_master || !(v.epoch > 0) || !st.active) return 0
		let n = 0
		for (const p of deps.peers() || []) {
			if (!p?.online || !p.id) continue
			const t = st.peers?.[p.id]
			const channels = [...new Set((t?.destinations || []).map((d) => Number(d?.pgm?.[1])).filter((c) => c > 0))]
			const data = { epoch: v.epoch, master: v.master, channels: channels.sort((a, b) => a - b), connected: !!t?.connected }
			if (!out.has(p.id)) out.set(p.id, { busy: false, failing: false })
			const s = out.get(p.id)
			if (s.busy) continue // the next poll sends the newer one
			s.busy = true
			n++
			Promise.resolve(deps.call(p.id, ACTION, { data }, { quiet: true }))
				.catch((e) => ({ ok: false, error: String(e?.message || e) }))
				.then((r) => {
					s.busy = false
					if (!r?.ok === s.failing) return
					s.failing = !r?.ok
					const why = r?.ok ? 'taking it again' : r?.json?.error || r?.error || `HTTP ${r?.status}`
					log(r?.ok ? 'info' : 'warn', `fan-out report → ${p.name || p.id}: ${why}${r?.ok ? '' : ' (that server drives its own screens)'}`)
				})
		}
		return n
	}

	/** Receiver: the `info` action → { status, body }. */
	function receive(data, peer) {
		const d = data && typeof data === 'object' && !Array.isArray(data) ? data : null
		if (!d || !Number.isInteger(d.epoch) || !Array.isArray(d.channels)) return { status: 400, body: { error: 'epoch and channels required' } }
		// the report speaks only for its signer: a server cannot claim another one forwards here
		if (!peer?.device_key || String(d.master || '') !== fingerprint(peer.device_key)) return { status: 400, body: { error: 'report is not from its master' } }
		const channels = d.channels.map(Number).filter((c) => Number.isInteger(c) && c > 0)
		inbox.set(peer.id, { data: { epoch: d.epoch, master: String(d.master), channels, connected: d.connected === true }, at: now(), name: peer.name || peer.id })
		return { status: 200, body: { ok: true } }
	}

	/** The current master's fresh report, or null. */
	function current() {
		const v = deps.master()
		if (!v || v.is_master || v.settled === false || !v.master_id || !(v.epoch > 0)) return null
		const m = inbox.get(v.master_id)
		if (!m || now() - m.at > STALE_MS) return null
		if (m.data.epoch !== v.epoch || (v.master && m.data.master !== v.master)) return null
		return m
	}

	/** Program channel → the master's name while it forwards that channel here, else ''. */
	function heldBy(ch) {
		const m = current()
		if (!m || !m.data.connected) return ''
		return m.data.channels.includes(Number(ch)) ? m.name : ''
	}

	/** For GET /api/cluster: what the current master says it forwards here (null = this server drives every screen). */
	function view() {
		const m = current()
		return m ? { from: m.name, age_ms: now() - m.at, channels: m.data.channels, connected: m.data.connected } : null
	}

	function drop(peerId) {
		inbox.delete(peerId)
		out.delete(peerId)
	}

	return { publish, receive, heldBy, view, drop, info: { [ACTION]: async (args, peer) => receive(args?.data, peer) } }
}

module.exports = { createFanoutReport, ACTION, STALE_MS }
