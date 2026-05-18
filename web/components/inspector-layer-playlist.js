import { sceneState } from '../lib/scene-state.js'
import { getThumbnailUrl } from '../lib/thumbnail-url.js'

export function renderLayerPlaylistGroup(root, { sceneId, layerIndex, layer, rerenderSceneLayer, sel, stateStore }) {
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
