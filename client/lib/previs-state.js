/**
 * Previs client-side state (WO-17 T1.3).
 *
 * Small event-emitting store that tracks the bits of previs UI state that survive a page
 * reload or a component remount. Deliberately dumb — no Three.js references, no scene
 * handles, no async work. The real scene (`previs-scene-model.js`, `previs-pgm-3d.js`)
 * reads from this store for "what should I render / which mesh did the user pick" and
 * writes back when the user interacts with the inspector UI.
 *
 * Persistence: debounced `localStorage.setItem(PREVIS_STATE_STORAGE_KEY, JSON.stringify(state))`
 * on every mutation. Server-side copies (models list) are refetched from
 * `/api/previs/models` on load, so `localStorage` only stores *user intent* (which mesh
 * was tagged, which model is active, UI toggles, camera presets) — not source-of-truth
 * binary data. This keeps the store small and avoids stale-blob bugs.
 *
 * Shape (intentionally flat so it round-trips through JSON cleanly):
 *
 *   {
 *     models: [{ id, name, filename, ext, sizeBytes, uploadedAt }],   // mirror of /api/previs/models
 *     activeModelId: string | null,
 *     tags:    { [modelId]: { [meshUuid]: ScreenTag } },
 *     presets: { [modelId]: CameraPreset[] },
 *     ui:      { grid, axes, wireframe, backgroundColor, ambientIntensity, … } — see DEFAULT_UI.
 *   }
 *
 * @see ScreenTag in `previs-mesh-info.js` / `src/previs/types.js`.
 */

const PREVIS_STATE_STORAGE_KEY = 'highascg.previs.state.v1'
const PERSIST_DEBOUNCE_MS = 250

/** @type {Readonly<Record<string, number | boolean>>} */
const DEFAULT_UI = Object.freeze({
	grid: true,
	axes: false,
	wireframe: false,
	/** Scene background (Three.js hex int, e.g. 0x0a0a0a). */
	backgroundColor: 0x0a0a0a,
	/** Ambient light intensity (0–2 typical). */
	ambientIntensity: 0.4,
	/** Key directional light intensity (0–3 typical). */
	directionalIntensity: 1.0,
	/** LED screen emissiveIntensity on MeshStandardMaterial screen surfaces. */
	emissiveIntensity: 1.4,
	/** Cap for `renderer.setPixelRatio` (1, 2, or 4). */
	pixelRatioCap: 2,
	/** WebGL antialiasing — only applied when the 3D renderer is created; toggling requires re-entering 3D. */
	antialias: true,
	/** Default perspective camera FOV (degrees). */
	cameraFov: 48,
	/** PRV column fraction while 3D is active (0.05–0.5); PGM gets the rest. */
	prvFractionWhen3d: 0.2,
	/**
	 * Max dimension (long edge) for GPU video textures — `native` = full `<video>` resolution.
	 * @type {'native'|'720p'|'1080p'|'auto'}
	 */
	videoTextureMax: 'auto',
	/** Virtual canvas size (px) for UV math / future mapping editor — `previs-uv-mapper.computeScreenUV`. */
	virtualCanvasWidth: 1920,
	virtualCanvasHeight: 1080,
})

const VIDEO_TEXTURE_MAX_MODES = Object.freeze(['native', '720p', '1080p', 'auto'])

/**
 * @typedef {Object} ModelRecord
 * @property {string} id
 * @property {string} name
 * @property {string} filename
 * @property {string} ext
 * @property {number} sizeBytes
 * @property {string} uploadedAt
 */

/**
 * @typedef {Object} CameraPreset
 * @property {string} id
 * @property {string} name
 * @property {[number,number,number]} position
 * @property {[number,number,number]} target
 * @property {number} fov
 */

/**
 * @typedef {Object} PrevisStateSnapshot
 * @property {ModelRecord[]} models
 * @property {string | null} activeModelId
 * @property {Record<string, Record<string, any>>} tags
 * @property {Record<string, CameraPreset[]>} presets
 * @property {typeof DEFAULT_UI & Record<string, number | boolean | string>} ui
 */

