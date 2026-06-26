/**
 * GPU rear-panel layout tracing. Filter DevTools console with: gpu-layout
 *
 * Enable (default): unset or localStorage highascg_debug_gpu_layout = '1'
 * Disable: localStorage.setItem('highascg_debug_gpu_layout', '0')
 */

export const GPU_LAYOUT_DEBUG_KEY = 'highascg_debug_gpu_layout'
const LOG_PREFIX = '[gpu-layout]'

let buildSeq = 0

/** @returns {boolean} */
export function isGpuLayoutDebugEnabled() {
	try {
		const v = localStorage.getItem(GPU_LAYOUT_DEBUG_KEY)
		if (v === '0') return false
		return true
	} catch {
		return true
	}
}

/** @param {string} msg @param {object} [detail] */
export function gpuLayoutLog(msg, detail) {
	if (!isGpuLayoutDebugEnabled()) return
	if (detail !== undefined) console.info(LOG_PREFIX, msg, detail)
	else console.info(LOG_PREFIX, msg)
}

/** @param {string} msg @param {object} [detail] */
export function gpuLayoutWarn(msg, detail) {
	if (!isGpuLayoutDebugEnabled()) return
	if (detail !== undefined) console.warn(LOG_PREFIX, msg, detail)
	else console.warn(LOG_PREFIX, msg)
}

function summarizeEntry(e) {
	if (!e) return null
	return {
		id: e.connectorId || e.id,
		label: e.label,
		hidden: !!e.hidden,
		connected: !!e.connected,
		pairs: e.pairs,
		monitor: e.monitor,
	}
}

function summarizePhysicalPort(p) {
	return {
		physicalPortId: p?.physicalPortId,
		slotOrder: p?.slotOrder,
		pair: p?.pair,
		runtime: p?.runtime,
	}
}

function summarizeDisplay(d) {
	return {
		name: d?.name,
		connected: !!d?.connected,
		resolution: d?.resolution,
	}
}

function summarizeSuggested(c) {
	return {
		id: c?.id,
		label: c?.label,
		externalRef: c?.externalRef,
	}
}

/**
 * @param {object} [live]
 * @param {object[]} suggestedGpuOuts
 * @param {{ physicalPorts: object[], displays: object[] }} inputs
 */
export function traceGpuLayoutBuildStart(live, suggestedGpuOuts, { physicalPorts, displays }) {
	if (!isGpuLayoutDebugEnabled()) return ++buildSeq
	const seq = ++buildSeq
	const gpu = live?.gpu || {}
	console.groupCollapsed(
		`${LOG_PREFIX} build #${seq} — inputs (filter console: gpu-layout)`,
	)
	console.info('hint: disable with localStorage.setItem("highascg_debug_gpu_layout", "0")')
	console.info('topology', {
		topologySource: gpu?.physicalMap?.topologySource,
		model: gpu?.model,
		hasDrmMap: physicalPorts?.length > 0,
	})
	console.info('physicalMap.ports', physicalPorts?.map(summarizePhysicalPort))
	console.info('gpu.displays', displays?.map(summarizeDisplay))
	console.info('suggested gpu_out', suggestedGpuOuts?.map(summarizeSuggested))
	try {
		const raw = localStorage.getItem('gpu_custom_layout')
		console.info('localStorage gpu_custom_layout', raw ? JSON.parse(raw) : null)
	} catch (e) {
		console.info('localStorage gpu_custom_layout (parse error)', e?.message)
	}
	console.groupEnd()
	return seq
}

/**
 * @param {number} seq
 * @param {string} phase
 * @param {string} reason
 * @param {object} [detail]
 */
export function traceGpuLayoutSkip(seq, phase, reason, detail) {
	if (!isGpuLayoutDebugEnabled()) return
	gpuLayoutWarn(`build #${seq} SKIP [${phase}] ${reason}`, detail)
}

/**
 * @param {number} seq
 * @param {string} phase
 * @param {object} entry
 */
export function traceGpuLayoutAdd(seq, phase, entry) {
	if (!isGpuLayoutDebugEnabled()) return
	gpuLayoutLog(`build #${seq} ADD [${phase}]`, summarizeEntry(entry))
}

/**
 * @param {number} seq
 * @param {object[]} raw
 */
export function traceGpuLayoutRawComplete(seq, raw) {
	if (!isGpuLayoutDebugEnabled()) return
	gpuLayoutLog(`build #${seq} raw entries (${raw?.length ?? 0})`, raw?.map(summarizeEntry))
}

/**
 * @param {number} seq
 * @param {object[]} merged
 * @param {object[]} decisions
 */
