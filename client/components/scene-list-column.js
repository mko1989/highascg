/**
 * Scenes deck — single main column (look cards, FTB, global border, media drop).
 */

import { escapeHtml } from './scenes-editor-support.js'
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
			empty.innerHTML = `<p>No looks for ${escapeHtml(mainLabel(col))}.</p><p class="scenes-deck__hint">Use + to add, drop media from Sources or your desktop to start a look, or use “all mains” and create a global look.</p>`
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
			const onPreview = !onPgm && prvLookId === sc.id
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
				thumbCanvas.dataset.deckMain = String(col)
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
				const sceneLive = getSceneLive() || {}
				const sceneExists = (id) => !!sceneState.getScene(id)
				if (!hasPreviewLookForMain(col, sceneLive, cm, sceneExists, sceneState)) return
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
