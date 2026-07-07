import { normRandrCaspar } from './device-view-randr-norm.js'
import { GPU_REAR_PORT_COUNT_OVERRIDE_KEY, RTX_20_30_SOCKET_COUNT } from './device-view-gpu-port-constants.js'

/** Same filter as device-view Caspar rear panel for `live.gpu.connectors`. */
export function countUsableGpuConnectorInventory(live) {
	const raw = Array.isArray(live?.gpu?.connectors) ? live.gpu.connectors : []
	return raw.filter((inv) => {
		const name = String(inv?.shortName || inv?.name || '').trim().toLowerCase()
		if (!name) return false
		if (/^card\d+($|[\s:])/.test(name) || /^gpu\d+($|[\s:])/.test(name) || /^renderd\d+($|[\s:])/.test(name)) {
			return false
		}
		return true
	}).length
}

function maxGpuPIndex(physicalPorts, suggestedGpuOuts) {
	let max = -1
	const bump = (id) => {
		const m = /^gpu_p(\d+)$/i.exec(String(id || '').trim())
		if (m) max = Math.max(max, parseInt(m[1], 10))
	}
	for (const p of physicalPorts) bump(p?.physicalPortId)
	for (const c of suggestedGpuOuts || []) bump(c?.id)
	return max
}

/**
 * How many rear GPU jacks to show (one per physical socket / gpu_pN).
 * @param {object} [live]
 * @param {object[]} physicalPorts
 * @param {object[]} suggestedGpuOuts
 */
export function resolveExpectedGpuPhysicalPortCount(live, physicalPorts, suggestedGpuOuts) {
	const map = live?.gpu?.physicalMap || {}
	const eff = map.effectiveTopology
	if (Array.isArray(eff) && eff.length) {
		return Math.min(8, eff.length)
	}
	for (const key of ['totalPorts', 'portCount', 'physicalPortCount', 'connectorCount']) {
		const n = Number(map[key])
		if (Number.isFinite(n) && n > 0) return Math.min(8, n)
	}
	const inv = countUsableGpuConnectorInventory(live)
	const fromMaxId = maxGpuPIndex(physicalPorts, suggestedGpuOuts) + 1
	let expected = Math.max(physicalPorts.length, inv, fromMaxId)
	const canonicalPorts = physicalPorts.filter((p) =>
		/^gpu_p\d+$/i.test(String(p?.physicalPortId || '')),
	)
	if (
		!hasServerGpuPhysicalMap(live) &&
		canonicalPorts.length === 3 &&
		fromMaxId <= 3 &&
		inv >= 4
	) {
		expected = Math.max(expected, 4)
	}
	try {
		const override = parseInt(localStorage.getItem(GPU_REAR_PORT_COUNT_OVERRIDE_KEY), 10)
		if (override >= 1 && override <= 8) expected = Math.max(expected, override)
	} catch {
		/* ignore */
	}
	return expected
}

/** RandR output present on the socket (includes connected-without-active-mode, e.g. DP-4). */
export function displaysMatchingPairs(pairs, displays, connectors) {
	const want = new Set((pairs || []).map((p) => normRandrCaspar(p)).filter(Boolean))
	if (!want.size) return []
	const hits = []
	for (const d of displays || []) {
		const n = normRandrCaspar(d?.name)
		if (!n || !want.has(n)) continue
		if (d.connected === false) continue
		hits.push({ name: n, ref: d })
	}
	for (const c of connectors || []) {
		const n = normRandrCaspar(c?.shortName || c?.name)
		if (!n || !want.has(n)) continue
		if (c.connected === false) continue
		if (hits.some((h) => h.name === n)) continue
		hits.push({ name: n, ref: c })
	}
	return hits
}

export function isPrimaryTopologySocket(id, socketCount) {
	const m = /^gpu_p(\d+)$/i.exec(String(id || '').trim())
	if (!m) return false
	const limit =
		Number.isFinite(socketCount) && socketCount > 0 ? socketCount : RTX_20_30_SOCKET_COUNT
	return parseInt(m[1], 10) < limit
}

/** True when the server published canonical gpu_pN physical map rows. */
export function hasServerGpuPhysicalMap(live) {
	const physicalPorts = Array.isArray(live?.gpu?.physicalMap?.ports) ? live.gpu.physicalMap.ports : []
	return physicalPorts.some((p) => /^gpu_p\d+$/i.test(String(p?.physicalPortId || '')))
}

/** @deprecated Use hasServerGpuPhysicalMap — name retained for existing imports. */
export function hasDrmGpuPhysicalMap(live) {
	return hasServerGpuPhysicalMap(live)
}

/**
 * Port names for GPU layout editor dropdowns (DP, HDMI, eDP/EDP, active xrandr names).
 * @param {object} [live]
 * @returns {string[]}
 */