export function traceGpuLayoutMergeComplete(seq, merged, decisions) {
	if (!isGpuLayoutDebugEnabled()) return
	console.groupCollapsed(`${LOG_PREFIX} build #${seq} after prefs merge (${merged?.length ?? 0})`)
	console.table(
		decisions.map((d) => ({
			id: d.id,
			hidden: d.hidden,
			hiddenReason: d.hiddenReason,
			inSavedPrefs: d.inSavedPrefs,
			savedHidden: d.savedHidden,
			connected: d.connected,
			label: d.label,
		})),
	)
	if (decisions.some((d) => d.hidden)) {
		gpuLayoutWarn(`build #${seq} hidden ports`, decisions.filter((d) => d.hidden))
	}
	const savedOnly = decisions.filter((d) => d.orphanSavedPref)
	if (savedOnly.length) {
		gpuLayoutWarn(`build #${seq} saved prefs IDs not in live list`, savedOnly)
	}
	console.groupEnd()
}

/**
 * @param {object} ctx
 */
export function traceGpuLayoutRearPanelRender(ctx) {
	if (!isGpuLayoutDebugEnabled()) return
	const {
		gpuListEntries,
		items,
		markerItems,
		gpuOuts,
		live,
		gpuEditMode,
		lastPayload,
	} = ctx
	const displays = live?.gpu?.displays || []
	const physicalCount = live?.gpu?.physicalMap?.ports?.length ?? 0

	const entryRows = (gpuListEntries || []).map((e) => ({
		id: e.connectorId,
		label: e.label,
		hidden: !!e.hidden,
		connected: !!e.connected,
		pairs: (e.pairs || []).join(','),
		monitor: e.monitor,
	}))

	const itemRows = (items || []).map((it) => ({
		id: it.id,
		layoutSlotId: it.layoutSlotId,
		hidden: !!it.hidden,
		connected: !!it.connected,
	}))

	const gpuMarkers = (markerItems || []).filter((m) => m.kind === 'gpu_out')
	const markerRows = gpuMarkers.map((m) => ({
		connectorId: m.connectorId,
		layoutSlotId: m.layoutSlotId,
		hidden: !!m.hidden,
		domWouldHide: !!m.hidden && !gpuEditMode,
		label: m.label,
	}))

	console.groupCollapsed(`${LOG_PREFIX} rear panel render`)
	console.info('counts', {
		physicalMapPorts: physicalCount,
		displays: displays.length,
		displaysConnected: displays.filter((d) => d?.connected).length,
		suggestedGpuOut: gpuOuts?.length ?? 0,
		listEntries: gpuListEntries?.length ?? 0,
		slotItems: items?.length ?? 0,
		gpuMarkers: gpuMarkers.length,
		gpuMarkersHidden: gpuMarkers.filter((m) => m.hidden).length,
		gpuEditMode: !!gpuEditMode,
	})
	console.table(entryRows)
	if (itemRows.length !== entryRows.length) {
		gpuLayoutWarn('items length !== entries length', { entries: entryRows.length, items: itemRows.length })
	}
	console.table(markerRows)

	const missingFromMarkers = entryRows.filter(
		(e) => !markerRows.some((m) => m.connectorId === e.id || m.layoutSlotId === e.id),
	)
	if (missingFromMarkers.length) {
		gpuLayoutWarn('entries not placed as markers', missingFromMarkers)
	}

	for (const e of entryRows) {
		const inSuggested = (gpuOuts || []).some((c) => c?.id === e.id)
		const inGraph = (lastPayload?.graph?.connectors || []).some((c) => c?.id === e.id)
		if (!inSuggested && !inGraph && e.id) {
			gpuLayoutWarn('connector id not in graph/suggested (cabling UI may hide)', {
				id: e.id,
				inSuggested,
				inGraph,
			})
		}
	}

	if ((gpuListEntries?.length ?? 0) < 4 && displays.length >= 4) {
		gpuLayoutWarn('fewer built entries than displays — check SKIP lines above', {
			entries: gpuListEntries?.length,
			displays: displays.length,
		})
	}
	if ((gpuListEntries?.length ?? 0) >= 4 && gpuMarkers.filter((m) => !m.hidden).length < 4) {
		gpuLayoutWarn('entries exist but visible markers < 4 — likely hidden prefs or CSS', {
			entries: gpuListEntries?.length,
			visibleMarkers: gpuMarkers.filter((m) => !m.hidden).length,
		})
	}

	const domGpuMarkers = document.querySelectorAll('.device-view__panel-marker--gpu')
	if (domGpuMarkers.length !== gpuMarkers.length) {
		gpuLayoutWarn('DOM GPU marker count !== built marker count', {
			domCount: domGpuMarkers.length,
			builtCount: gpuMarkers.length,
			domIds: [...domGpuMarkers].map((el) => el.getAttribute('data-connector-id')),
			builtIds: gpuMarkers.map((m) => m.connectorId),
		})
	}

	const graphGpu = (lastPayload?.graph?.connectors || []).filter((c) => c?.kind === 'gpu_out')
	const rearIds = new Set((gpuListEntries || []).map((e) => e.connectorId))
	const staleGraphGpu = graphGpu.filter((c) => c?.id && !rearIds.has(c.id))
	if (staleGraphGpu.length) {
		gpuLayoutWarn('graph has gpu_out connectors not shown on rear panel (legacy RandR ids?)', {
			ids: staleGraphGpu.map((c) => ({ id: c.id, label: c.label, externalRef: c.externalRef })),
		})
	}

	console.groupEnd()
}

