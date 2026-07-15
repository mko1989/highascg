/**
 * WO-243 T243.2 — Operator GUI channel runtime orchestrator.
 *
 * Owns the AMCP side of the operator_gui destination:
 *  - `ensureOperatorGuiCefLayer()` — (re-)PLAYs the CEF web-UI layer (100) on Caspar connect/startup,
 *    mirroring the CG orphan sweep's re-ADD-after-restart pattern (template-cg-orphan-sweep.js).
 *  - `applyOperatorGuiLayout()` / `clearOperatorGuiLayout()` — route layers 10-49, one `route://`
 *    per compose preview cell + a `MIXER FILL` positioned by viewport-fraction rect. Line-building
 *    mirrors src/engine/multiview-apply.js's conventions: PLAY only when the route changed, MIXER
 *    FILL every apply, STOP+MIXER CLEAR hygiene for layers beyond the current cell count, one
 *    MIXER COMMIT at the end, and per-channel serialization via a promise chain.
 *
 * Route layers are visual only (out of scope: PRV interactivity through the GUI holes — WO-243's
 * own scope note).
 */
'use strict'

const { getChannelMap } = require('../config/routing')
const { destinationsFromConfig } = require('../config/screen-destinations')

const ROUTE_LAYER_START = 10
const ROUTE_LAYER_MAX = 49
const CEF_LAYER = 100
const DEFAULT_GUI_URL = 'http://127.0.0.1:4200/?cefOperator=1'
const APPLY_DEBOUNCE_MS = 150

/**
 * @param {object} config
 * @returns {ReturnType<import('../config/screen-destinations').normalizeDestination>|null}
 */
function operatorGuiDestination(config) {
	const dests = destinationsFromConfig(config)
	return dests.find((d) => d && d.mode === 'operator_gui') || null
}

/**
 * @param {object} config
 * @returns {{ ch: number, dest: object, guiUrl: string }|null}
 */
function resolveOperatorGuiChannel(config) {
	const dest = operatorGuiDestination(config)
	if (!dest) return null
	const map = getChannelMap(config)
	const ch = map.operatorGuiCh
	if (ch == null) return null
	return { ch, dest, guiUrl: String(dest.guiUrl || DEFAULT_GUI_URL) }
}

function clampFraction(v) {
	const n = parseFloat(String(v))
	if (!Number.isFinite(n)) return 0
	return Math.min(1, Math.max(0, n))
}

/**
 * Resolve the route:// source channel for one compose preview cell.
 * @param {{ role?: string, mainIndex?: number }} cell
 * @param {ReturnType<typeof getChannelMap>} map
 * @returns {number|null}
 */
function resolveCellSourceChannel(cell, map) {
	const role = cell?.role === 'prv' ? 'prv' : 'pgm'
	const idx = Math.max(0, parseInt(String(cell?.mainIndex ?? 0), 10) || 0)
	if (role === 'pgm') return Array.isArray(map.programChannels) ? (map.programChannels[idx] ?? null) : null
	return Array.isArray(map.previewChannels) ? (map.previewChannels[idx] ?? null) : null
}

/**
 * Pure function: cells -> per-layer route/rect plan. No I/O — fully unit-testable. Cells whose
 * channel resolves to null are skipped (per T243.2: "skip cells whose channel is null").
 * @param {Array<{id?: string, role?: string, mainIndex?: number, rect?: {x:number,y:number,w:number,h:number}}>} cells
 * @param {ReturnType<typeof getChannelMap>} map
 * @returns {Array<{layer: number, route: string, srcCh: number, x: number, y: number, w: number, h: number}>}
 */
function computeOperatorGuiCellPlan(cells, map) {
	const out = []
	let layer = ROUTE_LAYER_START
	for (const cell of Array.isArray(cells) ? cells : []) {
		if (layer > ROUTE_LAYER_MAX) break
		const srcCh = resolveCellSourceChannel(cell, map)
		if (srcCh == null) continue
		const rect = cell?.rect || {}
		out.push({
			layer,
			route: `route://${srcCh}`,
			srcCh,
			x: clampFraction(rect.x),
			y: clampFraction(rect.y),
			w: clampFraction(rect.w),
			h: clampFraction(rect.h),
		})
		layer++
	}
	return out
}

/** Per-channel last-applied route by layer, so unchanged PLAYs are skipped. Module state (mirrors
 * multiview-apply.js's per-channel serialization convention). */
const lastAppliedRouteByChannel = new Map()
/** Per-channel highest layer previously used, for STOP+MIXER CLEAR hygiene of stale layers. */
const lastMaxLayerByChannel = new Map()
/** Per-channel promise chain — serializes applies the same way multiview-apply.js's mvApplyChains does. */
const applyChains = new Map()
/** Per-channel debounce timer handle (150ms server-side coalescing, per T243.2). */
const debounceTimers = new Map()

/**
 * Actually run one apply against `ctx.amcp` — no debounce, assumes already serialized by the caller.
 * @param {{ amcp: object, config: object, log?: Function }} ctx
 * @param {number} ch
 * @param {Array} cells
 */
