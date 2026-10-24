'use strict'

/**
 * WO-670 P2 — the servers this one is linked with (the cluster: servers sharing one project, see the WO's design).
 * Device-local: each server keeps its own peer list (owner: "peers just for safe keeping") in the node's persistence
 * file (`clusterPeers`), never in the project. P2 only SHOWS the peers: online, version, role, leader epoch, channels,
 * media parity against this server's project, and their own Devices view (read from their /api/device-view). Master /
 * epoch / failover is P3, per-destination fan-out P4 — nothing here sends anything to a peer's Caspar.
 *
 * A peer is any HighAsCG node answering /api/replication/ping (appId `highascg`); this server itself (same
 * instanceId) is refused. Peers are polled every POLL_MS while the list is not empty; their device view is cached
 * DEVICE_VIEW_MS. onChange(snapshot) fires when what the clients see changed (→ WS `cluster:peers`).
 * P2b: linking also records the peer's device public key (GET /api/cluster/identity) — what cluster-media.js trusts.
 * P3a: afterPoll(fn) runs fn after every poll (cluster-master.js pulls claims and checks failover there).
 * WO-732 P1: one link, both sides. Linking a server asks it to link this one back (`link_back: false` on that call, so
 * it does not ask again); unlinking unlinks there too. A poll that finds the peer not listing this server (its ping
 * `clusterLinked`) repairs the link, at most every HEAL_MS. An unlink the peer did not confirm leaves a tombstone
 * (`clusterUnlinked`): that server's repair is answered 409 `unlinked` and it drops its side instead.
 */

const http = require('http')
const net = require('net')
const os = require('os')

const STORE_KEY = 'clusterPeers'
const TOMBSTONE_KEY = 'clusterUnlinked'
const POLL_MS = 5000
const DEVICE_VIEW_MS = 15000
const TIMEOUT_MS = 1500
const SCAN_TIMEOUT_MS = 350
const MAX_PEERS = 16
const HEAL_MS = 60000
const TOMBSTONE_MS = 30 * 24 * 3600 * 1000

/** GET http://host:port/path → { ok, status, json } (never throws). */
function getJson(host, port, path, timeout = TIMEOUT_MS) {
	return new Promise((resolve) => {
		const req = http.get({ host, port, path, timeout, headers: { Accept: 'application/json' } }, (res) => {
			const chunks = []
			res.on('data', (c) => chunks.push(c))
			res.on('end', () => {
				let json
				try {
					json = JSON.parse(Buffer.concat(chunks).toString('utf8'))
				} catch {
					json = null
				}
				resolve({ ok: res.statusCode >= 200 && res.statusCode < 300 && json !== null, status: res.statusCode, json })
			})
		})
		req.on('timeout', () => req.destroy(new Error('timeout')))
		req.on('error', (e) => resolve({ ok: false, status: 0, json: null, error: e.message }))
	})
}

/** POST JSON → { ok, status, json } (never throws). */
const postJson = (host, port, path, body, timeout = 5000) => requestJson('POST', host, port, path, body, timeout)

/** method + JSON body → { ok, status, json } (never throws). */
function requestJson(method, host, port, path, body, timeout = 5000) {
	return new Promise((resolve) => {
		const data = Buffer.from(body === undefined ? '' : JSON.stringify(body))
		const req = http.request({ host, port, path, method, timeout,
			headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, Accept: 'application/json' } }, (res) => {
			const chunks = []
			res.on('data', (c) => chunks.push(c))
			res.on('end', () => {
				let json
				try {
					json = JSON.parse(Buffer.concat(chunks).toString('utf8'))
				} catch {
					json = null
				}
				resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json })
			})
		})
		req.on('timeout', () => req.destroy(new Error('timeout')))
		req.on('error', (e) => resolve({ ok: false, status: 0, json: null, error: e.message }))
		req.end(data)
	})
}

