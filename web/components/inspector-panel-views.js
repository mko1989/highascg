import { sceneState } from '../lib/scene-state.js'
import { fillToPixelRect, pixelRectToFill, fullFill } from '../lib/fill-math.js'
import { multiviewState } from '../lib/multiview-state.js'
import { getContentResolution } from '../lib/mixer-fill.js'
import { appendSceneLayerFillGroup, appendMultiviewPositionSize } from './inspector-fill.js'
import { appendSceneLayerMixerGroup } from './inspector-mixer.js'
import { renderEffectsGroup } from './inspector-effects.js'
import { renderPipOverlayGroup, renderParamEditor } from './inspector-pip-overlay.js'
import { appendSceneLayerHtmlTemplateGroup } from './inspector-html-template.js'
import { getPipOverlaysFromLayer, PIP_OVERLAY_MAP } from '../lib/pip-overlay-registry.js'
import { showScenesToast } from './scenes-editor-support.js'
import { getThumbnailUrl } from '../lib/thumbnail-url.js'

let activeInteractionAr = null
let activeInteractionTimer = null

/**
 * @param {object} stateStore
 */
export function getResolutionForScreen(stateStore) {
	const state = stateStore.getState()
	const idx = sceneState.activeScreenIndex ?? 0
	const pr = state?.channelMap?.programResolutions?.[idx]
	return pr && pr.w > 0 && pr.h > 0 ? pr : { w: 1920, h: 1080 }
}

/**
 * @param {{
 *   root: HTMLElement,
 *   stateStore: object,
 *   renderEmpty: () => void,
 *   rerenderSceneLayer: (sel: object) => void,
 * }} deps
 */