async function _doApplyOperatorGuiLayout(ctx, ch, cells) {
	const map = getChannelMap(ctx.config)
	const plan = computeOperatorGuiCellPlan(cells, map)
	const priorRoutes = lastAppliedRouteByChannel.get(ch) || new Map()
	const nextRoutes = new Map()
	for (const entry of plan) {
		if (priorRoutes.get(entry.layer) !== entry.route) {
			try {
				await ctx.amcp.play(ch, entry.layer, entry.route)
			} catch (e) {
				ctx.log?.('warn', `operator-gui: PLAY ${ch}-${entry.layer} ${entry.route} failed: ${e?.message || e}`)
			}
		}
		try {
			await ctx.amcp.mixerFill(ch, entry.layer, entry.x, entry.y, entry.w, entry.h)
		} catch (e) {
			ctx.log?.('warn', `operator-gui: MIXER ${ch}-${entry.layer} FILL failed: ${e?.message || e}`)
		}
		nextRoutes.set(entry.layer, entry.route)
	}
	const newMax = plan.length ? plan[plan.length - 1].layer : ROUTE_LAYER_START - 1
	const prevMax = lastMaxLayerByChannel.has(ch) ? lastMaxLayerByChannel.get(ch) : newMax
	for (let layer = newMax + 1; layer <= Math.min(prevMax, ROUTE_LAYER_MAX); layer++) {
		try {
			await ctx.amcp.stop(ch, layer)
		} catch (_) {
			/* layer may already be empty */
		}
		try {
			await ctx.amcp.mixerClear(ch, layer)
		} catch (_) {
			/* best-effort hygiene */
		}
	}
	try {
		await ctx.amcp.mixerCommit(ch)
	} catch (_) {
		/* best-effort commit */
	}
	lastAppliedRouteByChannel.set(ch, nextRoutes)
	lastMaxLayerByChannel.set(ch, newMax)
	return { ch, plan }
}

/**
 * Debounced (150ms) + serialized (per-channel promise chain) layout apply — POST
 * /api/operator-gui/layout handler. No-op (resolved with `{skipped:true}`) when there is no
 * operator_gui destination.
 * @param {{ amcp: object, config: object, log?: Function }} ctx
 * @param {Array} cells
 * @returns {Promise<object>}
 */
function applyOperatorGuiLayout(ctx, cells) {
	const resolved = resolveOperatorGuiChannel(ctx.config)
	if (!resolved) return Promise.resolve({ skipped: true, reason: 'no operator_gui destination' })
	const ch = resolved.ch
	return new Promise((resolve, reject) => {
		const existing = debounceTimers.get(ch)
		if (existing) clearTimeout(existing)
		const timer = setTimeout(() => {
			debounceTimers.delete(ch)
			const chain = applyChains.get(ch) || Promise.resolve()
			const next = chain.then(() => _doApplyOperatorGuiLayout(ctx, ch, cells))
			next.then(resolve, reject)
			applyChains.set(ch, next.catch(() => {}))
		}, APPLY_DEBOUNCE_MS)
		debounceTimers.set(ch, timer)
	})
}

/**
 * DELETE /api/operator-gui/layout — clears route layers only; the CEF layer (100) is untouched.
 * Not debounced (an explicit clear should apply immediately), but still serialized per-channel.
 * @param {{ amcp: object, config: object, log?: Function }} ctx
 * @returns {Promise<object>}
 */
function clearOperatorGuiLayout(ctx) {
	const resolved = resolveOperatorGuiChannel(ctx.config)
	if (!resolved) return Promise.resolve({ skipped: true, reason: 'no operator_gui destination' })
	const ch = resolved.ch
	const existing = debounceTimers.get(ch)
	if (existing) {
		clearTimeout(existing)
		debounceTimers.delete(ch)
	}
	const chain = applyChains.get(ch) || Promise.resolve()
	const next = chain.then(() => _doApplyOperatorGuiLayout(ctx, ch, []))
	applyChains.set(ch, next.catch(() => {}))
	return next
}

/**
 * On Caspar connect/startup: (re-)PLAY the CEF web-UI layer if an operator_gui destination exists —
 * mirrors the CG orphan sweep's re-ADD-after-restart pattern (src/engine/template-cg-orphan-sweep.js).
 * Convention: `PLAY <ch>-100 [HTML] "<guiUrl>"` — amcp-basic.js's `play()` auto-quotes `[HTML] `-
 * prefixed clips via `param()` (src/caspar/amcp-command-plan.js), so the raw URL is passed here.
 * @param {{ amcp: object, config: object, log?: Function }} ctx
 * @returns {Promise<object>}
 */
async function ensureOperatorGuiCefLayer(ctx) {
	const resolved = resolveOperatorGuiChannel(ctx.config)
	if (!resolved) return { skipped: true }
	const { ch, guiUrl } = resolved
	try {
		await ctx.amcp.play(ch, CEF_LAYER, `[HTML] ${guiUrl}`)
		await ctx.amcp.mixerFill(ch, CEF_LAYER, 0, 0, 1, 1)
		await ctx.amcp.mixerCommit(ch)
	} catch (e) {
		ctx.log?.('warn', `operator-gui: failed to (re-)play CEF layer: ${e?.message || e}`)
	}
	return { ch, guiUrl }
}

/** Test-only: reset module-level apply/debounce state between smoke test cases. */
function resetOperatorGuiStateForTests() {
	lastAppliedRouteByChannel.clear()
	lastMaxLayerByChannel.clear()
	applyChains.clear()
	for (const t of debounceTimers.values()) clearTimeout(t)
	debounceTimers.clear()
}

module.exports = {
	DEFAULT_GUI_URL,
	ROUTE_LAYER_START,
	ROUTE_LAYER_MAX,
	CEF_LAYER,
	APPLY_DEBOUNCE_MS,
	operatorGuiDestination,
	resolveOperatorGuiChannel,
	resolveCellSourceChannel,
	computeOperatorGuiCellPlan,
	applyOperatorGuiLayout,
	clearOperatorGuiLayout,
	ensureOperatorGuiCefLayer,
	resetOperatorGuiStateForTests,
}
