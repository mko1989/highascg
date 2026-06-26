import { normRandrCaspar } from '../components/device-view-caspar-render-helpers.js'
import {
	isGpuLayoutDebugEnabled,
	traceGpuLayoutAdd,
	traceGpuLayoutBuildStart,
	traceGpuLayoutRawComplete,
	traceGpuLayoutSkip,
} from './device-view-gpu-layout-debug.js'
import { defaultClientGpuTopology } from './device-view-gpu-port-topology.js'
import { setLastGpuLayoutTraceSeq } from './device-view-gpu-port-trace-state.js'
import {
	displaysMatchingPairs,
	gpuSplitConnectorId,
	hasDrmGpuPhysicalMap,
	iconForPortHints,
	isPrimaryTopologySocket,
	labelForPhysicalPort,
	resolveExpectedGpuPhysicalPortCount,
	consolidateBracketSplitEntries,
} from './device-view-gpu-port-utils.js'

function labelForTopologyPairs(pairs) {
	const list = (pairs || []).filter(Boolean).map(String)
	if (!list.length) return ''
	const blob = list.join(' ').toUpperCase()
	if (blob.includes('HDMI')) {
		return `HDMI ${list.map((p) => p.split('-').slice(1).join('-')).join('/')}`
	}
	if (blob.includes('EDP')) return list.join(' · ')
	return `DP ${list.map((p) => p.replace(/^DP-/i, '')).join('/')}`
}

export function entryFromTopologyRow(row, displays, connectors, suggestedGpuOuts, index, graphGpuOuts = []) {
	const id = String(row?.physicalPortId || '').trim()
	const pairs = [row?.dpA, row?.dpB].filter(Boolean).map(String)
	const hits = displaysMatchingPairs(pairs, displays, connectors)
	const connected = hits.length > 0
	const activeHit = hits[0] || null
	const active = activeHit?.name || ''
	const disp =
		activeHit?.ref && 'resolution' in activeHit.ref
			? activeHit.ref
			: (displays || []).find((d) => normRandrCaspar(d?.name) === normRandrCaspar(active)) || null
	const suggested = (suggestedGpuOuts || []).find((c) => String(c?.id || '').trim() === id)
	const inGraph = (graphGpuOuts || []).some((c) => String(c?.id || '').trim() === id)
	const resolution = String(disp?.resolution || '').trim()
	const hasMode = connected && resolution && resolution !== 'unknown'
	let label = labelForTopologyPairs(pairs) || id
	if (connected && active) {
		label = hasMode ? `${label} · ${active}` : `${label} · ${active} (no mode)`
	}
	return {
		connectorId: id,
		layoutSlotId: id,
		label,
		kind: 'gpu_out',
		index,
		connected: hasMode,
		livePresent: connected,
		topologySlot: isPrimaryTopologySocket(id),
		hidden: false,
		pairs,
		monitor: active ? String(active).trim() : '',
		resolution,
		refreshHz: Number.isFinite(Number(disp?.refreshHz)) ? Number(disp.refreshHz) : null,
		icon: iconForPortHints(...pairs),
		isVirtual: !suggested && !inGraph && !connected,
		inDeviceGraph: !!(suggested || inGraph || connected),
	}
}

/** Build rear-panel rows from topology (authoritative pair → gpu_pN map). */
export function buildGpuEntriesFromTopology(topology, live, suggestedGpuOuts = [], graphGpuOuts = []) {
	const displays = Array.isArray(live?.gpu?.displays) ? live.gpu.displays : []
	const connectors = Array.isArray(live?.gpu?.connectors) ? live.gpu.connectors : []
	const sorted = [...(topology || [])].sort(
		(a, b) => (Number(a?.slotOrder) || 0) - (Number(b?.slotOrder) || 0),
	)
	return sorted.map((row, index) =>
		entryFromTopologyRow(row, displays, connectors, suggestedGpuOuts, index, graphGpuOuts),
	)
}

