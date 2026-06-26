'use strict'

const { destinationsFromConfig } = require('../config/screen-destinations')
const { pickGpuOutLayoutSysId } = require('./xrandr-output-resolve')
const { hasOperatorOsLayoutOverride, readScreenSetting } = require('./os-layout-calculator-helpers')

/**
 * Collect GPU output assignments from operator overrides and device graph.
 * @param {object} config
 */
function collectGpuLayoutAssignments(config) {
	const cs = config.casparServer && typeof config.casparServer === 'object' ? config.casparServer : {}
	const screenCount = Math.min(16, Math.max(1, parseInt(String(config.screen_count ?? cs.screen_count ?? 1), 10) || 1))
	const swap = !!(config.x11_horizontal_swap === true || config.x11_horizontal_swap === 'true' || config.x11_horizontal_swap === 1 || config.x11_horizontal_swap === '1')

	const allGpuAssignments = new Map()
	const mvAssignments = []
	const explicitScreenAssignments = new Map()
	/** Operator Apply OS / Device View screen_N_* — must survive graph rebuild. */
	const operatorScreenAssignments = new Map()

	for (let n = 1; n <= 8; n++) {
		if (!hasOperatorOsLayoutOverride(config, n)) continue
		const sysId = String(config[`screen_${n}_system_id`] || '').trim()
		const assign = {
			sysId,
			osMode: config[`screen_${n}_os_mode`],
			osBackend: String(config[`screen_${n}_os_backend`] || 'xrandr').trim().toLowerCase(),
			osRate: config[`screen_${n}_os_rate`],
			casparMode: readScreenSetting(config, `screen_${n}_mode`),
			manualX: Number.isFinite(config[`screen_${n}_os_x`]) ? config[`screen_${n}_os_x`] : null,
			manualY: Number.isFinite(config[`screen_${n}_os_y`]) ? config[`screen_${n}_os_y`] : null,
		}
		if (sysId) allGpuAssignments.set(n, assign)
		operatorScreenAssignments.set(n, assign)
	}
	if (config.multiview_system_id) {
		mvAssignments.push({
			sysId: config.multiview_system_id,
			osMode: config.multiview_os_mode,
			osBackend: String(config.multiview_os_backend || 'xrandr').trim().toLowerCase(),
			osRate: config.multiview_os_rate,
			casparMode: cs.multiview_mode,
			manualX: Number.isFinite(config.multiview_os_x) ? config.multiview_os_x : null,
			manualY: Number.isFinite(config.multiview_os_y) ? config.multiview_os_y : null,
		})
	}

	const connectors = Array.isArray(config?.deviceGraph?.connectors) ? config.deviceGraph.connectors : []
	const edges = Array.isArray(config?.deviceGraph?.edges) ? config.deviceGraph.edges : []
	const dests = destinationsFromConfig(config)
	const connectorById = new Map(connectors.map((c) => [String(c?.id || ''), c]))

	const inEdgeSourceKind = (connectorId) => {
		const inEdge = edges.find((e) => e.sinkId === connectorId)
		if (!inEdge) return ''
		const src = connectorById.get(String(inEdge.sourceId || ''))
		return String(src?.kind || '')
	}

	const graphGpuConnectors = connectors.filter(c => c.kind === 'gpu_out' || c.kind === 'gpu_output')
	const graphHasPixelMapToGpu = edges.some((e) => {
		const src = connectorById.get(String(e?.sourceId || ''))
		if (src?.kind !== 'pixel_map_out') return false
		const sink = connectorById.get(String(e?.sinkId || ''))
		return sink?.kind === 'gpu_out' || sink?.kind === 'gpu_output'
	})
	const graphHasDestinationGpuBinding = graphGpuConnectors.some((c) => {
		const inEdge = edges.find((e) => e.sinkId === c.id)
		if (!inEdge) return false
		return String(inEdge.sourceId || '').startsWith('dst_in_')
	})

	if (graphHasDestinationGpuBinding) {
		allGpuAssignments.clear()
		mvAssignments.length = 0
	}

	graphGpuConnectors.forEach(c => {
		if (c.kind !== 'gpu_out' && c.kind !== 'gpu_output') return

		let binding = c.caspar?.outputBinding
		let mainIndex = c.caspar?.mainIndex
		let inferredFromEdge = false
		let edgeDerivedMode = null
		let edgeDerivedMainIndex = null

		const inEdge = edges.find(e => e.sinkId === c.id)
		let boundDest = null
		const edgeKind = inEdge ? inEdgeSourceKind(c.id) : ''
		const fedByPixelMap = edgeKind === 'pixel_map_out'
		if (inEdge) {
			const srcId = String(inEdge.sourceId || '')
			if (srcId.startsWith('dst_in_')) {
				const dstId = srcId.slice('dst_in_'.length)
				boundDest = dests.find(d => d.id === dstId) || null
			}
		}
		if (boundDest) {
			const dMode = String(boundDest.mode || 'pgm_prv').toLowerCase()
			if (dMode === 'multiview') {
				edgeDerivedMode = 'multiview'
			} else if (dMode !== 'stream') {
				edgeDerivedMode = 'screen'
				edgeDerivedMainIndex = Math.max(0, parseInt(String(boundDest.mainScreenIndex ?? 0), 10) || 0)
			}
		}

		if (edgeDerivedMode === 'screen') {
			mainIndex = edgeDerivedMainIndex
			binding = { type: 'screen', index: edgeDerivedMainIndex + 1 }
			inferredFromEdge = true
		} else if (edgeDerivedMode === 'multiview') {
			binding = { type: 'multiview', index: 1 }
			mainIndex = null
			inferredFromEdge = true
		}

		if (!binding && mainIndex == null && boundDest) {
			const dMode = String(boundDest.mode || 'pgm_prv').toLowerCase()
			if (dMode !== 'stream' && dMode !== 'multiview') {
				mainIndex = boundDest.mainScreenIndex
				binding = { type: 'screen', index: (parseInt(String(mainIndex ?? 0), 10) || 0) + 1 }
				inferredFromEdge = true
			}
		}

		const isScreenBinding = binding?.type === 'screen'
		const isLegacyMainIndexOnly = !binding && mainIndex != null
		if ((isScreenBinding || isLegacyMainIndexOnly) && !fedByPixelMap) {
			const n = Math.min(16, Math.max(1, parseInt(String(binding?.index ?? (Number(mainIndex) + 1) ?? 1), 10) || 1))
			const mappedEdge = edgeKind === 'pixel_map_out' || edgeKind === 'destination_in'
			if (isLegacyMainIndexOnly && !mappedEdge && allGpuAssignments.has(n)) return
			if (isLegacyMainIndexOnly && graphHasDestinationGpuBinding && graphHasPixelMapToGpu) return
			const fkResN = `screen_${n}_force_os_resolution`
			const forceOsResForN =
				readScreenSetting(config, fkResN) === true ||
				readScreenSetting(config, fkResN) === 'true' ||
				readScreenSetting(config, fkResN) === 1 ||
				readScreenSetting(config, fkResN) === '1'
			const sysId = forceOsResForN
				? pickGpuOutLayoutSysId(config, c, n)
				: pickGpuOutLayoutSysId(config, c, null)
			if (!sysId) return
			const destMode = boundDest ? String(boundDest.mode || 'pgm_prv').toLowerCase() : ''
			const routableBound =
				boundDest && destMode !== 'multiview' && destMode !== 'stream'
			const casparModeFromBoundDest =
				!forceOsResForN &&
				routableBound &&
				String(boundDest.videoMode || '').trim()
					? String(boundDest.videoMode || '').trim()
					: ''
			const assign = {
				sysId,
				osMode: inferredFromEdge ? '' : config[`screen_${n}_os_mode`] || c.caspar?.mode,
				osBackend: String(config[`screen_${n}_os_backend`] || c.caspar?.osBackend || 'xrandr').trim().toLowerCase(),
				osRate:
					(boundDest && Number.isFinite(Number(boundDest.fps)) && Number(boundDest.fps) > 0
						? Number(boundDest.fps)
						: null) ??
					config[`screen_${n}_os_rate`] ??
					c.caspar?.refreshHz,
				casparMode:
					casparModeFromBoundDest ||
					readScreenSetting(config, `screen_${n}_mode`) ||
					c.caspar?.mode,
				manualX: Number.isFinite(config[`screen_${n}_os_x`]) ? config[`screen_${n}_os_x`] : null,
				manualY: Number.isFinite(config[`screen_${n}_os_y`]) ? config[`screen_${n}_os_y`] : null,
			}
			allGpuAssignments.set(n, assign)
			if (isScreenBinding || inferredFromEdge) explicitScreenAssignments.set(n, assign)
		} else {
			const sysId = pickGpuOutLayoutSysId(config, c, null)
			if (!sysId) return
			if (binding && binding.type && String(binding.type) !== 'screen') {
				for (const [k, v] of allGpuAssignments.entries()) {
					if (String(v?.sysId || '') === sysId) allGpuAssignments.delete(k)
				}
			}
			let mvIndex = null
			if (binding?.type === 'multiview') {
				mvIndex = parseInt(binding.index, 10) || 1
			} else if (inEdge) {
				const srcId = String(inEdge.sourceId || '')
				if (srcId.startsWith('dst_in_')) {
					const dstId = srcId.slice('dst_in_'.length)
					const mvDests = dests.filter(d => String(d.mode || '').toLowerCase() === 'multiview')
					const mvIdx = mvDests.findIndex(d => d.id === dstId)
					if (mvIdx >= 0) {
						mvIndex = mvIdx + 1
					}
				} else if (srcId === 'caspar_mv_out' || c.id === 'caspar_mv_out' || c.label?.toLowerCase().includes('multiview')) {
					mvIndex = 1
				}
			}

			if (mvIndex != null) {
				const n = mvIndex
				if (mvAssignments.some(a => a.sysId === sysId)) return
				const mvVideoMode = boundDest ? String(boundDest.videoMode || '').trim() : ''
				const mvFps =
					boundDest && Number.isFinite(Number(boundDest.fps)) && Number(boundDest.fps) > 0
						? Number(boundDest.fps)
						: null
				mvAssignments.push({
					sysId,
					n,
					osMode: config[`multiview_${n}_os_mode`] || config.multiview_os_mode || mvVideoMode || c.caspar?.mode,
					osBackend: String(config[`multiview_${n}_os_backend`] || config.multiview_os_backend || c.caspar?.osBackend || 'xrandr').trim().toLowerCase(),
					osRate: mvFps ?? config[`multiview_${n}_os_rate`] ?? config.multiview_os_rate ?? c.caspar?.refreshHz,
					casparMode: mvVideoMode || config[`multiview_${n}_mode`] || cs.multiview_mode || c.caspar?.mode,
					manualX: Number.isFinite(config[`multiview_${n}_os_x`]) ? config[`multiview_${n}_os_x`] : (Number.isFinite(config.multiview_os_x) ? config.multiview_os_x : null),
					manualY: Number.isFinite(config[`multiview_${n}_os_y`]) ? config[`multiview_${n}_os_y`] : (Number.isFinite(config.multiview_os_y) ? config.multiview_os_y : null),
				})
			}
		}
	})

	if (explicitScreenAssignments.size > 0) {
		if (operatorScreenAssignments.size === 0 || graphHasDestinationGpuBinding) {
			allGpuAssignments.clear()
			for (const [n, assign] of explicitScreenAssignments.entries()) allGpuAssignments.set(n, assign)
		} else {
			for (const [n, assign] of explicitScreenAssignments.entries()) {
				if (!operatorScreenAssignments.has(n)) allGpuAssignments.set(n, assign)
			}
		}
	}
	if (!graphHasDestinationGpuBinding) {
		for (const [n, assign] of operatorScreenAssignments.entries()) allGpuAssignments.set(n, assign)
	} else {
		for (const [n, assign] of operatorScreenAssignments.entries()) {
			const manualX = Number.isFinite(config[`screen_${n}_os_x`]) ? config[`screen_${n}_os_x`] : null
			const manualY = Number.isFinite(config[`screen_${n}_os_y`]) ? config[`screen_${n}_os_y`] : null
			const forceOs =
				readScreenSetting(config, `screen_${n}_force_os_resolution`) === true ||
				readScreenSetting(config, `screen_${n}_force_os_resolution`) === 'true' ||
				readScreenSetting(config, `screen_${n}_force_os_resolution`) === 1 ||
				readScreenSetting(config, `screen_${n}_force_os_resolution`) === '1'
			if (forceOs) {
				allGpuAssignments.set(n, {
					...assign,
					manualX: manualX != null ? manualX : assign.manualX,
					manualY: manualY != null ? manualY : assign.manualY,
				})
				continue
			}
			if (manualX == null && manualY == null) continue
			const base = allGpuAssignments.get(n) || assign
			allGpuAssignments.set(n, {
				...base,
				...(manualX != null ? { manualX } : {}),
				...(manualY != null ? { manualY } : {}),
			})
		}
	}

	let effectiveScreenCount = screenCount
	if (graphHasDestinationGpuBinding && allGpuAssignments.size > 0) {
		effectiveScreenCount = Math.max(screenCount, ...allGpuAssignments.keys())
	}

	return {
		allGpuAssignments,
		mvAssignments,
		operatorScreenAssignments,
		graphHasDestinationGpuBinding,
		effectiveScreenCount,
		swap,
	}
}

module.exports = { collectGpuLayoutAssignments }
