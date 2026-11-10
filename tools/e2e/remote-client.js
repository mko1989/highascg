'use strict'

/**
 * WO-1029 phase 2a — what a Godot operator client on another machine (a Mac / Windows laptop) does to a HighAsCG box,
 * over the same HTTP + WebSocket API, so the virtual box bed can test "a remote client drives both boxes".
 *
 * How the real client meets the server (read, not changed): godot/client/core/config.gd takes `--server=http://host:4200`
 * and the shared password (WO-811, ui.cfg [auth], never the box's own file when the origin is another machine);
 * core/auth_model.gd sends it as `Authorization: Bearer <password>` on every HTTP call and on the WebSocket upgrades
 * (/api/ws, /api/video-feed — video/video_feed.gd). src/server/auth.js has no "local client" exemption, so a client
 * from another address meets exactly this. Here the client binds its OWN loopback alias (127.0.3.x), never the node's,
 * so the server sees a different source address, as from a laptop on the LAN.
 *
 *   const c = createRemoteClient({ url: node.url, password: 'pw', localAddress: '127.0.3.1' })
 *   await c.connect()                       // GET /api/state + WS /api/ws (first message) → { status, ws }
 *   await c.takeLook('look_led_a')          // POST /api/scene/take-look (PGM; { target: 'preview' } for PRV)
 *   await c.testCard(destId) / c.ftb(destId) / c.amcp('PLAY 1-20 LOOK_B') / c.play(destId, 'LOOK_B')
 *   await c.videoFeed(['pgm1'])             // WO-670 P1 JPEG feed: upgrade accepted? frames?
 *   c.close()
 * Every call answers { status, data } and never throws (a refusal is a result).
 */

const http = require('http')
const WebSocket = require('ws')

/** HANDOVER-CONTRACT rule 3: the connected box silent this long (HTTP and WS) before a move is considered. */
const HANDOVER_AFTER_MS = 5000

/**
 * HANDOVER-CONTRACT rules 1, 3, 6 as a pure function (the Godot client's handover_model.gd is the real one; this mirrors
 * it for the virtual bed so the server side can be tested against the same decision).
 * @param {{ loopback?: boolean, current: string, first?: string, currentAlive: boolean, deadForMs: number,
 *   answers: Array<{ id: string, view: object | null }> }} s
 *   current: id of the box the client is on; first: the box it was started on (≠ current after a move);
 *   answers: the learned targets' GET /api/cluster (null = no answer)
 * @returns {{ kind: 'stay' | 'move' | 'offer' | 'offer_return', target?: string, why: string }}
 */
function handoverDecision(s) {
	if (s.loopback) return { kind: 'stay', why: 'on-box client never hands over (rule 1)' }
	if (s.currentAlive) {
		const back = s.first && s.first !== s.current && s.answers.find((a) => a.id === s.first && a.view)
		return back ? { kind: 'offer_return', target: s.first, why: `${s.first} is back (rule 6)` } : { kind: 'stay', why: 'connected box answers' }
	}
	if (s.deadForMs < HANDOVER_AFTER_MS) return { kind: 'stay', why: `silent ${s.deadForMs} ms < ${HANDOVER_AFTER_MS}` }
	const up = s.answers.filter((a) => a.view && a.id !== s.current)
	if (!up.length) return { kind: 'stay', why: 'no target answers: keep retrying' }
	const isMaster = (v) => v.master?.is_master === true && v.master?.settled !== false
	const lost = (v) => (v.peers || []).some((p) => p.id === s.current && p.online === false)
	const master = up.find((a) => isMaster(a.view))
	if (master) return { kind: 'move', target: master.id, why: `${master.id} is master now` }
	const confirms = up.find((a) => lost(a.view))
	if (confirms) return { kind: 'move', target: confirms.id, why: `${confirms.id} sees ${s.current} offline` }
	return { kind: 'offer', target: up[0].id, why: `${up[0].id} answers but still sees ${s.current}: our path is broken` }
}

