'use strict'

/**
 * WO-1029 — reconcile a saved Live (operator-GUI compose) layout against the CURRENT screen list.
 *
 * Cells are keyed by screen index (`mainIndex`, id `pgm_<n>` / `prv_<n>`), and a destination deleted / added /
 * reordered shifts those indices — box B (10.11): two destinations deleted, the wall moved from index 2 to 1, the
 * saved cells still said pgm_1 … pgm_4 and the Live tab drew windows for screens that no longer exist. This is the
 * ONE place that turns a saved cell list into one that matches the screens of today:
 *  - a cell carrying `destId` is re-resolved by destination first (index second); one without keeps its index;
 *  - a cell of an index beyond the screen count (or of a deleted destination) is dropped;
 *  - a PRV cell of a screen that is here and has no preview channel (PGM-only) is dropped;
 *  - a cell of a screen on another server stays (the client draws "on <box>") and gets no route (the plan skips a
 *    hole's null channel);
 *  - with `addMissing`, a screen that is here and has no PGM / PRV window at all gets one (+PRV when it has a preview
 *    channel), placed by the rule Auto uses (compose_auto_layout.gd, over the whole canvas).
 * Windows that are not PGM / PRV (live sources, multiview cells, the media cell) pass through untouched.
 * Pure: no I/O beyond reading `config`.
 */

const { getChannelMap } = require('../config/routing')
const { destinationsFromConfig } = require('../config/screen-destinations')
const { resolveOperatorGuiChannelDims } = require('./operator-gui-channel-geometry')

const GAP = 0.03
const isCompose = (c) => c && (c.role === 'pgm' || c.role === 'prv')
const idxOf = (c) => Math.max(0, parseInt(String(c.mainIndex ?? 0), 10) || 0)

/**
 * @param {object} config
 * @returns {{ count: number, holey: boolean, hasIds: boolean, rows: Array<{ idx: number, destId: string|null, here: boolean, hasPrv: boolean, aspect: number }> }}
 */
function screenTable(config) {
	const map = getChannelMap(config)
	const progs = Array.isArray(map.programChannels) ? map.programChannels : []
	const count = Math.max(0, Math.min(Number(map.screenCount) || 0, progs.length || Number(map.screenCount) || 0))
	const holey = map.channelsWhereCabled === true
	const hosts = Array.isArray(map.screenHosts) ? map.screenHosts : []
	const dests = destinationsFromConfig(config).filter((d) => d && !['operator_gui', 'multiview', 'stream'].includes(String(d.mode || '')))
	const rows = []
	for (let idx = 0; idx < count; idx++) {
		const h = hosts[idx]
		const fromDest = dests.find((d) => Math.max(0, parseInt(String(d.mainScreenIndex ?? 0), 10) || 0) === idx)
		const destId = (h && h.destId) || (fromDest && fromDest.id) || null
		const here = holey ? Number(progs[idx]) >= 1 : true
		const prvCh = Number(map.previewChannels?.[idx])
		const enabled = !(Array.isArray(map.previewEnabledByMain) && map.previewEnabledByMain[idx] === false)
		const hasPrv = here ? prvCh >= 1 && prvCh !== Number(progs[idx]) : enabled
		const res = Array.isArray(map.programResolutions) ? map.programResolutions[idx] : null
		const aspect = res && res.w > 0 && res.h > 0 ? res.w / res.h : 16 / 9
		rows.push({ idx, destId: destId ? String(destId) : null, here, hasPrv, aspect })
	}
	return { count, holey, hasIds: rows.some((r) => r.destId), rows }
}

/** compose_auto_layout.gd `tile` over the whole canvas: {cell id: rect fractions} for pgm_N / prv_N. */
function autoTile(rows, config) {
	const dims = resolveOperatorGuiChannelDims(config) || { width: 1920, height: 1080 }
	const W = dims.width
	const H = dims.height
	const out = {}
	if (!rows.length) return out
	const label = H * 0.03
	const nRows = rows.some((r) => r.hasPrv) ? 2 : 1
	const gap = H * GAP
	const colW = (W - gap * (rows.length + 1)) / rows.length
	const rowH = (H - gap * (nRows + 1)) / nRows
	const picH = Math.max(1, rowH - label)
	rows.forEach((r, ci) => {
		const w = Math.min(colW, picH * r.aspect)
		const h = w / r.aspect
		const x = gap + ci * (colW + gap) + (colW - w) / 2
		for (let k = 0; k < nRows; k++) {
			if (k === 1 && !r.hasPrv) continue
			const y = gap + k * (rowH + gap) + (picH - h) / 2
			out[`${k === 0 ? 'pgm' : 'prv'}_${r.idx + 1}`] = { x: x / W, y: y / H, w: w / W, h: h / H }
		}
	})
	return out
}

/**
 * @param {Array} cells - the saved / reported cells
 * @param {object} config
 * @param {{ addMissing?: boolean }} [opts]
 * @returns {Array} the same array when nothing changed, else a new one
 */
function reconcileLayoutCells(cells, config, opts = {}) {
	if (!Array.isArray(cells) || !cells.length) return cells
	const t = screenTable(config)
	if (!t.count) return cells
	const byId = new Map(t.rows.filter((r) => r.destId).map((r) => [r.destId, r]))
	let changed = false
	const out = []
	const seen = new Set()
	for (const c of cells) {
		if (!isCompose(c)) {
			out.push(c)
			continue
		}
		let row = null
		if (c.destId && t.hasIds) row = byId.get(String(c.destId)) || null
		else if (idxOf(c) < t.count) row = t.rows[idxOf(c)]
		if (!row || (c.role === 'prv' && row.here && !row.hasPrv)) {
			changed = true
			continue
		}
		// A cell that keeps its index keeps its id (several windows of one screen are legal); a re-keyed one takes the
		// id of its new index and is dropped when that is already taken.
		const moved = row.idx !== idxOf(c)
		const id = moved ? `${c.role}_${row.idx + 1}` : c.id
		if (moved && seen.has(id)) {
			changed = true
			continue
		}
		seen.add(id)
		const next = { ...c, mainIndex: row.idx }
		if (id !== undefined) next.id = id
		if (row.destId) next.destId = row.destId
		if (next.id !== c.id || next.mainIndex !== c.mainIndex || next.destId !== c.destId) changed = true
		out.push(next)
	}
	if (opts.addMissing && out.some(isCompose)) {
		const have = new Set(out.filter(isCompose).map((c) => idxOf(c)))
		const need = t.rows.filter((r) => r.here && !have.has(r.idx))
		if (need.length) {
			const rects = autoTile(t.rows, config)
			for (const r of need) {
				for (const role of r.hasPrv ? ['pgm', 'prv'] : ['pgm']) {
					const id = `${role}_${r.idx + 1}`
					if (!rects[id]) continue
					out.push({ id, role, mainIndex: r.idx, rect: rects[id], surface: 'compose', ...(r.destId ? { destId: r.destId } : {}) })
				}
			}
			changed = true
		}
	}
	return changed ? out : cells
}

module.exports = { reconcileLayoutCells }
