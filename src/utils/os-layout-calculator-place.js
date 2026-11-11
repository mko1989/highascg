'use strict'

const { getModeDimensions } = require('../config/config-modes')
const { resolveSysIdToXrandrOutput } = require('./xrandr-output-resolve')
const {
	getHorizontalLayoutOrder,
	inferRefreshHzFromCasparMode,
	mapCasparModeToXrandrRes,
	readScreenSetting,
	resolveMultiviewDimsFromTopology,
	resolveOperatorGuiDimsFromTopology,
	resolveScreenDimsFromTopology,
} = require('./os-layout-calculator-helpers')
const { resolveEffectiveOsModeSource } = require('./os-mode-source')
const { isOperatorGuiFirst } = require('../config/operator-gui-first')

/**
 * WO-938: dead X-canvas pixels between the operator heads and every other head. Pointer barriers stop the cursor's
 * HOTSPOT at the operator edge, but X draws the whole sprite (Adwaita 36x36, hotspot 4,1) from there — on 03.11 the
 * arrow's tail showed on the LED wall (DP-0) right of DP-6. No CRTC scans this strip, so whatever of the sprite lands
 * in it is invisible. 128 > the reach of any themed cursor up to size 96, either side of the hotspot.
 */
const OPERATOR_CURSOR_GAP_PX = 128

/**
 * WO-920: the operator heads keyed by the monitor their cable names (assign.js `n`: dot 1 → 1, dot 2 → 2), monitor 1
 * first, so it keeps the left edge under "Operator GUI first" (WO-868) and monitor 2 sits right next to it. A second
 * jack on the same dot (a fan-out cable) still lights, under the next number above 2, so `operatorGui[2]` always
 * means the cable from dot 2.
 * @param {object[]} [assignments]
 * @returns {{ n: number, data: object }[]}
 */
function operatorGuiPlacementOrder(assignments) {
	const used = new Set()
	let spare = 2
	const out = []
	const sorted = [...(assignments || [])].sort((a, b) => (parseInt(a?.n, 10) || 1) - (parseInt(b?.n, 10) || 1))
	for (const data of sorted) {
		let n = Math.max(1, parseInt(data?.n, 10) || 1)
		if (used.has(n)) {
			while (used.has(++spare));
			n = spare
		}
		used.add(n)
		out.push({ n, data })
	}
	return out
}

/**
 * @param {object} config
 * @param {{
 *   allGpuAssignments: Map<number, object>,
 *   mvAssignments: object[],
 *   effectiveScreenCount: number,
 *   swap: boolean,
 * }} assignments
 */
function computePlacedLayoutResults(config, { allGpuAssignments, mvAssignments, operatorGuiAssignments, prvAssignments, extraScreenAssignments, effectiveScreenCount, swap }) {
	const placements = []
	/* WO-868: "Operator GUI first" — the operator monitor heads the canvas (x=0), the screens follow to its right.
	 * Which jack is the operator stays the per-boot / cabled choice (WO-638, WO-412); only the order changes. */
	const operatorFirst = isOperatorGuiFirst(config)
	/* WO-573 follow-up: operator_gui is placed independently of a genuine multiview destination —
	 * both can be live on separate physical outputs at once, so each gets its own results bucket. */
	const pushOperatorGui = () => {
		for (const og of operatorGuiPlacementOrder(operatorGuiAssignments)) placements.push({ kind: 'operator_gui', ...og })
	}
	if (operatorFirst) pushOperatorGui()
	const screens = getHorizontalLayoutOrder(effectiveScreenCount, swap)
	for (const n of screens) placements.push({ kind: 'screen', n })
	mvAssignments.forEach((mv, idx) => placements.push({ kind: 'multiview', n: idx + 1, data: mv }))
	if (!operatorFirst) pushOperatorGui()
	/* WO-364: PRV heads placed after screens+multiview; keyed by their main's n. */
	;(prvAssignments || []).forEach((pa) => placements.push({ kind: 'prv', n: pa.n, data: pa }))
	/* WO-1034: extra jacks of a screen (fill + key pair) — after everything else, so adding one moves no other head.
	 * `n` is the screen whose raster they show; `key` numbers them in results.screenExtra. */
	;(extraScreenAssignments || []).forEach((xa, idx) => placements.push({ kind: 'screen_extra', n: xa.n, key: idx + 1, data: xa }))

	const results = { screens: {}, multiview: {}, operatorGui: {}, prv: {} }
	let cumulativeX = 0
	/** kind of the last auto-placed head — a step between operator and non-operator heads opens the WO-938 gap */
	let lastAutoKind = null
	for (const p of placements) {
		let data
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
		// A multiview/operator_gui head's `osMode` can be filled from the bound destination's
		// videoMode (a Caspar mode id like "2160p5000", not a real xrandr token) when no OS-level
		// override was ever set (os-layout-calculator-assign.js's `mvVideoMode` fallback). Trusting
		// that literally as `modeForXrandr` fails the WxH match below and silently falls back to the
		// 1920x1080 default — reported live 2026-07-21: an operator_gui destination on a 3840x2160
		// GPU port kept computing a 1920x1080 rect for the shape-overlay hole punch. Only a genuine
		// xrandr-recognizable token (WxH, optionally `_rate` suffixed) may be used as-is.
		const looksLikeXrandrModeToken = /^\d+x\d+/i.test(rawOsMode || '')

		let modeForXrandr
		let usedCasparOverStaleOsPixel = false
		if (osModeSource === 'edid' && rawOsMode && looksLikeXrandrModeToken) {
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
		} else if (p.kind === 'prv' || p.kind === 'screen_extra') {
			/* WO-364: the PRV bus is the same raster as its main's pair. WO-1034: so is an extra jack of the screen. */
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
		} else if (p.kind === 'operator_gui') {
			const topoDims = resolveOperatorGuiDimsFromTopology(config, p.n)
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
			} else if (p.kind === 'screen' || p.kind === 'multiview' || p.kind === 'operator_gui' || p.kind === 'prv' || p.kind === 'screen_extra') {
				w = parseInt(resMatch[1], 10) || w
				h = parseInt(resMatch[2], 10) || h
			}
		}
		if (data.manualX === null && lastAutoKind !== null && (lastAutoKind === 'operator_gui') !== (p.kind === 'operator_gui')) {
			cumulativeX += OPERATOR_CURSOR_GAP_PX
		}
		const posX = data.manualX !== null ? data.manualX : cumulativeX
		const posY = data.manualY !== null ? data.manualY : 0

		let effectiveRate
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
		else if (p.kind === 'prv') results.prv[p.n] = info
		else if (p.kind === 'screen_extra') {
			/* absent unless a destination fans out: layouts without one stay byte-identical */
			if (!results.screenExtra) results.screenExtra = {}
			results.screenExtra[p.key] = { ...info, extraOfScreen: p.n, connectorId: data.connectorId }
		}
		else if (p.kind === 'operator_gui') results.operatorGui[p.n] = info
		else results.multiview[p.n] = info

		if (data.manualX === null) {
			cumulativeX += w
			lastAutoKind = p.kind
		}
	}

	return results
}

module.exports = { computePlacedLayoutResults, operatorGuiPlacementOrder, OPERATOR_CURSOR_GAP_PX }
