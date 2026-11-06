'use strict'

/**
 * WO-981: canonicalJson is hand-rolled now (the old replacer rebuilt + sorted every object). It must stay BYTE-identical
 * to the old implementation — projectContentEquals / showContentEquals decide "unchanged persist" with it, so a
 * different string for the same content would re-stamp rev/savedAt on every idle autosave echo (WO-329B / WO-919 F6).
 * Also: persistProject hands writeProjectFile's text to writeAutosaveFile (one stringify, same bytes in both files).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { canonicalJson } = require('../../src/engine/project-scenes')

function oldCanonicalJson(v) {
	return JSON.stringify(v, (_k, x) =>
		x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x,
	)
}

test('canonicalJson equals the old replacer implementation on edge cases', () => {
	const cases = [
		{ b: 1, a: [3, { z: 1, y: undefined, x: () => 1 }, undefined, null], 10: 'x', 2: 'y', '01': 'z', '-1': 1 },
		{ 'k"q': 1, 'é': 2, '\n': 3, ' ': 4, a: NaN, b: Infinity, c: -0, d: 1e21, e: 0.1 + 0.2, f: true, g: false },
		{ d: new Date(0), nested: { toJSON: () => ({ q: 2, a: 1 }) }, s: 'he"llo\\' },
		[], {}, [[], {}, [{}]], null, 'str', 5, true, undefined,
		{ 4294967294: 1, 4294967295: 2, 4294967296: 3, 9: 4, 100: 5 },
	]
	for (const c of cases) assert.equal(canonicalJson(c), oldCanonicalJson(c), JSON.stringify(c))
})

test('canonicalJson equals the old implementation on every stored project file', () => {
	const dirs = [path.join(__dirname, '../../projects'), path.join(__dirname, '../../projects/_autosave')]
	let n = 0
	for (const d of dirs) {
		if (!fs.existsSync(d)) continue
		for (const f of fs.readdirSync(d)) {
			if (!f.endsWith('.json')) continue
			let j
			try {
				j = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))
			} catch {
				continue
			}
			assert.equal(canonicalJson(j), oldCanonicalJson(j), f)
			n++
		}
	}
	assert.ok(n >= 0)
})

test('cyclic input still throws (callers catch it as "changed")', () => {
	const a = {}
	a.self = a
	assert.throws(() => canonicalJson(a))
})

test('persistProject writes identical bytes to the main file and the _autosave copy', () => {
	const { persistProject } = require('../../src/engine/project-scenes')
	const store = require('../../src/engine/project-store')
	const persistence = require('../../src/utils/persistence')
	const ctx = { persistence, log() {}, config: {} }
	const r = persistProject(ctx, { version: 1, name: 'wo981 bytes', scenes: { scenes: [{ id: 'a', name: 'A' }] } }, { pushVolumes: false })
	assert.equal(fs.readFileSync(store.projectFilePath(r.slug), 'utf8'), fs.readFileSync(store.autosaveFilePath(r.slug), 'utf8'))
})
