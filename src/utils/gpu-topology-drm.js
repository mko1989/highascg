'use strict'

const { getGpuConnectorInventory, compareConnectorNames } = require('./hardware-info')
const {
	normalizePortName,
	canonicalAbPair,
	discoverGpuPhysicalTopologyFromXrandr,
	parseXrandrVideoOutputNames,
} = require('./gpu-topology-xrandr')

function cardFromDrmName(name) {
	const m = String(name || '').match(/^(card\d+)-/i)
	return m ? m[1].toLowerCase() : ''
}

function cardSortKey(card) {
	const m = String(card || '').match(/^card(\d+)$/i)
	return m ? parseInt(m[1], 10) : 999
}

function isSkippableDrmConnector(shortName) {
	const s = String(shortName || '').trim().toLowerCase()
	if (!s) return true
	if (/writeback/i.test(s)) return true
	return false
}

/**
 * Prefer the DRM card with the most video outputs (discrete GPU on hybrid laptops).
 * @param {Array<{ name?: string, shortName?: string }>} connectors
 * @param {string} [preferredCard] e.g. card1 from /dev/dri/card1
 */
function pickPrimaryDrmCard(connectors, preferredCard) {
	const pref = String(preferredCard || '').trim().toLowerCase()
	if (pref && connectors.some((c) => cardFromDrmName(c?.name) === pref)) return pref

	const counts = new Map()
	for (const c of connectors) {
		const card = cardFromDrmName(c?.name)
		if (!card) continue
		counts.set(card, (counts.get(card) || 0) + 1)
	}
	let best = ''
	let bestN = 0
	for (const [card, n] of counts) {
		if (n > bestN) {
			bestN = n
			best = card
		}
	}
	return best
}

/**
 * @param {Array<{ name?: string, shortName?: string, connected?: boolean, type?: string }>} connectors
 * @returns {Map<string, Array<{ name?: string, shortName?: string, connected?: boolean, type?: string }>>}
 */
function groupConnectorsByDrmCard(connectors) {
	const groups = new Map()
	for (const c of connectors) {
		const card = cardFromDrmName(c?.name)
		if (!card) continue
		if (!groups.has(card)) groups.set(card, [])
		groups.get(card).push(c)
	}
	for (const [card, list] of groups) {
		list.sort((a, b) =>
			compareConnectorNames(a?.shortName || a?.name, b?.shortName || b?.name),
		)
		groups.set(card, list)
	}
	return new Map([...groups.entries()].sort((a, b) => cardSortKey(a[0]) - cardSortKey(b[0])))
}

/**
 * Simple DP-N / DP-N+1 on the same DRM card (dual-mode jack), not NVIDIA 0/1 renumbering.
 * @param {string} short
 * @returns {string[] | null}
 */
function adjacentDrmDpPair(short) {
	const m = String(short || '').trim().match(/^DP-(\d+)$/i)
	if (!m) return null
	const n = parseInt(m[1], 10)
	if (!Number.isFinite(n)) return null
	return [`DP-${n}`, `DP-${n + 1}`]
}

function adjacentEdpPair(short) {
	const m = String(short || '').trim().match(/^eDP-(\d+)$/i)
	if (!m) return null
	const n = parseInt(m[1], 10)
	if (!Number.isFinite(n)) return null
	return [`eDP-${n}`, `eDP-${n + 1}`]
}

function isSimpleDpName(short) {
	return /^DP-\d+$/i.test(String(short || '').trim())
}

function isSimpleEdpName(short) {
	return /^eDP-\d+$/i.test(String(short || '').trim())
}

/**
 * Built-in panel: DRM eDP-N plus xrandr lanes eDP-N-0 / eDP-N-1.
 * @param {string} drmShort e.g. eDP-1
 * @param {string[]} xrandrOutputs raw xrandr output names
 */
