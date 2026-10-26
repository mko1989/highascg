'use strict'

/**
 * WO-785 — owner: "the auto recognition of heads doesnt work too well". Measured on the owner's 18 MVR placeholders
 * against the live GDTF Share list (26.10): a variant letter kept "Robin 600X LEDWash" (all 6 modes) out for Capture's
 * "Robin 600 LEDWash+" (the plain 600 LEDWash with 5 of 6 was taken); Brighter X-Dot's firmware-variant modes held the
 * factory file at 5 of 9 footprints although its 24 heads all use 28 ch; types not on Share got nothing to offer.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { rank, loose, nameRank } = require('../../src/fixtures/gdtf-share-match')

const entry = (rid, manufacturer, fixture, footprints, uploader = 'Manuf.') => ({ rid, manufacturer, fixture, uploader,
	rating: 0, lastModified: rid, modes: footprints.map((n, i) => ({ name: `Mode ${i + 1}`, dmxfootprint: n })) })
const stub = (manufacturer, name, footprints) => ({ manufacturer, name, modes: footprints.map((n, i) => ({ name: `${i + 1}: ${n} Channel`, footprint: n })) })

test('a variant letter is a related name; channel counts pick the variant', () => {
	assert.strictEqual(nameRank('Robin 600 LEDWash+', 'Robin 600X LEDWash', 'Robe Lighting'), 1)
	assert.strictEqual(nameRank('MAC Aura PXL', 'Robin 600X LEDWash', 'Robe Lighting'), 2)
	const list = [entry(60186, 'Robe Lighting', 'Robin 600 LEDWash', [37, 21, 15, 10, 25]),
		entry(57382, 'Robe Lighting', 'Robin 600X LEDWash', [37, 21, 15, 10, 24])]
	const r = rank(stub('Robe', 'Robin 600 LEDWash+', [37, 21, 15, 10, 37, 24]), list)
	assert.strictEqual(r.best.rid, 57382)
	assert.strictEqual(r.best.coverage, 1)
	assert.deepStrictEqual(r.best.modes[4], { name: 'Mode 5', footprint: 24 }, 'candidates carry the Share modes')
})

test('every patched mode covered under the same name → taken, though the placeholder has more footprints', () => {
	const s = stub('Brighter', 'X-Dot', [28, 35, 51, 107, 128, 26, 49, 105, 127])
	const list = [entry(147670, 'Brighter', 'X-DOT', [28, 35, 51, 107, 128]), entry(82333, 'Brighter', 'X-DOT', [28, 51])]
	assert.strictEqual(rank(s, list).sure, false, 'without the patch: 5 of 9, offered')
	const r = rank(s, list, 5, ['1: 28 Channel'])
	assert.strictEqual(r.sure, true)
	assert.strictEqual(r.best.rid, 147670, 'both cover 28 ch: more of the rest wins')
	assert.strictEqual(rank(s, list, 5, ['6: 26 Channel']).sure, false, 'a patched mode the file lacks → still offered')
})

test('not on Share: a sibling of the same maker or another maker\'s upload is offered, one per fixture', () => {
	const list = [entry(73188, 'Martin Professional', 'ELP CL LED Profile', [1, 10]),
		entry(84089, 'Martin Professional', 'ELP CL LED Profile', [1, 10, 17]),
		entry(77879, 'Martin Professional', 'ELP PAR', [14, 9]),
		entry(111028, 'OGSON fixtures', 'Martin ELP WW LED Profile', [1, 2, 4], 'User')]
	const s = stub('Martin', 'ELP WW LED Profile', [1, 2, 4])
	assert.strictEqual(rank(s, list).best, null)
	const l = loose(s, list)
	assert.deepStrictEqual(l.map((c) => c.rid), [111028, 84089], 'the re-upload (same name) first, then the sibling once')
	assert.ok(l.every((c) => c.loose))
})

test('the scene\'s patched modes reach the matcher (source pins)', () => {
	const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
	assert.match(read('src/api/routes-stage-mvr.js'), /placeholder: !!t\.placeholder, used,/)
	assert.match(read('src/api/routes-gdtf-share.js'), /share\.resolve\(Array\.isArray\(b\.ids\) \? b\.ids : \[\], deps, used\)/)
	assert.match(read('src/fixtures/gdtf-share.js'), /const offer = loose\(s, all\)/)
	assert.match(read('godot/client/features/previs/mvr_section.gd'), /\{"ids": ids, "used": used\}/)
})
