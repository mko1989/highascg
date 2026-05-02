/**
 * Scenes deck — per-main look columns, main pills (output target), default transition, apply to all.
 */

import { mountLookTransitionControls } from './scenes-shared.js'
import { escapeHtml } from './scenes-editor-support.js'

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
 * @param {(sceneId: string) => void} ctx.sendSceneToPreviewCard
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
		selectedLayerIndexRef,
		globalTakeFromPreview,
		globalCutFromPreview,
	} = ctx

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
					`title="Take / preview / compose for this main" aria-pressed="${i === sceneState.activeScreenIndex}">${name}</button>` +
					`<button type="button" class="scenes-main-pill__eye" data-action="toggle-eye" data-screen="${i}" ` +
					`title="Show or hide this main’s look column" aria-label="Toggle column for ${name}">` +
					`${sceneState.isMainEditorVisible(i) ? '👁' : '⏻'}` +
					`</button></div>`,
			)
		}
		pillsParts.push('</div>')
		let check = ''
		check +=
			'<label class="scenes-next-global"><input type="checkbox" id="scenes-next-look-global" /> ' +
			'Next + look on <strong>all</strong> mains</label>'
		pillsParts.push(check)
	}
	pillsParts.push(
		'<div class="scenes-toolbar__global-take scenes-toolbar__global-take--right">' +
			'<button type="button" class="scenes-btn scenes-btn--take scenes-btn--icon" id="scenes-global-take" title="Take preview to program (LOADBG + transition + PLAY)" aria-label="Take preview to program">▶</button>' +
			'<button type="button" class="scenes-btn scenes-btn--icon" id="scenes-global-cut" title="Hard cut preview to program" aria-label="Hard cut preview to program">✂</button>' +
			'</div>' +
			'<div class="scenes-toolbar__transition-group" id="scenes-deck-transition-mount"></div>',
	)
	toolbar.innerHTML = pillsParts.join('')
	deckWrap.appendChild(toolbar)

	const transMount = toolbar.querySelector('#scenes-deck-transition-mount')
	mountLookTransitionControls(
		transMount,
		sceneState.globalDefaultTransition,
		(t) => sceneState.setGlobalDefaultTransition(t),
		'scenes-deck-dt',
		{ label: 'Default transition', hint: '' },
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
			if (e.shiftKey || e.metaKey || e.ctrlKey) {
				sceneState.toggleArmedScreen(i)
			} else {
				sceneState.switchScreen(i)
			}
		})
	})
	toolbar.querySelectorAll('[data-action="toggle-eye"]').forEach((btn) => {
		btn.addEventListener('click', (e) => {
			e.stopPropagation()
			const i = parseInt(/** @type {HTMLElement} */ (btn).dataset.screen || '0', 10)
			sceneState.toggleMainEditorVisible(i)
		})
	})
	const nextGlobalEl = /** @type {HTMLInputElement | null} */ (toolbar.querySelector('#scenes-next-look-global'))
	function nextLookGlobal() {
		return !!nextGlobalEl?.checked
	}

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
		head.textContent = mainLabel(col)
		colEl.appendChild(head)

		const grid = document.createElement('div')
		grid.className = 'scenes-deck'
		if (scenes.length === 0) {
			const empty = document.createElement('div')
			empty.className = 'scenes-deck__empty scenes-deck__empty--tight'
			empty.innerHTML = `<p>No looks for ${escapeHtml(mainLabel(col))}.</p><p class="scenes-deck__hint">Use + to add, or use “all mains” and create a global look.</p>`
			grid.appendChild(empty)
		}

		for (const sc of scenes) {
			const onPreview = sceneState.getPreviewSceneIdForMain(col) === sc.id
			const onPgm = sceneState.getLiveSceneIdForMain(col) === sc.id
			const isGlobal = sc.mainScope === 'all'
			const card = document.createElement('div')
			card.className =
				'scenes-card' + (onPgm ? ' scenes-card--live' : '') + (onPreview ? ' scenes-card--preview' : '')
			card.innerHTML = `
			<div class="scenes-card__header">
				<div class="scenes-card__badges" aria-hidden="true">
					${isGlobal ? '<span class="scenes-card__badge scenes-card__badge--global">All</span>' : ''}
					${onPgm ? '<span class="scenes-card__badge scenes-card__badge--pgm">PGM</span>' : ''}
					${onPreview ? '<span class="scenes-card__badge scenes-card__badge--prv">PRV</span>' : ''}
				</div>
				<input type="text" class="scenes-card__name-input" maxlength="120" spellcheck="false" aria-label="Look name" />
				<div class="scenes-card__header-actions">
					<button type="button" class="scenes-card__icon-btn" data-action="duplicate" title="Duplicate look" aria-label="Duplicate look">⧉</button>
					<button type="button" class="scenes-card__icon-btn scenes-card__icon-btn--danger" data-action="delete" title="Delete look" aria-label="Delete look">🗑</button>
				</div>
			</div>
			${
				screenCount > 1
					? `<label class="scenes-card__scope-line">Scope
					<select class="scenes-card__scope" data-scene-id="${escapeHtml(String(sc.id))}" aria-label="Look scope for mains">
						${[...Array(screenCount).keys()]
							.map(
								(mi) =>
									`<option value="${mi}" ${String(sc.mainScope) === String(mi) && !isGlobal ? 'selected' : ''}>${escapeHtml(mainLabel(mi))} only</option>`,
							)
							.join('')}
						<option value="all" ${isGlobal ? 'selected' : ''}>All mains</option>
					</select></label>`
					: ''
			}
			<button type="button" class="scenes-card__thumb" data-action="prv" aria-label="Send to preview">
				<canvas class="scenes-card__thumb-canvas"></canvas>
			</button>
			<div class="scenes-card__footer">
				<button type="button" class="scenes-btn scenes-btn--take scenes-btn--sm scenes-btn--icon" data-action="take" title="Take live (LOADBG + transition + PLAY)" aria-label="Take live">▶</button>
				<button type="button" class="scenes-btn scenes-btn--sm scenes-btn--icon" data-action="cut" title="Hard cut" aria-label="Hard cut">✂</button>
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

			const sendPrv = (e) => {
				e.stopPropagation()
				ensureMainForColumn(col)
				if (sceneState.getPreviewSceneIdForMain(col) === sc.id) return
				sendSceneToPreviewCard(sc.id)
			}
			card.querySelectorAll('[data-action="prv"]').forEach((el) => el.addEventListener('click', sendPrv))

			card.addEventListener('click', sendPrv)

			card.querySelector('[data-action="take"]')?.addEventListener('click', (e) => {
				e.stopPropagation()
				ensureMainForColumn(col)
				takeSceneToProgram(sc.id, false)
			})
			card.querySelector('[data-action="cut"]')?.addEventListener('click', (e) => {
				e.stopPropagation()
				ensureMainForColumn(col)
				takeSceneToProgram(sc.id, true)
			})
			card.querySelector('[data-action="edit"]')?.addEventListener('click', (e) => {
				e.stopPropagation()
				ensureMainForColumn(col)
				if (sceneState.getPreviewSceneIdForMain(col) !== sc.id) sendSceneToPreviewCard(sc.id)
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
			const scopeLine = card.querySelector('.scenes-card__scope-line')
			if (scopeLine) {
				scopeLine.addEventListener('click', (e) => e.stopPropagation())
				scopeLine.addEventListener('pointerdown', (e) => e.stopPropagation())
			}
			const scopeSel = card.querySelector('.scenes-card__scope')
			if (scopeSel) {
				scopeSel.addEventListener('pointerdown', (e) => e.stopPropagation())
				scopeSel.addEventListener('change', () => {
					const v = /** @type {HTMLSelectElement} */ (scopeSel).value
					sceneState.setSceneMainScope(sc.id, v === 'all' ? 'all' : v)
				})
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
		addTile.title = nextGlobalEl?.checked
			? 'New look on all mains'
			: `New look for ${mainLabel(col)}`
		addTile.setAttribute('aria-label', 'New look')
		addTile.textContent = '＋'
		addTile.addEventListener('click', () => {
			const global = screenCount > 1 && nextLookGlobal()
			const id = sceneState.addScene(undefined, {
				mainScope: global ? 'all' : String(col),
			})
			sceneState.setEditingScene(id)
			selectedLayerIndexRef.current = null
			dispatchLayerSelect(null)
		})
		grid.appendChild(addTile)
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

	previewPanel.scheduleDraw()
}
