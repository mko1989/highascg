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
		periodic_sync_interval_sec: 10,
		periodic_sync_interval_sec_osc: 1,
		osc: {
			enabled: true,
			listenPort: 6251,
			listenAddress: '0.0.0.0',
			peakHoldMs: 2000,
		},
		ui: { oscFooterVu: true, rundownPlaybackTimer: true },
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
		},
	},
	listeners: new Set(),

	async load() {
		try {
			const cfg = await api.get('/api/settings')
			if (cfg && typeof cfg === 'object') {
				this.settings = cfg
				this.notify()
			}
		} catch (e) {
			console.warn('[SettingsState] Failed to load settings:', e)
		}
	},

	getSettings() {
		return this.settings
	},

	subscribe(fn) {
		this.listeners.add(fn)
		return () => this.listeners.delete(fn)
	},

	notify() {
		for (const fn of this.listeners) {
			try { fn(this.settings) } catch (e) { console.error('Settings state listener error:', e) }
		}
	}
}

// Initial load
settingsState.load()
