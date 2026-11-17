'use strict'

/**
 * WO-1029 phase 2a — the server-side deps of destination-ownership.js (kept out of routes-cluster.js, like
 * shared-show-ctx.js): this server's destinations / channels / cables, the linked servers' device views, the master view,
 * the fan-out report and plan, the signed call.
 */

/** This server's destinations, channels and cables (the fan-out plan and destination ownership read the same). */
function ownView(ctx) {
	const { normalizeScreenDestinations } = require('../config/screen-destinations')
	const { buildChannelMap } = require('../config/channel-map-from-ctx')
	const { normalizeDeviceGraph } = require('../config/device-graph')
	return {
		graph: normalizeDeviceGraph(ctx.config?.deviceGraph),
		screenDestinations: normalizeScreenDestinations(ctx.config?.screenDestinations),
		live: { caspar: { channelMap: buildChannelMap(ctx) } },
	}
}

/**
 * WO-1106 C25: what the view is built from, compared by identity — every config write replaces a slice object
 * (device-view CRUD, settings, shared destinations, `Object.assign(ctx.config, cm.get())`), the switcher bus map and
 * Caspar's INFO CONFIG are replaced when they change. A list of references: no hashing, no copy.
 */
function revisionOf(ctx) {
	const c = ctx?.config || null
	const out = [c, ctx?.switcherOutputBusByChannel, ctx?.gatheredInfo?.infoConfig]
	if (c) for (const k of Object.keys(c)) out.push(k, c[k])
	return out
}

const sameRevision = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * WO-1106 C25: ownView cached per config revision — the AMCP gate asks on every line a follower sends (destination-
 * ownership.js `verdict` / `cwc`), and the view (device graph + channel map) used to be rebuilt each time. Rebuilt when a
 * slice changed (revisionOf), when invalidateOwnView runs (a local Devices write: cluster-device-view.js localChanged;
 * every cluster poll: destination-ownership.js refresh — catches a slice edited in place), never more.
 */
function cachedOwnView(ctx) {
	const rev = revisionOf(ctx)
	const c = ctx._clusterOwnView
	if (c && sameRevision(c.rev, rev)) return c.view
	const view = ownView(ctx)
	ctx._clusterOwnView = { rev, view }
	return view
}

const invalidateOwnView = (ctx) => {
	if (ctx) ctx._clusterOwnView = null
}

/**
 * @param {object} ctx
 * @param {{ cluster: () => object, master: () => object, report: () => object, call: () => object }} get
 */
function ownershipDeps(ctx, get) {
	return {
		selfId: () => get.cluster().snapshot().self?.id || '',
		ownView: () => cachedOwnView(ctx), // WO-1106 C25: per config revision
		invalidateOwnView: () => invalidateOwnView(ctx),
		peers: () => get.cluster().snapshot().peers || [],
		peerView: async (id) => {
			const r = await get.cluster().deviceView?.(id)
			return r?.status === 200 ? r.body : null
		},
		master: () => get.master().view(),
		pairEnabled: () => !!require('../config/replication-config').getReplicationConfig(ctx.config).enabled,
		report: get.report(),
		fanout: () => (ctx._clusterFanout ? ctx._clusterFanout.status() : null),
		holder: (id) => ctx._clusterFanout?.holder(id) || '',
		call: (id, action, args, o) => get.call().call(id, action, args, o),
		log: ctx.log,
	}
}

module.exports = { ownView, invalidateOwnView, ownershipDeps }
