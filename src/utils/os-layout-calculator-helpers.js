'use strict'

const { destinationsFromConfig } = require('../config/screen-destinations')
const { STANDARD_VIDEO_MODES } = require('../config/config-modes')
const { resolveSysIdToXrandrOutput } = require('./xrandr-output-resolve')

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
	const s = String(mode).trim()
	const std = STANDARD_VIDEO_MODES[s]
	if (std) return `${std.width}x${std.height}`
	const m = s.match(/^(\d+)x(\d+)/i)
	return m ? `${m[1]}x${m[2]}` : '1920x1080'
}

function resolveMultiviewDimsFromTopology(config, multiviewIdx1) {
	const list = destinationsFromConfig(config)
	if (!list.length) return null
	const idx0 = Math.max(0, (parseInt(String(multiviewIdx1), 10) || 1) - 1)
	const mvDests = list.filter((d) => String(d?.mode || '') === 'multiview')
	const picked = mvDests[idx0] || mvDests[0]
	if (!picked) return null
	const vm = String(picked?.videoMode || '').trim()
	if (vm && STANDARD_VIDEO_MODES[vm]) {
		return { width: STANDARD_VIDEO_MODES[vm].width, height: STANDARD_VIDEO_MODES[vm].height }
	}
	const w = parseInt(String(picked?.width ?? 0), 10) || 0
	const h = parseInt(String(picked?.height ?? 0), 10) || 0
	if (w > 0 && h > 0) return { width: w, height: h }
	return null
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

/** True when operator explicitly set OS layout fields (Apply OS / Device View). */
function hasOperatorOsLayoutOverride(config, n) {
	if (String(config?.[`screen_${n}_system_id`] || '').trim()) return true
	if (Number.isFinite(config[`screen_${n}_os_x`])) return true
	if (Number.isFinite(config[`screen_${n}_os_y`])) return true
	if (String(config?.[`screen_${n}_os_mode`] || '').trim()) return true
	const fk = config[`screen_${n}_force_os_resolution`]
	if (fk === true || fk === 'true' || fk === 1 || fk === '1') return true
	const rate = parseFloat(String(config[`screen_${n}_os_rate`] ?? ''))
	return Number.isFinite(rate) && rate > 0
}

function recomputeMappingGpuBBox(mappingGpuOutputs) {
	if (!Array.isArray(mappingGpuOutputs) || !mappingGpuOutputs.length) return null
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const r of mappingGpuOutputs) {
		minX = Math.min(minX, r.x)
		minY = Math.min(minY, r.y)
		maxX = Math.max(maxX, r.x + r.width)
		maxY = Math.max(maxY, r.y + r.height)
	}
	if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null
	return { minX, minY, maxX, maxY }
}

function screenIndexForceClaimsOutput(config, screenIdx, sysId) {
	const fk = readScreenSetting(config, `screen_${screenIdx}_force_os_resolution`)
	const forced = fk === true || fk === 'true' || fk === 1 || fk === '1'
	if (!forced) return false
	const opSys = String(readScreenSetting(config, `screen_${screenIdx}_system_id`) || '').trim()
	if (opSys) return resolveSysIdToXrandrOutput(opSys, { config }) === sysId
	return false
}

/** Pixel-map GPU rows win over auto screen placement unless operator forced OS on that output. */
function mergeMappingGpuOutputsWithScreens(config, results, mappingGpuOutputs) {
	if (!Array.isArray(mappingGpuOutputs) || !mappingGpuOutputs.length) {
		return { mappingGpuOutputs: [], mappingGpuBBox: null }
	}
	/** @type {Map<string, object>} */
	const mappingBySysId = new Map()
	for (const row of mappingGpuOutputs) {
		const id = resolveSysIdToXrandrOutput(String(row?.sysId || ''), { config })
		if (id) mappingBySysId.set(id, row)
	}
	for (const [idx, info] of Object.entries(results.screens)) {
		const id = resolveSysIdToXrandrOutput(String(info?.sysId || ''), { config })
		if (!id || !mappingBySysId.has(id)) continue
		const n = parseInt(String(idx), 10)
		if (Number.isFinite(n) && screenIndexForceClaimsOutput(config, n, id)) {
			mappingBySysId.delete(id)
		} else {
			delete results.screens[idx]
		}
	}
	for (const [idx, info] of Object.entries(results.multiview)) {
		const id = resolveSysIdToXrandrOutput(String(info?.sysId || ''), { config })
		if (!id || !mappingBySysId.has(id)) continue
		const n = parseInt(String(idx), 10)
		const mvForced =
			readScreenSetting(config, `multiview_${n}_force_os_resolution`) === true ||
			readScreenSetting(config, 'multiview_force_os_resolution') === true
		if (mvForced) {
			mappingBySysId.delete(id)
		} else {
			delete results.multiview[idx]
		}
	}
	const kept = [...mappingBySysId.values()]
	return {
		mappingGpuOutputs: kept,
		mappingGpuBBox: recomputeMappingGpuBBox(kept),
	}
}

module.exports = {
	readScreenSetting,
	resolveScreenDimsFromTopology,
	resolveMultiviewDimsFromTopology,
	mapCasparModeToXrandrRes,
	inferRefreshHzFromCasparMode,
	getHorizontalLayoutOrder,
	hasOperatorOsLayoutOverride,
	mergeMappingGpuOutputsWithScreens,
}
