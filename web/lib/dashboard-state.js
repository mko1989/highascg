/**
 * Dashboard state — columns and layers (Millumin-style).
 * columns[] → layers[] → { source, position, size, opacity, overrides }
 * Save/load via local storage. DATA STORE integration in Prompt 20.
 * @see main_plan.md Prompt 13
 */

const STORAGE_KEY_BASE = 'casparcg_dashboard'
const DEFAULT_LAYER_COUNT = 9

/** Caspar layer 9 = black HTML CG (PGM+PRV); dashboard rows use 10..(10+DEFAULT_LAYER_COUNT-1) so content sits above black. */
export const DASHBOARD_CASPAR_LAYER_BASE = 10

/** @param {number} layerIdx - 0-based dashboard row */
export function dashboardCasparLayer(layerIdx) {
	return DASHBOARD_CASPAR_LAYER_BASE + layerIdx
}

function screenKey(screenIdx) {
	return screenIdx === 0 ? STORAGE_KEY_BASE : `${STORAGE_KEY_BASE}_s${screenIdx}`
}

/** Default transition: CUT with 0 duration = instant switch */
export const DEFAULT_TRANSITION = { type: 'CUT', duration: 0, tween: 'linear' }

export const TRANSITION_TYPES = ['CUT', 'MIX', 'PUSH', 'WIPE', 'SLIDE']
export const TRANSITION_TWEENS = ['linear', 'easein', 'easeout', 'easeboth']

/** Stretch mode choices for layer content scaling */
export const STRETCH_MODES = ['none', 'fit', 'stretch', 'fill-h', 'fill-v']

/** Fallback when canvas resolution unknown */
const FALLBACK_RESOLUTION = { w: 1920, h: 1080 }

/**
 * Per-layer mixer settings — position, size, opacity, volume, blend, stretch.
 * Always applied to the layer (no overrides). Stored in pixels for position/size.
 * @param {{ w: number, h: number }} [resolution] - Canvas size for this layer's screen (default: 1920×1080)
 */
export function defaultLayerSetting(resolution) {
	const res = resolution && resolution.w > 0 && resolution.h > 0 ? resolution : FALLBACK_RESOLUTION
	return {
		x: 0,
		y: 0,
		w: res.w,
		h: res.h,
		opacity: 1,
		volume: 1,
		/** Stereo pair within the program master bus (see scene-take / AMCP AF pan). */
		audioRoute: '1+2',
		blend: 'normal',
		stretch: 'none',
		aspectLocked: false,
	}
}

function defaultLayer() {
	return { source: null, overrides: {} }
}

function defaultColumn(colIdx) {
	return {
		name: `Column ${(colIdx ?? 0) + 1}`,
		layers: Array.from({ length: DEFAULT_LAYER_COUNT }, () => ({ ...defaultLayer() })),
		transition: { ...DEFAULT_TRANSITION },
	}
}

export class DashboardState {
	constructor(options = {}) {
		this.layerCount = options.layerCount ?? DEFAULT_LAYER_COUNT
		this.columns = []
		this.activeColumnIndex = -1
		this.activeScreenIndex = 0
		this.layerNames = Array.from({ length: DEFAULT_LAYER_COUNT }, (_, i) => `Layer ${i + 1}`)
		this._canvasResolutions = []
		const res = this._getCanvasResolution(this.activeScreenIndex)
		this.layerSettings = Array.from({ length: DEFAULT_LAYER_COUNT }, () => defaultLayerSetting(res))
		this._listeners = new Map()
		this._load(0)
	}

	/** Canvas size per screen (from channelMap.programResolutions). Call when state loads. */
	setCanvasResolutions(resolutions) {
		if (!Array.isArray(resolutions)) return
		this._canvasResolutions = resolutions.map((r) => (r?.w > 0 && r?.h > 0 ? { w: r.w, h: r.h } : FALLBACK_RESOLUTION))
		this._applyCanvasSizeToUnsetDefaults(this.activeScreenIndex)
		this._save()
	}

	_getCanvasResolution(screenIdx) {
		const r = this._canvasResolutions[screenIdx]
		return r?.w > 0 && r?.h > 0 ? r : FALLBACK_RESOLUTION
	}

	/** Update layer settings that still have fallback 1920×1080 to use the canvas size. */
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