/** modetest lists DP-N and DP-(N+1) on the same physical socket — never show as two cabled jacks. */
function shouldExpandPhysicalPortToConnectors(_p, _live) {
	return false
}

function entryFromPhysicalPortSide(p, probeConn, index, suggestedConnector = null) {
	const parentId = String(p.physicalPortId || '').trim()
	const shortName = String(probeConn.shortName || '').trim()
	const id = gpuSplitConnectorId(parentId, shortName)
	const rt = p?.runtime && typeof p.runtime === 'object' ? p.runtime : {}
	const active = normRandrCaspar(rt.activePort || rt.xrandrName || '')
	const selfNorm = normRandrCaspar(shortName)
	const connected = !!probeConn.connected || (active === selfNorm && !!rt.connected)
	const isActive = active === selfNorm
	let label = shortName
	if (isActive && rt.resolution && rt.resolution !== 'unknown') {
		label = `${shortName} · ${rt.resolution}`
	} else if (isActive && rt.casparMode) {
		label = `${shortName} · ${rt.casparMode}`
	}
	return {
		connectorId: id,
		layoutSlotId: id,
		parentPortId: parentId,
		label,
		kind: 'gpu_out',
		index,
		connected,
		hidden: false,
		pairs: [shortName],
		monitor: isActive ? String(rt.xrandrName || rt.displayName || shortName).trim() : '',
		resolution: isActive ? String(rt.resolution || '').trim() : '',
		refreshHz: isActive && Number.isFinite(Number(rt.refreshHz)) ? Number(rt.refreshHz) : null,
		icon: iconForPortHints(shortName),
		isVirtual: false,
		physicalPort: p,
		suggestedConnectorId: String(suggestedConnector?.id || parentId).trim(),
	}
}

/**
 * One jack per bracket, or one per probe connector when modetest lists separate DPs.
 * @param {object} p
 * @param {object} live
 * @param {object[]} displays
 * @param {number} index
 * @param {object | null} [suggestedConnector]
 */
function entriesFromPhysicalPort(p, live, displays, index, suggestedConnector = null) {
	if (shouldExpandPhysicalPortToConnectors(p, live)) {
		const out = []
		for (const key of ['connectorA', 'connectorB']) {
			const pc = p?.probe?.[key]
			if (pc?.shortName) out.push(entryFromPhysicalPortSide(p, pc, index + out.length, suggestedConnector))
		}
		if (out.length > 0) return out
	}
	if (suggestedConnector) return [entryFromSuggested(suggestedConnector, displays, index, p)]
	return [entryFromPhysicalPort(p, index)]
}

/** One rear jack per physical connector bracket (DP-0/DP-1 share one jack when not expanded). */
function entryFromPhysicalPort(p, index) {
	const id = String(p.physicalPortId || '').trim()
	const rt = p?.runtime && typeof p.runtime === 'object' ? p.runtime : {}
	const pairs = [p?.pair?.dpA, p?.pair?.dpB].filter(Boolean).map(String)
	const connected = !!rt.connected
	return {
		connectorId: id,
		layoutSlotId: id,
		label: labelForPhysicalPort(p),
		kind: 'gpu_out',
		index,
		connected,
		hidden: false,
		pairs,
		monitor: String(rt.xrandrName || rt.displayName || rt.activePort || '').trim(),
		resolution: String(rt.resolution || '').trim(),
		refreshHz: Number.isFinite(Number(rt.refreshHz)) ? Number(rt.refreshHz) : null,
		icon: iconForPortHints(p?.pair?.dpA, p?.pair?.dpB, p?.pair?.name, rt.activePort),
		isVirtual: !connected,
		physicalPort: p,
	}
}

