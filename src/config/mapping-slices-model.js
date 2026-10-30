'use strict'

/**
 * WO-869 — the mapping node's slice list (`node.settings.slices[]`), Resolume terms: the node's outputs are Screens,
 * slices are Slices (a source rectangle of the node's input feed → a placement on one output, optionally rotated,
 * flipped, keystoned, faded). One stored model, whatever backend draws it (mapping-slices-plan.js decides).
 *
 * Supersedes `settings.mappings[]` ({outputId, type:'video_slice', rect, rotation, targetPos}: one source rect per
 * output, shown 1:1 where it sat). Migration (owner decisions 30.10):
 *   - each output's FIRST legacy mapping becomes one slice: src = rect, dst.rect = {0, 0, w, h}; the output gets
 *     `pos = {rect.x, rect.y}` (where a GPU head sat on the canvas);
 *   - legacy `rotation` / `targetPos` never reached a backend: dropped, the non-zero rotations are counted (Q10);
 *   - further mappings on the same output were never drawn (`find` took the first): dropped and counted.
 * The web pixel-map editor still edits `mappings[]` (Q4: it keeps working through the migration): the server keeps
 * `mappings[]` as a mirror of each output's first slice and folds a legacy edit of that mirror back into the slices
 * (reconcileNodeSettings).
 */

const MAX_SLICES = 64

/** @param {unknown} v @param {number} d */
function num(v, d) {
	const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v)
	return Number.isFinite(n) ? n : d
}

function int(v, d) {
	return Math.round(num(v, d))
}

function pos(v, d) {
	return Math.max(1, int(v, d))
}

function clamp01(v, d) {
	return Math.min(1, Math.max(0, num(v, d)))
}

/** Degrees into (-180, 180]. */
function normRotation(v) {
	let r = num(v, 0) % 360
	if (r > 180) r -= 360
	if (r <= -180) r += 360
	return Object.is(r, -0) ? 0 : r
}

/** @param {object} r @param {{x:number,y:number,w:number,h:number}} d */
function normRect(r, d) {
	const o = r && typeof r === 'object' ? r : {}
	return { x: int(o.x, d.x), y: int(o.y, d.y), w: pos(o.w, d.w), h: pos(o.h, d.h) }
}

function normWarp(w) {
	const a = Array.isArray(w) ? w : []
	return [0, 1, 2, 3].map((i) => {
		const p = Array.isArray(a[i]) ? a[i] : []
		return [num(p[0], 0), num(p[1], 0)]
	})
}

function normFeather(f) {
	const o = f && typeof f === 'object' ? f : {}
	const one = (k) => Math.max(0, int(o[k], 0))
	return { l: one('l'), t: one('t'), r: one('r'), b: one('b') }
}

/**
 * @param {object} raw
 * @param {number} i index in the list (default name / id)
 * @param {{ outputIds: string[], defaultSize?: {w:number,h:number} }} ctx
 */
function normalizeSlice(raw, i, ctx) {
	const s = raw && typeof raw === 'object' ? raw : {}
	const ids = Array.isArray(ctx?.outputIds) ? ctx.outputIds : []
	const size = ctx?.defaultSize || { w: 1920, h: 1080 }
	const outputId = ids.includes(String(s.outputId || '')) ? String(s.outputId) : ids[0] || String(s.outputId || 'out_1')
	const src = normRect(s.src, { x: 0, y: 0, w: size.w, h: size.h })
	const d = s.dst && typeof s.dst === 'object' ? s.dst : {}
	return {
		id: String(s.id || '').trim() || `slice_${i + 1}`,
		name: String(s.name ?? '').trim() || `Slice ${i + 1}`,
		outputId,
		enabled: s.enabled !== false,
		source: { kind: 'feed' }, // v1 (Q5): every slice cuts the node's own feed
		src,
		dst: {
			rect: normRect(d.rect, { x: 0, y: 0, w: src.w, h: src.h }),
			rotation: normRotation(d.rotation),
			flipH: d.flipH === true,
			flipV: d.flipV === true,
			warp: normWarp(d.warp),
		},
		opacity: clamp01(s.opacity, 1),
		feather: normFeather(s.feather),
		z: int(s.z, 0),
	}
}

/** Unique ids (a duplicate id gets a suffix), at most MAX_SLICES. */
function normalizeSlices(list, ctx) {
	const seen = new Set()
	const out = []
	for (const raw of Array.isArray(list) ? list.slice(0, MAX_SLICES) : []) {
		const s = normalizeSlice(raw, out.length, ctx)
		let id = s.id
		for (let k = 2; seen.has(id); k++) id = `${s.id}_${k}`
		s.id = id
		seen.add(id)
		out.push(s)
	}
	return out
}

