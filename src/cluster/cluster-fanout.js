'use strict'

/**
 * WO-670 P4a — the master plays every destination on its own Caspar and forwards each AMCP command to the Caspar of
 * every linked server on which that destination is cabled. One rule covers both link kinds of the design: a destination
 * cabled on the master too is BACKED UP there, one cabled only on the peer is EXTENDED there (the master's own channel
 * for it exists anyway: channels follow the shared destination list, not the cables — routing-map.js:99-103, 226-254).
 *
 * Channels are translated per destination id: master channel → (destination, PGM | PRV) → that server's channel for
 * it, read from its own /api/device-view (destinations with mode + mainScreenIndex, live.caspar.channelMap). So the
 * two boxes' lists may differ. A line whose channel belongs to no destination cabled there is not sent (multiview,
 * inputs, the operator GUI channel stay local). Same allow-list as the hot-backup fan-out (amcp-fanout.js
 * shouldFanOutCommand); a `route://N` source on a translated channel is translated too, any other route is sent as is.
 *
 * Active only while this server is the cluster master (cluster-master.js) and the hot-backup pair is off (that pair
 * has its own fan-out; both would drive the same Caspar twice). Plans refresh after each cluster poll (5 s; device
 * views cached 15 s).
 *
 * P4b catch-up: everything this server sends is also kept in an air journal (cluster-air-journal.js). When a server's
 * Caspar connects (first time or again) or a destination gets newly cabled there, the journal of those channels is
 * replayed to it, translated, before any new line.
 */

const { shouldFanOutCommand, parseAmcpCommandChannel } = require('../replication/amcp-fanout')
const { createAirJournal } = require('./cluster-air-journal')

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1'])

const isMainBus = (mode) => !['multiview', 'stream', 'operator_gui'].includes(String(mode || 'pgm_prv'))

/** destination id → { pgm, prv } channels on the box whose device view this is. */
function mainChannels(view) {
	const cm = view?.live?.caspar?.channelMap || {}
	const out = new Map()
	for (const d of view?.screenDestinations?.destinations || []) {
		if (!d || typeof d.id !== 'string' || !isMainBus(d.mode)) continue
		const i = Math.max(0, parseInt(String(d.mainScreenIndex ?? 0), 10) || 0)
		const pgm = Number(cm.programChannels?.[i]) || null
		const prv = Number(cm.previewChannels?.[i]) || null
		if (pgm) out.set(d.id, { pgm, prv, label: String(d.label || d.id) })
	}
	return out
}

/** Destination ids that have a cable on the box whose device view this is (same rule as Godot cluster_model.gd). */
function cabledIds(view) {
	const g = view?.graph || {}
	const destOf = new Map()
	for (const c of g.connectors || []) {
		if (c?.kind === 'destination_in' && c.externalRef) destOf.set(String(c.id), String(c.externalRef))
	}
	const out = new Set()
	for (const e of g.edges || []) {
		if (e && destOf.has(String(e.sourceId)) && e.sinkId) out.add(destOf.get(String(e.sourceId)))
	}
	return out
}

/** { map: Map<masterCh, peerCh>, destinations: [{ id, label, pgm: [a, b], prv: [a, b] | null }] } */
function channelPlan(own, peer) {
	const mine = mainChannels(own)
	const theirs = mainChannels(peer)
	const map = new Map()
	const destinations = []
	for (const id of cabledIds(peer)) {
		const a = mine.get(id)
		const b = theirs.get(id)
		if (!a || !b) continue
		map.set(a.pgm, b.pgm)
		const prv = a.prv && b.prv ? [a.prv, b.prv] : null
		if (prv) map.set(a.prv, b.prv)
		destinations.push({ id, label: b.label, pgm: [a.pgm, b.pgm], prv })
	}
	destinations.sort((x, y) => x.pgm[0] - y.pgm[0])
	return { map, destinations }
}

/** One AMCP line for that server, or null when it does not go there. */
function rewriteLine(line, map) {
	const s = String(line || '').trim()
	if (!shouldFanOutCommand(s)) return null
	const ch = parseAmcpCommandChannel(s)
	if (ch == null || !map.has(ch)) return null
	return s
		.replace(/^(\S+\s+)(\d+)/, (_, verb) => verb + map.get(ch))
		.replace(/route:\/\/(\d+)/gi, (m, n) => (map.has(Number(n)) ? `route://${map.get(Number(n))}` : m))
}

/** BEGIN…COMMIT wire payload or a line → its command lines. */
function payloadLines(payload) {
	const list = Array.isArray(payload) ? payload : String(payload || '').split(/\r?\n/)
	return list.map((l) => String(l).trim()).filter((l) => l && !/^(BEGIN|COMMIT)$/i.test(l))
}

/**
 * @param {{ isMaster: () => boolean, pairEnabled: () => boolean, members: () => Array<{ id, host, name }>,
 *   peerView: (id: string) => Promise<object|null>, ownView: () => Promise<object|null>,
 *   connect: (host: string, port: number, onConnected: Function) => object, journal?: object, log?: Function,
 *   onChange?: Function }} deps
 */
