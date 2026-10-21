/**
 * Multiview layout state — draggable cells for PGM, PRV, Decklink.
 * Positions in pixels, converted to normalized 0–1 for MIXER FILL.
 * @see main_plan.md Prompt 15, HOW_TO_ACHIVE_MULTIVIEWER.MD
 */

import { DEFAULT_WIDTH, DEFAULT_HEIGHT, migratePreviewRouteSources, defaultLayout, cellsToApiLayout } from './multiview-state-layout.js'
import { getClientPref, setClientPref, onClientPrefsChange } from './client-prefs.js'

const STORAGE_KEY_BASE = 'casparcg_multiview_layout'
/** Four quick-save slots; first click saves, later clicks recall (see multiview-editor). */
const PRESETS_STORAGE_KEY_BASE = 'casparcg_multiview_presets_v1'

/* WO-598 D: every multiviewer's presets and multiviewer 2+ layouts live on the node (client-prefs mirror) so the
 * Godot client sees them too; localStorage is written alongside as the offline fallback. Multiviewer 1's layout
 * is the project's multiview slice. */
const storageKey = (kind, idx) => {
	const base = kind === 'presets' ? PRESETS_STORAGE_KEY_BASE : STORAGE_KEY_BASE
	return idx === 1 ? base : `${base}_${idx}`
}
const prefKey = (kind, idx) => (kind === 'presets' ? 'multiviewPresets' : idx === 1 ? null : 'multiviewLayouts')

function readStored(kind, idx) {
	const pk = prefKey(kind, idx)
	const v = pk ? getClientPref(pk, idx) : undefined
	if (v !== undefined) return v == null ? null : JSON.parse(JSON.stringify(v))
	try {
		const raw = localStorage.getItem(storageKey(kind, idx))
		return raw ? JSON.parse(raw) : null
	} catch {
		return null
	}
}

function writeStored(kind, idx, value) {
	try {
		localStorage.setItem(storageKey(kind, idx), JSON.stringify(value))
	} catch {}
	const pk = prefKey(kind, idx)
	if (pk) setClientPref(pk, idx, value)
}

export class MultiviewState {
	constructor() {
		this.currentIndex = 1
		this.canvasWidth = DEFAULT_WIDTH
		this.canvasHeight = DEFAULT_HEIGHT
		this.cells = []
		this.showOverlay = true
		this.bgColor = '#000000'
		this.showTimersUnderLabels = false
		this.timerScale = 100
		this.highlightTopTimer = true
		this.autoApply = true
		this.audioActiveCellId = null
		/** FIX-1 (2026-07-15 review, WO-206 finding 1): true while a cell drag (move/resize) is in progress. */
		this.dragInProgress = false
		this._listeners = new Map()
		this._load()
		onClientPrefsChange((d) => this._onClientPrefs(d))
	}

	/**
	 * FIX-1: gate for the 'apply-request' listener — while a drag is in progress, mid-drag
	 * `setCell()` calls must not schedule an auto-apply with unfinished geometry. The editor's
	 * drag-end handler (mouseup/mouseleave) calls this with `false`, which fires exactly one
	 * final 'apply-request' for the now-settled rect.
	 * @param {boolean} v
	 */
	setDragInProgress(v) {
		const was = this.dragInProgress
		this.dragInProgress = !!v
		if (was && !this.dragInProgress) {
			this._emit('apply-request')
		}
	}

	switchTo(index) {
		const next = Math.max(1, parseInt(index, 10) || 1)
		if (this.currentIndex === next) return
		this.currentIndex = next
		this._load()
		this._emit('change')
	}

	_load() {
		try {
			const data = readStored('layout', this.currentIndex)
			if (data) {
				if (Array.isArray(data.cells) && data.cells.length > 0) {
					const prev = data.cells
					this.cells = migratePreviewRouteSources(data.cells)
					this.canvasWidth = data.canvasWidth ?? DEFAULT_WIDTH
					this.canvasHeight = data.canvasHeight ?? DEFAULT_HEIGHT
					this.showOverlay = data.showOverlay !== false
					this.bgColor = data.bgColor || '#000000'
					this.showTimersUnderLabels = !!data.showTimersUnderLabels
					this.timerScale = Math.max(50, Math.min(300, Number(data.timerScale) || 100))
					this.highlightTopTimer = data.highlightTopTimer !== false
					this.autoApply = data.autoApply !== false
					this.audioActiveCellId = data.audioActiveCellId || null
					if (JSON.stringify(this.cells) !== JSON.stringify(prev)) {
						// Route migration only — do not re-push the full multiview to Caspar on refresh
						queueMicrotask(() => this._save(false))
					}
					return
				}
			}
		} catch {}
		this.cells = []
	}

