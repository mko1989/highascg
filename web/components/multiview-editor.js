/**
 * Multiview editor — canvas with boxes.
 */
import { multiviewState } from '../lib/multiview-state.js'
import { initLiveView } from './live-view.js'
import { streamState, shouldShowLiveVideo } from '../lib/stream-state.js'
import { settingsState } from '../lib/settings-state.js'
import { fitInContainer, toCanvas, getCellAt, cursorForResizeHandle, getResizeHandle, drawMultiviewEditor, applyMultiviewLayout, applyMultiviewAudioFocus } from './multiview-editor-canvas.js'

export function initMultiviewEditor(root, stateStore) {
	let canvas, ctx, scale = 1, offsetX = 0, offsetY = 0, selectedId = null, dragMode = null, dragStart = { x: 0, y: 0, cell: null }, dropHoverId = null, wrap = null, disabledOverlay = null, applyTimer = null
	const getCM = () => stateStore.getState()?.channelMap || {}
	const isEnabled = () => getCM().multiviewEnabled !== false && getCM().multiviewCh != null
	const scheduleApply = () => { if (!isEnabled()) return; if (applyTimer) clearTimeout(applyTimer); applyTimer = setTimeout(() => { applyTimer = null; applyMultiviewLayout(getCM, { silent: true }) }, 400) }
	const flushApply = () => { if (!isEnabled()) return; if (applyTimer) clearTimeout(applyTimer); applyTimer = null; applyMultiviewLayout(getCM, { silent: true }) }
	const syncOverlay = () => { if (!isEnabled()) { if (!disabledOverlay && wrap) { disabledOverlay = Object.assign(document.createElement('div'), { className: 'mv-disabled-overlay', innerHTML: '<div class="mv-disabled-overlay__content"><h3>No Multiview Channel</h3><p>Add a Multiview destination in Device View to enable.</p></div>' }); wrap.appendChild(disabledOverlay) } if (disabledOverlay) disabledOverlay.style.display = 'flex' } else if (disabledOverlay) disabledOverlay.style.display = 'none' }
	const draw = () => drawMultiviewEditor(ctx, canvas, { offsetX, offsetY, scale, selectedId, dropHoverId })

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
		<label class="mv-chk"><input type="checkbox" id="mv-overlay" ${multiviewState.showOverlay ? 'checked' : ''}> Borders</label>
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
	
	const idxSel = root.querySelector('#mv-index-select')
	idxSel.onchange = (e) => {
		multiviewState.switchTo(e.target.value)
		root.querySelector('#mv-overlay').checked = multiviewState.showOverlay
		root.querySelector('#mv-bg-color').value = multiviewState.bgColor
		upPres()
		updateLive()
		draw()
	}
	updateToolbar()

	root.querySelector('#mv-overlay').onchange = e => multiviewState.setShowOverlay(e.target.checked)
	root.querySelector('#mv-bg-color').oninput = e => multiviewState.setBgColor(e.target.value)
	root.querySelector('#mv-bg-color').onchange = e => { multiviewState.setBgColor(e.target.value); flushApply() }
	canvas.onmousedown = e => { const r = canvas.getBoundingClientRect(); const { x, y } = toCanvas(e.clientX - r.left, e.clientY - r.top, offsetX, offsetY, scale); const c = getCellAt(x, y)
		if (c) { selectedId = c.id; const h = getResizeHandle(c, x, y, scale); if (h) { dragMode = 'resize-' + h; dragStart = { mouseX: x, mouseY: y, cell: { ...c } }; canvas.style.cursor = cursorForResizeHandle(h) } else { dragMode = 'move'; dragStart = { x, y, cell: { ...c } }; canvas.style.cursor = 'grabbing' } window.dispatchEvent(new CustomEvent('multiview-select', { detail: { cellId: selectedId } })) }
		else { selectedId = null; canvas.style.cursor = ''; window.dispatchEvent(new CustomEvent('multiview-select', { detail: {} })) }
	}
	canvas.onmousemove = e => { const r = canvas.getBoundingClientRect(); const { x: cx, y: cy } = toCanvas(e.clientX - r.left, e.clientY - r.top, offsetX, offsetY, scale)
		if (dragMode && dragStart.cell) { const c = multiviewState.getCell(dragStart.cell.id); if (!c) return; if (dragMode === 'move') { const dx = cx - dragStart.x, dy = cy - dragStart.y; multiviewState.setCell(c.id, { x: dragStart.cell.x + dx, y: dragStart.cell.y + dy }); dragStart.x = cx; dragStart.y = cy; dragStart.cell = { ...c } }
		else { const h = dragMode.replace('resize-', ''); let { x, y, w, h: ch } = { ...dragStart.cell }; const dx = cx - dragStart.mouseX, dy = cy - dragStart.mouseY, ratio = dragStart.cell.w / dragStart.cell.h
			if (h.includes('e')) w = Math.max(60, dragStart.cell.w + dx); if (h.includes('w')) { const nw = Math.max(60, dragStart.cell.w - dx); x = dragStart.cell.x + dragStart.cell.w - nw; w = nw }
			if (h.includes('s')) ch = Math.max(40, dragStart.cell.h + dy); if (h.includes('n')) { const nh = Math.max(40, dragStart.cell.h - dy); y = dragStart.cell.y + dragStart.cell.h - nh; ch = nh }
			if (c.aspectLocked) { if (h.includes('e') || h.includes('w')) ch = Math.max(40, Math.round(w / ratio)); else if (h.includes('s') || h.includes('n')) w = Math.max(60, Math.round(ch * ratio)) } multiviewState.setCell(c.id, { x, y, w, h: ch }) } return }
		const c = getCellAt(cx, cy); if (!c) { canvas.style.cursor = ''; return }; const h = getResizeHandle(c, cx, cy, scale); canvas.style.cursor = h ? cursorForResizeHandle(h) : 'move'
	}
	canvas.onmouseup = () => { dragMode = null; dragStart = { cell: null }; flushApply() }
	canvas.onmouseleave = () => { dragMode = null; canvas.style.cursor = '' }
	canvas.oncontextmenu = e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); const { x, y } = toCanvas(e.clientX - r.left, e.clientY - r.top, offsetX, offsetY, scale); const c = getCellAt(x, y); if (!c) return; if (c.source) multiviewState.setCellSource(c.id, null); else multiviewState.removeCell(c.id) }
	canvas.onclick = e => { const r = canvas.getBoundingClientRect(); const { x, y } = toCanvas(e.clientX - r.left, e.clientY - r.top, offsetX, offsetY, scale); const c = getCellAt(x, y); if (c) multiviewState.setAudioActiveCell(c.id) }
	canvas.ondragover = e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); const { x, y } = toCanvas(e.clientX - r.left, e.clientY - r.top, offsetX, offsetY, scale); const c = getCellAt(x, y); const nid = c ? c.id : (x >= 0 && x <= multiviewState.canvasWidth && y >= 0 && y <= multiviewState.canvasHeight ? '__canvas__' : null); if (nid !== dropHoverId) { dropHoverId = nid; draw() } }
	canvas.ondragleave = () => { dropHoverId = null; draw() }
	canvas.ondrop = e => { e.preventDefault(); dropHoverId = null; const r = canvas.getBoundingClientRect(); const { x, y } = toCanvas(e.clientX - r.left, e.clientY - r.top, offsetX, offsetY, scale); let c = getCellAt(x, y), data; try { data = JSON.parse(e.dataTransfer.getData('application/json')) } catch { const v = e.dataTransfer.getData('text/plain'); if (v) data = { type: 'media', value: v, label: v } }; if (!data?.value) { draw(); return }
		if (!c) { const mw = multiviewState.canvasWidth, mh = multiviewState.canvasHeight; if (x < 0 || x > mw || y < 0 || y > mh) { draw(); return }; let cw = Math.round(mw / 4), ch = Math.round(mh / 4); if (data.resolution) { const m = String(data.resolution).match(/(\d+)[×x](\d+)/i); if (m) { const sw = parseInt(m[1]), sh = parseInt(m[2]), rat = sw / sh; cw = Math.min(mw / 4, mw); ch = Math.round(cw / rat); if (ch > mh) { ch = mh; cw = Math.round(ch * rat) } } }
		c = multiviewState.addCell({ type: data.routeType || data.type, label: data.label || data.value, x: Math.max(0, Math.min(mw - cw, x - cw / 2)), y: Math.max(0, Math.min(mh - ch, y - ch / 2)), w: cw, h: ch, source: { value: data.value, type: data.type || 'media', label: data.label || data.value }, aspectLocked: true }); selectedId = c.id }
		else multiviewState.setCellSource(c.id, { value: data.value, type: data.type || 'media', label: data.label || data.value }); draw(); flushApply()
	}
	multiviewState.on('change', () => { draw() })
	multiviewState.on('apply-request', () => { if (!isEnabled()) return; scheduleApply() })
	multiviewState.on('audio-change', () => { draw(); applyMultiviewAudioFocus() })
	stateStore.on('*', () => { syncOverlay(); updateToolbar(); refit(); draw() }); draw()
}