function createRemoteClient({ url, password = '', localAddress = '127.0.3.1', timeoutMs = 8000 }) {
	let base = new URL(url)
	const headers = () => (password ? { Authorization: `Bearer ${password}` } : {})
	const sockets = new Set()

	function request(method, p, body, ms = timeoutMs, at = base) {
		return new Promise((resolve) => {
			const data = body === undefined ? null : Buffer.from(JSON.stringify(body))
			const h = { ...headers(), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}) }
			const req = http.request({ host: at.hostname, port: at.port, path: p, method, headers: h, localAddress, timeout: ms }, (res) => {
				const c = []
				res.on('data', (d) => c.push(d))
				res.on('end', () => {
					let json
					try {
						json = JSON.parse(Buffer.concat(c).toString('utf8') || 'null')
					} catch {
						json = { raw: Buffer.concat(c).toString('utf8').slice(0, 500) }
					}
					resolve({ status: res.statusCode, data: json })
				})
			})
			req.on('timeout', () => req.destroy(new Error('timeout')))
			req.on('error', (e) => resolve({ status: 0, data: null, error: e.message }))
			if (data) req.write(data)
			req.end()
		})
	}
	const get = (p) => request('GET', p)
	const post = (p, b) => request('POST', p, b ?? {})

	/** A WebSocket the way the client opens it → { status: 101 | HTTP code | 0, ws, first } (first message or null). */
	function openWs(p, waitFirstMs = 0) {
		return new Promise((resolve) => {
			const ws = new WebSocket(`ws://${base.host}${p}`, { headers: headers(), localAddress, handshakeTimeout: timeoutMs })
			sockets.add(ws)
			let done = false
			const finish = (v) => {
				if (done) return
				done = true
				resolve(v)
			}
			ws.on('unexpected-response', (_req, res) => {
				finish({ status: res.statusCode, ws: null, first: null })
				ws.terminate()
			})
			ws.on('error', (e) => finish({ status: 0, ws: null, first: null, error: e.message }))
			ws.on('open', () => {
				if (!waitFirstMs) return finish({ status: 101, ws, first: null })
				const t = setTimeout(() => finish({ status: 101, ws, first: null }), waitFirstMs)
				ws.once('message', (m) => {
					clearTimeout(t)
					finish({ status: 101, ws, first: String(m).slice(0, 2000) })
				})
			})
		})
	}

	/** destination id → { id, label, mainIdx, pgm, prv } as the client reads them (device view + channel map). */
	async function destinations() {
		const r = await get('/api/device-view')
		if (r.status !== 200) return { status: r.status, list: [] }
		const cm = r.data.live?.caspar?.channelMap || {}
		const list = (r.data.screenDestinations?.destinations || []).map((d) => {
			const i = Number(d.mainScreenIndex) || 0
			return { id: d.id, label: d.label, mode: d.mode, mainIdx: i, pgm: cm.programChannels?.[i], prv: cm.previewChannels?.[i] }
		})
		return { status: 200, list }
	}
	async function dest(id) {
		const d = (await destinations()).list.find((x) => x.id === id)
		if (!d) throw new Error(`remote client: no destination ${id} on ${url}`)
		return d
	}

	const client = {
		get url() {
			return base.origin
		},
		localAddress,
		get,
		post,
		/** What the client does at start: the state, then the live socket (its first push proves it is subscribed). */
		async connect() {
			const state = await get('/api/state')
			const ws = state.status === 200 ? await openWs('/api/ws', 5000) : { status: 0, ws: null, first: null }
			client.ws = ws.ws
			return { status: state.status, state: state.data, wsStatus: ws.status, wsFirst: ws.first }
		},
		destinations,
		async looks() {
			const r = await get('/api/project')
			return { status: r.status, list: r.status === 200 ? r.data?.scenes?.scenes || [] : [] }
		},
		/** A look take (the look's own screen; `mainIdx` picks another one; `target: 'preview'` stages on PRV). */
		takeLook: (sceneId, o = {}) => post('/api/scene/take-look', { sceneId, target: o.target || 'program', forceCut: o.forceCut !== false, ...(o.mainIdx !== undefined ? { mainIdx: o.mainIdx } : {}) }),
		/** The test card dialog's per-screen "Show test card" on that destination's PGM channel. */
		async testCard(destId, enabled = true) {
			return post('/api/led-test-card/channel', { channel: (await dest(destId)).pgm, enabled })
		},
		async ftb(destId) {
			return post('/api/ftb', destId === undefined ? {} : { screenIdx: (await dest(destId)).mainIdx })
		},
		amcp: (cmd) => post('/api/amcp/raw', { cmd }),
		/** Media play from the library onto a layer of that destination's PGM. */
		async play(destId, clip, layer = 20) {
			return post('/api/play', { channel: (await dest(destId)).pgm, layer, clip })
		},
		cluster: () => get('/api/cluster'),
		/**
		 * WO-670 P1: the JPEG feed a remote client draws pictures from. → { status (101 = accepted), frames, roles }.
		 * A sandbox has no shm ring for most roles: an accepted upgrade with 0 frames is the honest answer there.
		 */
		async videoFeed(roles, ms = 1500) {
			const r = await openWs('/api/video-feed?width=320&fps=5&quality=8')
			if (r.status !== 101) return { status: r.status, frames: 0, roles: [] }
			const seen = new Set()
			let frames = 0
			r.ws.on('message', (m, isBinary) => {
				if (!isBinary) return
				const b = Buffer.from(m)
				seen.add(b.subarray(1, 1 + b[0]).toString('latin1'))
				frames++
			})
			r.ws.send(JSON.stringify({ roles }))
			await new Promise((res) => setTimeout(res, ms))
			const open = r.ws.readyState === WebSocket.OPEN
			r.ws.close()
			return { status: 101, frames, roles: [...seen], stayedOpen: open }
		},

		// --- handover (HANDOVER-CONTRACT.md) ---------------------------------------------------------------------
		first: null, // { id, url } of the box the client was started on (learned at the first learnTargets)
		current: null, // { id, url }
		targets: [], // [{ id, name, host, port, online }] as the connected box reports them
		lastAnswer: Date.now(),

		/** Rule 2: the connected box's linked servers and its master view → the stored target list. */
		async learnTargets() {
			const r = await get('/api/cluster')
			if (r.status !== 200) return null
			client.lastAnswer = Date.now()
			const self = { id: r.data.self?.id || '', url: base.origin }
			client.current = self
			if (!client.first) client.first = { ...self }
			client.targets = (r.data.peers || []).map((p) => ({ id: p.id, name: p.name || p.hostname || p.id, host: p.host, port: p.port, online: p.online === true }))
			return { self, master: r.data.master, targets: client.targets }
		},
		/** Is the connected box answering (one short GET)? Updates lastAnswer. */
		async alive(ms = 1500) {
			const r = await request('GET', '/api/cluster', undefined, ms)
			if (r.status === 200) client.lastAnswer = Date.now()
			return r.status === 200
		},
		/** A learned target's GET /api/cluster with the same credentials (null = no answer). */
		async probe(t, ms = 2000) {
			const r = await request('GET', '/api/cluster', undefined, ms, new URL(`http://${t.host}:${t.port}`))
			return r.status === 200 ? r.data : null
		},
		/** One decision round: health of the connected box + every learned target's answer → handoverDecision(). */
		async decide() {
			const currentAlive = await client.alive()
			const answers = await Promise.all(client.targets.map(async (t) => ({ id: t.id, view: await client.probe(t) })))
			const loopback = false // the bed's client is a REMOTE one by construction (its own alias, --server given)
			return handoverDecision({ loopback, current: client.current?.id, first: client.first?.id, currentAlive, deadForMs: Date.now() - client.lastAnswer, answers })
		},
		/** Rule 4: reconnect to a learned target like a client started with that --server (same password). */
		async moveTo(id) {
			const t = client.targets.find((x) => x.id === id)
			if (!t) throw new Error(`remote client: ${id} is not a learned target`)
			for (const s of sockets) s.terminate()
			sockets.clear()
			base = new URL(`http://${t.host}:${t.port}`)
			const k = await client.connect()
			if (k.status === 200) await client.learnTargets()
			return k
		},

		close() {
			for (const s of sockets) s.terminate()
			sockets.clear()
		},
	}
	return client
}

module.exports = { createRemoteClient, handoverDecision, HANDOVER_AFTER_MS }
