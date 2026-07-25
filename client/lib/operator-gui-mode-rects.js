/**
 * WO-255 T255.3 — pure rect-conversion math for the operator-GUI rect-reporting pipeline. Split out
 * of operator-gui-mode.js: DOM rects (viewport px) -> normalized 0-1 viewport-fraction rects for the
 * `/api/operator-gui/layout` POST body. No I/O — unit-testable without jsdom.
 */

function clamp01(n) {
	const v = Number(n)
	if (!Number.isFinite(v)) return 0
	return Math.min(1, Math.max(0, v))
}

/**
 * @param {Array<{id?: string, role?: string, mainIndex?: number, rect: {left: number, top: number, width: number, height: number}}>} cellRects
 * @param {{width: number, height: number}} viewport
 * @returns {Array<{id: string|undefined, role: string, mainIndex: number, rect: {x: number, y: number, w: number, h: number}}>}
 */
export function cellRectsToLayoutCells(cellRects, viewport) {
	const vw = Math.max(1, Number(viewport?.width) || 1)
	const vh = Math.max(1, Number(viewport?.height) || 1)
	const out = []
	for (const c of Array.isArray(cellRects) ? cellRects : []) {
		const r = c?.rect
		if (!r || !(Number(r.width) > 0) || !(Number(r.height) > 0)) continue
		const cell = {
			id: c.id,
			role:
				c.role === 'prv' ? 'prv' : c.role === 'multiview' ? 'multiview' : c.role === 'mvcell' ? 'mvcell' : 'pgm',
			mainIndex: Math.max(0, parseInt(String(c.mainIndex ?? 0), 10) || 0),
			rect: {
				x: clamp01(Number(r.left) / vw),
				y: clamp01(Number(r.top) / vh),
				w: clamp01(Number(r.width) / vw),
				h: clamp01(Number(r.height) / vh),
			},
		}
		// 'mvcell' (WO-263 follow-up, mv-editor blend): explicit source channel — the mv layout
		// editor's cells route arbitrary channels, not mainIndex-addressable PGM/PRV pairs.
		if (cell.role === 'mvcell') {
			const srcCh = Number(c.srcCh)
			if (!Number.isFinite(srcCh) || srcCh <= 0) continue
			cell.srcCh = Math.floor(srcCh)
		}
		out.push(cell)
	}
	return out
}

export function defaultViewport(viewport) {
	return (
		viewport || {
			width: typeof window !== 'undefined' ? window.innerWidth : 1920,
			height: typeof window !== 'undefined' ? window.innerHeight : 1080,
		}
	)
}
