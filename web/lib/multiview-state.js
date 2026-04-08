/**
 * Multiview layout state — draggable cells for PGM, PRV, Decklink.
 * Positions in pixels, converted to normalized 0–1 for MIXER FILL.
 * @see main_plan.md Prompt 15, HOW_TO_ACHIVE_MULTIVIEWER.MD
 */

const STORAGE_KEY = 'casparcg_multiview_layout'
/** Four quick-save slots (localStorage); first click saves, later clicks recall (see multiview-editor). */
const PRESETS_STORAGE_KEY = 'casparcg_multiview_presets_v1'
const DEFAULT_WIDTH = 1920
const DEFAULT_HEIGHT = 1080

/** Old PRV cells used route://N-11 (single preview layer). Scene content now uses the same layers as PGM (10+). */
function migratePreviewRouteSources(cells) {
	if (!Array.isArray(cells)) return cells
	return cells.map((c) => {
		const val =
			typeof c.source === 'object' && c.source != null && c.source.value != null ? c.source.value : c.source
		if (typeof val !== 'string' || !val.startsWith('route://')) return c
		const m = val.replace(/^route:\/\//, '').match(/^(\d+)-11$/)
		if (!m) return c
		const full = `route://${m[1]}`
		if (typeof c.source === 'object' && c.source != null) {
			return { ...c, source: { ...c.source, value: full } }
		}
		return { ...c, source: { value: full, type: 'route', label: c.label || `Preview` } }
	})
}

/**
 * @param {object} channelMap - From stateStore (programChannels, previewChannels, inputsCh, decklinkCount)
 * @param {number} cw - Canvas width
 * @param {number} ch - Canvas height
 * @returns {Array<{ id: string, type: string, label: string, x: number, y: number, w: number, h: number }>}
 */
function defaultLayout(channelMap, cw = DEFAULT_WIDTH, ch = DEFAULT_HEIGHT) {
	const cells = []
	const programChannels = channelMap?.programChannels || []
	const previewChannels = channelMap?.previewChannels || []
	const screenCount = Math.max(1, channelMap?.screenCount ?? 1)
	const decklinkCount = channelMap?.decklinkCount ?? 0
	const inputsCh = channelMap?.inputsCh

	const activeScreens = Math.min(screenCount, Math.max(programChannels.length, previewChannels.length))
	// Layout: each screen occupies a horizontal band — PGM on left half, PRV on right half
	const cellW = cw / 2
	const cellH = activeScreens > 0 ? Math.floor(ch / activeScreens) : ch

	for (let s = 0; s < activeScreens; s++) {
		const y = s * cellH
		const h = s === activeScreens - 1 ? ch - y : cellH  // last row fills to bottom
		// id convention: first screen uses legacy 'pgm'/'prv', rest use 'pgm_1','prv_1' etc.
		const pgmId = s === 0 ? 'pgm' : `pgm_${s}`
		const prvId = s === 0 ? 'prv' : `prv_${s}`
		const screenLabel = activeScreens > 1 ? ` S${s + 1}` : ''
		if (programChannels[s] != null) {
			cells.push({ id: pgmId, type: 'pgm', label: `PGM${screenLabel}`, screenIdx: s, x: 0, y, w: cellW, h })
		}
		if (previewChannels[s] != null) {
			cells.push({ id: prvId, type: 'prv', label: `PRV${screenLabel}`, screenIdx: s, x: cellW, y, w: cellW, h })
		}
	}

	if (inputsCh != null && decklinkCount > 0) {
		// Place decklinks below the screen rows if space allows, otherwise tile over full height
		const usedH = activeScreens * cellH
		const bottomH = ch - usedH
		if (bottomH >= 40) {
			const dlW = cw / Math.min(decklinkCount, 4)
			for (let i = 0; i < decklinkCount; i++) {
				cells.push({
					id: `decklink_${i}`,
					type: 'decklink',
					label: `DL ${i + 1}`,
					x: (i % 4) * dlW,
					y: usedH,
					w: dlW,
					h: bottomH / Math.ceil(decklinkCount / 4),
				})
			}
		}
	}
	return cells
}

export class MultiviewState {
	constructor() {
		this.canvasWidth = DEFAULT_WIDTH
		this.canvasHeight = DEFAULT_HEIGHT
		this.cells = []
		this.showOverlay = true
		this.audioActiveCellId = null
		this._listeners = new Map()
		this._load()
	}

	_load() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY)
			if (raw) {
				const data = JSON.parse(raw)
				if (Array.isArray(data.cells) && data.cells.length > 0) {
					const prev = data.cells
					this.cells = migratePreviewRouteSources(data.cells)
					this.canvasWidth = data.canvasWidth ?? DEFAULT_WIDTH
					this.canvasHeight = data.canvasHeight ?? DEFAULT_HEIGHT
					this.showOverlay = data.showOverlay !== false
					this.audioActiveCellId = data.audioActiveCellId || null
					if (JSON.stringify(this.cells) !== JSON.stringify(prev)) {
						queueMicrotask(() => this._save())
					}
					return
				}
			}
		} catch {}
		this.cells = []
	}

	_save() {
		try {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({
					cells: this.cells,
					canvasWidth: this.canvasWidth,
					canvasHeight: this.canvasHeight,
					showOverlay: this.showOverlay,
					audioActiveCellId: this.audioActiveCellId,
				})
			)
		} catch {}
		this._emit('change')
	}

	_emit(key) {
		const fns = this._listeners.get(key)
		if (fns) fns.forEach((fn) => fn())
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

	/**
	 * Reset to default layout from channel map.
	 */
	buildDefault(channelMap) {
		this.cells = defaultLayout(channelMap, this.canvasWidth, this.canvasHeight)
		this._save()
	}

	/** Remove all cells (Reset layout — empty multiview). */
	clearLayout() {
		this.cells = []
		this.audioActiveCellId = null
		this._save()
	}

	getCells() {
		return this.cells
	}

	getCell(id) {
		return this.cells.find((c) => c.id === id) || null
	}

	setCell(id, rect) {
		const cell = this.cells.find((c) => c.id === id)
		if (!cell) return
		Object.assign(cell, rect)
		this._save()
	}

	addCell(opts) {
		const id = opts.id || 'cell_' + Date.now().toString(36)
		const isLiveSource = ['route', 'pgm', 'prv', 'decklink'].includes(opts.type)
		const cell = {
			id,
			type: opts.type || 'media',
			label: opts.label || 'Cell',
			x: Math.round(opts.x ?? 0),
			y: Math.round(opts.y ?? 0),
			w: Math.round(opts.w ?? Math.round(this.canvasWidth / 4)),
			h: Math.round(opts.h ?? Math.round(this.canvasHeight / 4)),
			source: opts.source || null,
			aspectLocked: opts.aspectLocked ?? isLiveSource,
		}
		this.cells.push(cell)
		this._save()
		return cell
	}

	removeCell(id) {
		const idx = this.cells.findIndex((c) => c.id === id)
		if (idx >= 0) {
			this.cells.splice(idx, 1)
			this._save()
		}
	}

	setCanvasSize(w, h) {
		this.canvasWidth = w
		this.canvasHeight = h
		this._save()
	}

	setShowOverlay(v) {
		this.showOverlay = !!v
		this._save()
	}

	setAudioActiveCell(id) {
		this.audioActiveCellId = id
		this._save()
		this._emit('audio-change')
	}

	/** Export data for project save. */
	getExportData() {
		return {
			cells: this.cells,
			canvasWidth: this.canvasWidth,
			canvasHeight: this.canvasHeight,
			showOverlay: this.showOverlay,
		}
	}

	/** Load from project data (replaces current state, persists to localStorage). */
	loadFromData(data) {
		if (!data || !Array.isArray(data.cells)) return
		this.cells = migratePreviewRouteSources(data.cells)
		this.canvasWidth = data.canvasWidth ?? DEFAULT_WIDTH
		this.canvasHeight = data.canvasHeight ?? DEFAULT_HEIGHT
		this.showOverlay = data.showOverlay !== false
		this._save()
	}

	/**
	 * Assign a source (media/route/template) to a cell, overriding the default type-based route.
	 * @param {string} id - Cell id
	 * @param {{ value: string, label?: string, type?: string }} source
	 */
	setCellSource(id, source) {
		const cell = this.cells.find((c) => c.id === id)
		if (!cell) return
		cell.source = source ? { value: source.value, type: source.type, label: source.label || source.value } : null
		this._save()
	}

	/**
	 * Convert cells to normalized 0–1 for API (x, y, w, h).
	 * Clamps to valid range to avoid floating-point garbage (e.g. -2.6e-17) that can break CasparCG MIXER FILL.
	 */
	toApiLayout() {
		const cw = this.canvasWidth || 1
		const ch = this.canvasHeight || 1
		const clamp = (v) => Math.max(0, Math.min(1, v))
		return this.cells.map((c) => ({
			id: c.id,
			type: c.type,
			label: c.source ? (c.source.label || c.source.value) : c.label,
			x: clamp(c.x / cw),
			y: clamp(c.y / ch),
			w: clamp(c.w / cw),
			h: clamp(c.h / ch),
			source: c.source?.value || null,
		}))
	}

	/** Deep snapshot for preset slots 1–4. */
	snapshotForPreset() {
		return {
			cells: JSON.parse(JSON.stringify(this.cells)),
			canvasWidth: this.canvasWidth,
			canvasHeight: this.canvasHeight,
			showOverlay: this.showOverlay,
			audioActiveCellId: this.audioActiveCellId,
		}
	}

	/** Replace layout from a preset snapshot (persists + emits change). */
	applyPresetSnapshot(snapshot) {
		if (!snapshot || !Array.isArray(snapshot.cells)) return
		this.cells = migratePreviewRouteSources(JSON.parse(JSON.stringify(snapshot.cells)))
		this.canvasWidth = snapshot.canvasWidth ?? this.canvasWidth
		this.canvasHeight = snapshot.canvasHeight ?? this.canvasHeight
		this.showOverlay = snapshot.showOverlay !== false
		this.audioActiveCellId = snapshot.audioActiveCellId ?? null
		this._save()
	}

	/** @returns {(object | null)[]} length 4 — null = slot never saved */
	getPresetSlots() {
		try {
			const raw = localStorage.getItem(PRESETS_STORAGE_KEY)
			if (raw) {
				const arr = JSON.parse(raw)
				if (Array.isArray(arr) && arr.length === 4) return arr
			}
		} catch {}
		return [null, null, null, null]
	}

	/** @param {number} index 0–3 */
	savePresetSlot(index, snapshot) {
		if (index < 0 || index > 3 || !snapshot) return
		const slots = this.getPresetSlots()
		slots[index] = snapshot
		try {
			localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(slots))
		} catch {}
	}

	/** Clear a preset slot (Shift+click in multiview editor). */
	clearPresetSlot(index) {
		if (index < 0 || index > 3) return
		const slots = this.getPresetSlots()
		slots[index] = null
		try {
			localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(slots))
		} catch {}
	}
}

export const multiviewState = new MultiviewState()
export default MultiviewState
