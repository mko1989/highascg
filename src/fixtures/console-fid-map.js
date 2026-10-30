'use strict'

/**
 * WO-857 — console head number (FixtureID) ↔ patch fixture id. WO-796 made MagicQ's head numbers equal the MVR
 * FixtureIDs of the scene the patch came from, and a grandMA3 patched from the same MVR has the same FIDs, so the map is
 * the scene's: a patch entry `mvr-<uuid>` has the FixtureID of the scene object with that uuid. A patch entry may also
 * carry an explicit integer `fid` (hand-patched rigs); it wins. Entries with neither stay unmapped (their head numbers
 * come back as `unmatched`, never guessed).
 *
 *   buildFidMap(patch, fidOfUuid) → { byFid: Map<number, string[]>, byId: Map<string, number> }
 *   createFidResolver({ loadProject, loadScene }) → { map(), heads(fids) → { ids, unmatched }, fids(ids) → { fids, unmatched } }
 */

const MAX_FID = 2147483647

/** A FixtureID text / number → a positive integer, else 0. */
function toFid(v) {
	const n = typeof v === 'number' ? v : /^\s*\d{1,10}\s*$/.test(String(v ?? '')) ? Number(v) : NaN
	return Number.isInteger(n) && n >= 1 && n <= MAX_FID ? n : 0
}

/** @param {object[]} patch project.fixtures.patch @param {(uuid: string) => number} [fidOfUuid] the scene's FixtureID of an MVR uuid (0 = none) */
function buildFidMap(patch, fidOfUuid) {
	const byFid = new Map()
	const byId = new Map()
	for (const fx of Array.isArray(patch) ? patch : []) {
		const id = fx && typeof fx.id === 'string' ? fx.id : ''
		if (!id) continue
		let fid = toFid(fx.fid)
		const m = /^mvr-(.+)$/.exec(id)
		if (!fid && m && fidOfUuid) fid = toFid(fidOfUuid(m[1].toLowerCase()))
		if (!fid) continue
		byId.set(id, fid)
		if (!byFid.has(fid)) byFid.set(fid, [])
		byFid.get(fid).push(id)
	}
	return { byFid, byId }
}

/** uuid (lower case) → FixtureID of the stored MVR scene's fixtures (projects/_mvr/<id>.json, mvr-store.get). */
function sceneFids(rec) {
	const out = new Map()
	for (const o of Array.isArray(rec?.scene?.objects) ? rec.scene.objects : []) {
		const fid = toFid(o?.fixture?.id)
		if (fid && o.uuid) out.set(String(o.uuid).toLowerCase(), fid)
	}
	return out
}

function createFidResolver(deps = {}) {
	const loadProject = deps.loadProject || (() => require('../engine/project-scenes').loadFullProject())
	const loadScene = deps.loadScene || ((id) => require('../stage/mvr-store').get(id))
	let scene = { id: '', fids: new Map() }
	let cache = { key: '', map: buildFidMap([]) }

	function map() {
		const project = loadProject() || {}
		const patch = project.fixtures?.patch
		const mvrId = String(project.previs?.mvr?.id || '')
		const key = mvrId + '\n' + JSON.stringify((Array.isArray(patch) ? patch : []).map((f) => [f?.id, f?.fid]))
		if (key === cache.key) return cache.map
		if (mvrId !== scene.id) {
			let fids = new Map()
			try {
				fids = sceneFids(mvrId ? loadScene(mvrId) : null)
			} catch (_) {
				/* scene file gone: only explicit fids resolve */
			}
			scene = { id: mvrId, fids }
		}
		cache = { key, map: buildFidMap(patch, (u) => scene.fids.get(u) || 0) }
		return cache.map
	}

	return {
		map,
		/** Head numbers → patch fixture ids (in head order, each id once) + the head numbers nothing is patched under. */
		heads(fids) {
			const { byFid } = map()
			const ids = []
			const unmatched = []
			for (const h of fids) {
				const hit = byFid.get(h)
				if (!hit) unmatched.push(h)
				else for (const id of hit) if (!ids.includes(id)) ids.push(id)
			}
			return { ids, unmatched }
		},
		/** Patch fixture ids → head numbers (sorted, unique) + the ids that have none. */
		fids(ids) {
			const { byId } = map()
			const out = new Set()
			const unmatched = []
			for (const id of ids) (byId.has(id) ? out.add(byId.get(id)) : unmatched.push(id))
			return { fids: [...out].sort((a, b) => a - b), unmatched }
		},
	}
}

module.exports = { buildFidMap, sceneFids, createFidResolver, toFid }
