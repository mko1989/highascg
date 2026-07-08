/**
 * Scenes deck — single main column (look cards, FTB, global border, media drop).
 */

import { isPreviewBusAvailable } from '../lib/scenes-preview-look-stack.js'
import { isCgOnlyLook } from '../lib/scene-look-kind.js'
import { resolveBusLookIdsForMain, hasPreviewLookForMain } from '../lib/scene-live-main-sync.js'
import { api } from '../lib/api-client.js'

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
 * @param {object} deckCtx — shared renderSceneDeck context
 * @param {number} col
 * @param {object[]} scenes
 * @param {HTMLElement} mount
 * @param {object} local
 * @param {(i: number) => string} local.mainLabel
 * @param {(col: number) => void} local.ensureMainForColumn
 */
export function appendSceneDeckColumn(deckCtx, col, scenes, mount, local) {
	const {
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
	} = deckCtx
	const { mainLabel, ensureMainForColumn } = local
	const cm = getChannelMap()

		const colEl = document.createElement('div')
		colEl.className = 'scenes-deck-col'
		colEl.dataset.mainCol = String(col)
		const head = document.createElement('div')
		head.className = 'scenes-deck-col__head'
		head.style.display = 'flex'
		head.style.justifyContent = 'space-between'
		head.style.alignItems = 'center'

		const headLeft = document.createElement('div')
		headLeft.className = 'scenes-deck-col__head-left'

		const title = document.createElement('span')
		title.className = 'scenes-deck-col__title'
		title.textContent = mainLabel(col)
		headLeft.appendChild(title)

		const ftbBtn = document.createElement('button')
		ftbBtn.type = 'button'
		ftbBtn.className = 'scenes-btn scenes-btn--ftb'
		ftbBtn.textContent = 'FTB'
		ftbBtn.title = `Fade to black on ${mainLabel(col)} (PGM + PRV), then clear`
		ftbBtn.setAttribute('aria-label', `Fade to black ${mainLabel(col)}`)
		ftbBtn.addEventListener('click', (e) => {
			e.stopPropagation()
			if (ftbBtn.disabled) return
			ftbBtn.disabled = true
			void (async () => {
				try {
					await api.post('/api/ftb', { screenIdx: col })
					sceneState.setLiveSceneId(null, col)
					sceneState.setPreviewSceneId(null, col)
					showToast(`FTB: ${mainLabel(col)}`, 'info')
				} catch (err) {
					showToast(`FTB: ${err?.message || err}`, 'error')
				} finally {
					ftbBtn.disabled = false
				}
			})()
		})
		headLeft.appendChild(ftbBtn)
		head.appendChild(headLeft)

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
		if (isPreviewBusAvailable(cm, col)) {
			grid.title = 'Click empty space to clear preview for this screen'
		}
		if (scenes.length === 0) {
			const empty = document.createElement('div')
			empty.className = 'scenes-deck__empty scenes-deck__empty--tight scenes-deck__empty--clear-prv'
			const emptyLine = document.createElement('p')
			emptyLine.textContent = `No looks for ${mainLabel(col)}.`
			const emptyHint = document.createElement('p')
			emptyHint.className = 'scenes-deck__hint'
			emptyHint.textContent = 'Use + to add, drop media from Sources or your desktop to start a look, or use “all mains” and create a global look.'
			empty.appendChild(emptyLine)
			empty.appendChild(emptyHint)
			empty.title = 'Clear preview for this screen (stops looks on the PRV channel when it is separate from PGM)'
			grid.appendChild(empty)
		}

		for (const sc of scenes) {
			const sceneLive = getSceneLive() || {}
			const sceneExists = (id) => !!sceneState.getScene(id)
			const { pgmLookId, prvLookId } = resolveBusLookIdsForMain(
				col,
				sceneLive,
				cm,
				sceneExists,
				sceneState,
			)
			const onPgm = pgmLookId === sc.id
			// B150.3: PGM-only mains have no PRV channel in scene.live — the armed
			// look lives only in client state (setPreviewSceneId), so read it there.
			const armedPrvId = !isPreviewBusAvailable(cm, col) ? sceneState.getPreviewSceneIdForMain(col) : null
			const onPreview = !onPgm && (prvLookId === sc.id || armedPrvId === sc.id)
			const isGlobal = sc.mainScope === 'all'
			const cgOnly = isCgOnlyLook(sc)
			// Scoped looks: live/preview styling only on the main they belong to (already filtered by getScenesForMain).
			const card = document.createElement('div')
			card.className =
				'scenes-card' +
				(onPgm ? ' scenes-card--live' : '') +
				(onPreview ? ' scenes-card--preview' : '') +
				(isGlobal ? ' scenes-card--global' : '') +
				(cgOnly ? ' scenes-card--cg-only' : '')
			card.dataset.sceneId = String(sc.id)
			const header = document.createElement('div')
			header.className = 'scenes-card__header'
			const nameInput = document.createElement('input')
			nameInput.type = 'text'
			nameInput.className = 'scenes-card__name-input'
			nameInput.maxLength = 120
			nameInput.spellcheck = false
			nameInput.setAttribute('aria-label', 'Look name')
			const headerActions = document.createElement('div')
			headerActions.className = 'scenes-card__header-actions'
			const duplicateBtn = document.createElement('button')
			duplicateBtn.type = 'button'
			duplicateBtn.className = 'scenes-card__icon-btn'
			duplicateBtn.dataset.action = 'duplicate'
			duplicateBtn.title = 'Duplicate look'
			duplicateBtn.setAttribute('aria-label', 'Duplicate look')
			duplicateBtn.textContent = '⧉'
			const deleteBtn = document.createElement('button')
			deleteBtn.type = 'button'
			deleteBtn.className = 'scenes-card__icon-btn scenes-card__icon-btn--danger'
			deleteBtn.dataset.action = 'delete'
			deleteBtn.title = 'Delete look'
			deleteBtn.setAttribute('aria-label', 'Delete look')
			deleteBtn.textContent = '🗑'
			headerActions.appendChild(duplicateBtn)
			headerActions.appendChild(deleteBtn)
			header.appendChild(nameInput)
			header.appendChild(headerActions)
			const thumbBtn = document.createElement('button')
			thumbBtn.type = 'button'
			thumbBtn.className = 'scenes-card__thumb'
			thumbBtn.dataset.action = 'prv'
			thumbBtn.setAttribute('aria-label', 'Send to preview')
			const thumbCanvas = document.createElement('canvas')
			thumbCanvas.className = 'scenes-card__thumb-canvas'
			thumbBtn.appendChild(thumbCanvas)
			const footer = document.createElement('div')
			footer.className = 'scenes-card__footer'
			const takeBtn = document.createElement('button')
			takeBtn.type = 'button'
			takeBtn.className = 'scenes-btn scenes-btn--take scenes-btn--sm scenes-btn--icon'
			takeBtn.dataset.action = 'take'
			takeBtn.title = 'Take live (LOADBG + transition + PLAY)'
			takeBtn.setAttribute('aria-label', 'Take live')
			takeBtn.textContent = '▶'
			const cutBtn = document.createElement('button')
			cutBtn.type = 'button'
			cutBtn.className = 'scenes-btn scenes-btn--sm'
			cutBtn.dataset.action = 'cut'
			cutBtn.title = 'Hard cut'
			cutBtn.setAttribute('aria-label', 'Hard cut')
			cutBtn.textContent = 'CUT'
			const editBtn = document.createElement('button')
			editBtn.type = 'button'
			editBtn.className = 'scenes-btn scenes-btn--sm scenes-btn--icon'
			editBtn.dataset.action = 'edit'
			editBtn.title = 'Edit look'
			editBtn.setAttribute('aria-label', 'Edit look')
			editBtn.textContent = '⚙'
			footer.appendChild(takeBtn)
			footer.appendChild(cutBtn)
			footer.appendChild(editBtn)
			card.appendChild(header)
			card.appendChild(thumbBtn)
			card.appendChild(footer)

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
					// B150.3: PGM-only — arm as PRV in client state only (no Caspar
					// preview routing). Enables "save preset from PRV" and global Take.
					sceneState.setPreviewSceneId(sc.id, col)
					showToast('Armed as PRV (UI only — PGM-only output). Take airs it.', 'info')
					return
				}
				await sendSceneToPreviewCard(sc.id, { targetMains: [col] })
			}
			card.querySelectorAll('[data-action="prv"]').forEach((el) => el.addEventListener('click', sendPrv))

			card.addEventListener('click', (e) => {
				if (e.target.closest('[data-action]')) return
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
			const headerEl = card.querySelector('.scenes-card__header')
			if (headerEl) {
				headerEl.addEventListener('click', (e) => e.stopPropagation())
				headerEl.addEventListener('pointerdown', (e) => e.stopPropagation())
			}
			const footerEl = card.querySelector('.scenes-card__footer')
			if (footerEl) {
				footerEl.addEventListener('click', (e) => e.stopPropagation())
				footerEl.addEventListener('pointerdown', (e) => e.stopPropagation())
			}
			const thumbCanvasEl = card.querySelector('.scenes-card__thumb-canvas')
			if (thumbCanvasEl) {
				thumbCanvasEl.dataset.sceneId = sc.id
				thumbCanvasEl.dataset.deckMain = String(col)
				paintDeckThumb(thumbCanvasEl)
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

		if (typeof clearPreviewBusForMain === 'function') {
			const prvAvailable = isPreviewBusAvailable(cm, col)
			colEl.addEventListener('click', (e) => {
				if (e.defaultPrevented) return
				if (!isScenesDeckColBlankClick(e.target, colEl)) return
				const sceneLive = getSceneLive() || {}
				const sceneExists = (id) => !!sceneState.getScene(id)
				// PGM-only (B150.3): armed PRV is client-state only — clear that
				// (clearPreviewBusForMain skips AMCP when PGM/PRV share a channel).
				const hasArmed = prvAvailable
					? hasPreviewLookForMain(col, sceneLive, cm, sceneExists, sceneState)
					: !!sceneState.getPreviewSceneIdForMain(col)
				if (!hasArmed) return
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
