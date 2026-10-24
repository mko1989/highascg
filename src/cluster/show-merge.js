'use strict'

/**
 * WO-746 — the shared show as data: what of a project is shared, its hash, item-level deltas, and the 3-way merge the
 * master runs when a linked server's operator edits the show at the same time as another operator.
 *
 * The show = the project minus what belongs to one box: device-local hardware slices (config-classify.js — cables,
 * Caspar wiring, screen ports, routing), the stream credentials (`streaming`: a stream key on two boxes is two
 * streams into one ingest), and the volatile stamps (`rev`, `savedAt`, `slug`, `_…`).
 *
 * Paths: an object key is a string segment; an item of a KEYED array (every element an object with a unique string
 * `id`: looks in scenes.scenes, timelines, cells …) is `{ id }`, so two operators adding or editing different looks
 * never touch the same path. Other arrays and primitives are atomic values.
 *   op = { p, v }   set the value at p (adds a key / an item)
 *        { p, d: 1 } delete it
 *        { p, o: [ids] } the item order of the keyed array at p
 */

const crypto = require('crypto')
const { stripDeviceLocalFromProject } = require('../config/config-classify')
const { stableJson } = require('./cluster-call')

const VOLATILE = new Set(['rev', 'savedAt', 'slug', 'streaming'])

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isItem = (v) => isObj(v) && typeof v.id === 'string' && v.id !== ''
function keyed(a) {
	if (!Array.isArray(a) || !a.every(isItem)) return false
	return new Set(a.map((x) => x.id)).size === a.length
}
/** Two arrays are merged per item when both are keyed (an empty one counts) and one has items. */
const keyedPair = (a, b) => keyed(a) && keyed(b) && (a.length > 0 || b.length > 0)
const same = (a, b) => a === b || stableJson(a) === stableJson(b)

/** The shared slice of a project (a new object; the project is untouched). */
function showOf(project) {
	if (!isObj(project)) return {}
	const s = stripDeviceLocalFromProject(project)
	for (const k of Object.keys(s)) if (VOLATILE.has(k) || k.startsWith('_')) delete s[k]
	return s
}

const hashShow = (show) => crypto.createHash('sha256').update(stableJson(show)).digest('hex').slice(0, 16)

/** Item-level ops that turn a into b. */
function diff(a, b, p = [], out = []) {
	if (same(a, b)) return out
	if (isObj(a) && isObj(b)) {
		for (const k of Object.keys(a)) if (!(k in b)) out.push({ p: [...p, k], d: 1 })
		for (const k of Object.keys(b)) {
			if (!(k in a)) out.push({ p: [...p, k], v: b[k] })
			else diff(a[k], b[k], [...p, k], out)
		}
		return out
	}
	if (keyedPair(a, b)) {
		const am = new Map(a.map((x) => [x.id, x]))
		const bm = new Map(b.map((x) => [x.id, x]))
		for (const id of am.keys()) if (!bm.has(id)) out.push({ p: [...p, { id }], d: 1 })
		for (const [id, x] of bm) {
			if (!am.has(id)) out.push({ p: [...p, { id }], v: x })
			else diff(am.get(id), x, [...p, { id }], out)
		}
		const ids = b.map((x) => x.id)
		if (ids.join('\u0000') !== a.map((x) => x.id).filter((id) => bm.has(id)).concat(b.filter((x) => !am.has(x.id)).map((x) => x.id)).join('\u0000'))
			out.push({ p, o: ids })
		return out
	}
	out.push({ p, v: b })
	return out
}

const seg = (s) => (typeof s === 'string' ? s : `[${s.id}]`)
const pathText = (p) => p.map(seg).join('.').replace(/\.\[/g, '[')
const segEq = (a, b) => (typeof a === 'string' ? a === b : typeof b !== 'string' && a.id === b.id)
/** a is b, or one lies inside the other. */
const overlap = (a, b) => a.slice(0, Math.min(a.length, b.length)).every((s, i) => segEq(s, b[i]))

/** Apply ops to a copy of doc → { doc, skipped } (an op whose parent is gone, e.g. deleted by the other side, skips). */
function apply(doc, ops) {
	let root = structuredClone(doc)
	const skipped = []
	for (const op of ops) {
		if (!op.p.length) {
			if ('v' in op) root = structuredClone(op.v)
			continue
		}
		const parent = walk(root, op.p.slice(0, -1))
		if (!applyAt(parent, op, op.p[op.p.length - 1])) skipped.push(op)
	}
	return { doc: root, skipped }
}

function walk(node, path) {
	for (const s of path) {
		if (node == null) return undefined
		node = typeof s === 'string' ? (isObj(node) ? node[s] : undefined) : Array.isArray(node) ? node.find((x) => isItem(x) && x.id === s.id) : undefined
	}
	return node
}

function applyAt(parent, op, last) {
	if ('o' in op) {
		const arr = typeof last === 'string' ? (isObj(parent) ? parent[last] : undefined) : walk(parent, [last])
		if (!Array.isArray(arr)) return false
		const rank = new Map(op.o.map((id, i) => [id, i]))
		const known = arr.filter((x) => rank.has(x.id)).sort((x, y) => rank.get(x.id) - rank.get(y.id))
		const rest = arr.filter((x) => !rank.has(x.id)) // added by the other side: kept, after the ordered ones
		arr.splice(0, arr.length, ...known, ...rest)
		return true
	}
	if (typeof last === 'string') {
		if (!isObj(parent)) return false
		if (op.d) delete parent[last]
		else parent[last] = structuredClone(op.v)
		return true
	}
	if (!Array.isArray(parent)) return false
	const i = parent.findIndex((x) => isItem(x) && x.id === last.id)
	if (op.d) {
		if (i >= 0) parent.splice(i, 1)
	} else if (i >= 0) parent[i] = structuredClone(op.v)
	else parent.push(structuredClone(op.v))
	return true
}

/**
 * 3-way merge: base = the show both edits started from, ours = the master's show now, theirs = the proposal.
 * Their changes that touch nothing ours changed are applied; where both changed the same path (or one changed what
 * the other deleted) ours stays and the path is reported → { merged, conflicts: [path text] }.
 */
function merge3(base, ours, theirs) {
	const mine = diff(base, ours)
	const conflicts = []
	const take = []
	for (const op of diff(base, theirs)) {
		const hit = mine.filter((m) => overlap(m.p, op.p) && ('o' in m) === ('o' in op))
		if (!hit.length) take.push(op)
		else if (!hit.every((m) => m.p.length === op.p.length && same(m, op))) conflicts.push(pathText(op.p))
	}
	return { merged: apply(ours, take).doc, conflicts }
}

/** Put a shared show back into this box's project: its own device-local slices, stream credentials and stamps stay. */
function intoProject(local, show) {
	const out = structuredClone(show)
	if (!isObj(local)) return out
	const own = stripDeviceLocalFromProject({ hardwareConfig: local.hardwareConfig })
	const hc = isObj(local.hardwareConfig) ? local.hardwareConfig : null
	if (hc) {
		out.hardwareConfig = { ...(isObj(out.hardwareConfig) ? out.hardwareConfig : {}) }
		for (const k of Object.keys(hc)) if (!(k in (own.hardwareConfig || {}))) out.hardwareConfig[k] = hc[k]
	}
	for (const k of Object.keys(local)) if ((VOLATILE.has(k) || k.startsWith('_')) && local[k] !== undefined) out[k] = local[k]
	return out
}

module.exports = { showOf, hashShow, diff, apply, merge3, intoProject, pathText, keyed }
