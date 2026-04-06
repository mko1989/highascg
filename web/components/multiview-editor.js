/**
 * Multiview editor — canvas with draggable/resizable boxes for PGM, PRV, Decklink.
 * Apply sends routes + MIXER FILL to CasparCG.
 * @see main_plan.md Prompt 15
 */

import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import { multiviewState } from '../lib/multiview-state.js'
import { api } from '../lib/api-client.js'
import { initLiveView } from './live-view.js'
import { streamState, shouldShowLiveVideo } from '../lib/stream-state.js'
import { settingsState } from '../lib/settings-state.js'

const HANDLE_SIZE = 8
const CELL_COLORS = { pgm: '#e63946', prv: '#2a9d8f', decklink: '#457b9d', ndi: '#e9c46a' }

/**
 * @param {HTMLElement} root - Multiview tab container
 * @param {object} stateStore - Module state (for channelMap)
 */
export function initMultiviewEditor(root, stateStore) {
	let canvas, ctx
	let scale = 1
	let offsetX = 0
	let offsetY = 0
	let selectedId = null
	let dragMode = null // 'move' | 'resize-se' | 'resize-sw' | 'resize-ne' | 'resize-nw' | 'resize-e' | ...
	let dragStart = { x: 0, y: 0, cell: null }
	let dropHoverId = null // cell id being hovered during source drag-over

	function getChannelMap() {
		return stateStore.getState()?.channelMap || {}
	}

	/** Only auto-create PGM/PRV cells once when storage is empty — not on every state/WebSocket refresh (fixes reset on reconnect). */
	let didAutoBuildDefault = false
	function ensureLayout() {
		const cm = getChannelMap()
		const hasChannels = (cm.programChannels?.length || cm.previewChannels?.length)
		if (!hasChannels) return
		if (multiviewState.getCells().length > 0) {
			didAutoBuildDefault = true
			return
		}
		if (didAutoBuildDefault) return
		multiviewState.buildDefault(cm)
		didAutoBuildDefault = true
	}

	let wrap = null

	function fitInContainer() {
		if (!canvas || !wrap) return
		const r = wrap.getBoundingClientRect()
		const w = Math.max(1, r.width)
		const h = Math.max(1, r.height)
		// Setting canvas dimensions resets the bitmap — only when size changes avoids blank flashes on frequent calls.
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w
			canvas.height = h
		}
		const cw = multiviewState.canvasWidth
		const ch = multiviewState.canvasHeight
		const sx = w / cw
		const sy = h / ch
		scale = Math.min(sx, sy, 1)
		offsetX = (w - cw * scale) / 2
		offsetY = (h - ch * scale) / 2
	}

	function toScreen(x, y) {
		return { x: offsetX + x * scale, y: offsetY + y * scale }
	}
	function toCanvas(x, y) {
		return { x: (x - offsetX) / scale, y: (y - offsetY) / scale }
	}

	function getCellAt(canvasX, canvasY) {
		const cells = multiviewState.getCells()
		for (let i = cells.length - 1; i >= 0; i--) {
			const c = cells[i]
			if (canvasX >= c.x && canvasX <= c.x + c.w && canvasY >= c.y && canvasY <= c.y + c.h) return c
		}
		return null
	}

	function getResizeHandle(cell, canvasX, canvasY) {
		const tol = HANDLE_SIZE / scale
		const { x, y, w, h } = cell
		const handles = [
			['se', x + w - tol, y + h - tol, x + w + tol, y + h + tol],
			['sw', x - tol, y + h - tol, x + tol, y + h + tol],
			['ne', x + w - tol, y - tol, x + w + tol, y + tol],
			['nw', x - tol, y - tol, x + tol, y + tol],
			['e', x + w - tol, y + h / 2 - tol, x + w + tol, y + h / 2 + tol],
			['w', x - tol, y + h / 2 - tol, x + tol, y + h / 2 + tol],
			['s', x + w / 2 - tol, y + h - tol, x + w / 2 + tol, y + h + tol],
			['n', x + w / 2 - tol, y - tol, x + w / 2 + tol, y + tol],
		]
		for (const [name, x1, y1, x2, y2] of handles) {
			if (canvasX >= x1 && canvasX <= x2 && canvasY >= y1 && canvasY <= y2) return name
		}
		return null
	}

	function draw() {
		if (!ctx || !canvas) return

		const mw = multiviewState.canvasWidth
		const mh = multiviewState.canvasHeight
		const bx = offsetX, by = offsetY
		const bw = mw * scale, bh = mh * scale

		// Outer chrome (outside the multiview canvas area)
		ctx.fillStyle = '#0a0e13'
		ctx.fillRect(0, 0, canvas.width, canvas.height)

		const isLive = shouldShowLiveVideo()
		if (isLive) {
			ctx.clearRect(bx, by, bw, bh)
		} else {
			// Multiview canvas area — slightly lighter background to distinguish it
			ctx.fillStyle = dropHoverId === '__canvas__' ? '#1a2535' : '#131a22'
			ctx.fillRect(bx, by, bw, bh)
		}

		// Dashed border marking the canvas edge
		ctx.save()
		ctx.strokeStyle = 'rgba(255,255,255,0.45)'
		ctx.lineWidth = 1.5
		ctx.setLineDash([8, 5])
		ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1)
		ctx.setLineDash([])
		ctx.restore()

		// Canvas size label at bottom-right of the canvas area
		const sizeLabel = `${mw}×${mh}`
		ctx.save()
		ctx.font = `${Math.round(Math.max(10, 12 * scale))}px ${UI_FONT_FAMILY}`
		ctx.fillStyle = 'rgba(255,255,255,0.3)'
		const tw = ctx.measureText(sizeLabel).width
		ctx.fillText(sizeLabel, bx + bw - tw - 6, by + bh - 5)
		ctx.restore()

		// Draw cells
		ctx.save()
		ctx.translate(bx, by)
		ctx.scale(scale, scale)

		const cells = multiviewState.getCells()
		cells.forEach((c) => {
			const isDropTarget = dropHoverId === c.id
			const borderColor = CELL_COLORS[c.type] || '#8b949e'
			// No fill over video — borders + label only (live picture stays visible)
			// Border — match output overlay (3px colored border)
			ctx.strokeStyle = (selectedId === c.id || isDropTarget) ? '#58a6ff' : borderColor
			ctx.lineWidth = 3
			ctx.strokeRect(c.x, c.y, c.w, c.h)
			if (isDropTarget) {
				ctx.save()
				ctx.strokeStyle = '#58a6ff'
				ctx.lineWidth = 1.5
				ctx.setLineDash([6, 4])
				ctx.strokeRect(c.x - 2, c.y - 2, c.w + 4, c.h + 4)
				ctx.setLineDash([])
				ctx.restore()
			}
			// Label bar below cell (matches multiview_overlay.html: 50px height, extends below MIXER FILL area)
			const OVERLAY_LABEL_H = 50
			const OVERLAY_BORDER = 3
			const labelH = OVERLAY_LABEL_H
			const labelY = c.y + c.h + OVERLAY_BORDER
			ctx.fillStyle = 'rgba(0,0,0,0.72)'
			ctx.fillRect(c.x - OVERLAY_BORDER, labelY, c.w + OVERLAY_BORDER * 2, labelH)
			ctx.strokeStyle = borderColor
			ctx.lineWidth = 2
			ctx.strokeRect(c.x - OVERLAY_BORDER + 0.5, labelY + 0.5, c.w + OVERLAY_BORDER * 2 - 1, labelH - 1)
			ctx.fillStyle = '#fff'
			ctx.font = `bold 14px ${UI_FONT_FAMILY}`
			ctx.textAlign = 'center'
			ctx.textBaseline = 'middle'
			const displayLabel = (c.source ? (c.source.label || c.source.value) : c.label) || c.id || ''
			const shortLabel = displayLabel.length > 28 ? displayLabel.slice(0, 25) + '…' : displayLabel
			ctx.fillText(shortLabel, c.x + c.w / 2, labelY + labelH / 2)
			
			// Audio indicator (🔊)
			if (multiviewState.audioActiveCellId === c.id) {
				ctx.save()
				ctx.textAlign = 'right'
				ctx.fillStyle = '#fff'
				ctx.fillText('🔊', c.x + c.w - 10, labelY + labelH / 2)
				ctx.restore()
			}
			
			ctx.textAlign = 'left'
			ctx.textBaseline = 'alphabetic'
		})

		ctx.restore()

		// "Drop sources here" hint when no cells exist
		if (cells.length === 0) {
			ctx.save()
			ctx.fillStyle = 'rgba(255,255,255,0.18)'
			ctx.font = `14px ${UI_FONT_FAMILY}`
			ctx.textAlign = 'center'
			ctx.fillText('Drag sources here or click Reset Layout', bx + bw / 2, by + bh / 2)
			ctx.textAlign = 'left'
			ctx.restore()
		}
	}

	function render() {
		root.innerHTML = ''
		const editor = document.createElement('div')
		editor.className = 'mv-editor'
		const toolbar = document.createElement('div')
		toolbar.className = 'mv-toolbar'
		toolbar.innerHTML = `
			<button class="mv-btn" id="mv-apply">Apply Layout</button>
			<button class="mv-btn" id="mv-reset">Reset Layout</button>
			<label class="mv-chk"><input type="checkbox" id="mv-overlay" ${multiviewState.showOverlay ? 'checked' : ''}> Show borders/labels</label>
		`
		root.appendChild(toolbar)

		wrap = document.createElement('div')
		wrap.className = 'mv-canvas-wrap'
		wrap.style.position = 'relative'
		wrap.style.backgroundColor = '#000'
		wrap.style.overflow = 'hidden'
		
		const videoContainer = document.createElement('div')
		// Video must not capture pointer — canvas handles drag/resize; otherwise live WebRTC blocks editing.
		videoContainer.style.cssText =
			'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;pointer-events:none;'
		wrap.appendChild(videoContainer)

		canvas = document.createElement('canvas')
		canvas.style.cssText = 'position:relative;z-index:2;pointer-events:auto;'
		wrap.appendChild(canvas)
		root.appendChild(wrap)
		
		let liveView = null
		function updateLiveView() {
			if (shouldShowLiveVideo()) {
				if (!liveView) {
					liveView = initLiveView(videoContainer, 'multiview')
				}
			} else {
				if (liveView) {
					liveView.destroy()
					liveView = null
				}
			}
			draw()
		}

		const unsubStream = streamState.subscribe(() => updateLiveView())
		const unsubSettings = settingsState.subscribe(() => updateLiveView())
		updateLiveView()

		ctx = canvas.getContext('2d')
		ensureLayout()
		fitInContainer()

		// Recalc when container gets a real size (e.g. user switches to this tab)
		const resizeObs = new ResizeObserver(() => {
			fitInContainer()
			draw()
		})
		if (wrap) resizeObs.observe(wrap)
		window.addEventListener('resize', () => { fitInContainer(); draw() })
		document.addEventListener('mv-tab-activated', () => {
			void streamState.refreshStreams().finally(() => {
				updateLiveView()
				fitInContainer()
				draw()
			})
		})

		root.querySelector('#mv-apply').addEventListener('click', () => applyLayout())
		root.querySelector('#mv-reset').addEventListener('click', () => {
			multiviewState.clearLayout()
			selectedId = null
			window.dispatchEvent(new CustomEvent('multiview-select', { detail: {} }))
			draw()
		})
		root.querySelector('#mv-overlay').addEventListener('change', (e) => {
			multiviewState.setShowOverlay(e.target.checked)
		})

		canvas.addEventListener('mousedown', (e) => {
			const rect = canvas.getBoundingClientRect()
			const { x: cx, y: cy } = toCanvas(e.clientX - rect.left, e.clientY - rect.top)
			const cell = getCellAt(cx, cy)
			if (cell) {
				selectedId = cell.id
				const handle = getResizeHandle(cell, cx, cy)
				if (handle) {
					dragMode = 'resize-' + handle
					dragStart = { mouseX: cx, mouseY: cy, cell: { ...cell } }
				} else {
					dragMode = 'move'
					dragStart = { x: cx, y: cy, cell: { ...cell } }
				}
				window.dispatchEvent(new CustomEvent('multiview-select', { detail: { cellId: selectedId } }))
			} else {
				selectedId = null
				window.dispatchEvent(new CustomEvent('multiview-select', { detail: {} }))
			}
		})
		canvas.addEventListener('contextmenu', (e) => {
			e.preventDefault()
			const rect = canvas.getBoundingClientRect()
			const { x: cx, y: cy } = toCanvas(e.clientX - rect.left, e.clientY - rect.top)
			const cell = getCellAt(cx, cy)
			if (!cell) return
			if (cell.source) {
				// First right-click: clear the custom source assignment
				multiviewState.setCellSource(cell.id, null)
			} else {
				// Right-click with no source: remove the cell entirely
				multiviewState.removeCell(cell.id)
				if (selectedId === cell.id) {
					selectedId = null
					window.dispatchEvent(new CustomEvent('multiview-select', { detail: {} }))
				}
			}
		})
		canvas.addEventListener('click', (e) => {
			const rect = canvas.getBoundingClientRect()
			const { x: cx, y: cy } = toCanvas(e.clientX - rect.left, e.clientY - rect.top)
			const cell = getCellAt(cx, cy)
			if (cell) {
				multiviewState.setAudioActiveCell(cell.id)
			}
		})
		canvas.addEventListener('mousemove', (e) => {
			if (!dragMode || !dragStart.cell) return
			const rect = canvas.getBoundingClientRect()
			const { x: cx, y: cy } = toCanvas(e.clientX - rect.left, e.clientY - rect.top)
			const cell = multiviewState.getCell(dragStart.cell.id)
			if (!cell) return
			if (dragMode === 'move') {
				const dx = cx - dragStart.x
				const dy = cy - dragStart.y
				multiviewState.setCell(cell.id, { x: dragStart.cell.x + dx, y: dragStart.cell.y + dy })
				dragStart.x = cx
				dragStart.y = cy
				dragStart.cell = { ...cell }
			} else {
				const handle = dragMode.replace('resize-', '')
				const dx = cx - dragStart.mouseX
				const dy = cy - dragStart.mouseY
				let { x, y, w, h } = { ...dragStart.cell }
				const aspectLocked = !!cell.aspectLocked
				const ratio = (dragStart.cell.w && dragStart.cell.h) ? dragStart.cell.w / dragStart.cell.h : 16 / 9
				if (handle.includes('e')) w = Math.max(60, dragStart.cell.w + dx)
				if (handle.includes('w')) {
					const nw = Math.max(60, dragStart.cell.w - dx)
					x = dragStart.cell.x + dragStart.cell.w - nw
					w = nw
				}
				if (handle.includes('s')) h = Math.max(40, dragStart.cell.h + dy)
				if (handle.includes('n')) {
					const nh = Math.max(40, dragStart.cell.h - dy)
					y = dragStart.cell.y + dragStart.cell.h - nh
					h = nh
				}
				if (aspectLocked) {
					if (handle.includes('e') || handle.includes('w')) h = Math.max(40, Math.round(w / ratio))
					else if (handle.includes('s') || handle.includes('n')) w = Math.max(60, Math.round(h * ratio))
				}
				multiviewState.setCell(cell.id, { x, y, w, h })
			}
		})
		canvas.addEventListener('mouseup', () => { dragMode = null; dragStart = { cell: null } })
		canvas.addEventListener('mouseleave', () => { dragMode = null })

		// Accept sources dragged from the Sources panel
		canvas.addEventListener('dragover', (e) => {
			e.preventDefault()
			e.dataTransfer.dropEffect = 'copy'
			const rect = canvas.getBoundingClientRect()
			const { x: cx, y: cy } = toCanvas(e.clientX - rect.left, e.clientY - rect.top)
			const cell = getCellAt(cx, cy)
			// Show "canvas" hover when over empty area within bounds
			const mw = multiviewState.canvasWidth, mh = multiviewState.canvasHeight
			const inBounds = cx >= 0 && cx <= mw && cy >= 0 && cy <= mh
			const newId = cell ? cell.id : (inBounds ? '__canvas__' : null)
			if (newId !== dropHoverId) {
				dropHoverId = newId
				draw()
			}
		})
		canvas.addEventListener('dragleave', () => {
			dropHoverId = null
			draw()
		})
		canvas.addEventListener('drop', (e) => {
			e.preventDefault()
			dropHoverId = null
			const rect = canvas.getBoundingClientRect()
			const { x: cx, y: cy } = toCanvas(e.clientX - rect.left, e.clientY - rect.top)
			let cell = getCellAt(cx, cy)

			let data
			try {
				data = JSON.parse(e.dataTransfer.getData('application/json'))
			} catch {
				const val = e.dataTransfer.getData('text/plain')
				if (val) data = { type: 'media', value: val, label: val }
			}
			if (!data?.value) { draw(); return }

			if (!cell) {
				// Drop on empty canvas area — create a new cell if within canvas bounds
				const mw = multiviewState.canvasWidth
				const mh = multiviewState.canvasHeight
				if (cx < 0 || cx > mw || cy < 0 || cy > mh) { draw(); return }
				let cw = Math.round(mw / 4)
				let ch = Math.round(mh / 4)
				const isLiveSource = ['route', 'pgm', 'prv', 'decklink'].includes(data.type) || data.routeType
				if (isLiveSource && data.resolution) {
					const m = String(data.resolution).match(/(\d+)[×x](\d+)/i)
					if (m) {
						const sw = parseInt(m[1], 10) || 1920
						const sh = parseInt(m[2], 10) || 1080
						const ratio = Math.max(0.1, sw / sh)
						const baseW = Math.round(mw / 4)
						cw = Math.max(60, Math.min(baseW, mw))
						ch = Math.max(40, Math.round(cw / ratio))
						if (ch > mh) {
							ch = mh
							cw = Math.max(60, Math.round(ch * ratio))
						}
					}
				}
				const x = Math.max(0, Math.min(mw - cw, Math.round(cx - cw / 2)))
				const y = Math.max(0, Math.min(mh - ch, Math.round(cy - ch / 2)))
				const cellType = data.routeType || (data.type === 'pgm' || data.type === 'prv' || data.type === 'decklink'
					? data.type
					: (data.value?.startsWith('route://') ? 'route' : (data.type || 'media')))
				cell = multiviewState.addCell({
					type: cellType,
					label: data.label || data.value,
					x, y, w: cw, h: ch,
					source: { value: data.value, type: data.type || 'media', label: data.label || data.value },
					aspectLocked: isLiveSource,
				})
				selectedId = cell.id
				window.dispatchEvent(new CustomEvent('multiview-select', { detail: { cellId: cell.id } }))
			} else {
				multiviewState.setCellSource(cell.id, { value: data.value, type: data.type || 'media', label: data.label || data.value })
			}
			draw()
		})

		multiviewState.on('change', draw)
		multiviewState.on('audio-change', () => {
			draw()
			applyAudioFocus()
		})
		let storeCoalesceRaf = null
		stateStore.on('*', () => {
			ensureLayout()
			fitInContainer()
			if (storeCoalesceRaf) return
			storeCoalesceRaf = requestAnimationFrame(() => {
				storeCoalesceRaf = null
				draw()
			})
		})
		draw()
	}

	async function applyAudioFocus() {
		const cells = multiviewState.getCells()
		const targetId = multiviewState.audioActiveCellId
		if (!targetId) return

		// Channel 3 is MV channel as per T1.2
		const MV_CH = 3 
		
		const idx = cells.findIndex(c => c.id === targetId)
		if (idx < 0) return

		const layer = idx + 1
		
		// Ensure browser follows the MV audio
		streamState.setAudioSource('multiview')
		streamState.setMuted(false)
		
		try {
			const cmds = []
			cells.forEach((c, i) => {
				const L = i + 1
				cmds.push(`MIXER ${MV_CH} VOLUME ${L} ${L === layer ? 1 : 0}`)
			})
			await api.post('/api/amcp', { commands: cmds })
		} catch (e) {
			console.error('Audio focus AMCP failed:', e)
		}
	}

	async function applyLayout() {
		const cm = getChannelMap()
		const mvCh = cm.multiviewCh
		if (mvCh == null) {
			alert('Multiview is not enabled. Enable it in module settings.')
			return
		}
		const layout = multiviewState.toApiLayout()
		if (layout.length === 0) {
			alert('No layout to apply. Add cells (Reset Layout) or drag sources onto the canvas.')
			return
		}
		try {
			await api.post('/api/multiview/apply', {
				layout,
				showOverlay: multiviewState.showOverlay,
			})
			showApplyFeedback(true)
		} catch (e) {
			console.error('Multiview apply failed:', e)
			const msg = String(e?.message ?? e ?? '')
			const hint = (msg.toLowerCase().includes('not connected') || msg.includes('503'))
				? 'CasparCG is not connected. Check module Settings → Connection and ensure CasparCG server is running.'
				: msg
			alert('Apply failed: ' + hint)
			showApplyFeedback(false)
		}
	}

	function showApplyFeedback(success) {
		const btn = root.querySelector('#mv-apply')
		if (!btn) return
		const orig = btn.textContent
		btn.textContent = success ? 'Applied ✓' : 'Failed'
		btn.disabled = true
		setTimeout(() => {
			btn.textContent = orig
			btn.disabled = false
		}, 1500)
	}

	render()
}
