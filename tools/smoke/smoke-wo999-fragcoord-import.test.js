'use strict'

/**
 * WO-999 step 3 smoke — FragCoord import and library shape: link → slug, the shader markdown → passes and attribution,
 * the license gate (none refused, NC only on request), golf passes converted through FragCoord's converter (a fake fetch
 * here — no network), the store's `dialect: 'fragcoord'` branch (no Caspar template), and the route / web wiring.
 * Pure functions only: nothing is written to the live library (data/shaders).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const imp = require('../../src/shaderfx/fragcoord-import')
const { normalizeShaderConfig, isValidShaderId } = require('../../src/shaderfx/shader-store')

const REPO = path.join(__dirname, '../..')
const src = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')

/** A page in FragCoord's markdown layout (synthetic code). */
function page({ title = 'Test Bars', license = '[MIT](https://opensource.org/licenses/MIT)', main = 'void main() { fragColor = vec4(1.0); }', common = 'uniform sampler2D u_audio;', aux = [], tags = '2d, audio' } = {}) {
	return [
		`# ${title}`,
		'',
		`**Author:** [@someone](https://fragcoord.xyz/u/someone) · **License:** ${license} · **Tags:** ${tags}`,
		'',
		'- Live shader: https://fragcoord.xyz/s/abc12345',
		'',
		'## Source',
		'',
		'### Common (common)',
		'',
		'```glsl',
		common,
		'```',
		'',
		'### Main (main)',
		'',
		'```glsl',
		main,
		'```',
		...aux.flatMap(([label, code]) => ['', `### ${label} (pass)`, '', '```glsl', code, '```']),
		'',
	].join('\n')
}

/** fetch stand-in for the MCP server: get_shader → `md`, convert_shader → a marked conversion. */
function fakeFetch(md, calls = []) {
	return async (url, init) => {
		const body = JSON.parse(init.body)
		calls.push(body.params.name)
		const text = body.params.name === 'get_shader' ? md : '```glsl\nvoid main() { fragColor = vec4(0.5); } // converted\n```'
		return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } }) }
	}
}

