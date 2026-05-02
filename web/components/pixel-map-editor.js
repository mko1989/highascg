/**
 * Unified Mapping Editor — visual tool for Video Slicing and DMX Pixel Mapping.
 */
import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import { api } from '../lib/api-client.js'
import { initLiveView } from './live-view.js'
import { streamState, shouldShowLiveVideo } from '../lib/stream-state.js'
import { mappingState } from '../lib/mapping-state.js'

const HANDLE_SIZE = 8
const ROTATE_HANDLE_DIST = 30

export function initPixelMapEditor(root, stateStore) {
	let canvas, ctx
	let scale = 1
	let offsetX = 0
	let offsetY = 0
	let dragMode = null // 'move' | 'resize-*' | 'rotate'
	let dragStart = { x: 0, y: 0, item: null, angle: 0 }
	let selectedId = null
	let wrap = null

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
		const sx = w / cw
		const sy = h / ch
		scale = Math.min(sx, sy, 0.95)
		offsetX = (w - cw * scale) / 2
		offsetY = (h - ch * scale) / 2
	}

	function toScreen(x, y) {
		return { x: offsetX + x * scale, y: offsetY + y * scale }
	}
	function toCanvas(x, y) {
		return { x: (x - offsetX) / scale, y: (y - offsetY) / scale }
	}

	function getItemAt(cx, cy) {
		const items = mappingState.mappings
		for (let i = items.length - 1; i >= 0; i--) {
			const m = items[i]
			const { x, y, w, h } = m.rect
			const angle = (m.rotation || 0) * (Math.PI / 180)
			
			const dx = cx - (x + w / 2)
			const dy = cy - (y + h / 2)
			const cosA = Math.cos(-angle)
			const sinA = Math.sin(-angle)
			const lx = dx * cosA - dy * sinA
			const ly = dx * sinA + dy * cosA
			
			if (lx >= -w/2 && lx <= w/2 && ly >= -h/2 && ly <= h/2) return m
			
			// Rotation handle
			if (selectedId === m.id) {
				const hlx = 0
				const hly = -h/2 - ROTATE_HANDLE_DIST
				const hdist = Math.sqrt((lx - hlx)**2 + (ly - hly)**2)
				if (hdist < (HANDLE_SIZE / scale) * 2) return { ...m, _handle: 'rotate' }
			}
		}
		return null
	}

	function draw() {
		if (!ctx || !canvas) return
		const mw = mappingState.canvasWidth
		const mh = mappingState.canvasHeight
		const bx = offsetX, by = offsetY
		const bw = mw * scale, bh = mh * scale

		ctx.fillStyle = '#0a0e13'
		ctx.fillRect(0, 0, canvas.width, canvas.height)

		const isLive = shouldShowLiveVideo()
		if (isLive) {
			ctx.clearRect(bx, by, bw, bh)
		} else {
			ctx.fillStyle = '#131a22'
			ctx.fillRect(bx, by, bw, bh)
		}

		// Canvas border
		ctx.strokeStyle = 'rgba(255,255,255,0.2)'
		ctx.setLineDash([5, 5])
		ctx.strokeRect(bx, by, bw, bh)
		ctx.setLineDash([])

		mappingState.mappings.forEach(m => {
			const { x, y, w, h } = m.rect
			const angle = (m.rotation || 0) * (Math.PI / 180)
			const isSelected = selectedId === m.id
			
			ctx.save()
			ctx.translate(bx + (x + w/2) * scale, by + (y + h/2) * scale)
			ctx.rotate(angle)
			
			// Fill based on type
			if (m.type === 'video_slice') {
				ctx.fillStyle = isSelected ? 'rgba(88,166,255,0.2)' : 'rgba(88,166,255,0.1)'
				ctx.fillRect(-w/2 * scale, -h/2 * scale, w * scale, h * scale)
			} else {
				ctx.fillStyle = isSelected ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)'
				ctx.fillRect(-w/2 * scale, -h/2 * scale, w * scale, h * scale)
			}

			// Main box
			ctx.strokeStyle = isSelected ? '#58a6ff' : (m.type === 'video_slice' ? '#388bfd' : '#8b949e')
			ctx.lineWidth = isSelected ? 2 : 1
			ctx.strokeRect(-w/2 * scale, -h/2 * scale, w * scale, h * scale)
			
			// Label
			ctx.fillStyle = '#fff'
			ctx.font = `bold 10px ${UI_FONT_FAMILY}`
			ctx.textAlign = 'center'
			ctx.fillText(m.label || m.id, 0, -h/2 * scale - 12)
			
			ctx.fillStyle = 'rgba(255,255,255,0.5)'
			ctx.font = `9px ${UI_FONT_FAMILY}`
			ctx.fillText(m.type === 'video_slice' ? 'Video Slice' : 'DMX Fixture', 0, -h/2 * scale - 2)

			if (isSelected) {
				// Rotation handle
				ctx.beginPath()
				ctx.strokeStyle = '#58a6ff'
				ctx.moveTo(0, -h/2 * scale)
				ctx.lineTo(0, -h/2 * scale - ROTATE_HANDLE_DIST * scale)
				ctx.stroke()
				
				ctx.fillStyle = '#58a6ff'
				ctx.beginPath()
				ctx.arc(0, -h/2 * scale - ROTATE_HANDLE_DIST * scale, HANDLE_SIZE/2 * scale, 0, Math.PI * 2)
				ctx.fill()
			}

			ctx.restore()
		})
	}

	function render() {
		root.innerHTML = ''
		const editor = document.createElement('div')
		editor.className = 'pixel-map-editor'
		editor.style.display = 'flex'; editor.style.height = '100%'; editor.style.flexDirection = 'column'

		const mainArea = document.createElement('div')
		mainArea.style.flex = '1'; mainArea.style.position = 'relative'; mainArea.style.display = 'flex'; mainArea.style.flexDirection = 'column'

		const toolbar = document.createElement('div')
		toolbar.className = 'mv-toolbar'
		toolbar.innerHTML = `
			<div style="display:flex; align-items:center; gap:12px; width:100%">
				<span id="px-node-label" style="font-weight:bold; font-size:12px">Pixel Mapping</span>
				<span id="px-pgm-label" style="font-size: 11px; opacity: 0.6;"></span>
				<div style="margin-left:auto; display:flex; gap:8px">
					<button type="button" class="mv-btn" id="px-delete" style="display:none; background:rgba(255,68,68,0.2)">Delete</button>
					<button type="button" class="mv-btn" id="px-close">Close Editor</button>
				</div>
			</div>
		`
		mainArea.appendChild(toolbar)

		wrap = document.createElement('div')
		wrap.className = 'mv-canvas-wrap'
		wrap.style.flex = '1'; wrap.style.position = 'relative'; wrap.style.backgroundColor = '#000'
		
		const videoContainer = document.createElement('div')
		videoContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;pointer-events:none;'
		wrap.appendChild(videoContainer)

		canvas = document.createElement('canvas')
		canvas.style.cssText = 'position:relative;z-index:2;pointer-events:auto;'
		wrap.appendChild(canvas)
		mainArea.appendChild(wrap)
		editor.appendChild(mainArea)
		root.appendChild(editor)

		const updateLabels = () => {
			const nodeLabel = root.querySelector('#px-node-label')
			const pgmLabel = root.querySelector('#px-pgm-label')
			if (nodeLabel) nodeLabel.textContent = mappingState.activeNode?.label || 'Pixel Mapping'
			if (pgmLabel) pgmLabel.textContent = `${mappingState.canvasWidth}×${mappingState.canvasHeight}`
		}
		
		mappingState.on('change', () => { updateLabels(); fitInContainer(); draw() })
		updateLabels()

		let liveView = null
		function updateLiveView() {
			if (shouldShowLiveVideo()) {
				if (!liveView) liveView = initLiveView(videoContainer, 'pgm_1')
			} else if (liveView) {
				liveView.destroy(); liveView = null
			}
			draw()
		}
		streamState.subscribe(updateLiveView); updateLiveView()

		ctx = canvas.getContext('2d')
		fitInContainer()
		new ResizeObserver(() => { fitInContainer(); draw() }).observe(wrap)

		// Events
		root.querySelector('#px-close').onclick = () => {
			window.dispatchEvent(new CustomEvent('highascg-mapping-browser-visibility', { detail: { visible: false } }))
			document.querySelector('.tab[data-tab="device-view"]')?.click()
		}
		
		const delBtn = root.querySelector('#px-delete')
		delBtn.onclick = () => {
			if (selectedId) {
				mappingState.removeMapping(selectedId)
				selectedId = null
				delBtn.style.display = 'none'
				draw()
			}
		}

		canvas.addEventListener('mousedown', (e) => {
			const rect = canvas.getBoundingClientRect()
			const { x, y } = toCanvas(e.clientX - rect.left, e.clientY - rect.top)
			const item = getItemAt(x, y)
			if (item) {
				selectedId = item.id
				delBtn.style.display = ''
				if (item._handle === 'rotate') {
					dragMode = 'rotate'
					const angle = (item.rotation || 0) * (Math.PI / 180)
					const dx = x - (item.rect.x + item.rect.w/2)
					const dy = y - (item.rect.y + item.rect.h/2)
					dragStart = { angle: Math.atan2(dy, dx) - angle }
				} else {
					dragMode = 'move'
					dragStart = { x, y, rect: { ...item.rect } }
				}
			} else {
				selectedId = null
				delBtn.style.display = 'none'
			}
			draw()
		})

		canvas.addEventListener('mousemove', (e) => {
			if (!dragMode) return
			const rect = canvas.getBoundingClientRect()
			const { x, y } = toCanvas(e.clientX - rect.left, e.clientY - rect.top)
			if (dragMode === 'move') {
				const dx = x - dragStart.x
				const dy = y - dragStart.y
				mappingState.updateMapping(selectedId, {
					rect: { x: Math.round(dragStart.rect.x + dx), y: Math.round(dragStart.rect.y + dy) }
				})
			} else if (dragMode === 'rotate') {
				const m = mappingState.mappings.find(i => i.id === selectedId)
				const dx = x - (m.rect.x + m.rect.w/2)
				const dy = y - (m.rect.y + m.rect.h/2)
				let angle = Math.atan2(dy, dx) - dragStart.angle
				mappingState.updateMapping(selectedId, { rotation: Math.round(angle * (180 / Math.PI)) })
			}
			draw()
		})

		canvas.addEventListener('mouseup', () => { dragMode = null; draw() })

		// Drag & Drop templates
		canvas.addEventListener('dragover', (e) => {
			if (e.dataTransfer.types.includes('application/x-highascg-mapping-template')) {
				e.preventDefault()
			}
		})

		canvas.addEventListener('drop', (e) => {
			e.preventDefault()
			const raw = e.dataTransfer.getData('application/x-highascg-mapping-template')
			if (!raw) return
			try {
				const template = JSON.parse(raw)
				const rect = canvas.getBoundingClientRect()
				const { x, y } = toCanvas(e.clientX - rect.left, e.clientY - rect.top)
				// Center the dropped template on mouse
				const mapping = mappingState.addMappingFromTemplate(template, { 
					x: Math.round(x - (template.width || 200) / 2), 
					y: Math.round(y - (template.height || 200) / 2) 
				})
				selectedId = mapping.id
				delBtn.style.display = ''
				draw()
			} catch (err) { console.error('Mapping drop failed:', err) }
		})

		window.addEventListener('highascg-mapping-browser-visibility', (ev) => {
			if (ev.detail?.visible && ev.detail?.nodeId) {
				api.get('/api/device-view').then(payload => {
					mappingState.setActiveNode(ev.detail.nodeId, payload)
				})
			}
		})
	}

	render()
}
