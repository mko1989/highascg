/**
 * POST /api/multiview/apply — layout cells + route layers; single full-screen CG chrome template (multiview_master) draws all borders/labels/timers.
 * @see companion-module-casparcg-server/src/api-routes.js handleMultiviewApply
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getChannelMap } = require('../config/routing-map')
const persistence = require('../utils/persistence')
const { infoResponseToXml, listOccupiedStageLayersInRange } = require('../caspar/channel-info-xml')
const {
	MV_STAGE_W,
	MV_STAGE_H,
	routeForCell,
	overlayType,
	inferPgmScreen,
	inferPrvScreen,
	containFillInPictureRect,
	chromeReserveForCellLayout,
	loadOverlayTemplate,
} = require('./multiview-layout-helper')

const MULTIVIEW_APPLY_TIMEOUT_MS = 25_000

async function handleMultiviewApply(body, ctx) {
	const b = parseBody(body)
	const n = Math.max(1, parseInt(b.n || 1, 10) || 1)
	const layout = b.layout
	const showOverlay = !!b.showOverlay
	const bgColor = typeof b.bgColor === 'string' && b.bgColor.trim() ? b.bgColor.trim() : '#000000'
	if (!Array.isArray(layout)) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'layout array required' }) }
	}
	const MAX_MV_LAYERS = 48
	const map = getChannelMap(ctx.config || {}, ctx.switcherOutputBusByChannel)
	const mvChs = Array.isArray(map.multiviewChannels) ? map.multiviewChannels : (map.multiviewCh != null ? [map.multiviewCh] : [])
	if (mvChs.length === 0 || mvChs[n - 1] == null) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: `Multiviewer ${n} not enabled` }) }
	}
	const ch = mvChs[n - 1]
	const inputsCh = map.inputsCh

	// Pre-check: verify multiview channel exists; keep INFO XML for surgical CLEAR (only drop stale layers)
	let infoRes
	try {
		infoRes = await ctx.amcp.info(ch)
	} catch (e) {
		const raw = (e?.message || (e && typeof e.toString === 'function' ? e.toString() : '') || String(e) || '').trim()
		const isConnection = /not connected|socket|econnrefused|etimedout|econnreset|connection refused|network/i.test(raw) ||
			raw.toLowerCase().includes('not connected')
		const msg = isConnection
			? 'CasparCG is not connected. Check module Settings → Connection and ensure CasparCG server is running.'
			: (raw.includes('404') || raw.includes('401')
				? `Channel ${ch} does not exist on CasparCG. Enable "Multiview channel" in module Settings → Screens, then use "Apply server config and restart" to create it.`
				: raw)
		return { status: isConnection ? 503 : 400, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
	}

	const infoXml = infoResponseToXml(infoRes)

	const previewChannels = Array.isArray(map.previewChannels)
		? map.previewChannels.filter((ch) => Number.isFinite(Number(ch)))
		: []

	const programChannels = map.programChannels || Array.from({ length: map.screenCount || 4 }, (_, i) => map.programCh(i + 1))

	/** Layers 1–9: DeckLink inputs (when inputsOnMvr). 10: BG color. 11+: MV cells. 60: overlay CG. */
	const MV_BG_LAYER = 10
	const MV_CELL_LAYER_START = 11
	const OVERLAY_LAYER = 60

	// Auto-deploy templates to media/template paths
	const basePath = (ctx.config?.local_media_path || '').trim()
	if (basePath) {
		const { REPO_ROOT } = require('../repo-paths')
		const templatesDir = path.join(REPO_ROOT, 'template')
		for (const tpl of [
			'multiview_master.html',
			'multiview_overlay.html',
			'multiview_overlay.css',
			'multiview_overlay.js',
			'color_bg.html',
		]) {
			try {
				const dest = path.join(basePath, tpl)
				const src = path.join(templatesDir, tpl)
				if (fs.existsSync(src)) {
					fs.copyFileSync(src, dest)
					ctx.log('info', `Deployed ${tpl} to ${dest}`)
				}
			} catch (e) {
				ctx.log('debug', `Auto-deploy ${tpl}: ` + (e?.message || e))
			}
		}
	}

	const doApply = async () => {
		/** Live resolutions for PGM/PRV contain-fill (ultrawide / custom canvas, e.g. 15360×1728). */
		let cmForMv = null
		try {
			cmForMv = require('../config/channel-map-from-ctx').buildChannelMap(ctx)
		} catch (_) {
			cmForMv = null
		}

		// Layers we will (re)use: BG, one layer per cell, optional HTML overlay (preserve DeckLink 1–9)
		const lastCellLayer = MV_CELL_LAYER_START + Math.max(0, layout.length) - 1
		const needed = new Set([MV_BG_LAYER])
		for (let L = MV_CELL_LAYER_START; L <= lastCellLayer; L++) needed.add(L)
		if (showOverlay) needed.add(OVERLAY_LAYER)

		let layersToClear = []
		const occupiedList = await listOccupiedStageLayersInRange(infoXml, MV_BG_LAYER, OVERLAY_LAYER)
		if (occupiedList != null) {
			for (const L of occupiedList) {
				if (!needed.has(L)) layersToClear.push(L)
			}
			if (layersToClear.length > 0) {
				ctx.log(
					'debug',
					`Multiview: surgical CLEAR on ch ${ch} layers ${layersToClear.join(', ')} (INFO had ${occupiedList.length} slot(s) in 10–60, need ${needed.size})`,
				)
			}
		} else {
			// No usable INFO XML — same behavior as before so stale cells are not left behind
			const maxCellLayer = MV_CELL_LAYER_START + Math.max(layout.length, MAX_MV_LAYERS)
			for (let L = MV_BG_LAYER; L <= maxCellLayer; L++) layersToClear.push(L)
			layersToClear.push(OVERLAY_LAYER)
			ctx.log('debug', `Multiview: broad CLEAR on ch ${ch} (INFO XML missing or unparseable)`)
		}
		for (const L of layersToClear) {
			try {
				await ctx.amcp.clear(ch, L)
			} catch {}
		}

		// Layer 10: solid background color
		try {
			const colorData = JSON.stringify({ color: bgColor })
			// Try CG ADD first (template-path), then PLAY [html] fallback
			try {
				await ctx.amcp.cgAdd(ch, MV_BG_LAYER, 0, 'color_bg', 1, colorData)
				await ctx.amcp.cgUpdate(ch, MV_BG_LAYER, 0, colorData)
				ctx.log('debug', `Multiview BG layer ${MV_BG_LAYER}: color ${bgColor} via CG ADD`)
			} catch {
				try {
					await ctx.amcp.raw(`PLAY ${ch}-${MV_BG_LAYER} [html] color_bg`)
					await new Promise((r) => setTimeout(r, 200))
					const escaped = colorData.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
					await ctx.amcp.raw(`CALL ${ch}-${MV_BG_LAYER} "update('${escaped}')"`) 
					ctx.log('debug', `Multiview BG layer ${MV_BG_LAYER}: color ${bgColor} via PLAY [html]`)
				} catch (e2) {
					ctx.log('warn', `Multiview BG: could not load color_bg template. Deploy color_bg.html to CasparCG media/template path. (${e2?.message || e2})`)
				}
			}
		} catch (e) {
			ctx.log('debug', 'Multiview BG setup: ' + (e?.message || e))
		}

		// Layers 11+: multiview cells
		let layer = MV_CELL_LAYER_START
		const failed = []
		const showTimersUnderLabels = !!b.showTimersUnderLabels
		
		for (const cell of layout) {
			const route = routeForCell(cell, map, inputsCh, previewChannels)
			const ovType = overlayType(cell, programChannels, previewChannels, inputsCh)
			
			// Adjust coordinates if it has a border and label so the source is NOT covered
			let vx = cell.x
			let vy = cell.y
			let vw = cell.w
			let vh = cell.h
			
			if (ovType !== 'timers') {
				// Picture rect = inner tile minus bottom chrome (labels/timers). Video is letterboxed inside that rect only.
				const px = cell.x * MV_STAGE_W
				const py = cell.y * MV_STAGE_H
				const pw = cell.w * MV_STAGE_W
				const ph = cell.h * MV_STAGE_H
				
				const borderSize = 3
				const { labelSize } = chromeReserveForCellLayout(cell, ovType, showTimersUnderLabels)
				
				const adjustedX = px + borderSize
				const adjustedY = py + borderSize
				const adjustedW = pw - (borderSize * 2)
				const adjustedH = ph - (borderSize * 2) - labelSize
				
				let fill = {
					vx: adjustedX / MV_STAGE_W,
					vy: adjustedY / MV_STAGE_H,
					vw: adjustedW / MV_STAGE_W,
					vh: adjustedH / MV_STAGE_H,
				}
				if (cell.aspectLocked !== false && cmForMv && (ovType === 'pgm' || ovType === 'prv')) {
					const si = ovType === 'pgm' ? inferPgmScreen(cell, programChannels) - 1 : inferPrvScreen(cell, previewChannels) - 1
					const res =
						ovType === 'pgm'
							? cmForMv.programResolutions?.[si]
							: cmForMv.previewResolutions?.[si] || cmForMv.programResolutions?.[si]
					if (res && res.w > 0 && res.h > 0) {
						fill = containFillInPictureRect(res.w, res.h, adjustedX, adjustedY, adjustedW, adjustedH)
					}
				}
				vx = Math.round(fill.vx * 1000000) / 1000000
				vy = Math.round(fill.vy * 1000000) / 1000000
				vw = Math.round(Math.max(0.01, fill.vw) * 1000000) / 1000000
				vh = Math.round(Math.max(0.01, fill.vh) * 1000000) / 1000000
				
				cell._calc = {
					vx,
					vy,
					vw,
					vh,
					lx: vx,
					ly: vy + vh + (borderSize / MV_STAGE_H),
					lw: vw,
					lh: labelSize / MV_STAGE_H,
				}
			} else {
				cell._calc = {
					vx: cell.x,
					vy: cell.y,
					vw: cell.w,
					vh: cell.h,
					lx: cell.x,
					ly: cell.y + cell.h,
					lw: cell.w,
					lh: 0,
				}
			}
			
			try {
				await ctx.amcp.play(ch, layer, route)
			} catch (e) {
				failed.push({ layer, route, err: e?.message || e })
				layer++
				continue
			}
			try {
				await ctx.amcp.mixerFill(ch, layer, vx, vy, vw, vh)
			} catch (e) {
				failed.push({ layer, route: 'MIXER', err: e?.message || e })
			}
			layer++
		}
		try {
			await ctx.amcp.mixerCommit(ch)
		} catch (e) {
			const base = e?.message || String(e)
			const hint = (base.includes('404') || base.includes('401') || base.includes('INVALID'))
				? ` Channel ${ch} may not exist on CasparCG. Check module Settings → Screens: enable "Multiview channel", then use "Apply server config and restart" to create channels.`
				: ''
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: base + hint }) }
		}
		if (failed.length > 0) {
			ctx.log('warn', `Multiview: ${failed.length} cell(s) failed: ${failed.map((f) => `L${f.layer} ${f.route} (${f.err})`).join('; ')}`)
		}

		if (showOverlay) {
			const { buildChannelMap } = require('../config/channel-map-from-ctx')
			const cm = buildChannelMap(ctx)

			const cells = layout.map((c) => {
				const ovType = overlayType(c, programChannels, previewChannels, inputsCh)
				let suffix = ''
				let channelNum = null
				let screenIdx = -1
				
				if (ovType === 'pgm') {
					screenIdx = inferPgmScreen(c, programChannels) - 1
					channelNum = programChannels[screenIdx] || null
					const res = cm.programResolutions?.[screenIdx]
					if (res && res.w > 0 && res.h > 0) {
						suffix = ` (${res.w}x${res.h} ${res.fps}p)`
					}
				} else if (ovType === 'prv') {
					screenIdx = inferPrvScreen(c, previewChannels) - 1
					channelNum = previewChannels[screenIdx] || null
					const res = cm.previewResolutions?.[screenIdx] || cm.programResolutions?.[screenIdx]
					if (res && res.w > 0 && res.h > 0) {
						suffix = ` (${res.w}x${res.h} ${res.fps}p)`
					}
				}
				
				const displayLabel = c.label || c.id || ''
				const { chromeBottomFrac } = chromeReserveForCellLayout(c, ovType, !!b.showTimersUnderLabels)
				return {
					id: c.id,
					label: displayLabel + suffix,
					x: c._calc ? c._calc.vx : c.x,
					y: c._calc ? c._calc.vy : c.y,
					w: c._calc ? c._calc.vw : c.w,
					h: c._calc ? c._calc.vh : c.h,
					labelX: c._calc ? c._calc.lx : c.x,
					labelY: c._calc ? c._calc.ly : (c.y + c.h),
					labelW: c._calc ? c._calc.lw : c.w,
					labelH: c._calc ? c._calc.lh : 0,
					type: ovType,
					screenIdx,
					channelNum,
					chromeBottomFrac: c._calc ? (c._calc.lh / c._calc.vh) : chromeBottomFrac,
				}
			})
			
			// Build keyed overlay slots (pgm, prev, pgm2, prev2, ...) — use route channel as primary source.
			// Each pgm/prv cell must map to a unique slot; route://N determines screen index when available.
			const keyed = {}
			for (const c of layout) {
				const r = {
					x: c._calc ? c._calc.vx : c.x,
					y: c._calc ? c._calc.vy : c.y,
					w: c._calc ? c._calc.vw : c.w,
					h: c._calc ? c._calc.vh : c.h,
					labelX: c._calc ? c._calc.lx : c.x,
					labelY: c._calc ? c._calc.ly : (c.y + c.h),
					labelW: c._calc ? c._calc.lw : c.w,
					labelH: c._calc ? c._calc.lh : 0,
					label: c.label || c.id || '',
				}
				const ovType = overlayType(c, programChannels, previewChannels, inputsCh)
				// Id-based: pgm → pgm, pgm_1 → pgm2, prv_1 → prev2
				const pgmM = c.id?.match(/^pgm(?:_(\d+))?$/)
				const prvM = c.id?.match(/^prv(?:_(\d+))?$/)
				let n = 1
				if (pgmM || ovType === 'pgm') {
					if (pgmM?.[1] != null) n = parseInt(pgmM[1], 10) + 1
					else if (c.source && String(c.source).startsWith('route://')) {
						const ch = parseInt(String(c.source).replace(/^route:\/\//, '').split('-')[0], 10)
						if (!isNaN(ch) && programChannels.includes(ch))
							n = programChannels.indexOf(ch) + 1
						else n = inferPgmScreen(c, programChannels)
					} else n = inferPgmScreen(c, programChannels)
					keyed[n === 1 ? 'pgm' : `pgm${n}`] = r
				} else if (prvM || ovType === 'prv') {
					if (prvM?.[1] != null) n = parseInt(prvM[1], 10) + 1
					else if (c.source && String(c.source).startsWith('route://')) {
						const ch = parseInt(String(c.source).replace(/^route:\/\//, '').split('-')[0], 10)
						if (!isNaN(ch) && previewChannels.includes(ch))
							n = previewChannels.indexOf(ch) + 1
						else n = inferPrvScreen(c, previewChannels)
					} else n = inferPrvScreen(c, previewChannels)
					keyed[n === 1 ? 'prev' : `prev${n}`] = r
				} else {
					let m = c.id?.match(/^(decklink|ndi)_(\d+)$/)
					if (m) {
						keyed[m[1] + m[2]] = r
					} else if (ovType === 'decklink') {
						const lblM = (c.label || '').match(/decklink\s*(\d+)/i)
						const idx = lblM ? parseInt(lblM[1], 10) - 1 : (c.source && String(c.source).match(/route:\/\/[^-]+-(\d+)/)) ? parseInt(RegExp.$1, 10) - 1 : 0
						if (idx >= 0 && idx < 8) keyed['decklink' + idx] = r
					} else if (ovType === 'ndi') {
						const lblM = (c.label || '').match(/ndi\s*(\d+)/i)
						const idx = lblM ? parseInt(lblM[1], 10) - 1 : 0
						if (idx >= 0 && idx < 8) keyed['ndi' + idx] = r
					} else {
						// Fallback: route cells with Program/Preview labels (keyed template needs pgm2, prev2, etc.)
						const lbl = (c.label || '').toLowerCase()
						const pgmN = lbl.match(/\b(?:program|pgm)\s*(\d+)\b/) || lbl.match(/\bpgm(\d+)\b/) || lbl.match(/pgm\s*s\s*(\d+)/)
						const prvN = lbl.match(/\b(?:preview|prv)\s*(\d+)\b/) || lbl.match(/\bprv(\d+)\b/) || lbl.match(/prv\s*s\s*(\d+)/)
						if (pgmN) keyed[parseInt(pgmN[1], 10) === 1 ? 'pgm' : `pgm${pgmN[1]}`] = r
						else if (prvN) keyed[parseInt(prvN[1], 10) === 1 ? 'prev' : `prev${prvN[1]}`] = r
					}
				}
			}
			const overlayData = JSON.stringify({ cells, showTimersUnderLabels, ...keyed })
			await loadOverlayTemplate(ctx, ch, OVERLAY_LAYER, overlayData)
		} else {
			try {
				await ctx.amcp.cgClear(ch, OVERLAY_LAYER)
			} catch {}
			try {
				await ctx.amcp.stop(ch, OVERLAY_LAYER)
			} catch {}
		}

		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
	}

	const timeoutPromise = new Promise((_, reject) => {
		setTimeout(() => reject(new Error('Multiview apply timed out')), MULTIVIEW_APPLY_TIMEOUT_MS)
	})

	try {
		const result = await Promise.race([doApply(), timeoutPromise])
		// Persist applied layout so it survives Companion restarts and CasparCG reconnects
		if (result?.status === 200) {
			const storeKey = n === 1 ? 'multiviewLayout' : `multiviewLayout_${n}`
			if (!ctx._multiviewLayouts) ctx._multiviewLayouts = {}
			ctx._multiviewLayouts[n] = b
			persistence.set(storeKey, b)
		}
		return result
	} catch (e) {
		if (e?.message === 'Multiview apply timed out') {
			ctx.log('warn', 'Multiview apply timed out')
			return {
				status: 504,
				headers: JSON_HEADERS,
				body: jsonBody({
					error: 'Multiview apply timed out. CasparCG may be slow or unresponsive. Try again or check the server.',
				}),
			}
		}
		throw e
	}
}

async function handlePost(path, body, ctx) {
	if (path !== '/api/multiview/apply') return null
	if (!ctx.amcp) return null
	return handleMultiviewApply(body, ctx)
}

module.exports = { handlePost, handleMultiviewApply }
