'use strict'

/**
 * WO-979 — what the role-split run (duties-scenario.js) reads off each server: its duties, its view of the other,
 * the exchange, the on-air state, and a WS tap (the same `/api/ws` a client gets, so "it shows on the media box"
 * means a broadcast a client would receive, not only an API answer).
 */

const WebSocket = require('ws')

/** GET a JSON path, asserting 200 → data. */
async function get(node, p) {
	const r = await node.get(p)
	if (r.status !== 200) throw new Error(`${node.id} GET ${p} → ${r.status} ${JSON.stringify(r.data)?.slice(0, 200)}`)
	return r.data
}

const duties = (node) => get(node, '/api/server/duties')
const senders = async (node) => (await get(node, '/api/server/senders')).senders
const exchange = (node) => get(node, '/api/cluster/exchange')
const cluster = (node) => get(node, '/api/cluster')
const onAir = async (node) => (await get(node, '/api/tracking/zones')).on_air || { rules: 0, now: {}, recent: [] }

/** The look ids a server's zone service sees on air from `source` ('self' or 'peer:<id>'), or null when unknown. */
async function airOf(node, source) {
	const now = (await onAir(node)).now || {}
	return Array.isArray(now[source]) ? now[source] : null
}

/** POST /api/scene/take-look on `node` (a CUT, so air changes at once). */
function take(node, sceneId) {
	return node.post('/api/scene/take-look', { sceneId, forceCut: true })
}

/** Send a signed action from `from` to `to` (POST /api/cluster/send, WO-712 R3). */
function send(from, to, action, args = {}) {
	return from.post('/api/cluster/send', { peer: to.id, action, args })
}

/**
 * A client's WS on `node` → { seen(type, pred?) → newest matching data | null, count(type), close() }.
 * Keeps the last 200 messages per type.
 */
function wsTap(node) {
	const url = node.url.replace(/^http/, 'ws') + '/api/ws'
	const byType = new Map()
	const ws = new WebSocket(url)
	ws.on('message', (raw) => {
		let m
		try {
			m = JSON.parse(String(raw))
		} catch {
			return
		}
		if (!m || typeof m.type !== 'string') return
		if (!byType.has(m.type)) byType.set(m.type, [])
		const list = byType.get(m.type)
		list.push(m.data)
		if (list.length > 200) list.shift()
	})
	ws.on('error', () => {})
	const opened = new Promise((resolve) => {
		ws.once('open', () => resolve(true))
		ws.once('error', () => resolve(false))
		setTimeout(() => resolve(false), 5000).unref?.()
	})
	return {
		opened,
		seen(type, pred = () => true) {
			const list = byType.get(type) || []
			for (let i = list.length - 1; i >= 0; i--) if (pred(list[i])) return list[i]
			return null
		},
		count: (type) => (byType.get(type) || []).length,
		close: () => ws.terminate(),
	}
}

module.exports = { get, duties, senders, exchange, cluster, onAir, airOf, take, send, wsTap }
