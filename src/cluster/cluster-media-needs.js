'use strict'

/**
 * WO-1029 plan 07 C10 — which media each screen destination needs, and which of its owners lack it (pure).
 *
 * A destination needs the media of: looks scoped to its screen (`mainScope` == its `main`) or to all screens (`all`,
 * or no scope: a look without one can be taken on any screen), their layers' sources and playlists, and timelines
 * routed to it (a layer's `screenIdx`, else the timeline's `sendTo.screenIdx`, else every screen). Same media rules as
 * replication/project-media-refs.js (live inputs, routes, templates, placeholders are not media files).
 * Its owners = the servers it is cabled on (destination-ownership.js `destinations()[].owners`). A destination owned
 * by nobody needs nothing. For each owner: the file is missing, differs (another SIZE than the copy a spread would
 * send; no hashing), or unknown (that server's inventory is unknown: never counted as missing).
 * The source of a copy: the newest copy (mtime) among the other servers that have it, then this server, the master,
 * the lowest id. GET /api/cluster/media-needs shape: MEDIA-SHAPES (scratchpad) / routes-cluster-media.js.
 */

const { keyOf } = require('./cluster-media-inventory')

const SKIP_VALUE_RE = /^(https?|rtsp|rtmp|srt|udp|ndi|alsa|decklink|route|shm):/i
const ELSEWHERE_MAX = 5000
const MTIME_SLACK_S = 2

/** Media values of one source / playlist item (project-media-refs.js addSourceRef rules, media only). */
function mediaValue(source) {
	if (!source || typeof source !== 'object') return ''
	if (source.isPlaceholder) return ''
	const t = String(source.type || 'media').toLowerCase()
	if (!(t === 'media' || t === 'file' || t === 'video' || t === 'image' || t === 'audio')) return ''
	const v = String(source.value || '').trim()
	return v && !SKIP_VALUE_RE.test(v) ? v : ''
}

const listOf = (block, key) => (Array.isArray(block) ? block : Array.isArray(block?.[key]) ? block[key] : block && typeof block === 'object' ? Object.values(block) : [])

/** Scope of a look: 'all' or a screen index. */
function lookScope(scene) {
	const s = String(scene?.mainScope ?? '').trim()
	if (!s || s === 'all') return 'all'
	const n = parseInt(s, 10)
	return Number.isFinite(n) && n >= 0 ? n : 'all'
}

/** Every media reference of a project → [{ value, scope, look?: { id, name }, timeline?: name }]. */
function projectMediaRefs(project) {
	const out = []
	for (const scene of listOf(project?.scenes, 'scenes')) {
		if (!scene || typeof scene !== 'object') continue
		const scope = lookScope(scene)
		const look = { id: String(scene.id || ''), name: String(scene.name || scene.id || '') }
		for (const layer of scene.layers || []) {
			const vals = [mediaValue(layer?.source), ...(Array.isArray(layer?.playlist) ? layer.playlist.map(mediaValue) : [])]
			for (const value of vals) if (value) out.push({ value, scope, look })
		}
	}
	for (const tl of listOf(project?.timelines, 'timelines')) {
		if (!tl || typeof tl !== 'object') continue
		const tlScreen = Number.isInteger(Number(tl.sendTo?.screenIdx)) && tl.sendTo?.screenIdx !== null && tl.sendTo?.screenIdx !== '' ? Number(tl.sendTo.screenIdx) : 'all'
		const name = String(tl.name || tl.id || 'timeline')
		for (const layer of tl.layers || []) {
			const scope = Number.isInteger(layer?.screenIdx) && layer.screenIdx >= 0 ? layer.screenIdx : tlScreen
			for (const clip of layer?.clips || []) {
				const value = mediaValue(clip?.source)
				if (value) out.push({ value, scope, timeline: name })
			}
		}
	}
	return out
}

/**
 * @param {{ project: object, destinations: Array<{ id, label, main, owners: string[] }>,
 *   servers: Array<{ id, name, self, online }>, inventory: (id: string) => { known: boolean, files?: object[], reason?: string, head?: object },
 *   masterId?: string, expand?: (value: string) => string[], now?: () => number }} input
 *   expand: other spellings of a stored value (project-scoped media: `projects/<slug>/clip`)
 */
