/**
 * Channel/aspect resolution, layout persistence, and WO-323 source-tile persistence for
 * operator-compose-tiles.js.
 */
import { parseRouteValue, resolveMvCellSourceChannel } from '../lib/input-channels.js'
import { DEFAULT_TILE_ASPECT, computeDefaultTileLayout } from './operator-compose-tiles-geometry.js'

/**
 * Source aspect ratio (w/h) for a tile: the resolved source channel's INFO-derived resolution
 * (`channelMap.channelResolutionsByChannel`) wins; `programResolutions[mainIndex]` is the
 * pre-INFO fallback (PGM/PRV share the physical screen's mode); default {@link DEFAULT_TILE_ASPECT}.
 * Pure — mirrors the server's own contain-fit source dims (operator-gui-channel.js
 * `resolveCellSourceDims`) so the server's aspect-fit inside the reported hole is a no-op.
 * @param {{ role?: string, mainIndex?: number }} def
 * @param {object} cm - `stateStore.getState().channelMap`
 * @returns {number}
 */
export function resolveTileAspect(def, cm) {
	const map = cm || {}
	const ch = resolveTileChannel(def || {}, map)
	const byCh = map.channelResolutionsByChannel || {}
	const res = ch != null ? byCh[ch] ?? byCh[String(ch)] : null
	if (res && Number(res.w) > 0 && Number(res.h) > 0) return Number(res.w) / Number(res.h)
	const pr = map.programResolutions?.[def?.mainIndex ?? -1]
	if (pr && Number(pr.w) > 0 && Number(pr.h) > 0) return Number(pr.w) / Number(pr.h)
	return DEFAULT_TILE_ASPECT
}

/**
 * Has the real channel state arrived yet? (2026-07-19 bug: "after highascg restart the operator gui
 * starts with a stale compose preview layout".)
 *
 * The kiosk client renders this canvas BEFORE the WS `state` message lands, so
 * `stateStore.getState().channelMap` is still `{}` — preview-canvas-panel.js's `getComposeCellDefs`
 * then reads `Math.max(1, cm.screenCount || 1)` and produces ONE provisional `pgm_1` def, whose
 * layout {@link resolveTileLayout} legitimately defaults to a single full-canvas tile (the saved
 * multi-screen map is stored under a different {@link layoutStorageKey}, keyed by screen count, and
 * would not cover `pgm_1` anyway). Reporting that provisional rect CLOBBERS the multi-cell layout
 * the server just re-applied from `operatorGuiLayout` persistence. So: report nothing until this
 * returns true. `screenCount` is always present on a server-built channelMap
 * (src/config/channel-map-from-ctx.js), so its absence is an unambiguous "not booted yet".
 * @param {object|null|undefined} cm - `stateStore.getState().channelMap`
 * @returns {boolean}
 */
export function hasResolvedChannelState(cm) {
	const map = cm || {}
	const n = Number(map.screenCount)
	if (Number.isFinite(n) && n >= 1) return true
	return Array.isArray(map.programChannels) && map.programChannels.length > 0
}

/** localStorage key for a screen-count-keyed tile layout, following preview-canvas-panel.js's `storageKeyPrefix` convention. */
export function layoutStorageKey(storageKeyPrefix, screenCount) {
	return `${storageKeyPrefix || 'casparcg_preview'}_operator_tiles_${Math.max(1, parseInt(screenCount, 10) || 1)}`
}

/**
 * Resolve the layout to render: the stored map wins ONLY when it covers every current def id
 * (a screen-count/role-set change re-defaults wholesale, matching the "Reset layout" mental model
 * rather than producing a half-migrated mix). Pure — no localStorage access.
 * @param {Array<{ id: string, role: string, mainIndex: number }>} defs
 * @param {Record<string, { x: number, y: number, w: number, h: number }> | null | undefined} storedMap
 */
export function resolveTileLayout(defs, storedMap) {
	const ids = Array.isArray(defs) ? defs.map((d) => d.id) : []
	const hasAll = storedMap && ids.length > 0 && ids.every((id) => storedMap[id])
	if (hasAll) {
		const out = {}
		for (const id of ids) out[id] = storedMap[id]
		return out
	}
	return computeDefaultTileLayout(defs)
}

/** @param {{ getItem: (k: string) => string | null }} storage */
export function loadTileLayout(storage, key) {
	try {
		const raw = storage?.getItem?.(key)
		if (!raw) return null
		const parsed = JSON.parse(raw)
		return parsed && typeof parsed === 'object' ? parsed : null
	} catch (_) {
		return null
	}
}

/** @param {{ setItem: (k: string, v: string) => void }} storage */
export function saveTileLayout(storage, key, layoutMap) {
	try {
		storage?.setItem?.(key, JSON.stringify(layoutMap))
	} catch (_) {
		// Best-effort — a full/unavailable localStorage must not break the canvas.
	}
}

export function resolveTileChannel(d, cm) {
	// WO-323 user source tile: explicit channel, resolved from the tile's route value at def-build
	// time (resolveSourceTileChannel) — never mainIndex-addressable.
	if (d.role === 'mvcell') {
		const ch = Number(d.srcCh)
		return Number.isFinite(ch) && ch > 0 ? Math.floor(ch) : null
	}
	if (d.role === 'prv') return cm.previewChannels?.[d.mainIndex] ?? null
	return cm.playbackChannels?.[d.mainIndex] ?? cm.programChannels?.[d.mainIndex] ?? null
}