describe('WO-999 FragCoord links and pages', () => {
	it('slugs from share, embed, .md links and bare slugs; other URLs are not FragCoord', () => {
		assert.equal(imp.fragcoordSlugFromInput('https://fragcoord.xyz/s/ao6dc217'), 'ao6dc217')
		assert.equal(imp.fragcoordSlugFromInput('https://fragcoord.xyz/s/ao6dc217.md'), 'ao6dc217')
		assert.equal(imp.fragcoordSlugFromInput('https://fragcoord.xyz/embed/ao6dc217?x=1'), 'ao6dc217')
		assert.equal(imp.fragcoordSlugFromInput(' ao6dc217 '), 'ao6dc217')
		assert.equal(imp.fragcoordSlugFromInput('https://www.shadertoy.com/view/lldcR8'), null)
		assert.equal(imp.fragcoordSlugFromInput(''), null)
		assert.equal(imp.isFragcoordInput('https://fragcoord.xyz/s/x'), true)
		assert.equal(imp.isFragcoordInput('https://www.shadertoy.com/view/lldcR8'), false)
	})

	it('parses title, attribution, license, tags and passes in order', () => {
		const p = imp.parseFragcoordMarkdown(page({ aux: [['Buffer A', 'void main() { fragColor = vec4(0.1); }'], ['pass2', 'void main() {}']] }))
		assert.equal(p.title, 'Test Bars')
		assert.equal(p.author, 'someone')
		assert.equal(p.authorUrl, 'https://fragcoord.xyz/u/someone')
		assert.equal(p.license, 'MIT')
		assert.equal(p.licenseUrl, 'https://opensource.org/licenses/MIT')
		assert.deepEqual(p.tags, ['2d', 'audio'])
		assert.equal(p.url, 'https://fragcoord.xyz/s/abc12345')
		assert.equal(p.common, 'uniform sampler2D u_audio;')
		assert.match(p.main, /fragColor = vec4\(1\.0\)/)
		assert.deepEqual(p.aux.map((a) => a.label), ['Buffer A', 'pass2'], 'aux passes in page order = u_pass1, u_pass2')
		assert.equal(p.hidden, false)
		assert.equal(imp.parseFragcoordMarkdown('# Paid\n\n**Author:** x · **License:** MIT\n').hidden, true, 'no Source section')
	})

	it('classifies licenses', () => {
		assert.equal(imp.classifyLicense('none specified (all rights reserved)').kind, 'none')
		assert.equal(imp.classifyLicense('').kind, 'none')
		assert.equal(imp.classifyLicense('CC BY-NC-SA 4.0').kind, 'nc')
		assert.equal(imp.classifyLicense('CC BY-NC-SA 4.0').shareAlike, true)
		assert.equal(imp.classifyLicense('CC BY-NC 4.0').kind, 'nc')
		assert.equal(imp.classifyLicense('CC0 1.0 (Public Domain)').kind, 'open')
		assert.equal(imp.classifyLicense('MIT').kind, 'open')
		assert.equal(imp.classifyLicense('CC BY 4.0').shareAlike, false)
		assert.equal(imp.classifyLicense('GPL-3.0-only').shareAlike, true)
	})

	it('tells golf from GLSL', () => {
		assert.equal(imp.looksGolf('f z, d\n@(40)\n{ z += 1 }'), true)
		assert.equal(imp.looksGolf('uniform f2 R\nuniform f T'), true, 'golf-typed uniforms in Common')
		assert.equal(imp.looksGolf('void main() { vec3 p = vec3(0.0); fragColor = vec4(p, 1.0); }'), false)
		assert.equal(imp.looksGolf('uniform vec2 u_resolution;\nuniform sampler2D u_main;'), false)
		assert.equal(imp.looksGolf(''), false)
		assert.equal(imp.looksGolf('uniform vec2 u_resolution;\nuniform float u_time;', ['golf']), false, 'a golf tag alone is not golf')
	})

	it('ids stay inside the store rules', () => {
		const id = imp.fragcoordShaderId('ao6dc217', 'Audio Equalizer Demo — extra long title words that go on and on')
		assert.ok(isValidShaderId(id), id)
		assert.ok(id.startsWith('sh-fc-ao6dc217-audio-equalizer-demo'))
		assert.equal(imp.fragcoordShaderId('ao6dc217', '!!!'), 'sh-fc-ao6dc217')
	})
})

