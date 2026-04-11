/**
 * Pixel Map Editor — visual tool for DMX fixture sampling zones.
 */

import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import { dmxState } from '../lib/dmx-state.js'
import { api } from '../lib/api-client.js'
import { initLiveView } from './live-view.js'
import { streamState, shouldShowLiveVideo } from '../lib/stream-state.js'
import { settingsState } from '../lib/settings-state.js'
import { dashboardState } from '../lib/dashboard-state.js'

const HANDLE_SIZE = 8
const ROTATE_HANDLE_DIST = 30

export function initPixelMapEditor(root, stateStore) {
	let canvas, ctx
	let scale = 1
	let offsetX = 0
	let offsetY = 0
	let selectedId = null
	let dragMode = null // 'move' | 'resize-*' | 'rotate'
	let dragStart = { x: 0, y: 0, fixture: null, angle: 0 }
	
	function getChannelMap() {
		return stateStore.getState()?.channelMap || {}
	}

	function syncCanvasAndToolbar() {
		dmxState.syncCanvasFromProgramResolution(getChannelMap(), dashboardState.activeScreenIndex)
		const el = root.querySelector('#px-pgm-label')
		if (el) {
			el.textContent = `Sampling Program Output (${dmxState.canvasWidth}×${dmxState.canvasHeight})`
		}
	}

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
		const cw = dmxState.canvasWidth
		const ch = dmxState.canvasHeight
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

	function getFixtureAt(cx, cy) {
		const fixtures = dmxState.getFixtures()
		// Search backwards (top to bottom)
		for (let i = fixtures.length - 1; i >= 0; i--) {
			const f = fixtures[i]
			const { x, y, w, h } = f.sample
			const angle = (f.rotation || 0) * (Math.PI / 180)
			
			// Transform point to local fixture space
			const dx = cx - (x + w / 2)
			const dy = cy - (y + h / 2)
			const cosA = Math.cos(-angle)
			const sinA = Math.sin(-angle)
			const lx = dx * cosA - dy * sinA
			const ly = dx * sinA + dy * cosA
			
			if (lx >= -w/2 && lx <= w/2 && ly >= -h/2 && ly <= h/2) return f
			
			// Check rotation handle
			const hlx = 0
			const hly = -h/2 - ROTATE_HANDLE_DIST
			const hdist = Math.sqrt((lx - hlx)**2 + (ly - hly)**2)
			if (hdist < HANDLE_SIZE / scale * 1.5) return { ...f, _handle: 'rotate' }
		}
		return null
	}

	function draw() {
		if (!ctx || !canvas) return
		const mw = dmxState.canvasWidth
		const mh = dmxState.canvasHeight
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

		const fixtures = dmxState.getFixtures()
		fixtures.forEach(f => {
			const { x, y, w, h } = f.sample
			const angle = (f.rotation || 0) * (Math.PI / 180)
			const isSelected = selectedId === f.id
			
			ctx.save()
			ctx.translate(bx + (x + w/2) * scale, by + (y + h/2) * scale)
			ctx.rotate(angle)
			
			// Draw sampling grid if enabled or selected
			const liveColors = dmxState.liveColors.get(f.id)
			if (liveColors) {
				const cols = f.grid.cols || 1
				const rows = f.grid.rows || 1
				const cw = w / cols
				const ch = h / rows
				
				let colorIdx = 0
				for (let r = 0; r < rows; r++) {
					for (let c = 0; c < cols; c++) {
						const cr = liveColors[colorIdx++] || 0
						const cg = liveColors[colorIdx++] || 0
						const cb = liveColors[colorIdx++] || 0
						// skip w, a etc for visualization if present
						const format = (f.colorOrder || 'rgb').toLowerCase()
						if (format.includes('w')) colorIdx++
						if (format.includes('a')) colorIdx++

						ctx.fillStyle = `rgba(${cr},${cg},${cb}, 0.6)`
						ctx.fillRect((c * cw - w/2) * scale, (r * ch - h/2) * scale, cw * scale, ch * scale)
					}
				}
			}

			// Main box
			ctx.strokeStyle = isSelected ? '#58a6ff' : '#8b949e'
			ctx.lineWidth = isSelected ? 2 : 1
			ctx.strokeRect(-w/2 * scale, -h/2 * scale, w * scale, h * scale)
			
			// Label
			ctx.fillStyle = '#fff'
			ctx.font = `10px ${UI_FONT_FAMILY}`
			ctx.textAlign = 'center'
			ctx.fillText(f.id, 0, -h/2 * scale - 5)

			if (isSelected) {
				// Rotation handle
				ctx.beginPath()
				ctx.moveTo(0, -h/2 * scale)
				ctx.lineTo(0, -h/2 * scale - ROTATE_HANDLE_DIST * scale)
				ctx.stroke()
				
				ctx.beginPath()
				ctx.arc(0, -h/2 * scale - ROTATE_HANDLE_DIST * scale, HANDLE_SIZE/2 * scale, 0, Math.PI * 2)
				ctx.fill()
				
				// Grid lines
				ctx.strokeStyle = 'rgba(255,255,255,0.3)'
				ctx.lineWidth = 0.5
				const cols = f.grid.cols || 1
				const rows = f.grid.rows || 1
				for (let i = 1; i < cols; i++) {
					const gx = (i * (w / cols) - w/2) * scale
					ctx.beginPath(); ctx.moveTo(gx, -h/2 * scale); ctx.lineTo(gx, h/2 * scale); ctx.stroke()
				}
				for (let i = 1; i < rows; i++) {
					const gy = (i * (h / rows) - h/2) * scale
					ctx.beginPath(); ctx.moveTo(-w/2 * scale, gy); ctx.lineTo(w/2 * scale, gy); ctx.stroke()
				}
			}

			ctx.restore()
		})
	}

	function render() {
		root.innerHTML = ''
		const editor = document.createElement('div')
		editor.className = 'pixel-map-editor'
		editor.style.display = 'flex'
		editor.style.height = '100%'

		const mainArea = document.createElement('div')
		mainArea.style.flex = '1'
		mainArea.style.position = 'relative'
		mainArea.style.display = 'flex'
		mainArea.style.flexDirection = 'column'

		const toolbar = document.createElement('div')
		toolbar.className = 'mv-toolbar'
		toolbar.innerHTML = `
			<button type="button" class="mv-btn" id="px-add">Add Fixture</button>
			<label class="mv-chk"><input type="checkbox" id="px-enabled" ${dmxState.enabled ? 'checked' : ''}> DMX Sampling Enabled</label>
			<label class="mv-chk" title="When enabled, [DMX] lines are written to the HighAsCG in-memory log. Open Server logs (header) and keep the HighAsCG source on — not the Caspar log file."><input type="checkbox" id="px-debug-log" ${dmxState.debugLogDmx ? 'checked' : ''}> Log DMX output (server)</label>
			<span id="px-pgm-label" style="margin-left:auto; font-size: 11px; opacity: 0.6;"></span>
		`
		mainArea.appendChild(toolbar)

		wrap = document.createElement('div')
		wrap.className = 'mv-canvas-wrap'
		wrap.style.flex = '1'
		wrap.style.position = 'relative'
		wrap.style.backgroundColor = '#000'
		
		const videoContainer = document.createElement('div')
		videoContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;pointer-events:none;'
		wrap.appendChild(videoContainer)

		canvas = document.createElement('canvas')
		canvas.style.cssText = 'position:relative;z-index:2;pointer-events:auto;'
		wrap.appendChild(canvas)
		mainArea.appendChild(wrap)
		editor.appendChild(mainArea)

		const inspector = document.createElement('div')
		inspector.className = 'mv-inspector'
		inspector.style.width = '300px'
		inspector.style.backgroundColor = '#161b22'
		inspector.style.borderLeft = '1px solid #30363d'
		inspector.style.padding = '15px'
		inspector.style.overflowY = 'auto'
		inspector.innerHTML = '<div id="px-inspector-content"><p style="opacity:0.5; text-align:center; margin-top:50px;">Select a fixture to edit</p></div>'
		editor.appendChild(inspector)

		root.appendChild(editor)

		syncCanvasAndToolbar()
		stateStore.on('*', (path) => {
			if (path === null || path === 'channelMap') syncCanvasAndToolbar()
		})
		dashboardState.on('change', syncCanvasAndToolbar)
		dashboardState.on('screenChange', syncCanvasAndToolbar)

		let liveView = null
		function updateLiveView() {
			if (shouldShowLiveVideo()) {
				if (!liveView) liveView = initLiveView(videoContainer, 'pgm_1')
			} else if (liveView) {
				liveView.destroy(); liveView = null
			}
			draw()
		}

		streamState.subscribe(updateLiveView)
		updateLiveView()

		ctx = canvas.getContext('2d')
		fitInContainer()

		new ResizeObserver(() => { fitInContainer(); draw() }).observe(wrap)

		// Toolbar events
		root.querySelector('#px-add').addEventListener('click', () => {
			const f = dmxState.addFixture({ x: 100, y: 100, w: 100, h: 100 })
			selectedId = f.id
			updateInspector()
			draw()
		})
		root.querySelector('#px-enabled').addEventListener('change', (e) => {
			dmxState.setEnabled(e.target.checked)
		})
		root.querySelector('#px-debug-log').addEventListener('change', (e) => {
			dmxState.setDebugLogDmx(e.target.checked)
		})

		// Canvas interaction
		canvas.addEventListener('mousedown', (e) => {
			const rect = canvas.getBoundingClientRect()
			const { x, y } = toCanvas(e.clientX - rect.left, e.clientY - rect.top)
			const f = getFixtureAt(x, y)
			if (f) {
				selectedId = f.id
				if (f._handle === 'rotate') {
					dragMode = 'rotate'
					const angle = (f.rotation || 0) * (Math.PI / 180)
					const dx = x - (f.sample.x + f.sample.w/2)
					const dy = y - (f.sample.y + f.sample.h/2)
					dragStart = { angle: Math.atan2(dy, dx) - angle }
				} else {
					dragMode = 'move'
					dragStart = { x, y, fixture: JSON.parse(JSON.stringify(f)) }
				}
				updateInspector()
			} else {
				selectedId = null
				updateInspector()
			}
			draw()
		})

		canvas.addEventListener('mousemove', (e) => {
			if (!dragMode) return
			const rect = canvas.getBoundingClientRect()
			const { x, y } = toCanvas(e.clientX - rect.left, e.clientY - rect.top)
			const f = dmxState.getFixture(selectedId)
			if (!f) return

			if (dragMode === 'move') {
				const dx = x - dragStart.x
				const dy = y - dragStart.y
				dmxState.updateFixture(f.id, {
					sample: {
						x: Math.round(dragStart.fixture.sample.x + dx),
						y: Math.round(dragStart.fixture.sample.y + dy)
					}
				})
			} else if (dragMode === 'rotate') {
				const dx = x - (f.sample.x + f.sample.w/2)
				const dy = y - (f.sample.y + f.sample.h/2)
				let angle = Math.atan2(dy, dx) - dragStart.angle
				let deg = Math.round(angle * (180 / Math.PI))
				dmxState.updateFixture(f.id, { rotation: deg })
			}
			draw()
			updateInspector()
		})

		canvas.addEventListener('mouseup', () => { dragMode = null; draw() })

		function updateInspector() {
			const container = document.getElementById('px-inspector-content')
			if (!container) return
			const f = dmxState.getFixture(selectedId)
			if (!f) {
				container.innerHTML = '<p style="opacity:0.5; text-align:center; margin-top:50px;">Select a fixture to edit</p>'
				return
			}

			container.innerHTML = `
				<h3 style="margin-top:0;">Fixture: ${f.id}</h3>
				<div class="px-field"><label>Name</label><input type="text" value="${f.id}" id="f-id"></div>
				<hr style="border:0; border-top:1px solid #30363d; margin:15px 0;">
				<div class="px-field"><label>Universe</label><input type="number" value="${f.universe}" id="f-uni"></div>
				<div class="px-field"><label>Start Ch</label><input type="number" value="${f.startChannel}" id="f-ch"></div>
				<div class="px-field"><label>Protocol</label>
					<select id="f-prot">
						<option value="artnet" ${f.protocol==='artnet'?'selected':''}>Art-Net</option>
						<option value="sacn" ${f.protocol==='sacn'?'selected':''}>sACN</option>
					</select>
				</div>
				<div class="px-field"><label>Destination</label><input type="text" value="${f.destination}" id="f-dest"></div>
				<div class="px-field"><label>Color Order</label><input type="text" value="${f.colorOrder}" id="f-order"></div>
				
				<hr style="border:0; border-top:1px solid #30363d; margin:15px 0;">
				<div class="px-field"><label>Source Channel</label><input type="number" value="${f.sourceChannel||1}" id="f-src"></div>
				<div class="px-field"><label>Grid Cols</label><input type="number" value="${f.grid.cols}" id="f-cols"></div>
				<div class="px-field"><label>Grid Rows</label><input type="number" value="${f.grid.rows}" id="f-rows"></div>
				<div class="px-field"><label>Brightness</label><input type="number" step="0.1" value="${f.brightness}" id="f-bright"></div>
				
				<div style="margin-top:20px;">
					<button class="mv-btn" style="background:#da3633; color:#fff;" id="px-delete">Delete Fixture</button>
				</div>
			`

			const update = (key, val) => {
				const updates = {}
				if (key.includes('.')) {
					const [p, k] = key.split('.')
					updates[p] = { [k]: val }
				} else {
					updates[key] = val
				}
				dmxState.updateFixture(f.id, updates)
				draw()
			}

			container.querySelector('#f-id').onchange = (e) => {
				const oldId = f.id
				const newId = e.target.value
				f.id = newId
				dmxState.fixtures = [...dmxState.fixtures] // trigger save
				selectedId = newId
				dmxState._save()
			}
			container.querySelector('#f-uni').onchange = (e) => update('universe', parseInt(e.target.value))
			container.querySelector('#f-ch').onchange = (e) => update('startChannel', parseInt(e.target.value))
			container.querySelector('#f-prot').onchange = (e) => update('protocol', e.target.value)
			container.querySelector('#f-dest').onchange = (e) => update('destination', e.target.value)
			container.querySelector('#f-order').onchange = (e) => update('colorOrder', e.target.value)
			container.querySelector('#f-src').onchange = (e) => update('sourceChannel', parseInt(e.target.value))
			container.querySelector('#f-cols').onchange = (e) => update('grid.cols', parseInt(e.target.value))
			container.querySelector('#f-rows').onchange = (e) => update('grid.rows', parseInt(e.target.value))
			container.querySelector('#f-bright').onchange = (e) => update('brightness', parseFloat(e.target.value))
			
			container.querySelector('#px-delete').onclick = () => {
				if (confirm('Delete this fixture?')) {
					dmxState.removeFixture(f.id)
					selectedId = null
					updateInspector()
					draw()
				}
			}
		}

		function syncToolbarCheckboxes() {
			const en = root.querySelector('#px-enabled')
			const dbg = root.querySelector('#px-debug-log')
			if (en) en.checked = !!dmxState.enabled
			if (dbg) dbg.checked = !!dmxState.debugLogDmx
		}

		dmxState.on('change', () => {
			syncToolbarCheckboxes()
			fitInContainer()
			draw()
		})
		dmxState.on('live-colors', draw)
		draw()
	}

	render()
}
