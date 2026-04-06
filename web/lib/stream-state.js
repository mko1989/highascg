/**
 * @file stream-state.js
 * Tracks go2rtc/WebRTC stream availability (`GET /api/streams` + polling) and client-side monitoring state
 * (which logical stream is audible, mute). Pairs with {@link ./webrtc-client.js} for playback; port comes from
 * API response via `setGo2rtcApiPort`. **applyBrowserMonitorFromSettings** enforces Settings → Audio → Browser monitoring
 * (PGM vs off) on top of user header controls.
 */

import { getApiBase } from './api-client.js'
import { setGo2rtcApiPort } from './webrtc-client.js'
import { settingsState } from './settings-state.js'

/**
 * Live WebRTC preview is shown only when go2rtc is running **and** Application Settings do not disable streaming.
 * @returns {boolean}
 */
export function shouldShowLiveVideo() {
	const cfg = settingsState.getSettings()
	if (cfg?.streaming?.enabled === false) return false
	return streamState.isStreamingEnabled
}

export const streamState = {
	availableStreams: [],
	isStreamingEnabled: false,
	activeAudioSource: localStorage.getItem('highascg_audio_source') || 'pgm_1',
	monitoringMuted: localStorage.getItem('highascg_monitoring_muted') === 'true',
	listeners: new Set(),

	/**
	 * Fetch current stream configuration and availability from server.
	 */
	async refreshStreams() {
		try {
			const res = await fetch(`${getApiBase()}/api/streams`)
			if (!res.ok) throw new Error('Fetch failed')
			const data = await res.json()
			
			this.availableStreams = data.streams || []
			this.isStreamingEnabled = data.isRunning
			
			if (data.config && data.config.go2rtcPort) {
				setGo2rtcApiPort(data.config.go2rtcPort)
			}
			
			this.notify()
		} catch (e) {
			console.warn('[StreamState] Could not fetch stream config:', e)
			this.isStreamingEnabled = false
			this.notify()
		}
	},

	/**
	 * Which stream name to listen to audio from.
	 * @param {string} sourceName 
	 */
	setAudioSource(sourceName) {
		this.activeAudioSource = sourceName
		localStorage.setItem('highascg_audio_source', sourceName)
		this.notify()
	},

	setMuted(muted) {
		this.monitoringMuted = !!muted
		localStorage.setItem('highascg_monitoring_muted', this.monitoringMuted)
		this.notify()
	},

	subscribe(fn) {
		this.listeners.add(fn)
		return () => this.listeners.delete(fn)
	},

	notify() {
		for (const fn of this.listeners) {
			try { fn(this) } catch(e) { console.error('Stream state listener error:', e) }
		}
	}
}

/**
 * Apply Settings → Audio → "Browser monitoring" (PGM vs off) to WebRTC preview audio.
 * @param {object} [settings] — must include `audioRouting.browserMonitor` when set
 */
export function applyBrowserMonitorFromSettings(settings) {
	const m = settings?.audioRouting?.browserMonitor || 'pgm'
	if (m === 'off') {
		streamState.setMuted(true)
		return
	}
	streamState.setMuted(false)
	streamState.setAudioSource('pgm_1')
}

// Initial fetch
streamState.refreshStreams()

/** After Application Settings save (streaming / go2rtc), refresh immediately so WebRTC preview + header audio controls update. */
document.addEventListener('highascg-settings-applied', () => {
	streamState.refreshStreams()
})

setInterval(() => {
	if (document.visibilityState === 'visible') {
		streamState.refreshStreams()
	}
}, 10000)
