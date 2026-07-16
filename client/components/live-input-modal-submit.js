import { api } from '../lib/api-client.js'
import { addLiveAudioInputSlot } from '../lib/live-audio-add-input.js'
import { addV4l2InputSlot } from '../lib/v4l2-add-input.js'
import { addDecklinkInputSlot } from '../lib/decklink-add-input.js'
import { markCasparRestartDirty } from '../lib/caspar-restart-hint.js'

/**
 * Attach submit handler for the Live Input modal.
 * Keeps kind-specific submit flows isolated from modal UI wiring.
 */
export function attachLiveInputModalSubmit({ elements, getKind, stateStore, selectedDecklinkSlot, finishAdded }) {
	elements.playBtn?.addEventListener('click', async () => {
		const statusEl = elements.statusEl
		const playBtn = elements.playBtn
		if (playBtn?.dataset.submitting === '1') return
		const setStatus = (t, err) => {
			if (statusEl) {
				statusEl.textContent = t
				statusEl.style.color = err ? '#e74c3c' : ''
			}
		}
		setStatus('')
		const k = getKind?.() || 'decklink'

		if (k === 'decklink') {
			const slot = selectedDecklinkSlot()
			if (!Number.isFinite(slot) || slot < 1) {
				setStatus('Pick an SDI port', true)
				return
			}
			if (playBtn) {
				playBtn.disabled = true
				playBtn.dataset.submitting = '1'
			}
			setStatus(`Registering DeckLink SDI port ${slot}...`, false)
			try {
				const r = await addDecklinkInputSlot(stateStore, { slot })
				if (!r.ok) {
					setStatus(r.error || 'Failed to add DeckLink input', true)
					return
				}
				if (Array.isArray(r.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
					window.__highascgApplyExtraLiveSources(r.extraLiveSources)
				}
				if (r.casparRestartNeeded || r.pendingApply) markCasparRestartDirty()
				const applyMsg = r.pendingApply || r.casparRestartNeeded
					? ' Apply Caspar config and restart in Device View to start capture.'
					: ''
				const againMsg = r.alreadyConfigured ? ' (capture refreshed on existing host channel.)' : ''
				const chMsg =
					r.hostChannel != null
						? `host channel ${r.hostChannel}`
						: 'host channel (after apply)'
				setStatus(`DeckLink input slot ${r.slot} . ${chMsg} . ${r.route || ''}.${applyMsg}${againMsg}`, false)
				finishAdded()
			} catch (e) {
				setStatus(e?.message || String(e), true)
			} finally {
				if (playBtn) {
					playBtn.disabled = false
					delete playBtn.dataset.submitting
				}
			}
			return
		}

		const ch = parseInt(String(elements.chInput?.value || '1'), 10)
		const layer = parseInt(String(elements.layerInput?.value || '1'), 10)
		if (!Number.isFinite(ch) || ch < 1 || !Number.isFinite(layer) || layer < 0) {
			setStatus('Invalid channel/layer', true)
			return
		}

		if (k === 'ndi') {
			const sel = elements.ndiSelect
			const manual = (elements.ndiManual?.value || '').trim()
			let name = manual
			if (!name && sel && sel.value) name = sel.value.trim()
			if (!name) {
				setStatus('Pick a discovered source or enter a name', true)
				return
			}
			const display = name.startsWith('ndi://') ? name.substring(6).replace(/\/"([^"]+)"/, ' $1') : name

			const item = {
				type: 'ndi',
				ndiName: name,
				label: display,
			}

			try {
				const r = await api.post('/api/device-view', { addExtraLiveSource: item })
				if (Array.isArray(r?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
					window.__highascgApplyExtraLiveSources(r.extraLiveSources)
				}
				if (r.casparRestartRecommended || r.pendingApply) markCasparRestartDirty()
				const hostMsg = r?.hostLivePlay?.ok
					? ' Host producer started.'
					: r?.hostLivePlay?.error
						? ` Host PLAY: ${r.hostLivePlay.error}`
						: ''
				const applyMsg = r?.pendingApply || r?.casparRestartRecommended
					? ' Apply Caspar config and restart in Device View to start capture.'
					: ''
				setStatus(`Added to Live Sources.${hostMsg}${applyMsg}`, false)
				finishAdded()
			} catch (e) {
				setStatus(e?.message || String(e), true)
			}
			return
		}

		if (k === 'browser_display') {
			const url = (elements.browserDisplayUrl?.value || '').trim()
			if (!url) {
				setStatus('Enter a URL', true)
				return
			}
			const width = Math.max(160, parseInt(String(elements.browserDisplayWidth?.value || '1152'), 10) || 1152)
			const height = Math.max(120, parseInt(String(elements.browserDisplayHeight?.value || '648'), 10) || 648)
			const fps = Math.max(1, Math.min(60, parseInt(String(elements.browserDisplayFps?.value || '25'), 10) || 25))

			const item = {
				mode: 'browser_display',
				url,
				width,
				height,
				fps,
				label: url,
			}

			try {
				const r = await api.post('/api/device-view', { addExtraLiveSource: item })
				if (Array.isArray(r?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
					window.__highascgApplyExtraLiveSources(r.extraLiveSources)
				}
				if (r.casparRestartRecommended || r.pendingApply) markCasparRestartDirty()
				const hostMsg = r?.hostLivePlay?.ok
					? ' Host producer started.'
					: r?.hostLivePlay?.error
						? ` Host PLAY: ${r.hostLivePlay.error}`
						: ''
				const applyMsg =
					r?.pendingApply || r?.casparRestartRecommended
						? ' Apply Caspar config and restart in Device View to start capture.'
						: ''
				setStatus(`Added to Live Sources.${hostMsg}${applyMsg}`, false)
				finishAdded()
			} catch (e) {
				setStatus(e?.message || String(e), true)
			}
			return
		}

		if (k === 'browser') {
			const useTemplate = !!elements.browserUseTemplate?.checked
			let url
			if (useTemplate) {
				const templateName = (elements.browserTemplate?.value || '').trim()
				if (!templateName) {
					setStatus('Select a template', true)
					return
				}
				// Construct template URL; handle .html suffix deduplication
				const withoutHtml = templateName.endsWith('.html') ? templateName.slice(0, -5) : templateName
				url = `http://127.0.0.1:4200/template/${withoutHtml}.html`
			} else {
				url = (elements.browserUrl?.value || '').trim()
				if (!url) {
					setStatus('Enter a URL or select a template', true)
					return
				}
			}
			const asCg = !!elements.browserAsCg?.checked
			const item = {
				type: 'browser',
				value: url,
				label: asCg ? `${url} (CG)` : url,
				templateOrUrl: url,
				...(asCg ? { browserAsCg: true } : {}),
			}
			try {
				const r = await api.post('/api/device-view', { addExtraLiveSource: item })
				if (Array.isArray(r?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
					window.__highascgApplyExtraLiveSources(r.extraLiveSources)
				}
				if (!asCg && (r.casparRestartRecommended || r.pendingApply)) markCasparRestartDirty()
				const hostMsg = r?.hostLivePlay?.ok
					? ' Host producer started.'
					: r?.hostLivePlay?.error
						? ` Host PLAY: ${r.hostLivePlay.error}`
						: ''
				const applyMsg =
					!asCg && (r?.pendingApply || r?.casparRestartRecommended)
						? ' Apply Caspar config and restart in Device View to start capture.'
						: ''
				setStatus(`Added to Live Sources.${hostMsg}${applyMsg}`, false)
				finishAdded()
			} catch (e) {
				setStatus(e?.message || String(e), true)
			}
			return
		}

		if (k === 'live_audio') {
			const manual = (elements.audioManual?.value || '').trim()
			const sel = elements.audioSelect
			const device = manual || (sel?.value || '').trim()
			if (!device) {
				setStatus('Pick a capture device or enter an ALSA URI', true)
				return
			}
			if (playBtn) playBtn.disabled = true
			try {
				const r = await addLiveAudioInputSlot(stateStore, { device })
				document.dispatchEvent(new CustomEvent('highascg-settings-applied'))
				document.dispatchEvent(new CustomEvent('highascg-live-audio-configured', { detail: r.liveAudioConfigured }))
				const hostMsg = r?.hostLivePlay?.ok
					? ` Capture started on ch ${r.hostChannel ?? '?'}.`
					: r?.hostLivePlay?.error
						? ` Capture: ${r.hostLivePlay.error}`
						: ''
				if (r.casparRestartNeeded || r.pendingApply) markCasparRestartDirty()
				const applyMsg = r?.pendingApply || r?.casparRestartNeeded
					? ' Apply Caspar config and restart in Device View to start capture.'
					: ''
				setStatus(`Live audio slot ${r.slot} added.${hostMsg}${applyMsg}`, false)
				finishAdded()
			} catch (e) {
				setStatus(e?.message || String(e), true)
			} finally {
				if (playBtn) playBtn.disabled = false
			}
			return
		}

		if (k === 'usb_video') {
			const manual = (elements.v4l2Manual?.value || '').trim()
			const sel = elements.v4l2Select
			const device = manual || (sel?.value || '').trim()
			if (!device) {
				setStatus('Pick a capture device or enter a device path', true)
				return
			}
			const label = (elements.v4l2Label?.value || '').trim()
			const format = (elements.v4l2Format?.value || 'auto').trim()
			const fps = parseInt(String(elements.v4l2Fps?.value || '0'), 10) || 0
			const audioManual = (elements.v4l2AudioManual?.value || '').trim()
			const audioSel = elements.v4l2AudioSelect
			const audio =
				audioManual ||
				(audioSel?.value && audioSel.value !== 'none' ? String(audioSel.value).trim() : '') ||
				'none'
			if (playBtn) playBtn.disabled = true
			try {
				const r = await addV4l2InputSlot(stateStore, {
					device,
					...(label ? { label } : {}),
					...(format && format !== 'auto' ? { format } : {}),
					...(fps > 0 ? { fps } : {}),
					...(audio && audio !== 'none' ? { audio } : {}),
				})
				document.dispatchEvent(new CustomEvent('highascg-settings-applied'))
				document.dispatchEvent(new CustomEvent('highascg-v4l2-configured', { detail: r.v4l2Configured }))
				const hostMsg = r?.hostLivePlay?.ok
					? ` Capture started on ch ${r.hostChannel ?? '?'}.`
					: r?.hostLivePlay?.error
						? ` Capture: ${r.hostLivePlay.error}`
						: ''
				if (r.casparRestartNeeded || r.pendingApply) markCasparRestartDirty()
				const applyMsg = r?.pendingApply || r?.casparRestartNeeded
					? ' Apply Caspar config and restart in Device View to start capture.'
					: ''
				setStatus(`USB video slot ${r.slot} added.${hostMsg}${applyMsg}`, false)
				finishAdded()
			} catch (e) {
				setStatus(e?.message || String(e), true)
			} finally {
				if (playBtn) playBtn.disabled = false
			}
			return
		}
	})
}
