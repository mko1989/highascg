import { api } from '../lib/api-client.js'
import { showAppToast } from '../lib/app-toast.js'
import { removeExtraLiveHostSource } from '../lib/extra-live-source-remove.js'

export function attachLiveSourceActionButtons(el, s, hostOperatorFullscreen) {
	if (s.routeType === 'live_audio' && s.inputsChannel != null && s.liveAudioSlot != null) {
		const cl = s.inputsLayer != null ? `${s.inputsChannel}-${s.inputsLayer}` : String(s.inputsChannel)
		const btnGroup = document.createElement('div')
		btnGroup.className = 'source-item__live-actions'
		const applyBtn = Object.assign(document.createElement('button'), {
			type: 'button',
			className: 'source-item__live-btn',
			title: 'Re-apply startup PLAY + PGM routes',
			textContent: 'Apply',
		})
		applyBtn.onclick = async (e) => {
			e.stopPropagation()
			applyBtn.disabled = true
			try {
				await api.post('/api/audio/live-inputs/apply', {})
			} finally {
				applyBtn.disabled = false
			}
		}
		btnGroup.appendChild(applyBtn)
		el.appendChild(btnGroup)
	} else if (s.routeType === 'v4l2' && s.inputsChannel != null && s.v4l2Slot != null) {
		el.style.cursor = 'pointer'
		el.addEventListener('click', (e) => {
			if (e.target.closest('button, input, a')) return
			window.dispatchEvent(new CustomEvent('v4l2-input-select', { detail: { slot: s.v4l2Slot } }))
		})
		const btnGroup = document.createElement('div')
		btnGroup.className = 'source-item__live-actions'
		const applyBtn = Object.assign(document.createElement('button'), {
			type: 'button',
			className: 'source-item__live-btn',
			title: 'Re-apply FFmpeg bridge + PLAY on host channel',
			textContent: 'Apply',
		})
		applyBtn.onclick = async (e) => {
			e.stopPropagation()
			applyBtn.disabled = true
			try {
				await api.post('/api/v4l2-inputs/apply', {})
			} finally {
				applyBtn.disabled = false
			}
		}
		btnGroup.appendChild(applyBtn)
		el.appendChild(btnGroup)
	} else if (s.routeType === 'decklink' && s.inputsChannel != null && s.decklinkSlot != null) {
		const cl = `${s.inputsChannel}-${s.inputsLayer ?? s.decklinkSlot}`
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
	} else if (s.routeType === 'webpage_host' && s.interactiveCapable !== false) {
		const btnGroup = document.createElement('div')
		btnGroup.className = 'source-item__live-actions'
		const isFs =
			hostOperatorFullscreen?.active &&
			String(hostOperatorFullscreen?.sourceId || '') === String(s.sourceId || '')
		const fsBtn = Object.assign(document.createElement('button'), {
			type: 'button',
			className: `source-item__live-btn source-item__live-btn--fullscreen${isFs ? ' source-item__live-btn--active' : ''}`,
			title: isFs
				? 'Take off operator monitor (host channel keeps playing)'
				: 'Route to operator monitor fullscreen',
			textContent: isFs ? '⛶ Off' : '⛶',
		})
		fsBtn.onclick = async (e) => {
			e.stopPropagation()
			fsBtn.disabled = true
			try {
				const r = await api.post('/api/host-live/operator-fullscreen', {
					action: 'toggle',
					sourceId: s.sourceId,
					value: s.value,
				})
				if (typeof window.__highascgApplyHostOperatorFullscreen === 'function') {
					window.__highascgApplyHostOperatorFullscreen(r.hostOperatorFullscreen ?? null)
				}
				if (r?.message) showAppToast(r.message, 'info')
			} catch (err) {
				showAppToast(err?.message || String(err), 'error')
			} finally {
				fsBtn.disabled = false
			}
		}
		btnGroup.append(fsBtn)
		const removeBtn = Object.assign(document.createElement('button'), {
			type: 'button',
			className: 'source-item__live-btn source-item__live-btn--remove',
			title: 'Remove from Live tab',
			textContent: 'Remove',
		})
		removeBtn.onclick = async (e) => {
			e.stopPropagation()
			if (!confirm(`Remove webpage host "${s.label}"? Host channel will stop when removed from config.`)) return
			removeBtn.disabled = true
			try {
				if (isFs) {
					await api.post('/api/host-live/operator-fullscreen', { action: 'off', sourceId: s.sourceId })
				}
				const rm = await api.post('/api/device-view', { removeExtraLiveSource: { value: s.value } })
				if (Array.isArray(rm?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
					window.__highascgApplyExtraLiveSources(rm.extraLiveSources)
				}
			} finally {
				removeBtn.disabled = false
			}
		}
		btnGroup.append(removeBtn)
		el.appendChild(btnGroup)
	} else if (s.routeType === 'ndi_host') {
		el.style.cursor = 'pointer'
		el.addEventListener('click', (e) => {
			if (e.target.closest('button, input, a')) return
			window.dispatchEvent(
				new CustomEvent('ndi-host-select', {
					detail: { sourceId: s.sourceId, value: s.value, hostChannel: s.hostChannel },
				}),
			)
		})
		const btnGroup = document.createElement('div')
		btnGroup.className = 'source-item__live-actions'
		const removeBtn = Object.assign(document.createElement('button'), {
			type: 'button',
			className: 'source-item__live-btn source-item__live-btn--remove',
			title: 'Remove from Live tab',
			textContent: 'Remove',
		})
		removeBtn.onclick = async (e) => {
			e.stopPropagation()
			if (!confirm(`Remove NDI source "${s.label}"?`)) return
			removeBtn.disabled = true
			try {
				await removeExtraLiveHostSource(s)
				window.dispatchEvent(new CustomEvent('ndi-host-select', { detail: null }))
			} finally {
				removeBtn.disabled = false
			}
		}
		btnGroup.append(removeBtn)
		el.appendChild(btnGroup)
	} else if (s.routeType === 'browser_display') {
		el.style.cursor = 'pointer'
		el.addEventListener('click', (e) => {
			if (e.target.closest('button, input, a')) return
			window.dispatchEvent(
				new CustomEvent('browser-display-select', {
					detail: { sourceId: s.sourceId, value: s.value, hostChannel: s.hostChannel },
				}),
			)
		})
		const btnGroup = document.createElement('div')
		btnGroup.className = 'source-item__live-actions'
		const removeBtn = Object.assign(document.createElement('button'), {
			type: 'button',
			className: 'source-item__live-btn source-item__live-btn--remove',
			title: 'Remove from Live tab',
			textContent: 'Remove',
		})
		removeBtn.onclick = async (e) => {
			e.stopPropagation()
			if (!confirm(`Remove browser source "${s.label}"?`)) return
			removeBtn.disabled = true
			try {
				await removeExtraLiveHostSource(s)
				window.dispatchEvent(new CustomEvent('browser-display-select', { detail: null }))
			} finally {
				removeBtn.disabled = false
			}
		}
		btnGroup.append(removeBtn)
		el.appendChild(btnGroup)
	} else if ((s.type === 'ndi' && s.routeType !== 'ndi_host') || (s.type === 'browser' && s.routeType !== 'browser_display') || s.routeType === 'layer') {
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
}
