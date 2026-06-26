/**
 * Per-screen global border read/write helpers for {@link SceneState}.
 * Extracted to keep `scene-state.js` under the sweep line limit.
 */
import { PIP_OVERLAY_MAP } from './pip-overlay-registry.js'
import {
	defaultArtnetChannelMap,
	mergeArtnetBorderRuntime,
	normalizeArtnetChannelMap,
} from './global-border-artnet-map.js'

function normActivePgmLayer(v) {
	return Number(v) === 996 ? 996 : 998
}

/** @returns {object} Template for a newly enabled screen slot (not persisted until set). */
export function sceneStateDefaultGlobalBorderTemplate() {
	const def = PIP_OVERLAY_MAP.get('border')
	return {
		enabled: false,
		type: 'border',
		fadeDuration: 25,
		params: { ...(def?.defaults || {}), side: 'inside' },
		slices: [],
		artnetPatch: { startChannel: 1, universe: 0 },
		/** When false, server should not apply DMX to this screen; client ignores Art-Net WS sync. */
		artnetListenEnabled: true,
		/** Per DMX offset (0–17): false = keep UI/local value for that parameter. */
		artnetChannelMap: defaultArtnetChannelMap(),
		mirrorBorderOnPrv: false,
		activePgmLayer: 998,
		borderPresets: [],
		pgmAirSnapshot: null,
	}
}

export function normalizeGlobalBordersArray(arr) {
	const out = [null, null, null, null]
	if (!Array.isArray(arr)) return out
	for (let i = 0; i < 4; i++) {
		const v = arr[i]
		out[i] = v && typeof v === 'object' ? v : null
	}
	return out
}

const SLICE_EDIT_GUARD_MS = 5000
const PATCH_EDIT_GUARD_MS = 8000

function shouldKeepLocalArtnetPatch(sceneState, screenIndex, localPatch, remotePatch) {
	if (!localPatch || !remotePatch) return !!localPatch
	const editAt = sceneState._globalBorderPatchEditAt?.[screenIndex] || 0
	if (Date.now() - editAt >= PATCH_EDIT_GUARD_MS) return false
	return (
		Number(localPatch.universe) !== Number(remotePatch.universe) ||
		Number(localPatch.startChannel) !== Number(remotePatch.startChannel)
	)
}

function copySlices(slices) {
	if (!Array.isArray(slices) || slices.length === 0) return []
	return slices.map((s) => ({
		x: Number(s.x) || 0,
		y: Number(s.y) || 0,
		w: Number(s.w) || 0,
		h: Number(s.h) || 0,
	}))
}

function shouldKeepLocalSlices(sceneState, screenIndex, localSlices, remoteSlices) {
	if (!localSlices.length) return false
	if (remoteSlices.length > 0) return false
	const editAt = sceneState._globalBorderSliceEditAt?.[screenIndex] || 0
	return Date.now() - editAt < SLICE_EDIT_GUARD_MS
}

function preserveLocalArtnetConfig(local, remote, sceneState, screenIndex, fromArtnet) {
	const patch = fromArtnet
		? local.artnetPatch || { startChannel: 1, universe: 0 }
		: shouldKeepLocalArtnetPatch(sceneState, screenIndex, local.artnetPatch, remote.artnetPatch)
			? { startChannel: 1, universe: 0, ...(local.artnetPatch || {}) }
			: { startChannel: 1, universe: 0, ...(remote.artnetPatch || local.artnetPatch || {}) }
	return {
		artnetPatch: patch,
		artnetListenEnabled:
			fromArtnet || remote.artnetListenEnabled === undefined
				? local.artnetListenEnabled !== false
				: !!remote.artnetListenEnabled,
		artnetChannelMap: fromArtnet
			? normalizeArtnetChannelMap(local.artnetChannelMap)
			: normalizeArtnetChannelMap(remote.artnetChannelMap ?? local.artnetChannelMap),
	}
}

/**
 * @param {object} sceneState
 * @param {number} screenIndex
 * @param {object | null} remote
 * @param {{ source?: 'artnet' | 'project' }} [opts]
 */
