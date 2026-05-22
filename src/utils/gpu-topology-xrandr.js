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
	const m = s.match(/^(DP|HDMI|DVI|VGA|E-?DP)-?(\d+)$/)
	if (m) return `${m[1].replace('E-DP', 'EDP')}-${parseInt(m[2], 10)}`
	return s
}

/**
 * NVIDIA-style A/B pair for one physical jack (DP-0/1, DP-2/3, HDMI-0/1, …).
 * @param {string} port
 * @returns {string[]}
 */
function canonicalAbPair(port) {
	const norm = normalizePortName(port)
	const m = norm.match(/^(DP|HDMI)-(\d+)$/)
	if (!m) return norm ? [norm] : []
	const prefix = m[1]
	const num = parseInt(m[2], 10)
	const first = num % 2 === 0 ? num : num - 1
	return [`${prefix}-${first}`, `${prefix}-${first + 1}`]
}

/**
 * @param {string} raw xrandr --query text
 * @returns {string[]}
 */
function parseXrandrDpHdmiOutputNames(raw) {
	const outputs = []
	for (const line of String(raw || '').split('\n')) {
		const m = line.match(/^(\S+)\s+(connected|disconnected)\b/)
		if (!m) continue
		const name = m[1].replace(/^card\d+-/i, '')
		if (/^(DP|HDMI)/i.test(name)) outputs.push(name)
	}
	return outputs
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

	const outputs = parseXrandrDpHdmiOutputNames(query)
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
	const discovered = discoverGpuPhysicalTopologyFromXrandr()
	if (!discovered?.length) {
		return { topology: null, updated: false }
	}

	const cur = Array.isArray(config?.gpuPhysicalTopology) ? config.gpuPhysicalTopology : []
	if (topologyRowsEqual(cur, discovered)) {
		return { topology: discovered, updated: false }
	}

	config.gpuPhysicalTopology = discovered
	const cm = opts?.configManager
	if (cm && typeof cm.get === 'function' && typeof cm.save === 'function') {
		const saved = cm.save({ ...cm.get(), gpuPhysicalTopology: discovered })
		if (saved && typeof log === 'function') {
			log('info', `[gpu-topology] saved xrandr physical map (${discovered.length} ports): ${discovered.map((r) => `${r.physicalPortId}=${r.dpA}/${r.dpB || '-'}`).join(', ')}`)
		} else if (!saved && typeof log === 'function') {
			log('warn', '[gpu-topology] discovered xrandr map but failed to persist config')
		}
	} else if (typeof log === 'function') {
		log('info', `[gpu-topology] applied xrandr physical map in memory (${discovered.length} ports)`)
	}

	return { topology: discovered, updated: true }
}

module.exports = {
	normalizePortName,
	canonicalAbPair,
	parseXrandrDpHdmiOutputNames,
	discoverGpuPhysicalTopologyFromXrandr,
	topologyRowsEqual,
	ensureGpuPhysicalTopologyFromXrandr,
}
