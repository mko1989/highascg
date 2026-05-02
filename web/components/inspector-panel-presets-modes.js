/**
 * Right-panel modes: layer + look preset libraries (see work/WO_look-and-layer-presets.md).
 */
import { sceneState } from '../lib/scene-state.js'
import { mountLayerPresetControls } from './scene-layer-row.js'
import { showScenesToast } from './scenes-editor-support.js'
import { LOOK_PRESET_RECALL_PGM, LOOK_PRESET_RECALL_PRV } from '../lib/look-preset-events.js'
import { api } from '../lib/api-client.js'
import { SWITCHER_INTEGRATION_DISABLED } from './device-view-switcher-integration-disabled.js'

/**
 * @param {HTMLElement} root
 * @param {object} opts
 * @param {() => object | null} opts.getSelection
 * @param {() => void} [opts.onSceneRefresh]
 */
export function renderLayerPresetsMode(root, { getSelection, onSceneRefresh }) {
	root.innerHTML = ''
	const h = document.createElement('div')
	h.className = 'inspector-title'
	h.textContent = 'Layer style presets'
	root.appendChild(h)

	const sel = getSelection()
	const sceneLayer = sel?.type === 'sceneLayer' ? sel : null
	const sceneId = sceneLayer?.sceneId
	const layerIndex = sceneLayer != null && typeof sceneLayer.layerIndex === 'number' ? sceneLayer.layerIndex : null

	if (sceneId != null && layerIndex != null) {
		const scene = sceneState.getScene(sceneId)
		const L = scene?.layers?.[layerIndex]
		const p = document.createElement('p')
		p.className = 'panel-inspector-mode__context'
		p.textContent = `Target: “${scene?.name || 'Look'}” · layer ${L?.layerNumber ?? layerIndex + 1}`
		root.appendChild(p)

		const canPaste = sceneState.hasLayerStyleClipboard()
		const clipRow = document.createElement('div')
		clipRow.className = 'inspector-layer-style__row'
		clipRow.innerHTML = `
			<button type="button" class="scenes-btn scenes-btn--sm scenes-btn--icon" data-lp-tab-copy title="Copy position, scale, opacity, keyer, transition" aria-label="Copy layer settings">⎘</button>
			<button type="button" class="scenes-btn scenes-btn--sm scenes-btn--icon" data-lp-tab-paste title="Paste copied settings" aria-label="Paste layer settings" ${canPaste ? '' : 'disabled'}>📋</button>
			<button type="button" class="scenes-btn scenes-btn--sm scenes-btn--icon" data-lp-tab-save title="Save as layer style preset" aria-label="Save as layer style preset">💾</button>
		`
		clipRow.querySelector('[data-lp-tab-copy]')?.addEventListener('click', () => {
			if (sceneState.copyLayerStyle(sceneId, layerIndex)) {
				showScenesToast('Layer settings copied (not source).', 'info')
				const pb = clipRow.querySelector('[data-lp-tab-paste]')
				if (pb) pb.disabled = false
			}
		})
		clipRow.querySelector('[data-lp-tab-paste]')?.addEventListener('click', () => {
			if (sceneState.pasteLayerStyle(sceneId, layerIndex)) {
				showScenesToast('Settings pasted.', 'info')
				document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
				onSceneRefresh?.()
			}
		})
		clipRow.querySelector('[data-lp-tab-save]')?.addEventListener('click', () => {
			const name = window.prompt('Layer style preset name?')
			if (name == null) return
			if (sceneState.saveLayerPresetFromLayer(sceneId, layerIndex, name)) {
				showScenesToast('Layer preset saved.', 'info')
				onSceneRefresh?.()
			} else {
				showScenesToast('Could not save preset (empty name).', 'warn')
			}
		})
		root.appendChild(clipRow)
	} else {
		const hint = document.createElement('p')
		hint.className = 'panel-inspector-mode__hint'
		hint.textContent =
			'Select a layer in the Scenes look editor to set the target for Apply. You can still delete presets from the list below.'
		root.appendChild(hint)
	}

	const importRow = document.createElement('div')
	importRow.className = 'panel-presets-import'
	const importBtn = document.createElement('button')
	importBtn.type = 'button'
	importBtn.className = 'panel-presets-import__btn'
	importBtn.textContent = 'Import from server (GET /api/state)'
	importBtn.title = 'Replace local layer presets with scene.deck.layerPresets (last WebSocket sync from any browser).'
	importBtn.addEventListener('click', async () => {
		if (!window.confirm('Replace local layer style presets with the server copy? (Cannot undo.)')) return
		try {
			const st = await api.get('/api/state')
			const list = st?.scene?.deck?.layerPresets
			if (!Array.isArray(list) || list.length === 0) {
				showScenesToast('No layer presets on the server yet. Open a browser once to sync, or add presets in this UI first.', 'warn')
				return
			}
			if (sceneState.importLayerPresetsFromServer(list)) {
				showScenesToast('Layer presets imported from server.', 'info')
				onSceneRefresh?.()
			} else {
				showScenesToast('Server data did not contain valid layer presets.', 'warn')
			}
		} catch (e) {
			showScenesToast(e?.message || 'Import failed', 'error')
		}
	})
	importRow.appendChild(importBtn)
	root.appendChild(importRow)

	const box = document.createElement('div')
	box.className = 'scenes-layer-presets scenes-layer-presets--tab'
	mountLayerPresetControls(box, {
		sceneId: sceneId || '',
		getLayerIndex: () => (sceneId != null && layerIndex != null ? layerIndex : null),
		sceneState,
		showToast: showScenesToast,
		applyButtonLabel: 'Apply to target layer',
		onAfterChange: () => {
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
			onSceneRefresh?.()
		},
		title: 'Library',
		hintText: 'Included in project save. Same fields as the layer list (⎘ / 📋 / 💾).',
	})
	root.appendChild(box)
}