/**
 * Log the server-side GPU slices used for rear-panel layout (call from DevTools on Device view).
 * @param {object} [lastPayload] full /api/device-view body; uses `.live` when omitted
 */
export function dumpGpuLayoutServerPayload(lastPayload) {
	const report = buildGpuLayoutDiagnosticReport(lastPayload)
	console.info('[gpu-layout] server payload dump', report)
	console.info(
		'[gpu-layout] rear jacks: server map has %s port(s); expected up to gpu_p%s',
		report.server.physicalPortCount,
		Math.max(0, report.server.expectedRearJackCount - 1),
	)
	if (report.issues.length) {
		console.warn('[gpu-layout] issues (likely fault attribution hints):', report.issues)
	}
	return report
}

/**
 * Compact report: raw server GPU slices + mismatch hints (no client build — avoids circular import).
 * @param {object} [lastPayload] full GET /api/device-view body
 */
export function buildGpuLayoutDiagnosticReport(lastPayload) {
	const live = lastPayload?.live ?? lastPayload
	const gpu = live?.gpu || {}
	const suggested = (lastPayload?.suggested?.connectors || []).filter((c) => c?.kind === 'gpu_out')
	const graphGpu = (lastPayload?.graph?.connectors || []).filter(
		(c) => c?.kind === 'gpu_out' || c?.kind === 'gpu_output',
	)
	const physicalPorts = Array.isArray(gpu.physicalMap?.ports) ? gpu.physicalMap.ports : []
	const displays = Array.isArray(gpu.displays) ? gpu.displays : []
	const connectors = Array.isArray(gpu.connectors) ? gpu.connectors : []
	const issues = []

	if (Array.isArray(live?.warnings) && live.warnings.length) {
		for (const w of live.warnings) issues.push({ who: 'server', code: 'live_warning', detail: String(w) })
	}
	if (!physicalPorts.length && !suggested.length) {
		issues.push({
			who: 'server',
			code: 'no_gpu_ports',
			detail: 'physicalMap.ports and suggested gpu_out are both empty — rear panel cannot be built',
		})
	}
	if (!displays.length) {
		issues.push({
			who: 'server',
			code: 'no_displays',
			detail: 'live.gpu.displays empty — xrandr probe failed or no X session (check DISPLAY=:0)',
		})
	}
	const connectedDisplays = displays.filter((d) => d?.connected)
	const mappedNames = new Set()
	for (const p of physicalPorts) {
		const rt = p?.runtime || {}
		if (rt.activePort) mappedNames.add(String(rt.activePort).toUpperCase())
		for (const key of ['connectorA', 'connectorB']) {
			const sn = p?.probe?.[key]?.shortName
			if (sn) mappedNames.add(String(sn).toUpperCase())
		}
		const pair = p?.pair || {}
		if (pair.dpA) mappedNames.add(String(pair.dpA).toUpperCase())
		if (pair.dpB) mappedNames.add(String(pair.dpB).toUpperCase())
	}
	for (const d of connectedDisplays) {
		const name = String(d?.name || '').trim().toUpperCase()
		if (!name) continue
		if (mappedNames.has(name)) continue
		const inUnmappedPort = physicalPorts.some(
			(p) =>
				String(p?.runtime?.activePort || '').toUpperCase() === name ||
				String(p?.pair?.dpA || '').toUpperCase() === name ||
				String(p?.pair?.dpB || '').toUpperCase() === name,
		)
		if (!inUnmappedPort) {
			issues.push({
				who: 'server',
				code: 'display_not_in_topology',
				detail: `xrandr output ${d.name} is connected but not mapped to gpu_pN (wrong gpuPhysicalTopology?)`,
			})
		}
	}
	const unmappedPorts = physicalPorts.filter((p) => p?.unmapped || String(p?.physicalPortId || '').startsWith('gpu_unmapped'))
	if (unmappedPorts.length) {
		issues.push({
			who: 'server',
			code: 'unmapped_ports',
			detail: `${unmappedPorts.length} display(s) placed in gpu_unmapped_* — topology does not match xrandr names`,
			ports: unmappedPorts.map((p) => ({
				id: p.physicalPortId,
				activePort: p?.runtime?.activePort,
				resolution: p?.runtime?.resolution,
			})),
		})
	}
	const topo = String(gpu.physicalMap?.topologySource || '').trim()
	if (gpu.physicalMap?.topologyReconciled) {
		issues.push({
			who: 'server',
			code: 'topology_live_reconciled',
			detail:
				'Saved gpuPhysicalTopology did not match live xrandr (e.g. DP-4 was gpu_unmapped). Server applied RTX 20/30 map from connected outputs — Save GPU layout to persist.',
		})
	}
	if (topo === 'default') {
		issues.push({
			who: 'server',
			code: 'default_topology',
			detail: 'Using built-in default map (RTX 20/30): gpu_p0 DP 0/1, gpu_p1 HDMI, gpu_p2 DP 2/3, gpu_p3 DP 4/5',
		})
	}
	const staleGraph = graphGpu.filter((c) => {
		const id = String(c?.id || '')
		return id && !/^gpu_p\d+(__.*)?$/i.test(id) && !id.startsWith('gpu_unmapped')
	})
	if (staleGraph.length) {
		issues.push({
			who: 'client_or_config',
			code: 'legacy_graph_gpu_ids',
			detail: 'graph has gpu_out ids that are not gpu_pN — may not appear on rear panel',
			ids: staleGraph.map((c) => c.id),
		})
	}
	if (suggested.length && physicalPorts.length && suggested.length !== physicalPorts.filter((p) => !p?.unmapped).length) {
		issues.push({
			who: 'server',
			code: 'suggested_vs_physical_mismatch',
			detail: `suggested gpu_out count (${suggested.length}) differs from physicalMap canonical ports (${physicalPorts.filter((p) => !String(p?.physicalPortId || '').startsWith('gpu_unmapped')).length})`,
		})
	}

	let maxP = -1
	for (const p of physicalPorts) {
		const m = /^gpu_p(\d+)$/i.exec(String(p?.physicalPortId || ''))
		if (m) maxP = Math.max(maxP, parseInt(m[1], 10))
	}
	for (const c of suggested) {
		const m = /^gpu_p(\d+)$/i.exec(String(c?.id || ''))
		if (m) maxP = Math.max(maxP, parseInt(m[1], 10))
	}

	return {
		collectedAt: live?.host?.collectedAt || null,
		hostname: live?.host?.hostname || null,
		warnings: live?.warnings || [],
		server: {
			model: gpu.model || null,
			topologySource: gpu.physicalMap?.topologySource || null,
			physicalPortCount: physicalPorts.length,
			expectedRearJackCount: Math.max(physicalPorts.length, maxP + 1),
			displayCount: displays.length,
			connectedDisplayCount: connectedDisplays.length,
			connectorInventoryCount: connectors.length,
			suggestedGpuOutCount: suggested.length,
			graphGpuOutCount: graphGpu.length,
			physicalMap: gpu.physicalMap,
			displays,
			connectors,
			suggestedGpuOuts: suggested,
			graphGpuOuts: graphGpu,
		},
		issues,
	}
}

if (typeof globalThis !== 'undefined') {
	globalThis.__highascgGpuLayoutDebug = {
		enabled: isGpuLayoutDebugEnabled,
		enable: () => {
			try {
				localStorage.setItem(GPU_LAYOUT_DEBUG_KEY, '1')
			} catch {
				/* ignore */
			}
		},
		disable: () => {
			try {
				localStorage.setItem(GPU_LAYOUT_DEBUG_KEY, '0')
			} catch {
				/* ignore */
			}
		},
		dumpServer: dumpGpuLayoutServerPayload,
		report: buildGpuLayoutDiagnosticReport,
		copyReport: async (lastPayload) => {
			const payload =
				lastPayload ||
				(await (await import('../components/device-view-actions.js')).loadDeviceView())
			const report = buildGpuLayoutDiagnosticReport(payload)
			const text = JSON.stringify(report, null, 2)
			try {
				await navigator.clipboard.writeText(text)
				console.info('[gpu-layout] diagnostic report copied to clipboard')
			} catch {
				console.info('[gpu-layout] diagnostic report', report)
			}
			return report
		},
	}
}
