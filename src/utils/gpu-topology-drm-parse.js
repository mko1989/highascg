'use strict'

const { compareConnectorNames } = require('./hardware-info')
const { normalizePortName, canonicalAbPair } = require('./gpu-topology-xrandr')

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

function collectXrandrAbPairs(xrandrOutputs) {
	const seen = new Set()
	const pairs = []
	for (const out of xrandrOutputs) {
		const p = canonicalAbPair(out)
		if (p.length !== 2) continue
		const dpA = normalizePortName(p[0])
		const dpB = normalizePortName(p[1])
		if (!dpA || !dpB || dpA === dpB) continue
		const key = `${dpA}|${dpB}`
		if (seen.has(key)) continue
		seen.add(key)
		pairs.push({ dpA, dpB, key })
	}
	pairs.sort((a, b) => {
		const na = parseInt(a.dpA.split('-')[1], 10)
		const nb = parseInt(b.dpA.split('-')[1], 10)
		return (Number.isFinite(na) ? na : 0) - (Number.isFinite(nb) ? nb : 0)
	})
	return pairs
}

module.exports = {
	cardFromDrmName,
	cardSortKey,
	isSkippableDrmConnector,
	pickPrimaryDrmCard,
	groupConnectorsByDrmCard,
	adjacentDrmDpPair,
	adjacentEdpPair,
	isSimpleDpName,
	isSimpleEdpName,
	edpPanelPairFromXrandr,
	isNonPairingPort,
	collectXrandrAbPairs,
}
