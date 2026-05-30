/**
 * POST /api/system/gpu-ports-reset — xrandr HDMI/DP pair hints for GPU inspector (WO-39).
 */

'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')
const { discoverGpuPhysicalTopology } = require('../utils/gpu-topology-drm')

function handleGpuPortsReset() {
	const probe = discoverGpuPhysicalTopology({})
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

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, pairs, source: probe?.source || null, cards: probe?.cards || [] }),
	}
}

module.exports = {
	handleGpuPortsReset,
}
