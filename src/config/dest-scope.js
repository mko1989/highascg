'use strict'

/**
 * WO-1029 — a look belongs to a DESTINATION, not to a screen number.
 *
 * Looks store `mainScope` = a screen index ("2" / "all"), and deleting / adding / reordering a destination shifts the
 * indices (normalizeScreenDestinations compacts them): box B (10.11) — two destinations deleted, the wall moved from
 * index 2 to 1, every look made for the wall still said "2" and a take without `mainIdx` answered 400 "no program
 * channel for main 2". Same class as the Live layout windows (src/system/operator-gui-reconcile.js, cells carry
 * `destId`). This is the ONE place that turns a stored scope into the screen of today:
 *  - a scope holder carries the destination id NEXT TO its index (`destScope` beside a look's `mainScope`, `destId`
 *    beside a preset item's `mainIdx` / a timeline's `screenIdx`); the index stays written (the destination's current
 *    index) so an older client / server and Companion keep working;
 *  - resolution is by destination first; no id (old data) → the index, when a screen has that index;
 *  - a destination that no longer exists → UNSCOPED: the holder is kept, never attached to whatever sits at that
 *    index now (a take needs an explicit screen);
 *  - `reconcileProject` stamps ids on holders that lack one (from the list the indices were made under) and rewrites
 *    the index to the destination's current one. An index that names no screen of that list is stamped `unscoped`.
 * Pure: no I/O. src/engine/project-dest-scope.js runs it on the active project when the list changes.
 */

const { normalizeScreenDestinations, isMainBusDestinationMode } = require('./screen-destinations')

const ALL = 'all'
const UNSCOPED = 'unscoped'

/** Scope holders of a project: where each keeps its id / index. `str`: the index is stored as a string. */
const LOOK_KEYS = { id: 'destScope', idx: 'mainScope', str: true }
const ITEM_KEYS = { id: 'destId', idx: 'mainIdx' }
const PRESET_KEYS = { id: 'destId', idx: 'targetMain' }
const TIMELINE_KEYS = { id: 'destId', idx: 'screenIdx' }

const idxOfDest = (d) => Math.max(0, parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0)

/**
 * The screens of a destination list: `[{ idx, destId }]` ascending, the first main-bus destination of each index (the
 * screen's owner, as screenLabelsFromConfig picks it). null = no list (a legacy box whose screen count follows Caspar):
 * resolution is then by index only, exactly as before.
 * @param {object | Array | null | undefined} src app config, `{ destinations }`, or a destinations array
 * @returns {Array<{ idx: number, destId: string }> | null}
 */
function screenRows(src) {
	if (!src || typeof src !== 'object') return null
	let raw
	if (Array.isArray(src)) raw = { destinations: src }
	else if (Array.isArray(src.destinations)) raw = src
	else if (src.screenDestinations && typeof src.screenDestinations === 'object' && Array.isArray(src.screenDestinations.destinations)) raw = src.screenDestinations
	else return null
	const dests = normalizeScreenDestinations(raw).destinations.filter((d) => d && isMainBusDestinationMode(d.mode))
	const byIdx = new Map()
	for (const d of dests) if (!byIdx.has(idxOfDest(d))) byIdx.set(idxOfDest(d), String(d.id))
	return [...byIdx.entries()].sort((a, b) => a[0] - b[0]).map(([idx, destId]) => ({ idx, destId }))
}

/** @param {Array<{idx:number,destId:string}>|null} rows @param {string} id */
function indexOfDest(rows, id) {
	const r = (rows || []).find((x) => x.destId === String(id))
	return r ? r.idx : -1
}

/** @param {Array<{idx:number,destId:string}>|null} rows @param {number} idx */
function destAt(rows, idx) {
	const r = (rows || []).find((x) => x.idx === idx)
	return r ? r.destId : ''
}

