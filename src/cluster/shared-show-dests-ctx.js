'use strict'

/**
 * WO-1029 plan 06 S1 / S5 / S6 — the shared destination list (shared-show-dests.js) wired to this server: the live
 * `screenDestinations` / `deviceGraph` config, the guard a taken list goes through, the CRUD hook.
 *
 *   guardIncoming(config, incoming, tombs)  pure: the list this server keeps when it takes `incoming`
 *     - this server's operator GUI entries stay, at their own positions (S1); an incoming one is dropped (only a
 *       server with none takes it: an older master's list is the only source it has)
 *     - a destination missing from `incoming` and cabled here (destination-cabling.js cabledHere) is kept and
 *       reported `{ conflict: 'cabled here', destId, label }` unless its id is tombstoned (an explicit delete, D7)
 *     - an empty incoming list without tombstones never empties a server that has destinations ('empty list')
 *   takeList(ctx, incoming, tombs)  applies it: explicit deletes go through the Devices remove (DeckLinks released,
 *     cables pruned), tombstoned ids already gone here lose their orphan cables (S6 pending clean-up)
 *   destsOf(ctx)  the process' instance; localDestEdit(ctx, op) the CRUD hook; destsInfo(ctx) the signed-call infos
 */

const { createSharedDests } = require('./shared-show-dests')

const isOpGui = (d) => d?.mode === 'operator_gui'
/** Never in the shared list: the operator GUI (S1) and host channels (a live input on THIS server's Caspar channel). */
const localOnly = (d) => isOpGui(d) || d?.mode === 'host_channel'

function destinationsOf(config) {
	return require('../config/screen-destinations').normalizeScreenDestinations(config?.screenDestinations).destinations
}

/** This server's shared part of the list (no operator GUI). */
const sharedList = (config) => destinationsOf(config).filter((d) => !localOnly(d))

function guardIncoming(config, incoming, tombs = []) {
	const { cabledHere } = require('../config/destination-cabling')
	const cur = destinationsOf(config)
	const dead = new Set(tombs.map(String))
	const all = (Array.isArray(incoming) ? incoming : []).filter((d) => d && typeof d.id === 'string' && !dead.has(d.id))
	const inc = all.filter((d) => !localOnly(d))
	const own = cur.map((d, i) => ({ d, i })).filter((x) => localOnly(x.d))
	const inIds = new Set(inc.map((d) => d.id))
	const conflicts = []
	const explicit = []
	const keep = []
	const curShared = cur.filter((d) => !localOnly(d))
	if (!inc.length && !dead.size && curShared.length) {
		return { list: cur, conflicts: [{ conflict: 'empty list', destId: '' }], explicit, changed: false }
	}
	for (const d of curShared) {
		if (inIds.has(d.id)) continue
		if (dead.has(d.id)) explicit.push(d.id)
		else if (cabledHere(config, d.id)) {
			keep.push(d)
			conflicts.push({ conflict: 'cabled here', destId: d.id, label: d.label || d.id })
		}
	}
	const list = [...inc, ...keep]
	// this server's own operator GUI / host channels at their own positions; only a server with no operator GUI takes
	// an incoming one (an older master's list is the only source it has), at most one (WO-243)
	const places = own.some((x) => isOpGui(x.d)) ? own : [...all.filter(isOpGui).slice(0, 1).map((d) => ({ d, i: 0 })), ...own]
	for (const { d, i } of places) list.splice(Math.min(i, list.length), 0, d)
	return { list, conflicts, explicit, changed: true }
}

function save(ctx, patch) {
	require('../api/device-view-crud-save').saveConfig(ctx, patch)
}

function announce(ctx) {
	if (typeof ctx._wsBroadcast !== 'function') return
	try {
		ctx._wsBroadcast('change', { path: 'channelMap', value: require('../config/channel-map-from-ctx').buildChannelMap(ctx) })
	} catch {
		/* the take itself stands */
	}
}

