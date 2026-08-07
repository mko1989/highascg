'use strict'

const { normalizePortName, topologyRowsEqual } = require('./gpu-topology-xrandr')

/**
 * Normalize topology rows for compare / API output.
 * @param {unknown[]} rows
 * @returns {object[]}
 */
function normalizeTopologyRows(rows) {
	const out = []
	for (const row of Array.isArray(rows) ? rows : []) {
		if (!row || typeof row !== 'object') continue
		const physicalPortId = String(row.physicalPortId || '').trim()
		if (!physicalPortId) continue
		out.push({
			physicalPortId,
			slotOrder: Number.isFinite(Number(row.slotOrder)) ? Number(row.slotOrder) : out.length,
			dpA: normalizePortName(row.dpA),
			dpB: normalizePortName(row.dpB),
			connectorNumber: Number.isFinite(Number(row.connectorNumber)) ? Number(row.connectorNumber) : out.length,
			location: Number.isFinite(Number(row.location)) ? Number(row.location) : out.length,
		})
	}
	return out.sort((a, b) => a.slotOrder - b.slotOrder)
}

function normRandr(name) {
	return normalizePortName(name)
}

/**
 * @param {object[]} displays
 * @returns {Set<string>}
 */
function connectedLiveRandrNames(displays) {
	const out = new Set()
	for (const d of displays || []) {
		if (!d || d.connected === false) continue
		const n = normRandr(d.name || d.xrandrName)
		if (n) out.add(n)
	}
	return out
}

function bracketHasLiveRandr(connected, dpA, dpB) {
	const a = normRandr(dpA)
	const b = normRandr(dpB)
	return (a && connected.has(a)) || (b && connected.has(b))
}

/** Canonical key for a dual-lane physical jack (DP-2/DP-3, HDMI-0/HDMI-1, …). */
function topologyPairKey(dpA, dpB) {
	const a = normRandr(dpA)
	const b = normRandr(dpB)
	if (!a && !b) return ''
	if (!b) return a
	if (!a) return b
	return [a, b].sort().join('/')
}

/**
 * Align stale saved pair → gpu_pN rows with live RandR (server-side).
 * @param {object[]} topology saved / config rows
 * @param {object[]} displays live.gpu.displays
 * @param {object[] | null} [discoveredRows] xrandr discovery fallback per socket
 */
function reconcileTopologyWithLiveDisplays(topology, displays, discoveredRows = null) {
	const connected = connectedLiveRandrNames(displays)
	const merged = normalizeTopologyRows(topology)
	if (!connected.size) return merged

	const discoveredById = new Map(
		normalizeTopologyRows(discoveredRows || []).map((r) => [r.physicalPortId, r]),
	)

	const result = merged.map((row, idx) => ({ ...row, slotOrder: idx }))
	const claimedPairs = new Set()

	// Saved brackets that already match live RandR win the pair (prevents duplicate jacks).
	for (const row of result) {
		if (!bracketHasLiveRandr(connected, row.dpA, row.dpB)) continue
		const pk = topologyPairKey(row.dpA, row.dpB)
		if (pk) claimedPairs.add(pk)
	}

	return result.map((row, idx) => {
		if (bracketHasLiveRandr(connected, row.dpA, row.dpB)) {
			return { ...row, slotOrder: idx }
		}
		const def = discoveredById.get(row.physicalPortId)
		if (def && bracketHasLiveRandr(connected, def.dpA, def.dpB)) {
			const pk = topologyPairKey(def.dpA, def.dpB)
			if (pk && claimedPairs.has(pk)) {
				return { ...row, slotOrder: idx }
			}
			if (pk) claimedPairs.add(pk)
			return {
				...row,
				dpA: def.dpA,
				dpB: def.dpB,
				slotOrder: idx,
				connectorNumber: Number.isFinite(Number(row.connectorNumber)) ? row.connectorNumber : idx,
				location: Number.isFinite(Number(row.location)) ? row.location : idx,
			}
		}
		return { ...row, slotOrder: idx }
	})
}

/**
 * Order-insensitive WIRING compare: only the set of physical jacks (dpA/dpB pair keys)
 * matters. The operator deliberately reordering sockets to match their card is NOT a wiring
 * change — the old row-by-row compare (incl. slotOrder) kept the "Detected GPU wiring
 * differs" banner up forever after any manual layout edit (todos06.08). The banner should
 * fire only when discovery sees different jacks than the saved layout references.
 * @param {object[]} saved
 * @param {object[]} discovered
 */
function topologyPairSetDiffers(saved, discovered) {
	const pairKeys = (rows) =>
		normalizeTopologyRows(rows)
			.map((r) => topologyPairKey(r.dpA, r.dpB))
			.filter(Boolean)
			.sort()
	return JSON.stringify(pairKeys(saved)) !== JSON.stringify(pairKeys(discovered))
}

module.exports = {
	normalizeTopologyRows,
	connectedLiveRandrNames,
	reconcileTopologyWithLiveDisplays,
	topologyPairSetDiffers,
	topologyRowsEqual,
}
