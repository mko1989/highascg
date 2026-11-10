'use strict'

/**
 * WO-1029 P1a — a linked server re-found after an IP change, by proof of its device key (review 01, F1.1/F3.2).
 *
 * Every cluster poll, this server POSTs a signed hello to each linked server it reaches:
 *   POST /api/cluster/hello { id, fp, to, address: "<our IPv4 on the route to it>:<port>", ts, sig }
 *   fp / to = device-key fingerprints of sender / receiver, ts = a counter strictly rising per sender (its ms clock
 *   or one more than the last it sent), sig = ed25519 (device-identity.js) over helloText(body).
 * The receiver checks the signature against the key IT saved when the link was made (never a key in the hello),
 * refuses unknown senders, a hello for another server and a ts not above the highest taken from that sender (replay).
 * Never a wall-clock window: show LANs have no NTP and a dead RTC puts boxes years apart (lead, WO-1029). A sender
 * whose clock went back is answered 409 with that highest ts and resends once above it (still signed by its key).
 * After a restart here the first valid hello sets the floor (a captured hello replayed then only repeats an address
 * the server itself signed).
 * Then it marks that server seen now (online even if its own poll cannot reach it: the incident was one-way reachable)
 * and, when the address differs, re-addresses it. A Tailscale 100.64/10 or non-IPv4 address never replaces a LAN one
 * (the fan-out drives Caspar :5250 at that host), and a saved host NAME is kept (the operator chose it).
 * Older servers answer the hello 404: asked again only every UNSUPPORTED_MS, nothing logged, behaviour as before.
 * The signature IS the auth: /api/cluster/hello is open while `enforceAuth` is on (auth.js), as /api/cluster/call.
 */

const { fingerprint } = require('./cluster-media')
const { normalize: normalizeCaps } = require('./cluster-caps')

const FRESH_MS = 12000 // a hello this recent keeps the peer online when our poll to it fails (2 polls + slack)
const UNSUPPORTED_MS = 60000
const FP_RE = /^[0-9a-f]{16}$/

/** The signed text: a fixed tag, then the fields in a fixed order. */
const helloText = (b) =>
	JSON.stringify(['highascg-hello-1', String(b.id || ''), String(b.fp || ''), String(b.to || ''), String(b.address || ''), Number(b.ts) || 0])

const ipv4 = (s) => {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s || ''))
	return !!m && m.slice(1).every((o) => Number(o) <= 255)
}
const tailscale = (s) => ipv4(s) && Number(s.split('.')[0]) === 100 && (Number(s.split('.')[1]) & 0xc0) === 64

/** The address this node tells a peer: a node bound to one IPv4 (`server.bindAddress`, --bind) serves only there,
 * whatever source the kernel picked for the route (127.0.0.1 for every loopback alias); bound to all → the route's. */
const advertised = (route, bound) => (ipv4(bound) && bound !== '0.0.0.0' ? String(bound) : route)

/** Why `next` must not replace the saved `host` ('' = it may). */
function refuseHost(host, next) {
	if (!ipv4(next)) return 'not an IPv4 address'
	if (!ipv4(host)) return 'the saved address is a name'
	if (tailscale(next) && !tailscale(host)) return 'a Tailscale address'
	return ''
}

/**
 * @param {{ peers: Map<string, object>, selfKey: string, sign: Function, verify: Function, request: Function,
 *   localAddress: Function, selfPort: () => number, selfHost?: () => string, selfId: () => string, parseAddress: Function,
 *   now: () => number, save: Function, changed: Function, log: Function }} deps
 */
