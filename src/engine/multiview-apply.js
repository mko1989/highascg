/**
 * Multiview layout apply — AMCP engine (no HTTP envelope).
 * Used by routing startup, project hardware restore, and the HTTP route wrapper.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')
const { getChannelMap } = require('../config/routing')
const { infoResponseToXml, listOccupiedStageLayersInRange } = require('../caspar/channel-info-xml')
const { clearCasparChannel } = require('./caspar-channel-clear')
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

const MAX_MV_LAYERS = 48
/** Layers 1–9: DeckLink inputs (when inputsOnMvr). 10: BG color. 11+: MV cells. 60: overlay CG. */
const MV_BG_LAYER = 10
const MV_CELL_LAYER_START = 11
const OVERLAY_LAYER = 60

/**
 * Copy multiview HTML/CSS/JS and font assets to Caspar media path.
 * @param {object} ctx
 */
function deployMultiviewTemplates(ctx) {
	const basePath = (ctx.config?.local_media_path || '').trim()
	if (!basePath) return

	const templatesDir = path.join(REPO_ROOT, 'template')
	for (const tpl of [
		'multiview_master.html',
		'multiview_overlay.html',
		'multiview_overlay.css',
		'multiview_overlay.js',
		'multiview-playback-osc.js',
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
	try {
		const fontsDir = path.join(basePath, 'fonts')
		fs.mkdirSync(fontsDir, { recursive: true })
		const fontSrc = path.join(REPO_ROOT, 'template', 'fonts', 'Rewir-Light.woff')
		const fontDest = path.join(fontsDir, 'Rewir-Light.woff')
		if (fs.existsSync(fontSrc)) {
			fs.copyFileSync(fontSrc, fontDest)
			ctx.log('info', `Deployed Rewir-Light.woff to ${fontDest}`)
		}
	} catch (e) {
		ctx.log('debug', 'Auto-deploy Rewir-Light.woff: ' + (e?.message || e))
	}
}

/**
 * Resolve multiview channel number from layout body and channel map.
 * @param {object} body
 * @param {object} map
 * @returns {number|null}
 */
function resolveMultiviewChannel(body, map) {
	const n = Math.max(1, parseInt(body?.n || 1, 10) || 1)
	const mvChs = Array.isArray(map.multiviewChannels) ? map.multiviewChannels : (map.multiviewCh != null ? [map.multiviewCh] : [])
	if (mvChs.length === 0 || mvChs[n - 1] == null) return null
	return mvChs[n - 1]
}

/**
 * Apply multiview layout via AMCP.
 * @param {object} body - { n, layout, showOverlay, bgColor, showTimersUnderLabels }
 * @param {object} ctx
 * @param {{ infoXml?: string|null }} [opts] - pre-fetched INFO XML for surgical layer CLEAR
 * @returns {Promise<{ ok: true, channel: number }>}
 */
async function applyMultiviewLayout(body, ctx, opts = {}) {
	const b = body && typeof body === 'object' ? body : {}
	const layout = b.layout
	if (!ctx?.amcp) {
		throw new Error('CasparCG is not connected')
	}
	if (!Array.isArray(layout) || layout.length === 0) {
		throw new Error('layout array required')
	}

	const map = getChannelMap(ctx.config || {}, ctx.switcherOutputBusByChannel)
	const ch = resolveMultiviewChannel(b, map)
	if (ch == null) {
		throw new Error(`Multiviewer ${Math.max(1, parseInt(b.n || 1, 10) || 1)} not enabled`)
	}

	const showOverlay = !!b.showOverlay
	const bgColor = typeof b.bgColor === 'string' && b.bgColor.trim() ? b.bgColor.trim() : '#000000'
	const showTimersUnderLabels = !!b.showTimersUnderLabels
	const inputsCh = map.inputsCh
	const decklinkInputChannels = Array.isArray(map.decklinkInputChannels) ? map.decklinkInputChannels : []
	const previewChannels = Array.isArray(map.previewChannels)
		? map.previewChannels.filter((chNum) => Number.isFinite(Number(chNum)))
		: []
	const programChannels = map.programChannels || Array.from({ length: map.screenCount || 4 }, (_, i) => map.programCh(i + 1))
	const infoXml = opts.infoXml ?? null

	deployMultiviewTemplates(ctx)

	/** Drop stale LED test layer 999 on routed PGM/PRV sources when test pattern is not active. */
	if (!ctx._ledTestPatternActive) {
		const routed = new Set()
		for (const cell of layout) {
			const route = routeForCell(cell, map, inputsCh, previewChannels)
			const m = String(route || '').match(/^route:\/\/(\d+)/i)
			if (!m) continue
			const routeCh = parseInt(m[1], 10)
			if (programChannels.includes(routeCh) || previewChannels.includes(routeCh)) routed.add(routeCh)
		}
		if (routed.size > 0) {
			const { clearLedTestLayerOnChannels } = require('../bootstrap/startup-led-test-pattern')
			await clearLedTestLayerOnChannels(ctx.amcp, [...routed], ctx.log?.bind(ctx))
		}
	}

	/** Live resolutions for PGM/PRV contain-fill (ultrawide / custom canvas, e.g. 15360×1728). */
	let cmForMv = null
	try {
		cmForMv = require('../config/channel-map-from-ctx').buildChannelMap(ctx)
	} catch (_) {
		cmForMv = null
	}

	const lastCellLayer = MV_CELL_LAYER_START + Math.max(0, layout.length) - 1
	const needed = new Set([MV_BG_LAYER])
	for (let L = MV_CELL_LAYER_START; L <= lastCellLayer; L++) needed.add(L)
	if (showOverlay) needed.add(OVERLAY_LAYER)

	let layersToClear = []
	const occupiedList = infoXml != null ? await listOccupiedStageLayersInRange(infoXml, MV_BG_LAYER, OVERLAY_LAYER) : null
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
		const maxCellLayer = MV_CELL_LAYER_START + Math.max(layout.length, MAX_MV_LAYERS)
		for (let L = MV_BG_LAYER; L <= maxCellLayer; L++) layersToClear.push(L)
		layersToClear.push(OVERLAY_LAYER)
		ctx.log('debug', `Multiview: broad CLEAR on ch ${ch} (INFO XML missing or unparseable)`)
	}
	if (layersToClear.length > 0) {
		ctx.log('debug', `Multiview: CLEAR ${ch} (was ${layersToClear.length} per-layer slot(s) in 10–60)`)
		await clearCasparChannel(ctx.amcp, ch, ctx)
	}

	try {
		const colorData = JSON.stringify({ color: bgColor })
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

	let layer = MV_CELL_LAYER_START
	const failed = []
	for (const cell of layout) {
		const route = routeForCell(cell, map, inputsCh, previewChannels)
		const ovType = overlayType(cell, programChannels, previewChannels, inputsCh, decklinkInputChannels)

		let vx = cell.x
		let vy = cell.y
		let vw = cell.w
		let vh = cell.h

		if (ovType !== 'timers') {
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
		throw new Error(base + hint)
	}
	if (failed.length > 0) {
		ctx.log('warn', `Multiview: ${failed.length} cell(s) failed: ${failed.map((f) => `L${f.layer} ${f.route} (${f.err})`).join('; ')}`)
	}

	if (showOverlay) {
		const { buildChannelMap } = require('../config/channel-map-from-ctx')
		const cm = buildChannelMap(ctx)

		const cells = layout.map((c) => {
			const ovTypeCell = overlayType(c, programChannels, previewChannels, inputsCh, decklinkInputChannels)
			let suffix = ''
			let channelNum = null
			let screenIdx = -1

			if (ovTypeCell === 'pgm') {
				screenIdx = inferPgmScreen(c, programChannels) - 1
				channelNum = programChannels[screenIdx] || null
				const res = cm.programResolutions?.[screenIdx]
				if (res && res.w > 0 && res.h > 0) {
					suffix = ` (${res.w}x${res.h} ${res.fps}p)`
				}
			} else if (ovTypeCell === 'prv') {
				screenIdx = inferPrvScreen(c, previewChannels) - 1
				channelNum = previewChannels[screenIdx] || null
				const res = cm.previewResolutions?.[screenIdx] || cm.programResolutions?.[screenIdx]
				if (res && res.w > 0 && res.h > 0) {
					suffix = ` (${res.w}x${res.h} ${res.fps}p)`
				}
			}

			const displayLabel = c.label || c.id || ''
			const { chromeBottomFrac } = chromeReserveForCellLayout(c, ovTypeCell, showTimersUnderLabels)
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
				type: ovTypeCell,
				screenIdx,
				channelNum,
				chromeBottomFrac: c._calc ? (c._calc.lh / c._calc.vh) : chromeBottomFrac,
			}
		})

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
			const ovTypeCell = overlayType(c, programChannels, previewChannels, inputsCh, decklinkInputChannels)
			const pgmM = c.id?.match(/^pgm(?:_(\d+))?$/)
			const prvM = c.id?.match(/^prv(?:_(\d+))?$/)
			let n = 1
			if (pgmM || ovTypeCell === 'pgm') {
				if (pgmM?.[1] != null) n = parseInt(pgmM[1], 10) + 1
				else if (c.source && String(c.source).startsWith('route://')) {
					const chNum = parseInt(String(c.source).replace(/^route:\/\//, '').split('-')[0], 10)
					if (!isNaN(chNum) && programChannels.includes(chNum))
						n = programChannels.indexOf(chNum) + 1
					else n = inferPgmScreen(c, programChannels)
				} else n = inferPgmScreen(c, programChannels)
				keyed[n === 1 ? 'pgm' : `pgm${n}`] = r
			} else if (prvM || ovTypeCell === 'prv') {
				if (prvM?.[1] != null) n = parseInt(prvM[1], 10) + 1
				else if (c.source && String(c.source).startsWith('route://')) {
					const chNum = parseInt(String(c.source).replace(/^route:\/\//, '').split('-')[0], 10)
					if (!isNaN(chNum) && previewChannels.includes(chNum))
						n = previewChannels.indexOf(chNum) + 1
					else n = inferPrvScreen(c, previewChannels)
				} else n = inferPrvScreen(c, previewChannels)
				keyed[n === 1 ? 'prev' : `prev${n}`] = r
			} else {
				let m = c.id?.match(/^(decklink|ndi)_(\d+)$/)
				if (m) {
					keyed[m[1] + m[2]] = r
				} else if (ovTypeCell === 'decklink') {
					const lblM = (c.label || '').match(/decklink\s*(\d+)/i)
					const idx = lblM ? parseInt(lblM[1], 10) - 1 : (c.source && String(c.source).match(/route:\/\/[^-]+-(\d+)/)) ? parseInt(RegExp.$1, 10) - 1 : 0
					if (idx >= 0 && idx < 8) keyed['decklink' + idx] = r
				} else if (ovTypeCell === 'ndi') {
					const lblM = (c.label || '').match(/ndi\s*(\d+)/i)
					const idx = lblM ? parseInt(lblM[1], 10) - 1 : 0
					if (idx >= 0 && idx < 8) keyed['ndi' + idx] = r
				} else {
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

	return { ok: true, channel: ch }
}

/**
 * Fetch INFO XML for multiview channel (for HTTP pre-check / surgical CLEAR).
 * @param {object} body
 * @param {object} ctx
 * @returns {Promise<{ channel: number, infoXml: string }>}
 */
async function fetchMultiviewInfoXml(body, ctx) {
	const map = getChannelMap(ctx.config || {}, ctx.switcherOutputBusByChannel)
	const ch = resolveMultiviewChannel(body, map)
	if (ch == null) {
		throw new Error(`Multiviewer ${Math.max(1, parseInt(body?.n || 1, 10) || 1)} not enabled`)
	}
	const infoRes = await ctx.amcp.info(ch)
	const infoXml = infoResponseToXml(infoRes)
	return { channel: ch, infoXml }
}

module.exports = {
	MAX_MV_LAYERS,
	MV_BG_LAYER,
	MV_CELL_LAYER_START,
	OVERLAY_LAYER,
	deployMultiviewTemplates,
	resolveMultiviewChannel,
	applyMultiviewLayout,
	fetchMultiviewInfoXml,
}
