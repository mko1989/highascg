/**
 * GrapesJS integration for HighAsCG CG Overlay Studio (WO-32).
 */

import grapesjs from 'grapesjs'
import { buildLtEngineInitScript } from '../../../lib/cg-studio-caspar-export.js'
import { LT_ANIMATION_PRESETS, LT_BASE_CSS } from '../../../lib/cg-studio-lt-presets.js'
import { registerCgStudioBlocks } from './cg-studio-editor-blocks.js'
import { createCanvasController } from './cg-studio-editor-canvas.js'
import {
	bindInspectorPanelEvents,
	createInspectorPanelHosts,
	tryMountInspectorPanels,
} from './cg-studio-editor-inspector.js'
import { createOverlayHelpers } from './cg-studio-editor-overlay.js'
import { createTemplatePersistence } from './cg-studio-editor-templates.js'
import { CANVAS_CHECKERBOARD_CSS, injectGrapesThemeOverrides } from './cg-studio-editor-theme.js'

/**
 * @param {HTMLElement} container — `#tab-cg-studio`
 */
export async function initEditor(container) {
	const header = document.createElement('div')
	header.className = 'cg-studio-toolbar'

	const nameInp = document.createElement('input')
	nameInp.type = 'text'
	nameInp.placeholder = 'Template name (e.g. my-brand)'
	nameInp.className = 'header-project__name'

	const animSel = document.createElement('select')
	animSel.className = 'header-btn--secondary cg-studio-anim-preset'
	animSel.title = 'Play in / play out animation'
	for (const preset of Object.values(LT_ANIMATION_PRESETS)) {
		const opt = document.createElement('option')
		opt.value = preset.id
		opt.textContent = preset.label
		animSel.appendChild(opt)
	}

	const previewBtn = mkBtn('Preview', 'header-btn--secondary')
	const loadSel = document.createElement('select')
	loadSel.className = 'cg-studio-load-select header-btn--secondary'
	loadSel.title = 'Load saved lower-third project'
	const loadOpt = document.createElement('option')
	loadOpt.value = ''
	loadOpt.textContent = 'Load…'
	loadSel.appendChild(loadOpt)
	const loadBtn = mkBtn('Open', 'header-btn--secondary')

	const addTextBtn = mkBtn('+ Text', 'header-btn--secondary')
	const addBoxBtn = mkBtn('+ Box', 'header-btn--secondary')

	const zoomOutBtn = mkBtn('−', 'header-btn--icon')
	const zoomLabel = document.createElement('span')
	zoomLabel.className = 'cg-studio-zoom-label'
	zoomLabel.textContent = '50%'
	const zoomInBtn = mkBtn('+', 'header-btn--icon')
	const zoomFitBtn = mkBtn('Fit', 'header-btn--secondary')

	const saveBtn = mkBtn('Save LT template')
	const statusSpan = document.createElement('span')
	statusSpan.className = 'cg-studio-status'

	header.append(nameInp, animSel, loadSel, loadBtn, addTextBtn, addBoxBtn, previewBtn, zoomOutBtn, zoomLabel, zoomInBtn, zoomFitBtn, saveBtn, statusSpan)

	const body = document.createElement('div')
	body.className = 'cg-studio-body'

	const canvasWrap = document.createElement('div')
	canvasWrap.className = 'cg-studio-canvas-wrap'

	const { panelsHost, panelsPark } = createInspectorPanelHosts()
	body.append(canvasWrap)
	container.append(header, body, panelsPark)

	const blocksEl = panelsHost.querySelector('.cg-studio-inspector-blocks')
	const layersEl = panelsHost.querySelector('.cg-studio-inspector-layers')
	const stylesEl = panelsHost.querySelector('.cg-studio-inspector-styles')

	const editor = grapesjs.init({
		container: canvasWrap,
		height: '100%',
		width: 'auto',
		fromElement: false,
		storageManager: false,
		noticeOnUnload: false,
		dragMode: 'absolute',
		panels: { defaults: [] },
		blockManager: { appendTo: blocksEl },
		layerManager: { appendTo: layersEl },
		styleManager: { appendTo: stylesEl, clearProperties: true },
		traitManager: { appendTo: stylesEl },
		selectorManager: { appendTo: stylesEl, componentFirst: true },
		deviceManager: {
			devices: [{ id: 'hd', name: '1920×1080', width: '1920px', height: '1080px' }],
		},
		canvas: {
			styles: [],
			scripts: [
				'/template/CasparCG-Guide-HTML-Template-master/node_modules/gsap/dist/gsap.js',
				'/template/lower-thirds/lt-engine.js',
			],
		},
	})

	const canvas = createCanvasController(editor, zoomLabel)
	const overlay = createOverlayHelpers(editor)
	const templates = createTemplatePersistence(editor, {
		nameInp,
		animSel,
		statusSpan,
		saveBtn,
		loadSel,
		loadOpt,
		seedLowerThirdScaffold: overlay.seedLowerThirdScaffold,
		findGraphicComponent: overlay.findGraphicComponent,
	})

	editor.on('load', () => {
		const doc = editor.Canvas.getDocument()
		if (doc) {
			const style = doc.createElement('style')
			style.setAttribute('data-cg-studio', 'checkerboard')
			style.textContent = CANVAS_CHECKERBOARD_CSS
			doc.head.appendChild(style)
			const ltStyle = doc.createElement('style')
			ltStyle.setAttribute('data-cg-studio', 'lt-base')
			ltStyle.textContent = LT_BASE_CSS
			doc.head.appendChild(ltStyle)
			canvas.bindIframeWheel(doc)
		}

		const wrapper = editor.getWrapper()
		if (wrapper) {
			wrapper.set({
				droppable: false,
				selectable: false,
				hoverable: false,
				badgable: false,
				style: {
					position: 'relative',
					width: '1920px',
					height: '1080px',
					margin: '24px auto',
					'background-color': 'transparent',
				},
			})
		}

		overlay.seedLowerThirdScaffold()
		editor.setDevice('hd')
		requestAnimationFrame(() => {
			canvas.fitCanvasZoom()
			tryMountInspectorPanels()
		})
	})

	editor.on('component:add', (component) => {
		overlay.prepareOverlayComponent(component)
	})

	registerCgStudioBlocks(editor.BlockManager)

	addTextBtn.onclick = () => overlay.addToGraphic('text')
	addBoxBtn.onclick = () => overlay.addToGraphic('box')

	previewBtn.onclick = () => {
		const frame = editor.Canvas.getFrameEl()
		const win = frame?.contentWindow
		if (!win?.LTEngine) {
			statusSpan.textContent = 'Preview runs on exported template (save first)'
			return
		}
		if (!win.LTEngine.isInitialized) {
			const preset = animSel.value || 'fade'
			const scriptText = buildLtEngineInitScript({ animationPreset: preset })
			win.eval(scriptText)
			win.LTEngine.isInitialized = true
		}
		const sample = {
			data: { title: 'Preview Name', subtitle: 'Preview Title' },
			style: { primaryColor: '#4fc3f7', textColor: '#ffffff', position: 'left' },
		}
		win.update(JSON.stringify(sample))
		win.play?.()
		statusSpan.textContent = 'Preview play'
		setTimeout(() => {
			statusSpan.textContent = ''
		}, 2500)
	}

	zoomInBtn.onclick = () => canvas.applyZoom(canvas.getZoomPct() * 1.15)
	zoomOutBtn.onclick = () => canvas.applyZoom(canvas.getZoomPct() / 1.15)
	zoomFitBtn.onclick = () => canvas.fitCanvasZoom()
	canvas.bindWrapWheel(canvasWrap)

	saveBtn.onclick = () => void templates.saveTemplate()
	loadBtn.onclick = () => {
		const id = loadSel.value
		if (id) void templates.loadTemplateById(id)
	}

	window.addEventListener('highascg-cg-studio-load-template', (e) => {
		const id = e.detail?.id
		if (id) void templates.loadTemplateById(id)
	})
	void templates.refreshLoadList()

	bindInspectorPanelEvents(editor, {
		onTabActivated: () => canvas.fitCanvasZoom(),
	})

	injectGrapesThemeOverrides()
	tryMountInspectorPanels()
}

function mkBtn(label, extraClass = '') {
	const btn = document.createElement('button')
	btn.type = 'button'
	btn.className = `header-btn${extraClass ? ` ${extraClass}` : ''}`
	btn.textContent = label
	return btn
}