/**
 * Event names emitted by the store. `change` is the firehose (anything changed); the
 * others are fine-grained so listeners can cheaply react to a single concern.
 */
const EVENTS = Object.freeze({
	CHANGE: 'change',
	MODELS: 'models:changed',
	ACTIVE: 'active:changed',
	TAGS: 'tags:changed',
	PRESETS: 'presets:changed',
	UI: 'ui:changed',
})

/**
 * Factory — each caller gets its own independent store. In practice the previs module
 * has a single instance (created by `previs-pgm-3d.js`), but keeping the factory shape
 * lets the unit tests create throwaway stores without clobbering `localStorage`.
 *
 * @param {{ storage?: Storage, storageKey?: string }} [opts]
 */
function createPrevisState(opts) {
	const storage = (opts && opts.storage) || safeGetLocalStorage()
	const storageKey = (opts && opts.storageKey) || PREVIS_STATE_STORAGE_KEY

	/** @type {PrevisStateSnapshot} */
	let state = loadFromStorage(storage, storageKey) || blankState()
	const listeners = new Map()
	let persistTimer = null

	return {
		getSnapshot: () => cloneState(state),
		// Models (metadata mirror).
		setModels,
		upsertModel,
		removeModel,
		getActiveModel,
		setActiveModel,
		// Tags.
		getTagsForModel,
		setTag,
		clearTag,
		clearTagsForModel,
		// Presets.
		getPresets,
		addPreset,
		removePreset,
		// UI toggles.
		getUI,
		setUI,
		// Events.
		on,
		off,
		// Lifecycle.
		reset,
	}

	function setModels(models) {
		state.models = Array.isArray(models) ? models.slice() : []
		const stillPresent = state.activeModelId && state.models.some((m) => m.id === state.activeModelId)
		if (!stillPresent) state.activeModelId = null
		commit([EVENTS.MODELS, EVENTS.ACTIVE])
	}

	function upsertModel(model) {
		if (!model || typeof model.id !== 'string') return
		const idx = state.models.findIndex((m) => m.id === model.id)
		if (idx >= 0) state.models[idx] = { ...state.models[idx], ...model }
		else state.models = [...state.models, model]
		commit([EVENTS.MODELS])
	}

	function removeModel(id) {
		if (!id) return
		const before = state.models.length
		state.models = state.models.filter((m) => m.id !== id)
		if (state.models.length === before) return
		delete state.tags[id]
		delete state.presets[id]
		if (state.activeModelId === id) state.activeModelId = null
		commit([EVENTS.MODELS, EVENTS.TAGS, EVENTS.PRESETS, EVENTS.ACTIVE])
	}

	function getActiveModel() {
		if (!state.activeModelId) return null
		return state.models.find((m) => m.id === state.activeModelId) || null
	}

	function setActiveModel(id) {
		if (state.activeModelId === id) return
		if (id && !state.models.some((m) => m.id === id)) return
		state.activeModelId = id || null
		commit([EVENTS.ACTIVE])
	}

	function getTagsForModel(modelId) {
		return state.tags[modelId] ? { ...state.tags[modelId] } : {}
	}

	function setTag(modelId, meshUuid, tag) {
		if (!modelId || !meshUuid) return
		if (!state.tags[modelId]) state.tags[modelId] = {}
		state.tags[modelId][meshUuid] = { ...tag }
		commit([EVENTS.TAGS])
	}

	function clearTag(modelId, meshUuid) {
		if (!modelId || !state.tags[modelId]) return
		if (!(meshUuid in state.tags[modelId])) return
		delete state.tags[modelId][meshUuid]
		commit([EVENTS.TAGS])
	}

	function clearTagsForModel(modelId) {
		if (!state.tags[modelId]) return
		delete state.tags[modelId]
		commit([EVENTS.TAGS])
	}

	function getPresets(modelId) {
		const list = state.presets[modelId]
		return Array.isArray(list) ? list.map((p) => ({ ...p })) : []
	}

	function addPreset(modelId, preset) {
		if (!modelId || !preset || !preset.id) return
		if (!state.presets[modelId]) state.presets[modelId] = []
		state.presets[modelId] = state.presets[modelId].filter((p) => p.id !== preset.id).concat({ ...preset })
		commit([EVENTS.PRESETS])
	}

	function removePreset(modelId, presetId) {
		const list = state.presets[modelId]
		if (!list) return
		state.presets[modelId] = list.filter((p) => p.id !== presetId)
		commit([EVENTS.PRESETS])
	}

	function getUI() {
		return { ...state.ui }
	}

	function setUI(patch) {
		if (!patch || typeof patch !== 'object') return
		const next = mergeUiWithDefaults({ ...state.ui, ...patch })
		if (shallowEqual(next, state.ui)) return
		state.ui = next
		commit([EVENTS.UI])
	}

	function on(event, fn) {
		if (!listeners.has(event)) listeners.set(event, new Set())
		listeners.get(event).add(fn)
		return () => off(event, fn)
	}

	function off(event, fn) {
		const set = listeners.get(event)
		if (set) set.delete(fn)
	}

	function reset() {
		state = blankState()
		commit(Object.values(EVENTS))
	}

	function commit(events) {
		schedulePersist()
		emit(EVENTS.CHANGE)
		for (const ev of events) emit(ev)
	}

	function emit(event) {
		const set = listeners.get(event)
		if (!set) return
		const snap = cloneState(state)
		for (const fn of set) {
			try { fn(snap) } catch (err) { console.warn('[previs-state] listener threw', err) }
		}
	}

	function schedulePersist() {
		if (!storage) return
		if (persistTimer) clearTimeout(persistTimer)
		persistTimer = setTimeout(() => {
			persistTimer = null
			try { storage.setItem(storageKey, JSON.stringify(state)) } catch {}
		}, PERSIST_DEBOUNCE_MS)
	}
}

