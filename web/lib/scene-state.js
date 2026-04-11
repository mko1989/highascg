/**
 * Scene / Look state — named compositions of per-layer content + normalized FILL.
 * @see docs/scene-system-plan.md
 */

import { fullFill } from './fill-math.js'

const STORAGE_KEY = 'casparcg_scenes_v1'
const FALLBACK_RESOLUTION = { w: 1920, h: 1080, fps: 50 }

/** @returns {import('./fill-math.js').FillLike} */
function defaultFill() {
	return { ...fullFill() }
}

/** @returns {object} */
export function defaultTransition() {
	// MIX + frames ≈ fade to program when taking a look (Caspar load transition).
	return { type: 'MIX', duration: 12, tween: 'linear' }
}

/**
 * @returns {import('./scene-state.js').LayerConfig}
 */
/**
 * PRV uses the same Caspar layer numbers as PGM (layer 9 = black CG; content uses scene layerNumber).
 * @param {import('./scene-state.js').Scene | null | undefined} scene
 * @param {number} layerIndex
 */
export function previewChannelLayerForSceneLayer(scene, layerIndex) {
	const L = scene?.layers?.[layerIndex]
	return L?.layerNumber ?? 10
}

export function defaultLayerConfig(layerNumber) {
	return {
		layerNumber,
		source: null,
		loop: false,
		/** Output bus stereo pair — same options as timeline clip inspector. */
		audioRoute: '1+2',
		/** 0–1; use with {@link muted} */
		volume: 1,
		muted: false,
		/** Straight alpha: MIXER KEYER on layer (PNG/ProRes with alpha, etc.) */
		straightAlpha: false,
		/** 'native' | 'fill-canvas' | 'horizontal' | 'vertical' | 'stretch' — how media fits the layer rect (see layer inspector). */
		contentFit: 'native',
		/** When true (default), changing W or H in the inspector keeps content aspect (from media resolution when known). */
		aspectLocked: true,
		fill: defaultFill(),
		opacity: 1,
		rotation: 0,
		transition: null,
	}
}

