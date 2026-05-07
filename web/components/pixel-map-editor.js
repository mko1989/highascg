/**
 * Unified Mapping Editor — visual tool for Video Slicing and DMX Pixel Mapping.
 */
import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import { api } from '../lib/api-client.js'
import { initLiveView } from './live-view.js'
import { streamState, shouldShowLiveVideo } from '../lib/stream-state.js'
import { mappingState } from '../lib/mapping-state.js'
import { MAPPING_OUTPUT_VIDEO_MODES } from '../lib/mapping-node-service.js'

const HANDLE_SIZE = 8
const ROTATE_HANDLE_DIST = 30

export function initPixelMapEditor(root, stateStore) {
	let canvas, ctx
	let scale = 1
	let offsetX = 0
	let offsetY = 0
	let dragMode = null
	let dragStart = { x: 0, y: 0, angle: 0 }
	let selectedId = null
	let wrap = null
	let inspector = null
	let hostContainer = null

	function fitInContainer() {
		if (!canvas || !wrap) return
		const r = wrap.getBoundingClientRect()
		const w = Math.max(1, r.width)
		const h = Math.max(1, r.height)
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w
			canvas.height = h
		}
		const cw = mappingState.canvasWidth
		const ch = mappingState.canvasHeight
		
		// Ensure at least 80px margin on all sides, and don't exceed 80% of container size
		const margin = 160 
		scale = Math.min((w - margin) / cw, (h - margin) / ch, 0.8)
		if (scale < 0.1) scale = 0.1

		offsetX = (w - cw * scale) / 2
		offsetY = (h - ch * scale) / 2
	}

	function toCanvas(x, y) {
		return { x: (x - offsetX) / scale, y: (y - offsetY) / scale }
	}

	function getItemAt(cx, cy) {
		for (let i = mappingState.mappings.length - 1; i >= 0; i--) {
			const m = mappingState.mappings[i]
			const { x, y, w, h } = m.rect || { x: 0, y: 0, w: 1, h: 1 }
			const angle = (m.rotation || 0) * (Math.PI / 180)
			const dx = cx - (x + w / 2)
			const dy = cy - (y + h / 2)
			const cosA = Math.cos(-angle)
			const sinA = Math.sin(-angle)
			const lx = dx * cosA - dy * sinA
			const ly = dx * sinA + dy * cosA
			if (lx >= -w / 2 && lx <= w / 2 && ly >= -h / 2 && ly <= h / 2) return m
			if (selectedId === m.id) {
				const hdist = Math.sqrt((lx - 0) ** 2 + (ly + h / 2 + ROTATE_HANDLE_DIST) ** 2)
				if (hdist < (HANDLE_SIZE / scale) * 2) return { ...m, _handle: 'rotate' }
			}
		}
		return null
	}

	function draw() {
		if (!ctx || !canvas) return
		const mw = mappingState.canvasWidth
		const mh = mappingState.canvasHeight
		const bx = offsetX
		const by = offsetY
		const bw = mw * scale
		const bh = mh * scale
		ctx.fillStyle = '#0a0e13'
		ctx.fillRect(0, 0, canvas.width, canvas.height)
		if (!shouldShowLiveVideo()) {
			ctx.fillStyle = '#131a22'
			ctx.fillRect(bx, by, bw, bh)
		}
		ctx.strokeStyle = 'rgba(255,255,255,0.2)'
		ctx.setLineDash([5, 5])
		ctx.strokeRect(bx, by, bw, bh)
		ctx.setLineDash([])
		for (const m of mappingState.mappings) {
			const { x, y, w, h } = m.rect || { x: 0, y: 0, w: 1, h: 1 }
			const angle = (m.rotation || 0) * (Math.PI / 180)
			const isSelected = selectedId === m.id
			ctx.save()
			ctx.translate(bx + (x + w / 2) * scale, by + (y + h / 2) * scale)
			ctx.rotate(angle)
			ctx.fillStyle = m.type === 'video_slice'
				? (isSelected ? 'rgba(88,166,255,0.2)' : 'rgba(88,166,255,0.1)')
				: (isSelected ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)')
			ctx.fillRect((-w / 2) * scale, (-h / 2) * scale, w * scale, h * scale)
			ctx.strokeStyle = isSelected ? '#58a6ff' : (m.type === 'video_slice' ? '#388bfd' : '#8b949e')
			ctx.lineWidth = isSelected ? 2 : 1
			ctx.strokeRect((-w / 2) * scale, (-h / 2) * scale, w * scale, h * scale)
			ctx.fillStyle = '#fff'
			ctx.font = `bold 10px ${UI_FONT_FAMILY}`
			ctx.textAlign = 'center'
			ctx.fillText(m.label || m.id, 0, (-h / 2) * scale - 12)
			if (isSelected) {
				ctx.beginPath()
				ctx.strokeStyle = '#58a6ff'
				ctx.moveTo(0, (-h / 2) * scale)
				ctx.lineTo(0, (-h / 2) * scale - ROTATE_HANDLE_DIST * scale)
				ctx.stroke()
				ctx.fillStyle = '#58a6ff'
				ctx.beginPath()
				ctx.arc(0, (-h / 2) * scale - ROTATE_HANDLE_DIST * scale, (HANDLE_SIZE / 2) * scale, 0, Math.PI * 2)
				ctx.fill()
			}
			ctx.restore()
		}
	}

	function renderInspector() {
		if (!inspector) return
		inspector.innerHTML = ''
		const node = mappingState.activeNode
		if (!node) {
			inspector.innerHTML = '<p style="opacity:.7;font-size:12px">No mapping node selected.</p>'
			return
		}
		const makeBtn = (txt) => Object.assign(document.createElement('button'), { className: 'mv-btn', textContent: txt })
		const tools = document.createElement('div')
		tools.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px'
		const renameBtn = makeBtn('Rename')
		const copyBtn = makeBtn('Copy')
		const delBtn = makeBtn('Delete node')
		delBtn.style.background = 'rgba(255,68,68,.25)'
		renameBtn.onclick = async () => {
			const next = prompt('Node name', node.label || 'Pixel Mapping')
			if (next === null) return
			await mappingState.renameNode(next)
		}
		copyBtn.onclick = async () => { await mappingState.duplicateNode() }
		delBtn.onclick = async () => {
			if (!confirm('Delete mapping node with connectors/cables?')) return
			await mappingState.deleteNode()
		}
		tools.append(renameBtn, copyBtn, delBtn)
		inspector.appendChild(tools)
		const outputs = Array.isArray(node.settings?.outputs) ? node.settings.outputs : []
		const outWrap = document.createElement('div')
		outWrap.style.cssText = 'border-top:1px solid rgba(255,255,255,.12);padding-top:10px;margin-bottom:10px'
		outWrap.appendChild(Object.assign(document.createElement('div'), { textContent: 'Outputs', style: 'font-weight:bold;font-size:12px;margin-bottom:6px' }))
		for (const out of outputs) {
			const row = document.createElement('div')
			row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px'
			const inp = document.createElement('input')
			inp.value = out.label || out.id
			inp.style.cssText = 'flex:1;min-width:100px;background:#0b1119;color:#d0d7de;border:1px solid rgba(255,255,255,.14);border-radius:4px;padding:4px 6px'
			inp.onchange = async () => {
				await mappingState.updateOutput(out.id, { label: inp.value })
			}
			const modeSel = document.createElement('select')
			modeSel.style.cssText = 'background:#0b1119;color:#d0d7de;border:1px solid rgba(255,255,255,.14);border-radius:4px;padding:4px 6px'
			for (const m of MAPPING_OUTPUT_VIDEO_MODES) {
				const opt = document.createElement('option')
				opt.value = m
				opt.textContent = m
				if (String(out.mode || '') === m) opt.selected = true
				modeSel.appendChild(opt)
			}
			modeSel.onchange = async () => {
				await mappingState.updateOutput(out.id, { mode: modeSel.value })
			}
			const rm = makeBtn('−')
			rm.disabled = outputs.length <= 1
			rm.onclick = async () => { await mappingState.removeOutput(out.id) }
			row.append(inp, modeSel, rm)
			outWrap.appendChild(row)
		}
		const addOutBtn = makeBtn('+ Add output')
		addOutBtn.onclick = async () => { await mappingState.addOutput() }
		outWrap.appendChild(addOutBtn)
		inspector.appendChild(outWrap)
		const sel = mappingState.mappings.find((m) => m.id === selectedId) || null
		const sec = document.createElement('div')
		sec.style.cssText = 'border-top:1px solid rgba(255,255,255,.12);padding-top:10px'
		sec.appendChild(Object.assign(document.createElement('div'), { textContent: 'Selected slice', style: 'font-weight:bold;font-size:12px;margin-bottom:6px' }))
		if (!sel) {
			sec.appendChild(Object.assign(document.createElement('p'), { textContent: 'Select a slice to edit.', style: 'opacity:.7;font-size:12px' }))
			inspector.appendChild(sec)
			return
		}
		const addField = (label, value, onChange) => {
			const row = document.createElement('label')
			row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:12px'
			const l = Object.assign(document.createElement('span'), { textContent: label })
			l.style.width = '60px'
			const inp = document.createElement('input')
			inp.value = String(value ?? '')
			inp.style.cssText = 'flex:1;background:#0b1119;color:#d0d7de;border:1px solid rgba(255,255,255,.14);border-radius:4px;padding:4px 6px'
			inp.onchange = () => onChange(inp.value)
			row.append(l, inp)
			sec.appendChild(row)
		}
		addField('Label', sel.label || '', (v) => mappingState.updateMapping(sel.id, { label: v }))
		addField('X', sel.rect?.x ?? 0, (v) => mappingState.updateMapping(sel.id, { rect: { x: parseInt(v, 10) || 0 } }))
		addField('Y', sel.rect?.y ?? 0, (v) => mappingState.updateMapping(sel.id, { rect: { y: parseInt(v, 10) || 0 } }))
		addField('W', sel.rect?.w ?? 1, (v) => mappingState.updateMapping(sel.id, { rect: { w: Math.max(1, parseInt(v, 10) || 1) } }))
		addField('H', sel.rect?.h ?? 1, (v) => mappingState.updateMapping(sel.id, { rect: { h: Math.max(1, parseInt(v, 10) || 1) } }))
		addField('Rot', sel.rotation ?? 0, (v) => mappingState.updateMapping(sel.id, { rotation: parseInt(v, 10) || 0 }))
		const outRow = document.createElement('label')
		outRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:12px'
		outRow.appendChild(Object.assign(document.createElement('span'), { textContent: 'Output', style: 'width:60px' }))
		const outSel = document.createElement('select')
		outSel.style.cssText = 'flex:1;background:#0b1119;color:#d0d7de;border:1px solid rgba(255,255,255,.14);border-radius:4px;padding:4px 6px'
		for (const o of outputs) {
			const opt = document.createElement('option')
			opt.value = String(o.id)
			opt.textContent = `${o.label || o.id} (${o.id})`
			if (String(sel.outputId || '') === String(o.id)) opt.selected = true
			outSel.appendChild(opt)
		}
		outSel.onchange = () => mappingState.updateMapping(sel.id, { outputId: outSel.value })
		outRow.appendChild(outSel)
		sec.appendChild(outRow)
		inspector.appendChild(sec)
	}

	function renderInspector() {
		// Removed per user request - "another stupid inspector panel in there"
	}

	root.innerHTML = ''
	const editor = document.createElement('div')
	editor.className = 'pixel-map-editor'
	editor.style.cssText = 'position:absolute;inset:0;background:rgba(10,14,19,0.96);z-index:40;display:none;flex-direction:column;color:#fff;font-family:' + UI_FONT_FAMILY
	
	const toolbar = document.createElement('div')
	toolbar.className = 'mv-toolbar'
	toolbar.style.cssText = 'height:50px;display:flex;align-items:center;padding:0 20px;border-bottom:1px solid rgba(255,255,255,0.1);background:#131a22'
	toolbar.innerHTML = `
		<div style="display:flex; align-items:center; gap:16px; width:100%">
			<span id="px-node-label" style="font-weight:bold; font-size:14px">Mapping Preview</span>
			<span id="px-pgm-label" style="font-size:12px; opacity:0.6; padding:2px 8px; background:rgba(255,255,255,0.05); border-radius:4px"></span>
			<div style="margin-left:auto; display:flex; gap:12px; align-items:center">
				<button type="button" class="mv-btn" id="px-delete" style="display:none; background:rgba(248,81,73,0.2); color:#f85149; border-color:rgba(248,81,73,0.3)">Delete Slice</button>
				<button type="button" class="mv-btn" id="px-close" style="background:#238636; color:#fff; border:none; padding:6px 16px">Close Preview</button>
				<button type="button" id="px-close-x" style="background:none; border:none; color:#fff; cursor:pointer; font-size:24px; opacity:0.6; padding:0 10px">&times;</button>
			</div>
		</div>
	`
	editor.appendChild(toolbar)
	
	wrap = document.createElement('div')
	wrap.className = 'mv-canvas-wrap'
	wrap.style.cssText = 'flex:1;position:relative;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;'
	
	const videoContainer = document.createElement('div')
	videoContainer.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none;'
	wrap.appendChild(videoContainer)
	
	canvas = document.createElement('canvas')
	canvas.style.cssText = 'position:relative;z-index:2;box-shadow:0 0 50px rgba(0,0,0,0.5);cursor:crosshair;'
	wrap.appendChild(canvas)
	editor.appendChild(wrap)
	document.body.appendChild(editor)

	const closeBtn = editor.querySelector('#px-close')
	const closeX = editor.querySelector('#px-close-x')
	const delBtn = editor.querySelector('#px-delete')
	const nodeLabel = editor.querySelector('#px-node-label')
	const pgmLabel = editor.querySelector('#px-pgm-label')

	const closeEditor = () => { editor.style.display = 'none' }
	closeBtn.onclick = closeEditor
	closeX.onclick = closeEditor
	closeX.onmouseover = () => closeX.style.opacity = '1'
	closeX.onmouseout = () => closeX.style.opacity = '0.6'

	wrap.addEventListener('mousedown', (e) => {
		if (e.target === wrap) closeEditor()
	})
	delBtn.onclick = () => {
		if (selectedId && confirm('Delete this slice?')) {
			mappingState.removeMapping(selectedId)
			selectedId = null
			delBtn.style.display = 'none'
			draw()
		}
	}

	mappingState.on('change', () => {
		if (mappingState.activeNode) {
			nodeLabel.textContent = `Mapping: ${mappingState.activeNode.label || mappingState.activeNode.id}`
			pgmLabel.textContent = `Canvas: ${mappingState.canvasWidth}×${mappingState.canvasHeight}`
		}
		fitInContainer()
		draw()
	})

	ctx = canvas.getContext('2d')
	window.addEventListener('resize', () => { if (editor.style.display === 'flex') { fitInContainer(); draw() } })

	canvas.addEventListener('mousedown', (e) => {
		const rect = canvas.getBoundingClientRect()
		const p = toCanvas(e.clientX - rect.left, e.clientY - rect.top)
		
		if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
			dragMode = 'pan'
			dragStart = { x: e.clientX, y: e.clientY, ox: offsetX, oy: offsetY }
			e.preventDefault()
			return
		}

		const item = getItemAt(p.x, p.y)
		if (item) {
			selectedId = item.id
			delBtn.style.display = 'block'
			if (item._handle === 'rotate') {
				dragMode = 'rotate'
				const angle = (item.rotation || 0) * (Math.PI / 180)
				const dx = p.x - (item.rect.x + item.rect.w / 2)
				const dy = p.y - (item.rect.y + item.rect.h / 2)
				dragStart = { angle: Math.atan2(dy, dx) - angle }
			} else {
				dragMode = 'move'
				dragStart = { x: p.x, y: p.y, rect: { ...item.rect } }
			}
		} else {
			selectedId = null
			delBtn.style.display = 'none'
		}
		draw()
	})

	canvas.addEventListener('contextmenu', (e) => e.preventDefault())

	canvas.addEventListener('wheel', (e) => {
		e.preventDefault()
		const rect = canvas.getBoundingClientRect()
		const mx = e.clientX - rect.left
		const my = e.clientY - rect.top
		
		const before = toCanvas(mx, my)
		const delta = -e.deltaY
		const factor = delta > 0 ? 1.1 : 0.9
		scale = Math.max(0.05, Math.min(20, scale * factor))
		
		// Adjust offset to keep mouse point fixed
		offsetX = mx - before.x * scale
		offsetY = my - before.y * scale
		
		draw()
	}, { passive: false })

	canvas.addEventListener('mousemove', (e) => {
		if (!dragMode) return
		const rect = canvas.getBoundingClientRect()
		const p = toCanvas(e.clientX - rect.left, e.clientY - rect.top)
		
		if (dragMode === 'pan') {
			offsetX = dragStart.ox + (e.clientX - dragStart.x)
			offsetY = dragStart.oy + (e.clientY - dragStart.y)
		} else if (dragMode === 'move') {
			const dx = p.x - dragStart.x
			const dy = p.y - dragStart.y
			mappingState.updateMapping(selectedId, { rect: { x: Math.round(dragStart.rect.x + dx), y: Math.round(dragStart.rect.y + dy) } })
		} else if (dragMode === 'rotate') {
			const m = mappingState.mappings.find((i) => i.id === selectedId)
			if (!m) return
			const dx = p.x - (m.rect.x + m.rect.w / 2)
			const dy = p.y - (m.rect.y + m.rect.h / 2)
			const angle = Math.atan2(dy, dx) - dragStart.angle
			mappingState.updateMapping(selectedId, { rotation: Math.round(angle * (180 / Math.PI)) })
		}
		draw()
	})

	canvas.addEventListener('mouseup', () => { dragMode = null; draw() })

	window.addEventListener('highascg-pixel-mapping-open', async (ev) => {
		if (ev.detail?.nodeId) {
			const target = document.getElementById('tab-device-view')
			hostContainer = target || root || document.body
			if (editor.parentElement !== hostContainer) hostContainer.appendChild(editor)
			if (hostContainer === document.body) {
				editor.style.position = 'fixed'
				editor.style.inset = '0'
			} else {
				const cs = window.getComputedStyle(hostContainer)
				if (!cs || cs.position === 'static') hostContainer.style.position = 'relative'
				editor.style.position = 'absolute'
				editor.style.inset = '0'
			}
			editor.style.display = 'flex'
			const payload = await api.get('/api/device-view')
			mappingState.setActiveNode(ev.detail.nodeId, payload)
			fitInContainer()
			draw()
		}
	})
	window.addEventListener('keydown', (ev) => {
		if (ev.key === 'Escape' && editor.style.display === 'flex') editor.style.display = 'none'
	})

	// Sync: when device-view inspector updates mapping values, refresh canvas
	window.addEventListener('highascg-mapping-inspector-updated', async (ev) => {
		if (editor.style.display !== 'flex') return
		if (!mappingState.activeNodeId) return
		if (ev.detail?.nodeId && ev.detail.nodeId !== mappingState.activeNodeId) return
		try {
			const payload = await api.get('/api/device-view')
			await mappingState.setActiveNode(mappingState.activeNodeId, payload)
			fitInContainer()
			draw()
		} catch (e) {
			console.error('[PixelMapEditor] Refresh from inspector failed:', e)
		}
	})
}
