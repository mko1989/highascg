import { multiviewState } from '../lib/multiview-state.js'
import { inputChannelResolution } from '../lib/input-channels.js'

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

export function getCellOverlayType(c, programChannels, previewChannels, cm = {}) {
	const src = c?.source?.value || c?.source || ''
	if (typeof src === 'string' && src.includes('playback_timers.html')) return 'timers'
	if (typeof src === 'string' && src.startsWith('route://')) {
		const routeCh = String(src).replace(/^route:\/\//, '').split('-')[0]
		const ch = parseInt(routeCh, 10)
		if (!isNaN(ch)) {
			if (programChannels.includes(ch)) return 'pgm'
			if (previewChannels.includes(ch)) return 'prv'
			const decklinkInputChannels = cm.decklinkInputChannels || []
			const inputsCh = cm.inputsCh
			if (decklinkInputChannels.includes(ch) || (inputsCh != null && ch === inputsCh)) return 'decklink'
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
	const ovType = getCellOverlayType(cell, programChannels, previewChannels, cm)

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

/** Native content resolution for PGM/PRV and dedicated input routes (DeckLink, V4L2, etc.). */
export function resolveCellSourceResolution(cell, cm = {}) {
	const programChannels = cm.programChannels || []
	const previewChannels = cm.previewChannels || []
	const ovType = getCellOverlayType(cell, programChannels, previewChannels, cm)

	if (ovType === 'pgm') {
		const idx = inferPgmScreen(cell, programChannels) - 1
		const res = cm.programResolutions?.[idx]
		if (res?.w > 0 && res?.h > 0) return res
	} else if (ovType === 'prv') {
		const idx = inferPrvScreen(cell, previewChannels) - 1
		const res = cm.previewResolutions?.[idx] || cm.programResolutions?.[idx]
		if (res?.w > 0 && res?.h > 0) return res
	}

	const src = cell?.source?.value || cell?.source || ''
	if (typeof src === 'string' && src.startsWith('route://')) {
		const ch = parseInt(String(src).replace(/^route:\/\//, '').split('-')[0], 10)
		if (!isNaN(ch)) {
			const res = inputChannelResolution(cm, ch)
			if (res?.w > 0 && res?.h > 0) return res
		}
	}
	return null
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
	const ovType = getCellOverlayType(c, programChannels, previewChannels, cm)
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

	if (c.aspectLocked !== false) {
		const res = resolveCellSourceResolution(c, cm)
		if (res?.w > 0 && res?.h > 0) {
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
	const res = resolveCellSourceResolution(cell, cm)
	if (res?.w > 0 && res?.h > 0) return res.w / res.h
	return 16 / 9
}

/**
 * Solve aspect-locked cell dims so video + chrome exactly fill the cell.
 * All chrome constants (border 3 px, title 28 px, dock 120–260 px) are defined in **1920×1080 MV
 * stage pixels** — the space the server reserves chrome in (`chromeReserveForCellLayout`,
 * `src/engine/multiview-layout-helper.js`). Editor cells live in canvas pixels, so we convert to
 * stage space, solve there, and convert back; solving directly in canvas pixels reserved the wrong
 * dock space whenever the canvas is not 1920×1080 and the applied video ended up letterboxed
 * (WO-151 B151.1 — the error is largest with the timers dock).
 * @param {number} w cell width in editor-canvas px
 * @param {number} h cell height in editor-canvas px
 */
export function solveCellDimensions(w, h, ratio, lockType, ovType, showTimersUnderLabels) {
	const canvasW = multiviewState.canvasWidth || 1920
	const canvasH = multiviewState.canvasHeight || 1080
	const sw = (w / canvasW) * 1920
	const sh = (h / canvasH) * 1080
	const solved = solveCellDimensionsStagePx(sw, sh, ratio, lockType, ovType, showTimersUnderLabels)
	return {
		w: Math.round((solved.w / 1920) * canvasW),
		h: Math.round((solved.h / 1080) * canvasH),
	}
}

/**
 * Chrome (label / timer-dock) height for a cell with inner height `cellInnerH` (stage px).
 * Must mirror server `chromeReserveForCellLayout` (`src/engine/multiview-layout-helper.js`), which
 * computes from the **full cell** inner height — not from the video height.
 */
function stageLabelSizeForCellInnerH(cellInnerH, ovType, showTimersUnderLabels) {
	if (ovType === 'timers') return 0
	const isScreen = ovType === 'pgm' || ovType === 'prv'
	let labelSize
	if (showTimersUnderLabels && isScreen) {
		const dockPx = Math.min(260, Math.max(120, Math.floor(cellInnerH * 0.22)))
		labelSize = MV_TIMER_TITLE_PX + dockPx
		const maxChrome = Math.floor(cellInnerH * 0.48)
		labelSize = Math.min(labelSize, maxChrome)
	} else {
		labelSize = Math.round(Math.min(36, Math.max(24, cellInnerH * 0.1)))
		labelSize = Math.min(labelSize, Math.max(22, cellInnerH - 20))
	}
	return Math.max(0, Math.min(labelSize, Math.max(0, cellInnerH - 8)))
}

/** Same solver in MV stage pixels (1920×1080). Mirrors server-side `chromeReserveForCellLayout`. */
export function solveCellDimensionsStagePx(w, h, ratio, lockType, ovType, showTimersUnderLabels) {
	const borderSize = 3

	if (lockType === 'width') {
		const innerW = Math.max(0, w - borderSize * 2)
		const videoH = innerW / ratio
		// Server chrome depends on the full cell height we are solving for — iterate to its fixed
		// point (labelSize is a monotone step function of cellInnerH, converges in a few steps).
		let solvedH = videoH + borderSize * 2
		for (let i = 0; i < 8; i++) {
			const labelSize = stageLabelSizeForCellInnerH(Math.max(0, solvedH - borderSize * 2), ovType, showTimersUnderLabels)
			const next = videoH + borderSize * 2 + labelSize
			if (Math.abs(next - solvedH) < 0.5) {
				solvedH = next
				break
			}
			solvedH = next
		}
		return { w, h: solvedH }
	} else {
		const tempInnerH = Math.max(0, h - borderSize * 2)
		const labelSize = stageLabelSizeForCellInnerH(tempInnerH, ovType, showTimersUnderLabels)
		const innerH = Math.max(1, tempInnerH - labelSize)
		const solvedW = innerH * ratio + borderSize * 2
		return { w: solvedW, h }
	}
}