	/**
	 * @param {boolean} [applyToCaspar] - when false, persist + redraw clients only; skip `/api/multiview/apply` (server sync, project load, audio focus, canvas size).
	 */
	_save(applyToCaspar = true) {
		this._persistLayout(applyToCaspar, true)
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

	/**
	 * Change the pixel basis cells are stored in. Cell rects are **rescaled** so the normalized
	 * layout (`toApiLayout`) — i.e. what is applied to CasparCG — is unchanged. Without this, a
	 * channel-map resolution sync silently changed the normalization basis and the next apply
	 * (e.g. toggling "Timers under labels") resized every cell on the multiview (WO-151 B151.1).
	 */
	setCanvasSize(w, h) {
		const nw = Math.max(1, Math.floor(Number(w)) || 0)
		const nh = Math.max(1, Math.floor(Number(h)) || 0)
		if (nw === this.canvasWidth && nh === this.canvasHeight) return
		const ow = this.canvasWidth
		const oh = this.canvasHeight
		if (ow > 0 && oh > 0 && Array.isArray(this.cells) && this.cells.length > 0) {
			const sx = nw / ow
			const sy = nh / oh
			for (const c of this.cells) {
				c.x = c.x * sx
				c.y = c.y * sy
				c.w = c.w * sx
				c.h = c.h * sy
			}
		}
		this.canvasWidth = nw
		this.canvasHeight = nh
		this._save(false)
	}

	setShowOverlay(v) {
		this.showOverlay = !!v
		this._save()
	}

	setShowTimersUnderLabels(v) {
		this.showTimersUnderLabels = !!v
		this._save()
	}

	setTimerScale(v) {
		this.timerScale = Math.max(50, Math.min(300, Number(v) || 100))
		this._save()
	}

	setHighlightTopTimer(v) {
		this.highlightTopTimer = !!v
		this._save()
	}

	setAutoApply(v) {
		this.autoApply = !!v
		this._save(false)
	}

	/** Set multiview background color (layer 10). */
	setBgColor(color) {
		this.bgColor = typeof color === 'string' && color.trim() ? color.trim() : '#000000'
		this._save()
	}

	setAudioActiveCell(id) {
		this.audioActiveCellId = id
		this._save(false)
		this._emit('audio-change')
	}

	/** Export data for project save. */
	getExportData() {
		return {
			cells: this.cells,
			canvasWidth: this.canvasWidth,
			canvasHeight: this.canvasHeight,
			showOverlay: this.showOverlay,
			bgColor: this.bgColor,
			showTimersUnderLabels: this.showTimersUnderLabels,
			timerScale: this.timerScale,
			highlightTopTimer: this.highlightTopTimer,
			autoApply: this.autoApply,
		}
	}

	/** Load from project data (replaces current state, persists to localStorage). */
	loadFromData(data, opts = {}) {
		if (!data || !Array.isArray(data.cells)) return
		this.cells = migratePreviewRouteSources(data.cells)
		this.canvasWidth = data.canvasWidth ?? DEFAULT_WIDTH
		this.canvasHeight = data.canvasHeight ?? DEFAULT_HEIGHT
		this.showOverlay = data.showOverlay !== false
		this.bgColor = data.bgColor || '#000000'
		this.showTimersUnderLabels = !!data.showTimersUnderLabels
		this.timerScale = Math.max(50, Math.min(300, Number(data.timerScale) || 100))
		this.highlightTopTimer = data.highlightTopTimer !== false
		this.autoApply = data.autoApply !== false
		// Do not re-apply the whole layout to Caspar on every WebUI refresh / project hydrate
		this._persistLayout(false, !opts.silent)
	}

	_persistLayout(applyToCaspar, emitChange) {
		writeStored('layout', this.currentIndex, {
			cells: this.cells,
			canvasWidth: this.canvasWidth,
			canvasHeight: this.canvasHeight,
			showOverlay: this.showOverlay,
			bgColor: this.bgColor,
			showTimersUnderLabels: this.showTimersUnderLabels,
			timerScale: this.timerScale,
			highlightTopTimer: this.highlightTopTimer,
			autoApply: this.autoApply,
			audioActiveCellId: this.audioActiveCellId,
		})
		if (emitChange) this._emit('change')
		if (applyToCaspar) this._emit('apply-request')
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
		return cellsToApiLayout(this.cells, this.canvasWidth, this.canvasHeight)
	}

	/**
	 * Full `/api/multiview/apply` body for multiviewer `n` — live state for the currently edited
	 * index, persisted localStorage layout for the others. Null when nothing is stored.
	 * WO-156 T156.5: lets "Refresh output" re-apply every configured multiviewer.
	 * @param {number} n — 1-based multiviewer index
	 * @returns {{ n: number, layout: object[], showOverlay: boolean, bgColor: string, showTimersUnderLabels: boolean, timerScale: number, highlightTopTimer: boolean } | null}
	 */
	getApplyBodyForIndex(n) {
		const idx = Math.max(1, parseInt(n, 10) || 1)
		if (idx === this.currentIndex) {
			if (!Array.isArray(this.cells) || this.cells.length === 0) return null
			return {
				n: idx,
				layout: this.toApiLayout(),
				showOverlay: this.showOverlay,
				bgColor: this.bgColor,
				showTimersUnderLabels: this.showTimersUnderLabels,
				timerScale: this.timerScale,
				highlightTopTimer: this.highlightTopTimer,
			}
		}
		try {
			const data = readStored('layout', idx)
			if (!data || !Array.isArray(data.cells) || data.cells.length === 0) return null
			return {
				n: idx,
				layout: cellsToApiLayout(data.cells, data.canvasWidth ?? DEFAULT_WIDTH, data.canvasHeight ?? DEFAULT_HEIGHT),
				showOverlay: data.showOverlay !== false,
				bgColor: data.bgColor || '#000000',
				showTimersUnderLabels: !!data.showTimersUnderLabels,
				timerScale: Math.max(50, Math.min(300, Number(data.timerScale) || 100)),
				highlightTopTimer: data.highlightTopTimer !== false,
			}
		} catch {
			return null
		}
	}

	/** Deep snapshot for preset slots 1–4. */
	snapshotForPreset() {
		return {
			cells: JSON.parse(JSON.stringify(this.cells)),
			canvasWidth: this.canvasWidth,
			canvasHeight: this.canvasHeight,
			showOverlay: this.showOverlay,
			bgColor: this.bgColor,
			showTimersUnderLabels: this.showTimersUnderLabels,
			timerScale: this.timerScale,
			highlightTopTimer: this.highlightTopTimer,
			autoApply: this.autoApply,
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
		this.bgColor = snapshot.bgColor || this.bgColor
		this.showTimersUnderLabels = !!snapshot.showTimersUnderLabels
		this.timerScale = Math.max(50, Math.min(300, Number(snapshot.timerScale) || 100))
		this.highlightTopTimer = snapshot.highlightTopTimer !== false
		this.autoApply = snapshot.autoApply !== false
		this.audioActiveCellId = snapshot.audioActiveCellId ?? null
		this._save()
	}

	/** @returns {(object | null)[]} length 4 — null = slot never saved */
	getPresetSlots() {
		const arr = readStored('presets', this.currentIndex)
		return Array.isArray(arr) && arr.length === 4 ? arr : [null, null, null, null]
	}

	/** @param {number} index 0–3 */
	savePresetSlot(index, snapshot) {
		if (index < 0 || index > 3 || !snapshot) return
		const slots = this.getPresetSlots()
		slots[index] = snapshot
		writeStored('presets', this.currentIndex, slots)
	}

	/** Clear a preset slot (Shift+click in multiview editor). */
	clearPresetSlot(index) {
		if (index < 0 || index > 3) return
		const slots = this.getPresetSlots()
		slots[index] = null
		writeStored('presets', this.currentIndex, slots)
	}

	/**
	 * WO-598 D: the node's copy arrived (boot / reconnect) or another client wrote one. On load, entries only this
	 * browser had are pushed up once; a change to the open multiviewer reloads it (not mid-drag).
	 */
	_onClientPrefs(detail) {
		if (detail.loaded) {
			for (let n = 1; n <= 4; n++) {
				for (const kind of ['presets', 'layout']) {
					const pk = prefKey(kind, n)
					if (!pk || getClientPref(pk, n) !== undefined) continue
					try {
						const v = JSON.parse(localStorage.getItem(storageKey(kind, n)) || 'null')
						const empty = !v || (Array.isArray(v) && v.every((x) => x == null))
						if (!empty) setClientPref(pk, n, v)
					} catch {}
				}
			}
		} else if (detail.n !== this.currentIndex) return
		if (this.dragInProgress) return
		if (detail.loaded || prefKey('layout', this.currentIndex) === detail.key) this._load()
		this._emit('change')
	}
}

export const multiviewState = new MultiviewState()
export default MultiviewState
