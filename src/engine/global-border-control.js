/**
 * WO-585: server-side global border control — the same per-screen slot the web inspector edits
 * (`project.scenes.globalBorders[i]`), changed and put on air without a browser (Companion, API).
 *
 * Pure slot logic lives here (unit-tested); the HTTP handler that runs AMCP and persists is
 * `api/routes-scene-global-border.js`.
 */

'use strict'

const { TEMPLATE_MAP } = require('./pip-overlay-utils')
const { GLOBAL_BORDER_LAYER_PGM_A, GLOBAL_BORDER_LAYER_PGM_B } = require('./global-border')

const GLOBAL_BORDER_LAYER_PRV_MIRROR = 997
const MAX_SCREENS = 4

/** Border kinds the global border inspector offers (router is a PIP-only effect). */
const GLOBAL_BORDER_TYPES = Object.keys(TEMPLATE_MAP).filter((t) => t !== 'router')

function normActivePgmLayer(v) {
	return Number(v) === GLOBAL_BORDER_LAYER_PGM_B ? GLOBAL_BORDER_LAYER_PGM_B : GLOBAL_BORDER_LAYER_PGM_A
}

/** Mirrors the web `sceneStateDefaultGlobalBorderTemplate` (params defaults are filled at render). */
function defaultGlobalBorderSlot() {
	return {
		enabled: false,
		type: 'border',
		fadeDuration: 25,
		params: { side: 'inside' },
		slices: [],
		artnetPatch: { startChannel: 1, universe: 0 },
		artnetListenEnabled: false,
		artnetChannelMap: Array(18).fill(true),
		mirrorBorderOnPrv: false,
		activePgmLayer: GLOBAL_BORDER_LAYER_PGM_A,
		borderPresets: [],
		pgmAirSnapshot: null,
	}
}

function normalizeGlobalBordersArray(arr) {
	const out = [null, null, null, null]
	if (!Array.isArray(arr)) return out
	for (let i = 0; i < MAX_SCREENS; i++) {
		const v = arr[i]
		out[i] = v && typeof v === 'object' ? v : null
	}
	return out
}

function parseEnabledRequest(v) {
	if (v === undefined || v === null || v === '') return null
	if (v === 'toggle') return 'toggle'
	if (v === true || v === 1 || v === 'true' || v === '1' || v === 'on') return true
	if (v === false || v === 0 || v === 'false' || v === '0' || v === 'off') return false
	return undefined
}

/**
 * Apply a control request to a stored slot.
 * @param {object | null} stored — `globalBorders[i]` (null = not configured yet)
 * @param {{ enabled?: boolean | 'toggle', type?: string, params?: object, fadeDuration?: number, preset?: number }} req
 * @returns {{ ok: true, next: object, wasEnabled: boolean, nowEnabled: boolean, typeChanged: boolean, preset: object | null }
 *   | { ok: false, error: string }}
 */
