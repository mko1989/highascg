'use strict'

const { destinationsFromConfig } = require('../config/screen-destinations')
const { multiviewGeneratedConfigIncludesScreen } = require('../config/multiview-helpers')
const { getModeDimensions, STANDARD_VIDEO_MODES } = require('../config/config-modes')
const { buildMappingGpuLayoutArtifacts } = require('./mapping-gpu-os-layout')
const { resolvePixelMapFeedToProgramScreen } = require('../config/pixel-mapping-config')
const logger = require('./logger').defaultLogger

function readScreenSetting(config, key) {
	if (!config || typeof config !== 'object') return undefined
	const cs = config.casparServer && typeof config.casparServer === 'object' ? config.casparServer : null
	if (Object.prototype.hasOwnProperty.call(config, key)) return config[key]
	if (cs && Object.prototype.hasOwnProperty.call(cs, key)) return cs[key]
	return undefined
}

function resolveScreenDimsFromTopology(config, screenIdx1) {
	const list = destinationsFromConfig(config)
	if (!list.length) return null
	const idx0 = Math.max(0, (parseInt(String(screenIdx1), 10) || 1) - 1)
	const routable = list.filter((d) => {
		const mode = String(d?.mode || 'pgm_prv')
		return mode !== 'multiview' && mode !== 'stream'
	})
	const perMain = routable.filter((d) => (parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0) === idx0)
	if (!perMain.length) return null
	const picked = perMain.find((d) => String(d?.mode || 'pgm_prv') === 'pgm_prv') || perMain[0]
	const vm = String(picked?.videoMode || '').trim()
	if (vm && STANDARD_VIDEO_MODES[vm]) return { width: STANDARD_VIDEO_MODES[vm].width, height: STANDARD_VIDEO_MODES[vm].height }
	const w = parseInt(String(picked?.width ?? 0), 10) || 0
	const h = parseInt(String(picked?.height ?? 0), 10) || 0
	if (w > 0 && h > 0) return { width: w, height: h }
	return null
}

function mapCasparModeToXrandrRes(mode) {
	if (!mode) return '1920x1080'
	const s = String(mode)
	if (s === '1080p5000' || s === '1080p50') return '1920x1080'
	if (s === '720p5000' || s === '720p50') return '1280x720'
	const m = s.match(/^(\d+)x(\d+)/)
	return m ? `${m[1]}x${m[2]}` : '1920x1080'
}

/** Rough refresh (Hz) implied by Caspar mode id, for xrandr --rate when OS rate is stale */
function inferRefreshHzFromCasparMode(modeId) {
	const s = String(modeId || '').toLowerCase()
	if (!s) return null
	if (/(4997|5000|p50)(?:\b|_)/.test(s) || /50$/.test(s)) return 50
	if (/(5994|6000|p60)(?:\b|_)/.test(s) || /60$/.test(s)) return 60
	if (/(4795|4800|p48)(?:\b|_)/.test(s)) return 48
	if (/(2997|3000|p30)(?:\b|_)/.test(s)) return 30
	if (/(2497|2500|p25)(?:\b|_)/.test(s)) return 25
	if (/(2398|2400|p24)(?:\b|_)/.test(s)) return 24
	return null
}

function getHorizontalLayoutOrder(screenCount, swap) {
	const order = []
	for (let i = 1; i <= screenCount; i++) order.push(i)
	if (swap) order.reverse()
	return order
}

function includeMultiviewSecondHead(config, cs, screenCount) {
	if (screenCount !== 1) return false
	const mvOn = cs.multiview_enabled !== false && cs.multiview_enabled !== 'false'
	const mvSc = multiviewGeneratedConfigIncludesScreen(cs)
	if (!mvOn || !mvSc) return false
	const mvId =
		String(config.multiview_system_id || '').trim() || String(config.screen_2_system_id || '').trim()
	return mvId !== ''
}

