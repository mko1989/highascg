'use strict'

const { getModeDimensions } = require('../config/config-modes')
const { resolveSysIdToXrandrOutput } = require('./xrandr-output-resolve')
const {
	getHorizontalLayoutOrder,
	inferRefreshHzFromCasparMode,
	mapCasparModeToXrandrRes,
	readScreenSetting,
	resolveMultiviewDimsFromTopology,
	resolveScreenDimsFromTopology,
} = require('./os-layout-calculator-helpers')
const { resolveEffectiveOsModeSource } = require('./os-mode-source')

/**
 * @param {object} config
 * @param {{
 *   allGpuAssignments: Map<number, object>,
 *   mvAssignments: object[],
 *   effectiveScreenCount: number,
 *   swap: boolean,
 * }} assignments
 */
function computePlacedLayoutResults(config, { allGpuAssignments, mvAssignments, effectiveScreenCount, swap }) {
	const placements = []
	const screens = getHorizontalLayoutOrder(effectiveScreenCount, swap)
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
		const osModeSource =
			p.kind === 'screen' ? resolveEffectiveOsModeSource(config, p.n, { osMode: rawOsMode, casparMode: data.casparMode }) : 'edid'
		const cm = String(data.casparMode || '').trim()

		let modeForXrandr = ''
		let usedCasparOverStaleOsPixel = false
		if (osModeSource === 'edid' && rawOsMode) {
			modeForXrandr = rawOsMode
		} else if (forceOsRes) {
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
					const cmLower = String(cm || '').toLowerCase()
					if (!mappedOk || cmLower === 'custom') modeForXrandr = `${w}x${h}`
				}
			} else {
				const dims = getModeDimensions(String(data.casparMode || ''), config, p.n)
				if (Number.isFinite(dims?.width) && dims.width > 0) {
					w = dims.width
					hasCasparDims = true
				}
				if (Number.isFinite(dims?.height) && dims.height > 0) h = dims.height
			}
		} else if (p.kind === 'multiview') {
			const topoDims = resolveMultiviewDimsFromTopology(config, p.n)
			if (topoDims && topoDims.width > 0 && topoDims.height > 0) {
				w = topoDims.width
				h = topoDims.height
				hasCasparDims = true
				const allowTopoReplaceMode = !explicitPixelOsMode && !forceOsRes
				if (allowTopoReplaceMode) {
					const mappedOk = /^\d+x\d+$/i.test(modeForXrandr)
					const cmLower = String(cm || '').toLowerCase()
					if (!mappedOk || cmLower === 'custom') modeForXrandr = `${w}x${h}`
				}
			}
		}
		const resMatch = modeForXrandr.match(/^(\d+)x(\d+)/)
		if (resMatch) {
			if (!hasCasparDims) {
				w = parseInt(resMatch[1], 10) || w
				h = parseInt(resMatch[2], 10) || h
			} else if (p.kind === 'screen' || p.kind === 'multiview') {
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

		const resolvedSysId = resolveSysIdToXrandrOutput(data.sysId, { config })
		const info = {
			sysId: resolvedSysId,
			drmSysId: resolvedSysId !== data.sysId ? data.sysId : undefined,
			x: posX,
			y: posY,
			width: w,
			height: h,
			mode: modeForXrandr,
			rate: effectiveRate,
			backend: data.osBackend,
			screenIndex: p.kind === 'screen' ? p.n : null,
			osModeSource,
		}

		if (p.kind === 'screen') results.screens[p.n] = info
		else results.multiview[p.n] = info

		if (data.manualX === null) cumulativeX += w
	}

	return results
}

module.exports = { computePlacedLayoutResults }
