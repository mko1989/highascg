/**
 * PRV/PGM Canvas Preview Panel.
 */
import { initLiveView, initDualComposeLiveView } from './live-view.js'
import { streamState, shouldShowLiveVideo } from '../lib/stream-state.js'
import { settingsState } from '../lib/settings-state.js'
import { api } from '../lib/api-client.js'
import * as ResizeH from './preview-panel-resize.js'
import { createDestinationLayoutOverlay } from './preview-canvas-destination-overlay.js'
import { isOperatorGuiModeActive } from '../lib/operator-gui-mode.js'

const G = 6; const BORDER_FADE = 400

export function initPreviewPanel(host, options) {
	const { title = 'Output preview', storageKeyPrefix = 'casparcg_preview', getOutputResolution, draw, stateStore, streamName, getStreamName = null, getDualStreamNames = null, getComposeCellDefs: getComposeCellDefsOverride = null, composePrvPgmLayoutToggle = false, fillParentHeight = false, hideInnerResize = false, onCollapsedChange = null, showDestinationVisualOverlay = false, onComposeCellRects = null } = options
	const kC = `${storageKeyPrefix}_collapsed`; const kH = `${storageKeyPrefix}_height`; const kL = `${storageKeyPrefix}_compose_prv_pgm_layout`; const kS = `${storageKeyPrefix}_compose_prv_pgm_split`; const kW = `${storageKeyPrefix}_compose_cell_weights`

	let layout = (localStorage.getItem(kL) === 'tb' || localStorage.getItem(kL) === 'lr') ? localStorage.getItem(kL) : 'lr'
	let prvPct = parseFloat(localStorage.getItem(kS) || '0.5'); if (isNaN(prvPct) || prvPct < 0.05 || prvPct > 0.95) prvPct = 0.5
	let collapsed = localStorage.getItem(kC) === '1'
	if (localStorage.getItem(kC) === null && options.defaultCollapsed != null) collapsed = !!options.defaultCollapsed
	let bodyH = parseInt(localStorage.getItem(kH) || '200', 10) || 200

	const root = document.createElement('div'); root.className = 'preview-panel' + (collapsed ? ' preview-panel--collapsed' : '') + (fillParentHeight ? ' preview-panel--fill' : '') + (composePrvPgmLayoutToggle ? ' preview-panel--compose-dual' : '')
	const cCls = layout === 'tb' ? 'preview-panel__compose-pair--tb' : 'preview-panel__compose-pair--lr'
	const bodyCls = 'preview-panel__body' + (fillParentHeight ? ' preview-panel__body--fill' : '')
	const headerEl = document.createElement('div'); headerEl.className = 'preview-panel__header'
	const toggleBtn = document.createElement('button'); toggleBtn.className = 'preview-panel__toggle'; toggleBtn.setAttribute('aria-expanded', String(!collapsed))
	const titleEl = document.createElement('span'); titleEl.className = 'preview-panel__title'; titleEl.textContent = title
	const composeLayoutBtn = document.createElement('button'); composeLayoutBtn.className = 'preview-panel__compose-layout'; composeLayoutBtn.hidden = true
	const resEl = document.createElement('span'); resEl.className = 'preview-panel__res'
	const grabBtn = document.createElement('button'); grabBtn.className = 'preview-panel__grab'; grabBtn.textContent = 'PRT PGM'
	headerEl.append(toggleBtn, titleEl, composeLayoutBtn, resEl, grabBtn)
	const bodyEl = document.createElement('div'); bodyEl.className = bodyCls; if (!fillParentHeight) bodyEl.style.height = `${bodyH}px`
	const resizeEl = document.createElement('div'); resizeEl.className = 'preview-panel__resize'
	const canvasOuterEl = document.createElement('div'); canvasOuterEl.className = 'preview-panel__canvas-outer'
	if (composePrvPgmLayoutToggle) {
		const wrapEl = document.createElement('div'); wrapEl.className = 'preview-panel__canvas-wrap'
		const pairEl = document.createElement('div'); pairEl.className = `preview-panel__compose-pair ${cCls}`
		const prvCell = document.createElement('div'); prvCell.className = 'preview-panel__compose-cell preview-panel__compose-cell--prv'
		const prvVideo = document.createElement('div'); prvVideo.className = 'preview-panel__video-container'; prvVideo.dataset.previewWebrtc = 'prv'
		const prvCanvas = document.createElement('canvas'); prvCanvas.className = 'preview-panel__canvas'; prvCanvas.dataset.composeCanvas = 'prv'
		prvCell.append(prvVideo, prvCanvas)
		const gutterEl = document.createElement('div'); gutterEl.className = 'preview-panel__compose-gutter'
		const pgmCell = document.createElement('div'); pgmCell.className = 'preview-panel__compose-cell preview-panel__compose-cell--pgm'
		const pgmVideo = document.createElement('div'); pgmVideo.className = 'preview-panel__video-container'; pgmVideo.dataset.previewWebrtc = 'pgm'
		const pgmCanvas = document.createElement('canvas'); pgmCanvas.className = 'preview-panel__canvas'; pgmCanvas.dataset.composeCanvas = 'pgm'
		pgmCell.append(pgmVideo, pgmCanvas)
		pairEl.append(prvCell, gutterEl, pgmCell)
		wrapEl.appendChild(pairEl)
		canvasOuterEl.appendChild(wrapEl)
	} else {
		const wrapEl = document.createElement('div'); wrapEl.className = 'preview-panel__canvas-wrap'
		const videoEl = document.createElement('div'); videoEl.className = 'preview-panel__video-container'
		const canvasEl = document.createElement('canvas'); canvasEl.className = 'preview-panel__canvas'
		wrapEl.append(videoEl, canvasEl)
		canvasOuterEl.appendChild(wrapEl)
	}
	const layoutOverlay = document.createElement('div'); layoutOverlay.className = 'preview-panel__visual-layout-overlay'; layoutOverlay.style.display = 'none'; layoutOverlay.style.position = 'absolute'; layoutOverlay.style.inset = '8px'; layoutOverlay.style.pointerEvents = 'none'
	bodyEl.append(resizeEl, canvasOuterEl, layoutOverlay)
	root.append(headerEl, bodyEl)
	host.appendChild(root)

	const btn = root.querySelector('.preview-panel__toggle'); const cLayoutBtn = root.querySelector('.preview-panel__compose-layout'); const resStatusEl = root.querySelector('.preview-panel__res'); const grabBtnEl = root.querySelector('.preview-panel__grab'); const body = root.querySelector('.preview-panel__body'); const resizeH = root.querySelector('.preview-panel__resize'); const wrap = root.querySelector('.preview-panel__canvas-wrap'); const cPairEl = root.querySelector('.preview-panel__compose-pair'); const layoutOverlayEl = root.querySelector('.preview-panel__visual-layout-overlay')
	const prvVC = root.querySelector('[data-preview-webrtc="prv"]'); const pgmVC = root.querySelector('[data-preview-webrtc="pgm"]'); const VC = root.querySelector('.preview-panel__video-container')
	const canv = root.querySelector('.preview-panel__canvas')
	const ctx = canv?.getContext('2d')
	/** @type {Array<{ id: string, role: 'pgm'|'prv', mainIndex: number, label: string, cellEl: HTMLElement, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D | null }>} */
	let composeCells = []
	let composeCellsKey = ''
	const getComposeCellDefs = () => {
		let cells = []
		if (typeof getComposeCellDefsOverride === 'function') {
			const custom = getComposeCellDefsOverride()
			if (Array.isArray(custom) && custom.length > 0) cells = custom
		} else if (!composePrvPgmLayoutToggle) {
			cells = [
				{ id: 'prv_1', role: 'prv', mainIndex: 0, label: 'PRV 1' },
				{ id: 'pgm_1', role: 'pgm', mainIndex: 0, label: 'PGM 1' },
			]
		} else {
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
			cells = rows
		}

		// Sort cells based on layout
		return cells.sort((a, b) => {
			if (a.mainIndex !== b.mainIndex) {
				return a.mainIndex - b.mainIndex
			}
			if (layout === 'tb') {
				// PGM on top, so PGM first
				return a.role === 'pgm' ? -1 : 1
			} else {
				// PRV on left, so PRV first
				return a.role === 'prv' ? -1 : 1
			}
		})
	}

	const getWeights = () => {
		const defs = getComposeCellDefs()
		const n = defs.length
		if (n === 0) return []

		let saved = {}
		try {
			saved = JSON.parse(localStorage.getItem(kW) || '{}')
		} catch (_) {
			// Fall back to an empty storage object when weights cannot be parsed.
		}

		// Fallback/Legacy support:
		if (n === 2 && localStorage.getItem(kS) !== null) {
			const legacyPct = parseFloat(localStorage.getItem(kS))
			if (!isNaN(legacyPct) && legacyPct >= 0.05 && legacyPct <= 0.95) {
				const prvIdx = defs.findIndex(d => d.role === 'prv')
				const pgmIdx = defs.findIndex(d => d.role === 'pgm')
				if (prvIdx !== -1 && pgmIdx !== -1) {
					saved[defs[prvIdx].id] = prvIdx === 0 ? legacyPct : (1 - legacyPct)
					saved[defs[pgmIdx].id] = pgmIdx === 0 ? legacyPct : (1 - legacyPct)
				}
			}
		}

		let weights = defs.map(d => {
			const w = parseFloat(saved[d.id])
			return (isNaN(w) || w <= 0) ? 1.0 : w
		})

		const sum = weights.reduce((a, b) => a + b, 0)
		return weights.map(w => w / sum)
	}

	const saveWeights = (newWeights) => {
		const defs = getComposeCellDefs()
		let saved = {}
		try {
			saved = JSON.parse(localStorage.getItem(kW) || '{}')
		} catch (_) {
			// Fall back to an empty storage object when weights cannot be parsed.
		}
		defs.forEach((d, idx) => {
			saved[d.id] = newWeights[idx]
		})
		localStorage.setItem(kW, JSON.stringify(saved))
	}

	const updateCellSplit = (i, s) => {
		const defs = getComposeCellDefs()
		const n = defs.length
		if (n <= 1 || i < 0 || i >= n - 1) return

		const weights = getWeights()
		const cumWeights = []
		let sum = 0
		for (let j = 0; j < n; j++) {
			sum += weights[j]
			cumWeights.push(sum)
		}

		const prevCum = i > 0 ? cumWeights[i - 1] : 0.0
		const nextCum = cumWeights[i + 1]

		const minLimit = prevCum + 0.05
		const maxLimit = nextCum - 0.05
		const clampedS = Math.max(minLimit, Math.min(maxLimit, s))

		weights[i] = clampedS - prevCum
		weights[i + 1] = nextCum - clampedS

		saveWeights(weights)
		
		if (n === 2) {
			prvPct = weights[0]
			localStorage.setItem(kS, String(prvPct))
		}

		scheduleDraw()
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
				ResizeH.initGutterResizing(g, cPairEl, {
					collapsed: () => collapsed,
					layout: () => layout,
					onSplitChange: (s) => {
						updateCellSplit(idx - 1, s)
					}
				})
			}
			cPairEl.appendChild(cell)
			const badge = document.createElement('div')
			badge.style.position = 'absolute'
			if (d.role === 'pgm') {
				badge.style.right = '4px'
			} else {
				badge.style.left = '4px'
			}
			badge.style.top = '4px'
			badge.style.padding = '1px 5px'
			badge.style.borderRadius = '999px'
			badge.style.fontSize = '10px'
			badge.style.lineHeight = '1.2'
			badge.style.color = 'rgba(230,237,243,0.95)'
			badge.style.background = 'rgba(0,0,0,0.55)'
			badge.style.border = '1px solid rgba(255,255,255,0.22)'
			badge.style.pointerEvents = 'auto'
			badge.style.zIndex = '10'
			
			if (d.role === 'pgm') {
				badge.style.cursor = 'pointer'
				badge.title = 'Edit live on PGM'
				badge.onclick = (e) => {
					console.log('PGM badge clicked, mainIndex:', d.mainIndex)
					e.stopPropagation()
					document.dispatchEvent(new CustomEvent('scenes-edit-live-on-pgm', { detail: { mainIndex: d.mainIndex } }))
				}
				const lockSpan = document.createElement('span')
				lockSpan.textContent = '🔓 '
				badge.appendChild(lockSpan)
				
				const textSpan = document.createElement('span')
				textSpan.textContent = d.label
				badge.appendChild(textSpan)
			} else {
				const textSpan = document.createElement('span')
				textSpan.textContent = d.label
				badge.appendChild(textSpan)
			}
			
			cell.style.position = 'relative'
			cell.appendChild(badge)

			const zoomContainer = document.createElement('div')
			zoomContainer.className = 'preview-panel__zoom-wrap'
			zoomContainer.style.cssText = 'position:absolute;right:4px;bottom:4px;display:flex;align-items:center;gap:4px;padding:2px 6px;border-radius:999px;font-size:9px;color:rgba(230,237,243,0.85);background:rgba(0,0,0,0.65);border:1px solid rgba(255,255,255,0.15);z-index:10;pointer-events:auto;'
			
			const zoomLabel = document.createElement('span')
			zoomLabel.textContent = '1.0x'
			
			const zoomMinus = document.createElement('button')
			zoomMinus.type = 'button'
			zoomMinus.textContent = '-'
			zoomMinus.style.cssText = 'background:transparent;border:none;color:inherit;font-size:11px;font-weight:bold;cursor:pointer;padding:0 4px;display:inline-flex;align-items:center;justify-content:center;user-select:none;line-height:1;'
			
			const zoomPlus = document.createElement('button')
			zoomPlus.type = 'button'
			zoomPlus.textContent = '+'
			zoomPlus.style.cssText = 'background:transparent;border:none;color:inherit;font-size:11px;font-weight:bold;cursor:pointer;padding:0 4px;display:inline-flex;align-items:center;justify-content:center;user-select:none;line-height:1;'
			
			const zoomSlider = document.createElement('input')
			zoomSlider.type = 'range'
			zoomSlider.min = '0.5'
			zoomSlider.max = '3'
			zoomSlider.step = '0.05'
			zoomSlider.value = '1'
			zoomSlider.setAttribute('value', '1')
			zoomSlider.defaultValue = '1'
			zoomSlider.style.cssText = 'width:50px;height:4px;margin:0;cursor:pointer;opacity:0.8;accent-color:#58a6ff;'
			
			const cellObj = {
				id: d.id,
				role: d.role,
				mainIndex: d.mainIndex,
				label: d.label,
				cellEl: cell,
				canvas: c,
				ctx: c.getContext('2d'),
				zoom: 1.0,
			}
			
			const updateZoom = (val) => {
				const clamped = Math.max(0.5, Math.min(3.0, val))
				cellObj.zoom = clamped
				zoomSlider.value = String(clamped)
				zoomLabel.textContent = `${clamped.toFixed(1)}x`
				scheduleDraw()
			}
			
			zoomSlider.addEventListener('input', () => {
				updateZoom(parseFloat(zoomSlider.value) || 1.0)
			})
			
			zoomMinus.addEventListener('click', (e) => {
				e.stopPropagation()
				updateZoom(cellObj.zoom - 0.1)
			})
			
			zoomPlus.addEventListener('click', (e) => {
				e.stopPropagation()
				updateZoom(cellObj.zoom + 0.1)
			})
			
			zoomContainer.append(zoomMinus, zoomSlider, zoomPlus, zoomLabel)
			cell.appendChild(zoomContainer)

			composeCells.push(cellObj)
		})
	}

	let rafDraw = null; let prevLive = false; let offTimer = null; let liveView = null; let pollTimer = null
	const scheduleDraw = () => { if (rafDraw == null) rafDraw = requestAnimationFrame(() => { rafDraw = null; paint() }) }
	const renderDestinationLayoutOverlay = createDestinationLayoutOverlay({
		layoutOverlay: layoutOverlayEl,
		stateStore,
		showDestinationVisualOverlay,
	})
	const paint = () => {
		if (collapsed) return; const { w, h } = getOutputResolution(); if (resStatusEl) resStatusEl.textContent = `${w}×${h}`; const dpr = Math.min(window.devicePixelRatio || 1, 2)
		let cw = wrap.clientWidth; let ch = wrap.clientHeight; if (!cw) cw = 320; if (!ch) ch = 160
		const isLive = !!(streamName && shouldShowLiveVideo())
		// WO-243/255: skip canvas draw work when operator-GUI mode shows the shaped video overlay
		// instead — inert/false otherwise.
		const operatorGuiActive = isOperatorGuiModeActive()
		if (!composePrvPgmLayoutToggle) {
			canv.width = Math.round(w * dpr)
			canv.height = Math.round(h * dpr)
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
			canv.style.width = `${Math.floor(w * Math.min(cw / w, ch / h))}px`
			canv.style.height = `${Math.floor(h * Math.min(cw / w, ch / h))}px`
			if (!operatorGuiActive) { try { draw(ctx, w, h, isLive, {}) } catch (err) { console.warn('[preview] compose draw failed:', err?.message || err) } }
			renderDestinationLayoutOverlay()
			return
		}
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
			
			const weights = getWeights()

			composeCells.forEach((item, idx) => {
				const wPct = weights[idx] ?? (1 / n)
				if (layout === 'lr') {
					const cw = Math.round(availableW * wPct)
					item.cellEl.style.cssText = `flex:0 0 ${cw}px;width:${cw}px;height:100%`
				} else {
					const ch = Math.round(availableH * wPct)
					item.cellEl.style.cssText = `flex:0 0 ${ch}px;height:${ch}px;width:100%`
				}
			})
			if (layout === 'tb') cPairEl.style.flexDirection = 'column'
			else cPairEl.style.flexDirection = 'row'
		}
		const cellRectsForOperatorGui = operatorGuiActive && typeof onComposeCellRects === 'function' ? [] : null
		for (const item of composeCells) {
			const cellRect = item.cellEl.getBoundingClientRect()
			const pairRect = cPairEl.getBoundingClientRect()
			const wCell = Math.max(1, Math.round(cellRect.width || (pairRect.width / n)))
			const hCell = Math.max(1, Math.round(cellRect.height || pairRect.height))
			item.canvas.width = Math.max(1, Math.round(wCell * dpr))
			item.canvas.height = Math.max(1, Math.round(hCell * dpr))
			if (item.ctx) item.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
			if (!operatorGuiActive) {
				try {
					draw(item.ctx, w, h, false, {
						layout,
						composeCell: item.role,
						composePrvPgmLayoutToggle: true,
						composeDualStreamPreview: true,
						composeCellViewport: { w: wCell, h: hCell },
						composeScreenIdx: item.mainIndex,
						composeCellZoom: item.zoom || 1.0,
					})
				} catch (err) {
					console.warn('[preview] compose cell draw failed:', err?.message || err)
				}
			}
			// WO-243 T243.3: reuse this getBoundingClientRect() for the operator-GUI route-hole rect report.
			if (cellRectsForOperatorGui) cellRectsForOperatorGui.push({ id: item.id, role: item.role, mainIndex: item.mainIndex, rect: cellRect })
		}
		if (cellRectsForOperatorGui) onComposeCellRects(cellRectsForOperatorGui)
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

	const setColl = (c) => { collapsed = c; root.classList.toggle('preview-panel--collapsed', c); body.hidden = c; btn.textContent = c ? '▸' : '▾'; localStorage.setItem(kC, c ? '1' : '0'); onCollapsedChange?.(c); if (c && typeof onComposeCellRects === 'function') onComposeCellRects([]); updateLive() }
	btn.onclick = () => setColl(!collapsed); grabBtnEl.onclick = async () => { try { grabBtnEl.classList.add('busy'); await api.post('/api/amcp/print', { channel: options.getProgramChannel?.() || 1 }); grabBtnEl.classList.remove('busy'); grabBtnEl.classList.add('ok'); setTimeout(() => grabBtnEl.classList.remove('ok'), 1000) } catch { grabBtnEl.classList.add('err'); setTimeout(() => grabBtnEl.classList.remove('err'), 2000) } }
	if (composePrvPgmLayoutToggle) {
		cLayoutBtn.hidden = false; const syncB = () => { cLayoutBtn.textContent = layout === 'tb' ? 'Stack' : 'Side'; cPairEl.classList.remove('preview-panel__compose-pair--lr', 'preview-panel__compose-pair--tb'); cPairEl.classList.add(layout === 'tb' ? 'preview-panel__compose-pair--tb' : 'preview-panel__compose-pair--lr') }
		syncB(); cLayoutBtn.onclick = () => { layout = layout === 'tb' ? 'lr' : 'tb'; localStorage.setItem(kL, layout); syncB(); scheduleDraw() }
		// initGutterResizing is bound dynamically to rebuilt gutters in rebuildComposeCellsIfNeeded
		document.addEventListener('previs:set-prv-pct', (ev) => {
			const val = ev.detail.value ?? parseFloat(localStorage.getItem(kS) || '0.5')
			prvPct = val
			const defs = getComposeCellDefs()
			if (defs.length === 2) {
				const weights = [val, 1 - val]
				saveWeights(weights)
			}
			scheduleDraw()
		})
	}
	if (!hideInnerResize) ResizeH.initPanelResizing(resizeH, body, { collapsed: () => collapsed, onHeightChange: scheduleDraw, maxPanelBodyPx: () => Math.min(1200, window.innerHeight * 0.9) })
	if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(scheduleDraw); ro.observe(wrap) }
	window.addEventListener('resize', scheduleDraw);
	// WO-243/255: operator-GUI mode needs rects fresh across scroll too (viewport-relative) — gated, no extra listener otherwise.
	if (isOperatorGuiModeActive()) window.addEventListener('scroll', scheduleDraw, true)
	const unsubS = streamState.subscribe(updateLive); 
	const unsubSe = settingsState.subscribe(updateLive)
	const unsubCm = stateStore?.on('channelMap', () => {
		rebuildComposeCellsIfNeeded()
		scheduleDraw()
	})
	body.hidden = collapsed; 
	updateLive(); 
	// Force an initial draw and cell rebuild to ensure canvases are populated even before first state update.
	rebuildComposeCellsIfNeeded();
	scheduleDraw();
	return { scheduleDraw, destroy: () => { if (rafDraw) cancelAnimationFrame(rafDraw); if (offTimer) clearTimeout(offTimer); window.removeEventListener('resize', scheduleDraw); window.removeEventListener('scroll', scheduleDraw, true); unsubS(); unsubSe(); unsubCm?.(); if (pollTimer) clearInterval(pollTimer); if (liveView) liveView.destroy(); if (typeof onComposeCellRects === 'function') onComposeCellRects([]); root.remove() } }
}