function edpPanelPairFromXrandr(drmShort, xrandrOutputs) {
	const m = String(drmShort || '').trim().match(/^eDP-(\d+)$/i)
	if (!m) return null
	const n = m[1]
	const re = new RegExp(`^eDP-${n}-(\\d+)$`, 'i')
	const lanes = (Array.isArray(xrandrOutputs) ? xrandrOutputs : []).filter((name) => re.test(name))
	if (!lanes.length) return null
	lanes.sort((a, b) => {
		const la = parseInt(re.exec(a)?.[1] || '0', 10)
		const lb = parseInt(re.exec(b)?.[1] || '0', 10)
		return la - lb
	})
	if (lanes.length >= 2) {
		return { dpA: normalizePortName(lanes[0]), dpB: normalizePortName(lanes[1]) }
	}
	return { dpA: normalizePortName(`eDP-${n}`), dpB: normalizePortName(lanes[0]) }
}

function isNonPairingPort(short) {
	return /^DP-\d+-\d+/.test(String(short || '').trim())
}

/**
 * Build topology rows for one DRM card (pairing scoped to this card only).
 * @param {string} drmCard
 * @param {Array<{ drmName: string, short: string, norm: string, connected: boolean, type: string }>} onCard
 * @param {Set<string>} xrandrNames
 * @param {string[]} xrandrOutputs
 * @param {{ pairAdjacentDp?: boolean }} [opts]
 */
function buildRowsForDrmCard(drmCard, onCard, xrandrNames, xrandrOutputs, opts = {}) {
	const pairAdjacentDp = opts.pairAdjacentDp !== false
	const byNorm = new Map(onCard.map((c) => [c.norm, c]))
	const used = new Set()
	/** @type {Array<{ dpA: string, dpB: string, drmName?: string, drmNameB?: string, drmCard: string }>} */
	const rows = []

	const pushRow = (dpA, dpB, primary, secondary) => {
		rows.push({
			dpA,
			dpB: dpB || '',
			drmName: primary?.drmName || '',
			...(secondary?.drmName ? { drmNameB: secondary.drmName } : {}),
			drmCard,
		})
	}

	// 1) xrandr-confirmed pairs (DP-0/1, HDMI-0/1, eDP-1-0/1, …) when both exist in xrandr.
	for (const c of onCard) {
		if (used.has(c.norm) || isNonPairingPort(c.short)) continue
		const pair = canonicalAbPair(c.short)
		if (pair.length !== 2) continue
		const a = normalizePortName(pair[0])
		const b = normalizePortName(pair[1])
		if (a === b) continue
		const inXrandr = xrandrNames.size > 0 && xrandrNames.has(a) && xrandrNames.has(b)
		if (!inXrandr) continue
		const ca = byNorm.get(a) || (isSimpleEdpName(c.short) && normalizePortName(c.short) === a ? c : null)
		const cb = byNorm.get(b)
		if (!ca && !cb) continue
		used.add(a)
		used.add(b)
		pushRow(a, b, ca || c, cb)
	}

	// 1b) xrandr eDP panel lanes (eDP-N-0 / eDP-N-1) anchored to DRM eDP-N when lanes only in xrandr.
	for (const c of onCard) {
		if (used.has(c.norm) || !isSimpleEdpName(c.short)) continue
		const panel = edpPanelPairFromXrandr(c.short, xrandrOutputs)
		if (!panel?.dpB) continue
		const laneA = panel.dpA
		const laneB = panel.dpB
		if (laneA === laneB) continue
		const lanesInXrandr =
			xrandrNames.size > 0 && xrandrNames.has(laneA) && xrandrNames.has(laneB)
		const drmAnchor = normalizePortName(c.short) === laneA && xrandrNames.has(laneB)
		if (!lanesInXrandr && !drmAnchor) continue
		used.add(c.norm)
		used.add(laneA)
		used.add(laneB)
		pushRow(laneA, laneB, c, null)
	}

	// 2) Adjacent DP-N / DP-N+1 on same card (physical dual-mode jack), e.g. DRM DP-1+DP-2.
	if (pairAdjacentDp) {
		const dps = onCard
			.filter((c) => isSimpleDpName(c.short) && !used.has(c.norm))
			.sort((a, b) => {
				const na = parseInt(String(a.short).match(/^DP-(\d+)$/i)?.[1] || '0', 10)
				const nb = parseInt(String(b.short).match(/^DP-(\d+)$/i)?.[1] || '0', 10)
				return na - nb
			})
		for (const c of dps) {
			if (used.has(c.norm)) continue
			const adj = adjacentDrmDpPair(c.short)
			if (!adj || adj.length !== 2) {
				used.add(c.norm)
				pushRow(c.norm, '', c, null)
				continue
			}
			const a = normalizePortName(adj[0])
			const b = normalizePortName(adj[1])
			const n = parseInt(String(c.short).match(/^DP-(\d+)$/i)?.[1] || '0', 10)
			if (n % 2 === 1 && byNorm.has(b) && !used.has(b)) {
				const cb = byNorm.get(b)
				used.add(a)
				used.add(b)
				pushRow(a, b, byNorm.get(a) || c, cb)
			} else {
				used.add(c.norm)
				pushRow(c.norm, '', c, null)
			}
		}
	}

	// 2b) Adjacent eDP-N / eDP-N+1 on same card (some boards expose two panel paths).
	if (pairAdjacentDp) {
		const edps = onCard
			.filter((c) => isSimpleEdpName(c.short) && !used.has(c.norm))
			.sort((a, b) => {
				const na = parseInt(String(a.short).match(/^eDP-(\d+)$/i)?.[1] || '0', 10)
				const nb = parseInt(String(b.short).match(/^eDP-(\d+)$/i)?.[1] || '0', 10)
				return na - nb
			})
		for (const c of edps) {
			if (used.has(c.norm)) continue
			const adj = adjacentEdpPair(c.short)
			if (!adj || adj.length !== 2) {
				used.add(c.norm)
				pushRow(c.norm, '', c, null)
				continue
			}
			const a = normalizePortName(adj[0])
			const b = normalizePortName(adj[1])
			const n = parseInt(String(c.short).match(/^eDP-(\d+)$/i)?.[1] || '0', 10)
			if (n % 2 === 1 && byNorm.has(b) && !used.has(b)) {
				const cb = byNorm.get(b)
				used.add(a)
				used.add(b)
				pushRow(a, b, byNorm.get(a) || c, cb)
			} else {
				used.add(c.norm)
				pushRow(c.norm, '', c, null)
			}
		}
	}

	// 3) Everything else: one row per port (HDMI, eDP, odd DP tail, …).
	for (const c of onCard) {
		if (used.has(c.norm)) continue
		used.add(c.norm)
		pushRow(c.norm, '', c, null)
	}

	// 4) Enrich lone eDP rows with xrandr panel lane B (eDP-N / eDP-N-1).
	for (const row of rows) {
		if (row.dpB) continue
		if (!/^EDP-\d+$/i.test(row.dpA)) continue
		const drmShort = `eDP-${row.dpA.replace(/^EDP-/i, '')}`
		const panel = edpPanelPairFromXrandr(drmShort, xrandrOutputs)
		if (!panel?.dpB || panel.dpA === panel.dpB) continue
		row.dpA = panel.dpA
		row.dpB = panel.dpB
	}

	return rows
}