/** @type {ReturnType<typeof createPrevisState> | null} */
let _sharedPrevisState = null

/**
 * Lazily creates the one client-side store shared by the PGM 3D overlay and the optional
 * **Application Settings → 3D Previs** tab (WO-30). Tests should use `createPrevisState({ storage, storageKey })` for isolation.
 *
 * @returns {ReturnType<typeof createPrevisState>}
 */
function getSharedPrevisState() {
	if (!_sharedPrevisState) {
		_sharedPrevisState = createPrevisState()
	}
	return _sharedPrevisState
}

function blankState() {
	return {
		models: [],
		activeModelId: null,
		tags: {},
		presets: {},
		ui: mergeUiWithDefaults({}),
	}
}

function cloneState(state) {
	return JSON.parse(JSON.stringify(state))
}

function loadFromStorage(storage, key) {
	if (!storage) return null
	try {
		const raw = storage.getItem(key)
		if (!raw) return null
		const parsed = JSON.parse(raw)
		if (!parsed || typeof parsed !== 'object') return null
		return {
			models: Array.isArray(parsed.models) ? parsed.models : [],
			activeModelId: typeof parsed.activeModelId === 'string' ? parsed.activeModelId : null,
			tags: parsed.tags && typeof parsed.tags === 'object' ? parsed.tags : {},
			presets: parsed.presets && typeof parsed.presets === 'object' ? parsed.presets : {},
			ui: mergeUiWithDefaults(parsed.ui),
		}
	} catch {
		return null
	}
}

function safeGetLocalStorage() {
	try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null }
}

function shallowEqual(a, b) {
	if (a === b) return true
	if (!a || !b) return false
	const ka = Object.keys(a)
	if (ka.length !== Object.keys(b).length) return false
	for (const k of ka) if (a[k] !== b[k]) return false
	return true
}

/**
 * Merge persisted `ui` with current defaults so new keys appear after upgrades.
 * Clamps numeric fields to sane ranges.
 *
 * @param {Record<string, unknown> | null | undefined} raw
 * @returns {typeof DEFAULT_UI & Record<string, number | boolean | string>}
 */