export function collectGpuPortNameOptions(live) {
	const names = new Set()
	const add = (v) => {
		const s = String(v || '').trim()
		if (s && !/^none$/i.test(s)) names.add(s)
	}
	const effectiveTopology = live?.gpu?.physicalMap?.effectiveTopology
	if (Array.isArray(effectiveTopology)) {
		for (const row of effectiveTopology) {
			add(row?.dpA)
			add(row?.dpB)
		}
	}
	const physicalPorts = Array.isArray(live?.gpu?.physicalMap?.ports) ? live.gpu.physicalMap.ports : []
	for (const p of physicalPorts) {
		const pair = p?.pair
		if (pair) {
			add(pair.dpA)
			add(pair.dpB)
			add(pair.name)
		}
		const rt = p?.runtime && typeof p.runtime === 'object' ? p.runtime : {}
		add(rt.activePort)
		add(rt.xrandrName)
		add(rt.displayName)
	}
	for (const c of Array.isArray(live?.gpu?.connectors) ? live.gpu.connectors : []) {
		add(c?.shortName)
		add(c?.name)
		add(c?.xrandrName)
	}
	for (const d of Array.isArray(live?.gpu?.displays) ? live.gpu.displays : []) {
		add(d?.name)
	}
	if (names.size === 0) {
		for (let i = 0; i < 8; i++) add(`DP-${i}`)
		for (let i = 0; i < 4; i++) add(`HDMI-${i}`)
		add('EDP-1')
		add('EDP-1-1')
	}

	const rank = (s) => {
		const u = String(s).toUpperCase()
		if (u.startsWith('DP-')) return [0, parseInt(u.slice(3), 10) || 0, u]
		if (u.startsWith('HDMI-')) return [1, parseInt(u.slice(5), 10) || 0, u]
		if (u.includes('EDP')) return [2, 0, u]
		return [3, 0, u]
	}
	return [...names].sort((a, b) => {
		const ra = rank(a)
		const rb = rank(b)
		return ra[0] - rb[0] || ra[1] - rb[1] || String(ra[2]).localeCompare(String(rb[2]))
	})
}

export function iconForPortHints(...parts) {
	const s = parts.filter(Boolean).join(' ').toUpperCase()
	if (s.includes('HDMI')) return '/assets/hdmi-port-icon.svg'
	return '/assets/display-port-icon.svg'
}

export function edidMonitorLabel(mon) {
	if (!mon || typeof mon !== 'object') return ''
	return String(mon.monitorName || '').trim()
}

export function labelForPhysicalPort(p) {
	const pairLabel = String(p?.pair?.name || '').trim() || String(p?.physicalPortId || '').trim()
	const rt = p?.runtime && typeof p.runtime === 'object' ? p.runtime : {}
	const edidName = edidMonitorLabel(rt.monitor)
	const xr = String(rt.xrandrName || rt.displayName || rt.activePort || '').trim()
	if (!rt.connected) return pairLabel
	const parts = [pairLabel]
	if (xr) parts.push(xr)
	if (edidName) parts.push(edidName)
	const res = String(rt.resolution || '').trim()
	if (res && res !== 'unknown') parts.push(res)
	return parts.join(' · ')
}

export function gpuPhysicalPortCableId(connectorOrSlotId) {
	const raw = String(connectorOrSlotId || '').trim()
	const m = raw.match(/^(gpu_p\d+)/i)
	return m ? m[1] : raw
}

/** Per-connector jack id, e.g. gpu_p0 + DP-1 → gpu_p0__DP_1 */
export function gpuSplitConnectorId(parentPortId, shortName) {
	const base = String(parentPortId || '').trim()
	const tag = String(shortName || '').trim().replace(/[^A-Za-z0-9]+/g, '_')
	return tag ? `${base}__${tag}` : base
}

/** Merge gpu_pN__DP_X split rows back into one jack per physical socket. */
export function consolidateBracketSplitEntries(entries) {
	const splitByParent = new Map()
	const keep = []
	for (const entry of entries) {
		const id = String(entry?.connectorId || '').trim()
		const parent =
			String(entry?.parentPortId || '').trim() || (id.match(/^(gpu_p\d+)__/i) || [])[1] || ''
		if (!parent) {
			keep.push(entry)
			continue
		}
		let row = splitByParent.get(parent)
		if (!row) {
			const pairs = Array.isArray(entry.pairs) ? [...entry.pairs] : []
			row = {
				...entry,
				connectorId: parent,
				layoutSlotId: parent,
				parentPortId: undefined,
				pairs,
			}
			splitByParent.set(parent, row)
			continue
		}
		const pairs = Array.isArray(entry.pairs) ? entry.pairs : []
		row.pairs = [...new Set([...(row.pairs || []), ...pairs])]
		row.connected = !!(row.connected || entry.connected)
		if (entry.connected && entry.monitor) {
			row.monitor = entry.monitor
			row.resolution = entry.resolution || row.resolution
			row.refreshHz = entry.refreshHz ?? row.refreshHz
			row.label = entry.label || row.label
		}
	}
	return [...keep, ...splitByParent.values()]
}
