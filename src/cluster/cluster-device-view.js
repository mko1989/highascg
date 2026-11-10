'use strict'

/**
 * WO-1029 plan 06 S3 / S4 — ONE Devices view for every linked server, built node-side (the client stays on its own
 * node, WO-802):
 *
 *   GET /api/cluster/device-view[?fresh=1]   (routes-cluster-devices.js; ETag / 304: poll every few seconds cheaply)
 *   → { self, master, destinations: { list, sharing }, servers: [ServerView] }
 *   ServerView = { id, name, self, master, online, stale, at, age_ms, editable, degraded, error, caps,
 *     connectors, cables, orphanCables, mappingNodes, hostChannels, operatorGui, liveInputs, destinationIds }
 *   Every connector / cable / mapping node / host channel / operator GUI / live input carries `server` (its server id)
 *   and `key` = `<server>/<id>` (connector ids are the same on every box: gpu_p0, dlsdi_1 …). A cable belongs to the
 *   server whose graph holds it; `destId` names the destination a `dst_in_<id>` cable carries.
 *   Live inputs: `{ server, input: 'decklink:<slot>' | 'ndi_host:<sourceId>' | … (live-input-key.js), label, kind,
 *   channel, layer }` — the channel is that server's today, for display only.
 *   `stale`: the server is offline or did not answer: its last known view is served with its age; never dropped while
 *   the server is linked. `editable`: online and its view fresh (a write goes through the relay). `degraded`: it runs a
 *   build without 'unified-devices' (no shared destination list there, no DEST_UNKNOWN_HERE: today's behaviour).
 *
 * Writes are addressed per server: this server = its own /api/device-view (or /api/settings); a linked one =
 * /api/cluster/peers/:id/relay/api/device-view. After a 2xx relayed write (`relayWrote`) the node drops its cached
 * view of that server (cluster-peers.js and here), refreshes the destination owners (dest-owners.js: GET /api/cluster
 * owners, the apply plan, the media needs see a new cable at once), and broadcasts WS `cluster:devices { id }`.
 * A write made on a server itself reaches the others by the signed info `devices.changed` (localChanged).
 */

const crypto = require('crypto')
const { inputKeyOfConnector, inputKeyOfEntry, inputKeyOfSource } = require('../config/live-input-key')

const CAP = 'unified-devices'
const SELF_TTL_MS = 2000
const WRITE_PATHS = /^\/api\/(device-view|settings|caspar-config|screens|channels-cabled)(\/|\?|$)/
const tag = (server, x, id = x?.id) => ({ ...x, server, key: `${server}/${id}` })
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')

/** One server's device view (the /api/device-view body) → its tagged parts. */
function serverParts(id, view) {
	const g = view?.graph || {}
	const dests = Array.isArray(view?.screenDestinations?.destinations) ? view.screenDestinations.destinations : []
	const connectors = (g.connectors || []).filter((c) => c?.kind !== 'destination_in').map((c) => tag(id, c))
	const cable = (e) => {
		const src = String(e?.sourceId || '')
		const conn = (g.connectors || []).find((c) => c?.id === src && c.kind === 'destination_in')
		return { ...tag(id, e), destId: src.startsWith('dst_in_') ? String(conn?.externalRef || src.slice(7)) : '' }
	}
	const mapping = (g.devices || []).filter((d) => d?.role === 'pixel_mapping')
	const cabledTo = (destId) => (g.edges || []).filter((e) => cable(e).destId === destId).map((e) => e.sinkId)
	return {
		connectors,
		cables: (g.edges || []).map(cable),
		orphanCables: (g.orphanEdges || []).map(cable),
		mappingNodes: mapping.map((d) => ({ ...tag(id, d), connectors: (g.connectors || []).filter((c) => c?.deviceId === d.id).map((c) => c.id) })),
		hostChannels: dests.filter((d) => d?.mode === 'host_channel').map((d) => tag(id, d)),
		operatorGui: dests.filter((d) => d?.mode === 'operator_gui').map((d) => ({ ...tag(id, d), cabledTo: cabledTo(d.id) })),
		liveInputs: liveInputs(id, view),
		destinationIds: dests.map((d) => d.id),
	}
}