export function applyRemoteGlobalBorderSlot(sceneState, screenIndex, remote, opts = {}) {
	const fromArtnet = opts.source === 'artnet'
	const i = Math.max(0, Math.min(3, screenIndex))
	if (!remote || typeof remote !== 'object') {
		sceneState.globalBorders[i] = null
		return
	}
	const local = sceneState.globalBorders[i]
	if (!local || typeof local !== 'object') {
		sceneState.globalBorders[i] = {
			...sceneStateDefaultGlobalBorderTemplate(),
			...remote,
			artnetChannelMap: normalizeArtnetChannelMap(remote.artnetChannelMap),
		}
		return
	}
	if (fromArtnet && local.artnetListenEnabled === false) return

	const localSlices = copySlices(local.slices)
	const remoteSlices = copySlices(remote.slices)
	const slices = shouldKeepLocalSlices(sceneState, i, localSlices, remoteSlices)
		? localSlices
		: remoteSlices.length
			? remoteSlices
			: localSlices

	const runtime = fromArtnet
		? mergeArtnetBorderRuntime(local, remote, local.artnetChannelMap)
		: {
				enabled: remote.enabled !== undefined ? remote.enabled : local.enabled,
				type: remote.type !== undefined ? remote.type : local.type,
				fadeDuration: remote.fadeDuration !== undefined ? remote.fadeDuration : local.fadeDuration,
				params: { ...(local.params || {}), ...(remote.params || {}), side: 'inside' },
			}

	const config = preserveLocalArtnetConfig(local, remote, sceneState, i, fromArtnet)

	sceneState.globalBorders[i] = {
		...local,
		...runtime,
		slices,
		...config,
		mirrorBorderOnPrv:
			fromArtnet || remote.mirrorBorderOnPrv === undefined
				? local.mirrorBorderOnPrv
				: remote.mirrorBorderOnPrv,
		activePgmLayer:
			remote.activePgmLayer !== undefined && !fromArtnet
				? normActivePgmLayer(remote.activePgmLayer)
				: normActivePgmLayer(local.activePgmLayer),
		borderPresets: Array.isArray(local.borderPresets) ? local.borderPresets : [],
		pgmAirSnapshot: local.pgmAirSnapshot,
	}
}

/** @param {object} sceneState */
export function applyRemoteGlobalBordersArray(sceneState, remote, opts = {}) {
	const norm = normalizeGlobalBordersArray(remote)
	const out = [null, null, null, null]
	for (let i = 0; i < 4; i++) {
		const rem = norm[i]
		if (!rem) {
			out[i] = null
			continue
		}
		const local = sceneState.globalBorders[i]
		if (!local || typeof local !== 'object') {
			out[i] = {
				...sceneStateDefaultGlobalBorderTemplate(),
				...rem,
				artnetChannelMap: normalizeArtnetChannelMap(rem.artnetChannelMap),
			}
			continue
		}
		applyRemoteGlobalBorderSlot(sceneState, i, rem, opts)
		out[i] = sceneState.globalBorders[i]
	}
	sceneState.globalBorders = out
}

function normalizeStoredBorder(stored) {
	const snap =
		stored.pgmAirSnapshot && typeof stored.pgmAirSnapshot === 'object'
			? {
					...stored.pgmAirSnapshot,
					params: { ...(stored.pgmAirSnapshot.params || {}), side: 'inside' },
					activePgmLayer: normActivePgmLayer(stored.pgmAirSnapshot.activePgmLayer),
				}
			: null
	return {
		...stored,
		fadeDuration: stored.fadeDuration ?? 25,
		params: { ...(stored.params || {}), side: 'inside' },
		slices: Array.isArray(stored.slices) ? stored.slices : [],
		mirrorBorderOnPrv: stored.mirrorBorderOnPrv === true,
		activePgmLayer: normActivePgmLayer(stored.activePgmLayer),
		borderPresets: Array.isArray(stored.borderPresets) ? stored.borderPresets : [],
		artnetListenEnabled: stored.artnetListenEnabled !== false,
		artnetChannelMap: normalizeArtnetChannelMap(stored.artnetChannelMap),
		pgmAirSnapshot: snap,
	}
}

