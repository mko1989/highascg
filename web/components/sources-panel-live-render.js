import { api } from '../lib/api-client.js'
import { sceneState } from '../lib/scene-state.js'
import { buildLiveSources, decklinkSlotStatusMessage, escapeHtml, makeDraggable } from './sources-panel-helpers.js'
import { getLiveThumbnailChannelForSource } from '../lib/thumbnail-url.js'

export function renderLiveTab(listEl, { channelMap, decklinkInputsStatus, extraSources = [], connectors = [] }) {
	const base = buildLiveSources(channelMap, connectors)
	const existing = new Set(base.map((s) => String(s.value || '')))
	const extras = Array.isArray(extraSources) ? extraSources.filter((s) => s && s.value && !existing.has(String(s.value))) : []
	const sources = [...extras, ...base]

	const renderKey = JSON.stringify({
		sources: sources.map(s => ({ value: s.value, label: s.label, res: s.resolution })),
		status: decklinkInputsStatus
	})
	if (listEl._lastRenderKey === renderKey) return
	listEl._lastRenderKey = renderKey

	listEl.innerHTML = ''
	if (!sources.length) { listEl.innerHTML = '<p class="sources-empty">No live sources</p>'; return }
	const hintParts = []
	if (sources.some(s => s.routeType === 'decklink')) hintParts.push('DeckLink tiles match Settings. Use Stop to clear layer.')
	if (sources.some(s => s.routeType === 'layer')) hintParts.push('Layer routes: Looks row ↗ (Shift+↗ = PGM bus, Ctrl+↗ = PRV). Drag onto another layer.')
	if (hintParts.length) listEl.innerHTML = `<p class="sources-live-hint">${hintParts.join(' ')}</p>`
	sources.forEach(s => {
		const el = document.createElement('div')
		
		const metaItems = [s.resolution, s.fps ? `${s.fps} fps` : '']
		if (s.type === 'ndi') {
			metaItems.push(s.useDirect ? 'Direct' : 'Routed')
		}
		if (s.type === 'browser' && s.browserAsCg) {
			metaItems.push('CG template')
		}
		const meta = metaItems.filter(Boolean).join(' · ')
		
		const slotMsg = (s.routeType === 'decklink' && s.decklinkSlot != null) ? decklinkSlotStatusMessage(decklinkInputsStatus, s.decklinkSlot) : ''
		
		const ch = getLiveThumbnailChannelForSource(s)
		let thumbHtml = ''
		let thumbControls = ''
		if (ch > 0) {
			const thumbUrl = `/api/thumbnail/live/${ch}?v=${Date.now()}`
			thumbHtml = `<div class="source-item__thumbnail source-item__thumbnail--live" style="position: relative; width: 32px; height: 32px; flex-shrink: 0; background: #151520; border: 1px solid #333; border-radius: 3px; display: flex; align-items: center; justify-content: center; overflow: hidden;" title="Custom thumbnail / manual capture">
				<img class="source-item__live-img" src="${thumbUrl}" onerror="this.style.display='none'; if(!this.parentElement.querySelector('svg')){this.parentElement.insertAdjacentHTML('afterbegin', '<svg class=\\'source-item__live-svg-fallback\\' width=\\'14\\' height=\\'14\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'#666\\' stroke-width=\\'2\\' stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\'><rect x=\\'2\\' y=\\'3\\' width=\\'20\\' height=\\'14\\' rx=\\'2\\' ry=\\'2\\'></rect><line x1=\\'8\\' y1=\\'21\\' x2=\\'16\\' y2=\\'21\\'></line><line x1=\\'12\\' y1=\\'17\\' x2=\\'12\\' y2=\\'21\\'></line></svg>')}" style="width: 100%; height: 100%; object-fit: cover;" />
			</div>`
			thumbControls = `
				<div class="source-item__thumb-controls" style="display: flex; gap: 4px; margin-top: 4px;">
					<button type="button" class="source-item__live-btn source-item__live-btn--capture" style="display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; background: #2a2a3e; border: 1px solid #444; color: #ccc; border-radius: 3px; cursor: pointer; transition: all 0.2s;" title="Capture still frame from CasparCG channel ${ch}">
						<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
					</button>
					<button type="button" class="source-item__live-btn source-item__live-btn--upload" style="display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; background: #2a2a3e; border: 1px solid #444; color: #ccc; border-radius: 3px; cursor: pointer; transition: all 0.2s;" title="Upload custom thumbnail for channel ${ch}">
						<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
					</button>
					<input type="file" class="source-item__live-file-input" accept="image/png, image/jpeg" style="display: none;" />
				</div>
			`
		} else {
			thumbHtml = `<div class="source-item__thumbnail" style="position: relative; width: 32px; height: 32px; flex-shrink: 0; background: #151520; border: 1px solid #333; border-radius: 3px; display: flex; align-items: center; justify-content: center; overflow: hidden;">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
			</div>`
		}

		el.style.display = 'flex'
		el.style.alignItems = 'center'
		el.style.gap = '8px'
		el.style.padding = '4px 8px'
		el.className = 'source-item source-item--live source-item--live-stacked source-item--media-detailed'
		el.dataset.sourceValue = s.value

		el.innerHTML = `
			${thumbHtml}
			<div class="source-item__live-col" style="flex: 1; display: flex; flex-direction: column; min-width: 0;">
				<div class="source-item__live-line1" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
					<span class="source-item__label" style="font-weight: 500; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px;" title="${escapeHtml(s.label)}">${escapeHtml(s.label)}</span>
				</div>
				${meta ? `<div class="source-item__live-line2" style="font-size: 11px; color: #888; margin-top: 1px;">${escapeHtml(meta)}</div>` : ''}
				${slotMsg ? `<div class="source-item__live-line3 source-item__live-line3--warn" style="font-size: 11px; color: #e0a020; margin-top: 1px;" title="${escapeHtml(slotMsg)}">${escapeHtml(slotMsg)}</div>` : ''}
				${thumbControls}
			</div>
		`

		if (ch > 0) {
			const captureBtn = el.querySelector('.source-item__live-btn--capture')
			const uploadBtn = el.querySelector('.source-item__live-btn--upload')
			const fileInput = el.querySelector('.source-item__live-file-input')
			const imgEl = el.querySelector('.source-item__live-img')
			const thumbContainer = el.querySelector('.source-item__thumbnail--live')

			if (captureBtn) {
				captureBtn.onclick = async (e) => {
					e.stopPropagation()
					captureBtn.disabled = true
					captureBtn.style.opacity = '0.4'
					try {
						await api.post('/api/thumbnail/live/capture', { channel: ch, force: true })
						const bust = Date.now()
						if (imgEl) {
							imgEl.style.display = 'block'
							imgEl.src = `/api/thumbnail/live/${ch}?v=${bust}`
							const fallbackIcon = thumbContainer.querySelector('.source-item__live-svg-fallback')
							if (fallbackIcon) fallbackIcon.remove()
						}
						const { invalidateThumbnailCache } = await import('./preview-canvas-draw-base.js')
						invalidateThumbnailCache(`/api/thumbnail/live/${ch}`)
					} catch (err) {
						alert(err?.message || 'Failed to capture live thumbnail')
					} finally {
						captureBtn.disabled = false
						captureBtn.style.opacity = '1'
					}
				}
			}

			if (uploadBtn) {
				uploadBtn.onclick = (e) => {
					e.stopPropagation()
					fileInput.click()
				}
			}

			if (fileInput) {
				fileInput.onchange = async (e) => {
					e.stopPropagation()
					const file = fileInput.files[0]
					if (!file) return

					uploadBtn.disabled = true
					uploadBtn.style.opacity = '0.4'
					try {
						const url = `${api.getApiBase()}/api/thumbnail/live/upload?channel=${ch}`
						const response = await fetch(url, {
							method: 'POST',
							headers: {
								'Content-Type': file.type || 'image/png'
							},
							body: file
						})

						if (!response.ok) {
							const errJson = await response.json().catch(() => ({}))
							throw new Error(errJson.error || `HTTP ${response.status}`)
						}

						const bust = Date.now()
						if (imgEl) {
							imgEl.style.display = 'block'
							imgEl.src = `/api/thumbnail/live/${ch}?v=${bust}`
							const fallbackIcon = thumbContainer.querySelector('.source-item__live-svg-fallback')
							if (fallbackIcon) fallbackIcon.remove()
						}
						const { invalidateThumbnailCache } = await import('./preview-canvas-draw-base.js')
						invalidateThumbnailCache(`/api/thumbnail/live/${ch}`)
					} catch (err) {
						alert(err?.message || 'Failed to upload custom thumbnail')
					} finally {
						uploadBtn.disabled = false
						uploadBtn.style.opacity = '1'
						fileInput.value = ''
					}
				}
			}
		}

		const dragExtra = { resolution: s.resolution, fps: s.fps, routeType: s.routeType, screenIdx: s.screenIdx }
		const skipThumbHint = s.type === 'ndi' && s.useDirect === true
		if (
			!skipThumbHint &&
			s.thumbnailChannel != null &&
			Number.isFinite(Number(s.thumbnailChannel)) &&
			Number(s.thumbnailChannel) > 0
		) {
			dragExtra.thumbnailChannel = Number(s.thumbnailChannel)
		}
		if (s.useDirect != null) dragExtra.useDirect = s.useDirect
		if (s.browserAsCg === true) dragExtra.browserAsCg = true
		makeDraggable(el, s.type, s.value, s.label, dragExtra)
		
		if (s.value && s.value.includes('playback_timers.html')) {
			el.style.cursor = 'pointer'
			el.addEventListener('click', () => {
				const screenIdx = sceneState.activeScreenIndex ?? 0
				const sceneId = sceneState.previewSceneIdByMain[screenIdx] || sceneState.previewSceneId
				const scene = sceneState.getScene(sceneId)
				if (scene && Array.isArray(scene.layers)) {
					const idx = scene.layers.findIndex(l => l.source && l.source.value && l.source.value.includes('playback_timers.html'))
					if (idx >= 0) {
						window.dispatchEvent(new CustomEvent('scene-layer-select', {
							detail: {
								sceneId,
								layerIndex: idx,
								layer: scene.layers[idx]
							}
						}))
					} else {
						// Help user understand they need to add it to a look first
						const lookName = scene.name || `Look (ID: ${sceneId})`
						alert(`"System Timers Template" is not currently assigned to any layer in the active preview ${lookName}.\n\nPlease drag it onto a Look layer first, then click this tile to inspect and configure its sizes and options!`)
					}
				}
			})
		}
		
		if (s.routeType === 'decklink' && s.inputsChannel != null && s.decklinkSlot != null) {
			const cl = `${s.inputsChannel}-${s.decklinkSlot}`
			const btnGroup = document.createElement('div'); btnGroup.className = 'source-item__live-actions'
			
			const restartBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'source-item__live-btn source-item__live-btn--restart', title: `Restart ${cl}`, textContent: 'Restart' })
			restartBtn.onclick = async (e) => {
				e.stopPropagation(); restartBtn.disabled = true; try {
					await api.post('/api/raw', { cmd: `STOP ${cl}` }); await api.post('/api/raw', { cmd: `MIXER ${cl} CLEAR` })
					if (s.decklinkDevice != null) await api.post('/api/raw', { cmd: `PLAY ${cl} DECKLINK ${s.decklinkDevice}` })
				} finally { restartBtn.disabled = false }
			}
			
			const stopBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'source-item__live-btn source-item__live-btn--stop', title: `Stop ${cl}`, textContent: 'Stop' })
			stopBtn.onclick = async (e) => { e.stopPropagation(); stopBtn.disabled = true; try { await api.post('/api/raw', { cmd: `STOP ${cl}` }); await api.post('/api/raw', { cmd: `MIXER ${cl} CLEAR` }) } finally { stopBtn.disabled = false } }
			
			btnGroup.append(restartBtn, stopBtn)
			
			if (s.connectorId) {
				const removeBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'source-item__live-btn source-item__live-btn--remove', title: `Remove from Live tab and revert connector role`, textContent: 'Remove' })
					removeBtn.onclick = async (e) => {
					e.stopPropagation(); if (!confirm(`Remove "${s.label}"? This will revert the SDI connector back to output role.`)) return
					removeBtn.disabled = true; try {
						await api.post('/api/raw', { cmd: `STOP ${cl}` }); await api.post('/api/raw', { cmd: `MIXER ${cl} CLEAR` })
						await api.post('/api/device-view', { updateConnector: { id: s.connectorId, patch: { caspar: { ioDirection: 'out' } } } })
						const rm = await api.post('/api/device-view', { removeExtraLiveSource: { value: s.value } })
						if (Array.isArray(rm?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
							window.__highascgApplyExtraLiveSources(rm.extraLiveSources)
						}
					} finally { removeBtn.disabled = false }
				}
				btnGroup.appendChild(removeBtn)
			}
			
			el.appendChild(btnGroup)
		} else if (s.type === 'ndi' || s.type === 'browser' || s.routeType === 'layer') {
			const btnGroup = document.createElement('div'); btnGroup.className = 'source-item__live-actions'
			const removeBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'source-item__live-btn source-item__live-btn--remove', title: `Remove from Live tab`, textContent: 'Remove' })
			removeBtn.onclick = async (e) => {
				const typeLabel =
					s.routeType === 'layer' ? 'layer route' : s.type === 'ndi' ? 'NDI source' : 'browser source'
				e.stopPropagation(); if (!confirm(`Remove ${typeLabel} "${s.label}"?`)) return
				removeBtn.disabled = true; try {
					const rm = await api.post('/api/device-view', { removeExtraLiveSource: { value: s.value } })
					if (Array.isArray(rm?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
						window.__highascgApplyExtraLiveSources(rm.extraLiveSources)
					}
				} finally { removeBtn.disabled = false }
			}
			btnGroup.appendChild(removeBtn)
			el.appendChild(btnGroup)
		}
		
		listEl.appendChild(el)
	})
}