	_load(screenIdx) {
		const key = screenKey(screenIdx)
		try {
			const raw = localStorage.getItem(key)
			if (raw) {
				const data = JSON.parse(raw)
				if (Array.isArray(data.columns) && data.columns.length > 0) {
					this.columns = data.columns.map((col, i) => ({
						...defaultColumn(i),
						name: col.name || `Column ${i + 1}`,
						layers: (col.layers || []).map((l) => ({ ...defaultLayer(), ...l })),
						transition: { ...DEFAULT_TRANSITION, ...col.transition },
					}))
					this.activeColumnIndex = typeof data.activeColumnIndex === 'number' ? data.activeColumnIndex : -1
					if (Array.isArray(data.layerNames)) {
						this.layerNames = data.layerNames.slice(0, DEFAULT_LAYER_COUNT)
						while (this.layerNames.length < DEFAULT_LAYER_COUNT) {
							this.layerNames.push(`Layer ${this.layerNames.length + 1}`)
						}
					}
					if (Array.isArray(data.layerSettings)) {
						const res = this._getCanvasResolution(screenIdx)
						this.layerSettings = data.layerSettings.map((s) => ({ ...defaultLayerSetting(res), ...s }))
						while (this.layerSettings.length < DEFAULT_LAYER_COUNT) {
							this.layerSettings.push(defaultLayerSetting(res))
						}
					} else {
						const res = this._getCanvasResolution(screenIdx)
						this.layerSettings = Array.from({ length: DEFAULT_LAYER_COUNT }, () => defaultLayerSetting(res))
					}
					this._applyCanvasSizeToUnsetDefaults(screenIdx)
					return
				}
			}
		} catch {}
		this.columns = [defaultColumn(0)]
		this.layerNames = Array.from({ length: DEFAULT_LAYER_COUNT }, (_, i) => `Layer ${i + 1}`)
		const res = this._getCanvasResolution(screenIdx)
		this.layerSettings = Array.from({ length: DEFAULT_LAYER_COUNT }, () => defaultLayerSetting(res))
		this._applyCanvasSizeToUnsetDefaults(screenIdx)
	}

	_save() {
		const key = screenKey(this.activeScreenIndex)
		try {
			localStorage.setItem(
				key,
				JSON.stringify({
					columns: this.columns,
					activeColumnIndex: this.activeColumnIndex,
					layerNames: this.layerNames,
					layerSettings: this.layerSettings,
				})
			)
		} catch {}
		this._emit('change', null)
	}

