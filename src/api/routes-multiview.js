/**
 * POST /api/multiview/apply — layout cells + optional HTML overlay.
 * @see companion-module-casparcg-server/src/api-routes.js handleMultiviewApply
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getChannelMap } = require('../config/routing')
const persistence = require('../utils/persistence')

const MULTIVIEW_APPLY_TIMEOUT_MS = 25_000

async function handleMultiviewApply(body, ctx) {
	const b = parseBody(body)
	const layout = b.layout
	const showOverlay = !!b.showOverlay
	if (!Array.isArray(layout)) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'layout array required' }) }
	}
	const MAX_MV_LAYERS = 48
	const map = getChannelMap(ctx.config || {})
	if (!map.multiviewEnabled || map.multiviewCh == null) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Multiview not enabled' }) }
	}
	const ch = map.multiviewCh
	const inputsCh = map.inputsCh

	// Pre-check: verify multiview channel exists on CasparCG (avoid confusing 404 later)
	try {
		await ctx.amcp.info(ch)
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

	const previewChannels = map.previewChannels || Array.from({ length: map.screenCount || 4 }, (_, i) => map.previewCh(i + 1))
	/** Legacy multiview/sources used route://N-11 for PRV (old single preview layer). Content now shares PGM layer numbers (10+); use full channel composite. */
	const normalizePrvRouteSource = (src) => {
		if (typeof src !== 'string' || !src.startsWith('route://')) return src
		const rest = src.replace(/^route:\/\//, '')
		const m = rest.match(/^(\d+)-(\d+)$/)
		if (!m) return src
		const routeCh = parseInt(m[1], 10)
		const layerNum = parseInt(m[2], 10)
		if (previewChannels.includes(routeCh) && layerNum === 11) return `route://${routeCh}`
		return src
	}

	const routeForCell = (cell) => {
		if (cell.source) return normalizePrvRouteSource(cell.source)
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
			return `route://${map.previewCh(n)}`
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

	const OVERLAY_LAYER = 50

	async function loadOverlayTemplate(inst, mvCh, overlayLayer, jsonData) {
		// Try 1: CG ADD (uses template-path)
		try {
			await inst.amcp.cgAdd(mvCh, overlayLayer, 0, 'multiview_overlay', 0, jsonData)
			await inst.amcp.cgUpdate(mvCh, overlayLayer, 0, jsonData)
			await inst.amcp.cgPlay(mvCh, overlayLayer, 0)
			inst.log('debug', 'Multiview overlay loaded via CG ADD')
			return true
		} catch (e1) {
			inst.log('debug', 'CG ADD overlay failed: ' + (e1?.message || e1))
		}
		// Try 2: PLAY [html] with media-path relative name (media-path usually = media/)
		try {
			await inst.amcp.raw(`PLAY ${mvCh}-${overlayLayer} [html] multiview_overlay`)
			await new Promise((r) => setTimeout(r, 300))
			const escaped = jsonData.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
			await inst.amcp.raw(`CALL ${mvCh}-${overlayLayer} "update('${escaped}')"`)
			inst.log('debug', 'Multiview overlay loaded via PLAY [html] + CALL')
			return true
		} catch (e2) {
			inst.log('debug', 'PLAY [html] overlay failed: ' + (e2?.message || e2))
		}
		inst.log('warn', 'Multiview overlay could not be loaded. Place multiview_overlay.html in CasparCG template-path AND media-path folders.')
		return false
	}

	if (showOverlay) {
		const basePath = (ctx.config?.local_media_path || '').trim()
		if (basePath) {
			try {
				const dest = path.join(basePath, 'multiview_overlay.html')
				if (!fs.existsSync(dest)) {
					const src = path.join(__dirname, '..', '..', 'templates', 'multiview_overlay.html')
					if (fs.existsSync(src)) {
						fs.copyFileSync(src, dest)
						ctx.log('info', `Deployed multiview_overlay.html to ${dest}`)
					}
				}
			} catch (e) {
				ctx.log('debug', 'Auto-deploy overlay: ' + (e?.message || e))
			}
		}
	}

	const doApply = async () => {
		const layersToClear =
			layout.length > 0
				? [...Array(layout.length).keys()].map((i) => i + 1)
				: Array.from({ length: MAX_MV_LAYERS }, (_, i) => i + 1)
		if (showOverlay) layersToClear.push(OVERLAY_LAYER)
		for (const L of layersToClear) {
			try {
				await ctx.amcp.clear(ch, L)
			} catch {}
		}

		let layer = 1
		const failed = []
		for (const cell of layout) {
			const route = routeForCell(cell)
			try {
				await ctx.amcp.play(ch, layer, route)
			} catch (e) {
				failed.push({ layer, route, err: e?.message || e })
				layer++
				continue
			}
			try {
				await ctx.amcp.mixerFill(ch, layer, cell.x, cell.y, cell.w, cell.h)
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
			// Derive overlay type from source so Program 2 / Preview 2 (type: route) get pgm/prv borders
			const programChannels = map.programChannels || Array.from({ length: map.screenCount || 4 }, (_, i) => map.programCh(i + 1))
			const overlayType = (c) => {
				const src = c.source || ''
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
			function inferPgmScreen(cell) {
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
				return m ? parseInt(m[1] || m[2] || m[3] || m[4], 10) || 1 : 1
			}
			function inferPrvScreen(cell) {
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
				return m ? parseInt(m[1] || m[2] || m[3] || m[4], 10) || 1 : 1
			}
			const cells = layout.map((c) => ({
				id: c.id,
				label: c.label,
				x: c.x,
				y: c.y,
				w: c.w,
				h: c.h,
				type: overlayType(c),
			}))
			// Build keyed overlay slots (pgm, prev, pgm2, prev2, ...) — use route channel as primary source.
			// Each pgm/prv cell must map to a unique slot; route://N determines screen index when available.
			const keyed = {}
			for (const c of layout) {
				const r = { x: c.x, y: c.y, w: c.w, h: c.h, label: c.label || c.id || '' }
				const ovType = overlayType(c)
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
						else n = inferPgmScreen(c)
					} else n = inferPgmScreen(c)
					keyed[n === 1 ? 'pgm' : `pgm${n}`] = r
				} else if (prvM || ovType === 'prv') {
					if (prvM?.[1] != null) n = parseInt(prvM[1], 10) + 1
					else if (c.source && String(c.source).startsWith('route://')) {
						const ch = parseInt(String(c.source).replace(/^route:\/\//, '').split('-')[0], 10)
						if (!isNaN(ch) && previewChannels.includes(ch))
							n = previewChannels.indexOf(ch) + 1
						else n = inferPrvScreen(c)
					} else n = inferPrvScreen(c)
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
			const overlayData = JSON.stringify({ cells, ...keyed })
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
			ctx._multiviewLayout = b
			persistence.set('multiviewLayout', b)
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
