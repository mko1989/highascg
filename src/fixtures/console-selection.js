'use strict'

/**
 * WO-857 — what the lighting console has selected, as one transport-neutral feed. Adapters hand it head numbers
 * (grandMA3: gma3-selection-listener.js; MagicQ: a CITP peer later); it maps them to patch fixture ids through the MVR
 * FixtureIDs (console-fid-map.js) and broadcasts the result on the WS:
 *
 *   fixtures:console_selection  { source, heads: [FixtureID], ids: [patch id], unmatched: [FixtureID], ts }
 *
 * It is a SECOND selection: the Godot previs draws it in its own colour and never writes the operator's own selection
 * (fixture_selection.gd, WO-774 / WO-841) from it. Equal sets are not re-broadcast. A project change re-resolves the
 * last head list (a re-patch or a newly imported MVR gives ids to heads that had none).
 *
 *   const sel = getService(ctx)
 *   sel.set({ source: 'gma3', heads: [101, 102] }) → { ok, changed, selection } | { ok:false, error }
 *   sel.snapshot() → { source, heads, ids, unmatched, ts }
 */

const { createFidResolver, toFid } = require('./console-fid-map')

const EVENT = 'fixtures:console_selection'
const MAX_HEADS = 4096
const SOURCE_RE = /^[a-z0-9][a-z0-9_.-]{0,31}$/

/** Clean head list → unique positive integers in order, or { error }. */
function cleanHeads(list) {
	if (!Array.isArray(list)) return { error: 'heads must be a list of head numbers' }
	if (list.length > MAX_HEADS) return { error: `at most ${MAX_HEADS} heads` }
	const out = []
	const seen = new Set()
	for (const v of list) {
		const n = toFid(v)
		if (!n) return { error: `head ${JSON.stringify(v)} is not a positive whole number` }
		if (!seen.has(n)) {
			seen.add(n)
			out.push(n)
		}
	}
	return { heads: out }
}

/** @param {{ broadcast?: (type: string, data: object) => void, resolver?: object, now?: () => number, log?: Function, onProject?: Function }} [deps] */
function createConsoleSelection(deps = {}) {
	const broadcast = deps.broadcast || (() => {})
	const resolver = deps.resolver || createFidResolver()
	const now = deps.now || (() => Date.now())
	const log = deps.log || (() => {})
	let cur = { source: '', heads: [], ids: [], unmatched: [], ts: 0 }
	let off = null

	const snap = () => ({ source: cur.source, heads: cur.heads.slice(), ids: cur.ids.slice(), unmatched: cur.unmatched.slice(), ts: cur.ts })
	const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

	function resolve(heads) {
		try {
			return resolver.heads(heads)
		} catch (e) {
			log('warn', '[console-selection] resolving heads: ' + (e?.message || e))
			return { ids: [], unmatched: heads.slice() }
		}
	}

	const api = {
		snapshot: snap,

		set(src) {
			const o = src && typeof src === 'object' ? src : {}
			const source = typeof o.source === 'string' ? o.source.trim().toLowerCase() : ''
			if (!SOURCE_RE.test(source)) return { ok: false, error: 'source must be a short lower-case name (gma3, magicq, test…)' }
			const h = cleanHeads(o.heads)
			if (h.error) return { ok: false, error: h.error }
			const r = resolve(h.heads)
			if (cur.source === source && same(cur.heads, h.heads) && same(cur.ids, r.ids) && same(cur.unmatched, r.unmatched)) {
				return { ok: true, changed: false, selection: snap() }
			}
			cur = { source, heads: h.heads, ids: r.ids, unmatched: r.unmatched, ts: now() }
			broadcast(EVENT, snap())
			return { ok: true, changed: true, selection: snap() }
		},

		/** Nothing selected (an adapter went away); same as an empty set from `source`. */
		clear(source = cur.source || 'test') {
			return api.set({ source, heads: [] })
		},

		/** Head numbers for patch ids — the return path (a console selects what the operator picked here). */
		fidsOf: (ids) => resolver.fids(ids),

		/** Start following project changes (re-resolve the current heads). */
		start() {
			if (off || !deps.onProject) return api
			off = deps.onProject(() => {
				if (!cur.source) return
				const r = resolve(cur.heads)
				if (same(cur.ids, r.ids) && same(cur.unmatched, r.unmatched)) return
				cur = { ...cur, ids: r.ids, unmatched: r.unmatched, ts: now() }
				broadcast(EVENT, snap())
			})
			return api
		},

		stop() {
			if (off) off()
			off = null
		},
	}
	return api
}

/** The app's one feed (created on first use, kept on `ctx.consoleSelection`; module-level without a ctx). */
let _shared = null
function getService(ctx) {
	if (ctx?.consoleSelection) return ctx.consoleSelection
	if (!ctx && _shared) return _shared
	const svc = createConsoleSelection({
		broadcast: (type, data) => typeof ctx?._wsBroadcast === 'function' && ctx._wsBroadcast(type, data),
		log: (lvl, m) => ctx?.log?.(lvl, m),
		onProject: (fn) => require('../engine/project-events').onProjectChanged(fn),
	})
	if (ctx) ctx.consoleSelection = svc
	else _shared = svc
	return svc
}

module.exports = { createConsoleSelection, getService, EVENT, MAX_HEADS }
