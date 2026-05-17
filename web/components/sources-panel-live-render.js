/**
 * Live tab rendering for Sources Panel.
 */
import { api } from '../lib/api-client.js'
import { buildLiveSources, decklinkSlotStatusMessage, escapeHtml, makeDraggable } from './sources-panel-helpers.js'

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
	if (sources.some(s => s.routeType === 'decklink')) listEl.innerHTML = '<p class="sources-live-hint">DeckLink tiles match Settings. Use Stop to clear layer.</p>'
	sources.forEach(s => {
		const el = document.createElement('div'); el.className = 'source-item source-item--live source-item--live-stacked'; el.dataset.sourceValue = s.value
		
		const metaItems = [s.resolution, s.fps ? `${s.fps} fps` : '']
		if (s.type === 'ndi') {
			metaItems.push(s.useDirect ? 'Direct' : 'Routed')
		}
		if (s.type === 'browser' && s.browserAsCg) {
			metaItems.push('CG template')
		}
		const meta = metaItems.filter(Boolean).join(' · ')
		
		const slotMsg = (s.routeType === 'decklink' && s.decklinkSlot != null) ? decklinkSlotStatusMessage(decklinkInputsStatus, s.decklinkSlot) : ''
		el.innerHTML = `<div class="source-item__live-col"><div class="source-item__live-line1"><span class="source-item__label" title="${escapeHtml(s.label)}">${escapeHtml(s.label)}</span></div>${meta ? `<div class="source-item__live-line2">${escapeHtml(meta)}</div>` : ''}${slotMsg ? `<div class="source-item__live-line3 source-item__live-line3--warn" title="${escapeHtml(slotMsg)}">${escapeHtml(slotMsg)}</div>` : ''}</div>`
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
		} else if (s.type === 'ndi' || s.type === 'browser') {
			const btnGroup = document.createElement('div'); btnGroup.className = 'source-item__live-actions'
			const removeBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'source-item__live-btn source-item__live-btn--remove', title: `Remove from Live tab`, textContent: 'Remove' })
			removeBtn.onclick = async (e) => {
				const typeLabel = s.type === 'ndi' ? 'NDI source' : 'browser source'
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
