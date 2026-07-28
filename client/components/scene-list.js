/**
 * Scenes deck — per-main look columns, main pills (output target), default transition, apply to all.
 */

import { mountLookTransitionControls } from './scenes-shared.js'
import { escapeHtml } from './scenes-editor-support.js'
import { isPreviewBusAvailable } from '../lib/scenes-preview-look-stack.js'
import { commitPendingLookNameEdits } from '../lib/scene-look-name-commit.js'
import { appendSceneDeckColumn } from './scene-list-column.js'
import { screenLabel } from '../lib/screen-label.js'

/**
 * @param {object} ctx
 * @param {HTMLElement} ctx.mainHost
 * @param {import('../lib/scene-state.js').SceneState} ctx.sceneState
 * @param {() => number} ctx.getScreenCount
 * @param {() => object} [ctx.getChannelMap]
 * @param {() => Record<string, { sceneId?: string }>} [ctx.getSceneLive]
 * @param {number} [ctx.outputAspect] - program width/height for look card thumb framing
 * @param {(canvas: HTMLCanvasElement) => void} ctx.paintDeckThumb
 * @param {(sceneId: string, forceCut: boolean) => Promise<void>} ctx.takeSceneToProgram
 * @param {(msg: string, type?: string) => void} ctx.showToast
 * @param {(detail: object | null) => void} ctx.dispatchLayerSelect
 * @param {{ scheduleDraw: () => void }} ctx.previewPanel
 * @param {(sceneId: string, opts?: { targetMains?: number[] }) => void | Promise<void>} ctx.sendSceneToPreviewCard
 * @param {(mainIdx: number, opts?: { full?: boolean }) => void | Promise<void>} [ctx.clearPreviewBusForMain]
 * @param {(dt: DataTransfer) => boolean} [ctx.onDeckMediaDropAccept]
 * @param {(mainCol: number, e: DragEvent) => void | Promise<void>} [ctx.onDeckMediaDrop]
 * @param {{ current: number | null }} ctx.selectedLayerIndexRef
 * @param {() => void} ctx.globalTakeFromPreview
 * @param {() => void} ctx.globalCutFromPreview
 */