/** A stored index → number | 'all' | null (missing / not a number). */
function parseIdx(v) {
	if (v === undefined || v === null || v === '') return null
	if (String(v).trim() === ALL) return ALL
	const n = parseInt(String(v), 10)
	return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Where a scope holder is today.
 * @param {object} holder a look / preset item / timeline sendTo / timeline layer
 * @param {Array<{idx:number,destId:string}>|null} rows screenRows(...)
 * @param {{ id: string, idx: string }} [keys] LOOK_KEYS by default
 * @returns {{ idx: number | null, all: boolean, unscoped: boolean, by: 'dest' | 'index' | 'all' | 'none' }}
 */
function resolveScope(holder, rows, keys = LOOK_KEYS) {
	const h = holder && typeof holder === 'object' ? holder : {}
	const id = h[keys.id] != null ? String(h[keys.id]).trim() : ''
	const idx = parseIdx(h[keys.idx])
	if (id === ALL || idx === ALL) return { idx: null, all: true, unscoped: false, by: 'all' }
	if (id === UNSCOPED) return { idx: null, all: false, unscoped: true, by: 'none' }
	if (id && rows) {
		const i = indexOfDest(rows, id)
		return i >= 0 ? { idx: i, all: false, unscoped: false, by: 'dest' } : { idx: null, all: false, unscoped: true, by: 'none' }
	}
	if (idx === null) return { idx: null, all: false, unscoped: false, by: 'none' }
	if (rows && !rows.some((r) => r.idx === idx)) return { idx: null, all: false, unscoped: true, by: 'none' }
	return { idx, all: false, unscoped: false, by: 'index' }
}

/** The task's short form: current index | 'all' | null (unscoped / no scope). */
function screenOf(holder, rows, keys = LOOK_KEYS) {
	const r = resolveScope(holder, rows, keys)
	return r.all ? ALL : r.idx
}

/**
 * Stamp one holder: an id from `stampRows` when it has none, then its index from `indexRows`.
 * Mutates; → { stamped, unscoped, reindexed } (0 / 1 each).
 */
function reconcileHolder(holder, stampRows, indexRows, keys) {
	const out = { stamped: 0, unscoped: 0, reindexed: 0 }
	if (!holder || typeof holder !== 'object') return out
	const idx = parseIdx(holder[keys.idx])
	let id = holder[keys.id] != null ? String(holder[keys.id]).trim() : ''
	if (!id && stampRows) {
		if (idx === ALL) {
			if (keys.str) {
				holder[keys.id] = ALL
				out.stamped = 1
			}
			return out
		}
		if (idx === null) return out // no scope at all: nothing to keep
		id = destAt(stampRows, idx) || UNSCOPED
		holder[keys.id] = id
		if (id === UNSCOPED) out.unscoped = 1
		else out.stamped = 1
	}
	if (!id || id === ALL || id === UNSCOPED || !indexRows) return out
	const now = indexOfDest(indexRows, id)
	// a destination that is gone keeps its last index: it is resolved as unscoped by id, never by that number
	if (now >= 0 && now !== idx) {
		holder[keys.idx] = keys.str ? String(now) : now
		out.reindexed = 1
	}
	return out
}

const arr = (v) => (Array.isArray(v) ? v : [])

/** Every scope holder of a project (or of a live deck `{ sceneSnapshots, lookPresets }`) with its keys. */
function holdersOf(project) {
	const out = []
	const sc = project?.scenes && typeof project.scenes === 'object' ? project.scenes : null
	for (const s of arr(sc?.scenes)) out.push([s, LOOK_KEYS, 'look'])
	for (const s of arr(project?.sceneSnapshots)) out.push([s, LOOK_KEYS, 'look'])
	for (const p of [...arr(sc?.lookPresets), ...arr(project?.lookPresets)]) {
		if (!p || typeof p !== 'object') continue
		if (p.targetMain != null) out.push([p, PRESET_KEYS, 'preset'])
		for (const it of arr(p.items)) out.push([it, ITEM_KEYS, 'presetItem'])
	}
	for (const tl of arr(project?.timelines?.timelines)) {
		if (!tl || typeof tl !== 'object') continue
		// sendTo.screenIdx null / 'all' = every screen: no destination to keep
		if (tl.sendTo && typeof tl.sendTo === 'object' && parseIdx(tl.sendTo.screenIdx) !== null && parseIdx(tl.sendTo.screenIdx) !== ALL) {
			out.push([tl.sendTo, TIMELINE_KEYS, 'timeline'])
		}
		for (const l of arr(tl.layers)) if (l && typeof l === 'object' && typeof l.screenIdx === 'number') out.push([l, TIMELINE_KEYS, 'timelineLayer'])
	}
	return out
}

/**
 * Stamp + re-index every scope holder of a project IN PLACE.
 * @param {object} project
 * @param {{ stampWith?: Array|null, indexWith?: Array|null }} lists screenRows of the list the indices were made under
 *   (stampWith) and of the list of today (indexWith)
 * @returns {{ changed: boolean, stamped: number, unscoped: number, reindexed: number, byKind: Record<string, number> }}
 */
function reconcileProject(project, lists = {}) {
	const stats = { changed: false, stamped: 0, unscoped: 0, reindexed: 0, byKind: {} }
	if (!project || typeof project !== 'object') return stats
	const stampWith = lists.stampWith || null
	const indexWith = lists.indexWith || null
	if (!stampWith && !indexWith) return stats
	for (const [h, keys, kind] of holdersOf(project)) {
		const r = reconcileHolder(h, stampWith, indexWith, keys)
		stats.stamped += r.stamped
		stats.unscoped += r.unscoped
		stats.reindexed += r.reindexed
		if (r.stamped || r.unscoped || r.reindexed) stats.byKind[kind] = (stats.byKind[kind] || 0) + 1
	}
	stats.changed = stats.stamped + stats.unscoped + stats.reindexed > 0
	return stats
}

/**
 * Does a look match a repair's `from`: 'unscoped' (every look with no screen), an old index ("2": an unscoped look
 * whose stored index is 2), or a destination id (looks scoped to it — a deleted one, or any).
 */
function matchesFrom(look, from, rows) {
	const f = String(from ?? '').trim()
	if (!f) return false
	const r = resolveScope(look, rows)
	if (f === UNSCOPED) return r.unscoped
	if (/^\d+$/.test(f)) return r.unscoped && parseIdx(look.mainScope) === parseInt(f, 10)
	return String(look.destScope || '') === f
}

/**
 * The operator's repair: looks that match `from` → destination `toId` (its current index written as mainScope).
 * Mutates the looks; → number re-scoped, or -1 when `toId` names no screen of `rows`.
 * @param {Array<object>} looks
 */
function rescopeLooks(looks, from, toId, rows) {
	const to = String(toId || '').trim()
	const idx = to === ALL ? ALL : indexOfDest(rows, to)
	if (idx === -1) return -1
	let n = 0
	for (const l of arr(looks)) {
		if (!l || typeof l !== 'object' || !matchesFrom(l, from, rows)) continue
		l.destScope = to
		l.mainScope = String(idx)
		n++
	}
	return n
}

module.exports = {
	ALL,
	ITEM_KEYS,
	screenRows,
	indexOfDest,
	destAt,
	resolveScope,
	screenOf,
	reconcileProject,
	rescopeLooks,
	matchesFrom,
}
