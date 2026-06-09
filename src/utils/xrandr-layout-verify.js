'use strict'

const { getDisplaysXrandrDetailed } = require('./hardware-info')
const { resolveSysIdToXrandrOutput } = require('./xrandr-output-resolve')

/**
 * @typedef {{ sysId: string, x: number, y: number, width: number, height: number, mode?: string, rate?: number|null }} PlannedHead
 * @typedef {{ name: string, x: number, y: number, resolution: string, refreshHz: number|null }} ActualHead
 */

/**
 * Flatten calculateLayoutPositions() output into deduped planned heads (xrandr names resolved).
 * @param {ReturnType<import('./os-layout-calculator').calculateLayoutPositions>} layout
 * @param {{ inventory?: object[] }} [opts]
 * @returns {PlannedHead[]}
 */
function plannedHeadsFromLayout(layout, opts = {}) {
	const list = [
		...(Array.isArray(layout?.mappingGpuOutputs) ? layout.mappingGpuOutputs : []),
		...Object.values(layout?.screens || {}),
		...Object.values(layout?.multiview || {}),
	]
	const seen = new Set()
	/** @type {PlannedHead[]} */
	const out = []
	for (const h of list) {
		const rawId = String(h?.sysId || '').trim()
		if (!rawId) continue
		const sysId = resolveSysIdToXrandrOutput(rawId, opts)
		if (!sysId || seen.has(sysId)) continue
		seen.add(sysId)
		out.push({
			sysId,
			x: Number(h.x) || 0,
			y: Number(h.y) || 0,
			width: Number(h.width) || 0,
			height: Number(h.height) || 0,
			mode: String(h.mode || '').trim() || undefined,
			rate: h.rate != null && Number.isFinite(Number(h.rate)) ? Number(h.rate) : null,
		})
	}
	return out
}

/**
 * @param {PlannedHead[]} planned
 * @param {ActualHead[]} actual
 * @param {{ posTolerance?: number, rateTolerance?: number }} [opts]
 */
function compareXrandrLayout(planned, actual, opts = {}) {
	const posTol = Number.isFinite(opts.posTolerance) ? opts.posTolerance : 0
	const rateTol = Number.isFinite(opts.rateTolerance) ? opts.rateTolerance : 0.25
	const actualByName = new Map((actual || []).map((a) => [String(a.name), a]))
	/** @type {Array<{ sysId: string, field: string, expected: string|number, actual: string|number|null }>} */
	const mismatches = []

	for (const p of planned || []) {
		const a = actualByName.get(p.sysId)
		if (!a) {
			mismatches.push({ sysId: p.sysId, field: 'connected', expected: 'connected', actual: null })
			continue
		}
		if (Math.abs((a.x || 0) - p.x) > posTol) {
			mismatches.push({ sysId: p.sysId, field: 'x', expected: p.x, actual: a.x })
		}
		if (Math.abs((a.y || 0) - p.y) > posTol) {
			mismatches.push({ sysId: p.sysId, field: 'y', expected: p.y, actual: a.y })
		}
		const expRes = p.mode && /^\d+x\d+$/i.test(p.mode) ? p.mode : `${p.width}x${p.height}`
		const actRes = String(a.resolution || '').trim()
		if (expRes && actRes && expRes.toLowerCase() !== actRes.toLowerCase()) {
			mismatches.push({ sysId: p.sysId, field: 'resolution', expected: expRes, actual: actRes })
		}
		if (p.rate != null && a.refreshHz != null && Math.abs(a.refreshHz - p.rate) > rateTol) {
			mismatches.push({ sysId: p.sysId, field: 'rate', expected: p.rate, actual: a.refreshHz })
		}
	}

	// Detect overlap among connected heads (same origin).
	const connected = (actual || []).filter((a) => a && a.name)
	const byPos = new Map()
	for (const a of connected) {
		const key = `${a.x},${a.y}`
		if (!byPos.has(key)) byPos.set(key, [])
		byPos.get(key).push(a.name)
	}
	for (const [key, names] of byPos.entries()) {
		if (names.length > 1) {
			mismatches.push({
				sysId: names.join('+'),
				field: 'overlap',
				expected: 'unique positions',
				actual: key,
			})
		}
	}

	return { ok: mismatches.length === 0, mismatches, planned, actual: connected }
}

/**
 * Read live xrandr state and compare to a layout plan.
 * @param {ReturnType<import('./os-layout-calculator').calculateLayoutPositions>} layout
 * @param {{ inventory?: object[] }} [opts]
 */
function verifyXrandrMatchesLayout(layout, opts = {}) {
	const planned = plannedHeadsFromLayout(layout, opts)
	const xr = getDisplaysXrandrDetailed()
	const actual = (xr?.displays || []).map((d) => ({
		name: d.name,
		x: d.x,
		y: d.y,
		resolution: d.resolution,
		refreshHz: d.refreshHz,
	}))
	return compareXrandrLayout(planned, actual, opts)
}

module.exports = {
	plannedHeadsFromLayout,
	compareXrandrLayout,
	verifyXrandrMatchesLayout,
}