function applyControlToSlot(stored, req) {
	const prev = stored && typeof stored === 'object' ? stored : defaultGlobalBorderSlot()
	const wasEnabled = !!(stored && stored.enabled)
	const next = {
		...prev,
		params: { ...(prev.params || {}), side: 'inside' },
		activePgmLayer: normActivePgmLayer(prev.activePgmLayer),
	}
	if (!Array.isArray(next.borderPresets)) next.borderPresets = []
	if (!Array.isArray(next.slices)) next.slices = []

	let preset = null
	if (req.preset != null && req.preset !== '') {
		const sn = Math.floor(Number(req.preset))
		preset = next.borderPresets.find((p) => p && Number(p.slot) === sn && p.data) || null
		if (!preset) return { ok: false, error: `border preset ${req.preset} is empty` }
		const d = preset.data
		Object.assign(next, {
			type: d.type || next.type,
			params: { ...(d.params || {}), side: 'inside' },
			slices: Array.isArray(d.slices) ? d.slices : next.slices,
			fadeDuration: d.fadeDuration ?? next.fadeDuration,
			enabled: true,
		})
	}

	if (req.type != null && req.type !== '') {
		const t = String(req.type)
		if (!GLOBAL_BORDER_TYPES.includes(t)) {
			return { ok: false, error: `type must be one of ${GLOBAL_BORDER_TYPES.join(', ')}` }
		}
		next.type = t
	}
	if (req.params && typeof req.params === 'object') {
		next.params = { ...next.params, ...req.params, side: 'inside' }
	}
	if (req.fadeDuration != null && req.fadeDuration !== '') {
		const fd = parseInt(String(req.fadeDuration), 10)
		if (!Number.isFinite(fd) || fd < 0) return { ok: false, error: 'fadeDuration must be frames >= 0' }
		next.fadeDuration = Math.min(500, fd)
	}

	// WO-601 (Godot inspector, thin client): the web inspector's remaining slot edits, same rules as
	// sceneStateSetGlobalBorderForScreen / …SaveGlobalBorderPresetSlot.
	let slicesChanged = false
	if (Array.isArray(req.slices)) {
		const norm = req.slices.map((sl) => ({ x: Number(sl?.x) || 0, y: Number(sl?.y) || 0, w: Number(sl?.w) || 0, h: Number(sl?.h) || 0 }))
		slicesChanged = JSON.stringify(norm) !== JSON.stringify(next.slices)
		next.slices = norm
	}
	if (req.inner && typeof req.inner === 'object') {
		const c = (v, d) => Math.max(0, Math.min(1, Number.isFinite(Number(v)) ? Number(v) : d))
		next.inner = { l: c(req.inner.l, 0), t: c(req.inner.t, 0), w: c(req.inner.w, 1), h: c(req.inner.h, 1) }
	}
	let mirrorChanged = false
	let restoredPgm = false
	if (typeof req.mirrorBorderOnPrv === 'boolean' && req.mirrorBorderOnPrv !== (prev.mirrorBorderOnPrv === true)) {
		mirrorChanged = true
		next.mirrorBorderOnPrv = req.mirrorBorderOnPrv
		const snap = prev.pgmAirSnapshot
		if (!req.mirrorBorderOnPrv && snap && typeof snap === 'object') {
			restoredPgm = true
			// Turning the PRV mirror off restores what PGM really shows (web turningPrvOff).
			Object.assign(next, {
				enabled: !!snap.enabled,
				type: snap.type || next.type,
				params: { ...(snap.params || {}), side: 'inside' },
				slices: Array.isArray(snap.slices) ? snap.slices : [],
				fadeDuration: snap.fadeDuration ?? next.fadeDuration,
				activePgmLayer: normActivePgmLayer(snap.activePgmLayer ?? next.activePgmLayer),
			})
		}
	}
	// Lighting input (web inspector-global-border-artnet.js): config only — the Art-Net/sACN receiver reads it.
	const ARTNET_KEYS = ['artnetListenEnabled', 'lightingProtocol', 'artnetPatch', 'artnetChannelMap']
	if (typeof req.artnetListenEnabled === 'boolean') next.artnetListenEnabled = req.artnetListenEnabled
	if (req.lightingProtocol === 'artnet' || req.lightingProtocol === 'sacn') next.lightingProtocol = req.lightingProtocol
	if (req.artnetPatch && typeof req.artnetPatch === 'object') {
		const int = (v, lo, hi, d) => (Number.isFinite(parseInt(v, 10)) ? Math.max(lo, Math.min(hi, parseInt(v, 10))) : d)
		const cur = { startChannel: 1, universe: 0, ...(prev.artnetPatch || {}) }
		next.artnetPatch = { ...cur, startChannel: int(req.artnetPatch.startChannel ?? cur.startChannel, 1, 512, 1), universe: int(req.artnetPatch.universe ?? cur.universe, 0, 32767, 0) }
	}
	if (Array.isArray(req.artnetChannelMap)) next.artnetChannelMap = Array.from({ length: 18 }, (_, i) => req.artnetChannelMap[i] !== false)
	const airKeys = ['enabled', 'type', 'params', 'fadeDuration', 'slices', 'inner', 'mirrorBorderOnPrv', 'preset']
	if (ARTNET_KEYS.some((k) => req[k] !== undefined) && !airKeys.some((k) => req[k] !== undefined && req[k] !== null && req[k] !== '')) {
		return { ok: true, next, wasEnabled, nowEnabled: wasEnabled, typeChanged: false, preset: null, noAir: true }
	}

	if (req.savePreset && typeof req.savePreset === 'object') {
		const sn = Math.max(1, Math.floor(Number(req.savePreset.slot)) || 1)
		const src = prev.pgmAirSnapshot && typeof prev.pgmAirSnapshot === 'object' ? prev.pgmAirSnapshot : next
		const data = {
			enabled: !!src.enabled,
			type: src.type,
			params: { ...(src.params || {}), side: 'inside' },
			slices: Array.isArray(src.slices) ? src.slices.map((x) => ({ ...x })) : [],
			fadeDuration: src.fadeDuration ?? 25,
			artnetPatch: { startChannel: 1, universe: 0, ...(src.artnetPatch || {}) },
			activePgmLayer: normActivePgmLayer(src.activePgmLayer),
		}
		const nm = String(req.savePreset.name || `Preset ${sn}`).trim() || `Preset ${sn}`
		next.borderPresets = [...next.borderPresets.filter((p) => !p || Number(p.slot) !== sn), { slot: sn, name: nm, data }].sort((a, b) => Number(a.slot) - Number(b.slot))
		return { ok: true, next, wasEnabled, nowEnabled: wasEnabled, typeChanged: false, preset: null, noAir: true }
	}
	if (req.deletePreset != null && req.deletePreset !== '') {
		const sn = Math.floor(Number(req.deletePreset))
		next.borderPresets = next.borderPresets.filter((p) => !p || Number(p.slot) !== sn)
		return { ok: true, next, wasEnabled, nowEnabled: wasEnabled, typeChanged: false, preset: null, noAir: true }
	}

	const en = parseEnabledRequest(req.enabled)
	if (en === undefined) return { ok: false, error: 'enabled must be true, false or "toggle"' }
	if (en === 'toggle') next.enabled = !wasEnabled
	else if (en !== null) next.enabled = en
	else if (!preset) next.enabled = wasEnabled

	const typeChanged = String(prev.type || '') !== String(next.type || '')
	return {
		ok: true,
		next,
		wasEnabled,
		nowEnabled: !!next.enabled,
		typeChanged,
		// web borderUsesCgUpdate: a slice change re-ADDs (edge_strip re-reads slices from UPDATE); a new slot ADDs
		// mirror ON = a new slot (997) → ADD. Mirror OFF with a snapshot restores exactly what PGM shows → UPDATE (no
		// on-air re-fade; the type may differ from the EDITED slot, not from PGM); without one PGM is unknown → ADD.
		forceAdd: restoredPgm ? false : typeChanged || mirrorChanged || (slicesChanged && String(next.type) !== 'edge_strip'),
		mirrorChanged,
		preset,
	}
}

