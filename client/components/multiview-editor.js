/**
 * Multiview editor — canvas with boxes.
 */
import { multiviewState } from '../lib/multiview-state.js'
import { initLiveView } from './live-view.js'
import { streamState, shouldShowLiveVideo } from '../lib/stream-state.js'
import { settingsState } from '../lib/settings-state.js'
import { api } from '../lib/api-client.js'
import { showAppToast } from '../lib/app-toast.js'
import { parseRouteValue } from './scenes-shared.js'
import { resolveMvCellSourceChannel } from '../lib/input-channels.js'
import { attachMathInput } from '../lib/math-input.js'
import { fitInContainer, toCanvas, getCellAt, cursorForResizeHandle, getResizeHandle, drawMultiviewEditor, applyMultiviewLayout, applyMultiviewAudioFocus, resolveSourceAspectRatio, solveCellDimensions, getCellOverlayType } from './multiview-editor-canvas.js'
import { reportMultiviewEditRect, reportMultiviewEditCellRects, isOperatorGuiModeActive } from '../lib/operator-gui-mode.js'
import { holeRectFromOuter } from '../lib/hole-rect.js'

/**
 * Create a debounced function that delays execution until the specified delay has elapsed
 * without any new calls. Pure function — no side effects.
 * @param {Function} fn - Function to debounce
 * @param {number} delayMs - Debounce delay in milliseconds
 * @returns {{ call: Function, flush: Function, cancel: Function }} Object with call/flush/cancel methods
 */
function createDebounce(fn, delayMs) {
	let timerId = null
	return {
		call: () => {
			if (timerId) clearTimeout(timerId)
			timerId = setTimeout(() => {
				timerId = null
				fn()
			}, delayMs)
		},
		flush: () => {
			if (timerId) clearTimeout(timerId)
			timerId = null
			fn()
		},
		cancel: () => {
			if (timerId) clearTimeout(timerId)
			timerId = null
		}
	}
}

function snapValue(val, candidates, threshold) {
	let bestDiff = threshold
	let bestCandidate = val
	for (const c of candidates) {
		const diff = Math.abs(val - c)
		if (diff < bestDiff) {
			bestDiff = diff
			bestCandidate = c
		}
	}
	return bestCandidate
}

