/**
 * WO-243/255 — Operator GUI channel runtime orchestrator.
 *
 * Owns the AMCP side of the operator_gui destination:
 *  - `ensureOperatorGuiChannel()` — no-op-at-boot placeholder (route layers need nothing at boot
 *    unlike the retired CEF layer) that re-feeds the shape helper and nudges the client to
 *    re-report its cell rects on Caspar connect/reconnect — mirrors the CG orphan sweep's
 *    re-ADD-after-restart pattern (template-cg-orphan-sweep.js) in spirit, just with nothing to
 *    re-PLAY.
 *  - `applyOperatorGuiLayout()` / `clearOperatorGuiLayout()` — route layers 10-49, one `route://`
 *    per compose/timeline/mv-edit preview cell + a `MIXER FILL` positioned by an aspect-fit rect
 *    (WO-254). Line-building mirrors src/engine/multiview-apply.js's conventions: PLAY only when
 *    the route changed, MIXER FILL every apply, STOP+MIXER CLEAR hygiene for layers beyond the
 *    current cell count, one MIXER COMMIT at the end, and per-channel serialization via a promise
 *    chain. Each apply also feeds the python-xlib shape helper (operator-shape-overlay.js) so the
 *    Caspar screen consumer window is shaped to exactly these rects, above Firefox.
 *
 * WO-255: the CEF web-UI layer (100) and its auto-arm input focus are RETIRED — the operator GUI
 * is now a fullscreen Firefox process (src/system/operator-gui-launcher.js), not a Caspar layer.
 * Route layers remain visual only (out of scope: PRV interactivity through the shaped holes).
 */
'use strict'

const { getChannelMap } = require('../config/routing')
const { destinationsFromConfig } = require('../config/screen-destinations')
const { getModeDimensions } = require('../config/config-modes')
const { screenModeString } = require('../config/config-generator-mode-helpers')
const { operatorGuiModeDimensions } = require('../config/config-generator-channel-plan')
const { resolveOperatorGuiPort } = require('../config/config-generator-operator-gui')
const { resolveLayoutRectForOperatorPort } = require('../utils/x-display-session-layout')

const ROUTE_LAYER_START = 10
const ROUTE_LAYER_MAX = 49
const DEFAULT_GUI_URL = 'http://127.0.0.1:4200/?operatorGui=1'
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
 * Resolve the route:// source channel for one preview cell (compose PGM/PRV, or WO-255's
 * 'multiview' role for the mv-edit dock surface — routes the whole multiview channel into the
 * reported rect rather than indexing by mainIndex).
 * @param {{ role?: string, mainIndex?: number }} cell
 * @param {ReturnType<typeof getChannelMap>} map
 * @returns {number|null}
 */
function resolveCellSourceChannel(cell, map) {
	if (cell?.role === 'multiview') return map.multiviewCh ?? null
	// 'mvcell' (2026-07-17, mv-editor blend): the multiview layout editor's per-cell holes carry
	// an explicit source channel (route:// cells can point at any channel, not a mainIndex).
	if (cell?.role === 'mvcell') {
		const srcCh = Number(cell.srcCh)
		if (!Number.isFinite(srcCh) || srcCh <= 0) return null
		const ch = Math.floor(srcCh)
		// WO-156: never route a multiview output into an mv-editor hole — the client filters
		// this too, but the map is authoritative here and a stale client reporting
		// srcCh == multiview channel would wedge the multiview exactly as WO-156 documented.
		const mvChs = Array.isArray(map.multiviewChannels) && map.multiviewChannels.length
			? map.multiviewChannels
			: (map.multiviewCh != null ? [map.multiviewCh] : [])
		if (mvChs.includes(ch)) return null
		return ch
	}
	const role = cell?.role === 'prv' ? 'prv' : 'pgm'
	const idx = Math.max(0, parseInt(String(cell?.mainIndex ?? 0), 10) || 0)
	if (role === 'pgm') return Array.isArray(map.programChannels) ? (map.programChannels[idx] ?? null) : null
	return Array.isArray(map.previewChannels) ? (map.previewChannels[idx] ?? null) : null
}

