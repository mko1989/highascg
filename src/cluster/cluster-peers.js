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
 */

const http = require('http')
const os = require('os')

const STORE_KEY = 'clusterPeers'
const POLL_MS = 5000
const DEVICE_VIEW_MS = 15000
const TIMEOUT_MS = 1500
const SCAN_TIMEOUT_MS = 350
const MAX_PEERS = 16

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
 *   now?: () => number, onChange?: (snap: object) => void, hosts?: () => string[] }} opts
 */
function createCluster(opts) {
	const fetchJson = opts.fetchJson || getJson
	const now = opts.now || Date.now
	const hosts = opts.hosts || subnetHosts
	const store = opts.persistence
	/** id → { saved: {id, host, port, name, added_at}, live: {...}, view: {at, data} } */
	const peers = new Map()
	let self = null
	let timer = null
	let lastSig = ''

	for (const p of Array.isArray(store.get(STORE_KEY)) ? store.get(STORE_KEY) : []) {
		if (p && typeof p.id === 'string' && parseAddress(`${p.host}:${p.port}`)) peers.set(p.id, { saved: p, live: { online: null }, view: null })
	}

	const save = () => store.set(STORE_KEY, [...peers.values()].map((p) => p.saved))

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
			error: '',
		}
	}

	function view(p) {
		const media = p.live.media
		return {
			...p.saved,
			online: p.live.online,
			last_seen: p.live.last_seen || null,
			hostname: p.live.hostname || '',
			version: p.live.version || '',
			role: p.live.role || '',
			epoch: p.live.epoch ?? null,
			program_channels: p.live.program_channels ?? null,
			media: media ? { slug: media.slug, files: media.files } : null,
			media_parity: mediaParity(self?.projectMedia, media),
			error: p.live.error || '',
		}
	}

	function snapshot() {
		const s = self || {}
		return {
			self: { id: s.selfId || '', hostname: s.hostname || '', version: s.appVersion || '', role: s.role || '', epoch: s.leaderEpoch ?? null,
				media: s.projectMedia ? { slug: s.projectMedia.slug, files: s.projectMedia.fileCount } : null },
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

	async function poll() {
		await refreshSelf()
		await Promise.all([...peers.values()].map(pollOne))
		changed()
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
		const id = String(r.json.selfId || r.json.hostname || `${addr.host}:${addr.port}`).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64)
		const prev = peers.get(id)
		const saved = { id, host: addr.host, port: addr.port, name: String(raw?.name || prev?.saved.name || r.json.hostname || id).slice(0, 64),
			added_at: prev?.saved.added_at || now() }
		peers.set(id, { saved, live: liveFrom(r.json), view: null })
		save()
		schedule()
		changed()
		return { status: prev ? 200 : 201, body: { peer: view(peers.get(id)) } }
	}

	function remove(id) {
		if (!peers.delete(id)) return false
		save()
		if (peers.size === 0) stop()
		changed()
		return true
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

	return { snapshot, poll, add, remove, deviceView, scan, stop, start: () => (schedule(), poll()), size: () => peers.size }
}

module.exports = { createCluster, parseAddress, mediaParity, subnetHosts, getJson, STORE_KEY, POLL_MS }