export function renderSceneLayerInspector(deps, sel) {
	const { root, stateStore, renderEmpty, rerenderSceneLayer } = deps
	const { sceneId, layerIndex } = sel
	const scene = sceneState.getScene(sceneId)
	const layer = scene?.layers?.[layerIndex]
	if (!layer) {
		renderEmpty()
		return
	}
	const res = getResolutionForScreen(stateStore)
	const canvas = sceneState.getCanvasForScreen(sceneState.activeScreenIndex)
	const fill = layer.fill || fullFill()
	const pxRect = fillToPixelRect(fill, canvas)

	root.innerHTML = ''
	const title = document.createElement('div')
	title.className = 'inspector-title'
	title.textContent = `Layer ${layer.layerNumber} (look)`
	root.appendChild(title)

	const canPasteInsp = sceneState.hasLayerStyleClipboard()
	const styleGrp = document.createElement('div')
	styleGrp.className = 'inspector-group inspector-layer-style'
	const styleTitle = document.createElement('div')
	styleTitle.className = 'inspector-group__title'
	styleTitle.textContent = 'Layer style (clipboard)'
	styleGrp.appendChild(styleTitle)
	const clipRow = document.createElement('div')
	clipRow.className = 'inspector-layer-style__row'
	clipRow.innerHTML = `
		<button type="button" class="scenes-btn scenes-btn--sm scenes-btn--icon" data-insp-ls-copy title="Copy position, scale, opacity, keyer, transition" aria-label="Copy layer settings">⎘</button>
		<button type="button" class="scenes-btn scenes-btn--sm scenes-btn--icon" data-insp-ls-paste title="Paste copied settings" aria-label="Paste layer settings" ${canPasteInsp ? '' : 'disabled'}>📋</button>
		<button type="button" class="scenes-btn scenes-btn--sm scenes-btn--icon" data-insp-ls-save title="Save as layer style preset" aria-label="Save as layer style preset">💾</button>
	`
	clipRow.querySelector('[data-insp-ls-copy]')?.addEventListener('click', () => {
		if (sceneState.copyLayerStyle(sceneId, layerIndex)) {
			showScenesToast('Layer settings copied (not source).', 'info')
			const p = clipRow.querySelector('[data-insp-ls-paste]')
			if (p) p.disabled = false
		}
	})
	clipRow.querySelector('[data-insp-ls-paste]')?.addEventListener('click', () => {
		if (sceneState.pasteLayerStyle(sceneId, layerIndex)) {
			showScenesToast('Settings pasted.', 'info')
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
			rerenderSceneLayer(sel)
		}
	})
	clipRow.querySelector('[data-insp-ls-save]')?.addEventListener('click', () => {
		const name = window.prompt('Layer style preset name?')
		if (name == null) return
		if (sceneState.saveLayerPresetFromLayer(sceneId, layerIndex, name)) {
			showScenesToast('Layer preset saved.', 'info')
			rerenderSceneLayer(sel)
		} else {
			showScenesToast('Could not save preset (empty name).', 'warn')
		}
	})
	styleGrp.appendChild(clipRow)
	const lpHint = document.createElement('p')
	lpHint.className = 'inspector-field inspector-field--hint inspector-layer-style__preset-hint'
	lpHint.textContent = 'Named preset library: use the Layer presets tab (header) or the look editor layer strip.'
	styleGrp.appendChild(lpHint)
	root.appendChild(styleGrp)

	renderPlaylistGroup(root, { sceneId, layerIndex, layer, rerenderSceneLayer, sel, stateStore })

	function patchFillPx(partial) {
		const sc = sceneState.getScene(sceneId)
		const L = sc?.layers?.[layerIndex]
		if (!L) return
		const f = L.fill || fullFill()
		const r = fillToPixelRect(f, canvas)
		let next = { x: r.x, y: r.y, w: r.w, h: r.h, ...partial }
		if (L.aspectLocked !== false) {
			const cr = L.source ? getContentResolution(L.source, stateStore, sceneState.activeScreenIndex) : null
			let ar = cr && cr.w > 0 && cr.h > 0 ? cr.w / cr.h : null
			
			if (!ar) {
				if (activeInteractionAr) {
					ar = activeInteractionAr
				} else {
					ar = r.w > 0 && r.h > 0 ? r.w / r.h : 16 / 9
					activeInteractionAr = ar
				}
				if (activeInteractionTimer) clearTimeout(activeInteractionTimer)
				activeInteractionTimer = setTimeout(() => {
					activeInteractionAr = null
					activeInteractionTimer = null
				}, 500)
			}
			
			if (partial.w != null && partial.h == null) {
				next.h = Math.max(1, Math.round(next.w / ar))
			} else if (partial.h != null && partial.w == null) {
				next.w = Math.max(1, Math.round(next.h * ar))
			}
		}
		sceneState.patchLayer(sceneId, layerIndex, { fill: pixelRectToFill(next, canvas) })
		document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
	}

	/**
	 * @param {'left' | 'right' | 'top' | 'bottom' | 'center-h' | 'center-v' | 'center'} mode
	 */
	function patchFillAlign(mode) {
		const sc = sceneState.getScene(sceneId)
		const L = sc?.layers?.[layerIndex]
		if (!L) return
		const f = L.fill || fullFill()
		const sx = f.scaleX ?? 0
		const sy = f.scaleY ?? 0
		let nx = f.x ?? 0
		let ny = f.y ?? 0
		if (mode === 'left') nx = 0
		else if (mode === 'right') nx = 1 - sx
		else if (mode === 'top') ny = 0
		else if (mode === 'bottom') ny = 1 - sy
		else if (mode === 'center-h') nx = (1 - sx) / 2
		else if (mode === 'center-v') ny = (1 - sy) / 2
		else if (mode === 'center') {
			nx = (1 - sx) / 2
			ny = (1 - sy) / 2
		}
		sceneState.patchLayer(sceneId, layerIndex, { fill: { ...f, x: nx, y: ny } })
		document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
	}

	appendSceneLayerFillGroup(root, {
		res,
		pxRect,
		patchFillPx,
		patchFillAlign,
		layer,
		sceneId,
		layerIndex,
		sceneState,
		stateStore,
	})
	appendSceneLayerMixerGroup(root, { sceneId, layerIndex, layer })

	appendSceneLayerHtmlTemplateGroup(root, { sceneState, stateStore, sceneId, layer })

	renderEffectsGroup(root, {
		effects: layer.effects || [],
		onUpdate: (newEffects) => {
			sceneState.patchLayer(sceneId, layerIndex, { effects: newEffects })
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
			rerenderSceneLayer(sel)
		},
	})

	renderPipOverlayGroup(root, {
		pipOverlays: getPipOverlaysFromLayer(layer),
		livePushContext: { sceneState, stateStore, sceneId, layerIndex },
		onUpdate: (next) => {
			sceneState.patchLayer(sceneId, layerIndex, { pipOverlays: next })
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
			// Do not rerenderSceneLayer here: <input type="color"> would unmount on every input and close the native picker.
		},
	})

	const takeGrp = document.createElement('div')
	takeGrp.className = 'inspector-group'
	takeGrp.innerHTML = '<div class="inspector-group__title">Look take (playback)</div>'
	const startWrap = document.createElement('div')
	startWrap.className = 'inspector-field'
	const startLab = document.createElement('label')
	startLab.className = 'inspector-field__label'
	startLab.textContent = 'Start behaviour override'
	const startSel = document.createElement('select')
	startSel.className = 'inspector-field__select'
	startSel.setAttribute('aria-label', 'Override timeline clip start behaviour for this layer')
	startSel.innerHTML =
		'<option value="inherit">Same as timeline clip</option>' +
		'<option value="beginning">Start from beginning (trim)</option>' +
		'<option value="relativeToPrevious">Relative to timeline (layer)</option>'
	const rawSb = layer.startBehaviour
	startSel.value =
		rawSb === 'relativeToPrevious'
			? 'relativeToPrevious'
			: rawSb === 'beginning'
				? 'beginning'
				: 'inherit'
	startSel.addEventListener('change', () => {
		const v = startSel.value
		sceneState.patchLayer(sceneId, layerIndex, {
			startBehaviour: v === 'inherit' ? null : v === 'relativeToPrevious' ? 'relativeToPrevious' : 'beginning',
		})
		document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
	})
	startLab.appendChild(startSel)
	startWrap.appendChild(startLab)
	const startHint = document.createElement('p')
	startHint.className = 'inspector-field inspector-field--hint'
	startHint.style.fontSize = '0.78rem'
	startHint.style.color = 'var(--text-muted)'
	startHint.textContent =
		'Optional: override the timeline clip’s setting for this layer index when taking the look. “Same as timeline” uses the clip inspector value.'
	startWrap.appendChild(startHint)
	takeGrp.appendChild(startWrap)
	root.appendChild(takeGrp)
}

