/**
 * Multiview editor — canvas with draggable/resizable boxes for PGM, PRV, Decklink.
 * Layout changes are applied live (debounced); presets 1–4 save/recall from localStorage (Shift+click clears a slot).
 * @see main_plan.md Prompt 15
 */

import { multiviewState } from '../lib/multiview-state.js'
import { initLiveView } from './live-view.js'
import { streamState, shouldShowLiveVideo } from '../lib/stream-state.js'
import { settingsState } from '../lib/settings-state.js'
import {
	fitInContainer,
	toCanvas,
	getCellAt,
	cursorForResizeHandle,
	getResizeHandle,
	drawMultiviewEditor,
	applyMultiviewLayout,
	applyMultiviewAudioFocus,
} from './multiview-editor-canvas.js'

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

	let applyDebounceTimer = null
	const APPLY_DEBOUNCE_MS = 400

	function scheduleApplyLayout() {
		if (!isMultiviewEnabled()) return
		if (applyDebounceTimer) clearTimeout(applyDebounceTimer)
		applyDebounceTimer = setTimeout(() => {
			applyDebounceTimer = null
			void applyMultiviewLayout(getChannelMap, { silent: true })
		}, APPLY_DEBOUNCE_MS)
	}

	function flushApplyLayout() {
		if (!isMultiviewEnabled()) return
		if (applyDebounceTimer) {
			clearTimeout(applyDebounceTimer)
			applyDebounceTimer = null
		}
		void applyMultiviewLayout(getChannelMap, { silent: true })
	}

	function updatePresetButtonStyles() {
		const slots = multiviewState.getPresetSlots()
		for (let i = 0; i < 4; i++) {
			const btn = root.querySelector(`.mv-preset[data-slot="${i}"]`)
			if (btn) btn.classList.toggle('mv-preset--stored', slots[i] != null)
		}
	}

	let wrap = null
	let disabledOverlay = null

	function isMultiviewEnabled() {
		const cm = getChannelMap()
		return cm.multiviewEnabled !== false && cm.multiviewCh != null
	}

	function syncDisabledOverlay() {
		const enabled = isMultiviewEnabled()
		if (!enabled) {
			if (!disabledOverlay && wrap) {
				disabledOverlay = document.createElement('div')
				disabledOverlay.className = 'mv-disabled-overlay'
				disabledOverlay.innerHTML = `
					<div class="mv-disabled-overlay__content">
						<h3>Multiview disabled</h3>
						<p>Enable multiview in Settings and send config to CasparCG to use this view.</p>
					</div>
				`
				disabledOverlay.style.cssText =
					'position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;' +
					'background:rgba(10,14,19,0.92);color:#8b949e;text-align:center;pointer-events:auto;'
				const content = disabledOverlay.querySelector('.mv-disabled-overlay__content')
				if (content) {
					content.style.cssText = 'max-width:340px;'
					const h = content.querySelector('h3')
					if (h) h.style.cssText = 'margin:0 0 8px;font-size:16px;color:#c9d1d9;'
					const p = content.querySelector('p')
					if (p) p.style.cssText = 'margin:0;font-size:13px;line-height:1.5;'
				}
				wrap.appendChild(disabledOverlay)
			}
			if (disabledOverlay) disabledOverlay.style.display = 'flex'
		} else {
			if (disabledOverlay) disabledOverlay.style.display = 'none'
		}
	}

	function refitCanvas() {
		const r = fitInContainer(canvas, wrap)
		scale = r.scale
		offsetX = r.offsetX
		offsetY = r.offsetY
	}

	function draw() {
		drawMultiviewEditor(ctx, canvas, { offsetX, offsetY, scale, selectedId, dropHoverId })
	}

	function render() {
		root.innerHTML = ''
		const editor = document.createElement('div')
		editor.className = 'mv-editor'
		const toolbar = document.createElement('div')
		toolbar.className = 'mv-toolbar'
		toolbar.innerHTML = `
			<button type="button" class="mv-btn" id="mv-reset">Reset Layout</button>
			<label class="mv-chk"><input type="checkbox" id="mv-overlay" ${multiviewState.showOverlay ? 'checked' : ''}> Show borders/labels</label>
			<span class="mv-toolbar__sep" aria-hidden="true"></span>
			<span class="mv-toolbar__label">Presets</span>
			<button type="button" class="mv-btn mv-preset" data-slot="0" title="1 — first click saves; later recalls · Shift+click: clear slot">1</button>
			<button type="button" class="mv-btn mv-preset" data-slot="1" title="2 — first click saves; later recalls · Shift+click: clear slot">2</button>
			<button type="button" class="mv-btn mv-preset" data-slot="2" title="3 — first click saves; later recalls · Shift+click: clear slot">3</button>
			<button type="button" class="mv-btn mv-preset" data-slot="3" title="4 — first click saves; later recalls · Shift+click: clear slot">4</button>
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
			if (shouldShowLiveVideo() && isMultiviewEnabled()) {
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

		const unsubStream = streamState.subscribe(() => { syncDisabledOverlay(); updateLiveView() })
		const unsubSettings = settingsState.subscribe(() => { syncDisabledOverlay(); updateLiveView() })
		syncDisabledOverlay()
		updateLiveView()

		ctx = canvas.getContext('2d')
		refitCanvas()

		// Recalc when container gets a real size (e.g. user switches to this tab)
		const resizeObs = new ResizeObserver(() => {
			refitCanvas()
			draw()
		})
		if (wrap) resizeObs.observe(wrap)
		window.addEventListener('resize', () => { refitCanvas(); draw() })
		function refreshLayoutVisualOnly() {
			void streamState.refreshStreams().finally(() => {
				updateLiveView()
				refitCanvas()
				draw()
			})
		}
		document.addEventListener('mv-layout-refresh', refreshLayoutVisualOnly)
		/** AMCP TCP just came up (see app.js) — push multiview to Caspar once, not on periodic VERSION / WS churn. */
		document.addEventListener('mv-caspar-amcp-connected', () => {
			void streamState.refreshStreams().finally(() => {
				updateLiveView()
				refitCanvas()
				draw()
				flushApplyLayout()
			})
		})
		document.addEventListener('mv-tab-activated', () => {
			void streamState.refreshStreams().finally(() => {
				updateLiveView()
				refitCanvas()
				draw()
				flushApplyLayout()
			})
		})

		for (const presetBtn of root.querySelectorAll('.mv-preset')) {
			presetBtn.addEventListener('click', (e) => {
				const slot = parseInt(e.currentTarget.getAttribute('data-slot') || '0', 10)
				if (slot < 0 || slot > 3) return
				const slots = multiviewState.getPresetSlots()
				if (e.shiftKey) {
					multiviewState.clearPresetSlot(slot)
					updatePresetButtonStyles()
					return
				}
				if (slots[slot] == null) {
					multiviewState.savePresetSlot(slot, multiviewState.snapshotForPreset())
				} else {
					multiviewState.applyPresetSnapshot(slots[slot])
				}
				updatePresetButtonStyles()
			})
		}
		updatePresetButtonStyles()

		root.querySelector('#mv-reset').addEventListener('click', () => {
			multiviewState.clearLayout()
			selectedId = null
			window.dispatchEvent(new CustomEvent('multiview-select', { detail: {} }))
			draw()
		})
		root.querySelector('#mv-overlay').addEventListener('change', (e) => {
			multiviewState.setShowOverlay(e.target.checked)
		})

		function multiviewTypingTarget(el) {
			if (!el) return false
			if (el.isContentEditable) return true
			const tag = (el.tagName || '').toUpperCase()
			return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
		}

		document.addEventListener(
			'keydown',
			(e) => {
				if (e.key !== 'Delete' && e.key !== 'Backspace') return
				if (!root.classList.contains('active')) return
				if (!selectedId) return
				if (multiviewTypingTarget(e.target)) return
				if (e.target?.closest?.('#settings-modal')) return
				const cell = multiviewState.getCell(selectedId)
				if (!cell) {
					selectedId = null
					return
				}
				e.preventDefault()
				if (cell.source) {
					multiviewState.setCellSource(cell.id, null)
				} else {
					multiviewState.removeCell(cell.id)
					selectedId = null
					window.dispatchEvent(new CustomEvent('multiview-select', { detail: {} }))
				}
				draw()
				flushApplyLayout()
			},
			true
		)

		canvas.addEventListener('mousedown', (e) => {
			const rect = canvas.getBoundingClientRect()
			const { x: cx, y: cy } = toCanvas(e.clientX - rect.left, e.clientY - rect.top, offsetX, offsetY, scale)
			const cell = getCellAt(cx, cy)
			if (cell) {
				selectedId = cell.id
				const handle = getResizeHandle(cell, cx, cy, scale)
				if (handle) {
					dragMode = 'resize-' + handle
					dragStart = { mouseX: cx, mouseY: cy, cell: { ...cell } }
					canvas.style.cursor = cursorForResizeHandle(handle)
				} else {
					dragMode = 'move'
					dragStart = { x: cx, y: cy, cell: { ...cell } }
					canvas.style.cursor = 'grabbing'
				}
				window.dispatchEvent(new CustomEvent('multiview-select', { detail: { cellId: selectedId } }))
			} else {
				selectedId = null
				canvas.style.cursor = ''
				window.dispatchEvent(new CustomEvent('multiview-select', { detail: {} }))
			}
		})
		canvas.addEventListener('contextmenu', (e) => {
			e.preventDefault()
			const rect = canvas.getBoundingClientRect()
			const { x: cx, y: cy } = toCanvas(e.clientX - rect.left, e.clientY - rect.top, offsetX, offsetY, scale)
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
			const { x: cx, y: cy } = toCanvas(e.clientX - rect.left, e.clientY - rect.top, offsetX, offsetY, scale)
			const cell = getCellAt(cx, cy)
			if (cell) {
				multiviewState.setAudioActiveCell(cell.id)
			}
		})
		canvas.addEventListener('mousemove', (e) => {
			const rect = canvas.getBoundingClientRect()
			const { x: cx, y: cy } = toCanvas(e.clientX - rect.left, e.clientY - rect.top, offsetX, offsetY, scale)
			if (dragMode && dragStart.cell) {
				const cell = multiviewState.getCell(dragStart.cell.id)
				if (!cell) return
				if (dragMode === 'move') {
					canvas.style.cursor = 'grabbing'
					const dx = cx - dragStart.x
					const dy = cy - dragStart.y
					multiviewState.setCell(cell.id, { x: dragStart.cell.x + dx, y: dragStart.cell.y + dy })
					dragStart.x = cx
					dragStart.y = cy
					dragStart.cell = { ...cell }
				} else {
					const handle = dragMode.replace('resize-', '')
					canvas.style.cursor = cursorForResizeHandle(handle)
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
				return
			}
			const cell = getCellAt(cx, cy)
			if (!cell) {
				canvas.style.cursor = ''
				return
			}
			const h = getResizeHandle(cell, cx, cy, scale)
			if (h) canvas.style.cursor = cursorForResizeHandle(h)
			else canvas.style.cursor = 'move'
		})
		canvas.addEventListener('mouseup', () => {
			dragMode = null
			dragStart = { cell: null }
			flushApplyLayout()
		})
		canvas.addEventListener('mouseleave', () => {
			dragMode = null
			canvas.style.cursor = ''
		})

		// Accept sources dragged from the Sources panel
		canvas.addEventListener('dragover', (e) => {
			e.preventDefault()
			e.dataTransfer.dropEffect = 'copy'
			const rect = canvas.getBoundingClientRect()
			const { x: cx, y: cy } = toCanvas(e.clientX - rect.left, e.clientY - rect.top, offsetX, offsetY, scale)
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
			const { x: cx, y: cy } = toCanvas(e.clientX - rect.left, e.clientY - rect.top, offsetX, offsetY, scale)
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
			flushApplyLayout()
		})

		multiviewState.on('change', () => {
			draw()
			scheduleApplyLayout()
		})
		multiviewState.on('audio-change', () => {
			draw()
			void applyMultiviewAudioFocus()
		})
		let storeCoalesceRaf = null
		stateStore.on('*', () => {
			syncDisabledOverlay()
			refitCanvas()
			if (storeCoalesceRaf) return
			storeCoalesceRaf = requestAnimationFrame(() => {
				storeCoalesceRaf = null
				draw()
			})
		})
		draw()
		flushApplyLayout()
	}

	render()
}
