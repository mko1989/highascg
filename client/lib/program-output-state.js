/**
 * Program output UI state — per-main PGM layer mixer rectangles (labels + pixel mixer settings).
 * Persists to localStorage per scene “main” index (aligned with {@link sceneState.activeScreenIndex}).
 * Legacy Millumin-style column/grid data is ignored on load.
 */

import { sceneState } from './scene-state.js'

export {
	DEFAULT_TRANSITION,
	TRANSITION_TYPES,
	TRANSITION_TWEENS,
	TRANSITION_TYPE_LABELS,
	PGM_ONLY_TRANSITION_TYPES,
	migrateTransitionTypeToAnimate,
	normalizeTransitionForPgmOnly,
} from './transition-presets.js'

const STORAGE_KEY = 'casparcg_program_output'
const STORAGE_LEGACY = 'casparcg_dashboard'
const DEFAULT_LAYER_COUNT = 9

const FALLBACK_RESOLUTION = { w: 1920, h: 1080 }

function storageKey(screenIdx) {
	return screenIdx === 0 ? STORAGE_KEY : `${STORAGE_KEY}_s${screenIdx}`
}

function legacyStorageKey(screenIdx) {
	return screenIdx === 0 ? STORAGE_LEGACY : `${STORAGE_LEGACY}_s${screenIdx}`
}

export function defaultLayerSetting(resolution) {
	const res = resolution && resolution.w > 0 && resolution.h > 0 ? resolution : FALLBACK_RESOLUTION
	return {
		x: 0,
		y: 0,
		w: res.w,
		h: res.h,
		opacity: 1,
		volume: 1,
		audioRoute: '1+2',
		blend: 'normal',
		stretch: 'none',
		aspectLocked: false,
	}
}

export class ProgramOutputState {
	constructor() {
		this.layerCount = DEFAULT_LAYER_COUNT
		this.layerNames = Array.from({ length: DEFAULT_LAYER_COUNT }, (_, i) => `Layer ${i + 1}`)
		this._canvasResolutions = []
		const res = this._getCanvasResolution(this._screenIdx())
		this.layerSettings = Array.from({ length: DEFAULT_LAYER_COUNT }, () => defaultLayerSetting(res))
		this._listeners = new Map()
		this._load(this._screenIdx())
		sceneState.on('screenChange', () => {
			this._load(this._screenIdx())
			this._emit('change', null)
		})
	}

	_screenIdx() {
		return sceneState.activeScreenIndex ?? 0
	}

	setCanvasResolutions(resolutions) {
		if (!Array.isArray(resolutions)) return
		this._canvasResolutions = resolutions.map((r) => (r?.w > 0 && r?.h > 0 ? { w: r.w, h: r.h } : FALLBACK_RESOLUTION))
		this._applyCanvasSizeToUnsetDefaults(this._screenIdx())
		this._save()
	}

	_getCanvasResolution(screenIdx) {
		const r = this._canvasResolutions[screenIdx]
		return r?.w > 0 && r?.h > 0 ? r : FALLBACK_RESOLUTION
	}

	_applyCanvasSizeToUnsetDefaults(screenIdx) {
		const res = this._getCanvasResolution(screenIdx)
		if (res.w === FALLBACK_RESOLUTION.w && res.h === FALLBACK_RESOLUTION.h) return
		for (let i = 0; i < this.layerSettings.length; i++) {
			const ls = this.layerSettings[i]
			if (ls?.w === FALLBACK_RESOLUTION.w && ls?.h === FALLBACK_RESOLUTION.h) {
				this.layerSettings[i] = { ...ls, w: res.w, h: res.h }
			}
		}
	}

	_tryParseStored(raw, screenIdx) {
		try {
			const data = JSON.parse(raw)
			if (!data || typeof data !== 'object') return false
			const res = this._getCanvasResolution(screenIdx)
			if (Array.isArray(data.layerNames)) {
				this.layerNames = data.layerNames.slice(0, DEFAULT_LAYER_COUNT)
				while (this.layerNames.length < DEFAULT_LAYER_COUNT) {
					this.layerNames.push(`Layer ${this.layerNames.length + 1}`)
				}
			}
			if (Array.isArray(data.layerSettings)) {
				this.layerSettings = data.layerSettings.map((s) => ({ ...defaultLayerSetting(res), ...s }))
				while (this.layerSettings.length < DEFAULT_LAYER_COUNT) {
					this.layerSettings.push(defaultLayerSetting(res))
				}
			} else {
				this.layerNames = Array.from({ length: DEFAULT_LAYER_COUNT }, (_, i) => `Layer ${i + 1}`)
				this.layerSettings = Array.from({ length: DEFAULT_LAYER_COUNT }, () => defaultLayerSetting(res))
			}
			this._applyCanvasSizeToUnsetDefaults(screenIdx)
			return true
		} catch {
			return false
		}
	}