/**
 * WO-255 T255.1: resolve the operator monitor's ROOT/absolute-pixel rect for the shape helper —
 * same port-resolution chain the generator uses (`resolveOperatorGuiPort`, incl. the gpu-map
 * fallback inside `resolveLayoutRectForOperatorPort`), so the shape helper's monitor rect always
 * matches where the generator actually placed the screen consumer window.
 * @param {object} config
 * @param {object} [layout] - pre-computed `calculateLayoutPositions()` result; recomputed if omitted
 * @returns {{x: number, y: number, w: number, h: number}|null}
 */
function resolveOperatorGuiMonitorRect(config, layout) {
	const dest = operatorGuiDestination(config)
	if (!dest) return null
	const port = resolveOperatorGuiPort(config, dest)
	if (port == null) return null
	try {
		const rect = resolveLayoutRectForOperatorPort(config, layout || null, port)
		if (rect && rect.width > 0 && rect.height > 0) return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
	} catch (_) {
		/* hardware detection unavailable (headless/tests) — treat as unresolved */
	}
	return null
}

/**
 * WO-255 T255.1: pure conversion — a 0-1 viewport-fraction rect (of the GUI channel's raster) to
 * monitor-relative INTEGER pixels, for the shape helper's stdin protocol. Deliberately scales by
 * the MONITOR rect's own width/height, not the GUI channel raster's dims: the shape helper matches
 * its target window by monitor-rect geometry (operator-shape-overlay.py), so monitor-relative is
 * the coordinate space its rects must already be in — the channel raster and the monitor rect can
 * differ in size (e.g. a custom operator_gui video-mode vs. the physical monitor's native res).
 * @param {{x: number, y: number, w: number, h: number}} fracRect
 * @param {{w: number, h: number}} monitorRect
 * @returns {[number, number, number, number]}
 */
function fractionRectToMonitorPx(fracRect, monitorRect) {
	return [
		Math.round((Number(fracRect?.x) || 0) * monitorRect.w),
		Math.round((Number(fracRect?.y) || 0) * monitorRect.h),
		Math.round((Number(fracRect?.w) || 0) * monitorRect.w),
		Math.round((Number(fracRect?.h) || 0) * monitorRect.h),
	]
}

/**
 * WO-254 T254.1 — resolve the GUI channel's own raster dims (the coordinate space cell rects are
 * fractions OF). Returns null when there's no operator_gui destination or its dims don't resolve
 * to a positive size — callers must treat null as "keep today's stretch-fill behavior".
 * @param {object} config
 * @returns {{width: number, height: number}|null}
 */
function resolveOperatorGuiChannelDims(config) {
	const dest = operatorGuiDestination(config)
	if (!dest) return null
	const dims = operatorGuiModeDimensions(dest)
	return dims && dims.width > 0 && dims.height > 0 ? { width: dims.width, height: dims.height } : null
}

/**
 * WO-254 T254.1 — resolve a compose-cell's SOURCE channel raster dims (PGM/PRV share the same
 * physical screen's mode, keyed by mainIndex+1 — mirrors {@link resolveCellSourceChannel}'s
 * indexing and `config-compare.js`'s "Screen N preview" role reuse of `screen_N_mode`). Unlike
 * `hostChannelVideoSize` (cef-interactive-forward.js:72-83, which only resolves PGM/multiview
 * channels via reverse channel-number lookup), this resolves directly by screen index so PRV
 * cells get correct dims too.
 * @param {{ mainIndex?: number }} cell
 * @param {object} config
 * @returns {{width: number, height: number}|null}
 */
function resolveCellSourceDims(cell, config) {
	const idx = Math.max(0, parseInt(String(cell?.mainIndex ?? 0), 10) || 0)
	const dims = getModeDimensions(screenModeString(config, idx + 1), config, idx + 1)
	return dims && dims.width > 0 && dims.height > 0 ? { width: dims.width, height: dims.height } : null
}

/**
 * Pure pixel-space "contain" fit: the largest rect inside `cellPx` that preserves `srcW`/`srcH`'s
 * aspect ratio, centered. Source wider (relative) than the cell -> bars top/bottom (letterbox);
 * source narrower (relative) than the cell -> bars left/right (pillarbox). Degenerate guard:
 * zero/negative cell or source dims pass `cellPx` through unchanged (no NaN/Infinity).
 * @param {{x?: number, y?: number, w: number, h: number}} cellPx
 * @param {number} srcW
 * @param {number} srcH
 * @returns {{x: number, y: number, w: number, h: number}}
 */
