'use strict'

/**
 * WO-637 — which GDTF Share revision is the real file for an MVR placeholder (pure; gdtf-share.js fetches).
 * A Share list entry: { rid, manufacturer, fixture, uploader: "Manuf." | "User", rating, lastModified,
 * modes: [{ name, dmxfootprint }] }. A placeholder: a type summary { manufacturer, name, modes: [{ name, footprint }] }.
 *
 * Measured on the owner's Pabianice stubs against the live list (13 315 revisions, 2026-10-21): the maker must agree
 * ("User Test", OGSON, TIITEE re-upload other makers' fixtures under the same name), the channel counts decide more
 * than the name (ACME's exact-name "Pixel Line IP" upload misses a mode the "PIXEL LINE IP (STROBE 3 IP)" factory
 * upload has; "Mode 11" is a one-mode file), then a manufacturer upload beats a user one.
 */

/** Lowercase letters + digits, "Dummy -" dropped: "Robin 600 LEDWash+" → "robin600ledwash". */
function norm(s) {
	let t = String(s || '').trim().toLowerCase()
	if (t.startsWith('dummy')) t = t.slice(5).replace(/^[\s\-–:]+/, '')
	return t.replace(/[^a-z0-9]/g, '')
}

const MAKER_SYNONYMS = { americandj: 'adj', adjproducts: 'adj', adjlighting: 'adj' }
const maker = (s) => MAKER_SYNONYMS[norm(s)] || norm(s)

/** "Robe" / "Robe Lighting", "ADJ" / "American DJ". */
function makerAgrees(a, b) {
	const x = maker(a)
	const y = maker(b)
	return x !== '' && y !== '' && (x.startsWith(y) || y.startsWith(x))
}

/** 0 = same name, 1 = one contains the other (a maker prefix on the Share name ignored), 2 = unrelated. */
function nameRank(stubName, shareName, shareMaker) {
	const a = norm(stubName)
	let b = norm(shareName)
	const m = maker(shareMaker)
	if (m && b.startsWith(m) && b !== m) b = b.slice(m.length)
	if (a === '' || b === '') return 2
	return a === b ? 0 : a.includes(b) || b.includes(a) ? 1 : 2
}

/** Share of the placeholder's distinct footprints the entry has a mode for (0…1). */
function coverage(stubModes, shareModes) {
	const want = [...new Set((stubModes || []).map((m) => Number(m.footprint)).filter((n) => n > 0))]
	if (!want.length) return 0
	const have = new Set((shareModes || []).map((m) => Number(m.dmxfootprint)))
	return want.filter((n) => have.has(n)).length / want.length
}

/** Below this the best candidate is offered, not taken. Robe's Robin 600 LEDWash covers 4 of the + stub's 5. */
const SURE_COVERAGE = 0.75

/**
 * Ranked candidates for a placeholder: maker agrees, related name; by coverage, name, manufacturer upload, rating,
 * newest. → { best, sure, candidates (≤ max) }
 */
function rank(stub, list, max = 5) {
	const out = []
	for (const e of Array.isArray(list) ? list : []) {
		if (!makerAgrees(stub.manufacturer, e.manufacturer)) continue
		const nr = nameRank(stub.name, e.fixture, e.manufacturer)
		if (nr > 1) continue
		out.push({ rid: e.rid, manufacturer: e.manufacturer, fixture: e.fixture, revision: e.revision, uploader: e.uploader,
			rating: Number(e.rating) || 0, lastModified: Number(e.lastModified) || 0, nameRank: nr,
			coverage: coverage(stub.modes, e.modes) })
	}
	out.sort((a, b) => b.coverage - a.coverage || a.nameRank - b.nameRank ||
		(b.uploader === 'Manuf.') - (a.uploader === 'Manuf.') || b.rating - a.rating || b.lastModified - a.lastModified)
	const best = out[0] || null
	return { best, sure: !!best && best.coverage >= SURE_COVERAGE, candidates: out.slice(0, max) }
}

const words = (s) => [...new Set((String(s).toLowerCase().match(/[a-z]+|[0-9]+/g) || []).filter((w) => !['ch', 'channel', 'channels', 'mode'].includes(w)))]

/**
 * { placeholder mode → real mode name } by footprint (ties: shared words / numbers; each real mode used once while
 * unused ones of that footprint remain). Unpaired modes are left out (they keep the placeholder). Same rule as the
 * Replace… dialog (replace_type_model.gd pair_modes).
 */
function pairModes(stubModes, realModes) {
	const out = {}
	const used = new Set()
	for (const sm of stubModes || []) {
		let best = ''
		let bestScore = -1
		const sw = words(sm.name)
		for (const rm of realModes || []) {
			if (Number(rm.footprint) !== Number(sm.footprint)) continue
			let score = used.has(rm.name) ? 0 : 100
			for (const w of words(rm.name)) if (sw.includes(w)) score += 1
			if (score > bestScore) {
				bestScore = score
				best = String(rm.name)
			}
		}
		if (best) {
			out[sm.name] = best
			used.add(best)
		}
	}
	return out
}

module.exports = { norm, makerAgrees, nameRank, coverage, rank, pairModes, SURE_COVERAGE }
