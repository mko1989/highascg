/**
 * Header bar streaming and recording status badges (right of FTB).
 * All configured outputs show — gray when idle, red when on-air.
 */

import { settingsState } from '../lib/settings-state.js'
import {
	getStreamingChannelStatus,
	isRecordOutputLive,
	isStreamOutputLive,
	refreshStreamingChannelStatus,
	subscribeStreamingChannelStatus,
} from '../lib/streaming-channel-state.js'

export function initStreamingBadge(container) {
	const streamStateWrap = document.createElement('div')
	streamStateWrap.className = 'header-stream-state'
	container.appendChild(streamStateWrap)

	function focusDeviceConnector(connectorId) {
		if (typeof window.highascgActivateWorkspaceTab === 'function') {
			window.highascgActivateWorkspaceTab('device-view')
		}
		setTimeout(() => {
			window.dispatchEvent(new CustomEvent('highascg-device-view-focus-connector', { detail: { connectorId } }))
		}, 50)
	}

	function hasConfiguredOutputs() {
		const settings = settingsState.getSettings() || {}
		const streamOut = Array.isArray(settings?.streamOutputs) ? settings.streamOutputs : []
		const recordOut = Array.isArray(settings?.recordOutputs) ? settings.recordOutputs : []
		const row = (r) => r && r.enabled !== false && String(r?.id || '').trim()
		return streamOut.some(row) || recordOut.some(row)
	}

	function renderBadges(st) {
		if (!hasConfiguredOutputs()) {
			streamStateWrap.innerHTML = ''
			streamStateWrap.hidden = true
			return
		}
		const settings = settingsState.getSettings() || {}
		const streamOut = Array.isArray(settings?.streamOutputs) ? settings.streamOutputs : []
		const recordOut = Array.isArray(settings?.recordOutputs) ? settings.recordOutputs : []
		streamStateWrap.innerHTML = ''

		for (const s of streamOut) {
			if (s?.enabled === false) continue
			const id = String(s?.id || '').trim()
			if (!id) continue
			const isOn = isStreamOutputLive(st, id)
			const idx = id.match(/(\d+)/)?.[1] || ''
			const fallback = `Str${idx || ''}`.trim() || 'Str'
			const name = String(s?.name || s?.label || fallback).trim() || fallback
			const b = document.createElement('button')
			b.type = 'button'
			b.className = `header-stream-indicator${isOn ? ' active' : ''}`
			const firstChar = name.trim().charAt(0).toUpperCase() || 'S'
			const labelText =
				name.toLowerCase().startsWith('str') || name.toLowerCase().startsWith('stream')
					? 'S' + (idx || '1')
					: firstChar + (idx || '')
			b.textContent = labelText
			b.title = isOn ? `${name} is streaming` : `${name} (idle)`
			b.addEventListener('click', () => focusDeviceConnector(id))
			streamStateWrap.appendChild(b)
		}

		for (const r of recordOut) {
			if (r?.enabled === false) continue
			const id = String(r?.id || '').trim()
			if (!id) continue
			const isOn = isRecordOutputLive(st, id)
			const idx = id.match(/(\d+)/)?.[1] || ''
			const fallback = `Rec${idx || ''}`.trim() || 'Rec'
			const name = String(r?.name || r?.label || fallback).trim() || fallback
			const b = document.createElement('button')
			b.type = 'button'
			b.className = `header-stream-indicator${isOn ? ' active' : ''}`
			const firstChar = name.trim().charAt(0).toUpperCase() || 'R'
			const labelText =
				name.toLowerCase().startsWith('rec') || name.toLowerCase().startsWith('record')
					? 'R' + (idx || '1')
					: firstChar + (idx || '')
			b.textContent = labelText
			b.title = isOn
				? `${name} is recording${st?.record?.path ? ` (${st.record.path})` : ''}`
				: `${name} (idle)`
			b.addEventListener('click', () => focusDeviceConnector(id))
			streamStateWrap.appendChild(b)
		}

		streamStateWrap.hidden = !streamStateWrap.childElementCount
	}

	const unsubStatus = subscribeStreamingChannelStatus((st) => renderBadges(st))

	document.addEventListener('highascg-streaming-changed', () => {
		void refreshStreamingChannelStatus()
	})

	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') void refreshStreamingChannelStatus()
	})

	const unsubSettings = settingsState.subscribe(() => renderBadges(getStreamingChannelStatus()))

	void refreshStreamingChannelStatus()

	return {
		destroy: () => {
			unsubStatus()
			unsubSettings?.()
		},
	}
}