/**
 * Build gpu_p* rows from DRM connector inventory — **all GPU cards**, one row per port.
 * @param {Array<{ name?: string, shortName?: string, connected?: boolean, type?: string }>} connectors
 * @param {{ xrandrRaw?: string, cardOrder?: string[], pairAdjacentDp?: boolean }} [opts]
 * @returns {Array<{ physicalPortId: string, slotOrder: number, dpA: string, dpB: string, connectorNumber: number, location: number, drmName?: string, drmCard: string }> | null}
 */
function buildTopologyRowsFromDrmConnectors(connectors, opts = {}) {
	const list = (Array.isArray(connectors) ? connectors : []).filter(
		(c) => c && typeof c === 'object' && !isSkippableDrmConnector(c.shortName || c.name),
	)
	if (!list.length) return null

	const xrandrOutputs = parseXrandrVideoOutputNames(opts.xrandrRaw || '')
	const xrandrNames = new Set(
		xrandrOutputs.map((n) => normalizePortName(n)).filter(Boolean),
	)

	let cardGroups = groupConnectorsByDrmCard(list)
	if (Array.isArray(opts.cardOrder) && opts.cardOrder.length) {
		const order = opts.cardOrder.map((c) => String(c || '').toLowerCase()).filter(Boolean)
		const reordered = new Map()
		for (const card of order) {
			if (cardGroups.has(card)) reordered.set(card, cardGroups.get(card))
		}
		for (const [card, group] of cardGroups) {
			if (!reordered.has(card)) reordered.set(card, group)
		}
		cardGroups = reordered
	}

	/** @type {Array<{ dpA: string, dpB: string, drmName?: string, drmCard: string }>} */
	const merged = []
	for (const [drmCard, group] of cardGroups) {
		const onCard = group
			.map((c) => {
				const drmName = String(c.name || '').trim()
				const short = String(c.shortName || drmName.replace(/^card\d+-/i, '')).trim()
				return {
					drmName,
					short,
					norm: normalizePortName(short || drmName),
					connected: !!c.connected,
					type: String(c.type || 'unknown'),
				}
			})
			.filter((c) => c.norm)
		merged.push(...buildRowsForDrmCard(drmCard, onCard, xrandrNames, xrandrOutputs, {
			pairAdjacentDp: opts.pairAdjacentDp,
		}))
	}

	if (!merged.length) return null

	return merged.map((row, i) => ({
		physicalPortId: `gpu_p${i}`,
		slotOrder: i,
		dpA: row.dpA,
		dpB: row.dpB,
		connectorNumber: i,
		location: i,
		drmName: row.drmName,
		...(row.drmNameB ? { drmNameB: row.drmNameB } : {}),
		drmCard: row.drmCard,
	}))
}

