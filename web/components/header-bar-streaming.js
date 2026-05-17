/**
 * Header bar streaming and recording status badges.
 */

import { api } from '../lib/api-client.js'
import { settingsState } from '../lib/settings-state.js'

export function initStreamingBadge(container) {
	const streamStateWrap = document.createElement('div')
	streamStateWrap.style.display = 'inline-flex'
	streamStateWrap.style.gap = '4px'
	streamStateWrap.style.alignItems = 'center'
	container.appendChild(streamStateWrap)

	function focusDeviceConnector(connectorId) {
		window.dispatchEvent(new CustomEvent('highascg-device-view-focus-connector', { detail: { connectorId } }))
	}

	async function syncStreamingRecordBadge() {
		try {
			const settings = settingsState.getSettings() || {}
			const st = await api.get('/api/streaming-channel')
			const streamOut = Array.isArray(settings?.streamOutputs) ? settings.streamOutputs : []
			const recordOut = Array.isArray(settings?.recordOutputs) ? settings.recordOutputs : []
			streamStateWrap.innerHTML = ''
			
			for (const s of streamOut) {
				const id = String(s?.id || '').trim()
				if (!id) continue
				const idx = id.match(/(\d+)/)?.[1] || ''
				const fallback = `Str${idx || ''}`.trim() || 'Str'
				const name = String(s?.name || s?.label || fallback).trim() || fallback
				const isOn = !!st?.rtmp?.active && String(st?.rtmp?.outputId || '') === id
				const b = document.createElement('button')
				b.type = 'button'
				b.className = 'header-btn'
				b.textContent = name
				b.title = isOn ? `${name} is streaming` : `${name} is not streaming`
				if (isOn) {
					b.style.borderColor = 'rgba(220,38,38,0.6)'
					b.style.background = 'rgba(220,38,38,0.12)'
				}
				b.addEventListener('click', () => focusDeviceConnector(id))
				streamStateWrap.appendChild(b)
			}
			
			for (const r of recordOut) {
				const id = String(r?.id || '').trim()
				if (!id) continue
				const idx = id.match(/(\d+)/)?.[1] || ''
				const fallback = `Rec${idx || ''}`.trim() || 'Rec'
				const name = String(r?.name || r?.label || fallback).trim() || fallback
				const isOn = !!st?.record?.active && String(st?.record?.outputId || '') === id
				const b = document.createElement('button')
				b.type = 'button'
				b.className = 'header-btn'
				b.textContent = name
				b.title = isOn
					? `${name} is recording${st?.record?.path ? ` (${st.record.path})` : ''}`
					: `${name} is not recording`
				if (isOn) {
					b.style.borderColor = 'rgba(220,38,38,0.6)'
					b.style.background = 'rgba(220,38,38,0.12)'
				}
				b.addEventListener('click', () => focusDeviceConnector(id))
				streamStateWrap.appendChild(b)
			}
			
			if (!streamStateWrap.childElementCount) {
				const empty = document.createElement('span')
				empty.className = 'header-btn'
				empty.style.pointerEvents = 'none'
				empty.style.opacity = '0.75'
				empty.textContent = 'No stream/record outputs'
				streamStateWrap.appendChild(empty)
			}
		} catch {
			streamStateWrap.innerHTML = ''
			const na = document.createElement('span')
			na.className = 'header-btn'
			na.style.pointerEvents = 'none'
			na.textContent = 'Stream/Rec status n/a'
			na.title = 'Streaming status unavailable'
			streamStateWrap.appendChild(na)
		}
	}

	void syncStreamingRecordBadge()
	const timer = setInterval(() => { void syncStreamingRecordBadge() }, 2000)

	return {
		destroy: () => clearInterval(timer)
	}
}