function calculateLayoutPositions(config) {
	const cs = config.casparServer && typeof config.casparServer === 'object' ? config.casparServer : {}
	const screenCount = Math.min(16, Math.max(1, parseInt(String(config.screen_count ?? cs.screen_count ?? 1), 10) || 1))
	const swap = !!(config.x11_horizontal_swap === true || config.x11_horizontal_swap === 'true' || config.x11_horizontal_swap === 1 || config.x11_horizontal_swap === '1')
	
	const allGpuAssignments = new Map()
	const mvAssignments = []
	const explicitScreenAssignments = new Map()
	
	for (let n = 1; n <= 8; n++) {
		const sysId = config[`screen_${n}_system_id`]
		if (sysId) {
			allGpuAssignments.set(n, {
				sysId,
				osMode: config[`screen_${n}_os_mode`],
				osBackend: String(config[`screen_${n}_os_backend`] || 'xrandr').trim().toLowerCase(),
				osRate: config[`screen_${n}_os_rate`],
				casparMode: readScreenSetting(config, `screen_${n}_mode`),
				manualX: Number.isFinite(config[`screen_${n}_os_x`]) ? config[`screen_${n}_os_x`] : null,
				manualY: Number.isFinite(config[`screen_${n}_os_y`]) ? config[`screen_${n}_os_y`] : null
			})
		}
	}
	if (config.multiview_system_id) {
		mvAssignments.push({
			sysId: config.multiview_system_id,
			osMode: config.multiview_os_mode,
			osBackend: String(config.multiview_os_backend || 'xrandr').trim().toLowerCase(),
			osRate: config.multiview_os_rate,
			casparMode: cs.multiview_mode,
			manualX: Number.isFinite(config.multiview_os_x) ? config.multiview_os_x : null,
			manualY: Number.isFinite(config.multiview_os_y) ? config.multiview_os_y : null
		})
	}
	
	const connectors = Array.isArray(config?.deviceGraph?.connectors) ? config.deviceGraph.connectors : []
	const edges = Array.isArray(config?.deviceGraph?.edges) ? config.deviceGraph.edges : []
	const dests = destinationsFromConfig(config)

	const graphGpuConnectors = connectors.filter(c => c.kind === 'gpu_out' || c.kind === 'gpu_output')
	const graphHasAnyGpuBinding = graphGpuConnectors.some(c => {
		const binding = c.caspar?.outputBinding
		if (binding && binding.type) return true
		const inEdge = edges.find(e => e.sinkId === c.id)
		return !!inEdge
	})

	if (graphHasAnyGpuBinding) {
		allGpuAssignments.clear()
		mvAssignments.length = 0
	}

	graphGpuConnectors.forEach(c => {
		if (c.kind !== 'gpu_out' && c.kind !== 'gpu_output') return
		const sysId = String(c.externalRef || '').trim()
		if (!sysId) return

		let binding = c.caspar?.outputBinding
		let mainIndex = c.caspar?.mainIndex
		let inferredFromEdge = false
		let edgeDerivedMode = null
		let edgeDerivedMainIndex = null

		const inEdge = edges.find(e => e.sinkId === c.id)
		let boundDest = null
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
		if (isScreenBinding || isLegacyMainIndexOnly) {
			const n = Math.min(16, Math.max(1, parseInt(String(binding?.index ?? (Number(mainIndex) + 1) ?? 1), 10) || 1))
			const destMode = boundDest ? String(boundDest.mode || 'pgm_prv').toLowerCase() : ''
			const routableBound =
				boundDest && destMode !== 'multiview' && destMode !== 'stream'
			const fkResN = `screen_${n}_force_os_resolution`
			const forceOsResForN =
				readScreenSetting(config, fkResN) === true ||
				readScreenSetting(config, fkResN) === 'true' ||
				readScreenSetting(config, fkResN) === 1 ||
				readScreenSetting(config, fkResN) === '1'
			const casparModeFromBoundDest =
				!forceOsResForN &&
				routableBound &&
				String(boundDest.videoMode || '').trim()
					? String(boundDest.videoMode || '').trim()
					: ''
			const assign = {
				sysId,
				osMode: config[`screen_${n}_os_mode`] || c.caspar?.mode,
				osBackend: String(config[`screen_${n}_os_backend`] || c.caspar?.osBackend || 'xrandr').trim().toLowerCase(),
				osRate: config[`screen_${n}_os_rate`] || c.caspar?.refreshHz,
				casparMode:
					casparModeFromBoundDest ||
					readScreenSetting(config, `screen_${n}_mode`) ||
					c.caspar?.mode,
				manualX: Number.isFinite(config[`screen_${n}_os_x`]) ? config[`screen_${n}_os_x`] : null,
				manualY: Number.isFinite(config[`screen_${n}_os_y`]) ? config[`screen_${n}_os_y`] : null
			}
			allGpuAssignments.set(n, assign)
			if (isScreenBinding || inferredFromEdge) explicitScreenAssignments.set(n, assign)
		} else {
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
				mvAssignments.push({ 
					sysId, 
					n,
					osMode: config[`multiview_${n}_os_mode`] || config.multiview_os_mode || c.caspar?.mode, 
					osBackend: String(config[`multiview_${n}_os_backend`] || config.multiview_os_backend || c.caspar?.osBackend || 'xrandr').trim().toLowerCase(), 
					osRate: config[`multiview_${n}_os_rate`] || config.multiview_os_rate || c.caspar?.refreshHz, 
					casparMode: config[`multiview_${n}_mode`] || cs.multiview_mode || c.caspar?.mode, 
					manualX: Number.isFinite(config[`multiview_${n}_os_x`]) ? config[`multiview_${n}_os_x`] : (Number.isFinite(config.multiview_os_x) ? config.multiview_os_x : null), 
					manualY: Number.isFinite(config[`multiview_${n}_os_y`]) ? config[`multiview_${n}_os_y`] : (Number.isFinite(config.multiview_os_y) ? config.multiview_os_y : null) 
				})
			}
		}
	})

	if (explicitScreenAssignments.size > 0) {
		allGpuAssignments.clear()
		for (const [n, assign] of explicitScreenAssignments.entries()) allGpuAssignments.set(n, assign)
	}

	const placements = []
	const screens = getHorizontalLayoutOrder(screenCount, swap)
	for (const n of screens) placements.push({ kind: 'screen', n })
	mvAssignments.forEach((mv, idx) => placements.push({ kind: 'multiview', n: idx + 1, data: mv }))
	
	const results = { screens: {}, multiview: {} }
	let cumulativeX = 0
	for (const p of placements) {
		let data = null
		if (p.kind === 'screen') {
			data = allGpuAssignments.get(p.n)
		} else {
			data = p.data
		}
		if (!data || !data.sysId) continue

		const fkRes = `screen_${p.n}_force_os_resolution`
		const forceOsRes =
			p.kind === 'screen' &&
			(readScreenSetting(config, fkRes) === true ||
				readScreenSetting(config, fkRes) === 'true' ||
				readScreenSetting(config, fkRes) === 1 ||
				readScreenSetting(config, fkRes) === '1')

		const rawOsMode = data.osMode && String(data.osMode).trim()
		const explicitPixelOsMode = /^\d+x\d+$/i.test(rawOsMode || '')
		const cm = String(data.casparMode || '').trim()

		let modeForXrandr = ''
		let usedCasparOverStaleOsPixel = false
		if (forceOsRes) {
			// Operator set explicit xrandr pixel mode (e.g. 1920x1080) — use it when override is on.
			if (explicitPixelOsMode && rawOsMode) {
				modeForXrandr = rawOsMode
			} else if (cm === 'custom') {
				const dims = getModeDimensions('custom', config, p.n)
				if (
					Number.isFinite(dims?.width) &&
					Number.isFinite(dims?.height) &&
					dims.width > 0 &&
					dims.height > 0
				) {
					modeForXrandr = `${dims.width}x${dims.height}`
				} else {
					modeForXrandr = mapCasparModeToXrandrRes('1080p5000')
				}
			} else {
				modeForXrandr = mapCasparModeToXrandrRes(cm || '1080p5000')
			}
		} else {
			let casparPixel = ''
			if (p.kind === 'screen' && cm === 'custom') {
				const dims = getModeDimensions('custom', config, p.n)
				if (Number.isFinite(dims?.width) && Number.isFinite(dims?.height) && dims.width > 0 && dims.height > 0) {
					casparPixel = `${dims.width}x${dims.height}`
				}
			}
			if (!casparPixel) {
				const mapped = mapCasparModeToXrandrRes(cm || (explicitPixelOsMode ? '' : rawOsMode))
				if (/^\d+x\d+$/i.test(mapped)) casparPixel = mapped
			}
			if (explicitPixelOsMode && casparPixel && String(rawOsMode).toLowerCase() !== String(casparPixel).toLowerCase()) {
				modeForXrandr = casparPixel
			} else if (explicitPixelOsMode) {
				modeForXrandr = rawOsMode
			} else {
				modeForXrandr = casparPixel || mapCasparModeToXrandrRes(cm || rawOsMode)
			}
			usedCasparOverStaleOsPixel =
				explicitPixelOsMode && casparPixel && String(rawOsMode).toLowerCase() !== String(casparPixel).toLowerCase()
		}
		let w = 1920
		let h = 1080
		let hasCasparDims = false
		if (p.kind === 'screen' && !forceOsRes) {
			const topoDims = resolveScreenDimsFromTopology(config, p.n)
			if (topoDims && topoDims.width > 0 && topoDims.height > 0) {
				w = topoDims.width
				h = topoDims.height
				hasCasparDims = true
				const allowTopoReplaceMode = !explicitPixelOsMode && !forceOsRes
				if (allowTopoReplaceMode) {
					const mappedOk = /^\d+x\d+$/i.test(modeForXrandr)
					if (!mappedOk) modeForXrandr = `${w}x${h}`
				}
			} else {
				const dims = getModeDimensions(String(data.casparMode || ''), config, p.n)
				if (Number.isFinite(dims?.width) && dims.width > 0) {
					w = dims.width
					hasCasparDims = true
				}
				if (Number.isFinite(dims?.height) && dims.height > 0) h = dims.height
			}
		}
		const resMatch = modeForXrandr.match(/^(\d+)x(\d+)/)
		if (resMatch) {
			if (!hasCasparDims) {
				w = parseInt(resMatch[1], 10) || w
				h = parseInt(resMatch[2], 10) || h
			} else if (p.kind === 'screen') {
				w = parseInt(resMatch[1], 10) || w
				h = parseInt(resMatch[2], 10) || h
			}
		}
		const posX = data.manualX !== null ? data.manualX : cumulativeX
		const posY = data.manualY !== null ? data.manualY : 0

		let effectiveRate = data.osRate
		if (forceOsRes) {
			const customFps = readScreenSetting(config, `screen_${p.n}_custom_fps`)
			const fpsNum = parseFloat(String(customFps ?? ''))
			if (cm === 'custom' && Number.isFinite(fpsNum) && fpsNum > 0) {
				effectiveRate = fpsNum
			} else {
				const inferred = inferRefreshHzFromCasparMode(cm)
				effectiveRate = inferred != null ? inferred : data.osRate
			}
		} else {
			const inferredHz = inferRefreshHzFromCasparMode(cm)
			effectiveRate = usedCasparOverStaleOsPixel && inferredHz != null ? inferredHz : data.osRate
			const erNum = parseFloat(String(effectiveRate ?? ''))
			if ((!Number.isFinite(erNum) || erNum <= 0) && inferredHz != null) {
				effectiveRate = inferredHz
			}
		}

		const info = {
			sysId: data.sysId,
			x: posX,
			y: posY,
			width: w,
			height: h,
			mode: modeForXrandr,
			rate: effectiveRate,
			backend: data.osBackend
		}

		if (p.kind === 'screen') results.screens[p.n] = info
		else results.multiview[p.n] = info

		if (data.manualX === null) cumulativeX += w
	}

	const { mappingGpuOutputs, mappingGpuBBox } = buildMappingGpuLayoutArtifacts(config)

	// WO-40a: place destination-driven heads to the right of mapping-fed bbox (e.g. 4th monitor at x=maxX).
	if (
		mappingGpuBBox &&
		mappingGpuOutputs.length > 0 &&
		Object.keys(results.screens).length > 0
	) {
		const devices = Array.isArray(config?.deviceGraph?.devices) ? config.deviceGraph.devices : []
		const mappingFeedScreens = new Set()
		for (const d of devices) {
			if (!d || d.role !== 'pixel_mapping') continue
			const feed = resolvePixelMapFeedToProgramScreen(config, String(d.id))
			if (feed?.kind === 'program' && Number.isFinite(feed.screenIndex) && feed.screenIndex >= 1) {
				mappingFeedScreens.add(feed.screenIndex)
			}
		}
		const offX = Math.max(0, mappingGpuBBox.maxX)
		const spanX = mappingGpuBBox.maxX - mappingGpuBBox.minX
		const spanY = mappingGpuBBox.maxY - mappingGpuBBox.minY
		const verticalStack = spanY > spanX
		if (verticalStack) {
			const offY = Math.max(0, mappingGpuBBox.maxY)
			if (offY > 0) {
				for (const [key, info] of Object.entries(results.screens)) {
					const n = parseInt(key, 10)
					if (!Number.isFinite(n) || n < 1 || !info) continue
					if (mappingFeedScreens.size > 0 && mappingFeedScreens.has(n)) continue
					const manualOsY = Number.isFinite(config[`screen_${n}_os_y`]) ? config[`screen_${n}_os_y`] : null
					if (manualOsY != null) continue
					info.y += offY
				}
			}
		} else if (offX > 0) {
			for (const [key, info] of Object.entries(results.screens)) {
				const n = parseInt(key, 10)
				if (!Number.isFinite(n) || n < 1 || !info) continue
				if (mappingFeedScreens.size > 0 && mappingFeedScreens.has(n)) continue
				const manualOsX = Number.isFinite(config[`screen_${n}_os_x`]) ? config[`screen_${n}_os_x`] : null
				if (manualOsX != null) continue
				info.x += offX
			}
		}
	}

	results.mappingGpuOutputs = mappingGpuOutputs
	results.mappingGpuBBox = mappingGpuBBox

	try {
		const screenEntries = Object.entries(results.screens)
		const mvEntries = Object.entries(results.multiview)
		const mapEntries = Array.isArray(results.mappingGpuOutputs) ? results.mappingGpuOutputs : []
		if (screenEntries.length === 0 && mvEntries.length === 0 && mapEntries.length === 0) {
			logger.info('[OS-Config] Layout plan: no assigned outputs')
		} else {
			for (const info of mapEntries) {
				logger.info(
					`[OS-Config] Layout mapping→GPU: id=${info.sysId} node=${info.nodeId} mode=${info.mode} pos=${info.x},${info.y} size=${info.width}x${info.height} backend=${info.backend}${info.rate != null ? ` rate=${info.rate}` : ''}`
				)
			}
			for (const [idx, info] of screenEntries) {
				logger.info(
					`[OS-Config] Layout screen_${idx}: id=${info.sysId} mode=${info.mode} pos=${info.x},${info.y} size=${info.width}x${info.height} backend=${info.backend}${info.rate != null ? ` rate=${info.rate}` : ''}`
				)
			}
			for (const [idx, info] of mvEntries) {
				logger.info(
					`[OS-Config] Layout multiview_${idx}: id=${info.sysId} mode=${info.mode} pos=${info.x},${info.y} size=${info.width}x${info.height} backend=${info.backend}${info.rate != null ? ` rate=${info.rate}` : ''}`
				)
			}
			if (results.mappingGpuBBox) {
				const b = results.mappingGpuBBox
				logger.info(
					`[OS-Config] Layout mapping GPU bbox: ${b.minX},${b.minY} → ${b.maxX},${b.maxY} (for downstream placement / WO-40a)`
				)
			}
		}
	} catch (_) {}

	return results
}

module.exports = { calculateLayoutPositions }