function createHello(deps) {
	const me = fingerprint(deps.selfKey)
	const lastTs = new Map() // sender fp → the ts of the last hello taken (replay)
	let lastSent = 0
	const fail = (status, error) => ({ status, body: { error } })

	/** True while a valid hello from that peer is recent: it is alive even when our poll cannot reach it. */
	const fresh = (p) => !!p.heardAt && deps.now() - p.heardAt < FRESH_MS

	/** Sender: one hello to a peer our poll reached (never throws). */
	async function send(p) {
		if (!me || !p.saved.device_key || p.live.online !== true || p.live.via === 'hello') return
		if (p.hello?.status === 404 && deps.now() - p.hello.at < UNSUPPORTED_MS) return
		const { host, port } = p.saved
		const route = await deps.localAddress(host, port)
		if (!route || route.includes(':')) return
		const local = advertised(route, deps.selfHost?.())
		lastSent = Math.max(deps.now(), lastSent + 1)
		const req = { id: deps.selfId(), fp: me, to: fingerprint(p.saved.device_key), address: `${local}:${Number(deps.selfPort?.()) || 4200}`, ts: lastSent }
		const caps = deps.selfCaps?.() || [] // WO-1029 C0: unsigned, advisory (an older receiver verifies the old text and ignores it)
		let r = await deps.request('POST', host, port, '/api/cluster/hello', { ...req, caps, sig: deps.sign(helloText(req)) })
		const floor = Number(r.json?.last)
		if (r.status === 409 && Number.isSafeInteger(floor) && floor >= req.ts) {
			lastSent = floor + 1 // our clock is behind what it took from us before (clock reset): count on from there
			req.ts = lastSent
			r = await deps.request('POST', host, port, '/api/cluster/hello', { ...req, caps, sig: deps.sign(helloText(req)) })
		}
		const error = r.ok ? '' : r.json?.error || r.error || `HTTP ${r.status}`
		if (!r.ok && r.status && r.status !== 404 && p.hello?.error !== error) deps.log('warn', `${p.saved.name}: hello refused (${error})`)
		p.hello = { status: r.status, at: deps.now(), error }
	}

	/** Receiver: POST /api/cluster/hello → { status, body }. */
	function handle(body) {
		const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
		const fp = String(b.fp || '')
		if (!FP_RE.test(fp) || typeof b.sig !== 'string' || !Number.isSafeInteger(Number(b.ts)) || typeof b.address !== 'string') return fail(400, 'malformed hello')
		const p = [...deps.peers.values()].find((x) => x.saved.device_key && fingerprint(x.saved.device_key) === fp)
		if (!p) return fail(403, 'not linked here')
		if (!me || String(b.to || '') !== me) return fail(400, 'hello is for another server')
		const t = deps.now()
		if (!deps.verify(p.saved.device_key, helloText(b), b.sig)) return fail(403, 'bad signature')
		// after the signature: only that server learns the floor (it may restart with a clock that went back)
		if (Number(b.ts) <= (lastTs.get(fp) || 0)) return { status: 409, body: { error: 'replayed hello', last: lastTs.get(fp) } }
		lastTs.set(fp, Number(b.ts))
		p.heardAt = t
		const caps = normalizeCaps(b.caps) // WO-1029 C0: [] from an older build
		p.live = { ...p.live, online: true, last_seen: t, error: '', via: p.live.via === 'poll' && p.live.online === true ? 'poll' : 'hello', caps }
		const addr = deps.parseAddress(b.address)
		const was = `${p.saved.host}:${p.saved.port}`
		let moved = false
		let kept = ''
		if (addr && `${addr.host}:${addr.port}` !== was) {
			kept = refuseHost(p.saved.host, addr.host)
			if (!kept) {
				p.saved = { ...p.saved, host: addr.host, port: addr.port }
				p.view = null // its device view came from the old address
				p.live.via = 'hello' // until our own poll reaches the new address
				moved = true
				deps.log('info', `${p.saved.name}: now at ${addr.host}:${addr.port} (was ${was})`)
				deps.save()
			}
		}
		deps.changed()
		return { status: 200, body: { ok: true, moved, ...(kept ? { kept: `${b.address} not taken: ${kept}` } : {}) } }
	}

	return { send, handle, fresh, me }
}

module.exports = { createHello, helloText, refuseHost, advertised, FRESH_MS }