	/** Switch to a different screen's state. Saves current before loading new. */
	switchScreen(screenIdx) {
		if (screenIdx === this.activeScreenIndex) return
		this._save()
		this.activeScreenIndex = screenIdx
		this._load(screenIdx)
		this._emit('change', null)
		this._emit('screenChange', screenIdx)
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
		const res = this._getCanvasResolution(this.activeScreenIndex)
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

	getColumns() {
		return this.columns
	}

	addColumn() {
		const newCol = defaultColumn(this.columns.length)
		if (this.columns.length > 0) {
			const prev = this.columns[this.columns.length - 1]
			newCol.layers = prev.layers.map(() => ({ ...defaultLayer() }))
			if (prev.transition) newCol.transition = { ...prev.transition }
		}
		this.columns.push(newCol)
		this._save()
		return this.columns.length - 1
	}

	removeColumn(index) {
		if (index < 0 || index >= this.columns.length) return
		this.columns.splice(index, 1)
		if (this.activeColumnIndex >= this.columns.length) this.activeColumnIndex = this.columns.length - 1
		if (this.activeColumnIndex === index) this.activeColumnIndex = -1
		else if (this.activeColumnIndex > index) this.activeColumnIndex--
		if (this.columns.length === 0) this.columns.push(defaultColumn(0))
		this._save()
	}

	getCell(colIdx, layerIdx) {
		const col = this.columns[colIdx]
		if (!col || !col.layers) return defaultLayer()
		const layer = col.layers[layerIdx]
		return layer ? { ...defaultLayer(), ...layer } : defaultLayer()
	}

	setCellSource(colIdx, layerIdx, source) {
		const col = this.columns[colIdx]
		if (!col || !col.layers[layerIdx]) return
		col.layers[layerIdx].source = source
		this._save()
	}

	setCellOverrides(colIdx, layerIdx, overrides) {
		const col = this.columns[colIdx]
		if (!col || !col.layers[layerIdx]) return
		const layer = col.layers[layerIdx]
		if (!layer.overrides) layer.overrides = {}
		// Delete keys explicitly set to undefined so stale overrides can't shadow column settings
		for (const key of Object.keys(overrides)) {
			if (overrides[key] === undefined) delete layer.overrides[key]
			else layer.overrides[key] = overrides[key]
		}
		this._save()
	}

	setActiveColumn(index) {
		this.activeColumnIndex = index
		this._save()
		this._emit('activeColumn', index)
	}

	getActiveColumn() {
		return this.activeColumnIndex
	}

	getActiveColumnIndex() {
		return this.activeColumnIndex
	}

	setActiveColumnIndex(index) {
		this.setActiveColumn(index)
	}

	getColumn(index) {
		return this.columns[index] || null
	}

	/** Export for project save. */
	getExportData() {
		return {
			columns: JSON.parse(JSON.stringify(this.columns)),
			activeColumnIndex: this.activeColumnIndex,
			layerNames: [...this.layerNames],
			layerSettings: JSON.parse(JSON.stringify(this.layerSettings)),
		}
	}

	/** Single empty column + default layer names/settings for the active screen (new project). */
	resetForNewProject() {
		this.columns = [defaultColumn(0)]
		this.activeColumnIndex = -1
		this.layerNames = Array.from({ length: DEFAULT_LAYER_COUNT }, (_, i) => `Layer ${i + 1}`)
		const res = this._getCanvasResolution(this.activeScreenIndex)
		this.layerSettings = Array.from({ length: DEFAULT_LAYER_COUNT }, () => defaultLayerSetting(res))
		this._applyCanvasSizeToUnsetDefaults(this.activeScreenIndex)
		this._save()
	}

	/** Load from project data (replaces state, persists to localStorage). */
	loadFromData(data) {
		if (!data || !Array.isArray(data.columns)) return
		this.columns = data.columns.map((col) => ({
			layers: (col.layers || []).map((l) => ({ ...defaultLayer(), ...l })),
			transition: { ...DEFAULT_TRANSITION, ...col.transition },
		}))
		this.activeColumnIndex = typeof data.activeColumnIndex === 'number' ? data.activeColumnIndex : -1
		if (Array.isArray(data.layerSettings)) {
			const res = this._getCanvasResolution(this.activeScreenIndex)
			this.layerSettings = data.layerSettings.map((s) => ({ ...defaultLayerSetting(res), ...s }))
			while (this.layerSettings.length < DEFAULT_LAYER_COUNT) this.layerSettings.push(defaultLayerSetting(res))
		}
		if (Array.isArray(data.layerNames)) {
			this.layerNames = data.layerNames.slice(0, DEFAULT_LAYER_COUNT)
			while (this.layerNames.length < DEFAULT_LAYER_COUNT) this.layerNames.push(`Layer ${this.layerNames.length + 1}`)
		}
		this._save()
		this._emit('change', null)
		this._emit('activeColumn', this.activeColumnIndex)
	}

	setColumnTransition(colIdx, transition) {
		const col = this.columns[colIdx]
		if (!col) return
		col.transition = { ...DEFAULT_TRANSITION, ...col.transition, ...transition }
		this._save()
	}

	getColumnName(colIdx) {
		const col = this.columns[colIdx]
		return col?.name || `Column ${colIdx + 1}`
	}

	setColumnName(colIdx, name) {
		const col = this.columns[colIdx]
		if (!col) return
		col.name = (name || '').trim() || `Column ${colIdx + 1}`
		this._save()
	}

	/** Resolve effective transition for a layer: layer override > column default. Duration in frames. */
	getTransitionForLayer(colIdx, layerIdx) {
		const col = this.columns[colIdx]
		const colTrans = col?.transition || { ...DEFAULT_TRANSITION }
		const layer = col?.layers?.[layerIdx]
		const ov = layer?.overrides
		if (ov && (ov.transition != null || ov.transitionDuration != null || ov.transitionTween != null)) {
			return {
				type: ov.transition ?? colTrans.type,
				duration: ov.transitionDuration ?? colTrans.duration,
				tween: ov.transitionTween ?? colTrans.tween,
			}
		}
		return { ...colTrans }
	}

	persist() {
		this._save()
	}
}

export const dashboardState = new DashboardState()
export default DashboardState
