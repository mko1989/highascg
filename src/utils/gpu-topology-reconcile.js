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

	return merged.map((row, idx) => {
		if (bracketHasLiveRandr(connected, row.dpA, row.dpB)) return { ...row, slotOrder: idx }
		const def = discoveredById.get(row.physicalPortId)
		if (def && bracketHasLiveRandr(connected, def.dpA, def.dpB)) {
			return {
				...row,
				dpA: def.dpA,
				dpB: def.dpB,
				slotOrder: idx,
				connectorNumber: idx,
				location: idx,
			}
		}
		return { ...row, slotOrder: idx }
	})
}

/**
 * @param {object[]} saved
 * @param {object[]} discovered
 */
function topologyDiffers(saved, discovered) {
	return !topologyRowsEqual(normalizeTopologyRows(saved), normalizeTopologyRows(discovered))
}

module.exports = {
	normalizeTopologyRows,
	connectedLiveRandrNames,
	reconcileTopologyWithLiveDisplays,
	topologyDiffers,
	topologyRowsEqual,
}
