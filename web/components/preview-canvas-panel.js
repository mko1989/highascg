/**
 * PRV/PGM Canvas Preview Panel.
 */
import { initLiveView, initDualComposeLiveView } from './live-view.js'
import { streamState, shouldShowLiveVideo } from '../lib/stream-state.js'
import { settingsState } from '../lib/settings-state.js'
import { api } from '../lib/api-client.js'
import * as MathH from './preview-panel-math.js'
import * as ResizeH from './preview-panel-resize.js'

const G = 6; const BORDER_FADE = 400

export function initPreviewPanel(host, options) {
	const { title = 'Output preview', storageKeyPrefix = 'casparcg_preview', getOutputResolution, draw, stateStore, streamName, getStreamName = null, getDualStreamNames = null, getComposeCellDefs: getComposeCellDefsOverride = null, composePrvPgmLayoutToggle = false, fillParentHeight = false, hideInnerResize = false, onCollapsedChange = null, showDestinationVisualOverlay = false } = options
	const kC = `${storageKeyPrefix}_collapsed`; const kH = `${storageKeyPrefix}_height`; const kL = `${storageKeyPrefix}_compose_prv_pgm_layout`; const kS = `${storageKeyPrefix}_compose_prv_pgm_split`

	let layout = (localStorage.getItem(kL) === 'tb' || localStorage.getItem(kL) === 'lr') ? localStorage.getItem(kL) : 'lr'
	let prvPct = parseFloat(localStorage.getItem(kS) || '0.5'); if (isNaN(prvPct) || prvPct < 0.15 || prvPct > 0.85) prvPct = 0.5
	let collapsed = localStorage.getItem(kC) === '1'; let bodyH = parseInt(localStorage.getItem(kH) || '200', 10) || 200

	const root = document.createElement('div'); root.className = 'preview-panel' + (collapsed ? ' preview-panel--collapsed' : '') + (fillParentHeight ? ' preview-panel--fill' : '') + (composePrvPgmLayoutToggle ? ' preview-panel--compose-dual' : '')
	const cCls = layout === 'tb' ? 'preview-panel__compose-pair--tb' : 'preview-panel__compose-pair--lr'
	const bodyCls = 'preview-panel__body' + (fillParentHeight ? ' preview-panel__body--fill' : '')
	root.innerHTML = `<div class="preview-panel__header"><button class="preview-panel__toggle" aria-expanded="${!collapsed}"></button><span class="preview-panel__title">${title}</span><button class="preview-panel__compose-layout" hidden></button><span class="preview-panel__res"></span><button class="preview-panel__grab">Grab</button></div><div class="${bodyCls}"${fillParentHeight ? '' : ` style="height:${bodyH}px"`}><div class="preview-panel__resize"></div><div class="preview-panel__canvas-outer">${composePrvPgmLayoutToggle ? `<div class="preview-panel__canvas-wrap"><div class="preview-panel__compose-pair ${cCls}"><div class="preview-panel__compose-cell preview-panel__compose-cell--prv"><div class="preview-panel__video-container" data-preview-webrtc="prv"></div><canvas class="preview-panel__canvas" data-compose-canvas="prv"></canvas></div><div class="preview-panel__compose-gutter"></div><div class="preview-panel__compose-cell preview-panel__compose-cell--pgm"><div class="preview-panel__video-container" data-preview-webrtc="pgm"></div><canvas class="preview-panel__canvas" data-compose-canvas="pgm"></canvas></div></div></div>` : `<div class="preview-panel__canvas-wrap"><div class="preview-panel__video-container"></div><canvas class="preview-panel__canvas"></canvas></div>`}<div class="preview-panel__visual-layout-overlay" style="display:none;position:absolute;inset:8px;pointer-events:none;"></div></div></div>`
	host.appendChild(root)

	const btn = root.querySelector('.preview-panel__toggle'); const cLayoutBtn = root.querySelector('.preview-panel__compose-layout'); const resEl = root.querySelector('.preview-panel__res'); const grabBtn = root.querySelector('.preview-panel__grab'); const body = root.querySelector('.preview-panel__body'); const resizeH = root.querySelector('.preview-panel__resize'); const wrap = root.querySelector('.preview-panel__canvas-wrap'); const cPairEl = root.querySelector('.preview-panel__compose-pair'); const cGutter = root.querySelector('.preview-panel__compose-gutter'); const layoutOverlay = root.querySelector('.preview-panel__visual-layout-overlay')
	const prvVC = root.querySelector('[data-preview-webrtc="prv"]'); const pgmVC = root.querySelector('[data-preview-webrtc="pgm"]'); const VC = root.querySelector('.preview-panel__video-container')
	const canv = root.querySelector('.preview-panel__canvas')
	const ctx = canv?.getContext('2d')
	/** @type {Array<{ id: string, role: 'pgm'|'prv', mainIndex: number, label: string, cellEl: HTMLElement, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D | null }>} */
	let composeCells = []
	let composeCellsKey = ''
	const getComposeCellDefs = () => {
		if (typeof getComposeCellDefsOverride === 'function') {
			const custom = getComposeCellDefsOverride()
			if (Array.isArray(custom) && custom.length > 0) return custom
		}
		if (!composePrvPgmLayoutToggle) return [
			{ id: 'prv_1', role: 'prv', mainIndex: 0, label: 'PRV 1' },
			{ id: 'pgm_1', role: 'pgm', mainIndex: 0, label: 'PGM 1' },
		]

		const cm = stateStore?.getState?.()?.channelMap || {}
		const screenCount = Math.max(1, cm.screenCount || 1)
		const rows = []

		for (let i = 0; i < screenCount; i++) {
			const pgmCh = cm.programChannels?.[i] ?? null
			const prvCh = cm.previewChannels?.[i] ?? null
			const hasPreview = cm.previewEnabledByMain?.[i] !== false && prvCh != null
			const labelBase = cm.virtualMainChannels?.[i]?.name || `Screen ${i + 1}`

			rows.push({
				id: `pgm_${i + 1}`,
				role: 'pgm',
				mainIndex: i,
				label: `PGM · ${labelBase}${pgmCh != null ? ` (ch ${pgmCh})` : ''}`,
			})
			if (hasPreview) {
				rows.push({
					id: `prv_${i + 1}`,
					role: 'prv',
					mainIndex: i,
					label: `PRV · ${labelBase}${prvCh != null ? ` (ch ${prvCh})` : ''}`,
				})
			}
		}

		// Sort PRV first for side-by-side (LR), but we'll handle TB with flex-reverse.
		return rows.sort((a, b) => a.mainIndex - b.mainIndex || (a.role === 'prv' ? -1 : 1))
	}
	const rebuildComposeCellsIfNeeded = () => {
		if (!composePrvPgmLayoutToggle || !cPairEl) return
		const defs = getComposeCellDefs()
		const key = JSON.stringify(defs.map((d) => ({ id: d.id, role: d.role, mainIndex: d.mainIndex })))
		if (key === composeCellsKey) return
		composeCellsKey = key
		cPairEl.innerHTML = ''
		composeCells = []
		defs.forEach((d, idx) => {
			const cell = document.createElement('div')
			cell.className = `preview-panel__compose-cell preview-panel__compose-cell--${d.role}`
			const v = document.createElement('div')
			v.className = 'preview-panel__video-container'
			v.dataset.previewWebrtc = d.role
			const c = document.createElement('canvas')
			c.className = 'preview-panel__canvas preview-panel__canvas--compose-cell'
			c.dataset.composeCanvas = d.role
			c.style.display = 'block'
			cell.append(v, c)
			if (idx > 0) {
				const g = document.createElement('div')
				g.className = 'preview-panel__compose-gutter'
				cPairEl.appendChild(g)
			}
			cPairEl.appendChild(cell)
			const badge = document.createElement('div')
			badge.textContent = d.label
			badge.style.position = 'absolute'
			badge.style.left = '4px'
			badge.style.top = '4px'
			badge.style.padding = '1px 5px'
			badge.style.borderRadius = '999px'
			badge.style.fontSize = '10px'
			badge.style.lineHeight = '1.2'
			badge.style.color = 'rgba(230,237,243,0.95)'
			badge.style.background = 'rgba(0,0,0,0.55)'
			badge.style.border = '1px solid rgba(255,255,255,0.22)'
			badge.style.pointerEvents = 'none'
			cell.style.position = 'relative'
			cell.appendChild(badge)
			composeCells.push({
				id: d.id,
				role: d.role,
				mainIndex: d.mainIndex,
				label: d.label,
				cellEl: cell,
				canvas: c,
				ctx: c.getContext('2d'),
			})
		})
	}

	let rafDraw = null; let prevLive = false; let offTimer = null; let liveView = null; let pollTimer = null
	let destinationLayoutRenderKey = ''
	const scheduleDraw = () => { if (rafDraw == null) rafDraw = requestAnimationFrame(() => { rafDraw = null; paint() }) }
	const renderDestinationLayoutOverlay = () => {
		if (!showDestinationVisualOverlay || !layoutOverlay) return
		const cfg = settingsState.getSettings() || {}
		const dests = Array.isArray(cfg?.tandemTopology?.destinations) ? cfg.tandemTopology.destinations : []
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
			const w = Math.max(120, Number(lay.w) || 120)
			const h = Math.max(70, Number(lay.h) || 70)
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
				sub: d.mode === 'pgm_only'
					? `Screen ${main + 1} · PGM ch ${pgm ?? '?'}`
					: `Screen ${main + 1} · PGM ch ${pgm ?? '?'} · PRV ch ${prv ?? pgm ?? '?'}`,
				pgmCh: pgm,
				prvCh: prv || pgm,
			}
			boxes.push(box)
			if (!hasExplicitLayout) fallbackDests.push(box)
		}
		// If destination layout was never saved, auto-tile so all destinations are visible (not stacked at 0,0).
		if (fallbackDests.length) {
			const cols = Math.max(1, Math.ceil(Math.sqrt(fallbackDests.length)))
			const cellW = 1920
			const cellH = 1080
			for (let i = 0; i < fallbackDests.length; i++) {
				const b = fallbackDests[i]
				const col = i % cols
				const row = Math.floor(i / cols)
				b.x = col * cellW
				b.y = row * cellH
				b.w = Math.max(120, b.w)
				b.h = Math.max(70, b.h)
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
			if (b.mode === 'pgm_only') {
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
	const paint = () => {
		if (collapsed) return; const { w, h } = getOutputResolution(); if (resEl) resEl.textContent = `${w}×${h}`; const dpr = Math.min(window.devicePixelRatio || 1, 2)
		let cw = wrap.clientWidth; let ch = wrap.clientHeight; if (!cw) cw = 320; if (!ch) ch = 160
		const isLive = !!(streamName && shouldShowLiveVideo())
		if (!composePrvPgmLayoutToggle) { canv.width = Math.round(w * dpr); canv.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); canv.style.width = `${Math.floor(w * Math.min(cw / w, ch / h))}px`; canv.style.height = `${Math.floor(h * Math.min(cw / w, ch / h))}px`; draw(ctx, w, h, isLive, {}); renderDestinationLayoutOverlay(); return }
		if (isLive) { if (offTimer) clearTimeout(offTimer); offTimer = null; root.classList.remove('preview-panel--compose-offline', 'preview-panel--compose-border-fade-out'); prevLive = true }
		else { if (prevLive) { root.classList.add('preview-panel--compose-border-fade-out'); offTimer = setTimeout(() => { root.classList.add('preview-panel--compose-offline'); root.classList.remove('preview-panel--compose-border-fade-out'); offTimer = null; scheduleDraw() }, BORDER_FADE) } else if (!offTimer) root.classList.add('preview-panel--compose-offline'); prevLive = false }
		rebuildComposeCellsIfNeeded()
		const n = Math.max(1, composeCells.length)
		const fitW = Math.max(1, Math.floor(cw))
		const fitH = Math.max(1, Math.floor(ch))
		cPairEl.style.width = `${fitW}px`
		cPairEl.style.height = `${fitH}px`
		const gutters = Array.from(cPairEl.querySelectorAll('.preview-panel__compose-gutter'))
		const specialThreePanel =
			layout === 'lr' &&
			composeCells.length === 3 &&
			composeCells[0].role === 'pgm' &&
			composeCells[1].role === 'prv' &&
			composeCells[2].role === 'pgm' &&
			composeCells[0].mainIndex === composeCells[1].mainIndex
		if (specialThreePanel) {
			for (const g of gutters) g.style.display = 'none'
			cPairEl.style.position = 'relative'
			const leftW = Math.max(32, Math.floor((fitW - G) / 2))
			const rightW = Math.max(32, fitW - G - leftW)
			const halfH = Math.max(24, Math.floor((fitH - G) / 2))
			composeCells[0].cellEl.style.cssText = `position:absolute;left:0;top:0;width:${leftW}px;height:${halfH}px`
			composeCells[1].cellEl.style.cssText = `position:absolute;left:0;top:${halfH + G}px;width:${leftW}px;height:${fitH - halfH - G}px`
			composeCells[2].cellEl.style.cssText = `position:absolute;left:${leftW + G}px;top:0;width:${rightW}px;height:${fitH}px`
		} else {
			for (const g of gutters) g.style.display = ''
			cPairEl.style.position = ''
			const availableW = fitW - (G * Math.max(0, n - 1))
			const availableH = fitH - (G * Math.max(0, n - 1))
			const cellW = layout === 'lr' ? Math.max(32, Math.floor(availableW / n)) : fitW
			const cellH = layout === 'tb' ? Math.max(24, Math.floor(availableH / n)) : fitH
			
			composeCells.forEach((item, idx) => {
				let cw = cellW
				let ch = cellH
				if (n === 2) {
					// Use prvPct for dual split
					if (layout === 'lr') {
						cw = Math.round(availableW * (idx === 0 ? prvPct : (1 - prvPct)))
					} else {
						// PGM is on top (order: -1), PRV is on bottom (order: 1). 
						// Array order is PRV, PGM. So idx=0 is PRV (bottom), idx=1 is PGM (top).
						// But the user expect PGM to be top.
						const isPgm = item.role === 'pgm'
						ch = Math.round(availableH * (isPgm ? prvPct : (1 - prvPct)))
					}
				}
				if (layout === 'tb') item.cellEl.style.cssText = `flex:0 0 ${ch}px;height:${ch}px;width:100%`
				else item.cellEl.style.cssText = `flex:0 0 ${cw}px;width:${cw}px;height:100%`
			})
			if (layout === 'tb') cPairEl.style.flexDirection = 'column-reverse'
			else cPairEl.style.flexDirection = 'row'
		}
		for (const item of composeCells) {
			const cellRect = item.cellEl.getBoundingClientRect()
			const pairRect = cPairEl.getBoundingClientRect()
			const wCell = Math.max(1, Math.round(cellRect.width || (pairRect.width / n)))
			const hCell = Math.max(1, Math.round(cellRect.height || pairRect.height))
			item.canvas.width = Math.max(1, Math.round(wCell * dpr))
			item.canvas.height = Math.max(1, Math.round(hCell * dpr))
			if (item.ctx) item.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
			draw(item.ctx, w, h, false, {
				layout,
				composeCell: item.role,
				composePrvPgmLayoutToggle: true,
				composeDualStreamPreview: true,
				composeCellViewport: { w: wCell, h: hCell },
				composeScreenIdx: item.mainIndex,
			})
		}
		renderDestinationLayoutOverlay()
	}

	const updateLive = () => {
		const currentSingle = typeof getStreamName === 'function' ? getStreamName() : streamName
		const dualNames = typeof getDualStreamNames === 'function' ? getDualStreamNames() : { prv: 'prv_1', pgm: 'pgm_1' }
		const should = !!(((composePrvPgmLayoutToggle ? dualNames?.pgm || dualNames?.prv : currentSingle)) && shouldShowLiveVideo() && !collapsed && !composePrvPgmLayoutToggle)
		if (should) {
			if (composePrvPgmLayoutToggle) {
				if (liveView?.kind !== 'dual') { if (liveView) liveView.destroy(); liveView = initDualComposeLiveView(prvVC, pgmVC) }
				liveView?.updateStreams?.(dualNames?.prv || 'prv_1', dualNames?.pgm || 'pgm_1')
			} else {
				if (liveView?.kind === 'dual') liveView.destroy()
				if (!liveView) liveView = initLiveView(VC, currentSingle || '')
				else liveView.updateStream(currentSingle || '')
			}
			if (pollTimer) clearInterval(pollTimer); pollTimer = null
		} else { if (liveView) liveView.destroy(); liveView = null; if (!collapsed && !pollTimer) pollTimer = setInterval(scheduleDraw, 2000) }
		scheduleDraw()
	}

	const setColl = (c) => { collapsed = c; root.classList.toggle('preview-panel--collapsed', c); body.hidden = c; btn.textContent = c ? '▸' : '▾'; localStorage.setItem(kC, c ? '1' : '0'); onCollapsedChange?.(c); updateLive() }
	btn.onclick = () => setColl(!collapsed); grabBtn.onclick = async () => { try { grabBtn.classList.add('busy'); await api.post('/api/amcp/print', { channel: options.getProgramChannel?.() || 1 }); grabBtn.classList.remove('busy'); grabBtn.classList.add('ok'); setTimeout(() => grabBtn.classList.remove('ok'), 1000) } catch { grabBtn.classList.add('err'); setTimeout(() => grabBtn.classList.remove('err'), 2000) } }
	if (composePrvPgmLayoutToggle) {
		cLayoutBtn.hidden = false; const syncB = () => { cLayoutBtn.textContent = layout === 'tb' ? 'Stack' : 'Side'; cPairEl.classList.remove('preview-panel__compose-pair--lr', 'preview-panel__compose-pair--tb'); cPairEl.classList.add(layout === 'tb' ? 'preview-panel__compose-pair--tb' : 'preview-panel__compose-pair--lr') }
		syncB(); cLayoutBtn.onclick = () => { layout = layout === 'tb' ? 'lr' : 'tb'; localStorage.setItem(kL, layout); syncB(); scheduleDraw() }
		ResizeH.initGutterResizing(cGutter, cPairEl, { collapsed: () => collapsed, layout: () => layout, onSplitChange: (s) => { prvPct = s; localStorage.setItem(kS, String(s)); scheduleDraw() } })
		document.addEventListener('previs:set-prv-pct', (ev) => { prvPct = ev.detail.value ?? parseFloat(localStorage.getItem(kS) || '0.5'); scheduleDraw() })
	}
	if (!hideInnerResize) ResizeH.initPanelResizing(resizeH, body, { collapsed: () => collapsed, onHeightChange: scheduleDraw, maxPanelBodyPx: () => Math.min(1200, window.innerHeight * 0.9) })
	if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(scheduleDraw); ro.observe(wrap) }
	window.addEventListener('resize', scheduleDraw); 
	const unsubS = streamState.subscribe(updateLive); 
	const unsubSe = settingsState.subscribe(updateLive)
	const unsubCm = stateStore?.on('channelMap', () => {
		rebuildComposeCellsIfNeeded()
		scheduleDraw()
	})
	body.hidden = collapsed; updateLive(); return { scheduleDraw, destroy: () => { if (rafDraw) cancelAnimationFrame(rafDraw); if (offTimer) clearTimeout(offTimer); window.removeEventListener('resize', scheduleDraw); unsubS(); unsubSe(); unsubCm?.(); if (pollTimer) clearInterval(pollTimer); if (liveView) liveView.destroy(); root.remove() } }
}