	_load(screenIdx) {
		let raw = null
		try {
			raw = localStorage.getItem(storageKey(screenIdx))
		} catch {}
		if (raw && this._tryParseStored(raw, screenIdx)) return

		try {
			raw = localStorage.getItem(legacyStorageKey(screenIdx))
		} catch {}
		if (raw && this._tryParseStored(raw, screenIdx)) {
			try {
				localStorage.setItem(storageKey(screenIdx), raw)
			} catch {}
			return
		}

		const res = this._getCanvasResolution(screenIdx)
		this.layerNames = Array.from({ length: DEFAULT_LAYER_COUNT }, (_, i) => `Layer ${i + 1}`)
		this.layerSettings = Array.from({ length: DEFAULT_LAYER_COUNT }, () => defaultLayerSetting(res))
		this._applyCanvasSizeToUnsetDefaults(screenIdx)
	}

	_save() {
		const screenIdx = this._screenIdx()
		const key = storageKey(screenIdx)
		try {
			localStorage.setItem(
				key,
				JSON.stringify({
					layerNames: this.layerNames,
					layerSettings: this.layerSettings,
				}),
			)
		} catch {}
		this._emit('change', null)
	}

	getLayerName(layerIdx) {
		return this.layerNames[layerIdx] ?? `Layer ${layerIdx + 1}`
	}

	setLayerName(layerIdx, name) {
		if (layerIdx < 0 || layerIdx >= DEFAULT_LAYER_COUNT) return
		this.layerNames[layerIdx] = name || `Layer ${layerIdx + 1}`
		this._save()
	}

	getLayerSetting(layerIdx) {
		const res = this._getCanvasResolution(this._screenIdx())
		return { ...defaultLayerSetting(res), ...(this.layerSettings[layerIdx] || {}) }
	}

	setLayerSetting(layerIdx, patch) {
		if (layerIdx < 0 || layerIdx >= DEFAULT_LAYER_COUNT) return
		this.layerSettings[layerIdx] = { ...this.getLayerSetting(layerIdx), ...patch }
		this._save()
		this._emit('layerSettingChange', layerIdx)
	}

	on(key, fn) {
		if (!this._listeners.has(key)) this._listeners.set(key, [])
		this._listeners.get(key).push(fn)
		return () => {
			const fns = this._listeners.get(key)
			if (fns) {
				const i = fns.indexOf(fn)
				if (i >= 0) fns.splice(i, 1)
			}
		}
	}

	_emit(key, data) {
		const fns = this._listeners.get(key)
		if (fns) fns.forEach((fn) => fn(data))
	}

	/** Export for project save (current main only — matches prior dashboard export behaviour). */
	getExportData() {
		return {
			layerNames: [...this.layerNames],
			layerSettings: JSON.parse(JSON.stringify(this.layerSettings)),
		}
	}

	resetForNewProject(opts = {}) {
		this.resetAllMainsForNewProject(opts)
	}

	resetAllMainsForNewProject(opts = {}) {
		const MAIN_COUNT = 4
		const active = this._screenIdx()
		for (let screenIdx = 0; screenIdx < MAIN_COUNT; screenIdx++) {
			const res = this._getCanvasResolution(screenIdx)
			const layerNames = Array.from({ length: DEFAULT_LAYER_COUNT }, (_, i) => `Layer ${i + 1}`)
			const layerSettings = Array.from({ length: DEFAULT_LAYER_COUNT }, () => defaultLayerSetting(res))
			try {
				localStorage.setItem(
					storageKey(screenIdx),
					JSON.stringify({ layerNames, layerSettings }),
				)
			} catch {}
			if (screenIdx === active) {
				this.layerNames = layerNames
				this.layerSettings = layerSettings
				this._applyCanvasSizeToUnsetDefaults(screenIdx)
			}
		}
		if (!opts.silent) this._emit('change', null)
	}

	/**
	 * Load from project JSON. Accepts new `programOutput` shape or legacy `dashboard` blobs;
	 * column/grid fields are ignored.
	 */
	loadFromData(data, opts = {}) {
		if (!data || typeof data !== 'object') return
		const res = this._getCanvasResolution(this._screenIdx())
		if (Array.isArray(data.layerNames)) {
			this.layerNames = data.layerNames.slice(0, DEFAULT_LAYER_COUNT)
			while (this.layerNames.length < DEFAULT_LAYER_COUNT) {
				this.layerNames.push(`Layer ${this.layerNames.length + 1}`)
			}
		}
		if (Array.isArray(data.layerSettings)) {
			this.layerSettings = data.layerSettings.map((s) => ({ ...defaultLayerSetting(res), ...s }))
			while (this.layerSettings.length < DEFAULT_LAYER_COUNT) {
				this.layerSettings.push(defaultLayerSetting(res))
			}
		}
		this._applyCanvasSizeToUnsetDefaults(this._screenIdx())
		if (opts.silent) {
			try {
				localStorage.setItem(
					storageKey(this._screenIdx()),
					JSON.stringify({ layerNames: this.layerNames, layerSettings: this.layerSettings }),
				)
			} catch {}
		} else {
			this._save()
		}
	}

	persist() {
		this._save()
	}
}

export const programOutputState = new ProgramOutputState()
export default ProgramOutputState
