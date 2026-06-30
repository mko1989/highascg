'use strict'

const { getDisplayDetails, getGpuConnectorInventory } = require('../utils/hardware-info')
const { buildGpuPhysicalMap } = require('../utils/gpu-physical-map')
const { calculateLayoutPositions, checkXrandrLayout } = require('../utils/os-config')
const { plannedHeadsFromLayout } = require('../utils/xrandr-layout-verify')

function isPseudoGpuConnectorName(name) {
	const s = String(name || '').trim().toLowerCase()
	if (!s) return true
	if (/^card\d+($|[\s:])/.test(s)) return true
	if (/^gpu\d+($|[\s:])/.test(s)) return true
	if (/^renderd\d+($|[\s:])/.test(s)) return true
	return false
}

/**
 * GPU connector map + xrandr summary for support bundle (WO-67).
 * @param {object} ctx
 */
async function buildGpuDisplaySnapshot(ctx) {
	const config = ctx?.config || {}
	const displays = getDisplayDetails() || []
	const connectors = (getGpuConnectorInventory() || []).filter(
		(c) => !isPseudoGpuConnectorName(c?.shortName || c?.name),
	)
	const layout = calculateLayoutPositions(config)
	const xrandrCheck = checkXrandrLayout(config)

	let physicalMap = null
	try {
		physicalMap = buildGpuPhysicalMap({
			config,
			displays,
			connectors,
		})
	} catch (e) {
		physicalMap = { error: e instanceof Error ? e.message : String(e) }
	}

	let gpuLayout = null
	try {
		const { handleGpuLayoutGet } = require('../api/system-hardware-gpu-layout')
		const res = await handleGpuLayoutGet()
		if (res?.body) gpuLayout = JSON.parse(String(res.body))
	} catch (e) {
		gpuLayout = { error: e instanceof Error ? e.message : String(e) }
	}

	let bootXrandr = null
	try {
		const { readBootXrandrSnapshot, resolveBootXrandrQueryPath } = require('../utils/boot-xrandr-snapshot')
		const snap = readBootXrandrSnapshot()
		bootXrandr = snap
			? { path: snap.path, capturedAt: snap.meta?.capturedAt || null, lineCount: String(snap.raw || '').split('\n').length }
			: { path: resolveBootXrandrQueryPath(), missing: true }
	} catch (e) {
		bootXrandr = { error: e instanceof Error ? e.message : String(e) }
	}

	let plannedCustomModes = null
	try {
		const { REPO_ROOT } = require('../repo-paths')
		const fs = require('fs')
		const metaPath = require('path').join(REPO_ROOT, 'data', 'runtime', 'xrandr-custom-modes-last-apply.json')
		if (fs.existsSync(metaPath)) {
			plannedCustomModes = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
		} else {
			plannedCustomModes = { missing: true, path: metaPath }
		}
	} catch (e) {
		plannedCustomModes = { error: e instanceof Error ? e.message : String(e) }
	}

	const screenBindings = {}
	for (let n = 1; n <= 8; n++) {
		const sysId = config[`screen_${n}_system_id`]
		if (sysId) {
			screenBindings[`screen_${n}`] = {
				systemId: sysId,
				osMode: config[`screen_${n}_os_mode`] || null,
				osBackend: config[`screen_${n}_os_backend`] || null,
				osRate: config[`screen_${n}_os_rate`] || null,
			}
		}
	}

	return {
		collectedAt: new Date().toISOString(),
		displays: displays.map((d) => ({
			name: d.name,
			resolution: d.resolution,
			refreshHz: d.refreshHz,
			connected: d.connected,
			x: d.x,
			y: d.y,
		})),
		connectors,
		physicalMap,
		plannedHeads: plannedHeadsFromLayout(layout),
		xrandr: {
			ok: !!xrandrCheck.ok,
			mismatches: xrandrCheck.mismatches || [],
			actual: xrandrCheck.actual || [],
		},
		gpuLayout,
		bootXrandr,
		plannedCustomModes,
		gpuPhysicalTopology: config.gpuPhysicalTopology || null,
		screenBindings,
		multiview: {
			systemId: config.multiview_system_id || null,
			osMode: config.multiview_os_mode || null,
			osBackend: config.multiview_os_backend || null,
		},
	}
}

module.exports = { buildGpuDisplaySnapshot }