/** Each live input once, by its stable key: the routing map's input rows, DeckLinks set to input, extra live sources. */
function liveInputs(server, view) {
	const out = new Map()
	const add = (input, x) => input && !out.has(input) && out.set(input, { server, input, key: `${server}/${input}`, ...x })
	for (const e of view?.live?.caspar?.channelMap?.inputChannels || [])
		add(inputKeyOfEntry(e), { kind: e.kind, label: e.label || '', channel: e.channel ?? null, layer: e.layer ?? null })
	for (const c of view?.graph?.connectors || []) add(inputKeyOfConnector(c), { kind: 'decklink', label: c.label || c.id, channel: null, layer: null })
	for (const s of view?.extraLiveSources || []) add(inputKeyOfSource(s), { kind: String(s.routeType || ''), label: s.label || '', channel: s.hostChannel ?? s.inputsChannel ?? null, layer: s.hostLayer ?? s.inputsLayer ?? null })
	return [...out.values()]
}

/**
 * @param {{ selfId: () => string, selfName: () => string, peers: () => Array<object>, masterId: () => string,
 *   ownView: () => Promise<object|null>, peerView: (id: string) => Promise<{ status: number, body: object }>,
 *   dropPeerView?: (id: string) => void, refreshOwners?: () => Promise<void>, sharing?: () => object,
 *   broadcast?: (type: string, data: object) => void, notifyPeers?: () => void, now?: () => number }} deps
 */
function createClusterDeviceView(deps) {
	const now = deps.now || Date.now
	const views = new Map() // server id → { at, data, sig, error, failed }
	let selfAt = 0
	let asked = 0 // the background refresh runs only while a client polls the view (it builds the live snapshot)

	async function load(id, isSelf, fresh) {
		const prev = views.get(id)
		if (isSelf && !fresh && prev && now() - selfAt < SELF_TTL_MS) return
		let data = null
		let error = ''
		try {
			if (isSelf) data = await deps.ownView()
			else {
				if (fresh) deps.dropPeerView?.(id)
				const r = await deps.peerView(id)
				if (r?.status === 200) data = r.body
				else error = r?.body?.error || `HTTP ${r?.status}`
			}
		} catch (e) {
			error = String(e?.message || e)
		}
		if (isSelf) selfAt = now()
		if (!data) return views.set(id, { ...(prev || { at: 0, data: null, sig: '' }), error, failed: true })
		const sig = md5(JSON.stringify(data.graph || {}) + JSON.stringify(data.screenDestinations || {}) + JSON.stringify(data.extraLiveSources || []))
		views.set(id, { at: now(), data, sig, error: '', failed: false })
		if (prev && prev.sig && prev.sig !== sig) deps.broadcast?.('cluster:devices', { id })
	}

	/** Refresh every server (offline ones keep their last view) → the combined body. */
	async function build({ fresh = false } = {}) {
		const selfId = deps.selfId() || 'self'
		const peers = deps.peers() || []
		for (const id of [...views.keys()]) if (id !== selfId && !peers.some((p) => p.id === id)) views.delete(id) // unlinked
		await Promise.all([load(selfId, true, fresh), ...peers.filter((p) => p.online).map((p) => load(p.id, false, fresh))])
		const masterId = deps.masterId() || ''
		const servers = [{ id: selfId, name: deps.selfName() || 'this server', self: true, online: true, caps: [] }, ...peers.map((p) => ({ id: p.id, name: p.name || p.hostname || p.id, self: false, online: p.online === true, caps: p.caps || [] }))].map((s) => {
			const v = views.get(s.id)
			const stale = !v?.data || !s.online || !!v.failed
			return {
				...s,
				master: s.id === masterId || (s.self && masterId === 'self'),
				stale,
				at: v?.at ? new Date(v.at).toISOString() : null,
				age_ms: v?.at ? Math.max(0, now() - v.at) : null,
				editable: !stale,
				degraded: !s.self && !s.caps.includes(CAP),
				error: !s.online ? 'offline' : v?.error || '',
				...serverParts(s.id, v?.data),
			}
		})
		const own = views.get(selfId)?.data
		const list = (own?.screenDestinations?.destinations || []).filter((d) => d?.mode !== 'operator_gui' && d?.mode !== 'host_channel')
		return { self: selfId, master: masterId, destinations: { list, sharing: deps.sharing?.() || null }, servers }
	}

	/** → { status, etag, body } (304 when `ifNoneMatch` matches: the ETag leaves out the ages). */
	async function get({ fresh = false, ifNoneMatch = '' } = {}) {
		asked = now()
		const body = await build({ fresh })
		const etag = `"${md5(JSON.stringify(body, (k, v) => (k === 'age_ms' || k === 'at' ? undefined : v)))}"`
		if (ifNoneMatch && String(ifNoneMatch).trim() === etag) return { status: 304, etag }
		return { status: 200, etag, body: { generatedAt: new Date(now()).toISOString(), ...body } }
	}

	/** A server's view changed (a relayed write, its `devices.changed`): forget it, owners again, tell the clients. */
	async function invalidate(id) {
		if (!id) return
		deps.dropPeerView?.(id)
		if (id === deps.selfId()) selfAt = 0
		try {
			await deps.refreshOwners?.()
		} catch {
			/* the next poll refreshes them */
		}
		deps.broadcast?.('cluster:devices', { id })
	}

	return { get, build, invalidate, refresh: () => (asked && now() - asked < 60000 ? build().then(() => undefined) : Promise.resolve()) }
}

