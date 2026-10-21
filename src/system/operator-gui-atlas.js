'use strict'

/**
 * WO-597 §D — atlas mode for the operator-GUI channel.
 *
 * A native (shm) client crops each preview tile out of the operator surface itself, so the tile's
 * on-screen POSITION no longer has to match its place on the channel. In atlas mode the server packs
 * one slot per cell (shelf packing, aspect-correct, sized to the tile's on-screen pixels) and rewrites
 * the cells' rects to those slots before the normal route/MIXER FILL apply. With hysteresis on the
 * slot sizes a move or a small resize yields the SAME plan, and the caller skips AMCP entirely.
 *
 * Mode: only for an operator_gui destination with `videoOutput: 'shm'`; the client opts in with
 * `atlas: true` on POST /api/operator-gui/layout. Reports without the key (WO-624 server-side cell
 * edits, boot re-apply) keep the remembered mode, which is persisted under `operatorGuiAtlas`.
 */

const { getChannelMap } = require('../config/routing')
const { operatorGuiDestination, resolveOperatorGuiChannelDims, computeOperatorGuiCellPlan } = require('./operator-gui-channel-geometry')

const GUTTER_PX = 4
const MIN_SLOT_PX = 16
/** Re-allocate only when a tile's needed size leaves [prev / GROW, prev * GROW] (25 % hysteresis). */
const GROW = 1.25
const PERSIST_KEY = 'operatorGuiAtlas'

/** Per-channel: { mode, ids, needed: Map id→{w,h}, slots: Map id→{x,y,w,h} px, planKey, descriptor } */
const state = new Map()

function persistenceOf(ctx) {
	return ctx.persistence || require('../utils/persistence')
}

function cellKey(cell, i) {
	return cell?.id != null && String(cell.id) !== '' ? String(cell.id) : `#${i}`
}

/** Whether channel `ch` runs in atlas mode; `want` (true/false) from a client report updates it. */
function atlasModeFor(ctx, ch, want) {
	if (String(operatorGuiDestination(ctx.config)?.videoOutput || '') !== 'shm') return false
	const st = state.get(ch) || {}
	if (typeof want === 'boolean') {
		if (st.mode !== want) {
			state.set(ch, { ...st, mode: want, slots: null, planKey: null })
			try {
				persistenceOf(ctx).set(PERSIST_KEY, want)
			} catch {
				/* persistence optional (tests/headless) */
			}
		}
		return want
	}
	if (typeof st.mode === 'boolean') return st.mode
	let saved = false
	try {
		saved = persistenceOf(ctx).get(PERSIST_KEY) === true
	} catch {
		/* no persistence — mosaic */
	}
	state.set(ch, { ...st, mode: saved })
	return saved
}

/**
 * Shelf-pack `items` ({key, w, h} px) into W×H, tallest first; scales every size by 0.9 until it fits.
 * @returns {{ slots: Map<string, {x:number,y:number,w:number,h:number}>, scale: number }}
 */
function packShelves(items, W, H) {
	const order = [...items].sort((a, b) => b.h - a.h || a.key.localeCompare(b.key))
	let scale = 1
	for (let tries = 0; tries < 60; tries++, scale *= 0.9) {
		const slots = new Map()
		let x = 0
		let y = 0
		let shelf = 0
		let ok = true
		for (const it of order) {
			const w = Math.max(MIN_SLOT_PX, Math.min(W, Math.round(it.w * scale)))
			const h = Math.max(MIN_SLOT_PX, Math.min(H, Math.round(it.h * scale)))
			if (x > 0 && x + w > W) {
				x = 0
				y += shelf + GUTTER_PX
				shelf = 0
			}
			if (y + h > H) {
				ok = false
				break
			}
			slots.set(it.key, { x, y, w, h })
			x += w + GUTTER_PX
			shelf = Math.max(shelf, h)
		}
		if (ok) return { slots, scale }
	}
	return { slots: new Map(), scale: 0 }
}