function computeNeeds(input) {
	const servers = input.servers || []
	const selfId = servers.find((s) => s.self)?.id || ''
	const name = (id) => servers.find((s) => s.id === id)?.name || id
	const inv = new Map(servers.map((s) => [s.id, input.inventory(s.id) || { known: false }]))
	const byKey = libraryIndex(servers, (id) => inv.get(id))
	const byBase = new Map() // basename key → Set<key>
	for (const k of byKey.keys()) {
		const b = k.split('/').pop()
		if (!byBase.has(b)) byBase.set(b, new Set())
		byBase.get(b).add(k)
	}
	const resolve = (value) => {
		const keys = [value, ...(input.expand ? input.expand(value) : [])].map(keyOf).filter(Boolean)
		for (const k of keys) if (byKey.has(k)) return k
		const b = byBase.get(keys[0]?.split('/').pop() || '')
		return b && b.size === 1 ? [...b][0] : keys[0] || ''
	}
	/** Best copy to send to `target` (any other holder). */
	const sourceFor = (holders, target) => pickSource(holders, target, { selfId, masterId: input.masterId })

	const dests = (input.destinations || []).filter((d) => Array.isArray(d.owners) && d.owners.length)
	const files = new Map() // key → { key, value, needs: Map(owner → { dests: Map, looks: Set, timelines: Set }), looks: Map }
	for (const ref of projectMediaRefs(input.project)) {
		const hit = dests.filter((d) => ref.scope === 'all' || Number(d.main) === ref.scope)
		if (!hit.length) continue
		const key = resolve(ref.value)
		if (!key) continue
		if (!files.has(key)) files.set(key, { key, value: ref.value, needs: new Map(), lookDests: [] })
		const e = files.get(key)
		for (const d of hit) {
			for (const o of d.owners) {
				if (!e.needs.has(o)) e.needs.set(o, { dests: new Map(), looks: new Set(), timelines: new Set() })
				const n = e.needs.get(o)
				n.dests.set(d.id, { id: d.id, label: d.label || d.id, main: Number(d.main) || 0 })
				if (ref.look) n.looks.add(ref.look.name)
				if (ref.timeline) n.timelines.add(ref.timeline)
				if (ref.look) e.lookDests.push({ look: ref.look, owner: o, dest: d })
			}
		}
	}

	const outFiles = []
	const looks = new Map()
	const byServer = {}
	const unknownServers = new Set()
	let missingBytes = 0
	const toSend = { transfers: 0, files: new Set(), bytes: 0 }
	for (const e of [...files.values()].sort((a, b) => (a.key < b.key ? -1 : 1))) {
		const holders = byKey.get(e.key) || new Map()
		const best = sourceFor(holders, null)
		const row = { id: best ? best.f.id : keyOf(e.value).toUpperCase(), path: best ? best.f.p : '', size: best ? best.f.s : 0,
			on: [...holders.keys()].sort(), needed_on: [], missing_on: [], differs_on: [], newer_on: [], unknown_on: [],
			spreadable: holders.size > 0, source: best ? best.id : '', send_from: {} }
		const state = new Map() // owner → 'missing' | 'differs'
		for (const [owner, n] of e.needs) {
			row.needed_on.push({ server: owner, destinations: [...n.dests.values()].map(({ id, label }) => ({ id, label })), looks: [...n.looks].sort(), timelines: [...n.timelines].sort() })
			const ie = inv.get(owner)
			if (!ie || !ie.known) {
				row.unknown_on.push(owner)
				unknownServers.add(owner)
				continue
			}
			const mine = holders.get(owner)
			const src = sourceFor(holders, owner)
			const bs = (byServer[owner] = byServer[owner] || { files: 0, bytes: 0, differs: 0 })
			if (!mine) {
				row.missing_on.push(owner)
				state.set(owner, 'missing')
				bs.files++
				bs.bytes += row.size
				missingBytes += row.size
				if (src) {
					row.send_from[owner] = { server: src.id, path: src.f.p, size: src.f.s, mtime: src.f.m }
					toSend.transfers++
					toSend.files.add(e.key)
					toSend.bytes += src.f.s
				}
			} else if (src && src.f.s !== mine.s) {
				row.differs_on.push(owner)
				state.set(owner, 'differs')
				bs.differs++
				const newer = mine.m > src.f.m + MTIME_SLACK_S
				row.send_from[owner] = { server: src.id, path: src.f.p, size: src.f.s, mtime: src.f.m }
				if (newer) row.newer_on.push(owner)
				else {
					toSend.transfers++
					toSend.files.add(e.key)
					toSend.bytes += src.f.s
				}
			}
		}
		for (const { look, owner, dest } of e.lookDests) {
			const st = state.get(owner)
			if (!st) continue
			if (!looks.has(look.id)) looks.set(look.id, { id: look.id, name: look.name, missing: [], differs: [] })
			const l = looks.get(look.id)
			const list = st === 'missing' ? l.missing : l.differs
			if (!list.some((x) => x.file === row.id && x.server === owner && x.destination === dest.id))
				list.push({ file: row.id, server: owner, server_name: name(owner), destination: dest.id, screen: Number(dest.main) || 0 })
		}
		outFiles.push(row)
	}

	const elsewhere = []
	let truncated = false
	for (const [k, holders] of [...byKey.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
		if (holders.has(selfId)) continue
		if (elsewhere.length >= ELSEWHERE_MAX) {
			truncated = true
			break
		}
		const best = sourceFor(holders, null)
		elsewhere.push({ id: best.f.id, path: best.f.p, size: best.f.s, on: [...holders.keys()].sort() })
		void k
	}

	return {
		generatedAt: input.now ? input.now() : Date.now(),
		self_id: selfId,
		servers: servers.map((s) => {
			const e = inv.get(s.id) || {}
			return { id: s.id, name: s.name || s.id, self: !!s.self, online: s.self ? true : s.online === true, known: !!e.known,
				reason: e.known ? '' : e.reason || 'unknown', files: e.known ? (e.files || []).length : null,
				free_bytes: e.head?.free_bytes ?? null, on_air: e.head?.on_air ?? null }
		}),
		files: outFiles,
		looks: [...looks.values()],
		elsewhere,
		elsewhere_truncated: truncated,
		summary: {
			missing_files: outFiles.filter((f) => f.missing_on.length).length,
			missing_bytes: missingBytes,
			differs_files: outFiles.filter((f) => f.differs_on.length).length,
			unknown_servers: [...unknownServers].sort(),
			by_server: byServer,
			to_send: { transfers: toSend.transfers, files: toSend.files.size, bytes: toSend.bytes },
		},
	}
}

/** Every known server's files by match key → Map(key → Map(server id → { p, id, s, m })). */
function libraryIndex(servers, inventory) {
	const byKey = new Map()
	for (const s of servers) {
		const e = inventory(s.id)
		if (!e?.known) continue
		for (const f of e.files || []) {
			const k = keyOf(f.id || f.p)
			if (!byKey.has(k)) byKey.set(k, new Map())
			if (!byKey.get(k).has(s.id)) byKey.get(k).set(s.id, f)
		}
	}
	return byKey
}

/** The copy to send to `target` from `holders` (Map server → file): newest mtime, then self, master, lowest id. */
function pickSource(holders, target, { selfId = '', masterId = '' } = {}) {
	const rank = (a, b) =>
		b.f.m - a.f.m || (a.id === selfId ? -1 : b.id === selfId ? 1 : 0) || (a.id === masterId ? -1 : b.id === masterId ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
	return [...(holders || new Map())].map(([id, f]) => ({ id, f })).filter((h) => h.id !== target).sort(rank)[0] || null
}

/** Every file any known server has → [{ id, path, size, on }] sorted by id (GET /api/cluster/media-library). */
function sharedLibrary(servers, inventory) {
	const byKey = new Map()
	for (const s of servers) {
		const e = inventory(s.id)
		if (!e?.known) continue
		for (const f of e.files || []) {
			const k = keyOf(f.id || f.p)
			if (!byKey.has(k)) byKey.set(k, { id: f.id, path: f.p, size: f.s, on: [] })
			byKey.get(k).on.push(s.id)
		}
	}
	return [...byKey.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, v]) => ({ ...v, on: v.on.sort() }))
}

/**
 * Take answer field (contract 5): what of look `sceneId` is missing on the boxes that output screen `mainIdx`, from the
 * last computed needs (never computed here: a take does not wait for the network) → [{ id, server, server_name }].
 */
function mediaMissingForTake(needs, sceneId, mainIdx) {
	const l = needs?.looks?.find((x) => x.id === String(sceneId || ''))
	if (!l) return []
	const out = []
	for (const m of l.missing) {
		if (m.screen !== Number(mainIdx)) continue
		if (!out.some((x) => x.id === m.file && x.server === m.server)) out.push({ id: m.file, server: m.server, server_name: m.server_name })
	}
	return out
}

module.exports = { computeNeeds, sharedLibrary, libraryIndex, pickSource, mediaMissingForTake, MTIME_SLACK_S }
