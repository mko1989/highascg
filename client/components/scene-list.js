/**
 * Scenes deck — per-main look columns, main pills (output target), default transition, apply to all.
 */

import { mountLookTransitionControls } from './scenes-shared.js'
import { escapeHtml } from './scenes-editor-support.js'
import { isPreviewBusAvailable } from '../lib/scenes-preview-look-stack.js'

/**
 * Click on unused deck column area (gaps, empty placeholder, padding below cards).
 * @param {EventTarget | null} target
 * @param {HTMLElement} colRoot
 */
function isScenesDeckColBlankClick(target, colRoot) {
	const t = /** @type {HTMLElement | null} */ (target)
	if (!t?.closest || !colRoot?.contains(t)) return false
	if (t.closest('.scenes-card')) return false
	if (t.closest('.scenes-deck__add-look')) return false
	if (t.closest('.scenes-deck-col__head')) return false
	if (t.closest('button, input, select, textarea, a, [role="button"]')) return false
	return true
}

/**
 * @param {object} ctx
 * @param {HTMLElement} ctx.mainHost
 * @param {import('../lib/scene-state.js').SceneState} ctx.sceneState
 * @param {() => number} ctx.getScreenCount
 * @param {() => object} [ctx.getChannelMap]
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
	} catch (e) {
		/* ignore */
	}

	mainHost.innerHTML = ''
	const screenCount = Math.max(1, getScreenCount())
	const cm = getChannelMap()
	const virtuals = Array.isArray(cm.virtualMainChannels) ? cm.virtualMainChannels : []
	function mainLabel(i) {
		const v = virtuals[i]
		if (v && v.name) return String(v.name)
		return `Screen ${i + 1}`
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
		sceneState.globalDefaultTransition,
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
		btn.addEventListener('click', (e) => {
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

	/**
	 * @param {number} col
	 * @param {object[]} scenes
	 * @param {ReturnType<typeof document.createElement>} mount
	 */
	function appendColumn(col, scenes, mount) {
		const colEl = document.createElement('div')
		colEl.className = 'scenes-deck-col'
		colEl.dataset.mainCol = String(col)
		const head = document.createElement('div')
		head.className = 'scenes-deck-col__head'
		head.style.display = 'flex'
		head.style.justifyContent = 'space-between'
		head.style.alignItems = 'center'
		
		const title = document.createElement('span')
		title.textContent = mainLabel(col)
		head.appendChild(title)
		
		const borderBtn = document.createElement('div')
		borderBtn.className = 'scenes-global-border-item'
		borderBtn.style.display = 'flex'
		borderBtn.style.gap = '4px'
		borderBtn.style.alignItems = 'center'
		borderBtn.style.cursor = 'pointer'
		borderBtn.style.background = '#333'
		borderBtn.style.padding = '2px 6px'
		borderBtn.style.borderRadius = '4px'
		borderBtn.style.fontSize = '12px'
		borderBtn.title =
			'Global border on PGM (layers 998 / 996 for preset crossfades). Recalling a look to PRV does not change PGM. For PRV-only border tweaks, enable “PRV on ch …” in Global Border inspector (L997).'
		
		const gb = sceneState.getGlobalBorderForScreen(col)
		
		const chk = document.createElement('input')
		chk.type = 'checkbox'
		chk.checked = !!(gb && gb.enabled)
		chk.addEventListener('click', (e) => e.stopPropagation())
		chk.addEventListener('change', () => {
			const cur = sceneState.getGlobalBorderForScreen(col)
			if (!cur) {
				if (chk.checked) sceneState.setGlobalBorderForScreen(col, { enabled: true })
				return
			}
			sceneState.setGlobalBorderForScreen(col, { enabled: chk.checked })
		})
		
		const lbl = document.createElement('span')
		lbl.textContent = 'Global Border'
		
		borderBtn.appendChild(chk)
		borderBtn.appendChild(lbl)
		
		borderBtn.addEventListener('click', () => {
			window.dispatchEvent(new CustomEvent('global-border-select', { detail: { screenIndex: col } }))
		})
		head.appendChild(borderBtn)
		colEl.appendChild(head)

		const grid = document.createElement('div')
		grid.className = 'scenes-deck'
		if (scenes.length === 0) {
			const empty = document.createElement('div')
			empty.className = 'scenes-deck__empty scenes-deck__empty--tight scenes-deck__empty--clear-prv'
			empty.innerHTML = `<p>No looks for ${escapeHtml(mainLabel(col))}.</p><p class="scenes-deck__hint">Use + to add, drop media from Sources or your desktop to start a look, or use “all mains” and create a global look.</p>`
			empty.title = 'Clear preview for this screen (stops looks on the PRV channel when it is separate from PGM)'
			grid.appendChild(empty)
		}

		for (const sc of scenes) {
			const onPreview = sceneState.getPreviewSceneIdForMain(col) === sc.id
			const onPgm = sceneState.getLiveSceneIdForMain(col) === sc.id
			const isGlobal = sc.mainScope === 'all'
			const card = document.createElement('div')
			card.className =
				'scenes-card' +
				(onPgm ? ' scenes-card--live' : '') +
				(onPreview ? ' scenes-card--preview' : '') +
				(isGlobal ? ' scenes-card--global' : '')
			card.innerHTML = `
			<div class="scenes-card__header">
				<input type="text" class="scenes-card__name-input" maxlength="120" spellcheck="false" aria-label="Look name" />
				<div class="scenes-card__header-actions">
					<button type="button" class="scenes-card__icon-btn" data-action="duplicate" title="Duplicate look" aria-label="Duplicate look">⧉</button>
					<button type="button" class="scenes-card__icon-btn scenes-card__icon-btn--danger" data-action="delete" title="Delete look" aria-label="Delete look">🗑</button>
				</div>
			</div>
			<button type="button" class="scenes-card__thumb" data-action="prv" aria-label="Send to preview">
				<canvas class="scenes-card__thumb-canvas"></canvas>
			</button>
			<div class="scenes-card__footer">
				<button type="button" class="scenes-btn scenes-btn--take scenes-btn--sm scenes-btn--icon" data-action="take" title="Take live (LOADBG + transition + PLAY)" aria-label="Take live">▶</button>
				<button type="button" class="scenes-btn scenes-btn--sm" data-action="cut" title="Hard cut" aria-label="Hard cut">CUT</button>
				<button type="button" class="scenes-btn scenes-btn--sm scenes-btn--icon" data-action="edit" title="Edit look" aria-label="Edit look">⚙</button>
			</div>`

			const nameIn = card.querySelector('.scenes-card__name-input')
			if (nameIn) {
				nameIn.value = sc.name
				;['pointerdown', 'mousedown', 'click'].forEach((ev) =>
					nameIn.addEventListener(ev, (e) => e.stopPropagation()),
				)
				nameIn.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						e.preventDefault()
						nameIn.blur()
					}
				})
				nameIn.addEventListener('blur', () => {
					const s0 = sceneState.getScene(sc.id)
					if (!s0) return
					sceneState.setSceneName(sc.id, nameIn.value)
					const u = sceneState.getScene(sc.id)
					if (u && nameIn.value !== u.name) nameIn.value = u.name
				})
			}

			const sendPrv = async (e) => {
				e.stopPropagation()
				ensureMainForColumn(col)
				const cm = getChannelMap()
				if (!isPreviewBusAvailable(cm, col)) {
					showToast('PGM-only — use Take', 'info')
					return
				}
				await sendSceneToPreviewCard(sc.id, { targetMains: [col] })
			}
			card.querySelectorAll('[data-action="prv"]').forEach((el) => el.addEventListener('click', sendPrv))

			card.addEventListener('click', (e) => {
				if (e.target.closest('[data-action]')) return
				ensureMainForColumn(col)
				const cm = getChannelMap()
				if (!isPreviewBusAvailable(cm, col)) {
					showToast('PGM-only — use Take', 'info')
					return
				}
				void sendPrv(e)
			})

			card.querySelector('[data-action="take"]')?.addEventListener('click', (e) => {
				e.stopPropagation()
				ensureMainForColumn(col)
				void takeSceneToProgram(sc.id, false, { targetMains: [col] })
			})
			card.querySelector('[data-action="cut"]')?.addEventListener('click', (e) => {
				e.stopPropagation()
				ensureMainForColumn(col)
				void takeSceneToProgram(sc.id, true, { targetMains: [col] })
			})
			card.querySelector('[data-action="edit"]')?.addEventListener('click', async (e) => {
				e.stopPropagation()
				ensureMainForColumn(col)
				const cm = getChannelMap()
				if (
					isPreviewBusAvailable(cm, col) &&
					sceneState.getPreviewSceneIdForMain(col) !== sc.id
				) {
					await sendSceneToPreviewCard(sc.id, { targetMains: [col] })
				}
				sceneState.setEditingScene(sc.id)
				selectedLayerIndexRef.current = null
				dispatchLayerSelect(null)
			})
			card.querySelector('[data-action="duplicate"]')?.addEventListener('click', (e) => {
				e.stopPropagation()
				const nid = sceneState.duplicateScene(sc.id)
				if (nid) showToast('Look duplicated.', 'info')
			})
			card.querySelector('[data-action="delete"]')?.addEventListener('click', (e) => {
				e.stopPropagation()
				if (confirm(`Delete look "${sc.name}"?`)) {
					sceneState.removeScene(sc.id)
					if (sceneState.editingSceneId === sc.id) sceneState.setEditingScene(null)
				}
			})
			const header = card.querySelector('.scenes-card__header')
			if (header) {
				header.addEventListener('click', (e) => e.stopPropagation())
				header.addEventListener('pointerdown', (e) => e.stopPropagation())
			}
			const footer = card.querySelector('.scenes-card__footer')
			if (footer) {
				footer.addEventListener('click', (e) => e.stopPropagation())
				footer.addEventListener('pointerdown', (e) => e.stopPropagation())
			}
			const thumbCanvas = card.querySelector('.scenes-card__thumb-canvas')
			if (thumbCanvas) {
				thumbCanvas.dataset.sceneId = sc.id
				if (screenCount > 1) thumbCanvas.dataset.deckMain = String(col)
				else delete thumbCanvas.dataset.deckMain
				paintDeckThumb(thumbCanvas)
			}
			grid.appendChild(card)
		}

		const addTile = document.createElement('button')
		addTile.type = 'button'
		addTile.className = 'scenes-deck__add-look'
		addTile.title = `New look for ${mainLabel(col)}`
		addTile.setAttribute('aria-label', 'New look')
		addTile.textContent = '＋'
		addTile.addEventListener('click', () => {
			const global = false
			const id = sceneState.addScene(undefined, {
				mainScope: global ? 'all' : String(col),
			})
			sceneState.setEditingScene(id)
			selectedLayerIndexRef.current = null
			dispatchLayerSelect(null)
		})
		grid.appendChild(addTile)

		if (typeof clearPreviewBusForMain === 'function' && isPreviewBusAvailable(cm, col)) {
			colEl.addEventListener('click', (e) => {
				if (e.defaultPrevented) return
				if (!isScenesDeckColBlankClick(e.target, colEl)) return
				e.preventDefault()
				ensureMainForColumn(col)
				void clearPreviewBusForMain(col, { full: true })
			})
		}

		if (typeof onDeckMediaDrop === 'function' && typeof onDeckMediaDropAccept === 'function') {
			grid.addEventListener(
				'dragover',
				(e) => {
					if (!onDeckMediaDropAccept(e.dataTransfer)) return
					e.preventDefault()
					e.stopPropagation()
					const block = e.target.closest('.scenes-card') || e.target.closest('.scenes-deck-col__head')
					e.dataTransfer.dropEffect = block ? 'none' : 'copy'
					if (!block) grid.classList.add('scenes-deck--media-drop-target')
					else grid.classList.remove('scenes-deck--media-drop-target')
				},
				true,
			)
			grid.addEventListener('dragleave', (e) => {
				if (!grid.contains(e.relatedTarget)) grid.classList.remove('scenes-deck--media-drop-target')
			})
			grid.addEventListener(
				'drop',
				async (e) => {
					if (!onDeckMediaDropAccept(e.dataTransfer)) return
					e.preventDefault()
					e.stopPropagation()
					grid.classList.remove('scenes-deck--media-drop-target')
					if (e.target.closest('.scenes-card') || e.target.closest('.scenes-deck-col__head')) return
					await onDeckMediaDrop(col, e)
				},
				true,
			)
		}

		colEl.appendChild(grid)
		mount.appendChild(colEl)
	}

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
	} catch (e) {
		/* ignore */
	}

	previewPanel.scheduleDraw()
}