/** @returns {object | null} `null` when this screen has no global border configured. */
export function sceneStateGetGlobalBorderForScreen(self, screenIdx) {
	const m = Math.max(0, Math.min(3, screenIdx))
	const stored = self.globalBorders[m]
	if (!stored || typeof stored !== 'object') return null
	return normalizeStoredBorder(stored)
}

export function sceneStateSetGlobalBorderForScreen(self, screenIdx, border) {
	const m = Math.max(0, Math.min(3, screenIdx))

	if (border === null || border?.__clearSlot === true) {
		self.globalBorders[m] = null
		if (!self.borderJustEnabled) self.borderJustEnabled = {}
		self.borderJustEnabled[m] = true
		self.borderChanged = true
		self._softSave()
		return
	}

	const hadSlot = self.globalBorders[m] != null && typeof self.globalBorders[m] === 'object'
	const prev = hadSlot
		? sceneStateGetGlobalBorderForScreen(self, screenIdx)
		: sceneStateDefaultGlobalBorderTemplate()

	if (!self.borderJustEnabled) self.borderJustEnabled = {}
	if (border.enabled !== undefined && !prev.enabled && border.enabled) {
		self.borderJustEnabled[m] = true
	}
	if (border.type !== undefined && prev.type !== border.type) {
		self.borderJustEnabled[m] = true
	}

	let merged = { ...prev, ...border }
	const turningPrvOff = prev.mirrorBorderOnPrv === true && merged.mirrorBorderOnPrv === false
	if (turningPrvOff && prev.pgmAirSnapshot && typeof prev.pgmAirSnapshot === 'object') {
		const snap = prev.pgmAirSnapshot
		merged = {
			...merged,
			enabled: snap.enabled,
			type: snap.type,
			params: { ...(snap.params || {}), side: 'inside' },
			slices: Array.isArray(snap.slices) ? snap.slices : [],
			fadeDuration: snap.fadeDuration ?? merged.fadeDuration,
			artnetPatch: { startChannel: 1, universe: 0, ...(snap.artnetPatch || {}) },
			activePgmLayer: normActivePgmLayer(snap.activePgmLayer ?? merged.activePgmLayer),
			mirrorBorderOnPrv: false,
		}
	}

	if (border.slices != null) {
		const nextSlices = Array.isArray(border.slices) ? border.slices : []
		const prevJson = JSON.stringify(prev.slices || [])
		const nextJson = JSON.stringify(nextSlices)
		if (prevJson !== nextJson) {
			self.borderJustEnabled[m] = true
			if (!self._globalBorderSliceEditAt) self._globalBorderSliceEditAt = {}
			self._globalBorderSliceEditAt[m] = Date.now()
		}
		merged.slices = nextSlices
	}

	const nextParams = turningPrvOff
		? { ...merged.params, side: 'inside' }
		: border.params != null
			? { ...(prev.params || {}), ...border.params, side: 'inside' }
			: { ...(prev.params || {}), side: 'inside' }
	merged.params = nextParams
	merged.activePgmLayer = normActivePgmLayer(merged.activePgmLayer)
	if (!Array.isArray(merged.borderPresets)) merged.borderPresets = [...(prev.borderPresets || [])]

	if (border.artnetPatch != null) {
		merged.artnetPatch = {
			startChannel: 1,
			universe: 0,
			...(prev.artnetPatch || {}),
			...border.artnetPatch,
		}
		if (!self._globalBorderPatchEditAt) self._globalBorderPatchEditAt = {}
		self._globalBorderPatchEditAt[m] = Date.now()
	}
	if (border.artnetListenEnabled !== undefined) {
		merged.artnetListenEnabled = !!border.artnetListenEnabled
	}
	if (border.artnetChannelMap != null) {
		merged.artnetChannelMap = normalizeArtnetChannelMap(border.artnetChannelMap)
	}

	self.globalBorders[m] = merged
	self.borderChanged = true
	self._softSave()
}

