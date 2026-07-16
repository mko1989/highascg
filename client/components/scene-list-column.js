/**
 * Scenes deck — single main column (look cards, FTB, global border, media drop).
 */

import { isPreviewBusAvailable } from '../lib/scenes-preview-look-stack.js'
import { isCgOnlyLook } from '../lib/scene-look-kind.js'
import { resolveBusLookIdsForMain, hasPreviewLookForMain } from '../lib/scene-live-main-sync.js'
import { api } from '../lib/api-client.js'
import { showTimerInspectorModal } from './timer-inspector-modal.js'

/**
 * WO-226 T226.3: per-screen timer icon next to the FTB button. A module-level cache (shared
 * across every column) avoids one /api/timers/list fetch per column per render — the deck
 * tears down and rebuilds all columns on most sceneState changes, so per-column fetches would
 * multiply fast. The cache is populated once lazily and refreshed on the lightweight
 * 'screen-timers-changed' event that the drop-assign path (scenes-editor-deck-drop.js), the
 * timer inspector modal, and the compact transport (audio-mixer-panel.js) all dispatch after a
 * successful POST.
 */
let _timersCache = []
let _timersCacheLoaded = false
let _timersFetchPromise = null
let _timersListenerBound = false

function _timerStateForScreen(screenIdx) {
	for (const t of _timersCache) {
		const entry = t?.screens?.[String(screenIdx)]
		if (entry) return { timerId: t.timerId, visible: !!entry.visible }
	}
	return null
}

function _applyTimerButtonState(btn, screenIdx) {
	const state = _timerStateForScreen(screenIdx)
	if (!state) {
		btn.hidden = true
		return
	}
	btn.hidden = false
	btn.dataset.timerId = state.timerId
	btn.classList.toggle('scenes-btn--timer-on', state.visible)
	btn.title = state.visible ? 'Timer on air — click for settings' : 'Timer assigned (hidden) — click for settings'
}

function _refreshAllTimerButtons() {
	document.querySelectorAll('.scenes-deck-col__timer-btn').forEach((btn) => {
		const idx = parseInt(btn.dataset.screenIdx, 10)
		if (Number.isFinite(idx)) _applyTimerButtonState(btn, idx)
	})
}

function _fetchTimersCache() {
	if (_timersFetchPromise) return _timersFetchPromise
	_timersFetchPromise = api
		.get('/api/timers/list')
		.then((res) => {
			if (res?.ok && Array.isArray(res.timers)) _timersCache = res.timers
			_timersCacheLoaded = true
		})
		.catch(() => {
			/* leave cache as-is; a later event will retry */
		})
		.finally(() => {
			_timersFetchPromise = null
		})
	return _timersFetchPromise
}

function _ensureTimersListener() {
	if (_timersListenerBound) return
	_timersListenerBound = true
	window.addEventListener('screen-timers-changed', () => {
		_fetchTimersCache().then(_refreshAllTimerButtons)
	})
}

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
					const fps = cm?.programResolutions?.[col]?.fps ?? 50
					const durationFrames = Math.round(0.5 * fps)
					await api.post('/api/ftb', { screenIdx: col, durationFrames, framerate: fps })
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

		// WO-226 T226.3: per-screen timer icon — shown only when a timer is assigned to this
		// screen (state comes from the shared module-level cache). Click opens the inspector.
		const timerBtn = document.createElement('button')
		timerBtn.type = 'button'
		timerBtn.className = 'scenes-btn scenes-btn--timer scenes-deck-col__timer-btn'
		timerBtn.textContent = '⏱'
		timerBtn.dataset.screenIdx = String(col)
		timerBtn.hidden = true
		timerBtn.setAttribute('aria-label', `Timer settings for ${mainLabel(col)}`)
		timerBtn.addEventListener('click', (e) => {
			e.stopPropagation()
			const state = _timerStateForScreen(col)
			if (!state) return
			showTimerInspectorModal({ timerId: state.timerId, screenIdx: col, screenLabel: mainLabel(col) })
		})
		headLeft.appendChild(timerBtn)
		head.appendChild(headLeft)

		_ensureTimersListener()
		_applyTimerButtonState(timerBtn, col)
		if (!_timersCacheLoaded) {
			_fetchTimersCache().then(_refreshAllTimerButtons)
		}

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
			// Inline SVG, not a glyph: '⧉' (U+29C9) has no coverage in the bundled Rewir font or the
			// Linux fallback sans — it rendered only under Chromium and vanished on Firefox (2026-07-16).
			duplicateBtn.innerHTML =
				'<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5.5" y="5.5" width="9" height="9" rx="1"/><path d="M10.5 3.5v-1a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h1"/></svg>'
			const deleteBtn = document.createElement('button')
			deleteBtn.type = 'button'
			deleteBtn.className = 'scenes-card__icon-btn scenes-card__icon-btn--danger'
			deleteBtn.dataset.action = 'delete'
			deleteBtn.title = 'Delete look'
			deleteBtn.setAttribute('aria-label', 'Delete look')
			// Inline SVG for the same reason as duplicateBtn: '🗑' needs a color-emoji font (absent here).
			deleteBtn.innerHTML =
				'<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2.5 4.5h11M6.5 4.5v-2h3v2M4 4.5l.8 9a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.8-9M6.5 7.5v4M9.5 7.5v4"/></svg>'
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
