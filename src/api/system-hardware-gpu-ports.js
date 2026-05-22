/**
 * POST /api/system/gpu-ports-reset — xrandr HDMI/DP pair hints for GPU inspector (WO-39).
 */

'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')
const { discoverGpuPhysicalTopologyFromXrandr } = require('../utils/gpu-topology-xrandr')

function handleGpuPortsReset() {
	const topology = discoverGpuPhysicalTopologyFromXrandr()
	const pairs = (topology || []).map((row) => {
		const dpA = row.dpA || ''
		const dpB = row.dpB || ''
		const prefix = (dpA.split('-')[0] || 'DP').toUpperCase()
		const nums = [dpA, dpB].filter(Boolean).map((x) => x.split('-')[1]).join('/')
		return {
			id: row.physicalPortId,
			label: nums ? `${prefix} ${nums}` : row.physicalPortId,
			pairs: [dpA, dpB].filter(Boolean),
			type: prefix.toLowerCase() === 'HDMI' ? 'hdmi' : 'dp',
		}
	})

	while (pairs.length < 4) {
		const idx = pairs.length * 2
		pairs.push({
			id: `gpu_p${pairs.length}`,
			label: `None ${idx}/${idx + 1}`,
			pairs: [],
			type: 'dp',
		})
	}

	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, pairs }) }
}

module.exports = {
	handleGpuPortsReset,
}