/**
 * Caspar slots for one screen, same rules as the web `globalBorderCasparSlots` / `…ClearSlots`.
 * @param {{ programCh: (n: number) => number | null, previewCh: (n: number) => number | null }} map
 * @returns {{ pgmCh: number | null, onAir: { channel: number, layer: number }[], clear: { channel: number, layer: number }[] }}
 */
function screenBorderCasparSlots(map, screenIdx, slot) {
	const pgmCh = Number(map.programCh(screenIdx + 1)) || null
	const prvCh = Number(map.previewCh(screenIdx + 1)) || null
	const separatePrv = !!(pgmCh && prvCh && prvCh !== pgmCh)
	const mirror = slot?.mirrorBorderOnPrv === true && separatePrv
	const onAir = []
	if (mirror) onAir.push({ channel: prvCh, layer: GLOBAL_BORDER_LAYER_PRV_MIRROR })
	else if (pgmCh) onAir.push({ channel: pgmCh, layer: normActivePgmLayer(slot?.activePgmLayer) })
	const clear = []
	if (pgmCh) {
		clear.push({ channel: pgmCh, layer: GLOBAL_BORDER_LAYER_PGM_A })
		clear.push({ channel: pgmCh, layer: GLOBAL_BORDER_LAYER_PGM_B })
	}
	if (mirror) clear.push({ channel: prvCh, layer: GLOBAL_BORDER_LAYER_PRV_MIRROR })
	return { pgmCh, onAir, clear }
}

/** Same shape as the web `sceneStateNoteGlobalBorderPushedToPgm` snapshot. */
function pgmAirSnapshotOf(slot) {
	return {
		enabled: !!slot.enabled,
		type: String(slot.type || 'border'),
		params: { ...(slot.params || {}), side: 'inside' },
		slices: Array.isArray(slot.slices) ? slot.slices : [],
		fadeDuration: Math.max(0, parseInt(String(slot.fadeDuration ?? 25), 10) || 25),
		artnetPatch: { startChannel: 1, universe: 0, ...(slot.artnetPatch || {}) },
		activePgmLayer: normActivePgmLayer(slot.activePgmLayer),
	}
}

/**
 * A look resolved from disk carries its own stale `globalBorder` copy; the web UI always takes with
 * the screen's slot instead (`scenes-preview-runtime.js`). Do the same for sceneId-only takes
 * (Companion) so a take never fades out a border the operator switched on.
 * @param {object} scene — resolved look (mutated copy returned)
 * @param {object | null} project — full project (`scenes.globalBorders`)
 * @param {number} screenIdx
 */
function withScreenGlobalBorder(scene, project, screenIdx) {
	if (!scene || typeof scene !== 'object') return scene
	if (!Number.isFinite(screenIdx) || screenIdx < 0 || screenIdx >= MAX_SCREENS) return scene
	const arr = project?.scenes?.globalBorders
	if (!Array.isArray(arr)) return scene
	const slot = arr[screenIdx]
	return { ...scene, globalBorder: slot && typeof slot === 'object' ? slot : null }
}

/**
 * `withScreenGlobalBorder` for a take on PGM `channel` (screen resolved from the channel map).
 * Any failure leaves the look untouched — a take must never fail over the border.
 */
function withScreenGlobalBorderForChannel(scene, ctx, channel) {
	try {
		const { getChannelMap } = require('../config/routing')
		const map = getChannelMap(ctx?.config || {}, ctx?.switcherOutputBusByChannel)
		let idx = -1
		for (let i = 0; i < (Number(map.screenCount) || 0); i++) {
			if (Number(map.programCh(i + 1)) === Number(channel)) {
				idx = i
				break
			}
		}
		if (idx < 0) return scene
		const { loadFullProject } = require('./project-scenes')
		return withScreenGlobalBorder(scene, loadFullProject(), idx)
	} catch {
		return scene
	}
}

module.exports = {
	GLOBAL_BORDER_LAYER_PRV_MIRROR,
	defaultGlobalBorderSlot,
	normalizeGlobalBordersArray,
	applyControlToSlot,
	screenBorderCasparSlots,
	pgmAirSnapshotOf,
	withScreenGlobalBorder,
	withScreenGlobalBorderForChannel,
}