function withinHysteresis(prev, next) {
	if (!prev) return false
	const r = (a, b) => (b > 0 ? a / b : Infinity)
	const rw = r(next.w, prev.w)
	const rh = r(next.h, prev.h)
	return rw <= GROW && rw >= 1 / GROW && rh <= GROW && rh >= 1 / GROW
}

/**
 * Rewrite `cells` for atlas mode, or null when the channel is not in atlas mode.
 * @returns {{ cells: Array, descriptor: object, reallocated: boolean }|null}
 */
function atlasLayout(ctx, ch, cells, want) {
	if (!atlasModeFor(ctx, ch, want)) return null
	const dims = resolveOperatorGuiChannelDims(ctx.config)
	if (!dims) return null
	const map = getChannelMap(ctx.config)
	const list = Array.isArray(cells) ? cells : []
	const items = []
	list.forEach((cell, i) => {
		const entry = computeOperatorGuiCellPlan([cell], map, ctx.config)[0]
		if (!entry || !(entry.w > 0) || !(entry.h > 0)) return
		items.push({ key: cellKey(cell, i), w: entry.w * dims.width, h: entry.h * dims.height })
	})
	const st = state.get(ch) || {}
	const ids = items.map((it) => it.key).sort().join('|')
	const keep =
		st.slots && st.ids === ids && st.dims === `${dims.width}x${dims.height}` && items.every((it) => withinHysteresis(st.needed.get(it.key), it))
	let slots = st.slots
	let needed = st.needed
	if (!keep) {
		slots = packShelves(items, dims.width, dims.height).slots
		needed = new Map(items.map((it) => [it.key, { w: it.w, h: it.h }]))
	}
	const out = []
	const frac = {}
	list.forEach((cell, i) => {
		const key = cellKey(cell, i)
		const s = slots.get(key)
		if (!s) return // unpackable or unplannable — no slot, no layer
		const rect = { x: s.x / dims.width, y: s.y / dims.height, w: s.w / dims.width, h: s.h / dims.height }
		const next = { ...cell, rect }
		out.push(next)
		const fitted = computeOperatorGuiCellPlan([next], map, ctx.config)[0]
		if (fitted) frac[key] = { x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h }
	})
	const descriptor = { channel: ch, w: dims.width, h: dims.height, slots: frac }
	state.set(ch, { ...st, ids, dims: `${dims.width}x${dims.height}`, slots, needed, descriptor })
	return { cells: out, descriptor, reallocated: !keep }
}

function planKeyOf(plan) {
	return JSON.stringify((plan || []).map((e) => [e.layer, e.route, e.x, e.y, e.w, e.h]))
}

/** True when `plan` equals the last plan applied on `ch` in atlas mode — the caller then sends no AMCP. */
function atlasPlanUnchanged(ch, plan) {
	const st = state.get(ch)
	return !!st && st.planKey === planKeyOf(plan)
}

function noteAtlasApplied(ch, plan) {
	const st = state.get(ch)
	if (st) st.planKey = planKeyOf(plan)
}

/** Caspar (re)connect: the stage may be empty, so the next apply must not be skipped. */
function forgetAtlasApplied(ch) {
	const st = state.get(ch)
	if (st) st.planKey = null
}

/** The current slot descriptor for `ch`, or null when the channel is not in atlas mode. */
function getAtlasDescriptor(ctx, ch) {
	if (ch == null || !atlasModeFor(ctx, ch)) return null
	return state.get(ch)?.descriptor || null
}

function resetAtlasStateForTests() {
	state.clear()
}

module.exports = {
	GUTTER_PX,
	packShelves,
	atlasLayout,
	atlasPlanUnchanged,
	noteAtlasApplied,
	forgetAtlasApplied,
	getAtlasDescriptor,
	resetAtlasStateForTests,
}