/** Take a list from the writer → { conflicts, pruned }. */
function takeList(ctx, incoming, tombs = []) {
	const { normalizeScreenDestinations } = require('../config/screen-destinations')
	const { stableJson } = require('./cluster-call')
	const crud = require('../api/device-view-crud')
	const g = guardIncoming(ctx.config, incoming, tombs)
	const pruned = []
	for (const id of g.explicit) {
		crud.removeDestinationHere(ctx, id) // S6: the explicit delete reached this server — its cables go with it
		pruned.push(id)
	}
	let touched = g.explicit.length > 0
	if (g.changed) {
		const next = normalizeScreenDestinations({ ...normalizeScreenDestinations(ctx.config?.screenDestinations), destinations: g.list.filter((d) => !g.explicit.includes(d.id)) })
		if (stableJson(next) !== stableJson(normalizeScreenDestinations(ctx.config?.screenDestinations))) {
			ctx.config.screenDestinations = next
			save(ctx, { screenDestinations: next })
			touched = true
		}
	}
	// S6: a delete this server missed (offline): its cables are orphans here — deleted now that the list confirms it
	const { normalizeDeviceGraph, pruneDestinationFromGraph } = require('../config/device-graph')
	const here = new Set(destinationsOf(ctx.config).map((d) => d.id))
	let graph = normalizeDeviceGraph(ctx.config?.deviceGraph)
	const before = stableJson(graph)
	for (const id of tombs) {
		if (here.has(id) || g.explicit.includes(id)) continue
		const next = pruneDestinationFromGraph(graph, id)
		if ((next.edges || []).length !== (graph.edges || []).length) pruned.push(id)
		graph = next
	}
	if (stableJson(graph) !== before) {
		ctx.config.deviceGraph = graph
		save(ctx, { deviceGraph: graph })
		ctx.log?.('info', `[cluster] destinations: removed the cables of deleted destination(s) ${pruned.join(', ')}`)
		touched = true
	}
	if (touched) announce(ctx)
	return { conflicts: g.conflicts, pruned }
}

/** The writer applies proposed ops to its own live list. */
function applyOps(ctx, ops) {
	const { normalizeScreenDestinations } = require('../config/screen-destinations')
	for (const op of ops) {
		if (op.remove) {
			if (destinationsOf(ctx.config).some((d) => d.id === op.remove)) require('../api/device-view-crud').removeDestinationHere(ctx, op.remove)
			continue
		}
		const top = normalizeScreenDestinations(ctx.config?.screenDestinations)
		const i = top.destinations.findIndex((d) => d.id === op.upsert.id)
		if (i >= 0) top.destinations[i] = { ...op.upsert }
		else {
			const at = Number.isInteger(op.index) ? Math.max(0, Math.min(op.index, top.destinations.length)) : top.destinations.length
			top.destinations.splice(at, 0, { ...op.upsert })
		}
		const next = normalizeScreenDestinations(top)
		ctx.config.screenDestinations = next
		save(ctx, { screenDestinations: next })
	}
	announce(ctx)
}

/** The process' shared destination list (null while the cluster never started here: nothing is linked). */
function destsOf(ctx) {
	if (ctx?._clusterDests) return ctx._clusterDests
	if (!ctx?._cluster) return null
	const rc = require('../api/routes-cluster')
	const identity = require('../system/device-identity')
	const { fingerprint } = require('./cluster-media')
	const persistence = ctx.persistence || require('../utils/persistence')
	ctx._clusterDests = createSharedDests({
		store: persistence,
		selfFp: () => fingerprint(identity.getDevicePublicKeyPem()),
		claim: () => rc.masterOf(ctx).claim(),
		peers: () => rc.clusterOf(ctx).snapshot().peers,
		call: (id, action, args, o) => rc.callOf(ctx).call(id, action, args, o),
		list: () => sharedList(ctx.config),
		take: (list, tombs) => takeList(ctx, list, tombs),
		applyOps: (ops) => applyOps(ctx, ops),
		pairEnabled: () => !!require('../config/replication-config').getReplicationConfig(ctx.config).enabled,
		broadcast: (type, data) => typeof ctx._wsBroadcast === 'function' && ctx._wsBroadcast(type, data),
		log: ctx.log,
	})
	return ctx._clusterDests
}

/** CRUD hook (device-view-crud.js): null when nothing is shared, else { writer, sent, pending }. */
function localDestEdit(ctx, op) {
	try {
		return destsOf(ctx)?.localEdit(op) || null
	} catch (e) {
		ctx?.log?.('warn', `[cluster] destinations: ${e?.message || e}`)
		return null
	}
}

/** The signed-call infos (resolved at call time: building them never starts anything). */
function destsInfo(ctx) {
	const missing = () => ({ status: 409, body: { error: 'nothing linked here' } })
	return {
		'dests.push': (args, peer, meta) => (destsOf(ctx) ? destsOf(ctx).info['dests.push'](args, withFp(peer), meta) : missing()),
		'dests.propose': (args, peer, meta) => (destsOf(ctx) ? destsOf(ctx).info['dests.propose'](args, withFp(peer), meta) : missing()),
	}
}
const withFp = (peer) => (peer && !peer.fp && peer.device_key ? { ...peer, fp: require('./cluster-media').fingerprint(peer.device_key) } : peer)

module.exports = { guardIncoming, takeList, applyOps, sharedList, destsOf, localDestEdit, destsInfo }
