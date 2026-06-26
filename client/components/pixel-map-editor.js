/**
 * Unified Mapping Editor — visual tool for Video Slicing and DMX Pixel Mapping.
 */
import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import { api } from '../lib/api-client.js'
import { mappingState } from '../lib/mapping-state.js'
import { createPixelMapCanvasController } from './pixel-map-editor-canvas.js'

export function initPixelMapEditor(root, stateStore) {
	let wrap = null
	let hostContainer = null
	let lastCanvasWidth = 0
	let lastCanvasHeight = 0
	let canvasCtrl = null

	root.innerHTML = ''
	const editor = document.createElement('div')
	editor.className = 'pixel-map-editor'
	editor.style.cssText =
		'position:absolute;inset:0;background:rgba(10,14,19,0.96);z-index:40;display:none;flex-direction:column;color:#fff;font-family:' +
		UI_FONT_FAMILY

	const toolbar = document.createElement('div')
	toolbar.className = 'mv-toolbar'
	toolbar.style.cssText =
		'height:50px;display:flex;align-items:center;padding:0 20px;border-bottom:1px solid rgba(255,255,255,0.1);background:#131a22'
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
	wrap.style.cssText =
		'flex:1;position:relative;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;'

	const videoContainer = document.createElement('div')
	videoContainer.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none;'
	wrap.appendChild(videoContainer)

	const canvas = document.createElement('canvas')
	canvas.style.cssText =
		'position:relative;z-index:2;box-shadow:0 0 50px rgba(0,0,0,0.5);cursor:crosshair;'
	wrap.appendChild(canvas)
	editor.appendChild(wrap)
	document.body.appendChild(editor)

	canvasCtrl = createPixelMapCanvasController(canvas, wrap)
	canvasCtrl.bindInteractions({
		onSelectionChange: (id) => {
			const delBtn = editor.querySelector('#px-delete')
			if (delBtn) delBtn.style.display = id ? 'block' : 'none'
		},
	})

	const closeBtn = editor.querySelector('#px-close')
	const closeX = editor.querySelector('#px-close-x')
	const delBtn = editor.querySelector('#px-delete')
	const nodeLabel = editor.querySelector('#px-node-label')
	const pgmLabel = editor.querySelector('#px-pgm-label')

	const closeEditor = () => {
		editor.style.display = 'none'
	}
	closeBtn.onclick = closeEditor
	closeX.onclick = closeEditor
	closeX.onmouseover = () => {
		closeX.style.opacity = '1'
	}
	closeX.onmouseout = () => {
		closeX.style.opacity = '0.6'
	}

	wrap.addEventListener('mousedown', (e) => {
		if (e.target === wrap) closeEditor()
	})
	delBtn.onclick = () => {
		const selectedId = canvasCtrl.getSelectedId()
		if (selectedId && confirm('Delete this slice?')) {
			mappingState.removeMapping(selectedId)
			canvasCtrl.setSelectedId(null)
			delBtn.style.display = 'none'
			canvasCtrl.draw()
		}
	}

	mappingState.on('change', () => {
		if (mappingState.activeNode) {
			nodeLabel.textContent = `Mapping: ${mappingState.activeNode.label || mappingState.activeNode.id}`
			pgmLabel.textContent = `Canvas: ${mappingState.canvasWidth}×${mappingState.canvasHeight}`
		}
		if (mappingState.canvasWidth !== lastCanvasWidth || mappingState.canvasHeight !== lastCanvasHeight) {
			lastCanvasWidth = mappingState.canvasWidth
			lastCanvasHeight = mappingState.canvasHeight
			canvasCtrl.fitInContainer()
		}
		canvasCtrl.draw()
	})

	window.addEventListener('resize', () => {
		if (editor.style.display === 'flex') {
			canvasCtrl.fitInContainer()
			canvasCtrl.draw()
		}
	})

	window.addEventListener('highascg-pixel-mapping-open', async (ev) => {
		if (!ev.detail?.nodeId) return
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
		canvasCtrl.fitInContainer()
		canvasCtrl.draw()
	})

	window.addEventListener('keydown', (ev) => {
		if (ev.key === 'Escape' && editor.style.display === 'flex') editor.style.display = 'none'
	})

	window.addEventListener('highascg-mapping-inspector-updated', async (ev) => {
		if (editor.style.display !== 'flex') return
		if (!mappingState.activeNodeId) return
		if (ev.detail?.nodeId && ev.detail.nodeId !== mappingState.activeNodeId) return
		try {
			const payload = await api.get('/api/device-view')
			await mappingState.setActiveNode(mappingState.activeNodeId, payload)
			canvasCtrl.draw()
		} catch (e) {
			console.error('[PixelMapEditor] Refresh from inspector failed:', e)
		}
	})
}