/** RandR output already represented by a port's active runtime (not merely listed in pair.dpA/dpB). */
function entryActivelyBoundToDisplay(entry, name) {
	const n = normRandrCaspar(name)
	if (!n) return false
	if (normRandrCaspar(entry.monitor) === n) return true
	if (Array.isArray(entry.pairs) && entry.pairs.some(p => normRandrCaspar(p) === n)) return true
	const rt = entry.physicalPort?.runtime
	if (!rt) return false
	const active = normRandrCaspar(rt.xrandrName || rt.displayName || rt.activePort || '')
	return active === n
}

function entryFromSuggested(c, displays, index, physicalPort = null) {
	const id = String(c.id || '').trim()
	const ref = String(c.externalRef || c.label || id).trim()
	const disp =
		displays.find((d) => normRandrCaspar(d?.name) === normRandrCaspar(ref)) ||
		displays.find((d) => d?.connected && normRandrCaspar(d.name) === normRandrCaspar(ref))
	if (physicalPort) {
		const merged = entryFromPhysicalPort(physicalPort, index)
		return {
			...merged,
			connectorId: id || merged.connectorId,
			layoutSlotId: id || merged.layoutSlotId,
			label: String(c.label || merged.label || ref || id),
			monitor: disp?.name || merged.monitor || ref,
			connected: merged.connected || !!disp?.connected,
			isVirtual: !(merged.connected || !!disp?.connected),
		}
	}
	const connected = !!disp?.connected
	return {
		connectorId: id,
		layoutSlotId: id,
		label: String(c.label || ref || id),
		kind: 'gpu_out',
		index,
		connected,
		hidden: false,
		pairs: ref ? [ref] : [],
		monitor: disp?.name || ref,
		resolution: String(disp?.resolution || '').trim(),
		refreshHz: Number.isFinite(Number(disp?.refreshHz)) ? Number(disp.refreshHz) : null,
		icon: iconForPortHints(ref, c?.label),
		isVirtual: !connected,
	}
}

function entryFromDisplay(d, suggestedGpuOuts, index) {
	const name = String(d.name || '').trim()
	const match = suggestedGpuOuts.find(
		(c) =>
			c?.kind === 'gpu_out' &&
			normRandrCaspar(c.externalRef || c.label) === normRandrCaspar(name),
	)
	const id = String(match?.id || '').trim() || `gpu_${normRandrCaspar(name).replace(/[^A-Z0-9]+/g, '_')}`
	const connected = !!d.connected
	return {
		connectorId: id,
		layoutSlotId: id,
		label: String(match?.label || name),
		kind: 'gpu_out',
		index,
		connected,
		hidden: false,
		pairs: [name],
		monitor: name,
		resolution: String(d.resolution || '').trim(),
		refreshHz: Number.isFinite(Number(d.refreshHz)) ? Number(d.refreshHz) : null,
		icon: iconForPortHints(name),
		isVirtual: !connected,
	}
}

export function entryFromInferredPhysicalPort(portIndex, suggestedGpuOuts, displays, topology = null) {
	const id = `gpu_p${portIndex}`
	const existing = (suggestedGpuOuts || []).find((c) => String(c?.id || '').trim() === id)
	if (existing) return entryFromSuggested(existing, displays, 0, null)
	const topoRow = (topology || defaultClientGpuTopology()).find(
		(t) => String(t?.physicalPortId || '').trim() === id,
	)
	const pairs = topoRow
		? [topoRow.dpA, topoRow.dpB].filter(Boolean).map(String)
		: [`DP-${portIndex * 2}`, `DP-${portIndex * 2 + 1}`]
	return entryFromTopologyRow(
		{ physicalPortId: id, dpA: pairs[0] || '', dpB: pairs[1] || '', slotOrder: portIndex },
		displays,
		suggestedGpuOuts,
		0,
	)
}

/**
 * @param {object[]} [suggestedGpuOuts]
 * @param {object[]} [graphGpuOuts]
 */