function createClusterFanout(deps) {
	/** id → { id, host, port, conn, plan, sent, error, synced: Set<master channel>, caught_up } */
	const targets = new Map()
	const journal = deps.journal || createAirJournal()
	let active = false
	let lastSig = ''
	const log = (lvl, msg) => deps.log?.(lvl, `[cluster] ${msg}`)

	function drop(id) {
		const t = targets.get(id)
		if (!t) return
		t.conn?.stop?.()
		targets.delete(id)
	}

	let busy = false
	async function refresh() {
		if (busy) return
		busy = true
		try {
			await plan()
		} finally {
			busy = false
		}
	}

	async function plan() {
		const on = deps.isMaster() && !deps.pairEnabled()
		if (on !== active)
			log(
				'info',
				on
					? 'master: forwarding takes to the linked servers'
					: 'not forwarding takes (not the master, or the hot-backup pair is on)'
			)
		active = on
		if (!on) {
			for (const id of [...targets.keys()]) drop(id)
			return changed()
		}
		const own = await deps.ownView()
		const members = deps.members()
		for (const id of [...targets.keys()]) if (!members.some((m) => m.id === id)) drop(id)
		for (const m of members) {
			const view = await deps.peerView(m.id)
			if (!view || !own) {
				const t = targets.get(m.id)
				if (t) t.error = 'device view unavailable'
				continue
			}
			const plan = channelPlan(own, view)
			const c = view.live?.caspar || {}
			const host = LOOPBACK.has(String(c.host || '')) || !c.host ? m.host : String(c.host)
			const port = Number(c.port) || 5250
			let t = targets.get(m.id)
			if (!t || t.host !== host || t.port !== port) {
				drop(m.id)
				const fresh = { id: m.id, host, port, sent: 0, error: '', synced: new Set(), caught_up: null }
				fresh.conn = deps.connect(host, port, () => {
					fresh.synced.clear()
					catchUp(fresh)
				})
				t = fresh
				targets.set(m.id, t)
				log('info', `${m.name}: forwarding to its Caspar ${host}:${port}`)
			}
			t.plan = plan
			t.error = plan.destinations.length ? '' : 'no shared destination is cabled there'
			for (const ch of [...t.synced]) if (!plan.map.has(ch)) t.synced.delete(ch)
			catchUp(t)
		}
		changed()
	}

	/** Tells the clients only when something but the sent counters moved. */
	function changed() {
		const sig = JSON.stringify(status(), (k, v) => (k === 'sent' ? undefined : v))
		if (sig === lastSig) return
		lastSig = sig
		deps.onChange?.()
	}

	/** Replays what is on air on the channels that server has not been given yet. */
	function catchUp(t) {
		if (!active || targets.get(t.id) !== t || !t.plan || !t.conn?.isConnected) return
		const todo = [...t.plan.map.keys()].filter((ch) => !t.synced.has(ch))
		if (!todo.length) return
		const out = journal.replay(new Set(todo)).map((l) => rewriteLine(l, t.plan.map)).filter(Boolean)
		for (let i = 0; i < out.length; i += 50) t.conn.enqueueBatchLines(out.slice(i, i + 50))
		for (const ch of todo) t.synced.add(ch)
		t.sent += out.length
		t.caught_up = { at: Date.now(), lines: out.length }
		log('info', `${t.id}: caught up on channels ${todo.join(', ')} (${out.length} lines)`)
	}

	/** amcp-fanout.js hook: every command / batch this server sent to its own Caspar. */
	function send(payload) {
		const lines = payloadLines(payload)
		if (!lines.length) return
		for (const t of active ? targets.values() : []) {
			if (!t.plan?.map.size || !t.conn?.isConnected) continue
			catchUp(t) // the journal without these lines, so they land on the rebuilt state
			const out = lines.map((l) => rewriteLine(l, t.plan.map)).filter(Boolean)
			if (!out.length) continue
			if (out.length === 1) t.conn.enqueueSend(out[0])
			else t.conn.enqueueBatchLines(out)
			t.sent += out.length
		}
		for (const l of lines) if (shouldFanOutCommand(l)) journal.record(l)
	}

	/** For the snapshot: { active, peers: { id: { caspar, connected, sent, error, destinations, caught_up } } } */
	function status() {
		const peers = {}
		for (const [id, t] of targets) {
			peers[id] = {
				caspar: `${t.host}:${t.port}`,
				connected: !!t.conn?.isConnected,
				sent: t.sent,
				error: t.error || '',
				destinations: t.plan?.destinations || [],
				caught_up: t.caught_up,
			}
		}
		return { active, peers }
	}

	function stop() {
		active = false
		for (const id of [...targets.keys()]) drop(id)
	}

	return { refresh, send, status, stop, journal }
}

module.exports = { createClusterFanout, channelPlan, mainChannels, cabledIds, rewriteLine, payloadLines }