function outputIdsOf(settings) {
	return (Array.isArray(settings?.outputs) ? settings.outputs : []).map((o) => String(o?.id || '')).filter(Boolean)
}

function legacyRect(m) {
	const r = m?.rect
	if (!r || typeof r !== 'object') return null
	const w = Number(r.w)
	const h = Number(r.h)
	if (!(Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0)) return null
	return { x: int(r.x, 0), y: int(r.y, 0), w: Math.round(w), h: Math.round(h) }
}

/**
 * Legacy `mappings[]` → slices (+ output positions). Pure; `settings` is not modified.
 * @returns {{ slices: object[], outputs: object[], droppedRotations: number, droppedExtra: number }}
 */
function migrateLegacyMappings(settings) {
	const outputs = (Array.isArray(settings?.outputs) ? settings.outputs : []).map((o) => ({ ...o }))
	const mappings = Array.isArray(settings?.mappings) ? settings.mappings : []
	const ids = outputs.map((o) => String(o?.id || '')).filter(Boolean)
	let droppedRotations = 0
	let droppedExtra = 0
	const raw = []
	const taken = new Set()
	for (const m of mappings) {
		if (!m || typeof m !== 'object') continue
		if (m.type && m.type !== 'video_slice') continue
		if (normRotation(m.rotation) !== 0) droppedRotations++
		const oid = String(m.outputId || '')
		const rect = legacyRect(m)
		if (!rect || !ids.includes(oid) || taken.has(oid)) {
			droppedExtra++
			continue
		}
		taken.add(oid)
		const out = outputs.find((o) => String(o.id) === oid)
		if (out && !(out.pos && typeof out.pos === 'object')) out.pos = { x: rect.x, y: rect.y }
		raw.push({
			id: String(m.id || '').trim() || `slice_${oid}`,
			name: String(m.label || out?.label || ''),
			outputId: oid,
			src: rect,
			dst: { rect: { x: 0, y: 0, w: rect.w, h: rect.h } },
		})
	}
	return { slices: normalizeSlices(raw, { outputIds: ids }), outputs, droppedRotations, droppedExtra }
}

/** The node's slices: the stored list (normalised) or, for a node never saved since WO-869, the migration. */
function effectiveSlices(node) {
	const st = node?.settings || {}
	if (Array.isArray(st.slices)) return normalizeSlices(st.slices, { outputIds: outputIdsOf(st) })
	return migrateLegacyMappings(st).slices
}

/** `mappings[]` as the web editor reads it: each output's first slice, src rect only. */
function legacyMappingsMirror(slices) {
	const out = []
	const taken = new Set()
	for (const s of Array.isArray(slices) ? slices : []) {
		if (taken.has(s.outputId)) continue
		taken.add(s.outputId)
		out.push({ id: s.id, type: 'video_slice', label: s.name, outputId: s.outputId, rect: { ...s.src }, rotation: 0 })
	}
	return out
}

