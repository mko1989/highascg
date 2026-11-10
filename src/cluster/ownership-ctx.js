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
 * @param {object} ctx
 * @param {{ cluster: () => object, master: () => object, report: () => object, call: () => object }} get
 */
function ownershipDeps(ctx, get) {
	return {
		selfId: () => get.cluster().snapshot().self?.id || '',
		ownView: () => ownView(ctx),
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

module.exports = { ownView, ownershipDeps }
