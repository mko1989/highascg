import { api } from '../lib/api-client.js'
import { sceneState } from '../lib/scene-state.js'
import {
	buildLiveSources,
	decklinkSlotStatusMessage,
	escapeHtml,
	liveAudioSlotStatusMessage,
	makeDraggable,
	v4l2SlotStatusMessage,
} from './sources-panel-helpers.js'
import { migrateLegacyInputRoute } from '../lib/input-channels.js'
import { reconcileExtraLiveSourceChannel } from '../lib/device-view-host-channels.js'
import { getLiveThumbnailChannelForSource, getLiveThumbnailUrl } from '../lib/thumbnail-url.js'
import { invalidateThumbnailCache } from './preview-canvas-draw-base.js'
import { attachLiveSourceActionButtons } from './sources-panel-live-render-actions.js'

export function renderLiveTab(listEl, {
	channelMap,
	decklinkInputsStatus,
	liveAudioInputsStatus,
	v4l2InputsStatus,
	liveAudioConfigured,
	v4l2Configured,
	extraSources = [],
	connectors = [],
	hostOperatorFullscreen = null,
}) {
	const base = buildLiveSources(channelMap, connectors, liveAudioConfigured, v4l2Configured)
	const existing = new Set(base.map((s) => String(s.value || '')))
	const extras = Array.isArray(extraSources)
		? extraSources
				.filter((s) => s && s.value && !existing.has(String(s.value)))
				.map((s) =>
					reconcileExtraLiveSourceChannel(
						{
							...s,
							value: migrateLegacyInputRoute(channelMap, s.value),
						},
						channelMap,
					),
				)
		: []
	const sources = [...extras, ...base]

	/* todos30.07.26 (WO-401): the owner saw live-input thumbnails "refreshing periodically" —
	 * the status objects carry volatile fields (`updatedAt: Date.now()` re-stamped by routing
	 * retries), and keying the render on the WHOLE objects rebuilt every row (recreating each
	 * <img> → refetch + visible flash) with nothing visible changed. Key on what the rows
	 * actually display: the derived per-source slot message strings. */
	const slotMsgForSource = (s) => {
		if (s.routeType === 'decklink' && s.decklinkSlot != null)
			return decklinkSlotStatusMessage(decklinkInputsStatus, s.decklinkSlot)
		if (s.routeType === 'live_audio' && s.liveAudioSlot != null)
			return liveAudioSlotStatusMessage(liveAudioInputsStatus, s.liveAudioSlot)
		if (s.routeType === 'v4l2' && s.v4l2Slot != null) return v4l2SlotStatusMessage(v4l2InputsStatus, s.v4l2Slot)
		return ''
	}

	const renderKey = JSON.stringify({
		channelMap: {
			program: channelMap?.programChannels || [],
			preview: channelMap?.previewChannels || [],
			decklinkCount: channelMap?.decklinkCount ?? 0,
			liveAudioCount: channelMap?.liveAudioCount ?? 0,
			v4l2InputCount: channelMap?.v4l2InputCount ?? 0,
			multiviewCh: channelMap?.multiviewCh ?? null,
		},
		sources: sources.map((s) => ({
			value: s.value,
			label: s.label,
			res: s.resolution,
			type: s.type,
			routeType: s.routeType,
			slotMsg: slotMsgForSource(s),
		})),
		connectors: connectors.map((c) => c?.id).filter(Boolean),
		operatorFs: hostOperatorFullscreen?.sourceId || null,
	})
	if (listEl._lastRenderKey === renderKey) return
	listEl._lastRenderKey = renderKey

	listEl.innerHTML = ''
	if (!sources.length) { listEl.innerHTML = '<p class="sources-empty">No live sources</p>'; return }
	const hintParts = []
	if (sources.some((s) => s.routeType === 'decklink')) {
		hintParts.push('DeckLink tiles match Settings. Use Stop to clear layer.')
	}
	if (sources.some((s) => s.routeType === 'live_audio')) {
		hintParts.push('Live audio: configure in Settings → live audio, then drag onto looks.')
	}
	if (sources.some((s) => s.routeType === 'v4l2')) {
		hintParts.push('USB video: click a tile to inspect or remove; drag route:// onto PGM or multiview.')
	}
	if (sources.some((s) => s.routeType === 'layer')) {
		hintParts.push('Layer routes: Looks row ↗ (default = PGM; Shift+↗ = edit bus, Ctrl+↗ = PRV). Drag onto another layer.')
	}
	if (sources.some((s) => s.routeType === 'webpage_host')) {
		hintParts.push('Webpage hosts: click a tile to edit the page URL in the Inspector; ⛶ routes video to the operator monitor.')
	}
	if (sources.some((s) => s.routeType === 'ndi_host')) {
		hintParts.push('NDI hosts: click a tile to inspect and remove in the Inspector panel.')
	}
	if (sources.some((s) => s.routeType === 'browser_display')) {
		hintParts.push('Browser sources: click a tile to edit URL/dimensions and toggle operator screen in the Inspector.')
	}
	if (hintParts.length) listEl.innerHTML = `<p class="sources-live-hint">${hintParts.join(' ')}</p>`
	sources.forEach(s => {
		const el = document.createElement('div')
		
		const metaItems = [s.resolution, s.fps ? `${s.fps} fps` : '']
		if (s.routeType === 'v4l2' && s.devicePath) {
			metaItems.unshift(String(s.devicePath))
		}
		if (s.routeType === 'webpage_host' || s.routeType === 'ndi_host' || s.routeType === 'browser_display') {
			if (s.hostChannel != null) metaItems.push(`host ch ${s.hostChannel}`)
			if (s.routeType === 'browser_display' && s.width != null && s.height != null) {
				metaItems.push(`${s.width}x${s.height}`)
			}
			metaItems.push(s.value || '')
		}
		if (s.type === 'ndi' && s.routeType !== 'ndi_host' && s.useDirect) {
			metaItems.push('Direct (legacy)')
		}
		if (s.type === 'browser' && s.browserAsCg) {
			metaItems.push('CG template')
		}
		const meta = metaItems.filter(Boolean).join(' · ')
		
		const slotMsg = slotMsgForSource(s)
		
		const ch = getLiveThumbnailChannelForSource(s)
		let thumbHtml
		let thumbControls = ''
		if (ch > 0) {
			// STABLE URL, no bust (WO-392): the panel re-renders on every state tick; any
			// time-varying bust forced periodic refetches + server PRINTs. The server serves
			// no-cache + ETag, so revalidation picks up recaptures. Explicit capture/upload
			// below keep Date.now() — those are deliberate refreshes.
			const thumbUrl = getLiveThumbnailUrl(ch)
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
							imgEl.src = getLiveThumbnailUrl(ch, bust)
							const fallbackIcon = thumbContainer.querySelector('.source-item__live-svg-fallback')
							if (fallbackIcon) fallbackIcon.remove()
						}
						invalidateThumbnailCache(getLiveThumbnailUrl(ch))
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
							imgEl.src = getLiveThumbnailUrl(ch, bust)
							const fallbackIcon = thumbContainer.querySelector('.source-item__live-svg-fallback')
							if (fallbackIcon) fallbackIcon.remove()
						}
						invalidateThumbnailCache(getLiveThumbnailUrl(ch))
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
		const skipThumbHint = s.type === 'ndi' && s.useDirect === true && s.routeType !== 'ndi_host'
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

		if (s.routeType === 'webpage_host' && s.interactiveCapable !== false) {
			el.style.cursor = 'pointer'
			el.addEventListener('click', (e) => {
				if (e.target.closest('button, input, a')) return
				window.dispatchEvent(
					new CustomEvent('webpage-host-select', {
						detail: { sourceId: s.sourceId, value: s.value, hostChannel: s.hostChannel },
					}),
				)
			})
		}

		if (s.routeType === 'browser_display' && s.interactiveCapable !== false) {
			el.style.cursor = 'pointer'
			el.addEventListener('click', (e) => {
				if (e.target.closest('button, input, a')) return
				window.dispatchEvent(
					new CustomEvent('browser-display-select', {
						detail: { sourceId: s.sourceId, value: s.value, hostChannel: s.hostChannel },
					}),
				)
			})
		}
		
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
		
		attachLiveSourceActionButtons(el, s, hostOperatorFullscreen)

		listEl.appendChild(el)
	})
}
