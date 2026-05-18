/**
 * Layout helper functions for multiview.
 */

'use strict'

const MV_STAGE_W = 1920
const MV_STAGE_H = 1080
const MV_TIMER_TITLE_PX = 28

/**
 * Legacy multiview/sources used route://N-11 for PRV (old single preview layer).
 * Content now shares PGM layer numbers (10+); use full channel composite.
 */
function normalizePrvRouteSource(src, previewChannels) {
	if (typeof src !== 'string' || !src.startsWith('route://')) return src
	const rest = src.replace(/^route:\/\//, '')
	const m = rest.match(/^(\d+)-(\d+)$/)
	if (!m) return src
	const routeCh = parseInt(m[1], 10)
	const layerNum = parseInt(m[2], 10)
	if (previewChannels.includes(routeCh) && layerNum === 11) return `route://${routeCh}`
	return src
}

/**
 * Determine the route string for a given cell.
 */
function routeForCell(cell, map, inputsCh, previewChannels) {
	if (cell.source) return normalizePrvRouteSource(cell.source, previewChannels)
	// Support pgm / pgm_0 (screen 1) ... pgm_N (screen N+1)
	const pgmM = cell.id?.match(/^pgm(?:_(\d+))?$/)
	if (pgmM || cell.type === 'pgm') {
		const n = pgmM?.[1] != null ? parseInt(pgmM[1], 10) + 1 : 1
		return `route://${map.programCh(n)}`
	}
	// Support prv / prv_0 (screen 1) ... prv_N (screen N+1)
	const prvM = cell.id?.match(/^prv(?:_(\d+))?$/)
	if (prvM || cell.type === 'prv') {
		const n = prvM?.[1] != null ? parseInt(prvM[1], 10) + 1 : 1
		return `route://${map.previewCh(n) || map.programCh(n)}`
	}
	if (cell.type === 'decklink' && inputsCh) {
		let i = 1
		const idM = cell.id?.match(/decklink_(\d+)/)
		if (idM) {
			i = parseInt(idM[1], 10) + 1
		} else if (cell.source && String(cell.source).startsWith('route://')) {
			const parts = String(cell.source).replace(/^route:\/\//, '').split('-')
			if (parseInt(parts[0], 10) === inputsCh && parts[1]) i = parseInt(parts[1], 10) || 1
		} else {
			const lblM = (cell.label || '').match(/decklink\s*(\d+)/i)
			if (lblM) i = parseInt(lblM[1], 10) || 1
		}
		return `route://${inputsCh}-${i}`
	}
	return `route://${map.programCh(1)}`
}

/**
 * Infer the overlay type of a cell.
 */
function overlayType(c, programChannels, previewChannels, inputsCh) {
	const src = c.source || ''
	if (typeof src === 'string' && src.includes('playback_timers.html')) return 'timers'
	if (typeof src === 'string' && src.startsWith('route://')) {
		const routeCh = String(src).replace(/^route:\/\//, '').split('-')[0]
		const ch = parseInt(routeCh, 10)
		if (!isNaN(ch)) {
			if (programChannels.includes(ch)) return 'pgm'
			if (previewChannels.includes(ch)) return 'prv'
			if (inputsCh != null && ch === inputsCh) return 'decklink'
		}
	}
	// Fallback: infer from label when source missing (e.g. manually created cells)
	const lbl = (c.label || '').toLowerCase()
	if (/\b(?:program|pgm)\s*\d+\b|\bpgm\d+\b|pgm\s*s\s*\d+/.test(lbl)) return 'pgm'
	if (/\b(?:preview|prv)\s*\d+\b|\bprv\d+\b|prv\s*s\s*\d+/.test(lbl)) return 'prv'
	return c.type
}

/**
 * Infer the PGM screen index.
 */
function inferPgmScreen(cell, programChannels) {
	const src = cell?.source
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
	// Match web `multiview-editor-canvas-layout.js`: default cells use ids pgm, pgm_0, pgm_1, …
	const idM = cell?.id?.match(/^pgm(?:_(\d+))?$/)
	return idM?.[1] != null ? parseInt(idM[1], 10) + 1 : 1
}

/**
 * Infer the PRV screen index.
 */
function inferPrvScreen(cell, previewChannels) {
	const src = cell?.source
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

/**
 * Letterbox / pillarbox route inside the picture rect so source keeps native aspect (no stretch).
 */
function containFillInPictureRect(contentW, contentH, picX, picY, picW, picH) {
	if (!(contentW > 0 && contentH > 0 && picW > 0 && picH > 0)) {
		return {
			vx: picX / MV_STAGE_W,
			vy: picY / MV_STAGE_H,
			vw: picW / MV_STAGE_W,
			vh: picH / MV_STAGE_H,
		}
	}
	const s = Math.min(picW / contentW, picH / contentH)
	const dispW = contentW * s
	const dispH = contentH * s
	const offX = picX + (picW - dispW) * 0.5
	const offY = picY + (picH - dispH) * 0.5
	return {
		vx: offX / MV_STAGE_W,
		vy: offY / MV_STAGE_H,
		vw: dispW / MV_STAGE_W,
		vh: dispH / MV_STAGE_H,
	}
}

/**
 * Bottom chrome height in px (inside cell) + fraction of full cell height for HTML overlay.
 */
function chromeReserveForCellLayout(c, ovType, useTimersDock) {
	if (ovType === 'timers') return { labelSize: 0, chromeBottomFrac: 0 }
	const ph = Math.max(1, c.h * MV_STAGE_H)
	const borderSize = 3
	const innerH = ph - borderSize * 2
	let labelSize
	if (useTimersDock && (ovType === 'pgm' || ovType === 'prv')) {
		const dockPx = Math.min(260, Math.max(120, Math.floor(innerH * 0.22)))
		labelSize = MV_TIMER_TITLE_PX + dockPx
		const maxChrome = Math.floor(innerH * 0.48)
		labelSize = Math.min(labelSize, maxChrome)
	} else {
		labelSize = Math.round(Math.min(36, Math.max(24, innerH * 0.1)))
		labelSize = Math.min(labelSize, Math.max(22, innerH - 20))
	}
	labelSize = Math.max(0, Math.min(labelSize, Math.max(0, innerH - 8)))
	return { labelSize, chromeBottomFrac: labelSize / ph }
}

/**
 * Load HTML overlay template onto a CasparCG channel stage.
 */
async function loadOverlayTemplate(inst, mvCh, overlayLayer, jsonData) {
	// Prefer single full-screen canvas master (one DOM node, one paint path); fall back to legacy DOM overlay.
	const tryNames = ['multiview_master', 'multiview_overlay']
	for (const tplName of tryNames) {
		try {
			await inst.amcp.cgAdd(mvCh, overlayLayer, 0, tplName, 0, jsonData)
			await inst.amcp.cgUpdate(mvCh, overlayLayer, 0, jsonData)
			await inst.amcp.cgPlay(mvCh, overlayLayer, 0)
			inst.log('debug', `Multiview chrome loaded via CG ADD (${tplName})`)
			return true
		} catch (e1) {
			inst.log('debug', `CG ADD ${tplName}: ` + (e1?.message || e1))
		}
		try {
			await inst.amcp.raw(`PLAY ${mvCh}-${overlayLayer} [html] ${tplName}`)
			await new Promise((r) => setTimeout(r, 300))
			const escaped = jsonData.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
			await inst.amcp.raw(`CALL ${mvCh}-${overlayLayer} "update('${escaped}')"`)
			inst.log('debug', `Multiview chrome loaded via PLAY [html] (${tplName})`)
			return true
		} catch (e2) {
			inst.log('debug', `PLAY [html] ${tplName}: ` + (e2?.message || e2))
		}
	}
	inst.log('warn', 'Multiview chrome could not load. Deploy multiview_master.html (preferred) or multiview_overlay.html to CasparCG template-path and media-path.')
	return false
}

module.exports = {
	MV_STAGE_W,
	MV_STAGE_H,
	normalizePrvRouteSource,
	routeForCell,
	overlayType,
	inferPgmScreen,
	inferPrvScreen,
	containFillInPictureRect,
	chromeReserveForCellLayout,
	loadOverlayTemplate,
}
