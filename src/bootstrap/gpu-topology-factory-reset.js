'use strict'

const { getGpuModel, invalidateXrandrCache } = require('../utils/hardware-info')
const { resolveDefaultTopologyForGpu } = require('../utils/known-gpu-topology')
const { ensureGpuPhysicalTopologyFromXrandr } = require('../utils/gpu-topology-xrandr')

/**
 * After factory reset: drop operator-saved GPU bracket map and re-sync from live probes.
 * @param {{ get: () => object, save: (c: object, opts?: object) => boolean }} configManager
 * @param {(level: string, msg: string) => void} [log]
 * @returns {boolean}
 */
function resetGpuPhysicalTopologyForFactoryReset(configManager, log) {
	if (!configManager || typeof configManager.get !== 'function' || typeof configManager.save !== 'function') {
		return false
	}
	try {
		invalidateXrandrCache()
		const base = { ...configManager.get() }
		base.gpuPhysicalTopologyOperatorSaved = false
		base.gpuPhysicalTopology = resolveDefaultTopologyForGpu(getGpuModel())
		configManager.save(base, { emitChange: false })
		const synced = configManager.get()
		ensureGpuPhysicalTopologyFromXrandr({
			config: synced,
			configManager,
			log,
		})
		return true
	} catch (e) {
		if (typeof log === 'function') {
			log('warn', `[gpu-topology] factory reset GPU layout sync failed: ${e?.message || e}`)
		}
		return false
	}
}

module.exports = { resetGpuPhysicalTopologyForFactoryReset }