function newId() {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
	return `sc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export class SceneState {
	constructor() {
		/** @type {{ w: number, h: number, fps: number }[]} */
		this._canvasResolutions = []
		this.activeScreenIndex = 0
		/** @type {import('./scene-state.js').Scene[]} */
		this.scenes = []
		/** Scene open in editor, or null on deck */
		this.editingSceneId = null
		this.liveSceneId = null
		/** Last look pushed to preview channel (for global Take / preview panel when not editing). */
		this.previewSceneId = null
		/** Default transition for new looks + “Apply to all” (deck). Merged into each scene’s defaultTransition when applied. */
		this.globalDefaultTransition = { ...defaultTransition() }
		/** Copied layer mixer geometry (fill, opacity, …) — paste onto another layer. */
		this._layerStyleClipboard = null
		this._listeners = new Map()
		this._load()
	}

	_getCanvas(screenIdx) {
		const r = this._canvasResolutions[screenIdx]
		if (r?.w > 0 && r?.h > 0) return { width: r.w, height: r.h, framerate: r.fps ?? 50 }
		return { width: FALLBACK_RESOLUTION.w, height: FALLBACK_RESOLUTION.h, framerate: FALLBACK_RESOLUTION.fps }
	}

	/** @param {{ w: number, h: number, fps?: number }[] | undefined} resolutions */
	setCanvasResolutions(resolutions) {
		if (!Array.isArray(resolutions)) return
		const next = resolutions.map((r) =>
			r?.w > 0 && r?.h > 0 ? { w: r.w, h: r.h, fps: r.fps ?? 50 } : { ...FALLBACK_RESOLUTION }
		)
		if (this._canvasResolutionsEqual(this._canvasResolutions, next)) return
		this._canvasResolutions = next
		this._save()
	}

	_canvasResolutionsEqual(a, b) {
		const la = a?.length ?? 0
		const lb = b?.length ?? 0
		if (la !== lb) return false
		if (la === 0) return true
		for (let i = 0; i < la; i++) {
			if (a[i].w !== b[i].w || a[i].h !== b[i].h || (a[i].fps ?? 50) !== (b[i].fps ?? 50)) return false
		}
		return true
	}

	getCanvasForScreen(screenIdx = this.activeScreenIndex) {
		return this._getCanvas(screenIdx)
	}

	_load() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY)
			if (raw) {
				const data = JSON.parse(raw)
				if (Array.isArray(data.scenes)) {
					this.scenes = data.scenes.map((s) => this._migrateScene(s))
					this.liveSceneId = data.liveSceneId ?? null
					this.previewSceneId = data.previewSceneId ?? null
					this.activeScreenIndex = typeof data.activeScreenIndex === 'number' ? data.activeScreenIndex : 0
					if (data.globalDefaultTransition && typeof data.globalDefaultTransition === 'object') {
						this.globalDefaultTransition = {
							...defaultTransition(),
							...data.globalDefaultTransition,
						}
					}
					return
				}
			}
		} catch {}
		this.scenes = []
		this.liveSceneId = null
		this.previewSceneId = null
	}

	_migrateScene(s) {
		const id = s.id || newId()
		const layers = Array.isArray(s.layers)
			? s.layers.map((l, i) => {
					const base = {
						...defaultLayerConfig(l.layerNumber ?? 10 + i),
						...l,
						fill: { ...defaultFill(), ...(l.fill || {}) },
						transition: l.transition ?? null,
					}
					if (base.contentFit == null) {
						base.contentFit = l.fillNativeAspect === false ? 'stretch' : 'native'
					}
					if (base.aspectLocked == null) base.aspectLocked = true
					return base
				})
			: []
		return {
			id,
			name: s.name || 'Untitled look',
			layers,
			defaultTransition: { ...defaultTransition(), ...(s.defaultTransition || {}) },
		}
	}

	_persist() {
		try {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({
					scenes: this.scenes,
					liveSceneId: this.liveSceneId,
					previewSceneId: this.previewSceneId,
					activeScreenIndex: this.activeScreenIndex,
					globalDefaultTransition: this.globalDefaultTransition,
				})
			)
		} catch {}
	}

	/** Persist + notify — use for structural edits (deck / layer list). */
	_save() {
		this._persist()
		this._emit('change')
	}

	/** Persist + soft notify — layer/defaultTransition tweaks without rebuilding the whole scenes editor DOM. */
	_softSave() {
		this._persist()
		this._emit('softChange')
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

	switchScreen(screenIdx) {
		if (screenIdx === this.activeScreenIndex) return
		this.activeScreenIndex = screenIdx
		this._save()
		this._emit('screenChange', screenIdx)
	}

	addScene(name) {
		const scene = {
			id: newId(),
			name: name || `Look ${this.scenes.length + 1}`,
			layers: [],
			defaultTransition: { ...defaultTransition(), ...this.globalDefaultTransition },
		}
		this.scenes.push(scene)
		this._save()
		return scene.id
	}

	/**
	 * Unique name for a duplicated look: "Name (copy)", "Name (copy 2)", …
	 * @param {string} baseName
	 * @returns {string}
	 */
	_uniqueNameForDuplicate(baseName) {
		const base = String(baseName || '').trim() || 'Look'
		const stem = `${base} (copy)`
		const taken = new Set(this.scenes.map((x) => String(x.name || '').trim().toLowerCase()))
		if (!taken.has(stem.toLowerCase())) return stem
		for (let n = 2; n < 1000; n++) {
			const candidate = `${base} (copy ${n})`
			if (!taken.has(candidate.toLowerCase())) return candidate
		}
		return `${base} (copy ${Date.now()})`
	}

	/**
	 * Duplicate a look (new id, layers deep-cloned).
	 * @param {string} id
	 * @returns {string | null} new scene id
	 */
	duplicateScene(id) {
		const s = this.getScene(id)
		if (!s) return null
		const dupe = this._migrateScene({
			id: newId(),
			name: this._uniqueNameForDuplicate(s.name),
			layers: JSON.parse(JSON.stringify(s.layers || [])),
			defaultTransition: s.defaultTransition,
		})
		this.scenes.push(dupe)
		this._save()
		return dupe.id
	}

	setPreviewSceneId(id) {
		this.previewSceneId = id || null
		this._persist()
		// Do not emit softChange — that would re-schedule a redundant PRV push after every successful push.
		this._emit('previewScene')
	}

	/** Copy layer position/scale/opacity/etc. (not source). */
	copyLayerStyle(sceneId, layerIndex) {
		const s = this.getScene(sceneId)
		const l = s?.layers?.[layerIndex]
		if (!l) return false
		this._layerStyleClipboard = {
			fill: l.fill ? { ...l.fill } : undefined,
			opacity: l.opacity,
			rotation: l.rotation,
			loop: l.loop,
			audioRoute: l.audioRoute,
			volume: l.volume,
			muted: l.muted,
			straightAlpha: l.straightAlpha,
			contentFit: l.contentFit,
			aspectLocked: l.aspectLocked,
			transition: l.transition ? { ...l.transition } : null,
		}
		return true
	}

	hasLayerStyleClipboard() {
		return this._layerStyleClipboard != null
	}

	/** Paste copied style onto layer (same scene or another). */
	pasteLayerStyle(sceneId, layerIndex) {
		if (!this._layerStyleClipboard) return false
		const s = this.getScene(sceneId)
		const L = s?.layers?.[layerIndex]
		if (!L) return false
		const c = this._layerStyleClipboard
		if (c.fill) L.fill = { ...defaultFill(), ...c.fill }
		if (c.opacity != null) L.opacity = c.opacity
		if (c.rotation != null) L.rotation = c.rotation
		if (c.loop != null) L.loop = c.loop
		if (c.audioRoute != null) L.audioRoute = c.audioRoute
		if (c.volume != null) L.volume = c.volume
		if (c.muted != null) L.muted = c.muted
		if (c.straightAlpha != null) L.straightAlpha = c.straightAlpha
		if (c.contentFit != null) L.contentFit = c.contentFit
		if (c.aspectLocked != null) L.aspectLocked = c.aspectLocked
		L.transition = c.transition
		this._softSave()
		return true
	}

	removeScene(id) {
		const i = this.scenes.findIndex((s) => s.id === id)
		if (i < 0) return
		this.scenes.splice(i, 1)
		if (this.editingSceneId === id) this.editingSceneId = null
		if (this.liveSceneId === id) this.liveSceneId = null
		if (this.previewSceneId === id) this.previewSceneId = null
		this._save()
	}

	setSceneName(id, name) {
		const s = this.scenes.find((x) => x.id === id)
		if (!s) return
		s.name = (name || '').trim() || 'Untitled look'
		this._save()
	}

	/** Mark which look is live on program (after successful take). */
	setLiveSceneId(id) {
		this.liveSceneId = id || null
		this._softSave()
	}

	/**
	 * After a successful take, copy layers (and transition) from the server snapshot so the editor matches
	 * scene.live.
	 * @param {string} sceneId
	 * @param {{ id?: string, layers?: object[], defaultTransition?: object, name?: string }} payload
	 */
	applySceneFromTakePayload(sceneId, payload) {
		const s = this.getScene(sceneId)
		if (!s || !payload || typeof payload !== 'object') return
		if (payload.id != null && String(payload.id) !== String(sceneId)) return
		if (Array.isArray(payload.layers)) {
			s.layers = JSON.parse(JSON.stringify(payload.layers))
		}
		if (payload.defaultTransition != null) {
			s.defaultTransition = { ...defaultTransition(), ...payload.defaultTransition }
		}
		if (typeof payload.name === 'string' && payload.name.trim()) s.name = payload.name.trim()
		this._softSave()
	}

	/**
	 * Align live highlight with server-persisted program state (GET /api/scene/live or WS scene.live).
	 * @param {Record<string, { sceneId?: string }>} channels - keyed by program channel number
	 * @param {{ programChannels?: number[] }} [channelMap]
	 */
	applyServerLiveChannels(channels, channelMap) {
		if (!channels || typeof channels !== 'object' || !channelMap?.programChannels?.length) return
		const idx = this.activeScreenIndex
		const ch = channelMap.programChannels[idx]
		if (ch == null) return
		const entry = channels[String(ch)]
		const sid = entry?.sceneId
		if (!sid) return
		if (!this.getScene(sid)) return
		if (this.liveSceneId === sid) return
		this.liveSceneId = sid
		this._softSave()
	}

	getScene(id) {
		return this.scenes.find((s) => s.id === id) || null
	}

	setEditingScene(id) {
		this.editingSceneId = id
		this._emit('editingChange', id)
	}

	/** Next Caspar layer number for a new strip in this scene */
	nextLayerNumber(scene) {
		let max = 9
		for (const l of scene.layers || []) {
			if (l.layerNumber > max) max = l.layerNumber
		}
		return max + 1
	}

	addLayer(sceneId) {
		const s = this.getScene(sceneId)
		if (!s) return -1
		const n = this.nextLayerNumber(s)
		s.layers.push(defaultLayerConfig(n))
		this._save()
		return s.layers.length - 1
	}

	removeLayer(sceneId, layerIndex) {
		const s = this.getScene(sceneId)
		if (!s || layerIndex < 0 || layerIndex >= s.layers.length) return
		s.layers.splice(layerIndex, 1)
		this._save()
	}

	/**
	 * Reorder layers for Z-order (Caspar layer numbers: bottom = lower, top = higher).
	 * @param {string} sceneId
	 * @param {number} fromVisualIndex - index in bottom→top list (0 = bottom)
	 * @param {number} toVisualIndex - target index in that list (0 = bottom)
	 */
	reorderLayers(sceneId, fromVisualIndex, toVisualIndex) {
		const s = this.getScene(sceneId)
		if (!s?.layers?.length) return
		const sorted = [...s.layers].sort((a, b) => (a.layerNumber || 0) - (b.layerNumber || 0))
		const n = sorted.length
		if (fromVisualIndex < 0 || fromVisualIndex >= n) return
		if (toVisualIndex < 0 || toVisualIndex >= n) return
		if (fromVisualIndex === toVisualIndex) return
		const [item] = sorted.splice(fromVisualIndex, 1)
		sorted.splice(toVisualIndex, 0, item)
		let ln = 10
		for (const layer of sorted) layer.layerNumber = ln++
		s.layers = sorted
		this._save()
	}

	setLayerSource(sceneId, layerIndex, source) {
		const s = this.getScene(sceneId)
		if (!s || !s.layers[layerIndex]) return
		s.layers[layerIndex].source = source
		const v = source?.value
		if (v && /\.(jpe?g|png|gif|bmp|webp|tiff?)$/i.test(String(v))) {
			s.layers[layerIndex].loop = false
		}
		this._save()
	}

	patchLayer(sceneId, layerIndex, patch) {
		const s = this.getScene(sceneId)
		if (!s || !s.layers[layerIndex]) return
		const L = s.layers[layerIndex]
		if (patch.fill) L.fill = { ...L.fill, ...patch.fill }
		const { fill, startBehaviour, ...rest } = patch
		Object.assign(L, rest)
		if ('startBehaviour' in patch) {
			if (startBehaviour === null || startBehaviour === 'inherit') delete L.startBehaviour
			else L.startBehaviour = startBehaviour
		}
		this._softSave()
	}

	setDefaultTransition(sceneId, t) {
		const s = this.getScene(sceneId)
		if (!s) return
		s.defaultTransition = { ...defaultTransition(), ...s.defaultTransition, ...t }
		this._softSave()
	}

	/** Deck: default used for new looks; use {@link applyGlobalDefaultToAllLooks} to update every look. */
	setGlobalDefaultTransition(t) {
		this.globalDefaultTransition = { ...defaultTransition(), ...this.globalDefaultTransition, ...t }
		this._softSave()
	}

	/** Copy {@link globalDefaultTransition} onto every scene’s defaultTransition (take uses per-look default). */
	applyGlobalDefaultToAllLooks() {
		const g = { ...defaultTransition(), ...this.globalDefaultTransition }
		for (const s of this.scenes) {
			s.defaultTransition = { ...g }
		}
		this._save()
	}

	getExportData() {
		return JSON.parse(
			JSON.stringify({
				scenes: this.scenes,
				liveSceneId: this.liveSceneId,
				previewSceneId: this.previewSceneId,
				activeScreenIndex: this.activeScreenIndex,
				globalDefaultTransition: this.globalDefaultTransition,
			})
		)
	}

	loadFromData(data) {
		if (!data || !Array.isArray(data.scenes)) return
		this.scenes = data.scenes.map((s) => this._migrateScene(s))
		this.liveSceneId = data.liveSceneId ?? null
		this.previewSceneId = data.previewSceneId ?? null
		this.activeScreenIndex = typeof data.activeScreenIndex === 'number' ? data.activeScreenIndex : 0
		this.globalDefaultTransition =
			data.globalDefaultTransition && typeof data.globalDefaultTransition === 'object'
				? { ...defaultTransition(), ...data.globalDefaultTransition }
				: { ...defaultTransition() }
		this._save()
		this._emit('imported')
	}
}

export const sceneState = new SceneState()
