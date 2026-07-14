import { multiviewState } from '../lib/multiview-state.js'
import { api } from '../lib/api-client.js'
import { linearGainToCasparDb } from '../lib/audio-volume-scale.js'
import { streamState } from '../lib/stream-state.js'
import { getAppStateStore } from '../lib/app-runtime.js'

export async function applyMultiviewAudioFocus() {
	const cells = multiviewState.getCells()
	const targetId = multiviewState.audioActiveCellId
	if (!targetId) return

	const n = multiviewState.currentIndex || 1
	const cm = (getAppStateStore()?.getState()?.channelMap || {})
	const mvChs = Array.isArray(cm.multiviewChannels) ? cm.multiviewChannels : (cm.multiviewCh != null ? [cm.multiviewCh] : [])
	const MV_CH = mvChs[n - 1] || 3

	const MV_CELL_LAYER_START = 11

	const idx = cells.findIndex(c => c.id === targetId)
	if (idx < 0) return

	const targetLayer = idx + MV_CELL_LAYER_START

	streamState.setAudioSource('multiview')
	streamState.setMuted(false)

	try {
		const cmds = []
		const muteDb = linearGainToCasparDb(0)
		const focusDb = linearGainToCasparDb(1)
		for (let L = 1; L <= 10; L++) {
			cmds.push(`MIXER ${MV_CH} VOLUME ${L} ${muteDb}`)
		}
		cells.forEach((c, i) => {
			const L = i + MV_CELL_LAYER_START
			cmds.push(`MIXER ${MV_CH} VOLUME ${L} ${L === targetLayer ? focusDb : muteDb}`)
		})
		await api.post('/api/amcp/batch', { commands: cmds })
	} catch (e) {
		console.error('Audio focus AMCP failed:', e)
	}
}

/**
 * @param {() => object} getChannelMap
 * @param {{ silent?: boolean }} [opts] — silent: no alert on error (live updates)
 */
export async function applyMultiviewLayout(getChannelMap, opts = {}) {
	const silent = !!opts.silent
	const cm = getChannelMap()
	const layout = multiviewState.toApiLayout()
	const n = multiviewState.currentIndex || 1
	const mvChs = Array.isArray(cm.multiviewChannels) ? cm.multiviewChannels : (cm.multiviewCh != null ? [cm.multiviewCh] : [])
	const targetCh = mvChs[n - 1] || cm.multiviewCh

	if (targetCh == null) {
		if (!silent) alert(`Multiview ${n} channel not found.`)
		return
	}
	// Empty layout = nothing to apply (editor not yet loaded / cells cleared). The server
	// engine 502s on it ('layout array required') — skip instead of spamming failures.
	if (!Array.isArray(layout) || layout.length === 0) {
		if (!silent) alert('Multiview layout is empty — nothing to apply.')
		return
	}

	try {
		await api.post('/api/multiview/apply', {
			n,
			layout,
			showOverlay: multiviewState.showOverlay,
			bgColor: multiviewState.bgColor,
			showTimersUnderLabels: multiviewState.showTimersUnderLabels,
			timerScale: multiviewState.timerScale,
			highlightTopTimer: multiviewState.highlightTopTimer,
		})
	} catch (e) {
		const msg = String(e?.message ?? e ?? '')
		if (msg.includes('HTTP 404')) {
			let fallback404 = false
			try {
				await api.post('/api/multiview', {
					layout,
					showOverlay: multiviewState.showOverlay,
					bgColor: multiviewState.bgColor,
					showTimersUnderLabels: multiviewState.showTimersUnderLabels,
					timerScale: multiviewState.timerScale,
					highlightTopTimer: multiviewState.highlightTopTimer,
				})
				return
			} catch (fallbackErr) {
				const fbMsg = String(fallbackErr?.message ?? fallbackErr ?? '')
				fallback404 = fbMsg.includes('HTTP 404')
				if (!fallback404) console.error('Multiview apply fallback failed:', fallbackErr)
			}
			if (silent) return
			alert('Multiview apply route is missing on this server build. Restart/update the backend so `/api/multiview/apply` is available.')
			return
		}
		console.error('Multiview apply failed:', e)
		if (silent) return
		const hint = (msg.toLowerCase().includes('not connected') || msg.includes('503'))
			? 'CasparCG is not connected. Check module Settings → Connection and ensure CasparCG server is running.'
			: msg
		alert('Multiview output failed: ' + hint)
	}
}
