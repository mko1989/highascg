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

/** Words of a name (letter runs, digit runs; "Dummy -" dropped): "Robin 600X LEDWash" → robin 600 x ledwash. */
function tokens(s) {
	let t = String(s || '').trim().toLowerCase()
	if (t.startsWith('dummy')) t = t.slice(5)
	return [...new Set(t.match(/[a-z]+|[0-9]+/g) || [])]
}

/** Words of a Share name without its maker's ("Robe Robin 600" by "Robe Lighting" → robin 600). */
function bareTokens(shareName, shareMaker) {
	const t = tokens(shareName)
	const m = tokens(shareMaker)
	let i = 0
	while (i < t.length - 1 && i < m.length && t[i] === m[i]) i++
	return i && maker(t.slice(0, i).join('')) === maker(m.slice(0, i).join('')) ? t.slice(i) : t
}

/** A Share name without its maker prefix ("Robe Robin 600" by "Robe Lighting" → "Robin 600"). */
function bare(shareName, shareMaker) {
	const b = norm(shareName)
	const m = maker(shareMaker)
	return m && b.startsWith(m) && b !== m ? b.slice(m.length) : b
}

/**
 * 0 = same name, 1 = related: one contains the other, or every word of one is in the other (WO-785: a variant letter
 * "Robin 600X LEDWash" ↔ Capture's "Robin 600 LEDWash+"), a maker prefix on the Share name ignored; 2 = unrelated.
 */
function nameRank(stubName, shareName, shareMaker) {
	const a = norm(stubName)
	const b = bare(shareName, shareMaker)
	if (a === '' || b === '') return 2
	if (a === b) return 0
	if (a.includes(b) || b.includes(a)) return 1
	const ta = tokens(stubName)
	const tb = bareTokens(shareName, shareMaker)
	return ta.every((w) => tb.includes(w)) || tb.every((w) => ta.includes(w)) ? 1 : 2
}

/** WO-785: shared words / all words of two names (0…1), a maker prefix on the Share name ignored. */
function similarity(stubName, shareName, shareMaker) {
	const ta = tokens(stubName)
	const tb = bareTokens(shareName, shareMaker)
	const all = new Set([...ta, ...tb])
	return all.size ? ta.filter((w) => tb.includes(w)).length / all.size : 0
}

/** Share of the placeholder's distinct footprints the entry has a mode for (0…1). `only` = just these mode names. */
function coverage(stubModes, shareModes, only = null) {
	const pick = (stubModes || []).filter((m) => !only || only.includes(m.name))
	const want = [...new Set(pick.map((m) => Number(m.footprint)).filter((n) => n > 0))]
	if (!want.length) return 0
	const have = new Set((shareModes || []).map((m) => Number(m.dmxfootprint)))
	return want.filter((n) => have.has(n)).length / want.length
}

/** Below this the best candidate is offered, not taken. Robe's Robin 600 LEDWash covers 4 of the + stub's 5. */
const SURE_COVERAGE = 0.75

const candidate = (e, extra) => ({ rid: e.rid, manufacturer: e.manufacturer, fixture: e.fixture, revision: e.revision,
	uploader: e.uploader, rating: Number(e.rating) || 0, lastModified: Number(e.lastModified) || 0,
	modes: (e.modes || []).map((m) => ({ name: String(m.name), footprint: Number(m.dmxfootprint) })), ...extra })

const byRank = (a, b) => b.used - a.used || b.coverage - a.coverage || a.nameRank - b.nameRank ||
	(b.uploader === 'Manuf.') - (a.uploader === 'Manuf.') || b.rating - a.rating || b.lastModified - a.lastModified

/**
 * Ranked candidates for a placeholder: maker agrees, related name; by the coverage of the modes the scene patches
 * (`used`, WO-785), coverage, name, manufacturer upload, rating, newest. Taken (`sure`) when it covers ≥ 0.75 of the
 * placeholder's footprints, or (WO-785) every patched mode under the same name — a stub with firmware-variant modes
 * the Share file lacks (Brighter X-Dot: 5 of 9 footprints, its 24 heads all on 28 ch).
 * → { best, sure, candidates (≤ max, each with the Share modes {name, footprint}) }
 * @param {string[]} [used]  the placeholder's modes the scene's fixtures use
 */
function rank(stub, list, max = 5, used = []) {
	const out = []
	for (const e of Array.isArray(list) ? list : []) {
		if (!makerAgrees(stub.manufacturer, e.manufacturer)) continue
		const nr = nameRank(stub.name, e.fixture, e.manufacturer)
		if (nr > 1) continue
		out.push(candidate(e, { nameRank: nr, coverage: coverage(stub.modes, e.modes),
			used: used.length ? coverage(stub.modes, e.modes, used) : 0 }))
	}
	out.sort(byRank)
	const best = out[0] || null
	const sure = !!best && (best.coverage >= SURE_COVERAGE || (used.length > 0 && best.used === 1 && best.nameRank === 0))
	return { best, sure, candidates: out.slice(0, max) }
}

/**
 * WO-785 — offered (never taken) when `rank` finds nothing: another maker's upload of this fixture ("OGSON fixtures ·
 * Martin ELP CL LED Profile"), or a sibling of the same maker sharing most words ("ELP CL LED Profile" for an
 * "ELP WW LED Profile": the same body, a model and beam instead of a box). By words shared, coverage.
 */
function loose(stub, list, max = 5) {
	const out = []
	for (const e of Array.isArray(list) ? list : []) {
		const same = makerAgrees(stub.manufacturer, e.manufacturer)
		const name = same ? e.fixture : String(e.fixture).replace(new RegExp(`^\\s*${String(stub.manufacturer).replace(/[^\w ]/g, '')}\\s+`, 'i'), '')
		const sim = similarity(stub.name, name, e.manufacturer)
		if (sim < (same ? 0.5 : 0.99)) continue
		out.push(candidate(e, { loose: true, similarity: sim, coverage: coverage(stub.modes, e.modes), nameRank: 2, used: 0 }))
	}
	out.sort((a, b) => b.similarity - a.similarity || byRank(a, b))
	const seen = new Set() // the best revision of each fixture
	return out.filter((c) => !seen.has(`${c.manufacturer}|${c.fixture}`) && seen.add(`${c.manufacturer}|${c.fixture}`)).slice(0, max)
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

module.exports = { norm, makerAgrees, nameRank, similarity, coverage, rank, loose, pairModes, SURE_COVERAGE }
