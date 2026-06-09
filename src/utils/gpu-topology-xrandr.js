'use strict'

const { getDisplaysXrandrDetailed } = require('./hardware-info')

/**
 * Normalize DRM/xrandr connector id (DP-0, card0-DP-1, …).
 * @param {string} v
 * @returns {string}
 */
function normalizePortName(v) {
	const s = String(v || '').trim().toUpperCase().replace(/^CARD\d+-/i, '')
	if (!s) return ''
	let m = s.match(/^(DP)-(\d+(?:-\d+)*)$/)
	if (m) return `DP-${m[2]}`
	m = s.match(/^(HDMI-A)-(\d+)$/)
	if (m) return `${m[1]}-${parseInt(m[2], 10)}`
	m = s.match(/^(HDMI|DVI|VGA)-(\d+)$/)
	if (m) return `${m[1]}-${parseInt(m[2], 10)}`
	m = s.match(/^(E-?DP)-(\d+)-(\d+)$/)
	if (m) return `EDP-${parseInt(m[2], 10)}-${parseInt(m[3], 10)}`
	m = s.match(/^(E-?DP)-(\d+)$/)
	if (m) return `EDP-${parseInt(m[2], 10)}`
	return s
}

/**
 * NVIDIA-style A/B pair for one physical jack (DP-0/1, DP-2/3, HDMI-0/1, …).
 * @param {string} port
 * @returns {string[]}
 */
function canonicalAbPair(port) {
	const norm = normalizePortName(port)
	let m = norm.match(/^(DP|HDMI|EDP)-(\d+)$/)
	if (!m) {
		// xrandr internal panel lanes: eDP-1-0 / eDP-1-1
		const lane = norm.match(/^(EDP)-(\d+)-(\d+)$/)
		if (lane) {
			const n = parseInt(lane[2], 10)
			const sub = parseInt(lane[3], 10)
			const first = sub % 2 === 0 ? sub : sub - 1
			return [`EDP-${n}-${first}`, `EDP-${n}-${first + 1}`]
		}
		return norm ? [norm] : []
	}
	const prefix = m[1]
	const num = parseInt(m[2], 10)
	const first = num % 2 === 0 ? num : num - 1
	return [`${prefix}-${first}`, `${prefix}-${first + 1}`]
}

/**
 * @param {string} raw xrandr --query text
 * @returns {string[]}
 */
function parseXrandrVideoOutputNames(raw) {
	const outputs = []
	for (const line of String(raw || '').split('\n')) {
		const m = line.match(/^(\S+)\s+(connected|disconnected)\b/)
		if (!m) continue
		const name = m[1].replace(/^card\d+-/i, '')
		if (/^(DP|HDMI|E-?DP)/i.test(name)) outputs.push(name)
	}
	return outputs
}

/**
 * Connected xrandr output names (normalized), e.g. DP-0, HDMI-0.
 * @param {string} raw
 * @returns {Set<string>}
 */
function parseXrandrConnectedNames(raw) {
	const connected = new Set()
	for (const line of String(raw || '').split('\n')) {
		const m = line.match(/^(\S+)\s+connected\b/)
		if (!m) continue
		const norm = normalizePortName(m[1].replace(/^card\d+-/i, ''))
		if (norm) connected.add(norm)
	}
	return connected
}

/** @deprecated use parseXrandrVideoOutputNames */
function parseXrandrDpHdmiOutputNames(raw) {
	return parseXrandrVideoOutputNames(raw)
}

/**
 * Build stable gpu_p* rows from xrandr (all DP/HDMI outputs, connected or not).
 * @param {string} [raw] optional xrandr --query; fetched when omitted
 * @returns {Array<{ physicalPortId: string, slotOrder: number, dpA: string, dpB: string, connectorNumber: number, location: number }> | null}
 */
