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
import { fitInContainer, toCanvas, getCellAt, cursorForResizeHandle, getResizeHandle, drawMultiviewEditor, applyMultiviewLayout, applyMultiviewAudioFocus, resolveSourceAspectRatio, solveCellDimensions, getCellOverlayType } from './multiview-editor-canvas.js'

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
	let canvas, ctx, scale = 1, offsetX = 0, offsetY = 0, selectedId = null, dragMode = null, dragStart = { x: 0, y: 0, cell: null }, dropHoverId = null, wrap = null, disabledOverlay = null, applyTimer = null
	const getCM = () => stateStore.getState()?.channelMap || {}
	const isEnabled = () => getCM().multiviewEnabled !== false && getCM().multiviewCh != null
	const scheduleApply = () => { if (!isEnabled()) return; if (applyTimer) clearTimeout(applyTimer); applyTimer = setTimeout(() => { applyTimer = null; applyMultiviewLayout(getCM, { silent: true }) }, 400) }
	const flushApply = () => { if (!isEnabled()) return; if (applyTimer) clearTimeout(applyTimer); applyTimer = null; applyMultiviewLayout(getCM, { silent: true }) }
	const syncOverlay = () => { if (!isEnabled()) { if (!disabledOverlay && wrap) { disabledOverlay = Object.assign(document.createElement('div'), { className: 'mv-disabled-overlay', innerHTML: '<div class="mv-disabled-overlay__content"><h3>No Multiview Channel</h3><p>Add a Multiview destination in Device View to enable.</p></div>' }); wrap.appendChild(disabledOverlay) } if (disabledOverlay) disabledOverlay.style.display = 'flex' } else if (disabledOverlay) disabledOverlay.style.display = 'none' }
	const draw = () => drawMultiviewEditor(ctx, canvas, { offsetX, offsetY, scale, selectedId, dropHoverId, channelMap: getCM() })
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
		<label class="mv-chk"><input type="checkbox" id="mv-overlay" ${multiviewState.showOverlay ? 'checked' : ''}> Borders</label>
		<label class="mv-chk" style="margin-left:12px"><input type="checkbox" id="mv-timers-under-labels" ${multiviewState.showTimersUnderLabels ? 'checked' : ''}> Timers under labels</label>
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
	streamState.subscribe(() => { syncOverlay(); updateLive() }); settingsState.subscribe(() => { syncOverlay(); updateLive() }); syncOverlay(); updateLive(); refit()
	new ResizeObserver(() => { refit(); draw() }).observe(wrap)
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

	const idxSel = root.querySelector('#mv-index-select')
	idxSel.onchange = (e) => {
		multiviewState.switchTo(e.target.value)
		root.querySelector('#mv-overlay').checked = multiviewState.showOverlay
		root.querySelector('#mv-timers-under-labels').checked = multiviewState.showTimersUnderLabels
		root.querySelector('#mv-bg-color').value = multiviewState.bgColor
		upPres()
		updateLive()
		draw()
	}
	updateToolbar()

	root.querySelector('#mv-overlay').onchange = e => multiviewState.setShowOverlay(e.target.checked)
	root.querySelector('#mv-timers-under-labels').onchange = e => { multiviewState.setShowTimersUnderLabels(e.target.checked); flushApply() }
	root.querySelector('#mv-bg-color').oninput = e => multiviewState.setBgColor(e.target.value)
	root.querySelector('#mv-bg-color').onchange = e => { multiviewState.setBgColor(e.target.value); flushApply() }
	canvas.onmousedown = e => { const r = canvas.getBoundingClientRect(); const { x, y } = toCanvas(e.clientX - r.left, e.clientY - r.top, offsetX, offsetY, scale); const c = getCellAt(x, y, getCM())
		if (c) { selectedId = c.id; const h = getResizeHandle(c, x, y, scale, getCM()); if (h) { dragMode = 'resize-' + h; dragStart = { mouseX: x, mouseY: y, cell: { ...c } }; canvas.style.cursor = cursorForResizeHandle(h) } else { dragMode = 'move'; dragStart = { mouseX: x, mouseY: y, cell: { ...c } }; canvas.style.cursor = 'grabbing' } window.dispatchEvent(new CustomEvent('multiview-select', { detail: { cellId: selectedId } })) }
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
	canvas.onmouseup = () => { dragMode = null; dragStart = { cell: null }; flushApply() }
	canvas.onmouseleave = () => { dragMode = null; canvas.style.cursor = '' }
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
		else multiviewState.setCellSource(c.id, { value: data.value, type: data.type || 'media', label: data.label || data.value }); draw(); flushApply()
	}
	multiviewState.on('change', () => { draw() })
	multiviewState.on('apply-request', () => { if (!isEnabled()) return; scheduleApply() })
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
			flushApply()
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
	let stateRedrawTimer = null
	const scheduleStateRedraw = () => {
		if (stateRedrawTimer) return
		stateRedrawTimer = requestAnimationFrame(() => {
			stateRedrawTimer = null
			syncOverlay()
			updateToolbar()
			refit()
			draw()
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