describe('WO-999 import (fake fetch, no network)', () => {
	it('an open license imports with attribution; nothing converted for GLSL', async () => {
		const calls = []
		const cfg = await imp.importFragcoordShader('https://fragcoord.xyz/s/abc12345', { fetchImpl: fakeFetch(page({ aux: [['pass1', 'void main() {}']] }), calls) })
		assert.deepEqual(calls, ['get_shader'])
		assert.equal(cfg.dialect, 'fragcoord')
		assert.deepEqual(Object.keys(cfg.passes), ['main', 'pass1'])
		assert.equal(cfg.source.license, 'MIT')
		assert.equal(cfg.source.author, 'someone')
		assert.equal(cfg.source.licenseKind, 'open')
		assert.equal(cfg.source.golf, undefined)
	})

	it('"none" is refused with the link to the shader', async () => {
		await assert.rejects(
			imp.importFragcoordShader('abc12345', { fetchImpl: fakeFetch(page({ license: 'none specified (all rights reserved)' })) }),
			/no license \(all rights reserved\).*https:\/\/fragcoord\.xyz\/s\/abc12345/,
		)
	})

	it('NC needs allowNonCommercial', async () => {
		const md = page({ license: '[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)' })
		await assert.rejects(imp.importFragcoordShader('abc12345', { fetchImpl: fakeFetch(md) }), /non-commercial use only/)
		const cfg = await imp.importFragcoordShader('abc12345', { fetchImpl: fakeFetch(md), allowNonCommercial: true })
		assert.equal(cfg.licenseKind, 'nc')
		assert.equal(cfg.shareAlike, true)
	})

	it('golf passes go through convert_shader; the original is kept', async () => {
		const calls = []
		const golf = 'f z\n@(4) { z += 1 }\nO = f4(z)'
		const cfg = await imp.importFragcoordShader('abc12345', { fetchImpl: fakeFetch(page({ main: golf, common: 'uniform f2 R', tags: 'golf' }), calls) })
		assert.deepEqual(calls, ['get_shader', 'convert_shader', 'convert_shader'], 'common and main')
		assert.match(cfg.passes.main.source, /\/\/ converted/)
		assert.equal(cfg.source.golf.main, golf)
		assert.equal(cfg.source.golf.common, 'uniform f2 R')
	})

	it("converted Common loses the converter's empty main(), and only an empty one", () => {
		const conv = 'uniform vec2 u_resolution;\n\nvoid main() {\n    // SPDX-License-Identifier: MIT\n    /* c */\n}\n'
		assert.equal(imp.stripEmptyMain(conv).includes('main'), false)
		assert.match(imp.stripEmptyMain('void main() { fragColor = vec4(1.0); }'), /void main\(\) \{ fragColor/)
	})

	it('a page without source is refused', async () => {
		await assert.rejects(imp.importFragcoordShader('abc12345', { fetchImpl: fakeFetch('# Paid\n\n**Author:** x · **License:** MIT\n') }), /no public source/)
	})
})

describe('WO-999 library shape', () => {
	it('normalizes main + pass1..8, formats, values and provenance; audio follows u_audio', () => {
		const cfg = normalizeShaderConfig({
			name: 'FC test',
			dialect: 'fragcoord',
			common: 'uniform sampler2D u_audio;',
			passes: { main: { source: 'void main(){}', format: 'rgba16f' }, pass2: { source: 'void main(){}', format: 'bogus' }, pass9: { source: 'x' }, image: { source: 'x' } },
			values: { u_speed: 2, u_tint: [1, 0.5, 0.2], 'bad key': 1, u_s: 'x' },
			source: { site: 'fragcoord', slug: 'abc12345', license: 'MIT', licenseKind: 'weird', golf: { main: 'f z' } },
		})
		assert.equal(cfg.dialect, 'fragcoord')
		assert.deepEqual(Object.keys(cfg.passes), ['main', 'pass1', 'pass2', 'pass3', 'pass4', 'pass5', 'pass6', 'pass7', 'pass8'])
		assert.deepEqual(cfg.passes.main, { source: 'void main(){}', format: 'rgba16f' })
		assert.deepEqual(cfg.passes.pass2, { source: 'void main(){}' }, 'unknown format dropped')
		assert.equal(cfg.passes.pass1, null)
		assert.deepEqual(cfg.values, { u_speed: 2, u_tint: [1, 0.5, 0.2] })
		assert.equal(cfg.source.licenseKind, 'none', 'unknown kinds read as none')
		assert.deepEqual(cfg.source.golf, { main: 'f z' })
		assert.equal(cfg.audio.enabled, true, 'names u_audio')
		assert.throws(() => normalizeShaderConfig({ name: 'x', dialect: 'fragcoord', passes: {} }), /main pass source is required/)
		const shadertoy = normalizeShaderConfig({ name: 'st', passes: { image: { source: 'void mainImage(out vec4 o, in vec2 c){}' } } })
		assert.equal(shadertoy.dialect, undefined, 'Shadertoy configs keep their shape')
	})

	it('the store skips the Caspar template for fragcoord, in save and reconcile', () => {
		const s = src('src/shaderfx/shader-store.js')
		assert.match(s, /if \(config\.dialect === 'fragcoord'\) return \{ config, casparPath: null \}/)
		assert.match(s, /if \(raw\?\.dialect === 'fragcoord'\) continue/)
		assert.match(s, /dialect: 'fragcoord', license: raw\.source\?\.license/)
	})

	it('the import route sends FragCoord links to the importer and saves; the web modal reports it', () => {
		const r = src('src/api/routes-shaders.js')
		assert.match(r, /if \(isFragcoordInput\(b\.url \|\| b\.link\)\) return await importFragcoord\(b, ctx\)/)
		assert.match(r, /allowNonCommercial: b\.allowNonCommercial === true/)
		assert.match(r, /const saved = await store\.saveShader\(config\)/)
		assert.match(src('client/components/shader-fx-modal.js'), /if \(r\.saved\) \{/)
	})
})
