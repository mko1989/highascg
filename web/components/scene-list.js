/**
 * Scenes deck — toolbar, default transition row, grid of look cards.
 */

import { mountLookTransitionControls } from './scenes-shared.js'

/**
 * @param {object} ctx
 * @param {HTMLElement} ctx.mainHost
 * @param {import('../lib/scene-state.js').SceneStateManager} ctx.sceneState
 * @param {() => number} ctx.getScreenCount
 * @param {() => number} ctx.getProgramChannel
 * @param {() => number} ctx.getPreviewChannel
 * @param {(sc: import('../lib/scene-state.js').Scene) => string | null} ctx.thumbnailUrlForScene
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
		getProgramChannel,
		getPreviewChannel,
		thumbnailUrlForScene,
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
	const deckWrap = document.createElement('div')
	deckWrap.className = 'scenes-deck-toolbar'
	const toolbar = document.createElement('div')
	toolbar.className = 'scenes-toolbar'
	const screenCount = getScreenCount()
	let screenTabs = ''
	if (screenCount > 1) {
		for (let i = 0; i < screenCount; i++) {
			screenTabs += `<button type="button" class="scenes-screen-tab ${i === sceneState.activeScreenIndex ? 'active' : ''}" data-screen="${i}">Screen ${i + 1}</button>`
		}
	}
	toolbar.innerHTML = `
		${screenCount > 1 ? `<div class="scenes-screen-tabs">${screenTabs}</div>` : ''}
		<button type="button" class="scenes-btn scenes-btn--primary scenes-btn--icon" id="scenes-add-look" title="New look" aria-label="New look">＋</button>
		<div class="scenes-toolbar__global-take">
			<button type="button" class="scenes-btn scenes-btn--take scenes-btn--icon" id="scenes-global-take" title="Take preview to program" aria-label="Take preview to program">▶</button>
			<button type="button" class="scenes-btn scenes-btn--icon" id="scenes-global-cut" title="Hard cut preview to program" aria-label="Hard cut preview to program">✂</button>
		</div>
		<span class="scenes-toolbar__hint">PRV → PGM · PGM ch ${getProgramChannel()} · PRV ch ${getPreviewChannel()}</span>
	`
	deckWrap.appendChild(toolbar)

	const transitionDeckRow = document.createElement('div')
	transitionDeckRow.className = 'scenes-deck-transition-row'
	const transitionDeckInner = document.createElement('div')
	transitionDeckInner.className = 'scenes-deck-transition-row__controls'
	mountLookTransitionControls(
		transitionDeckInner,
		sceneState.globalDefaultTransition,
		(t) => sceneState.setGlobalDefaultTransition(t),
		'scenes-deck-dt',
		{
			label: 'Default look transition',
			hint: 'Used when you create a new look. Apply to all copies this to every look below.',
		}
	)
	const applyAllBtn = document.createElement('button')
	applyAllBtn.type = 'button'
	applyAllBtn.className = 'scenes-btn scenes-btn--sm'
	applyAllBtn.textContent = 'Apply to all looks'
	applyAllBtn.title = 'Set every look’s transition to match the default above'
	applyAllBtn.addEventListener('click', () => {
		sceneState.applyGlobalDefaultToAllLooks()
		showToast('Default transition applied to all looks.', 'info')
	})
	transitionDeckRow.appendChild(transitionDeckInner)
	transitionDeckRow.appendChild(applyAllBtn)
	deckWrap.appendChild(transitionDeckRow)
	mainHost.appendChild(deckWrap)

	toolbar.querySelector('#scenes-add-look')?.addEventListener('click', () => {
		const id = sceneState.addScene()
		sceneState.setEditingScene(id)
		selectedLayerIndexRef.current = null
		dispatchLayerSelect(null)
	})
	toolbar.querySelector('#scenes-global-take')?.addEventListener('click', () => globalTakeFromPreview())
	toolbar.querySelector('#scenes-global-cut')?.addEventListener('click', () => globalCutFromPreview())
	toolbar.querySelectorAll('.scenes-screen-tab').forEach((btn) => {
		btn.addEventListener('click', () => {
			sceneState.switchScreen(parseInt(btn.dataset.screen, 10))
		})
	})

	const grid = document.createElement('div')
	grid.className = 'scenes-deck'

	if (sceneState.scenes.length === 0) {
		const empty = document.createElement('div')
		empty.className = 'scenes-deck__empty'
		empty.innerHTML =
			'<p>No looks yet.</p><p class="scenes-deck__hint">Create a look, then tap its thumbnail to load preview. Use toolbar Take/Cut to put preview on program.</p>'
		grid.appendChild(empty)
	}

	sceneState.scenes.forEach((sc) => {
		const thumbUrl = thumbnailUrlForScene(sc)
		const onPreview = sceneState.previewSceneId === sc.id
		const card = document.createElement('div')
		card.className =
			'scenes-card' +
			(sceneState.liveSceneId === sc.id ? ' scenes-card--live' : '') +
			(onPreview ? ' scenes-card--preview' : '')
		card.innerHTML = `
			<div class="scenes-card__header">
				<input type="text" class="scenes-card__name-input" maxlength="120" spellcheck="false" aria-label="Look name" />
				<div class="scenes-card__header-actions">
					<button type="button" class="scenes-card__icon-btn" data-action="duplicate" title="Duplicate look" aria-label="Duplicate look">⧉</button>
					<button type="button" class="scenes-card__icon-btn scenes-card__icon-btn--danger" data-action="delete" title="Delete look" aria-label="Delete look">🗑</button>
				</div>
			</div>
			<button type="button" class="scenes-card__thumb" data-action="prv" aria-label="Send to preview">
				${
					thumbUrl
						? `<img src="${thumbUrl}" alt="" />`
						: `<div class="scenes-card__thumb-empty">${sc.layers.length} layer(s) — add media for thumbnail</div>`
				}
			</button>
			<div class="scenes-card__footer">
				<button type="button" class="scenes-btn scenes-btn--take scenes-btn--sm scenes-btn--icon" data-action="take" title="Take live" aria-label="Take live">▶</button>
				<button type="button" class="scenes-btn scenes-btn--sm scenes-btn--icon" data-action="cut" title="Hard cut" aria-label="Hard cut">✂</button>
				<button type="button" class="scenes-btn scenes-btn--sm scenes-btn--icon" data-action="edit" title="Edit look" aria-label="Edit look">⚙</button>
			</div>
		`

		const sendPrv = (e) => {
			e.stopPropagation()
			if (sceneState.previewSceneId === sc.id) return
			sendSceneToPreviewCard(sc.id)
		}
		card.querySelectorAll('[data-action="prv"]').forEach((el) => el.addEventListener('click', sendPrv))

		const nameIn = card.querySelector('.scenes-card__name-input')
		if (nameIn) {
			nameIn.value = sc.name
			function commitCardName() {
				const s = sceneState.getScene(sc.id)
				if (!s) return
				sceneState.setSceneName(sc.id, nameIn.value)
				const updated = sceneState.getScene(sc.id)
				if (updated && nameIn.value !== updated.name) nameIn.value = updated.name
			}
			;['pointerdown', 'mousedown', 'click'].forEach((ev) =>
				nameIn.addEventListener(ev, (e) => e.stopPropagation())
			)
			nameIn.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault()
					nameIn.blur()
				}
			})
			nameIn.addEventListener('blur', commitCardName)
		}

		card.querySelector('[data-action="take"]')?.addEventListener('click', (e) => {
			e.stopPropagation()
			takeSceneToProgram(sc.id, false)
		})
		card.querySelector('[data-action="cut"]')?.addEventListener('click', (e) => {
			e.stopPropagation()
			takeSceneToProgram(sc.id, true)
		})
		card.querySelector('[data-action="edit"]')?.addEventListener('click', (e) => {
			e.stopPropagation()
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
		grid.appendChild(card)
	})

	mainHost.appendChild(grid)
	previewPanel.scheduleDraw()
}