export function initMultiviewEditor(root, stateStore) {
	let canvas, ctx, scale = 1, offsetX = 0, offsetY = 0, selectedId = null, dragMode = null, dragStart = { x: 0, y: 0, cell: null }, dropHoverId = null, wrap = null, disabledOverlay = null
	// Operator-GUI mode only. Hole regions in the Firefox window shape can never receive pointer
	// events — X intersects the input shape with the bounding shape (see tools/runtime shape
	// helper / commit 8cf5fc4). Two blend modes for the editor dock:
	//  - BLEND (default): one inset hole PER CELL, each routing that cell's own source channel —
	//    live video shows inside every window while the canvas-drawn chrome around the holes
	//    (borders / label strip / resize handles) stays solid and clickable. Any pointer-drag on
	//    the canvas suppresses all holes live (operator-gui-interaction-suppress.js), so
	//    moving/resizing works everywhere mid-drag.
	//  - FULL OUTPUT (toggle): the old single whole-dock hole showing the real composited
	//    multiview channel (incl. its own labels/timers/bg) — click-dead, view-only.
	let mvOperatorFullOutput = false
	/** Viewport-px insets keeping editor chrome outside the per-cell holes ({@link holeRectFromOuter}). */
	const MV_BLEND_INSETS = { top: 20, right: 6, bottom: 6, left: 6 }
	const getCM = () => stateStore.getState()?.channelMap || {}
	const isEnabled = () => getCM().multiviewEnabled !== false && getCM().multiviewCh != null
	const applyDebounce = createDebounce(() => applyMultiviewLayout(getCM, { silent: true }), 800)
	const scheduleApply = () => { if (!isEnabled()) return; applyDebounce.call() }
	const flushApply = () => { if (!isEnabled()) return; applyDebounce.flush() }
	const applyIfAutoEnabled = () => { if (multiviewState.autoApply) flushApply() }
	const syncOverlay = () => { if (!isEnabled()) { if (!disabledOverlay && wrap) { disabledOverlay = Object.assign(document.createElement('div'), { className: 'mv-disabled-overlay', innerHTML: '<div class="mv-disabled-overlay__content"><h3>No Multiview Channel</h3><p>Add a Multiview destination in Device View to enable.</p></div>' }); wrap.appendChild(disabledOverlay) } if (disabledOverlay) disabledOverlay.style.display = 'flex' } else if (disabledOverlay) disabledOverlay.style.display = 'none' }
	const draw = () => drawMultiviewEditor(ctx, canvas, { offsetX, offsetY, scale, selectedId, dropHoverId, channelMap: getCM(), timerScale: multiviewState.timerScale })
	const getMvChannels = () => { const cm = getCM(); return Array.isArray(cm.multiviewChannels) ? cm.multiviewChannels : (cm.multiviewCh != null ? [cm.multiviewCh] : []) }
	/** WO-156: routing the multiview's own channel into one of its cells wedges the channel in Caspar. */
	const mvSelfRouteMessage = (value) => {
		const parsed = parseRouteValue(value)
		if (!parsed) return null
		const mvCh = getMvChannels()[(multiviewState.currentIndex || 1) - 1]
		if (mvCh != null && parsed.channel === Number(mvCh)) {
			return `Cannot show route://${parsed.channel} on this multiview — channel ${mvCh} is the multiview's own output and routing it into itself would freeze it.`
		}
		return null
	}

	const updateToolbar = () => {
		const cm = getCM()
		const mvChs = Array.isArray(cm.multiviewChannels) ? cm.multiviewChannels : (cm.multiviewCh != null ? [cm.multiviewCh] : [])
		const sel = root.querySelector('#mv-index-select')
		if (sel) {
			const prevVal = sel.value
			sel.innerHTML = mvChs.map((ch, i) => `<option value="${i + 1}" ${multiviewState.currentIndex === (i + 1) ? 'selected' : ''}>Multiview ${i + 1} (Ch ${ch})</option>`).join('')
			if (mvChs.length <= 1) sel.style.display = 'none'; else sel.style.display = 'inline-block'
		}
	}

	root.innerHTML = `<div class="mv-toolbar">
		<select id="mv-index-select" class="mv-select" style="margin-right:8px"></select>
		<button id="mv-reset" class="mv-btn">Reset</button>
		<button id="mv-refresh" class="mv-btn" title="Re-apply all multiview layouts to CasparCG (use if the multiview is stuck, e.g. after a CasparCG restart)">Refresh output</button>
		<button id="mv-live-toggle" class="mv-btn" style="display:none" title="Show the real composited multiview output (incl. its labels/timers) in this dock. View-only while on — toggle back to keep editing over the per-window live video.">Full output</button>
		<label class="mv-chk" style="margin-left:12px"><input type="checkbox" id="mv-auto-apply" ${multiviewState.autoApply ? 'checked' : ''}> Auto-apply</label>
		<label class="mv-chk"><input type="checkbox" id="mv-overlay" ${multiviewState.showOverlay ? 'checked' : ''}> Borders</label>
		<label class="mv-chk" style="margin-left:12px"><input type="checkbox" id="mv-timers-under-labels" ${multiviewState.showTimersUnderLabels ? 'checked' : ''}> Timers under labels</label>
		<label class="mv-chk" style="margin-left:12px">Timer size % <input type="number" id="mv-timer-scale" value="${multiviewState.timerScale}" min="50" max="300" style="width:50px;padding:2px 4px"></label>
		<label class="mv-chk" style="margin-left:12px"><input type="checkbox" id="mv-highlight-top-timer" ${multiviewState.highlightTopTimer ? 'checked' : ''}> Highlight top timer</label>
		<span class="mv-toolbar__sep"></span>
		<label class="mv-chk">BG <input type="color" id="mv-bg-color" value="${multiviewState.bgColor || '#000000'}"></label>
		<span class="mv-toolbar__sep"></span>
		<span>Presets</span>
		<button class="mv-preset" data-slot="0">1</button>
		<button class="mv-preset" data-slot="1">2</button>
		<button class="mv-preset" data-slot="2">3</button>
		<button class="mv-preset" data-slot="3">4</button>
	</div><div class="mv-canvas-wrap" style="position:relative;background:#000;overflow:hidden"><div id="mv-video" style="position:absolute;inset:0;pointer-events:none"></div><canvas style="position:relative;z-index:2"></canvas></div>`
	
	wrap = root.querySelector('.mv-canvas-wrap'); canvas = wrap.querySelector('canvas'); ctx = canvas.getContext('2d'); const vCont = root.querySelector('#mv-video')
	const refit = () => { const r = fitInContainer(canvas, wrap); scale = r.scale; offsetX = r.offsetX; offsetY = r.offsetY }
	let liveView = null; const updateLive = () => { if (shouldShowLiveVideo() && isEnabled()) { if (!liveView) liveView = initLiveView(vCont, 'multiview') } else if (liveView) { liveView.destroy(); liveView = null } draw() }
	// WO-255 T255.3 surface 3/3, reworked 2026-07-17 (see mvOperatorFullOutput above): default is
	// per-cell inset holes routing each cell's own source; the toggle switches to the old single
	// whole-dock rect. No-op unless operator-GUI mode is active. A zero-sized/hidden wrap (tab
	// not visible) withdraws the surface.
	const reportMvRect = () => {
		if (!isOperatorGuiModeActive()) return
		if (mvOperatorFullOutput) {
			reportMultiviewEditRect(wrap.getBoundingClientRect())
			return
		}
		const r = wrap.getBoundingClientRect()
		if (!(r.width > 0) || !(r.height > 0)) {
			reportMultiviewEditCellRects([])
			return
		}
		const canvasRect = canvas.getBoundingClientRect()
		const cm = getCM()
		const mvChs = getMvChannels()
		const cells = []
		for (const c of multiviewState.getCells()) {
			// Same client-px mapping as the mouse handlers (toCanvas is its inverse).
			const rect = holeRectFromOuter(
				{ left: canvasRect.left + offsetX + c.x * scale, top: canvasRect.top + offsetY + c.y * scale, width: c.w * scale, height: c.h * scale },
				MV_BLEND_INSETS
			)
			if (rect.width < 24 || rect.height < 24) continue
			if (c.type === 'pgm' || c.type === 'prv') {
				const idx = Number(c.screenIdx)
				if (Number.isFinite(idx)) {
					cells.push({ id: `mv-${c.id}`, role: c.type, mainIndex: idx, rect })
					continue
				}
				// No screenIdx (sources-panel drops only carry route://<ch>) — fall through and
				// resolve the channel from the route value like any other routed cell.
			}
			const parsed = parseRouteValue(c.source?.value)
			if (!parsed) continue // media/html cells have no live channel to route — canvas box only
			// WO-271: heal stale persisted route channels (channel-map shifts); an unresolvable
			// stale route gets NO hole (the canvas box stays) instead of routing a wrong channel.
			const srcCh = resolveMvCellSourceChannel(c, parsed, cm)
			if (srcCh == null) continue
			// Never route the multiview's own output into a hole (WO-156: self-route wedges it).
			if (mvChs.some((mc) => Number(mc) === srcCh)) continue
			cells.push({ id: `mv-${c.id}`, role: 'mvcell', srcCh, rect })
		}
		reportMultiviewEditCellRects(cells)
	}
	streamState.subscribe(() => { syncOverlay(); updateLive() }); settingsState.subscribe(() => { syncOverlay(); updateLive() }); syncOverlay(); updateLive(); refit()
	new ResizeObserver(() => { refit(); draw(); reportMvRect() }).observe(wrap)
	if (isOperatorGuiModeActive()) window.addEventListener('scroll', reportMvRect, true)
	reportMvRect()
	const upPres = () => { const s = multiviewState.getPresetSlots(); for (let i = 0; i < 4; i++) root.querySelector(`.mv-preset[data-slot="${i}"]`)?.classList.toggle('mv-preset--stored', s[i] != null) }
	for (const b of root.querySelectorAll('.mv-preset')) b.onclick = (e) => { const s = parseInt(b.dataset.slot); if (e.shiftKey) multiviewState.clearPresetSlot(s); else if (multiviewState.getPresetSlots()[s] == null) multiviewState.savePresetSlot(s, multiviewState.snapshotForPreset()); else multiviewState.applyPresetSnapshot(multiviewState.getPresetSlots()[s]); upPres() }
	upPres(); root.querySelector('#mv-reset').onclick = () => { multiviewState.clearLayout(); selectedId = null; draw() }

	// WO-156 T156.5: one-click re-apply of every configured multiviewer via the existing
	// POST /api/multiview/apply (recovers a stuck multiview after a CasparCG restart).
	const refreshBtn = root.querySelector('#mv-refresh')
	refreshBtn.onclick = async () => {
		const mvChs = getMvChannels()
		if (mvChs.length === 0) {
			showAppToast('No multiview channel configured.', 'warn')
			return
		}
		refreshBtn.disabled = true
		let okCount = 0
		let failCount = 0
		try {
			for (let n = 1; n <= mvChs.length; n++) {
				const body = multiviewState.getApplyBodyForIndex(n)
				if (!body) continue
				try {
					await api.post('/api/multiview/apply', body)
					okCount++
				} catch (err) {
					failCount++
					console.error(`Multiview refresh failed for multiviewer ${n}:`, err)
				}
			}
			if (okCount === 0 && failCount === 0) showAppToast('No multiview layout to apply yet.', 'info')
			else if (failCount > 0) showAppToast(`Multiview refresh: ${okCount} applied, ${failCount} failed — see logs.`, 'error')
			else showAppToast(`Multiview output refreshed (${okCount} layout${okCount === 1 ? '' : 's'}).`, 'success')
		} finally {
			refreshBtn.disabled = false
		}
	}

	// Operator-GUI mode: per-cell blend (default, editable) ⇄ full-output toggle (see
	// mvOperatorFullOutput). Hidden elsewhere — normal browser sessions get their live view via
	// #mv-video/WebRTC and stay interactive.
	const liveToggleBtn = root.querySelector('#mv-live-toggle')
	if (isOperatorGuiModeActive()) {
		liveToggleBtn.style.display = 'inline-block'
		const syncLiveToggle = () => {
			liveToggleBtn.textContent = mvOperatorFullOutput ? 'Edit layout' : 'Full output'
			liveToggleBtn.classList.toggle('mv-btn--live-on', mvOperatorFullOutput)
		}
		syncLiveToggle()
		liveToggleBtn.onclick = () => {
			mvOperatorFullOutput = !mvOperatorFullOutput
			syncLiveToggle()
			reportMvRect()
			draw()
		}
	}

	const idxSel = root.querySelector('#mv-index-select')
	idxSel.onchange = (e) => {
		multiviewState.switchTo(e.target.value)
		root.querySelector('#mv-auto-apply').checked = multiviewState.autoApply
		root.querySelector('#mv-overlay').checked = multiviewState.showOverlay
		root.querySelector('#mv-timers-under-labels').checked = multiviewState.showTimersUnderLabels
		root.querySelector('#mv-bg-color').value = multiviewState.bgColor
		timerScaleInput.value = multiviewState.timerScale
		root.querySelector('#mv-highlight-top-timer').checked = multiviewState.highlightTopTimer
		upPres()
		updateLive()
		draw()
	}
	updateToolbar()

	root.querySelector('#mv-auto-apply').onchange = e => multiviewState.setAutoApply(e.target.checked)
	root.querySelector('#mv-overlay').onchange = e => multiviewState.setShowOverlay(e.target.checked)
	root.querySelector('#mv-timers-under-labels').onchange = e => { multiviewState.setShowTimersUnderLabels(e.target.checked); flushApply() }
	root.querySelector('#mv-bg-color').oninput = e => multiviewState.setBgColor(e.target.value)
	root.querySelector('#mv-bg-color').onchange = e => { multiviewState.setBgColor(e.target.value); flushApply() }

	const timerScaleInput = root.querySelector('#mv-timer-scale')
	attachMathInput(timerScaleInput, {
		min: 50,
		max: 300,
		decimals: 0,
		onCommit: (value) => { multiviewState.setTimerScale(value); flushApply() }
	})

	root.querySelector('#mv-highlight-top-timer').onchange = e => { multiviewState.setHighlightTopTimer(e.target.checked); flushApply() }
	canvas.onmousedown = e => { const r = canvas.getBoundingClientRect(); const { x, y } = toCanvas(e.clientX - r.left, e.clientY - r.top, offsetX, offsetY, scale); const c = getCellAt(x, y, getCM())
		if (c) { selectedId = c.id; const h = getResizeHandle(c, x, y, scale, getCM()); if (h) { dragMode = 'resize-' + h; dragStart = { mouseX: x, mouseY: y, cell: { ...c } }; canvas.style.cursor = cursorForResizeHandle(h) } else { dragMode = 'move'; dragStart = { mouseX: x, mouseY: y, cell: { ...c } }; canvas.style.cursor = 'grabbing' } multiviewState.setDragInProgress(true); window.dispatchEvent(new CustomEvent('multiview-select', { detail: { cellId: selectedId } })) }
		else { selectedId = null; canvas.style.cursor = ''; window.dispatchEvent(new CustomEvent('multiview-select', { detail: {} })) }
	}
	canvas.onmousemove = e => { const r = canvas.getBoundingClientRect(); const { x: cx, y: cy } = toCanvas(e.clientX - r.left, e.clientY - r.top, offsetX, offsetY, scale)
		if (dragMode && dragStart.cell) { const c = multiviewState.getCell(dragStart.cell.id); if (!c) return;
			if (dragMode === 'move') {
				const dx = cx - dragStart.mouseX, dy = cy - dragStart.mouseY
				const rawX = dragStart.cell.x + dx
				const rawY = dragStart.cell.y + dy
				const cw = dragStart.cell.w
				const ch = dragStart.cell.h

				const xCandidates = [0, multiviewState.canvasWidth]
				const yCandidates = [0, multiviewState.canvasHeight]
				const cells = multiviewState.getCells()
				for (const oc of cells) {
					if (oc.id === c.id) continue
					xCandidates.push(oc.x, oc.x + oc.w)
					yCandidates.push(oc.y, oc.y + oc.h)
				}
				const snapThresholdX = 10 / scale
				const snapThresholdY = 10 / scale

				let snapX1 = snapValue(rawX, xCandidates, snapThresholdX)
				let snapX2 = snapValue(rawX + cw, xCandidates, snapThresholdX) - cw
				let finalX = rawX
				if (Math.abs(snapX1 - rawX) <= Math.abs(snapX2 - rawX)) {
					if (Math.abs(snapX1 - rawX) < snapThresholdX) finalX = snapX1
				} else {
					if (Math.abs(snapX2 - rawX) < snapThresholdX) finalX = snapX2
				}

				let snapY1 = snapValue(rawY, yCandidates, snapThresholdY)
				let snapY2 = snapValue(rawY + ch, yCandidates, snapThresholdY) - ch
				let finalY = rawY
				if (Math.abs(snapY1 - rawY) <= Math.abs(snapY2 - rawY)) {
					if (Math.abs(snapY1 - rawY) < snapThresholdY) finalY = snapY1
				} else {
					if (Math.abs(snapY2 - rawY) < snapThresholdY) finalY = snapY2
				}

				multiviewState.setCell(c.id, { x: finalX, y: finalY })
			}
			else { const handleStr = dragMode.replace('resize-', ''); let { x, y, w, h: ch } = { ...dragStart.cell }; const dx = cx - dragStart.mouseX, dy = cy - dragStart.mouseY
				const xCandidates = [0, multiviewState.canvasWidth]
				const yCandidates = [0, multiviewState.canvasHeight]
				const cells = multiviewState.getCells()
				for (const oc of cells) {
					if (oc.id === c.id) continue
					xCandidates.push(oc.x, oc.x + oc.w)
					yCandidates.push(oc.y, oc.y + oc.h)
				}
				const snapThresholdX = 10 / scale
				const snapThresholdY = 10 / scale

				if (handleStr.includes('e')) {
					const rawRight = dragStart.cell.x + dragStart.cell.w + dx
					const snappedRight = snapValue(rawRight, xCandidates, snapThresholdX)
					w = Math.max(60, snappedRight - dragStart.cell.x)
				}
				if (handleStr.includes('w')) {
					const rawLeft = dragStart.cell.x + dx
					const snappedLeft = snapValue(rawLeft, xCandidates, snapThresholdX)
					const nw = Math.max(60, dragStart.cell.w + (dragStart.cell.x - snappedLeft))
					x = dragStart.cell.x + dragStart.cell.w - nw
					w = nw
				}
				if (handleStr.includes('s')) {
					const rawBottom = dragStart.cell.y + dragStart.cell.h + dy
					const snappedBottom = snapValue(rawBottom, yCandidates, snapThresholdY)
					ch = Math.max(40, snappedBottom - dragStart.cell.y)
				}
				if (handleStr.includes('n')) {
					const rawTop = dragStart.cell.y + dy
					const snappedTop = snapValue(rawTop, yCandidates, snapThresholdY)
					const nh = Math.max(40, dragStart.cell.h + (dragStart.cell.y - snappedTop))
					y = dragStart.cell.y + dragStart.cell.h - nh
					ch = nh
				}

				if (c.aspectLocked) {
					const ratio = resolveSourceAspectRatio(c, getCM())
					const programChannels = getCM().programChannels || []
					const previewChannels = getCM().previewChannels || []
					const ovType = getCellOverlayType(c, programChannels, previewChannels, getCM())
					const showTimersUnderLabels = !!multiviewState.showTimersUnderLabels
					if (handleStr.includes('e') || handleStr.includes('w')) {
						const solved = solveCellDimensions(w, ch, ratio, 'width', ovType, showTimersUnderLabels)
						ch = solved.h
						if (handleStr.includes('w')) x = dragStart.cell.x + dragStart.cell.w - w
						if (handleStr.includes('n')) y = dragStart.cell.y + dragStart.cell.h - ch
					} else if (handleStr.includes('s') || handleStr.includes('n')) {
						const solved = solveCellDimensions(w, ch, ratio, 'height', ovType, showTimersUnderLabels)
						w = solved.w
						if (handleStr.includes('w')) x = dragStart.cell.x + dragStart.cell.w - w
						if (handleStr.includes('n')) y = dragStart.cell.y + dragStart.cell.h - ch
					}
				}
				multiviewState.setCell(c.id, { x, y, w, h: ch })
			} return }
		const c = getCellAt(cx, cy, getCM()); if (!c) { canvas.style.cursor = ''; return }; const h = getResizeHandle(c, cx, cy, scale, getCM()); canvas.style.cursor = h ? cursorForResizeHandle(h) : 'move'
	}
	canvas.onmouseup = () => { const wasDrag = dragMode != null; dragMode = null; dragStart = { cell: null }; multiviewState.setDragInProgress(false); if (wasDrag) reportMvRect(); applyIfAutoEnabled() }
	canvas.onmouseleave = () => { const wasDrag = dragMode != null; dragMode = null; canvas.style.cursor = ''; multiviewState.setDragInProgress(false); if (wasDrag) reportMvRect() }
	canvas.oncontextmenu = e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); const { x, y } = toCanvas(e.clientX - r.left, e.clientY - r.top, offsetX, offsetY, scale); const c = getCellAt(x, y, getCM()); if (!c) return; if (c.source) multiviewState.setCellSource(c.id, null); else multiviewState.removeCell(c.id) }
	canvas.onclick = e => { const r = canvas.getBoundingClientRect(); const { x, y } = toCanvas(e.clientX - r.left, e.clientY - r.top, offsetX, offsetY, scale); const c = getCellAt(x, y, getCM()); if (c) multiviewState.setAudioActiveCell(c.id) }
	canvas.ondragover = e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); const { x, y } = toCanvas(e.clientX - r.left, e.clientY - r.top, offsetX, offsetY, scale); const c = getCellAt(x, y, getCM()); const nid = c ? c.id : (x >= 0 && x <= multiviewState.canvasWidth && y >= 0 && y <= multiviewState.canvasHeight ? '__canvas__' : null); if (nid !== dropHoverId) { dropHoverId = nid; draw() } }
	canvas.ondragleave = () => { dropHoverId = null; draw() }
	canvas.ondrop = e => { e.preventDefault(); dropHoverId = null; const r = canvas.getBoundingClientRect(); const { x, y } = toCanvas(e.clientX - r.left, e.clientY - r.top, offsetX, offsetY, scale); let c = getCellAt(x, y, getCM()), data; try { data = JSON.parse(e.dataTransfer.getData('application/json')) } catch { const v = e.dataTransfer.getData('text/plain'); if (v) data = { type: 'media', value: v, label: v } }; if (!data?.value) { draw(); return }
		const selfRouteMsg = mvSelfRouteMessage(data.value); if (selfRouteMsg) { showAppToast(selfRouteMsg, 'warn'); draw(); return }
		if (!c) { const mw = multiviewState.canvasWidth, mh = multiviewState.canvasHeight; if (x < 0 || x > mw || y < 0 || y > mh) { draw(); return }
			const routeType = data.routeType || data.type || 'media'
			let cw = Math.round(mw / 4)
			let ch = Math.round(mh / 4)
			let ratio = 16 / 9
			if (data.resolution) {
				const m = String(data.resolution).match(/(\d+)[×x](\d+)/i)
				if (m) ratio = parseInt(m[1], 10) / parseInt(m[2], 10)
			}
			if (['route', 'pgm', 'prv', 'decklink', 'live_audio', 'v4l2'].includes(routeType)) {
				const solved = solveCellDimensions(cw, cw, ratio, 'width', routeType, multiviewState.showTimersUnderLabels)
				cw = solved.w
				ch = solved.h
				if (ch > mh) {
					const fit = solveCellDimensions(cw, mh, ratio, 'height', routeType, multiviewState.showTimersUnderLabels)
					cw = fit.w
					ch = fit.h
				}
			}
		c = multiviewState.addCell({ type: data.routeType || data.type, label: data.label || data.value, x: Math.max(0, Math.min(mw - cw, x - cw / 2)), y: Math.max(0, Math.min(mh - ch, y - ch / 2)), w: cw, h: ch, source: { value: data.value, type: data.type || 'media', label: data.label || data.value }, aspectLocked: true }); selectedId = c.id }
		else multiviewState.setCellSource(c.id, { value: data.value, type: data.type || 'media', label: data.label || data.value }); draw(); applyIfAutoEnabled()
	}
	// Cell adds/removes/layout loads must re-report the per-cell blend holes (debounced in
	// operator-gui-mode.js; no-op outside operator-GUI mode). During a move/resize drag the
	// 'change' events fire at pointermove rate but interaction suppression blanks the holes for
	// the whole drag anyway — skip the expensive re-report (getBoundingClientRect + per-cell
	// route resolution) and send one report from the mouseup/mouseleave drag-end paths instead.
	multiviewState.on('change', () => { draw(); if (!multiviewState.dragInProgress) reportMvRect() })
	multiviewState.on('apply-request', () => { if (!isEnabled()) return; if (multiviewState.dragInProgress) return; if (multiviewState.autoApply) scheduleApply() })
	multiviewState.on('audio-change', () => { draw(); applyMultiviewAudioFocus() })

	const onKeyDown = (e) => {
		const tab = document.querySelector('#tab-multiview')
		const isActive = tab && tab.classList.contains('active')
		if (isActive && selectedId && (e.key === 'Backspace' || e.key === 'Delete')) {
			const activeEl = document.activeElement
			if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
				return
			}
			e.preventDefault()
			multiviewState.removeCell(selectedId)
			selectedId = null
			draw()
			applyIfAutoEnabled()
		}
	}
	document.addEventListener('keydown', onKeyDown)

	const IGNORE_STATE_PATHS = new Set([
		'timeline.tick',
		'timeline.playback',
		'variables',
		'logs',
		'log_line',
		'dmx:colors',
	])
	// Everything reportMvRect's hole resolution reads from the channel map: inputChannels /
	// programChannels / previewChannels (resolveMvCellSourceChannel) plus multiviewChannels /
	// multiviewCh (self-route filter). Re-report only when this changes — reportMvRect is
	// expensive (getBoundingClientRect + per-cell loops) and already fires per-drag via the
	// multiviewState 'change' listener, so it must not run on every '*' state event.
	const mvHoleSignature = () => {
		const cm = getCM()
		return JSON.stringify([cm.inputChannels, cm.programChannels, cm.previewChannels, cm.multiviewChannels, cm.multiviewCh])
	}
	let lastMvHoleSig = mvHoleSignature()
	let stateRedrawTimer = null
	const scheduleStateRedraw = () => {
		if (stateRedrawTimer) return
		stateRedrawTimer = requestAnimationFrame(() => {
			stateRedrawTimer = null
			syncOverlay()
			updateToolbar()
			refit()
			draw()
			const sig = mvHoleSignature()
			if (sig !== lastMvHoleSig) {
				lastMvHoleSig = sig
				reportMvRect()
			}
		})
	}
	const unsubState = stateStore.on('*', (path) => {
		if (path && IGNORE_STATE_PATHS.has(path)) return
		scheduleStateRedraw()
	})
	root._multiviewCleanup = () => {
		document.removeEventListener('keydown', onKeyDown)
		if (stateRedrawTimer) cancelAnimationFrame(stateRedrawTimer)
		unsubState?.()
		if (liveView) liveView.destroy()
	}
	draw()
}