/** WO-732: this box's own address on the route to host:port ('' when unreachable) — what the peer links back to. */
function localAddressTo(host, port, timeout = TIMEOUT_MS) {
	return new Promise((resolve) => {
		const s = net.connect({ host, port })
		const done = (v) => {
			s.destroy()
			resolve(v)
		}
		s.setTimeout(timeout, () => done(''))
		s.on('connect', () => done(String(s.localAddress || '').replace(/^::ffff:/, '')))
		s.on('error', () => done(''))
	})
}

/** The id a server lists another one under, from that one's ping (add() and the link-back's unlink agree on it). */
const idFromPing = (ping, fallback) => String(ping?.selfId || ping?.hostname || fallback || '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64)

/** WO-732: the fingerprints of the servers linked here (this server's ping `clusterLinked`). */
function linkedFingerprints(store) {
	const list = store?.get(STORE_KEY)
	const { fingerprint } = require('./cluster-media')
	return (Array.isArray(list) ? list : []).filter((p) => p?.device_key).map((p) => fingerprint(p.device_key))
}

/** "host", "host:port" → { host, port } | null. */
function parseAddress(raw, defPort = 4200) {
	const s = String(raw || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
	const m = /^([A-Za-z0-9.-]{1,253})(?::(\d{1,5}))?$/.exec(s)
	if (!m) return null
	const port = m[2] ? Number(m[2]) : defPort
	return port > 0 && port < 65536 ? { host: m[1], port } : null
}

/** This server's project media against a peer's: same | differs | other-show | unknown. */
function mediaParity(own, peer) {
	if (!own?.slug || !peer?.slug) return 'unknown'
	if (own.slug !== peer.slug) return 'other-show'
	return own.signature === peer.signature ? 'same' : 'differs'
}

function subnetHosts(nets = os.networkInterfaces()) {
	const prefixes = new Set()
	for (const list of Object.values(nets || {})) {
		for (const a of list || []) {
			if ((a.family === 'IPv4' || a.family === 4) && !a.internal && /^(10|172|192)\./.test(a.address)) prefixes.add(a.address.split('.').slice(0, 3).join('.'))
		}
	}
	const out = []
	for (const p of prefixes) for (let i = 1; i <= 254; i++) out.push(`${p}.${i}`)
	return out
}

/**
 * @param {{ persistence: { get: Function, set: Function }, selfPing: () => Promise<object|null>, fetchJson?: Function,
 *   now?: () => number, onChange?: (snap: object) => void, hosts?: () => string[], selfKey?: string,
 *   selfPort?: () => number, request?: Function, localAddress?: Function, log?: Function }} opts
 */
function createCluster(opts) {
	const fetchJson = opts.fetchJson || getJson
	const request = opts.request || requestJson
	const localAddress = opts.localAddress || localAddressTo
	const now = opts.now || Date.now
	const hosts = opts.hosts || subnetHosts
	const store = opts.persistence
	const { fingerprint } = require('./cluster-media')
	const selfFp = opts.selfKey ? fingerprint(opts.selfKey) : ''
	const log = (lvl, msg) => opts.log?.(lvl, `[cluster] ${msg}`)
	/** id → { saved: {id, host, port, name, added_at, device_key}, live: {...}, view: {at, data}, send: {...} | null,
	 *   back: { ok: bool|null, error, at } (WO-732: did it take the link back) } */
	const peers = new Map()
	let self = null
	let timer = null
	let lastSig = ''

	for (const p of Array.isArray(store.get(STORE_KEY)) ? store.get(STORE_KEY) : []) {
		if (p && typeof p.id === 'string' && parseAddress(`${p.host}:${p.port}`)) peers.set(p.id, { saved: p, live: { online: null }, view: null, send: null, back: null })
	}

	const save = () => store.set(STORE_KEY, [...peers.values()].map((p) => p.saved))
	const tombstones = () => (Array.isArray(store.get(TOMBSTONE_KEY)) ? store.get(TOMBSTONE_KEY) : []).filter((t) => t && now() < t.until)
	const tombstoned = (key) => !!key && tombstones().some((t) => t.fp === fingerprint(key))
	const setTombstones = (list) => store.set(TOMBSTONE_KEY, list.slice(-32))
	const tombstone = (key, ms) => key && setTombstones([...tombstones().filter((t) => t.fp !== fingerprint(key)), { fp: fingerprint(key), until: now() + ms }])

	function liveFrom(ping) {
		return {
			online: true,
			last_seen: now(),
			hostname: String(ping.hostname || ''),
			version: String(ping.appVersion || ''),
			role: String(ping.role || 'standalone'),
			epoch: Number(ping.leaderEpoch) || 0,
			program_channels: Array.isArray(ping.channelMap?.programChannels) ? ping.channelMap.programChannels.length : null,
			media: ping.projectMedia ? { slug: ping.projectMedia.slug, files: ping.projectMedia.fileCount, signature: ping.projectMedia.signature } : null,
			duties: ping.duties && typeof ping.duties === 'object' ? ping.duties : null, // WO-712 R1: what that server does (null = older server)
			linked: Array.isArray(ping.clusterLinked) ? ping.clusterLinked.map(String) : null, // WO-732 (null = older server)
			error: '',
		}
	}

	/** WO-732: true / false = that server does / does not list this one; null = unknown (older server, offline). */
	function linkedBack(p) {
		if (p.live.online !== true || !selfFp) return null
		if (Array.isArray(p.live.linked)) return p.live.linked.includes(selfFp)
		return p.back?.ok ?? null
	}

	function view(p) {
		const media = p.live.media
		const { device_key: key, ...saved } = p.saved
		return {
			...saved,
			identity: !!key,
			fp: key ? require('./cluster-media').fingerprint(key) : '', // WO-723: the id a sender choice names
			online: p.live.online,
			last_seen: p.live.last_seen || null,
			hostname: p.live.hostname || '',
			version: p.live.version || '',
			role: p.live.role || '',
			epoch: p.live.epoch ?? null,
			program_channels: p.live.program_channels ?? null,
			media: media ? { slug: media.slug, files: media.files } : null,
			media_parity: mediaParity(self?.projectMedia, media),
			duties: p.live.duties ?? null,
			error: p.live.error || '',
			media_send: p.send,
			linked_back: linkedBack(p),
			link_back_error: linkedBack(p) === true ? '' : p.back?.error || '',
		}
	}

	function snapshot() {
		const s = self || {}
		return {
			self: { id: s.selfId || '', hostname: s.hostname || '', version: s.appVersion || '', role: s.role || '', epoch: s.leaderEpoch ?? null,
				media: s.projectMedia ? { slug: s.projectMedia.slug, files: s.projectMedia.fileCount } : null, duties: s.duties ?? null },
			peers: [...peers.values()].map(view),
		}
	}

	function changed() {
		const snap = snapshot()
		const sig = JSON.stringify(snap, (k, v) => (k === 'last_seen' ? undefined : v))
		if (sig === lastSig) return
		lastSig = sig
		opts.onChange?.(snap)
	}

	async function refreshSelf() {
		try {
			self = (await opts.selfPing()) || self
		} catch {
			/* keep the last one */
		}
	}

	async function pollOne(p) {
		const r = await fetchJson(p.saved.host, p.saved.port, '/api/replication/ping')
		if (r.ok && r.json?.appId === 'highascg') p.live = liveFrom(r.json)
		else p.live = { ...p.live, online: false, error: r.error || (r.status ? `HTTP ${r.status}` : 'no answer') }
	}

	/** WO-732: ask that server to link this one back → { ok, status, error, unlinked } (recorded in p.back). */
	async function linkBack(p) {
		const local = await localAddress(p.saved.host, p.saved.port)
		const port = Number(opts.selfPort?.()) || 4200
		let r
		if (!local || local.includes(':')) r = { ok: false, status: 0, error: local ? `no IPv4 route to ${p.saved.host}` : `${p.saved.host}:${p.saved.port} unreachable` }
		else {
			const res = await request('POST', p.saved.host, p.saved.port, '/api/cluster/peers', { address: `${local}:${port}`, link_back: false })
			const why = res.json?.error || res.error || `HTTP ${res.status}`
			r = { ok: res.ok, status: res.status, unlinked: res.status === 409 && res.json?.unlinked === true,
				error: res.ok ? '' : res.status === 401 || res.status === 403 ? `it needs sign-in: link this server there (${why})` : why }
		}
		p.back = { ok: r.ok, error: r.error, at: now() }
		return r
	}

	/** WO-732: a peer that does not list this server (or an older one never asked) is asked again, at most every HEAL_MS. */
	async function heal(p) {
		if (!selfFp || p.live.online !== true || linkedBack(p) === true) return
		if (!Array.isArray(p.live.linked) && p.back) return // an older server: asked once (its add has no repair)
		if (p.back && now() - p.back.at < HEAL_MS) return
		const r = await linkBack(p)
		const justLinked = p.saved.linked_at && now() - p.saved.linked_at < 2 * HEAL_MS // an operator link stays; its repair runs again later
		if (r.unlinked && !justLinked) {
			log('info', `${p.saved.name} unlinked this server: unlinked here too`)
			remove(p.saved.id)
		} else if (r.ok) log('info', `${p.saved.name} did not list this server: linked back`)
		else log('warn', `${p.saved.name}: link back refused (${r.error})`)
	}

	const pollHooks = []
	async function poll() {
		await refreshSelf()
		await Promise.all([...peers.values()].map(pollOne))
		await Promise.all([...peers.values()].map(heal))
		changed()
		for (const fn of pollHooks) Promise.resolve().then(fn).catch(() => {})
	}

	function schedule() {
		if (timer || peers.size === 0) return
		timer = setInterval(() => {
			if (peers.size === 0) return stop()
			poll().catch(() => {})
		}, POLL_MS)
		timer.unref?.()
	}

	function stop() {
		if (timer) clearInterval(timer)
		timer = null
	}

	async function add(raw) {
		const addr = parseAddress(raw?.address ?? (raw?.host ? `${raw.host}:${raw.port || 4200}` : ''))
		if (!addr) return { status: 400, body: { error: 'address must be host or host:port' } }
		if (peers.size >= MAX_PEERS) return { status: 400, body: { error: `at most ${MAX_PEERS} servers` } }
		const r = await fetchJson(addr.host, addr.port, '/api/replication/ping')
		if (!r.ok || r.json?.appId !== 'highascg') return { status: 404, body: { error: `no HighAsCG server at ${addr.host}:${addr.port}` } }
		await refreshSelf()
		if (self?.instanceId && r.json.instanceId === self.instanceId) return { status: 400, body: { error: 'that is this server' } }
		const ident = await fetchJson(addr.host, addr.port, '/api/cluster/identity')
		const deviceKey = ident.ok && typeof ident.json?.device_key === 'string' ? ident.json.device_key.trim() : ''
		if (deviceKey && opts.selfKey && deviceKey === opts.selfKey.trim()) {
			return { status: 409, body: { error: 'that server has the same device identity as this one (a cloned install): delete config/device-identity.json on one of them and restart it' } }
		}
		// WO-732: a link-back (`link_back: false`) from a server unlinked here while it was unreachable is refused
		const fromServer = raw?.link_back === false
		if (fromServer && tombstoned(deviceKey)) return { status: 409, body: { error: 'this server unlinked yours: link it from here to link again', unlinked: true } }
		if (!fromServer && tombstoned(deviceKey)) setTombstones(tombstones().filter((t) => t.fp !== fingerprint(deviceKey)))
		const id = idFromPing(r.json, `${addr.host}:${addr.port}`)
		const prev = peers.get(id)
		const saved = { id, host: addr.host, port: addr.port, name: String(raw?.name || prev?.saved.name || r.json.hostname || id).slice(0, 64),
			added_at: prev?.saved.added_at || now(), device_key: deviceKey, linked_at: fromServer ? prev?.saved.linked_at || 0 : now() }
		peers.set(id, { saved, live: liveFrom(r.json), view: null, send: prev?.send || null, back: fromServer ? { ok: true, error: '', at: now() } : null })
		save()
		schedule()
		const body = { peer: null }
		if (!fromServer) {
			const back = await linkBack(peers.get(id))
			body.link_back = { ok: back.ok, error: back.error }
			if (!back.ok) log('warn', `${saved.name}: link back refused (${back.error})`)
		}
		changed()
		body.peer = view(peers.get(id))
		return { status: prev ? 200 : 201, body }
	}

	function remove(id) {
		if (!peers.delete(id)) return false
		save()
		if (peers.size === 0) stop()
		changed()
		return true
	}

	/**
	 * WO-732: unlink here and there (`linkBack: false` = the other server is unlinking, do not call it back). When that
	 * server does not confirm, its key is tombstoned so its repair drops its side instead of linking again.
	 * → { ok, link_back?: { ok, error } }
	 */
	async function unlink(id, { linkBack: back = true } = {}) {
		const p = peers.get(id)
		if (!p) return { ok: false }
		if (!back) return { ok: remove(id) }
		await refreshSelf() // before removing: the gap where its repair could link again stays one request long
		const me = idFromPing(self, '')
		tombstone(p.saved.device_key, 2 * HEAL_MS) // and a repair racing the DELETE is refused, not taken
		remove(id)
		const r = me ? await request('DELETE', p.saved.host, p.saved.port, `/api/cluster/peers/${encodeURIComponent(me)}?link_back=0`) : { ok: false, status: 0, error: 'this server has no id' }
		const ok = r.ok || r.status === 404 // 404: it did not list this server
		if (!ok) tombstone(p.saved.device_key, TOMBSTONE_MS)
		const error = ok ? '' : r.json?.error || r.error || `HTTP ${r.status}`
		if (!ok) log('warn', `${p.saved.name}: unlink there failed (${error}); it will drop this server when it is back`)
		return { ok: true, link_back: { ok, error } }
	}

	/** The peer's own Devices view (its wiring: never copied, only shown). */
	async function deviceView(id) {
		const p = peers.get(id)
		if (!p) return { status: 404, body: { error: 'no such server' } }
		if (p.view && now() - p.view.at < DEVICE_VIEW_MS) return { status: 200, body: p.view.data }
		const r = await fetchJson(p.saved.host, p.saved.port, '/api/device-view', 4000)
		if (!r.ok) return { status: 502, body: { error: `${p.saved.name}: device view unavailable (${r.error || 'HTTP ' + r.status})` } }
		p.view = { at: now(), data: r.json }
		return { status: 200, body: r.json }
	}

	/** Every HighAsCG node on this box's /24 networks that is not this server and not linked yet. */
	async function scan() {
		await refreshSelf()
		const linked = new Set([...peers.values()].map((p) => `${p.saved.host}:${p.saved.port}`))
		const found = await Promise.all(hosts().map(async (host) => {
			if (linked.has(`${host}:4200`)) return null
			const r = await fetchJson(host, 4200, '/api/replication/ping', SCAN_TIMEOUT_MS)
			if (!r.ok || r.json?.appId !== 'highascg' || (self?.instanceId && r.json.instanceId === self.instanceId)) return null
			return { host, port: 4200, hostname: String(r.json.hostname || host), version: String(r.json.appVersion || ''), role: String(r.json.role || '') }
		}))
		return found.filter(Boolean)
	}

	const saved = (id) => peers.get(id)?.saved || null
	const list = () => [...peers.values()].map((p) => p.saved)
	const byDeviceKey = (pem) => (pem ? [...peers.values()].find((p) => p.saved.device_key && p.saved.device_key === pem.trim())?.saved || null : null)
	const mediaSend = (id) => peers.get(id)?.send || null
	function setMediaSend(id, state) {
		const p = peers.get(id)
		if (!p) return
		p.send = state
		changed()
	}

	return { snapshot, poll, add, remove, unlink, deviceView, scan, stop, start: () => (schedule(), poll()), size: () => peers.size,
		saved, list, byDeviceKey, mediaSend, setMediaSend, afterPoll: (fn) => pollHooks.push(fn) }
}

module.exports = { createCluster, parseAddress, mediaParity, subnetHosts, getJson, postJson, requestJson, localAddressTo, linkedFingerprints,
	STORE_KEY, TOMBSTONE_KEY, POLL_MS, HEAL_MS }