export function renderSceneDeck(ctx) {
	const {
		mainHost,
		sceneState,
		getScreenCount,
		getChannelMap = () => ({}),
		getSceneLive = () => ({}),
		outputAspect,
		paintDeckThumb,
		takeSceneToProgram,
		showToast,
		dispatchLayerSelect,
		previewPanel,
		sendSceneToPreviewCard,
		clearPreviewBusForMain,
		onDeckMediaDropAccept,
		onDeckMediaDrop,
		selectedLayerIndexRef,
		globalTakeFromPreview,
		globalCutFromPreview,
	} = ctx

	// 1. Capture scroll positions before clearing mainHost to prevent scroll jumping
	const savedScrolls = []
	try {
		const scrollables = mainHost.querySelectorAll('.scenes-deck-row, .scenes-deck-col, .scenes-deck')
		scrollables.forEach((el, index) => {
			savedScrolls.push({
				index,
				scrollLeft: el.scrollLeft,
				scrollTop: el.scrollTop,
				className: el.className
			})
		})
	} catch {
		/* ignore */
	}

	commitPendingLookNameEdits(mainHost, sceneState)

	mainHost.innerHTML = ''
	const screenCount = Math.max(1, getScreenCount())
	const cm = getChannelMap()
	const virtuals = Array.isArray(cm.virtualMainChannels) ? cm.virtualMainChannels : []
	function mainLabel(i) {
		const v = virtuals[i]
		if (v && v.name) return String(v.name)
		return screenLabel(cm, i)
	}

	const deckWrap = document.createElement('div')
	deckWrap.className = 'scenes-deck-toolbar'
	const toolbar = document.createElement('div')
	toolbar.className = 'scenes-toolbar scenes-toolbar--mains'
	const pillsParts = []
	if (screenCount > 1) {
		pillsParts.push(`<div class="scenes-main-pills" role="tablist" aria-label="Program / preview output">`)
		const armedIndices = sceneState.armedScreenIndices || []
		for (let i = 0; i < screenCount; i++) {
			const active = i === sceneState.activeScreenIndex ? ' scenes-main-pill--active' : ''
			const armed = armedIndices.includes(i) ? ' scenes-main-pill--armed' : ''
			const vis = sceneState.isMainEditorVisible(i) ? '' : ' scenes-main-pill--hidden'
			const name = escapeHtml(mainLabel(i))
			pillsParts.push(
				`<div class="scenes-main-pill${active}${armed}${vis}" data-main-pill="${i}">` +
					`<button type="button" class="scenes-main-pill__out" data-action="activate-main" data-screen="${i}" ` +
					`title="Toggle selection for this main" aria-pressed="${i === sceneState.activeScreenIndex}">${name}</button>` +
					`<button type="button" class="scenes-main-pill__eye" data-action="toggle-eye" data-screen="${i}" ` +
					`title="Show or hide this main’s look column" aria-label="Toggle column for ${name}">` +
					`${sceneState.isMainEditorVisible(i) ? '👁' : '⏻'}` +
					`</button></div>`,
			)
		}
		pillsParts.push('</div>')

	}
	pillsParts.push(
		'<div class="scenes-toolbar__global-take scenes-toolbar__global-take--right">' +
			'<button type="button" class="scenes-btn scenes-btn--take scenes-btn--icon" id="scenes-global-take" title="Take preview to program (LOADBG + transition + PLAY)" aria-label="Take preview to program">▶</button>' +
			'<button type="button" class="scenes-btn scenes-btn--sm" id="scenes-global-cut" title="Hard cut preview to program" aria-label="Hard cut preview to program">CUT</button>' +
			'</div>' +
			'<div class="scenes-toolbar__transition-group" id="scenes-deck-transition-mount"></div>',
	)
	toolbar.innerHTML = pillsParts.join('')
	deckWrap.appendChild(toolbar)

	const transMount = toolbar.querySelector('#scenes-deck-transition-mount')
	const anyPgmOnlyMain = (() => {
		for (let i = 0; i < screenCount; i++) {
			if (!isPreviewBusAvailable(cm, i)) return true
		}
		return false
	})()
	mountLookTransitionControls(
		transMount,
		sceneState.getResolvedGlobalDefaultTransition(),
		(t) => sceneState.setGlobalDefaultTransition(t),
		'scenes-deck-dt',
		{
			label: 'Default transition',
			hint: anyPgmOnlyMain
				? 'MIX/WIPE/Slide/Push use +Animate on PGM-only screens at take.'
				: '',
		},
	)
	const applyAllBtn = document.createElement('button')
	applyAllBtn.type = 'button'
	applyAllBtn.className = 'scenes-btn scenes-btn--sm scenes-toolbar__apply-all-looks'
	applyAllBtn.textContent = 'Apply to all looks'
	applyAllBtn.title = 'Set transition on all looks in the active main’s list (incl. shared global looks in that list)'
	applyAllBtn.addEventListener('click', () => {
		sceneState.applyGlobalDefaultToAllLooks(screenCount)
		showToast(
			screenCount >= 2
				? 'Default transition applied to looks on this main’s deck.'
				: 'Default transition applied to all looks.',
			'info',
		)
	})
	transMount.appendChild(applyAllBtn)

	function listScenesForColumn(mainIdx) {
		if (screenCount < 2) return sceneState.scenes
		return sceneState.getScenesForMain(mainIdx)
	}

	toolbar.querySelector('#scenes-global-take')?.addEventListener('click', () => globalTakeFromPreview())
	toolbar.querySelector('#scenes-global-cut')?.addEventListener('click', () => globalCutFromPreview())

	toolbar.querySelectorAll('[data-action="activate-main"]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const i = parseInt(/** @type {HTMLElement} */ (btn).dataset.screen || '0', 10)
			sceneState.toggleArmedScreen(i)
		})
	})
	toolbar.querySelectorAll('[data-action="toggle-eye"]').forEach((btn) => {
		btn.addEventListener('click', (e) => {
			e.stopPropagation()
			const i = parseInt(/** @type {HTMLElement} */ (btn).dataset.screen || '0', 10)
			sceneState.toggleMainEditorVisible(i)
		})
	})


	mainHost.appendChild(deckWrap)

	function applyRowAspect(el) {
		if (typeof outputAspect === 'number' && outputAspect > 0 && Number.isFinite(outputAspect)) {
			el.style.setProperty('--scene-thumb-aspect', String(outputAspect))
		}
	}

	function ensureMainForColumn(col) {
		if (col === sceneState.activeScreenIndex) return
		sceneState.switchScreen(col)
	}

	const appendColumn = (col, scenes, mount) =>
		appendSceneDeckColumn(
			{
				sceneState,
				getChannelMap,
				getSceneLive,
				paintDeckThumb,
				takeSceneToProgram,
				showToast,
				dispatchLayerSelect,
				sendSceneToPreviewCard,
				clearPreviewBusForMain,
				onDeckMediaDropAccept,
				onDeckMediaDrop,
				selectedLayerIndexRef,
			},
			col,
			scenes,
			mount,
			{ mainLabel, ensureMainForColumn },
		)

	if (screenCount < 2) {
		const mount = document.createElement('div')
		mount.className = 'scenes-deck-row'
		applyRowAspect(mount)
		appendColumn(0, listScenesForColumn(0), mount)
		mainHost.appendChild(mount)
	} else {
		const row = document.createElement('div')
		row.className = 'scenes-deck-row'
		applyRowAspect(row)
		let anyCol = false
		for (let c = 0; c < screenCount; c++) {
			if (!sceneState.isMainEditorVisible(c)) continue
			anyCol = true
			appendColumn(c, listScenesForColumn(c), row)
		}
		if (!anyCol) {
			const note = document.createElement('div')
			note.className = 'scenes-deck__empty'
			note.innerHTML = '<p>All main columns are hidden.</p><p class="scenes-deck__hint">Use the eye (👁) next to a main to show its look column.</p>'
			row.appendChild(note)
		}
		mainHost.appendChild(row)
	}

	// 2. Restore scroll positions
	try {
		const newScrollables = mainHost.querySelectorAll('.scenes-deck-row, .scenes-deck-col, .scenes-deck')
		savedScrolls.forEach((saved) => {
			const el = newScrollables[saved.index]
			if (el && el.className === saved.className) {
				el.scrollLeft = saved.scrollLeft
				el.scrollTop = saved.scrollTop
			}
		})
	} catch {
		/* ignore */
	}

	previewPanel.scheduleDraw()
}