export function sceneStateNoteGlobalBorderPushedToPgm(self, screenIdx, slice) {
	const m = Math.max(0, Math.min(3, screenIdx))
	const cur = sceneStateGetGlobalBorderForScreen(self, screenIdx)
	if (!cur) return
	const snap = {
		enabled: slice.enabled !== undefined ? !!slice.enabled : !!cur.enabled,
		type: slice.type != null ? String(slice.type) : String(cur.type || 'border'),
		params: { ...(cur.params || {}), ...(slice.params || {}), side: 'inside' },
		slices: Array.isArray(slice.slices ?? cur.slices) ? (slice.slices ?? cur.slices) : [],
		fadeDuration: Math.max(0, parseInt(String(slice.fadeDuration ?? cur.fadeDuration ?? 25), 10) || 25),
		artnetPatch: { startChannel: 1, universe: 0, ...(slice.artnetPatch || cur.artnetPatch || {}) },
		activePgmLayer: normActivePgmLayer(slice.activePgmLayer ?? cur.activePgmLayer),
	}
	self.globalBorders[m] = { ...cur, pgmAirSnapshot: snap }
	self._softSave()
}

export function sceneStateGetGlobalBorderPresetSlotCount(self, screenIdx) {
	const cur = sceneStateGetGlobalBorderForScreen(self, screenIdx)
	if (!cur) return 2
	const presets = cur.borderPresets || []
	const maxSlot = presets.reduce(
		(mx, p) => (p && Number.isFinite(Number(p.slot)) ? Math.max(mx, Number(p.slot)) : mx),
		0,
	)
	return Math.max(2, maxSlot + 2)
}

export function sceneStateSaveGlobalBorderPresetSlot(self, screenIdx, slotNum, name) {
	const m = Math.max(0, Math.min(3, screenIdx))
	const sn = Math.max(1, Math.floor(Number(slotNum)) || 1)
	const cur = sceneStateGetGlobalBorderForScreen(self, screenIdx)
	if (!cur) return
	const source = cur.pgmAirSnapshot && typeof cur.pgmAirSnapshot === 'object' ? cur.pgmAirSnapshot : cur
	const data = {
		enabled: !!source.enabled,
		type: source.type,
		params: { ...(source.params || {}), side: 'inside' },
		slices: Array.isArray(source.slices) ? source.slices.map((s) => ({ ...s })) : [],
		fadeDuration: source.fadeDuration ?? 25,
		artnetPatch: { startChannel: 1, universe: 0, ...(source.artnetPatch || {}) },
		activePgmLayer: normActivePgmLayer(source.activePgmLayer),
	}
	const presets = [...(cur.borderPresets || [])]
	const idx = presets.findIndex((p) => p && Number(p.slot) === sn)
	const nm = String(name || `Preset ${sn}`).trim() || `Preset ${sn}`
	const entry = { slot: sn, name: nm, data }
	if (idx >= 0) presets[idx] = entry
	else presets.push(entry)
	presets.sort((a, b) => Number(a.slot) - Number(b.slot))
	self.globalBorders[m] = { ...cur, borderPresets: presets }
	self._save()
}

export function sceneStateDeleteGlobalBorderPresetSlot(self, screenIdx, slotNum) {
	const m = Math.max(0, Math.min(3, screenIdx))
	const sn = Math.floor(Number(slotNum))
	const cur = sceneStateGetGlobalBorderForScreen(self, screenIdx)
	if (!cur) return
	const presets = (cur.borderPresets || []).filter((p) => !p || Number(p.slot) !== sn)
	self.globalBorders[m] = { ...cur, borderPresets: presets }
	self._save()
}

export function sceneStateGetGlobalBorderPreset(self, screenIdx, slotNum) {
	const cur = sceneStateGetGlobalBorderForScreen(self, screenIdx)
	if (!cur) return null
	const sn = Math.floor(Number(slotNum))
	return (cur.borderPresets || []).find((p) => p && Number(p.slot) === sn) || null
}

export function sceneStateSetGlobalBorder(self, sceneId, border) {
	const s = self.getScene(sceneId)
	if (s) {
		s.globalBorder = { ...s.globalBorder, ...border }
		self.borderChanged = true
		self._softSave()
	}
}