function sourceKindLabel(k) {
	if (k === 'prv') return 'PRV'
	if (k === 'pgm') return 'PGM'
	if (k === 'editing') return 'Open look'
	return '—'
}

/**
 * v1: bookmarks a deck look by id (not a full AMCP snapshot). Recall uses the same push/take path as the deck.
 * @param {HTMLElement} root
 * @param {object} [opts]
 * @param {() => void} [opts.onSceneRefresh]
 */
export function renderLookPresetsMode(root, { onSceneRefresh } = {}) {
	root.innerHTML = ''
	const t = document.createElement('div')
	t.className = 'inspector-title'
	t.textContent = 'Look presets'
	root.appendChild(t)

	const intro = document.createElement('p')
	intro.className = 'panel-inspector-mode__hint'
	intro.textContent =
		'Bookmarks point at a deck look. Save captures which look is on preview, program, or the editor. Recall loads that look to PRV or takes it live.'
	root.appendChild(intro)

	const saveTitle = document.createElement('div')
	saveTitle.className = 'scenes-layer-presets__title'
	saveTitle.textContent = 'Save from current bus'
	root.appendChild(saveTitle)

	const hasPrv = !!sceneState.previewSceneId && sceneState.getScene(sceneState.previewSceneId)
	const hasPgm = !!sceneState.liveSceneId && sceneState.getScene(sceneState.liveSceneId)
	const hasEd = !!sceneState.editingSceneId && sceneState.getScene(sceneState.editingSceneId)
	const saveRow = document.createElement('div')
	saveRow.className = 'look-presets__save-row'
	saveRow.innerHTML = `
		<button type="button" class="scenes-btn scenes-btn--sm" data-lp-sav-prv ${hasPrv ? '' : 'disabled'}>From PRV</button>
		<button type="button" class="scenes-btn scenes-btn--sm" data-lp-sav-pgm ${hasPgm ? '' : 'disabled'}>From PGM</button>
		<button type="button" class="scenes-btn scenes-btn--sm" data-lp-sav-ed ${hasEd ? '' : 'disabled'}>From open look</button>
	`
	if (!hasPrv) saveRow.querySelector('[data-lp-sav-prv]')?.setAttribute('title', 'No look on preview')
	if (!hasPgm) saveRow.querySelector('[data-lp-sav-pgm]')?.setAttribute('title', 'No look on program')
	if (!hasEd) saveRow.querySelector('[data-lp-sav-ed]')?.setAttribute('title', 'Open a look in the editor first')
	saveRow.querySelector('[data-lp-sav-prv]')?.addEventListener('click', () => {
		const name = window.prompt('Look preset name? (from preview)')
		if (name == null) return
		if (sceneState.saveLookPreset(name, 'prv')) {
			showScenesToast('Look preset saved from preview.', 'info')
			onSceneRefresh?.()
		} else {
			showScenesToast('Nothing valid on preview to save.', 'warn')
		}
	})
	saveRow.querySelector('[data-lp-sav-pgm]')?.addEventListener('click', () => {
		const name = window.prompt('Look preset name? (from program)')
		if (name == null) return
		if (sceneState.saveLookPreset(name, 'pgm')) {
			showScenesToast('Look preset saved from program.', 'info')
			onSceneRefresh?.()
		} else {
			showScenesToast('Nothing valid on program to save.', 'warn')
		}
	})
	saveRow.querySelector('[data-lp-sav-ed]')?.addEventListener('click', () => {
		const name = window.prompt('Look preset name? (from look being edited)')
		if (name == null) return
		if (sceneState.saveLookPreset(name, 'editing')) {
			showScenesToast('Look preset saved.', 'info')
			onSceneRefresh?.()
		} else {
			showScenesToast('Open a look in the editor to save it.', 'warn')
		}
	})
	root.appendChild(saveRow)

	const importLookRow = document.createElement('div')
	importLookRow.className = 'panel-presets-import'
	const importLookBtn = document.createElement('button')
	importLookBtn.type = 'button'
	importLookBtn.className = 'panel-presets-import__btn'
	importLookBtn.textContent = 'Import from server (GET /api/state)'
	importLookBtn.title = 'Replace local look presets with scene.deck.lookPresets (last WebSocket sync).'
	importLookBtn.addEventListener('click', async () => {
		if (!window.confirm('Replace local look bookmarks with the server copy? (Cannot undo.)')) return
		try {
			const st = await api.get('/api/state')
			const list = st?.scene?.deck?.lookPresets
			if (!Array.isArray(list) || list.length === 0) {
				showScenesToast('No look presets on the server yet. Open a browser once to sync, or add presets in this tab first.', 'warn')
				return
			}
			if (sceneState.importLookPresetsFromServer(list)) {
				showScenesToast('Look presets imported from server.', 'info')
				onSceneRefresh?.()
			} else {
				showScenesToast('Server data did not contain valid look presets.', 'warn')
			}
		} catch (e) {
			showScenesToast(e?.message || 'Import failed', 'error')
		}
	})
	importLookRow.appendChild(importLookBtn)
	root.appendChild(importLookRow)

	const libTitle = document.createElement('div')
	libTitle.className = 'scenes-layer-presets__title'
	libTitle.textContent = 'Library'
	libTitle.style.marginTop = '12px'
	root.appendChild(libTitle)

	const presets = sceneState.getLookPresets()
	if (!presets.length) {
		const empty = document.createElement('p')
		empty.className = 'panel-inspector-mode__placeholder'
		empty.textContent = 'No look presets yet.'
		root.appendChild(empty)
		return
	}

	const list = document.createElement('div')
	list.className = 'look-presets__list'
	for (const p of presets) {
		const sc = sceneState.getScene(p.sceneId)
		const card = document.createElement('div')
		card.className = 'look-preset-card'
		const line1 = document.createElement('div')
		line1.className = 'look-preset-card__row'
		const mainHint =
			typeof p.targetMain === 'number' ? `· main ${(p.targetMain ?? 0) + 1}` : ''
		line1.innerHTML = `<span class="look-preset-card__name"></span>
			<span class="look-preset-card__meta"></span>`
		const nameEl = line1.querySelector('.look-preset-card__name')
		const metaEl = line1.querySelector('.look-preset-card__meta')
		if (nameEl) nameEl.textContent = p.name
		if (metaEl) {
			const src = sourceKindLabel(p.sourceKind)
			metaEl.textContent = sc ? `${src} ${mainHint}` : `${src} ${mainHint} · look missing`
		}
		card.appendChild(line1)
		if (sc) {
			const sub = document.createElement('div')
			sub.className = 'look-preset-card__sub'
			sub.textContent = `→ “${sc.name}”`
			card.appendChild(sub)
		}
		if (!SWITCHER_INTEGRATION_DISABLED) {
			const ph = p.tandem && p.tandem.pixelhue
			const tandemWrap = document.createElement('div')
			tandemWrap.className = 'look-preset-card__tandem'
			const gInput = document.createElement('input')
			gInput.type = 'text'
			gInput.className = 'look-preset-card__tandem-g'
			gInput.placeholder = 'PixelHue preset GUID (optional)'
			gInput.setAttribute('autocomplete', 'off')
			gInput.value = ph && ph.presetId ? String(ph.presetId) : ''
			const ord = document.createElement('select')
			ord.className = 'look-preset-card__tandem-order'
			ord.title = 'When to run PixelFlow preset load vs Caspar (preview / take)'
			ord.innerHTML =
				'<option value="afterCaspar">PixelHue after Caspar (default)</option><option value="beforeCaspar">PixelHue before Caspar</option>'
			ord.value = ph && ph.order === 'beforeCaspar' ? 'beforeCaspar' : 'afterCaspar'
			const saveTandem = () => {
				const g = gInput.value.trim()
				if (!g) {
					if (p.tandem) {
						sceneState.patchLookPreset(p.id, { tandem: null })
						onSceneRefresh?.()
					}
					return
				}
				sceneState.patchLookPreset(p.id, {
					tandem: { pixelhue: { presetId: g, order: ord.value } },
				})
				onSceneRefresh?.()
			}
			gInput.addEventListener('change', saveTandem)
			ord.addEventListener('change', saveTandem)
			tandemWrap.appendChild(gInput)
			tandemWrap.appendChild(ord)
			card.appendChild(tandemWrap)
		}
		const row2 = document.createElement('div')
		row2.className = 'look-preset-card__actions'
		row2.innerHTML = `
			<button type="button" class="scenes-btn scenes-btn--sm" data-lp-r-prv>Preview</button>
			<button type="button" class="scenes-btn scenes-btn--sm" data-lp-r-take>Take</button>
			<button type="button" class="scenes-btn scenes-btn--sm" data-lp-r-cut>Cut</button>
			<button type="button" class="scenes-btn scenes-btn--sm scenes-btn--danger" data-lp-rm>Remove</button>
		`
		if (!sc) {
			for (const b of row2.querySelectorAll('button')) {
				if (b.hasAttribute('data-lp-rm')) continue
				b.disabled = true
			}
		} else {
			row2.querySelector('[data-lp-r-prv]')?.addEventListener('click', () => {
				document.dispatchEvent(
					new CustomEvent(LOOK_PRESET_RECALL_PRV, { detail: { sceneId: p.sceneId, lookPreset: p } }),
				)
			})
			row2.querySelector('[data-lp-r-take]')?.addEventListener('click', () => {
				document.dispatchEvent(
					new CustomEvent(LOOK_PRESET_RECALL_PGM, {
						detail: { sceneId: p.sceneId, lookPreset: p, forceCut: false },
					}),
				)
			})
			row2.querySelector('[data-lp-r-cut]')?.addEventListener('click', () => {
				document.dispatchEvent(
					new CustomEvent(LOOK_PRESET_RECALL_PGM, {
						detail: { sceneId: p.sceneId, lookPreset: p, forceCut: true },
					}),
				)
			})
		}
		row2.querySelector('[data-lp-rm]')?.addEventListener('click', () => {
			if (sceneState.removeLookPreset(p.id)) {
				showScenesToast('Look preset removed.', 'info')
				onSceneRefresh?.()
			}
		})
		list.appendChild(card)
	}
	root.appendChild(list)
}