/** The process' combined view (null while the cluster never started here). */
function deviceViewOf(ctx) {
	if (ctx?._clusterDeviceView) return ctx._clusterDeviceView
	if (!ctx?._cluster) return null
	const rc = require('../api/routes-cluster')
	ctx._clusterDeviceView = createClusterDeviceView({
		selfId: () => rc.clusterOf(ctx).snapshot().self?.id || 'self',
		selfName: () => rc.clusterOf(ctx).snapshot().self?.hostname || '',
		peers: () => rc.clusterOf(ctx).snapshot().peers,
		masterId: () => {
			const v = rc.masterOf(ctx).view()
			return v.is_master ? rc.clusterOf(ctx).snapshot().self?.id || 'self' : v.master_id || ''
		},
		ownView: async () => {
			const r = await require('../api/routes-device-view').handleGet('/api/device-view', ctx, {}, null)
			return r?.status === 200 ? JSON.parse(r.body) : null
		},
		peerView: (id) => rc.clusterOf(ctx).deviceView(id),
		dropPeerView: (id) => rc.clusterOf(ctx).dropView?.(id),
		refreshOwners: async () => {
			const idx = require('./dest-owners').ownerIndexOf(ctx)
			if (!idx) return
			await idx.refresh() // one in flight may have read the old view: once more, from the fresh cache
			await idx.refresh()
		},
		sharing: () => require('./shared-show-dests-ctx').destsOf(ctx)?.view() || null,
		broadcast: (type, data) => typeof ctx._wsBroadcast === 'function' && ctx._wsBroadcast(type, data),
	})
	return ctx._clusterDeviceView
}

/** cluster-relay.js hook: a relayed request answered → after a 2xx write the view of that server is fresh again. */
async function relayWrote(ctx, id, method, path, status) {
	if (method === 'GET' || !(status >= 200 && status < 300) || !WRITE_PATHS.test(String(path || ''))) return
	const v = deviceViewOf(ctx)
	if (v) await Promise.race([v.invalidate(id), new Promise((r) => setTimeout(r, 3000).unref?.())])
}

let notifyTimer = null
/**
 * device-view-crud-save.js hook: this server's own Devices config was written. Clients hear `cluster:devices` for this
 * server; linked servers with CAP hear the signed info `devices.changed` and drop their copy (debounced: one CRUD
 * saves several slices).
 */
function localChanged(ctx) {
	if (!ctx?._cluster || notifyTimer) return
	notifyTimer = setTimeout(() => {
		notifyTimer = null
		const rc = require('../api/routes-cluster')
		const selfId = rc.clusterOf(ctx).snapshot().self?.id || 'self'
		void deviceViewOf(ctx)?.invalidate(selfId)
		for (const p of rc.clusterOf(ctx).snapshot().peers.filter((x) => x.online && (x.caps || []).includes(CAP)))
			void rc.callOf(ctx).call(p.id, 'devices.changed', {}, { quiet: true }).catch(() => {})
	}, 100)
	notifyTimer.unref?.()
}

/** The signed-call infos of the unified Devices view (+ the shared destination list), for routes-cluster.js callOf. */
function clusterInfo(ctx) {
	return {
		'devices.changed': async (_args, peer) => {
			await deviceViewOf(ctx)?.invalidate(peer?.id)
			return { status: 200, body: { ok: true } }
		},
		...require('./shared-show-dests-ctx').destsInfo(ctx),
	}
}

/** After every cluster poll: the shared destination list, then the combined view (WS on change). */
async function afterPoll(ctx) {
	await require('./shared-show-dests-ctx').destsOf(ctx)?.tick()
	await deviceViewOf(ctx)?.refresh()
}

module.exports = { createClusterDeviceView, liveInputs, deviceViewOf, relayWrote, localChanged, clusterInfo, afterPoll, CAP }