function same(a, b) {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * A legacy client changed the mirror: fold each mirror entry back into its slice (src follows the rect; a 1:1 dst
 * keeps following the size), new entries become slices, removed entries drop their slice.
 */
function foldLegacyEdit(slices, prevMirror, nextMappings, outputIds) {
	const list = slices.map((s) => JSON.parse(JSON.stringify(s)))
	const nextById = new Map()
	for (const m of Array.isArray(nextMappings) ? nextMappings : []) {
		if (m && typeof m === 'object' && (!m.type || m.type === 'video_slice')) nextById.set(String(m.id || ''), m)
	}
	const prevIds = new Set((prevMirror || []).map((m) => String(m.id)))
	const kept = list.filter((s) => !prevIds.has(s.id) || nextById.has(s.id))
	for (const [id, m] of nextById) {
		const rect = legacyRect(m)
		if (!rect) continue
		const s = kept.find((x) => x.id === id)
		if (!s) {
			const oid = outputIds.includes(String(m.outputId || '')) ? String(m.outputId) : outputIds[0]
			kept.push({ id: id || undefined, name: String(m.label || ''), outputId: oid, src: rect, dst: { rect: { x: 0, y: 0, w: rect.w, h: rect.h } } })
			continue
		}
		const oneToOne = s.dst.rect.w === s.src.w && s.dst.rect.h === s.src.h
		s.src = rect
		if (oneToOne) s.dst.rect = { ...s.dst.rect, w: rect.w, h: rect.h }
		if (outputIds.includes(String(m.outputId || ''))) s.outputId = String(m.outputId)
	}
	return normalizeSlices(kept, { outputIds })
}

/**
 * The settings to persist for one mapping node, given what the client sent (`next`) and what is stored (`prev`):
 *   - slices sent and changed → a slice-aware client: they win;
 *   - slices unchanged but `mappings[]` changed → a legacy client (web pixel-map editor): fold the edit in;
 *   - no slices anywhere → migrate.
 * Always returns normalised `slices` and the regenerated `mappings[]` mirror. Pure.
 * @returns {{ settings: object, migrated: boolean, droppedRotations: number, droppedExtra: number }}
 */
function reconcileNodeSettings(nextSettings, prevSettings) {
	const next = nextSettings && typeof nextSettings === 'object' ? nextSettings : {}
	const prev = prevSettings && typeof prevSettings === 'object' ? prevSettings : {}
	const ids = outputIdsOf(next)
	const hasPrev = Object.keys(prev).length > 0
	// What the client was shown: GET answers a never-saved node with its migration (withEffectiveSlices).
	let prevSlices = null
	if (Array.isArray(prev.slices)) prevSlices = normalizeSlices(prev.slices, { outputIds: ids })
	else if (hasPrev) prevSlices = migrateLegacyMappings(prev).slices
	const sent = Array.isArray(next.slices) ? normalizeSlices(next.slices, { outputIds: ids }) : null
	const mappingsChanged = hasPrev && !same(next.mappings, prev.mappings)
	let slices
	if (sent && (!prevSlices || !same(sent, prevSlices))) slices = sent // a slice-aware client edited them / new node
	else if (prevSlices && mappingsChanged) slices = foldLegacyEdit(prevSlices, prev.mappings, next.mappings, ids) // web
	else if (prevSlices) slices = prevSlices
	else slices = migrateLegacyMappings(next).slices
	// The first save of a node that had no stored slices is its migration: count what it drops, keep head positions.
	const migrated = !Array.isArray(prev.slices) && (hasPrev || !sent)
	let outputs = Array.isArray(next.outputs) ? next.outputs : []
	let droppedRotations = 0
	let droppedExtra = 0
	if (migrated) {
		const m = migrateLegacyMappings(hasPrev ? prev : next)
		droppedRotations = m.droppedRotations
		droppedExtra = m.droppedExtra
		outputs = outputs.map((o) => {
			if (o?.pos && typeof o.pos === 'object') return o
			const mo = m.outputs.find((x) => String(x?.id) === String(o?.id))
			return mo?.pos ? { ...o, pos: mo.pos } : o
		})
	}
	return {
		settings: { ...next, outputs, slices, mappings: legacyMappingsMirror(slices) },
		migrated,
		droppedRotations,
		droppedExtra,
	}
}

/**
 * Every pixel_mapping node of `nextGraph` reconciled against `prevGraph` (the stored one). Returns a new graph
 * (touched nodes get new settings objects; nothing in either input is mutated) and a log line per migration.
 */
function reconcileGraphSlices(nextGraph, prevGraph, log) {
	if (!nextGraph || !Array.isArray(nextGraph.devices)) return nextGraph
	const prevById = new Map(
		(Array.isArray(prevGraph?.devices) ? prevGraph.devices : []).map((d) => [String(d?.id || ''), d]),
	)
	const devices = nextGraph.devices.map((d) => {
		if (!d || d.role !== 'pixel_mapping') return d
		const r = reconcileNodeSettings(d.settings, prevById.get(String(d.id))?.settings)
		if (r.migrated && typeof log === 'function') {
			log('info', `[mapping-slices] ${d.id}: migrated ${r.settings.slices.length} slice(s) from mappings[]` +
				` (dropped: ${r.droppedRotations} rotation value(s), ${r.droppedExtra} undrawn mapping(s))`)
		}
		return { ...d, settings: r.settings }
	})
	return { ...nextGraph, devices }
}

/** For GET: nodes without stored slices show their migration (the stored config is left as it is). */
function withEffectiveSlices(graph) {
	if (!graph || !Array.isArray(graph.devices)) return graph
	return {
		...graph,
		devices: graph.devices.map((d) => {
			if (!d || d.role !== 'pixel_mapping' || Array.isArray(d.settings?.slices)) return d
			const m = migrateLegacyMappings(d.settings || {})
			return { ...d, settings: { ...(d.settings || {}), outputs: m.outputs, slices: m.slices } }
		}),
	}
}

module.exports = {
	MAX_SLICES,
	normalizeSlice,
	normalizeSlices,
	migrateLegacyMappings,
	effectiveSlices,
	legacyMappingsMirror,
	reconcileNodeSettings,
	reconcileGraphSlices,
	withEffectiveSlices,
	normRotation,
}
