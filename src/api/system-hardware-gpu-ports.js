/**
 * POST /api/system/gpu-ports-reset — rediscover GPU port pairs (WO-39, WO-108).
 * Body: `{ persist?: boolean }` — when true, writes discovered topology to server config.
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { discoverGpuPhysicalTopology } = require('../utils/gpu-topology-drm')

function handleGpuPortsReset(body, ctx) {
	const parsed = parseBody(body) || {}
	const persist = parsed.persist === true
	const probe = discoverGpuPhysicalTopology({ config: ctx?.config || {} })
	const topology = probe?.rows || []
	const pairs = topology.map((row) => {
		const dpA = row.dpA || ''
		const dpB = row.dpB || ''
		const ports = [dpA, dpB].filter(Boolean)
		const prefix = (dpA.split('-')[0] || 'DP').toUpperCase()
		const nums = ports.map((x) => x.replace(/^[^-]+-/, '')).join('/')
		const type = prefix === 'HDMI' || prefix === 'HDMI-A' ? 'hdmi' : prefix === 'EDP' ? 'edp' : 'dp'
		const cardTag = row.drmCard ? `${row.drmCard.replace(/^card/i, 'C')}.` : ''
		return {
			id: row.physicalPortId,
			label: `${cardTag}${nums ? `${prefix} ${nums}` : row.physicalPortId}`,
			pairs: ports,
			type,
			drmCard: row.drmCard || '',
			drmName: row.drmName || '',
		}
	})

	let persisted = false
	if (persist && topology.length && ctx?.configManager) {
		const cm = ctx.configManager
		const config = cm.get()
		config.gpuPhysicalTopology = topology.map((row) => ({ ...row }))
		config.gpuPhysicalTopologyOperatorSaved = true
		cm.save(config)
		persisted = true
	}

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			ok: true,
			pairs,
			topology,
			source: probe?.source || null,
			cards: probe?.cards || [],
			persisted,
		}),
	}
}

module.exports = {
	handleGpuPortsReset,
}
