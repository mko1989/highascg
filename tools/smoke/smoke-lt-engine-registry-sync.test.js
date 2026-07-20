'use strict'

/**
 * lt-engine ↔ CG-studio registry sync lock (todos19.07.26 "lt-engine studio-helper sharing").
 *
 * The lower-third engine runs as a browser IIFE inside Caspar CEF templates, so the CG studio's
 * node-side inspector registry (src/cg-studio/lt-param-registry.js) cannot literally require it —
 * the style-key vocabulary is duplicated by construction. This test is the shared contract: it
 * parses the `STYLE_KEYS` set literal out of BOTH engine copies (live lt-engine.js and the
 * lt-engine-core/styles split) and asserts they and the registry's field union are the SAME set,
 * so none of the three can drift silently. Editing the vocabulary anywhere now fails the gate
 * until all three agree again.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')

/** Extract the string members of the `const STYLE_KEYS = new Set([...])` literal from a source file. */
function styleKeysFromEngineSource(relPath) {
	const src = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8')
	const m = src.match(/STYLE_KEYS\s*=\s*new Set\(\[([\s\S]*?)\]\)/)
	assert.ok(m, `${relPath}: STYLE_KEYS set literal not found`)
	const keys = [...m[1].matchAll(/'([^']+)'/g)].map((k) => k[1])
	assert.ok(keys.length > 0, `${relPath}: STYLE_KEYS parsed empty`)
	return new Set(keys)
}

/** Union of every style-affecting key the studio inspector exposes or defaults. */
function registryStyleKeys() {
	const reg = require(path.join(REPO_ROOT, 'src/cg-studio/lt-param-registry.js'))
	const keys = new Set(Object.keys(reg.DEFAULT_STYLE))
	const groups = [reg.COLOR_FIELDS, reg.TYPOGRAPHY_FIELDS, reg.LAYOUT_FIELDS, reg.ANIMATION_FIELDS]
	for (const fields of groups) for (const f of fields) keys.add(f.key)
	for (const extras of Object.values(reg.TEMPLATE_EXTRAS)) for (const f of extras) keys.add(f.key)
	return keys
}

function assertSameSet(a, b, labelA, labelB) {
	const onlyA = [...a].filter((k) => !b.has(k)).sort()
	const onlyB = [...b].filter((k) => !a.has(k)).sort()
	assert.deepEqual(
		{ [`only in ${labelA}`]: onlyA, [`only in ${labelB}`]: onlyB },
		{ [`only in ${labelA}`]: [], [`only in ${labelB}`]: [] },
		`${labelA} and ${labelB} style-key vocabularies drifted`
	)
}

describe('lt-engine / registry style-key sync', () => {
	const live = styleKeysFromEngineSource('template/lower-thirds/lt-engine.js')
	const split = styleKeysFromEngineSource('template/lower-thirds/lt-engine-styles.js')
	const registry = registryStyleKeys()

	it('live engine and core/styles split agree', () => {
		assertSameSet(live, split, 'lt-engine.js', 'lt-engine-styles.js')
	})

	it('studio registry field union equals the engine vocabulary', () => {
		assertSameSet(registry, live, 'lt-param-registry.js', 'lt-engine.js')
	})

	it('registry DEFAULT_STYLE keys are all engine style keys', () => {
		const reg = require(path.join(REPO_ROOT, 'src/cg-studio/lt-param-registry.js'))
		for (const k of Object.keys(reg.DEFAULT_STYLE)) {
			assert.ok(live.has(k), `DEFAULT_STYLE key '${k}' unknown to lt-engine STYLE_KEYS`)
		}
	})
})
