/**
 * Preview panel — destination layout visual overlay on compose canvas.
 */

import { settingsState } from '../lib/settings-state.js'
import { resolveDestinationDims } from '../lib/mapping-node-service.js'

export function createDestinationLayoutOverlay(ctx) {
	const { layoutOverlay, stateStore, showDestinationVisualOverlay } = ctx
	let destinationLayoutRenderKey = ''

	return function renderDestinationLayoutOverlay() {

		if (!showDestinationVisualOverlay || !layoutOverlay) return
		const cfg = settingsState.getSettings() || {}
		const dests = Array.isArray(cfg?.screenDestinations?.destinations) ? cfg.screenDestinations.destinations : []
		const graphLayout = cfg?.deviceGraph?.layout && typeof cfg.deviceGraph.layout === 'object' ? cfg.deviceGraph.layout : {}
		const cm = stateStore?.getState?.()?.channelMap || {}
		const boxes = []
		const fallbackDests = []
		for (const d of dests) {
			if (!d) continue
			const mode = String(d.mode || '')
			if (mode === 'multiview' || mode === 'stream') continue
			const id = String(d.id || '').trim()
			if (!id) continue
			const lay = graphLayout[id] || {}
			const hasExplicitLayout = Number.isFinite(Number(lay.x)) && Number.isFinite(Number(lay.y))
			// WO-327: the border must show the destination's REAL output aspect. A saved layout
			// keeps its position and width, but height is re-derived from the true resolution —
			// a stale rect saved before a res change must not draw a wrong-aspect border.
			const dims = resolveDestinationDims(d)
			const aspect = dims.h / Math.max(1, dims.w)
			const w = Math.max(120, Number(lay.w) || dims.w)
			const h = Math.max(70, Math.round(w * aspect))
			const x = Math.max(0, Number(lay.x) || 0)
			const y = Math.max(0, Number(lay.y) || 0)
			const main = Math.max(0, parseInt(String(d.mainScreenIndex ?? 0), 10) || 0)
			const pgm = cm.programChannels?.[main] ?? null
			const prv = cm.previewChannels?.[main] ?? null
			const box = {
				id,
				mode: String(d.mode || 'pgm_prv'),
				mainIndex: main,
				x,
				y,
				w,
				h,
				label: String(d.label || id),
				sub: d.mode === 'pgm_only' || d.mode === 'pixelmap'
					? `Screen ${main + 1} · PGM ch ${pgm ?? '?'}`
					: `Screen ${main + 1} · PGM ch ${pgm ?? '?'} · PRV ch ${prv ?? pgm ?? '?'}`,
				pgmCh: pgm,
				prvCh: prv || pgm,
			}
			boxes.push(box)
			if (!hasExplicitLayout) fallbackDests.push(box)
		}
		// If destination layout was never saved, auto-tile so all destinations are visible (not
		// stacked at 0,0). WO-327: cells are sized per destination from its true resolution —
		// the old fixed 1920x1080 grid overlapped/misplaced custom-res destinations.
		if (fallbackDests.length) {
			const cols = Math.max(1, Math.ceil(Math.sqrt(fallbackDests.length)))
			let rowY = 0
			for (let i = 0; i < fallbackDests.length; i += cols) {
				const row = fallbackDests.slice(i, i + cols)
				let colX = 0
				let rowH = 0
				for (const b of row) {
					b.x = colX
					b.y = rowY
					colX += b.w
					rowH = Math.max(rowH, b.h)
				}
				rowY += rowH
			}
		}
		if (!boxes.length) {
			layoutOverlay.style.display = 'none'
			layoutOverlay.innerHTML = ''
			destinationLayoutRenderKey = ''
			return
		}
		let maxX = 0; let maxY = 0
		for (const b of boxes) { maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h) }
		const ow = Math.max(120, layoutOverlay.clientWidth); const oh = Math.max(80, layoutOverlay.clientHeight)
		const sx = ow / Math.max(1, maxX); const sy = oh / Math.max(1, maxY); const s = Math.min(sx, sy)
		const renderKey = JSON.stringify({
			ow,
			oh,
			mv: cm.multiviewCh ?? null,
			boxes: boxes.map((b) => ({
				id: b.id,
				mode: b.mode,
				x: Math.round(b.x * s),
				y: Math.round(b.y * s),
				w: Math.max(90, Math.round(b.w * s)),
				h: Math.max(48, Math.round(b.h * s)),
				pgmCh: b.pgmCh ?? null,
				prvCh: b.prvCh ?? null,
			})),
		})
		if (renderKey === destinationLayoutRenderKey) return
		destinationLayoutRenderKey = renderKey
		layoutOverlay.innerHTML = ''
		layoutOverlay.style.display = ''
		layoutOverlay.style.background = 'rgba(0,0,0,0.26)'
		layoutOverlay.style.borderRadius = '8px'
		const renderedIds = new Set()
		for (const b of boxes) {
			renderedIds.add(b.id)
			const el = document.createElement('div')
			el.style.position = 'absolute'
			el.style.left = `${Math.round(b.x * s)}px`
			el.style.top = `${Math.round(b.y * s)}px`
			el.style.width = `${Math.max(90, Math.round(b.w * s))}px`
			el.style.height = `${Math.max(48, Math.round(b.h * s))}px`
			el.style.border = '1px solid rgba(88,166,255,0.65)'
			el.style.background = 'rgba(13,17,23,0.32)'
			el.style.borderRadius = '8px'
			el.style.color = 'rgba(230,237,243,0.92)'
			el.style.fontSize = '11px'
			el.style.lineHeight = '1.2'
			el.style.padding = '4px 6px'
			el.style.boxSizing = 'border-box'
			const title = document.createElement('strong')
			title.style.display = 'block'
			title.style.whiteSpace = 'nowrap'
			title.style.overflow = 'hidden'
			title.style.textOverflow = 'ellipsis'
			title.textContent = b.label
			const sub = document.createElement('small')
			sub.style.opacity = '0.9'
			sub.textContent = b.sub
			el.append(title, sub)
			const frame = document.createElement('div')
			frame.style.position = 'absolute'
			frame.style.left = '6px'
			frame.style.right = '6px'
			frame.style.top = '24px'
			frame.style.bottom = '6px'
			frame.style.border = '1px solid rgba(255,255,255,0.2)'
			frame.style.background = 'rgba(0,0,0,0.35)'
			frame.style.borderRadius = '4px'
			frame.style.overflow = 'hidden'
			el.appendChild(frame)
			if (b.mode === 'pgm_only' || b.mode === 'pixelmap') {
				const single = document.createElement('div')
				single.style.position = 'absolute'
				single.style.inset = '0'
				single.style.display = 'flex'
				single.style.alignItems = 'center'
				single.style.justifyContent = 'center'
				single.style.fontSize = '10px'
				single.style.color = 'rgba(255,255,255,0.78)'
				single.textContent = `PGM · ch ${b.pgmCh ?? '?'}`
				frame.appendChild(single)
			} else {
				const pgmPane = document.createElement('div')
				pgmPane.style.position = 'absolute'
				pgmPane.style.left = '0'
				pgmPane.style.top = '0'
				pgmPane.style.bottom = '0'
				pgmPane.style.width = '50%'
				pgmPane.style.display = 'flex'
				pgmPane.style.alignItems = 'center'
				pgmPane.style.justifyContent = 'center'
				pgmPane.style.fontSize = '10px'
				pgmPane.style.color = 'rgba(255,255,255,0.78)'
				pgmPane.textContent = `PGM ${b.pgmCh ?? '?'}`
				const prvPane = document.createElement('div')
				prvPane.style.position = 'absolute'
				prvPane.style.right = '0'
				prvPane.style.top = '0'
				prvPane.style.bottom = '0'
				prvPane.style.width = '50%'
				prvPane.style.display = 'flex'
				prvPane.style.alignItems = 'center'
				prvPane.style.justifyContent = 'center'
				prvPane.style.fontSize = '10px'
				prvPane.style.color = 'rgba(255,255,255,0.78)'
				prvPane.textContent = `PRV ${b.prvCh ?? b.pgmCh ?? '?'}`
				const sep = document.createElement('div')
				sep.style.position = 'absolute'
				sep.style.left = '50%'
				sep.style.top = '0'
				sep.style.bottom = '0'
				sep.style.width = '1px'
				sep.style.background = 'rgba(255,255,255,0.26)'
				frame.append(pgmPane, prvPane, sep)
			}
			layoutOverlay.appendChild(el)
		}
	}
}
