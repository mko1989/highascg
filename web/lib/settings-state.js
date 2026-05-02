/**
 * @file settings-state.js
 * Client-side cache for application settings.
 * Reactive: components can subscribe to changes.
 */

import { api } from './api-client.js'

export const settingsState = {
	settings: {
		caspar: { host: '127.0.0.1', port: 5250 },
		streaming: { enabled: true, quality: 'medium', basePort: 10000, hardware_accel: true },
		/** Mirrors server defaults so subscribers (e.g. DMX) see shape before GET /api/settings completes. */
		dmx: { enabled: false, debugLogDmx: false, fps: 25, fixtures: [] },
		periodic_sync_interval_sec: 10,
		periodic_sync_interval_sec_osc: 1,
		osc: {
			enabled: true,
			listenPort: 6251,
			listenAddress: '0.0.0.0',
			peakHoldMs: 2000,
		},
		ui: { oscFooterVu: true, rundownPlaybackTimer: true, nuclearRequirePassword: false, nuclearPassword: '' },
		/** Dedicated Caspar channel for RTMP/record (WO-27); tab visible when enabled */
		streamingChannel: { enabled: false, videoSource: 'program_1', audioSource: 'follow_video', dedicatedOutputChannel: false },
		audioRouting: {
			programLayout: 'stereo',
			programOutput: 'default',
			programAlsaDevice: '',
			programFfmpegPath: '',
			programFfmpegArgs: '',
			monitorOutput: 'default',
			monitorAlsaDevice: '',
			monitorFfmpegPath: '',
			monitorFfmpegArgs: '',
			browserMonitor: 'pgm',
			programSystemAudioDevices: ['', '', '', ''],
			previewSystemAudioEnabled: [false, false, false, false],
			previewSystemAudioDevices: ['', '', '', ''],
		},
		recordOutputs: [{
			id: 'rec_1',
			label: 'Rec1',
			enabled: true,
			name: 'Rec1',
			source: 'program_1',
			crf: 26,
			videoCodec: 'h264',
			videoBitrateKbps: 4500,
			encoderPreset: 'veryfast',
			audioCodec: 'aac',
			audioBitrateKbps: 128,
		}],
	},
	listeners: new Set(),

	/** @type {Promise<void> | null} */
	_loadPromise: null,

	async load() {
		if (this._loadPromise) return this._loadPromise
		this._loadPromise = (async () => {
			try {
				const cfg = await api.get('/api/settings')
				if (cfg && typeof cfg === 'object') {
					this.settings = cfg
					this.notify()
				}
			} catch (e) {
				console.warn('[SettingsState] Failed to load settings:', e)
			} finally {
				this._loadPromise = null
			}
		})()
		return this._loadPromise
	},

	getSettings() {
		return this.settings
	},

	subscribe(fn) {
		this.listeners.add(fn)
		try {
			fn(this.settings)
		} catch (e) {
			console.error('Settings state listener error:', e)
		}
		return () => this.listeners.delete(fn)
	},

	notify() {
		for (const fn of this.listeners) {
			try { fn(this.settings) } catch (e) { console.error('Settings state listener error:', e) }
		}
	},

	/**
	 * Persist full settings to the server (highascg.config.json). Call after mutating `getSettings()` in place.
	 * @param {object} [partial] - Optional object merged onto `this.settings` (same reference as getSettings() is fine).
	 */
	async save(partial) {
		if (partial && typeof partial === 'object' && partial !== this.settings) {
			Object.assign(this.settings, partial)
		}
		try {
			await api.post('/api/settings', this.settings)
		} catch (e) {
			console.error('[SettingsState] Save failed:', e)
			throw e
		}
		this.notify()
	},
}

// Initial load
settingsState.load()