function renderPlaylistGroup(root, { sceneId, layerIndex, layer, rerenderSceneLayer, sel, stateStore }) {
	const grp = document.createElement('div')
	grp.className = 'inspector-group inspector-layer-playlist'
	
	const title = document.createElement('div')
	title.className = 'inspector-group__title'
	title.textContent = 'Layer Playback Mode'
	grp.appendChild(title)

	const row = document.createElement('div')
	row.className = 'inspector-row'
	
	const field = document.createElement('div')
	field.className = 'inspector-field'
	
	const modeSel = document.createElement('select')
	modeSel.className = 'inspector-field__select'
	modeSel.id = 'playlist-source-mode'
	modeSel.innerHTML = `
		<option value="single" ${layer.sourceMode === 'single' ? 'selected' : ''}>1. Single Media (Default)</option>
		<option value="list" ${layer.sourceMode === 'list' ? 'selected' : ''}>2. Playlist Workflow</option>
	`
	modeSel.addEventListener('change', () => {
		const nextMode = modeSel.value
		const patch = { sourceMode: nextMode }
		if (nextMode === 'list' && (!layer.playlist || layer.playlist.length === 0) && layer.source) {
			patch.playlist = [{
				id: `pl_${Date.now()}`,
				type: layer.source.type || 'media',
				value: layer.source.value,
				label: layer.source.label || layer.source.value,
				duration: 5
			}]
		}
		if (nextMode === 'single' && layer.playlist && layer.playlist.length > 0) {
			const item = layer.playlist[0]
			patch.source = { type: item.type, value: item.value, label: item.label }
		}
		sceneState.patchLayer(sceneId, layerIndex, patch)
		document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
		rerenderSceneLayer(sel)
	})
	
	field.appendChild(modeSel)
	row.appendChild(field)
	grp.appendChild(row)

	if (layer.sourceMode === 'list') {
		const listContainer = document.createElement('div')
		listContainer.className = 'playlist-editor-container'
		listContainer.style.marginTop = '10px'
		listContainer.style.padding = '8px'
		listContainer.style.background = 'rgba(0,0,0,0.15)'
		listContainer.style.borderRadius = '6px'
		listContainer.style.border = '1px solid var(--border)'

		const dropzone = document.createElement('div')
		dropzone.className = 'playlist-dropzone'
		dropzone.textContent = 'Drag & Drop Media Here'
		dropzone.style.border = '2px dashed var(--border, #30363d)'
		dropzone.style.background = 'rgba(255,255,255,0.02)'
		dropzone.style.color = 'var(--text-muted)'
		dropzone.style.fontSize = '0.8rem'
		dropzone.style.padding = '16px'
		dropzone.style.textAlign = 'center'
		dropzone.style.borderRadius = '6px'
		dropzone.style.marginBottom = '12px'
		dropzone.style.cursor = 'pointer'
		dropzone.style.transition = 'border-color 0.2s, background-color 0.2s'
		
		dropzone.addEventListener('dragover', (e) => {
			e.preventDefault()
			dropzone.style.borderColor = 'var(--accent, #58a6ff)'
			dropzone.style.backgroundColor = 'rgba(88, 166, 255, 0.05)'
			dropzone.style.color = 'var(--text)'
		})
		dropzone.addEventListener('dragleave', () => {
			dropzone.style.borderColor = 'var(--border, #30363d)'
			dropzone.style.backgroundColor = 'rgba(255,255,255,0.02)'
			dropzone.style.color = 'var(--text-muted)'
		})
		dropzone.addEventListener('drop', (e) => {
			e.preventDefault()
			dropzone.style.borderColor = 'var(--border, #30363d)'
			dropzone.style.backgroundColor = 'rgba(255,255,255,0.02)'
			dropzone.style.color = 'var(--text-muted)'
			let data
			try {
				data = JSON.parse(e.dataTransfer.getData('application/json'))
			} catch {
				const val = e.dataTransfer.getData('text/plain')
				if (val) data = { type: 'media', value: val, label: val }
			}
			if (data && data.value) {
				const isImg = data.kind === 'still' || data.type === 'image' || /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(data.value)
				const newItem = {
					id: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
					type: isImg ? 'image' : (data.type || 'media'),
					value: data.value,
					label: data.label || data.value,
					duration: 5,
				}
				const nextList = [...(layer.playlist || []), newItem]
				const patch = { playlist: nextList }
				if (nextList.length === 1) {
					patch.source = { type: newItem.type, value: newItem.value, label: newItem.label }
				}
				sceneState.patchLayer(sceneId, layerIndex, patch)
				document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
				rerenderSceneLayer(sel)
			}
		})


		// List of items
		const itemsList = document.createElement('div')
		itemsList.className = 'playlist-items-list'
		itemsList.style.display = 'flex'
		itemsList.style.flexDirection = 'column'
		itemsList.style.gap = '4px'
		itemsList.style.marginBottom = '12px'

		let playlistDragFromId = null

		const playlist = layer.playlist || []
		playlist.forEach((item, idx) => {
			const itemRow = document.createElement('div')
			itemRow.className = 'playlist-item-row'
			itemRow.draggable = true
			itemRow.style.display = 'flex'
			itemRow.style.alignItems = 'center'
			itemRow.style.background = 'var(--bg-elevated, #21262d)'
			itemRow.style.border = '1px solid var(--border, #30363d)'
			itemRow.style.borderRadius = '4px'
			itemRow.style.padding = '4px 8px'
			itemRow.style.transition = 'all 0.15s ease'
			
			const isImg = item.type === 'image' || /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(item.value)
			const thumbUrl = getThumbnailUrl(item.value, 80, 2)
			
			itemRow.innerHTML = `
				<span class="playlist-item-drag-handle" style="cursor: grab; color: var(--text-muted); margin-right: 8px; user-select: none;">⋮⋮</span>
				<img src="${thumbUrl}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2224%22><rect width=%22100%%22 height=%22100%%22 fill=%22%23222%22/><text x=%2250%%22 y=%2250%%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23666%22 font-size=%2210%22>${isImg?'🖼️':'🎬'}</text></svg>'" style="width: 32px; height: 20px; object-fit: cover; border-radius: 2px; border: 1px solid var(--border); margin-right: 8px;"/>
				<span class="playlist-item-name" title="${item.label || item.value}" style="font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${item.label || item.value}</span>
				<div style="display: flex; align-items: center; gap: 4px; margin-right: 8px;" title="Duration in seconds (used for static images, or to limit video playback)">
					<input type="number" class="playlist-item-duration" value="${item.duration ?? 5}" min="1" max="3600" style="width: 42px; background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text); border-radius: 3px; font-size: 0.75rem; text-align: center; padding: 1px;"/>
					<span style="font-size: 0.7rem; color: var(--text-muted);">s</span>
				</div>
				<button class="scenes-btn scenes-btn--sm scenes-btn--danger playlist-item-delete" style="padding: 1px 6px; font-size: 0.75rem; line-height: 1;">🗑</button>
			`

			// Setup drag & drop reordering
			itemRow.addEventListener('dragstart', (e) => {
				playlistDragFromId = item.id
				e.dataTransfer.effectAllowed = 'move'
				itemRow.style.opacity = '0.4'
				itemRow.style.borderStyle = 'dashed'
			})
			itemRow.addEventListener('dragend', () => {
				playlistDragFromId = null
				itemRow.style.opacity = '1'
				itemRow.style.borderStyle = 'solid'
			})
			itemRow.addEventListener('dragover', (e) => {
				e.preventDefault()
				if (playlistDragFromId && playlistDragFromId !== item.id) {
					itemRow.style.borderColor = 'var(--accent, #58a6ff)'
					itemRow.style.background = 'rgba(88, 166, 255, 0.05)'
				}
			})
			itemRow.addEventListener('dragleave', () => {
				itemRow.style.borderColor = 'var(--border, #30363d)'
				itemRow.style.background = 'var(--bg-elevated, #21262d)'
			})
			itemRow.addEventListener('drop', (e) => {
				e.preventDefault()
				itemRow.style.borderColor = 'var(--border, #30363d)'
				itemRow.style.background = 'var(--bg-elevated, #21262d)'
				if (playlistDragFromId && playlistDragFromId !== item.id) {
					const list = [...playlist]
					const fromIdx = list.findIndex(x => x.id === playlistDragFromId)
					const toIdx = list.findIndex(x => x.id === item.id)
					if (fromIdx >= 0 && toIdx >= 0) {
						const [moved] = list.splice(fromIdx, 1)
						list.splice(toIdx, 0, moved)
						const patch = { playlist: list }
						if (toIdx === 0 || fromIdx === 0) {
							patch.source = { type: list[0].type, value: list[0].value, label: list[0].label }
						}
						sceneState.patchLayer(sceneId, layerIndex, patch)
						document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
						rerenderSceneLayer(sel)
					}
				}
			})

			// Handle image duration change
			const durInp = itemRow.querySelector('.playlist-item-duration')
			if (durInp) {
				durInp.addEventListener('change', () => {
					const nextDur = Math.max(1, parseInt(durInp.value, 10) || 5)
					const list = playlist.map(x => x.id === item.id ? { ...x, duration: nextDur } : x)
					sceneState.patchLayer(sceneId, layerIndex, { playlist: list })
					document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
				})
			}

			// Handle delete
			const delBtn = itemRow.querySelector('.playlist-item-delete')
			delBtn.addEventListener('click', (e) => {
				e.stopPropagation()
				const list = playlist.filter(x => x.id !== item.id)
				const patch = { playlist: list }
				if (list.length > 0) {
					patch.source = { type: list[0].type, value: list[0].value, label: list[0].label }
				} else {
					patch.source = null
				}
				sceneState.patchLayer(sceneId, layerIndex, patch)
				document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
				rerenderSceneLayer(sel)
			})

			itemsList.appendChild(itemRow)
		})
		listContainer.appendChild(itemsList)
		listContainer.appendChild(dropzone)

		// Settings group
		const settingsBlock = document.createElement('div')
		settingsBlock.className = 'playlist-global-settings'
		settingsBlock.style.borderTop = '1px solid var(--border)'
		settingsBlock.style.paddingTop = '8px'
		settingsBlock.innerHTML = `
			<div class="inspector-group__title" style="font-size: 0.65rem; margin-bottom: 8px;">Playlist Settings</div>
			
			<div class="inspector-row" style="margin-bottom: 8px;">
				<div class="inspector-field" style="flex: 1;">
					<label class="inspector-field__label" style="cursor: default;">Advance Mode</label>
					<select class="inspector-field__select" id="playlist-advance">
						<option value="auto" ${layer.playlistAdvance === 'auto' ? 'selected' : ''}>Auto Advance</option>
						<option value="manual" ${layer.playlistAdvance === 'manual' ? 'selected' : ''}>Manual Next</option>
					</select>
				</div>
				<div class="inspector-field" style="display: flex; align-items: center; margin-top: 18px; max-width: 90px;">
					<label class="inspector-field__label" style="cursor: pointer; display: flex; align-items: center; gap: 4px;">
						<input type="checkbox" id="playlist-loop" ${layer.playlistLoop !== false ? 'checked' : ''} style="margin: 0;"/>
						Loop List
					</label>
				</div>
			</div>

			<div class="inspector-row">
				<div class="inspector-field" style="flex: 1;">
					<label class="inspector-field__label" style="cursor: default;">Transition Type</label>
					<select class="inspector-field__select" id="playlist-trans-type">
						<option value="MIX" ${(layer.playlistTransition?.type ?? 'MIX') === 'MIX' ? 'selected' : ''}>MIX (Dissolve)</option>
						<option value="CUT" ${(layer.playlistTransition?.type ?? 'MIX') === 'CUT' ? 'selected' : ''}>CUT (None)</option>
						<option value="SLIDE" ${(layer.playlistTransition?.type ?? 'MIX') === 'SLIDE' ? 'selected' : ''}>SLIDE</option>
						<option value="WIPE" ${(layer.playlistTransition?.type ?? 'MIX') === 'WIPE' ? 'selected' : ''}>WIPE</option>
					</select>
				</div>
				<div class="inspector-field" style="flex: 1;">
					<label class="inspector-field__label" style="cursor: default;">Transition Frames</label>
					<input type="number" class="inspector-field__input" id="playlist-trans-frames" value="${layer.playlistTransition?.duration ?? 12}" min="0" max="250" style="max-width: 100%;"/>
				</div>
			</div>
		`

		// Attach settings events
		const advSel = settingsBlock.querySelector('#playlist-advance')
		advSel.addEventListener('change', () => {
			sceneState.patchLayer(sceneId, layerIndex, { playlistAdvance: advSel.value })
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
		})

		const loopCb = settingsBlock.querySelector('#playlist-loop')
		loopCb.addEventListener('change', () => {
			sceneState.patchLayer(sceneId, layerIndex, { playlistLoop: loopCb.checked })
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
		})

		const transSel = settingsBlock.querySelector('#playlist-trans-type')
		transSel.addEventListener('change', () => {
			const pt = layer.playlistTransition || { type: 'MIX', duration: 12, tween: 'linear' }
			sceneState.patchLayer(sceneId, layerIndex, { playlistTransition: { ...pt, type: transSel.value } })
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
		})

		const transDur = settingsBlock.querySelector('#playlist-trans-frames')
		transDur.addEventListener('change', () => {
			const pt = layer.playlistTransition || { type: 'MIX', duration: 12, tween: 'linear' }
			sceneState.patchLayer(sceneId, layerIndex, { playlistTransition: { ...pt, duration: Math.max(0, parseInt(transDur.value, 10) || 0) } })
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
		})

		listContainer.appendChild(settingsBlock)
		grp.appendChild(listContainer)
	}

	root.appendChild(grp)
}