/**
 * Enumerate topology from `/sys/class/drm` (all connectors on all GPU cards).
 * @param {{ config?: object, xrandrRaw?: string }} [opts]
 */
function discoverGpuPhysicalTopologyFromDrm(opts = {}) {
	const cfg = opts?.config && typeof opts.config === 'object' ? opts.config : {}
	let preferredCard = ''
	const drmDev = String(cfg?.streaming?.drmDevice || '').trim()
	const m = drmDev.match(/card(\d+)/i)
	if (m) preferredCard = `card${m[1]}`

	const connectors = getGpuConnectorInventory() || []
	const cardOrder = preferredCard ? [preferredCard] : []
	const pairAdjacentDp = cfg.gpuPhysicalPairAdjacentDp !== false
	return buildTopologyRowsFromDrmConnectors(connectors, {
		xrandrRaw: opts.xrandrRaw,
		cardOrder,
		pairAdjacentDp,
	})
}

/**
 * Prefer DRM sysfs enumeration; fall back to xrandr when DRM is unavailable.
 * @param {{ config?: object, xrandrRaw?: string }} [opts]
 * @returns {{ rows: object[], source: string, cards?: string[] } | null}
 */
function discoverGpuPhysicalTopology(opts = {}) {
	const cfg = opts?.config && typeof opts.config === 'object' ? opts.config : {}
	let xrandrRaw = opts.xrandrRaw
	if (xrandrRaw == null) {
		try {
			const { getDisplaysXrandrDetailed } = require('./hardware-info')
			xrandrRaw = getDisplaysXrandrDetailed()?.raw || ''
		} catch {
			xrandrRaw = ''
		}
	}

	const fromDrm = discoverGpuPhysicalTopologyFromDrm({ config: cfg, xrandrRaw })
	if (fromDrm?.length) {
		const cards = [...new Set(fromDrm.map((r) => r.drmCard).filter(Boolean))]
		return { rows: fromDrm, source: 'drm', cards }
	}

	const fromXrandr = discoverGpuPhysicalTopologyFromXrandr(xrandrRaw)
	if (fromXrandr?.length) {
		return { rows: fromXrandr, source: 'xrandr', cards: [] }
	}

	return null
}

module.exports = {
	cardFromDrmName,
	cardSortKey,
	pickPrimaryDrmCard,
	buildRowsForDrmCard,
	adjacentDrmDpPair,
	adjacentEdpPair,
	edpPanelPairFromXrandr,
	groupConnectorsByDrmCard,
	buildTopologyRowsFromDrmConnectors,
	discoverGpuPhysicalTopologyFromDrm,
	discoverGpuPhysicalTopology,
}