function fitAspectRectPx(cellPx, srcW, srcH) {
	const cx = Number(cellPx?.x) || 0
	const cy = Number(cellPx?.y) || 0
	const cw = Number(cellPx?.w) || 0
	const ch = Number(cellPx?.h) || 0
	const sw = Number(srcW) || 0
	const sh = Number(srcH) || 0
	if (!(cw > 0) || !(ch > 0) || !(sw > 0) || !(sh > 0)) {
		return { x: cx, y: cy, w: cw, h: ch }
	}
	const cellAR = cw / ch
	const srcAR = sw / sh
	let w
	let h
	if (srcAR > cellAR) {
		// Source relatively wider than the cell -> width-constrained, bars top/bottom.
		w = cw
		h = w / srcAR
	} else {
		// Source relatively narrower than (or equal to) the cell -> height-constrained, bars left/right.
		h = ch
		w = h * srcAR
	}
	return { x: cx + (cw - w) / 2, y: cy + (ch - h) / 2, w, h }
}

/**
 * WO-254 T254.1 — cell rects are VIEWPORT-FRACTION rects (0-1) of the GUI channel's raster, not
 * of the source's. Aspect math must therefore convert to absolute pixels of the GUI raster
 * first (fraction × guiDims), fit in pixel space, then normalize back to fractions — doing the
 * fit directly in fraction space would silently conflate the GUI raster's own aspect with the
 * source's whenever the GUI raster isn't square. Pure function, no I/O.
 * @param {{x: number, y: number, w: number, h: number}} cellFrac - clamped 0-1 viewport-fraction cell rect
 * @param {{width: number, height: number}} guiDims - GUI channel raster dims
 * @param {{width: number, height: number}} srcDims - source channel raster dims
 * @returns {{x: number, y: number, w: number, h: number}} fitted 0-1 fraction rect
 */
function computeAspectFitCellRect(cellFrac, guiDims, srcDims) {
	const guiW = Number(guiDims?.width) || 0
	const guiH = Number(guiDims?.height) || 0
	if (!(guiW > 0) || !(guiH > 0)) return cellFrac
	const cellPx = {
		x: (Number(cellFrac?.x) || 0) * guiW,
		y: (Number(cellFrac?.y) || 0) * guiH,
		w: (Number(cellFrac?.w) || 0) * guiW,
		h: (Number(cellFrac?.h) || 0) * guiH,
	}
	const fittedPx = fitAspectRectPx(cellPx, srcDims?.width, srcDims?.height)
	return {
		x: clampFraction(fittedPx.x / guiW),
		y: clampFraction(fittedPx.y / guiH),
		w: clampFraction(fittedPx.w / guiW),
		h: clampFraction(fittedPx.h / guiH),
	}
}

/**
 * Pure function: cells -> per-layer route/rect plan. No I/O — fully unit-testable. Cells whose
 * channel resolves to null are skipped (per T243.2: "skip cells whose channel is null").
 *
 * WO-254 T254.1: when `config` is supplied and both the GUI channel's and the cell's source
 * channel's raster dims resolve, the emitted rect is the largest aspect-preserving fit INSIDE
 * the reported cell rect (letterbox/pillarbox, centered) instead of the raw cell rect — CasparCG
 * `MIXER FILL` stretches to whatever rect it's given, so without this a 16:9 source stretches to
 * fill non-16:9 holes. `config` is optional and defaults to today's stretch-fill behavior (kept
 * for the existing WO-243 call sites/tests that don't pass it).
 * @param {Array<{id?: string, role?: string, mainIndex?: number, rect?: {x:number,y:number,w:number,h:number}}>} cells
 * @param {ReturnType<typeof getChannelMap>} map
 * @param {object} [config] - app config; enables aspect-fit when its operator_gui dims resolve
 * @returns {Array<{layer: number, route: string, srcCh: number, x: number, y: number, w: number, h: number}>}
 */
