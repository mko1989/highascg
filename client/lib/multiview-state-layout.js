/**
 * Multiview layout defaults + normalization — pure helpers split out of multiview-state.js.
 * @see main_plan.md Prompt 15, HOW_TO_ACHIVE_MULTIVIEWER.MD
 */

import { decklinkInputForSlot, migrateLegacyInputRoute } from './input-channels.js'
import { screenLabel } from './screen-label.js'

export const DEFAULT_WIDTH = 1920
export const DEFAULT_HEIGHT = 1080

/** Old PRV cells used route://N-11; decklink cells may reference legacy shared inputsCh. */
export function migratePreviewRouteSources(cells, channelMap) {
	if (!Array.isArray(cells)) return cells
	return cells.map((c) => {
		const val =
			typeof c.source === 'object' && c.source != null && c.source.value != null ? c.source.value : c.source
		if (typeof val !== 'string' || !val.startsWith('route://')) return c
		const migrated = migrateLegacyInputRoute(channelMap, val)
		const m = val.replace(/^route:\/\//, '').match(/^(\d+)-11$/)
		let nextVal = migrated !== val ? migrated : val
		if (m && migrated === val) {
			nextVal = `route://${m[1]}`
		}
		if (nextVal === val) return c
		if (typeof c.source === 'object' && c.source != null) {
			return { ...c, source: { ...c.source, value: nextVal } }
		}
		return { ...c, source: { value: nextVal, type: 'route', label: c.label || `Preview` } }
	})
}

/**
 * @param {object} channelMap - From stateStore (programChannels, previewChannels, inputsCh, decklinkCount)
 * @param {number} cw - Canvas width
 * @param {number} ch - Canvas height
 * @returns {Array<{ id: string, type: string, label: string, x: number, y: number, w: number, h: number }>}
 */
export function defaultLayout(channelMap, cw = DEFAULT_WIDTH, ch = DEFAULT_HEIGHT) {
	const cells = []
	const programChannels = channelMap?.programChannels || []
	const previewChannels = channelMap?.previewChannels || []
	const screenCount = Math.max(1, channelMap?.screenCount ?? 1)
	const decklinkCount = channelMap?.decklinkCount ?? 0

	const activeScreens = Math.min(screenCount, Math.max(programChannels.length, previewChannels.length))
	// Layout: each screen occupies a horizontal band — PGM on left half, PRV on right half
	const cellW = cw / 2
	const cellH = activeScreens > 0 ? Math.floor(ch / activeScreens) : ch

	for (let s = 0; s < activeScreens; s++) {
		const y = s * cellH
		const h = s === activeScreens - 1 ? ch - y : cellH  // last row fills to bottom
		// id convention: first screen uses legacy 'pgm'/'prv', rest use 'pgm_1','prv_1' etc.
		const pgmId = s === 0 ? 'pgm' : `pgm_${s}`
		const prvId = s === 0 ? 'prv' : `prv_${s}`
		const label = screenLabel(channelMap, s)
		const pgmLabel = activeScreens > 1 ? `PGM ${label}` : 'PGM'
		const prvLabel = activeScreens > 1 ? `PRV ${label}` : 'PRV'
		if (programChannels[s] != null) {
			cells.push({ id: pgmId, type: 'pgm', label: pgmLabel, screenIdx: s, x: 0, y, w: cellW, h })
		}
		if (previewChannels[s] != null) {
			cells.push({ id: prvId, type: 'prv', label: prvLabel, screenIdx: s, x: cellW, y, w: cellW, h })
		}
	}

	if (decklinkCount > 0) {
		const usedH = activeScreens * cellH
		const bottomH = ch - usedH
		if (bottomH >= 40) {
			const dlW = cw / Math.min(decklinkCount, 4)
			for (let i = 0; i < decklinkCount; i++) {
				const entry = decklinkInputForSlot(channelMap, i + 1)
				cells.push({
					id: `decklink_${i}`,
					type: 'decklink',
					label: entry?.label || `DL ${i + 1}`,
					x: (i % 4) * dlW,
					y: usedH,
					w: dlW,
					h: bottomH / Math.ceil(decklinkCount / 4),
					source: entry?.route ? { value: entry.route, type: 'route', label: entry.label } : null,
				})
			}
		}
	}
	return cells
}

/**
 * Normalize editor cells (pixel space) to the 0–1 layout shape `/api/multiview/apply` expects.
 * @param {object[]} cells
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 */
export function cellsToApiLayout(cells, canvasWidth, canvasHeight) {
	const cw = canvasWidth || 1
	const ch = canvasHeight || 1
	const fixFloat = (v) => Math.round(v * 1000000) / 1000000
	return (cells || []).map((c) => ({
		id: c.id,
		type: c.type,
		label: c.source ? (c.source.label || c.source.value) : c.label,
		x: fixFloat(c.x / cw),
		y: fixFloat(c.y / ch),
		w: fixFloat(c.w / cw),
		h: fixFloat(c.h / ch),
		source: c.source?.value || null,
		aspectLocked: c.aspectLocked !== false,
	}))
}