function discoverGpuPhysicalTopologyFromXrandr(raw) {
	let query = raw
	if (query == null || query === '') {
		try {
			query = getDisplaysXrandrDetailed()?.raw || ''
		} catch {
			query = ''
		}
	}
	if (!query) return null

	const outputs = parseXrandrVideoOutputNames(query)
	if (!outputs.length) return null

	const seenPairs = new Set()
	/** @type {string[][]} */
	const pairs = []
	for (const out of outputs) {
		const pArr = canonicalAbPair(out)
		if (!pArr.length) continue
		const key = pArr.join('|')
		if (seenPairs.has(key)) continue
		seenPairs.add(key)
		pairs.push(pArr)
	}

	pairs.sort((a, b) => {
		const na = parseInt(String(a[0] || '').split('-')[1], 10)
		const nb = parseInt(String(b[0] || '').split('-')[1], 10)
		return (Number.isFinite(na) ? na : 0) - (Number.isFinite(nb) ? nb : 0)
	})

	return pairs.map((pArr, i) => ({
		physicalPortId: `gpu_p${i}`,
		slotOrder: i,
		dpA: normalizePortName(pArr[0]),
		dpB: normalizePortName(pArr[1] || ''),
		connectorNumber: i,
		location: i,
	}))
}

/**
 * @param {unknown[]} a
 * @param {unknown[]} b
 * @returns {boolean}
 */
function topologyRowsEqual(a, b) {
	const norm = (rows) => (Array.isArray(rows) ? rows : [])
		.map((row, i) => {
			if (!row || typeof row !== 'object') return null
			return {
				physicalPortId: String(row.physicalPortId || '').trim(),
				slotOrder: Number.isFinite(Number(row.slotOrder)) ? Number(row.slotOrder) : i,
				dpA: normalizePortName(row.dpA),
				dpB: normalizePortName(row.dpB),
			}
		})
		.filter(Boolean)
		.sort((x, y) => x.slotOrder - y.slotOrder)
	return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
}

/**
 * Persist xrandr-derived topology before UI connects (startup inventory path).
 * @param {{ config: object, configManager?: { get: () => object, save: (c: object) => boolean } | null, log?: (level: string, msg: string) => void }} opts
 * @returns {{ topology: object[] | null, updated: boolean }}
 */
function ensureGpuPhysicalTopologyFromXrandr(opts) {
	const config = opts?.config
	const log = opts?.log
	const { discoverGpuPhysicalTopology } = require('./gpu-topology-drm')
	const probe = discoverGpuPhysicalTopology({ config })
	const discovered = probe?.rows || null
	const source = probe?.source || 'unknown'
	if (!discovered?.length) {
		return { topology: null, updated: false, source: null }
	}

	const cur = Array.isArray(config?.gpuPhysicalTopology) ? config.gpuPhysicalTopology : []
	if (topologyRowsEqual(cur, discovered)) {
		return { topology: discovered, updated: false, source }
	}

	config.gpuPhysicalTopology = discovered
	const cm = opts?.configManager
	if (cm && typeof cm.get === 'function' && typeof cm.save === 'function') {
		const saved = cm.save({ ...cm.get(), gpuPhysicalTopology: discovered })
		if (saved && typeof log === 'function') {
			log(
				'info',
				`[gpu-topology] saved ${source} physical map (${discovered.length} ports): ${discovered.map((r) => `${r.physicalPortId}=${r.dpA}/${r.dpB || '-'}`).join(', ')}`,
			)
		} else if (!saved && typeof log === 'function') {
			log('warn', `[gpu-topology] discovered ${source} map but failed to persist config`)
		}
	} else if (typeof log === 'function') {
		log('info', `[gpu-topology] applied ${source} physical map in memory (${discovered.length} ports)`)
	}

	return { topology: discovered, updated: true, source }
}

module.exports = {
	normalizePortName,
	canonicalAbPair,
	parseXrandrVideoOutputNames,
	parseXrandrConnectedNames,
	parseXrandrDpHdmiOutputNames,
	discoverGpuPhysicalTopologyFromXrandr,
	topologyRowsEqual,
	ensureGpuPhysicalTopologyFromXrandr,
}
