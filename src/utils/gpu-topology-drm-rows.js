'use strict'

const { normalizePortName, canonicalAbPair } = require('./gpu-topology-xrandr')
const {
	adjacentDrmDpPair,
	adjacentEdpPair,
	isSimpleDpName,
	isSimpleEdpName,
	edpPanelPairFromXrandr,
	isNonPairingPort,
	collectXrandrAbPairs,
} = require('./gpu-topology-drm-parse')

function buildRowsForDrmCard(drmCard, onCard, xrandrNames, xrandrOutputs, opts = {}) {
	const pairAdjacentDp = opts.pairAdjacentDp !== false
	const xrandrConnected = opts.xrandrConnected || new Set()
	const byNorm = new Map(onCard.map((c) => [c.norm, c]))
	const used = new Set()
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
		if (ca && cb && ca !== cb && !xrandrConnected.has(a) && !xrandrConnected.has(b)) {
			continue
		}
		const anchor = ca || cb || c
		used.add(a)
		used.add(b)
		pushRow(a, b, anchor, cb && cb !== anchor ? cb : null)
	}

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

	{
		const assignedDrm = new Set()
		for (const row of rows) {
			if (row.drmName) assignedDrm.add(row.drmName)
			if (row.drmNameB) assignedDrm.add(row.drmNameB)
		}
		const usedPairKeys = new Set(rows.map((r) => `${r.dpA}|${r.dpB}`))
		const availPairs = collectXrandrAbPairs(xrandrOutputs).filter(
			(p) => !usedPairKeys.has(p.key) && /^DP-/i.test(p.dpA),
		)
		const connectedPairs = availPairs.filter(
			(p) => xrandrConnected.has(p.dpA) || xrandrConnected.has(p.dpB),
		)
		const connectedDrmDp = onCard
			.filter(
				(c) =>
					isSimpleDpName(c.short) &&
					!assignedDrm.has(c.drmName) &&
					!used.has(c.norm) &&
					c.connected,
			)
			.sort((a, b) => {
				const na = parseInt(a.short.match(/^DP-(\d+)$/i)?.[1] || '0', 10)
				const nb = parseInt(b.short.match(/^DP-(\d+)$/i)?.[1] || '0', 10)
				return na - nb
			})

		let pairIdx = 0
		for (const c of connectedDrmDp) {
			while (pairIdx < connectedPairs.length) {
				const pair = connectedPairs[pairIdx++]
				if (used.has(pair.dpA) || used.has(pair.dpB)) continue
				used.add(pair.dpA)
				used.add(pair.dpB)
				used.add(c.norm)
				assignedDrm.add(c.drmName)
				pushRow(pair.dpA, pair.dpB, c, null)
				break
			}
		}
	}

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

	for (const c of onCard) {
		if (used.has(c.norm)) continue
		used.add(c.norm)
		pushRow(c.norm, '', c, null)
	}

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

module.exports = { buildRowsForDrmCard }
