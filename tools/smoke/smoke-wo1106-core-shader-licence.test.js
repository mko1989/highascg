'use strict'

/**
 * WO-1106 B14 / B68 — shader attribution (src/shaderfx/shader-licence.js):
 *   B14  a newline in a Shadertoy title / author / note stays inside its `//` line (no GLSL injected below it)
 *   B68  ids removed for IP reasons stay retired whatever header they carry; only the opt-in ids come back
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const lic = require('../../src/shaderfx/shader-licence')

const OPT_IN = path.join(__dirname, '..', '..', 'template', 'shaders', 'LICENSES', 'opt-in.json')

test('B14: every header field stays on its own comment line', () => {
	const hdr = lic.buildShaderHeader({
		title: 'Nice\nvoid mainImage(out vec4 c, in vec2 p) { c = vec4(1.0); }\r\n',
		author: 'evil\r\n#define x',
		url: 'https://www.shadertoy.com/view/abc\n',
		licence: 'CC-BY-NC-SA-3.0',
		basis: 'Shadertoy\ndefault',
		notes: ['Imported for HighAsCG\nfloat z;'],
	})
	const lines = hdr.split('\n').filter(Boolean)
	assert.equal(lines.length, 4)
	for (const l of lines) assert.match(l, /^\/\/ /, l)
	assert.ok(!/\r/.test(hdr))
	const back = lic.parseShaderHeader(`${hdr}void mainImage() {}`)
	assert.equal(back.author, 'evil #define x')
	assert.match(back.title, /^Nice void mainImage/)
	assert.equal(back.url, 'https://www.shadertoy.com/view/abc')
	const u = lic.buildShaderHeader({ title: 't', author: 'a', url: 'https://x/y\nfloat y;', licence: 'MIT' })
	assert.ok(u.split('\n').filter(Boolean).every((l) => l.startsWith('// ')), 'a URL with a newline stays a comment')
})

test('B68: removed ids stay retired with a valid header; opt-in ids come back with one', () => {
	const doc = JSON.parse(fs.readFileSync(OPT_IN, 'utf8'))
	assert.deepEqual([...lic.REMOVED_SHADER_IDS].sort(), doc.removed.map((e) => e.id).sort())
	assert.deepEqual([...lic.OPT_IN_SHADER_IDS].sort(), doc.optIn.map((e) => e.id).sort())
	const header = lic.buildShaderHeader({ title: 'x', author: 'me', url: 'https://example.org/x', licence: 'AGPL-3.0-or-later' })
	const attributed = { passes: { image: { source: `${header}void mainImage() {}` } } }
	for (const id of lic.REMOVED_SHADER_IDS) assert.equal(lic.isRetiredShader(id, attributed), true, `${id} never comes back`)
	for (const id of lic.OPT_IN_SHADER_IDS) {
		assert.equal(lic.isRetiredShader(id, { passes: { image: { source: 'void mainImage() {}' } } }), true, id)
		assert.equal(lic.isRetiredShader(id, attributed), false, `${id}: the header is the opt-in`)
	}
	const frag = { dialect: 'fragcoord', source: { author: 'a', url: 'https://x', license: 'CC0' } }
	assert.equal(lic.isRetiredShader('sh-mario', frag), true)
})
