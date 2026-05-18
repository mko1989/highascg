import { multiviewState } from '../lib/multiview-state.js'

/** Must match `MV_TIMER_TITLE_PX` in `src/api/multiview-layout-helper.js` (timers-under-labels chrome). */
const MV_TIMER_TITLE_PX = 28

function inferPgmScreen(cell, programChannels) {
	const src = cell?.source?.value || cell?.source
	if (src && typeof src === 'string') {
		const ch = parseInt(String(src).replace(/^route:\/\//, '').split('-')[0], 10)
		if (!isNaN(ch) && programChannels.includes(ch)) {
			const idx = programChannels.indexOf(ch)
			return idx >= 0 ? idx + 1 : 1
		}
	}
	const lbl = (cell?.label || '').toLowerCase()
	const m = lbl.match(/program\s*(\d+)|pgm\s*(\d+)|pgm(\d+)|pgm\s*s\s*(\d+)/)
	if (m) return parseInt(m[1] || m[2] || m[3] || m[4], 10) || 1

	const idM = cell?.id?.match(/^pgm(?:_(\d+))?$/)
	return idM?.[1] != null ? parseInt(idM[1], 10) + 1 : 1
}

function inferPrvScreen(cell, previewChannels) {
	const src = cell?.source?.value || cell?.source
	if (src && typeof src === 'string') {
		const ch = parseInt(String(src).replace(/^route:\/\//, '').split('-')[0], 10)
		if (!isNaN(ch) && previewChannels.includes(ch)) {
			const idx = previewChannels.indexOf(ch)
			return idx >= 0 ? idx + 1 : 1
		}
	}
	const lbl = (cell?.label || '').toLowerCase()
	const m = lbl.match(/preview\s*(\d+)|prv\s*(\d+)|prv(\d+)|prv\s*s\s*(\d+)/)
	if (m) return parseInt(m[1] || m[2] || m[3] || m[4], 10) || 1

	const idM = cell?.id?.match(/^prv(?:_(\d+))?$/)
	return idM?.[1] != null ? parseInt(idM[1], 10) + 1 : 1
}

export function getCellOverlayType(c, programChannels, previewChannels) {
	const src = c?.source?.value || c?.source || ''
	if (typeof src === 'string' && src.includes('playback_timers.html')) return 'timers'
	if (typeof src === 'string' && src.startsWith('route://')) {
		const routeCh = String(src).replace(/^route:\/\//, '').split('-')[0]
		const ch = parseInt(routeCh, 10)
		if (!isNaN(ch)) {
			if (programChannels.includes(ch)) return 'pgm'
			if (previewChannels.includes(ch)) return 'prv'
		}
	}
	const lbl = (c?.label || '').toLowerCase()
	if (/\b(?:program|pgm)\s*\d+\b|\bpgm\d+\b|pgm\s*s\s*\d+/.test(lbl)) return 'pgm'
	if (/\b(?:preview|prv)\s*\d+\b|\bprv\d+\b|prv\s*s\s*\d+/.test(lbl)) return 'prv'
	return c?.type
}

export function getResolutionSuffix(cell, cm = {}) {
	const programChannels = cm.programChannels || []
	const previewChannels = cm.previewChannels || []
	const ovType = getCellOverlayType(cell, programChannels, previewChannels)

	let resolvedCh = null
	let isPgm = false
	let isPrv = false

	if (ovType === 'pgm') {
		isPgm = true
		resolvedCh = inferPgmScreen(cell, programChannels)
	} else if (ovType === 'prv') {
		isPrv = true
		resolvedCh = inferPrvScreen(cell, previewChannels)
	}

	if (resolvedCh) {
		const idx = resolvedCh - 1
		const res = isPgm ? cm.programResolutions?.[idx] : (cm.previewResolutions?.[idx] || cm.programResolutions?.[idx])
		if (res && res.w > 0 && res.h > 0) {
			return ` (${res.w}x${res.h} ${res.fps}p)`
		}
	}
	return ''
}

export function getContainedVideoRect(c, cm = {}) {
	const W = 1920
	const H = 1080

	const canvasWidth = multiviewState.canvasWidth || 1920
	const canvasHeight = multiviewState.canvasHeight || 1080

	const px = (c.x / canvasWidth) * W
	const py = (c.y / canvasHeight) * H
	const pw = (c.w / canvasWidth) * W
	const ph = (c.h / canvasHeight) * H

	const borderSize = 3
	const showTimersUnderLabels = !!multiviewState.showTimersUnderLabels
	const programChannels = cm.programChannels || []
	const previewChannels = cm.previewChannels || []
	const ovType = getCellOverlayType(c, programChannels, previewChannels)
	const isScreen = ovType === 'pgm' || ovType === 'prv'

	let labelSize = 0
	if (ovType !== 'timers') {
		const innerH = ph - borderSize * 2
		if (showTimersUnderLabels && isScreen) {
			const dockPx = Math.min(260, Math.max(120, Math.floor(innerH * 0.22)))
			labelSize = MV_TIMER_TITLE_PX + dockPx
			const maxChrome = Math.floor(innerH * 0.48)
			labelSize = Math.min(labelSize, maxChrome)
		} else {
			labelSize = Math.round(Math.min(36, Math.max(24, innerH * 0.1)))
			labelSize = Math.min(labelSize, Math.max(22, innerH - 20))
		}
		labelSize = Math.max(0, Math.min(labelSize, Math.max(0, innerH - 8)))
	}

	const adjustedX = px + borderSize
	const adjustedY = py + borderSize
	const adjustedW = pw - (borderSize * 2)
	const adjustedH = ph - (borderSize * 2) - labelSize

	let vx = adjustedX
	let vy = adjustedY
	let vw = adjustedW
	let vh = adjustedH

	let resolvedCh = null
	let isPgm = false
	let isPrv = false
	if (ovType === 'pgm') {
		isPgm = true
		resolvedCh = inferPgmScreen(c, programChannels)
	} else if (ovType === 'prv') {
		isPrv = true
		resolvedCh = inferPrvScreen(c, previewChannels)
	}

	if (c.aspectLocked !== false && resolvedCh && isScreen) {
		const idx = resolvedCh - 1
		const res = isPgm ? cm.programResolutions?.[idx] : (cm.previewResolutions?.[idx] || cm.programResolutions?.[idx])
		if (res && res.w > 0 && res.h > 0) {
			const s = Math.min(adjustedW / res.w, adjustedH / res.h)
			const dispW = res.w * s
			const dispH = res.h * s
			vx = adjustedX + (adjustedW - dispW) * 0.5
			vy = adjustedY + (adjustedH - dispH) * 0.5
			vw = dispW
			vh = dispH
		}
	}

	const toEditorX = (val) => (val / W) * canvasWidth
	const toEditorY = (val) => (val / H) * canvasHeight

	return {
		x: toEditorX(vx),
		y: toEditorY(vy),
		w: toEditorX(vw),
		h: toEditorY(vh),
		lx: toEditorX(vx),
		ly: toEditorY(vy + vh + borderSize),
		lw: toEditorX(vw),
		lh: toEditorY(labelSize),
	}
}

export function resolveSourceAspectRatio(cell, cm = {}) {
	const programChannels = cm.programChannels || []
	const previewChannels = cm.previewChannels || []
	const ovType = getCellOverlayType(cell, programChannels, previewChannels)

	let resolvedCh = null
	let isPgm = false
	if (ovType === 'pgm') {
		isPgm = true
		resolvedCh = inferPgmScreen(cell, programChannels)
	} else if (ovType === 'prv') {
		resolvedCh = inferPrvScreen(cell, previewChannels)
	}

	if (resolvedCh) {
		const idx = resolvedCh - 1
		const res = isPgm ? cm.programResolutions?.[idx] : (cm.previewResolutions?.[idx] || cm.programResolutions?.[idx])
		if (res && res.w > 0 && res.h > 0) {
			return res.w / res.h
		}
	}
	return (cell.w && cell.h) ? cell.w / cell.h : 16 / 9
}

export function solveCellDimensions(w, h, ratio, lockType, ovType, showTimersUnderLabels) {
	const borderSize = 3
	const isScreen = ovType === 'pgm' || ovType === 'prv'

	if (lockType === 'width') {
		const innerW = Math.max(0, w - borderSize * 2)
		const innerH = innerW / ratio
		let labelSize = 0
		if (ovType !== 'timers') {
			if (showTimersUnderLabels && isScreen) {
				const dockPx = Math.min(260, Math.max(120, Math.floor(innerH * 0.22)))
				labelSize = MV_TIMER_TITLE_PX + dockPx
				const maxChrome = Math.floor(innerH * 0.48)
				labelSize = Math.min(labelSize, maxChrome)
			} else {
				labelSize = Math.round(Math.min(36, Math.max(24, innerH * 0.1)))
				labelSize = Math.min(labelSize, Math.max(22, innerH - 20))
			}
			labelSize = Math.max(0, Math.min(labelSize, Math.max(0, innerH - 8)))
		}
		const solvedH = Math.round(innerH + borderSize * 2 + labelSize)
		return { w, h: solvedH }
	} else {
		const tempInnerH = Math.max(0, h - borderSize * 2)
		let labelSize = 0
		if (ovType !== 'timers') {
			if (showTimersUnderLabels && isScreen) {
				const dockPx = Math.min(260, Math.max(120, Math.floor(tempInnerH * 0.22)))
				labelSize = MV_TIMER_TITLE_PX + dockPx
				const maxChrome = Math.floor(tempInnerH * 0.48)
				labelSize = Math.min(labelSize, maxChrome)
			} else {
				labelSize = Math.round(Math.min(36, Math.max(24, tempInnerH * 0.1)))
				labelSize = Math.min(labelSize, Math.max(22, tempInnerH - 20))
			}
			labelSize = Math.max(0, Math.min(labelSize, Math.max(0, tempInnerH - 8)))
		}
		const innerH = Math.max(1, tempInnerH - labelSize)
		const solvedW = Math.round(innerH * ratio + borderSize * 2)
		return { w: solvedW, h }
	}
}
