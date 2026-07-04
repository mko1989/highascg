/**
 * Sources panel — DeckLink connector drag-to-live-input mapping.
 */

import { api } from '../lib/api-client.js'
import { markCasparRestartDirty } from '../lib/caspar-restart-hint.js'
import { decklinkInputForSlot, decklinkSlotFromConnector } from '../lib/input-channels.js'

export function parseDecklinkDrop(ev) {
	const raw = ev?.dataTransfer?.getData('application/x-highascg-connector') || ''
	if (!raw) return null
	try {
		const payload = JSON.parse(raw)
		if (String(payload?.kind || '') !== 'decklink_io') return null
		const connectorId = String(payload?.connectorId || '').trim()
		return connectorId ? { connectorId } : null
	} catch {
		return null
	}
}

function showDecklinkDropHint(routeValue, connectorId) {
	const host = document.createElement('div')
	host.className = 'sources-status'
	host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;pointer-events:none'
	const toast = document.createElement('div')
	toast.style.cssText = 'background:rgba(17,24,39,0.96);color:#e5e7eb;border:1px solid rgba(88,166,255,0.55);border-radius:8px;padding:9px 12px;font-size:12px;box-shadow:0 6px 20px rgba(0,0,0,0.35)'
	toast.textContent = `Ready in Live tab: ${routeValue} (${connectorId})`
	host.appendChild(toast)
	document.body.appendChild(host)
	setTimeout(() => host.remove(), 2600)
}

/**
 * @param {HTMLElement} listEl
 * @param {object} ctx
 */
export function attachDecklinkDropHandlers(listEl, ctx) {
	const { stateStore, setStatus, activateTab } = ctx

	async function mapDecklinkToLiveInput(connectorId) {
		if (!connectorId) return
		setStatus(`Mapping ${connectorId} as live input…`, 'info')
		try {
			await api.post('/api/device-view', { updateConnector: { id: connectorId, patch: { caspar: { ioDirection: 'in' } } } })
			const payload = await api.get('/api/device-view')
			const connectors = [
				...(Array.isArray(payload?.graph?.connectors) ? payload.graph.connectors : []),
				...(Array.isArray(payload?.suggested?.connectors) ? payload.suggested.connectors : []),
			]
			const c = connectors.find((x) => String(x?.id || '') === connectorId) || null
			const slot = decklinkSlotFromConnector(c || { index: parseInt(String(connectorId).replace(/^dli_/, ''), 10) - 1 })
			const dev = Math.max(0, parseInt(String(c?.externalRef ?? 0), 10) || 0)
			const cm = stateStore.getState()?.channelMap || {}
			const entry = decklinkInputForSlot(cm, slot)
			if (entry?.channel == null) {
				markCasparRestartDirty()
				setStatus(`Mapped ${connectorId} to input. Set decklink_input_count ≥ ${slot} and restart Caspar.`, 'ok')
				return
			}
			const layer = entry.layer ?? slot
			const cl = `${entry.channel}-${layer}`
			await api.post('/api/raw', { cmd: `STOP ${cl}` }).catch(() => {})
			await api.post('/api/raw', { cmd: `MIXER ${cl} CLEAR` }).catch(() => {})
			await api.post('/api/raw', { cmd: `PLAY ${cl} DECKLINK ${dev}` })
			const routeVal = entry.route || `route://${cl}`
			const item = {
				type: 'route',
				routeType: 'decklink',
				value: routeVal,
				label: entry.label || `decklink ${slot}`,
				decklinkSlot: slot,
				inputsChannel: entry.channel,
				inputsLayer: layer,
				connectorId,
				decklinkDevice: dev,
			}
			const addRes = await api.post('/api/device-view', { addExtraLiveSource: item })
			if (Array.isArray(addRes?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
				window.__highascgApplyExtraLiveSources(addRes.extraLiveSources)
			}
			markCasparRestartDirty()
			setStatus(`Live source ready: ${routeVal} (${connectorId})`, 'ok')
			showDecklinkDropHint(`route://${cl}`, connectorId)
			activateTab('live')
		} catch (e) {
			setStatus(e?.message || String(e), 'error')
		}
	}

	listEl.addEventListener('dragover', (ev) => {
		const parsed = parseDecklinkDrop(ev)
		if (!parsed) return
		ev.preventDefault()
		listEl.style.outline = '1px dashed var(--accent-color,#58a6ff)'
	})
	listEl.addEventListener('dragleave', () => {
		listEl.style.outline = ''
	})
	listEl.addEventListener('drop', async (ev) => {
		listEl.style.outline = ''
		const parsed = parseDecklinkDrop(ev)
		if (!parsed) return
		ev.preventDefault()
		ev.stopPropagation()
		await mapDecklinkToLiveInput(parsed.connectorId)
	})
}
