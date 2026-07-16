'use strict'

/**
 * browser-source-region.js — WO-258 T258.0/T258.1: resolve a dead-zone rectangle on the LIVE `:0`
 * X root desktop where a browser_display source's Firefox window can live off-screen (invisible to
 * every configured monitor) while still being `x11grab`-able, per the T258.0 design investigation.
 *
 * T258.0 recommendation (see work-orders/258 for full evidence): "off-screen region of :0", not a
 * second Xvfb display — this box has no x11vnc/xpra, so a window on a second X server could never be
 * made interactive on the operator's real monitor (X11 has no cross-server window migration
 * primitive) without a new dependency the LIVE-box constraints forbid installing. A dead zone
 * within the CURRENT `:0` canvas costs zero new dependencies and reuses `displaySessionEnv()`
 * (hardcoded `DISPLAY: ':0'`, see src/utils/x-display-session-runtime.js) verbatim.
 *
 * Dead-zone heuristic: for each connected, unequal-height monitor placed side by side (this box's
 * real layout: DP-0 3072x1728@0,0 + DP-5 1920x1080@3072,0 -> a 1920x648 dead zone already exists at
 * 3072,1080 inside the current 4992x1728 canvas, live-probed 2026-07-16 read-only via the existing
 * `getDisplaysXrandrDetailed()`/`currentXrandrCanvasSize()` introspection — NO `xrandr --fb` call
 * was made against :0), this resolves the space below the SHORTER of two side-by-side monitors, down
 * to the canvas height. It intentionally does NOT attempt to grow the canvas (`xrandr --fb`) when no
 * dead zone fits the request: T258.0's probe on Xvfb :77 confirmed `xrandr --fb` is hard-capped by
 * the X server's configured virtual-screen maximum ("screen cannot be larger than WxH") — exceeding
 * it needs a full X server (nodm) restart, which `src/utils/xrandr-layout-verify.js`
 * (`needsNodmRestartForLayout`) already treats as a live-disruptive, non-hot-reloadable operation.
 * Growing the canvas is therefore explicitly OUT of scope for v1: callers get `null` and must refuse
 * the source (or ask the operator to shrink `width`/`height`) rather than silently resizing the live
 * desktop under an on-air show.
 */

/**
 * @param {string} raw - e.g. "1920x1080"
 * @returns {{ w: number, h: number } | null}
 */
function parseResolutionString(raw) {
	const m = String(raw || '').match(/^(\d+)x(\d+)$/i)
	if (!m) return null
	const w = parseInt(m[1], 10)
	const h = parseInt(m[2], 10)
	if (!(w > 0) || !(h > 0)) return null
	return { w, h }
}

/**
 * Pure: find the largest "below a monitor, within canvas height" dead-zone rectangle that fits
 * `width`x`height`, given a canvas size and a list of connected monitor rects. Scope: handles the
 * common side-by-side-unequal-height layout (this box's real layout); a monitor arrangement with no
 * such gap (e.g. all heads the same height, or a canvas with no slack) correctly returns `null` —
 * that is not a bug, it means there is genuinely no free space without growing the canvas.
 * @param {{ width: number, height: number }} canvas
 * @param {Array<{ x: number, y: number, w: number, h: number }>} monitors
 * @param {number} width - requested browser window width
 * @param {number} height - requested browser window height
 * @returns {{ x: number, y: number, w: number, h: number } | null}
 */
function computeDeadZoneRegion(canvas, monitors, width, height) {
	const cw = Number(canvas?.width) || 0
	const ch = Number(canvas?.height) || 0
	const w = Math.max(1, parseInt(String(width), 10) || 0)
	const h = Math.max(1, parseInt(String(height), 10) || 0)
	if (!(cw > 0) || !(ch > 0) || !(w > 0) || !(h > 0)) return null
	const mons = Array.isArray(monitors) ? monitors.filter((m) => m && m.w > 0 && m.h > 0) : []
	if (!mons.length) return null

	/** @type {Array<{ x: number, y: number, w: number, h: number }>} */
	const candidates = []
	for (const m of mons) {
		const belowH = ch - (m.y + m.h)
		if (belowH > 0) {
			candidates.push({ x: m.x, y: m.y + m.h, w: m.w, h: belowH })
		}
	}
	// Also consider space to the right of the union of monitors (a second axis of slack).
	const rightMostEdge = mons.reduce((max, m) => Math.max(max, m.x + m.w), 0)
	const rightW = cw - rightMostEdge
	if (rightW > 0) {
		candidates.push({ x: rightMostEdge, y: 0, w: rightW, h: ch })
	}

	const fitting = candidates.filter((c) => c.w >= w && c.h >= h)
	if (!fitting.length) return null
	fitting.sort((a, b) => b.w * b.h - a.w * a.h)
	const best = fitting[0]
	return { x: best.x, y: best.y, w, h }
}

/**
 * Live (I/O) resolution: reads the current `:0` canvas + connected monitors via the existing
 * read-only introspection helpers (no probe process spawned, no xrandr mutation).
 * @param {number} width
 * @param {number} height
 * @returns {{ x: number, y: number, w: number, h: number } | null}
 */
function resolveBrowserOffscreenRegion(width, height) {
	const { getDisplaysXrandrDetailed } = require('../utils/hardware-info')
	const { currentXrandrCanvasSize } = require('../utils/xrandr-layout-verify')
	const xr = getDisplaysXrandrDetailed()
	const canvas = currentXrandrCanvasSize(xr)
	if (!canvas) return null
	const monitors = []
	for (const d of Array.isArray(xr?.displays) ? xr.displays : []) {
		if (!d?.connected) continue
		const res = parseResolutionString(d.resolution)
		if (!res) continue
		monitors.push({ x: Number(d.x) || 0, y: Number(d.y) || 0, w: res.w, h: res.h })
	}
	return computeDeadZoneRegion({ width: canvas.width, height: canvas.height }, monitors, width, height)
}

module.exports = {
	parseResolutionString,
	computeDeadZoneRegion,
	resolveBrowserOffscreenRegion,
}
