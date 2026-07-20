/**
 * @file settings-state.js
 * Client-side cache for application settings.
 * Reactive: components can subscribe to changes.
 */

import { api } from './api-client.js'
import { DEFAULT_EDITOR_DEFAULTS, mergeEditorDefaults } from './editor-defaults-constants.js'
import { resolveEffectiveProgramLayout } from './program-audio-layouts.js'

/**
 * Merge GET/POST settings onto the in-memory cache. Keeps `editorDefaults` when the server omits them (WO-33).
 * @param {object} cfg
 */
export function applySettingsFromServer(cfg) {
	if (!cfg || typeof cfg !== 'object') return
	const prevEd = settingsState.settings?.editorDefaults
	Object.assign(settingsState.settings, cfg)
	settingsState.settings.editorDefaults = mergeEditorDefaults(
		cfg.editorDefaults != null ? cfg.editorDefaults : prevEd,
	)
	if (settingsState.settings.audioRouting && typeof settingsState.settings.audioRouting === 'object') {
		settingsState.settings.audioRouting = {
			...settingsState.settings.audioRouting,
			programLayout: resolveEffectiveProgramLayout(
				settingsState.settings,
				settingsState.settings.channelMap,
			),
		}
	}
}

export const settingsState = {
	settings: {
		editorDefaults: { ...DEFAULT_EDITOR_DEFAULTS },
		machineProfile: { defaultProjectFps: 50 },
		network: {
			primaryInterface: '',
			mode: 'dhcp',
			static: { address: '', prefixLength: 24, gateway: '', dns: [] },
		},
		caspar: { host: '127.0.0.1', port: 5250 },
		streaming: { enabled: true, quality: 'medium', basePort: 10000, hardware_accel: true },
		/** Mirrors server defaults so subscribers (e.g. DMX) see shape before GET /api/settings completes. */
		dmx: { enabled: false, debugLogDmx: false, fps: 25, fixtures: [] },
		periodic_sync_interval_sec: null,
		periodic_sync_interval_sec_osc: null,
		osc: {
			enabled: true,
			listenPort: 6251,
			listenAddress: '0.0.0.0',
			peakHoldMs: 2000,
		},
		ui: { oscFooterVu: true, rundownPlaybackTimer: true, nuclearRequirePassword: false, nuclearPassword: '', invertTouchpadScroll: false },
		composePreview: {
			mode: 'ffmpeg_jpeg',
			fps: 25,
			resolutionScale: 'half',
			jpegQuality: 10,
			basenamePrefix: 'highascg_preview',
			channels: 'compose_visible',
			companionThumbEnabled: true,
			companionThumbSize: 144,
			companionThumbIntervalMs: 1000,
		},
		/** Dedicated Caspar channel for RTMP/record (WO-27); tab visible when enabled */
		streamingChannel: { enabled: false, videoSource: 'program_1', audioSource: 'follow_video', audioSourcePair: 'all', dedicatedOutputChannel: false },
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
					applySettingsFromServer(cfg)
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