function computeOperatorGuiCellPlan(cells, map, config) {
	const guiDims = config ? resolveOperatorGuiChannelDims(config) : null
	const out = []
	let layer = ROUTE_LAYER_START
	for (const cell of Array.isArray(cells) ? cells : []) {
		if (layer > ROUTE_LAYER_MAX) break
		const srcCh = resolveCellSourceChannel(cell, map)
		if (srcCh == null) continue
		const rect = cell?.rect || {}
		let fitted = {
			x: clampFraction(rect.x),
			y: clampFraction(rect.y),
			w: clampFraction(rect.w),
			h: clampFraction(rect.h),
		}
		// 'mvcell' skips aspect-fit: the mv editor's cell box IS the target shape (the real
		// multiview output MIXER-FILL-stretches its cells the same way), and mainIndex-keyed
		// resolveCellSourceDims would resolve the wrong screen's mode for an arbitrary channel.
		if (guiDims && cell?.role !== 'mvcell') {
			const srcDims = resolveCellSourceDims(cell, config)
			if (srcDims) fitted = computeAspectFitCellRect(fitted, guiDims, srcDims)
		}
		out.push({
			layer,
			route: `route://${srcCh}`,
			srcCh,
			x: fitted.x,
			y: fitted.y,
			w: fitted.w,
			h: fitted.h,
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
 * Boot-window shrink guard (2026-07-19 bug: "after highascg restart the operator gui starts with a
 * stale compose preview layout"). The freshly-booted kiosk client renders its compose tiles BEFORE
 * the WS state arrives and used to report a single provisional tile, clobbering the multi-cell
 * layout `ensureOperatorGuiChannel` had just re-applied from persistence. The client no longer does
 * that (client/components/operator-compose-tiles.js `stateReady`), but this is the cheap belt-and-
 * braces: for {@link BOOT_GUARD_MS} after a re-apply, ONE report that would strictly REDUCE the
 * restored cell count is ignored.
 *
 * Deliberately one-shot per boot and count-based only, so it can never block a real operator
 * change: moving/resizing a tile reports the SAME cell count (never fewer), and a genuine
 * screen-count reduction re-reports on the client's very next render, which sails through.
 * @type {{ ch: number, until: number, cells: number }|null}
 */
let bootShrinkGuard = null
const BOOT_GUARD_MS = 10000

/**
 * 2026-07-20 bug (todos19.07.26): "when caspar is reloaded it comes back trying to display the
 * compose preview even though im on devices tab. only going to looks and back clears the windows."
 *
 * Root cause is HERE, not in the client: {@link ensureOperatorGuiChannel} re-applies the PERSISTED
 * cell layout on every Caspar connect/reconnect, unconditionally. When the operator sits on a tab
 * with no preview surface (Devices) the client has already withdrawn its rects (DELETE
 * /api/operator-gui/layout on unmount) and does NOT answer the reconnect nudge — `resendMergedNow`
 * deliberately returns early while the surface map is empty (client/lib/operator-gui-mode.js:377),
 * because at boot an empty send would wipe the layout the server just restored. So nothing ever
 * contradicts the server and the holes light up over a tab that shows no preview. Only a
 * mount/unmount cycle (Looks and back) issues a fresh withdrawal, which is exactly what the owner
 * observed as the workaround.
 *
 * Fix: remember the last CLIENT-ORIGINATED intent per channel for this server run. A client that
 * has explicitly withdrawn is authoritative — skip the persisted re-apply and leave the holes shut
 * until the operator returns to a tab that reports rects. Deliberately untouched:
 *  - no client report yet this run (fresh boot, kiosk still starting) -> re-apply exactly as before
 *    (the verified "Operator GUI re-apply: 3 cell(s) applied (ch 5)" path);
 *  - last client report non-empty (operator IS on Looks) -> re-apply as before, so a Caspar restart
 *    repaints the holes without waiting on the client's own re-POST.
 * The persistence RECORD is never read-modified here, so a genuine arrangement still survives a
 * restart and is restored the moment the operator returns to Looks.
 * @type {Map<number, {cells: number, at: number}>}
 */
const lastClientIntentByChannel = new Map()

/**
 * Record a CLIENT-originated layout report — a POST with cells, or a DELETE (withdrawal, recorded
 * as 0 cells). Called from the API boundary ONLY (src/api/routes-operator-gui.js): the server's own
 * persisted re-apply goes straight to {@link applyOperatorGuiLayout} and must never look like a
 * client intent, or the first reconnect would license every later one. No-op when there is no
 * operator_gui destination.
 * @param {{ config: object }} ctx
 * @param {Array} cells - empty/absent means "this client is showing no preview surface"
 */
function noteClientLayoutReport(ctx, cells) {
	const resolved = resolveOperatorGuiChannel(ctx?.config)
	if (!resolved) return
	lastClientIntentByChannel.set(resolved.ch, { cells: Array.isArray(cells) ? cells.length : 0, at: Date.now() })
}

/**
 * Pure decision (no I/O): should a connect/reconnect re-apply the persisted layout? See
 * {@link lastClientIntentByChannel} for why a withdrawn client vetoes it.
 *
 * An EMPTY persisted set still "re-applies": applying [] only clears stale route layers, it can
 * never light a hole up, so the veto is irrelevant there and the pre-existing boot-hygiene clear
 * is preserved.
 * @param {number} ch
 * @param {Array} savedCells
 * @returns {{ reapply: boolean, reason: string }}
 */
function shouldReapplyPersistedLayout(ch, savedCells) {
	const n = Array.isArray(savedCells) ? savedCells.length : 0
	if (n === 0) return { reapply: true, reason: 'empty persisted layout (clears stale layers only)' }
	const intent = lastClientIntentByChannel.get(ch)
	if (intent && intent.cells === 0) {
		return { reapply: false, reason: 'client withdrew its rects — no preview surface is on screen' }
	}
	if (intent) return { reapply: true, reason: `client is reporting ${intent.cells} cell(s)` }
	return { reapply: true, reason: 'no client report yet this run' }
}

/**
 * @param {number} ch
 * @param {Array} cells - incoming reported cells
 * @param {Function} [log]
 * @returns {boolean} true when this report should be ignored
 */
function shouldIgnoreBootShrink(ch, cells, log) {
	const g = bootShrinkGuard
	if (!g || g.ch !== ch) return false
	if (Date.now() > g.until) {
		bootShrinkGuard = null
		return false
	}
	const n = Array.isArray(cells) ? cells.length : 0
	if (n === 0 || n >= g.cells) return false
	bootShrinkGuard = null // one-shot: the next report wins whatever it says
	log?.(
		'warn',
		`operator-gui: ignoring boot-window report of ${n} cell(s) that would shrink the restored ${g.cells}-cell layout (one-shot guard)`,
	)
	return true
}

/**
 * Actually run one apply against `ctx.amcp` — no debounce, assumes already serialized by the caller.
 * Also feeds the shape helper (WO-255 T255.1) with the same fitted rects, converted to
 * monitor-relative pixels — best-effort: no resolvable monitor rect (headless/tests/no destination
 * yet) just skips the shape feed, the route-layer apply itself is unaffected.
 * @param {{ amcp: object, config: object, log?: Function }} ctx
 * @param {number} ch
 * @param {Array} cells
 */
async function _doApplyOperatorGuiLayout(ctx, ch, cells, opts = {}) {
	const map = getChannelMap(ctx.config)
	const plan = computeOperatorGuiCellPlan(cells, map, ctx.config)
	try {
		const monitorRect = resolveOperatorGuiMonitorRect(ctx.config)
		if (monitorRect) {
			const { updateShapeRects } = require('./operator-shape-overlay')
			// WO-319: suppressHoles keeps the mosaic (routes + FILL, applied below) but feeds the
			// shape overlay an EMPTY rect set, so no hole is cut — the browser draws the decoded
			// crops itself. Without this, a hole would reveal the screen consumer THROUGH the canvas.
			const shapeRects = opts.suppressHoles ? [] : plan.map((entry) => fractionRectToMonitorPx(entry, monitorRect))
			updateShapeRects(monitorRect, shapeRects, { log: ctx.log, channel: ch })
		}
	} catch (e) {
		ctx.log?.('warn', `operator-gui: shape overlay feed failed: ${e?.message || e}`)
	}
	const priorRoutes = lastAppliedRouteByChannel.get(ch) || new Map()
	const nextRoutes = new Map()
	for (const entry of plan) {
		let routeLive = priorRoutes.get(entry.layer) === entry.route
		if (!routeLive) {
			try {
				await ctx.amcp.play(ch, entry.layer, entry.route)
				routeLive = true
			} catch (e) {
				ctx.log?.('warn', `operator-gui: PLAY ${ch}-${entry.layer} ${entry.route} failed: ${e?.message || e}`)
			}
		}
		try {
			await ctx.amcp.mixerFill(ch, entry.layer, entry.x, entry.y, entry.w, entry.h)
		} catch (e) {
			ctx.log?.('warn', `operator-gui: MIXER ${ch}-${entry.layer} FILL failed: ${e?.message || e}`)
		}
		// Only record routes whose PLAY actually landed — compose-cell routes rarely change,
		// so caching a failed PLAY as applied would make every later apply skip it and leave
		// the hole on the previous run's stale content until a manual route change.
		if (routeLive) nextRoutes.set(entry.layer, entry.route)
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
	// Persist the applied cell set (mirrors routes-multiview.js persisting `multiviewLayout`)
	// so `ensureOperatorGuiChannel` can re-apply the saved layout at boot/reconnect.
	/* Never persist an EMPTY cell set. An empty apply means "no client is currently reporting"
	 * — the kiosk unloading, being killed, or reconnecting — not "the operator wants no tiles".
	 * Persisting it destroyed the saved arrangement on every kiosk close (observed: a restart
	 * later logged "re-apply: 0 cell(s)" and .highascg-state.json held cells: []). The live holes
	 * still clear, because that is driven by the applied routes above, not by this record. */
	try {
		const list = Array.isArray(cells) ? cells : []
		if (list.length > 0) {
			const persistence = ctx.persistence || require('../utils/persistence')
			persistence.set('operatorGuiLayout', { cells: list, savedAt: Date.now() })
		}
	} catch (_) {
		/* persistence optional (tests/headless) */
	}
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
function applyOperatorGuiLayout(ctx, cells, opts = {}) {
	const resolved = resolveOperatorGuiChannel(ctx.config)
	if (!resolved) return Promise.resolve({ skipped: true, reason: 'no operator_gui destination' })
	const ch = resolved.ch
	if (shouldIgnoreBootShrink(ch, cells, ctx.log)) {
		return Promise.resolve({ skipped: true, reason: 'boot-window shrink ignored' })
	}
	return new Promise((resolve, reject) => {
		const existing = debounceTimers.get(ch)
		if (existing) clearTimeout(existing)
		const timer = setTimeout(() => {
			debounceTimers.delete(ch)
			const chain = applyChains.get(ch) || Promise.resolve()
			const next = chain.then(() => _doApplyOperatorGuiLayout(ctx, ch, cells, opts))
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
/**
 * WO-319 — the current operator GUI compose layout (cells with viewport-fraction rects that ARE the
 * ch4 mosaic FILL fractions), for a REMOTE operator view to render read-only. Returns { cells,
 * channel } or { cells: [] } when nothing is persisted / no operator_gui destination.
 * @param {{ config: object, persistence?: object }} ctx
 */
function getPersistedOperatorGuiLayout(ctx) {
	const resolved = resolveOperatorGuiChannel(ctx.config)
	let cells = []
	try {
		const persistence = ctx.persistence || require('../utils/persistence')
		const saved = persistence.get('operatorGuiLayout')
		if (saved && Array.isArray(saved.cells)) cells = saved.cells
	} catch {
		/* no persistence — empty */
	}
	return { cells, channel: resolved ? resolved.ch : null }
}

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
 * WO-255: on Caspar connect/startup, when an operator_gui destination exists — re-feeds the shape
 * helper with its last-known rects (a Caspar restart spawns a brand-new, unshaped screen-consumer
 * window id), re-applies the last persisted cell layout (mirrors multiview re-apply — see below),
 * and nudges the client (over the app's own WS, once it reconnects) to re-POST its last-known
 * compose/timeline/mv-edit cell rects, which overrides the persisted re-apply with live rects.
 *
 * A Caspar/highascg restart clears the server's route layers (10-49) but doesn't change the
 * client's DOM layout, so without the WS nudge nothing re-triggers the client's
 * ResizeObserver-driven report and the holes stay black until a window resize — see
 * client/lib/operator-gui-mode.js's `initOperatorGuiRectReporting` (WO-254 T254.2, kept as-is
 * under the WO-255 rename).
 * @param {{ amcp: object, config: object, log?: Function, _wsBroadcast?: (type: string, data: object) => void }} ctx
 * @returns {Promise<object>}
 */
async function ensureOperatorGuiChannel(ctx) {
	const resolved = resolveOperatorGuiChannel(ctx.config)
	if (!resolved) return { skipped: true }
	const { ch, guiUrl } = resolved
	// WO-255 migration hygiene: the retired CEF web-UI layer (100) may still be PLAYing from a
	// pre-pivot server run — a Caspar restart clears it, but don't rely on one. Harmless when empty.
	try {
		await ctx.amcp.stop(ch, 100)
	} catch (_) {
		/* layer empty / caspar variant without content — nothing to stop */
	}
	try {
		const { reapplyOperatorShapeOverlay } = require('./operator-shape-overlay')
		reapplyOperatorShapeOverlay({ log: ctx.log })
	} catch (e) {
		ctx.log?.('warn', `operator-gui: shape overlay re-feed failed: ${e?.message || e}`)
	}
	// Mirror multiview re-apply (WO-156): re-apply the last persisted cell layout NOW —
	// Caspar survives a highascg restart with the previous run's route layers/rects still
	// live on the GUI channel, and the client's re-POST only lands once the kiosk page is
	// back up. Without this the compose-preview holes show the stale pre-restart layout
	// until the first client report (or first look-take) after the restart.
	try {
		const persistence = ctx.persistence || require('../utils/persistence')
		const saved = persistence.get('operatorGuiLayout')
		if (saved && Array.isArray(saved.cells)) {
			// 2026-07-20: never re-assert holes over a tab that shows no preview — see
			// {@link lastClientIntentByChannel}. The saved record itself is left intact, so
			// returning to Looks restores it via the client's own report.
			const decision = shouldReapplyPersistedLayout(ch, saved.cells)
			if (!decision.reapply) {
				ctx.log?.(
					'info',
					`Operator GUI re-apply skipped (ch ${ch}): ${decision.reason} — ${saved.cells.length} cell(s) stay saved`,
				)
			} else {
				// Arm the one-shot shrink guard for the boot window (see {@link shouldIgnoreBootShrink}).
				bootShrinkGuard = saved.cells.length > 1 ? { ch, until: Date.now() + BOOT_GUARD_MS, cells: saved.cells.length } : null
				// Not awaited: a client POST inside the apply debounce window supersedes this call's
				// promise (its timer is cleared, so it never settles) — and boot must not block on it.
				applyOperatorGuiLayout(ctx, saved.cells).then(
					() => ctx.log?.('info', `Operator GUI re-apply: ${saved.cells.length} cell(s) applied (ch ${ch})`),
					(e) => ctx.log?.('warn', `operator-gui: layout re-apply failed: ${e?.message || e}`),
				)
			}
		}
	} catch (e) {
		ctx.log?.('warn', `operator-gui: layout re-apply failed: ${e?.message || e}`)
	}
	try {
		ctx._wsBroadcast?.('change', { path: 'operatorGuiRectsWanted', value: Date.now() })
	} catch (e) {
		ctx.log?.('warn', `operator-gui: rects-wanted broadcast failed: ${e?.message || e}`)
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
	bootShrinkGuard = null
	lastClientIntentByChannel.clear()
}

module.exports = {
	DEFAULT_GUI_URL,
	ROUTE_LAYER_START,
	ROUTE_LAYER_MAX,
	APPLY_DEBOUNCE_MS,
	BOOT_GUARD_MS,
	operatorGuiDestination,
	resolveOperatorGuiChannel,
	resolveOperatorGuiMonitorRect,
	fractionRectToMonitorPx,
	resolveCellSourceChannel,
	resolveOperatorGuiChannelDims,
	resolveCellSourceDims,
	fitAspectRectPx,
	computeAspectFitCellRect,
	computeOperatorGuiCellPlan,
	applyOperatorGuiLayout,
	clearOperatorGuiLayout,
	getPersistedOperatorGuiLayout,
	ensureOperatorGuiChannel,
	noteClientLayoutReport,
	shouldReapplyPersistedLayout,
	resetOperatorGuiStateForTests,
}