function mergeUiWithDefaults(raw) {
	const u = raw && typeof raw === 'object' ? raw : {}
	const next = { ...DEFAULT_UI, ...u }
	if (typeof next.backgroundColor !== 'number' || !Number.isFinite(next.backgroundColor)) {
		next.backgroundColor = DEFAULT_UI.backgroundColor
	}
	next.backgroundColor = Math.max(0, Math.min(0xffffff, Math.floor(next.backgroundColor)))
	next.ambientIntensity = clampNum(next.ambientIntensity, DEFAULT_UI.ambientIntensity, 0, 3)
	next.directionalIntensity = clampNum(next.directionalIntensity, DEFAULT_UI.directionalIntensity, 0, 4)
	next.emissiveIntensity = clampNum(next.emissiveIntensity, DEFAULT_UI.emissiveIntensity, 0, 3)
	next.pixelRatioCap = [1, 2, 4].includes(/** @type {any} */ (next.pixelRatioCap)) ? next.pixelRatioCap : DEFAULT_UI.pixelRatioCap
	next.antialias = !!next.antialias
	next.cameraFov = clampNum(next.cameraFov, DEFAULT_UI.cameraFov, 20, 100)
	next.prvFractionWhen3d = clampNum(next.prvFractionWhen3d, DEFAULT_UI.prvFractionWhen3d, 0.05, 0.5)
	next.grid = !!next.grid
	next.axes = !!next.axes
	next.wireframe = !!next.wireframe
	const vtm = String(u.videoTextureMax || '')
	next.videoTextureMax = /** @type {'native'|'720p'|'1080p'|'auto'} */ (
		VIDEO_TEXTURE_MAX_MODES.includes(vtm) ? vtm : DEFAULT_UI.videoTextureMax
	)
	next.virtualCanvasWidth = clampInt(next.virtualCanvasWidth, DEFAULT_UI.virtualCanvasWidth, 64, 8192)
	next.virtualCanvasHeight = clampInt(next.virtualCanvasHeight, DEFAULT_UI.virtualCanvasHeight, 64, 8192)
	return /** @type {typeof DEFAULT_UI & Record<string, number | boolean | string>} */ (next)
}

function clampInt(v, fallback, lo, hi) {
	const n = Number(v)
	if (!Number.isFinite(n)) return Math.min(hi, Math.max(lo, Math.floor(Number(fallback)) || 0))
	return Math.min(hi, Math.max(lo, Math.floor(n)))
}

function clampNum(v, fallback, lo, hi) {
	const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
	return Math.min(hi, Math.max(lo, n))
}

/**
 * Read merged UI defaults from `localStorage` (for hosts that are not inside the previs
 * component, e.g. `entry.js` PRV split override). Returns a fresh object every call.
 *
 * @param {string} [storageKey]
 * @returns {typeof DEFAULT_UI & Record<string, number | boolean | string>}
 */
function readMergedPrevisUiFromStorage(storageKey) {
	const storage = safeGetLocalStorage()
	const key = storageKey || PREVIS_STATE_STORAGE_KEY
	try {
		const raw = storage && storage.getItem(key)
		if (!raw) return mergeUiWithDefaults({})
		const parsed = JSON.parse(raw)
		if (!parsed || typeof parsed !== 'object') return mergeUiWithDefaults({})
		return mergeUiWithDefaults(parsed.ui)
	} catch {
		return mergeUiWithDefaults({})
	}
}

/**
 * Map persisted `videoTextureMax` mode to a max long-edge pixel count for canvas downscale.
 * `0` = use native `VideoTexture` (no CPU copy).
 *
 * @param {string} [mode]
 * @returns {number}
 */
function videoTextureMaxToLongEdge(mode) {
	const m = (mode || DEFAULT_UI.videoTextureMax)
	if (m === 'native') return 0
	if (m === '720p') return 1280
	if (m === '1080p') return 1920
	/* auto */
	return 1920
}

export {
	createPrevisState,
	getSharedPrevisState,
	PREVIS_STATE_STORAGE_KEY,
	EVENTS as PREVIS_STATE_EVENTS,
	DEFAULT_UI as PREVIS_DEFAULT_UI,
	readMergedPrevisUiFromStorage,
	videoTextureMaxToLongEdge,
}