export function collectGpuConnectorIdsInGraph(suggestedGpuOuts = [], graphGpuOuts = []) {
	const ids = new Set()
	for (const c of [...suggestedGpuOuts, ...graphGpuOuts]) {
		if (!c || (c.kind !== 'gpu_out' && c.kind !== 'gpu_output')) continue
		const id = String(c.id || '').trim()
		if (id) ids.add(id)
	}
	return ids
}

/**
 * One rear-panel jack per physical port, suggested connector, or RandR output (connected or not).
 * @param {object} [live]
 * @param {object[]} [suggestedGpuOuts]
 * @param {object[]} [graphGpuOuts] — persisted device graph gpu_out connectors
 * @returns {object[]}
 */
export function buildRawGpuPortEntriesFromLive(live, suggestedGpuOuts = [], graphGpuOuts = []) {
	const physicalPorts = Array.isArray(live?.gpu?.physicalMap?.ports) ? live.gpu.physicalMap.ports : []
	const displays = Array.isArray(live?.gpu?.displays) ? live.gpu.displays : []
	const entries = []
	const seenIds = new Set()
	const seq = traceGpuLayoutBuildStart(live, suggestedGpuOuts, { physicalPorts, displays })
	setLastGpuLayoutTraceSeq(seq)

	const push = (entry, phase) => {
		const id = String(entry?.connectorId || '').trim()
		if (!id) {
			traceGpuLayoutSkip(seq, phase, 'empty connectorId', { entry })
			return
		}
		if (seenIds.has(id)) {
			traceGpuLayoutSkip(seq, phase, 'duplicate connectorId', { id, label: entry?.label })
			return
		}
		seenIds.add(id)
		entry.index = entries.length
		entries.push(entry)
		traceGpuLayoutAdd(seq, phase, entry)
	}

	const physicalById = new Map()
	const sortedPhysical = [...physicalPorts].sort(
		(a, b) => (Number(a?.slotOrder) || 0) - (Number(b?.slotOrder) || 0),
	)
	for (const p of sortedPhysical) {
		const pid = String(p?.physicalPortId || '').trim()
		if (pid) physicalById.set(pid, p)
	}

	// Suggested gpu_out ids (gpu_p0…) are canonical; merge DRM bracket data when ids match.
	for (const c of suggestedGpuOuts) {
		if (!c || c.kind !== 'gpu_out') {
			traceGpuLayoutSkip(seq, 'suggested', 'not gpu_out', { kind: c?.kind, id: c?.id })
			continue
		}
		const id = String(c.id || '').trim()
		if (!id) {
			traceGpuLayoutSkip(seq, 'suggested', 'empty id', { c })
			continue
		}
		if (seenIds.has(id)) {
			traceGpuLayoutSkip(seq, 'suggested', 'duplicate id', { id, label: c?.label })
			continue
		}
		const ref = String(c.externalRef || c.label || '').trim()
		if (ref && entries.some((e) => entryActivelyBoundToDisplay(e, ref))) {
			traceGpuLayoutSkip(seq, 'suggested', 'actively bound (ref)', {
				id,
				ref,
				coveredBy: entries
					.filter((e) => entryActivelyBoundToDisplay(e, ref))
					.map((e) => e.connectorId),
			})
			continue
		}
		const physical = physicalById.get(id) || null
		if (physical) physicalById.delete(id)
		for (const entry of physical
			? entriesFromPhysicalPort(physical, live, displays, entries.length, c)
			: [entryFromSuggested(c, displays, entries.length, null)]) {
			push(
				entry,
				physical ? (shouldExpandPhysicalPortToConnectors(physical, live) ? 'physical-split' : 'suggested+physical') : 'suggested',
			)
		}
		if (physical && shouldExpandPhysicalPortToConnectors(physical, live)) {
			seenIds.add(id)
		}
	}

	for (const p of physicalById.values()) {
		for (const entry of entriesFromPhysicalPort(p, live, displays, entries.length)) {
			push(entry, shouldExpandPhysicalPortToConnectors(p, live) ? 'physical-split' : 'physical')
		}
	}

	if (!physicalPorts.length && !suggestedGpuOuts.length && isGpuLayoutDebugEnabled()) {
		traceGpuLayoutSkip(seq, 'physical', 'no physicalMap.ports or suggested gpu_out', {})
	}

	const drmMap = hasDrmGpuPhysicalMap(live)
	if (drmMap && displays.length) {
		traceGpuLayoutSkip(seq, 'display', 'skipped display rows (DRM physical map is canonical)', {
			displayCount: displays.length,
		})
	} else for (const d of displays) {
		const name = String(d?.name || '').trim()
		if (!name) {
			traceGpuLayoutSkip(seq, 'display', 'empty name', { d })
			continue
		}
		const coveredBy = entries.filter((e) => entryActivelyBoundToDisplay(e, name))
		if (coveredBy.length) {
			traceGpuLayoutSkip(seq, 'display', 'actively bound on existing jack', {
				name,
				connected: !!d?.connected,
				coveredBy: coveredBy.map((e) => ({
					id: e.connectorId,
					pairs: e.pairs,
					monitor: e.monitor,
				})),
			})
			continue
		}
		push(entryFromDisplay(d, suggestedGpuOuts, entries.length), 'display')
	}

	// Only infer gpu_pN jacks explicitly listed in suggested connectors — never pad gpu_p3/gpu_p4 from heuristics.
	for (const c of suggestedGpuOuts || []) {
		if (!c || c.kind !== 'gpu_out') continue
		const id = String(c.id || '').trim()
		if (!id || seenIds.has(id)) continue
		if (entries.some((e) => String(e.parentPortId || '') === id)) {
			traceGpuLayoutSkip(seq, 'inferred-suggested', 'per-DP jacks already shown for bracket', { id })
			continue
		}
		const m = /^gpu_p(\d+)$/i.exec(id)
		if (!m) continue
		push(
			entryFromInferredPhysicalPort(parseInt(m[1], 10), suggestedGpuOuts, displays),
			'inferred-suggested',
		)
	}

	if (!drmMap && !suggestedGpuOuts.length && !physicalPorts.length) {
		const expectedPorts = resolveExpectedGpuPhysicalPortCount(live, physicalPorts, suggestedGpuOuts)
		for (let i = 0; i < expectedPorts; i++) {
			const id = `gpu_p${i}`
			if (seenIds.has(id)) continue
			push(entryFromInferredPhysicalPort(i, suggestedGpuOuts, displays), 'inferred-port')
		}
	}

	const graphIds = collectGpuConnectorIdsInGraph(suggestedGpuOuts, graphGpuOuts)
	const suggestedIds = collectGpuConnectorIdsInGraph(suggestedGpuOuts, [])
	const physicalIds = new Set(
		physicalPorts.map((p) => String(p?.physicalPortId || '').trim()).filter(Boolean),
	)
	const tagged = entries
		.filter((entry) => {
			const id = String(entry?.connectorId || '').trim()
			if (/^gpu_p\d+(__[A-Za-z0-9_]+)?$/i.test(id)) return true
			if (drmMap) {
				traceGpuLayoutSkip(seq, 'filter', 'non-canonical gpu id omitted (DRM rear panel uses gpu_pN only)', {
					id,
					label: entry?.label,
				})
				return false
			}
			return true
		})
		.map((entry) => {
			const id = String(entry.connectorId || '').trim()
			const parentPortId =
				entry.parentPortId || (id.match(/^(gpu_p\d+)__/i) || [])[1] || null
			return {
				...entry,
				inDeviceGraph:
					graphIds.has(id) ||
					suggestedIds.has(id) ||
					physicalIds.has(id) ||
					(parentPortId != null &&
						(suggestedIds.has(parentPortId) || graphIds.has(parentPortId))),
			}
		})
	traceGpuLayoutRawComplete(seq, tagged)
	return consolidateBracketSplitEntries(tagged)
}