/**
 * @param {{
 *   root: HTMLElement,
 *   renderEmpty: () => void,
 * }} deps
 */
export function renderMultiviewInspector(deps, cellId) {
	const { root, renderEmpty } = deps
	const cell = multiviewState.getCell(cellId)
	if (!cell) { renderEmpty(); return }
	root.innerHTML = ''
	const title = document.createElement('div')
	title.className = 'inspector-title'
	title.textContent = cell.label || cell.id
	root.appendChild(title)
	appendMultiviewPositionSize(root, { cellId, cell })
}

export function renderSceneInspector(root, sceneId) {
	const scene = sceneState.getScene(sceneId)
	if (!scene) {
		root.innerHTML = '<p class="inspector-empty">Select a scene</p>'
		return
	}
	root.innerHTML = ''
	const title = document.createElement('div')
	title.className = 'inspector-title'
	title.textContent = `Look: ${scene.name}`
	root.appendChild(title)

}

export function renderGlobalBorderInspector(root, screenIndex, stateStore) {
	root.innerHTML = ''
	const title = document.createElement('div')
	title.className = 'inspector-title'
	title.textContent = `Global Border: Screen ${screenIndex + 1}`
	root.appendChild(title)

	const gbNow = () => sceneState.getGlobalBorderForScreen(screenIndex)
	const gb = gbNow()

	const borderGrp = document.createElement('div')
	borderGrp.className = 'inspector-group'
	borderGrp.innerHTML = '<div class="inspector-group__title">Global Border Effect</div>'
	
	const typeWrap = document.createElement('div')
	typeWrap.className = 'inspector-field'
	const typeLab = document.createElement('label')
	typeLab.className = 'inspector-field__label'
	typeLab.textContent = 'Type'
	const typeSel = document.createElement('select')
	typeSel.className = 'inspector-field__select'
	const types = ['border', 'shadow', 'edge_strip', 'glow']
	types.forEach(t => {
		const opt = document.createElement('option')
		opt.value = t
		opt.textContent = t
		if (t === gb.type) opt.selected = true
		typeSel.appendChild(opt)
	})
	typeSel.addEventListener('change', () => {
		sceneState.setGlobalBorderForScreen(screenIndex, { type: typeSel.value })
		renderGlobalBorderInspector(root, screenIndex, stateStore)
	})
	typeLab.appendChild(typeSel)
	typeWrap.appendChild(typeLab)
	borderGrp.appendChild(typeWrap)

	const fadeWrap = document.createElement('div')
	fadeWrap.className = 'inspector-field'
	const fadeLab = document.createElement('label')
	fadeLab.className = 'inspector-field__label'
	fadeLab.textContent = 'Fade Duration (frames)'
	const fadeInp = document.createElement('input')
	fadeInp.type = 'number'
	fadeInp.className = 'inspector-field__input'
	fadeInp.style.width = '60px'
	fadeInp.min = 0
	fadeInp.max = 250
	fadeInp.value = gb.fadeDuration ?? 25
	fadeInp.addEventListener('change', () => {
		const val = parseInt(fadeInp.value, 10)
		sceneState.setGlobalBorderForScreen(screenIndex, { fadeDuration: isNaN(val) ? 25 : val })
	})
	fadeLab.appendChild(fadeInp)
	fadeWrap.appendChild(fadeLab)
	borderGrp.appendChild(fadeWrap)

	const mirrorWrap = document.createElement('div')
	mirrorWrap.className = 'inspector-field'
	const mirrorLab = document.createElement('label')
	mirrorLab.className = 'inspector-field__label'
	mirrorLab.style.display = 'flex'
	mirrorLab.style.alignItems = 'center'
	mirrorLab.style.gap = '8px'
	const mirrorChk = document.createElement('input')
	mirrorChk.type = 'checkbox'
	mirrorChk.checked = gb.mirrorBorderOnPrv === true
	mirrorChk.addEventListener('change', () => {
		sceneState.setGlobalBorderForScreen(screenIndex, { mirrorBorderOnPrv: mirrorChk.checked })
		renderGlobalBorderInspector(root, screenIndex, stateStore)
	})
	const prvCh = stateStore?.getState?.()?.channelMap?.previewChannels?.[screenIndex]
	const mirrorTxt = document.createElement('span')
	mirrorTxt.textContent = prvCh
		? `PRV on ch ${prvCh} — border controls update layer 997 only (PGM 998/996 unchanged until this is off)`
		: 'PRV on preview bus — layer 997 (no PRV channel mapped for this screen)'
	mirrorLab.appendChild(mirrorChk)
	mirrorLab.appendChild(mirrorTxt)
	mirrorWrap.appendChild(mirrorLab)
	borderGrp.appendChild(mirrorWrap)

	const def = PIP_OVERLAY_MAP.get(gb.type)
	if (def) {
		const paramsBlock = document.createElement('div')
		paramsBlock.className = 'inspector-effect-card__params'
		for (const schema of def.schema) {
			if (schema.key === 'side') continue
			
			const curVal = gb.params?.[schema.key] ?? schema.default
			renderParamEditor(paramsBlock, schema, curVal, (newVal) => {
				const cur = gbNow()
				sceneState.setGlobalBorderForScreen(screenIndex, {
					params: { ...cur.params, [schema.key]: newVal, side: 'inside' }
				})
			})
		}
		borderGrp.appendChild(paramsBlock)
	}
	root.appendChild(borderGrp)

	const presetGrp = document.createElement('div')
	presetGrp.className = 'inspector-group'
	presetGrp.innerHTML = '<div class="inspector-group__title">Border presets (PGM layers 998 ↔ 996)</div>'
	const slotCount = sceneState.getGlobalBorderPresetSlotCount(screenIndex)
	const presetRows = document.createElement('div')
	presetRows.style.display = 'flex'
	presetRows.style.flexDirection = 'column'
	presetRows.style.gap = '6px'
	for (let s = 1; s <= slotCount; s++) {
		const row = document.createElement('div')
		row.style.display = 'flex'
		row.style.flexWrap = 'wrap'
		row.style.alignItems = 'center'
		row.style.gap = '8px'
		const preset = sceneState.getGlobalBorderPreset(screenIndex, s)
		const lab = document.createElement('span')
		lab.style.minWidth = '120px'
		lab.style.fontSize = '0.85rem'
		lab.textContent = preset ? `${s}. ${preset.name}` : `${s}. —`
		const recallBtn = Object.assign(document.createElement('button'), {
			type: 'button',
			className: 'scenes-btn scenes-btn--sm',
			textContent: 'Recall',
			disabled: !preset,
		})
		recallBtn.addEventListener('click', () => {
			if (!preset) return
			window.dispatchEvent(
				new CustomEvent('highascg-border-preset-recall', { detail: { screenIndex, slot: s } }),
			)
			showScenesToast('Preset recall sent to program border stack.', 'info')
		})
		const saveBtn = Object.assign(document.createElement('button'), {
			type: 'button',
			className: 'scenes-btn scenes-btn--sm',
			textContent: 'Save',
		})
		saveBtn.addEventListener('click', () => {
			const nm = window.prompt('Preset name?', preset?.name || `Preset ${s}`)
			if (nm === null) return
			sceneState.saveGlobalBorderPresetSlot(screenIndex, s, nm)
			showScenesToast(`Saved border preset ${s}.`, 'info')
			renderGlobalBorderInspector(root, screenIndex, stateStore)
		})
		row.appendChild(lab)
		row.appendChild(recallBtn)
		row.appendChild(saveBtn)
		if (preset) {
			const delBtn = Object.assign(document.createElement('button'), {
				type: 'button',
				className: 'scenes-btn scenes-btn--sm scenes-btn--danger',
				textContent: 'Delete',
			})
			delBtn.addEventListener('click', () => {
				if (!window.confirm(`Delete preset ${s} (${preset.name})?`)) return
				sceneState.deleteGlobalBorderPresetSlot(screenIndex, s)
				showScenesToast('Preset removed.', 'info')
				renderGlobalBorderInspector(root, screenIndex, stateStore)
			})
			row.appendChild(delBtn)
		}
		presetRows.appendChild(row)
	}
	presetGrp.appendChild(presetRows)
	root.appendChild(presetGrp)

	const slicesGrp = document.createElement('div')
	slicesGrp.className = 'inspector-group'
	slicesGrp.innerHTML = '<div class="inspector-group__title">Slices (Multi-segment physical layout)</div>'
	const slicesBody = document.createElement('div')
	slicesBody.className = 'inspector-effect-card__params'
	slicesBody.style.display = 'flex'
	slicesBody.style.flexDirection = 'column'
	slicesBody.style.gap = '10px'

	const slices = gb.slices || []
	const res = getResolutionForScreen(stateStore)

	if (slices.length === 0) {
		const empty = document.createElement('div')
		empty.className = 'inspector-field inspector-field--hint'
		empty.textContent = 'No slices defined. Defaulting to full canvas (0,0 100×100).'
		slicesBody.appendChild(empty)
	}

	slices.forEach((s, idx) => {
		const row = document.createElement('div')
		row.className = 'inspector-slice-row'
		row.style.display = 'flex'
		row.style.alignItems = 'center'
		row.style.gap = '6px'
		row.style.background = 'rgba(255,255,255,0.03)'
		row.style.padding = '6px'
		row.style.borderRadius = '4px'

		const createInput = (key, label, val, maxRes) => {
			const w = document.createElement('div')
			w.style.display = 'flex'
			w.style.flexDirection = 'column'
			w.style.gap = '2px'
			const l = document.createElement('label')
			l.style.fontSize = '0.65rem'
			l.style.color = 'var(--text-muted)'
			l.textContent = label
			const i = document.createElement('input')
			i.type = 'number'
			i.className = 'inspector-field__input'
			i.style.width = '52px'
			i.style.padding = '2px 4px'
			i.min = 0
			i.max = maxRes
			i.value = Math.round(val * maxRes)
			i.addEventListener('change', () => {
				const currentSlices = sceneState.getGlobalBorderForScreen(screenIndex).slices || []
				const next = [...currentSlices]
				if (next[idx]) {
					next[idx] = { ...next[idx], [key]: Math.max(0, Math.min(maxRes, parseFloat(i.value) || 0)) / maxRes }
					sceneState.setGlobalBorderForScreen(screenIndex, { slices: next })
				}
			})
			w.appendChild(l)
			w.appendChild(i)
			return w
		}

		row.appendChild(createInput('x', 'X(px)', s.x ?? 0, res.w))
		row.appendChild(createInput('y', 'Y(px)', s.y ?? 0, res.h))
		row.appendChild(createInput('w', 'W(px)', s.w ?? 1, res.w))
		row.appendChild(createInput('h', 'H(px)', s.h ?? 1, res.h))

		const del = document.createElement('button')
		del.type = 'button'
		del.className = 'scenes-btn scenes-btn--sm scenes-btn--danger'
		del.style.marginLeft = 'auto'
		del.style.padding = '2px 6px'
		del.textContent = '×'
		del.title = 'Remove slice'
		del.addEventListener('click', () => {
			const currentSlices = sceneState.getGlobalBorderForScreen(screenIndex).slices || []
			const next = currentSlices.filter((_, i) => i !== idx)
			sceneState.setGlobalBorderForScreen(screenIndex, { slices: next })
			renderGlobalBorderInspector(root, screenIndex, stateStore)
		})
		row.appendChild(del)
		slicesBody.appendChild(row)
	})

	const sliceBtns = document.createElement('div')
	sliceBtns.style.display = 'flex'
	sliceBtns.style.gap = '8px'
	sliceBtns.style.marginTop = '4px'

	const addBtn = document.createElement('button')
	addBtn.type = 'button'
	addBtn.className = 'scenes-btn scenes-btn--sm'
	addBtn.textContent = '+ Add Slice'
	addBtn.addEventListener('click', () => {
		const currentSlices = sceneState.getGlobalBorderForScreen(screenIndex).slices || []
		// Default to half-width, full-height
		const next = [...currentSlices, { x: 0, y: 0, w: 0.5, h: 1 }]
		sceneState.setGlobalBorderForScreen(screenIndex, { slices: next })
		renderGlobalBorderInspector(root, screenIndex, stateStore)
	})

	const fullBtn = document.createElement('button')
	fullBtn.type = 'button'
	fullBtn.className = 'scenes-btn scenes-btn--sm'
	fullBtn.textContent = 'Full Canvas'
	fullBtn.title = 'Reset to full screen border'
	fullBtn.addEventListener('click', () => {
		sceneState.setGlobalBorderForScreen(screenIndex, { slices: [] })
		renderGlobalBorderInspector(root, screenIndex, stateStore)
	})

	sliceBtns.appendChild(addBtn)
	sliceBtns.appendChild(fullBtn)
	slicesBody.appendChild(sliceBtns)

	slicesGrp.appendChild(slicesBody)
	root.appendChild(slicesGrp)

	const patchGrp = document.createElement('div')
	patchGrp.className = 'inspector-group'
	patchGrp.innerHTML = '<div class="inspector-group__title">Art-Net Patch</div>'
	
	const patchBlock = document.createElement('div')
	patchBlock.className = 'inspector-effect-card__params'
	
	const scWrap = document.createElement('div')
	scWrap.className = 'inspector-field'
	const scLab = document.createElement('label')
	scLab.className = 'inspector-field__label'
	scLab.textContent = 'Start Channel'
	const scInp = document.createElement('input')
	scInp.type = 'number'
	scInp.className = 'inspector-field__input'
	scInp.style.width = '60px'
	scInp.min = 1
	scInp.max = 512
	scInp.value = gb.artnetPatch?.startChannel || 1
	scInp.addEventListener('change', () => {
		const val = parseInt(scInp.value, 10)
		const cur = gbNow()
		sceneState.setGlobalBorderForScreen(screenIndex, {
			artnetPatch: { ...cur.artnetPatch, startChannel: isNaN(val) ? 1 : val }
		})
		renderGlobalBorderInspector(root, screenIndex, stateStore)
	})
	scLab.appendChild(scInp)
	scWrap.appendChild(scLab)
	patchBlock.appendChild(scWrap)

	const uniWrap = document.createElement('div')
	uniWrap.className = 'inspector-field'
	const uniLab = document.createElement('label')
	uniLab.className = 'inspector-field__label'
	uniLab.textContent = 'Universe'
	const uniInp = document.createElement('input')
	uniInp.type = 'number'
	uniInp.className = 'inspector-field__input'
	uniInp.style.width = '60px'
	uniInp.min = 0
	uniInp.max = 16
	uniInp.value = gb.artnetPatch?.universe || 0
	uniInp.addEventListener('change', () => {
		const val = parseInt(uniInp.value, 10)
		const cur = gbNow()
		sceneState.setGlobalBorderForScreen(screenIndex, {
			artnetPatch: { ...cur.artnetPatch, universe: isNaN(val) ? 0 : val }
		})
	})
	uniLab.appendChild(uniInp)
	uniWrap.appendChild(uniLab)
	patchBlock.appendChild(uniWrap)

	const start = gb.artnetPatch?.startChannel || 1
	const mapping = [
		{ label: 'On/Off', ch: start },
		{ label: 'Effect Type', ch: start + 1 },
		{ label: 'Opacity', ch: start + 2 },
		{ label: 'Color (RGB)', ch: `${start + 3} - ${start + 5}` },
		{ label: 'Width / Thickness', ch: start + 6 },
		{ label: 'Speed', ch: start + 7 },
		{ label: 'Spread / Blur', ch: start + 8 },
		{ label: 'Glow Color (RGB)', ch: `${start + 9} - ${start + 11}` },
		{ label: 'Radius', ch: start + 12 },
		{ label: 'Count (edge strip)', ch: start + 13 },
		{ label: 'Length (edge strip)', ch: start + 14 },
		{ label: 'Segments / edge (glow/shadow)', ch: start + 15 },
		{ label: 'Segment ease (glow/shadow)', ch: start + 16 },
		{ label: 'Segmentation mode (glow/shadow)', ch: start + 17 },
	]

	const table = document.createElement('table')
	table.className = 'inspector-mapping-table'
	table.style.width = '100%'
	table.style.marginTop = '10px'
	table.style.fontSize = '0.8rem'
	table.style.borderCollapse = 'collapse'
	
	table.innerHTML = `
		<thead>
			<tr style="text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1);">
				<th style="padding: 4px;">Parameter</th>
				<th style="padding: 4px;">Channel</th>
			</tr>
		</thead>
		<tbody>
			${mapping.map(m => `
				<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
					<td style="padding: 4px;">${m.label}</td>
					<td style="padding: 4px;">${m.ch}</td>
				</tr>
			`).join('')}
		</tbody>
	`
	patchBlock.appendChild(table)
	
	const dlLink = document.createElement('a')
	dlLink.href = '/fixtures/global-border.txt'
	dlLink.download = 'global-border.txt'
	dlLink.textContent = 'Download Fixture File'
	dlLink.style.display = 'block'
	dlLink.style.marginTop = '15px'
	dlLink.style.color = '#38bdf8'
	dlLink.style.textDecoration = 'none'
	dlLink.style.fontSize = '0.85rem'
	dlLink.style.fontWeight = 'bold'
	patchBlock.appendChild(dlLink)
	
	patchGrp.appendChild(patchBlock)
	root.appendChild(patchGrp)
}