/*
 * WO-323 — user-added live-source tiles (Decklink/NDI/… from the Sources panel Live tab, dropped
 * onto this canvas like the multiview editor). Persisted SEPARATELY from the pgm/prv layout map so
 * {@link resolveTileLayout}'s "re-default wholesale on role-set change" rule never wipes them.
 * Each stored tile keeps its original drag payload identity ({ type, value, label }) so the
 * channel is re-resolved against the CURRENT channel map on every rebuild (WO-271 route-heal via
 * resolveMvCellSourceChannel — a channel-map shift must not leave the tile on a stale number).
 */

/** localStorage key for the user source tiles (shared across screen counts — they are user content). */
export function sourceTilesStorageKey(storageKeyPrefix) {
	return `${storageKeyPrefix || 'casparcg_preview'}_operator_source_tiles`
}

/** @returns {Array<{ id: string, type: string, value: string, label: string, frac: object }>} */
export function loadSourceTiles(storage, key) {
	try {
		const raw = storage?.getItem?.(key)
		if (!raw) return []
		const parsed = JSON.parse(raw)
		if (!Array.isArray(parsed)) return []
		return parsed.filter((t) => t && typeof t === 'object' && typeof t.value === 'string' && t.id)
	} catch (_) {
		return []
	}
}

export function saveSourceTiles(storage, key, list) {
	try {
		storage?.setItem?.(key, JSON.stringify(Array.isArray(list) ? list : []))
	} catch (_) {
		// Best-effort — a full/unavailable localStorage must not break the canvas.
	}
}

/**
 * Normalize a Sources-panel drag payload (sources-panel-helpers.js makeDraggable: single
 * `{ type, value, label, … }` or `{ type: 'multi', items: [...] }`) to a flat item list.
 * @returns {Array<{ type: string, value: string, label: string }>}
 */
export function normalizeSourceDropItems(data) {
	if (!data || typeof data !== 'object') return []
	const items = data.type === 'multi' && Array.isArray(data.items) ? data.items : [data]
	return items
		.filter((it) => it && typeof it.value === 'string' && it.value)
		.map((it) => ({ type: String(it.type || ''), value: it.value, label: String(it.label || it.value), resolution: it.resolution }))
}

/**
 * Rejection message for dropping a source onto the compose tiles, or null when allowed.
 * Blocks: non-route values (a source with no Caspar channel cannot be composed — e.g. direct NDI
 * without a host channel), the multiview outputs (WO-156 — routing a multiview into a cell wedges
 * it) and the operator-GUI compose channel itself (self-route would wedge the compose mosaic the
 * same way).
 * @param {string} value - drag payload value
 * @param {object} cm - state.channelMap
 * @returns {string|null}
 */
export function sourceTileRejection(value, cm) {
	const parsed = parseRouteValue(value)
	if (!parsed) {
		return `"${value}" has no playout channel to compose — only route:// live sources (configured inputs) can be added.`
	}
	const map = cm || {}
	const mvChs = Array.isArray(map.multiviewChannels) && map.multiviewChannels.length
		? map.multiviewChannels.map(Number)
		: (map.multiviewCh != null ? [Number(map.multiviewCh)] : [])
	if (mvChs.includes(parsed.channel)) {
		return `Cannot compose route://${parsed.channel} — channel ${parsed.channel} is a multiview output (routing it into a cell would freeze it).`
	}
	if (map.operatorGuiCh != null && parsed.channel === Number(map.operatorGuiCh)) {
		return `Cannot compose route://${parsed.channel} — channel ${parsed.channel} is the compose output itself.`
	}
	return null
}

/**
 * Resolve a stored source tile's CURRENT channel: identity-first heal against the live channel
 * map (WO-271, same resolver the multiview editor uses), so a Decklink tile follows its slot
 * across channel-map shifts. Null when the route is stale and unresolvable.
 * @param {{ id?: string, type?: string, value?: string, label?: string }} tile
 * @param {object} cm - state.channelMap
 * @returns {number|null}
 */
export function resolveSourceTileChannel(tile, cm) {
	const parsed = parseRouteValue(tile?.value)
	if (!parsed) return null
	return resolveMvCellSourceChannel({ id: tile.id, type: tile.type, label: tile.label }, parsed, cm)
}

/**
 * WO-529 (owner 14.08: *"the compose preview just 'remembers' either the settings of looks eidotr
 * or timeline, never both at the same time"*).
 *
 * The looks editor and the timeline editor each own a tile canvas, and both report into ONE shared
 * server layout, tagged `surface` ('compose' / 'timeline'). But {@link tileSeedKey} is
 * `role:mainIndex` — the surface is NOT part of it — so the two editors' `pgm_1` cells collide.
 * Seeding either canvas from the whole layout therefore applied whichever surface was written
 * last, to BOTH, and `seedHostLayoutFromCells` persists what it seeds — so one editor's
 * arrangement permanently overwrote the other's.
 *
 * A canvas must only ever seed from its own surface's cells. Untagged cells are treated as
 * 'compose': that was the only surface when the layout format was introduced, so old persisted
 * records keep restoring into the looks editor rather than silently becoming unseedable.
 *
 * @param {Array<object>|null|undefined} cells
 * @param {string} surface
 * @returns {Array<object>}
 */
export function cellsForSurface(cells, surface) {
	const want = String(surface || 'compose')
	return (Array.isArray(cells) ? cells : []).filter((c) => String(c?.surface || 'compose') === want)
}

/** seedFromCells identity: source tiles are keyed by their routed channel, never mainIndex (all 0). */
export function tileSeedKey(c) {
	return c.role === 'mvcell' ? `mvcell:${c.srcCh}` : `${c.role}:${c.mainIndex}`
}
