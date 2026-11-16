'use strict'

/**
 * WO-1096 — the shader library ships only shaders with a known, redistributable licence and an attribution header,
 * and template/shaders/LICENSES/manifest.json records every one of them.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const TPL = path.join(ROOT, 'template', 'shaders')
const lic = require('../../src/shaderfx/shader-licence')
const { buildManifest, configFromHtml, MANIFEST_REL } = require('../shaders/shader-licence-manifest')
const { shadertoyConfigFromApiJson } = require('../../src/shaderfx/shadertoy-import')

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST_REL), 'utf8'))
const htmlFiles = fs.readdirSync(TPL).filter((f) => f.endsWith('.html'))

test('every template/shaders/*.html has exactly one manifest row, and every row has its file', () => {
	assert.ok(htmlFiles.length > 100, 'library present')
	const rows = new Map(manifest.templates.map((e) => [e.file, e]))
	assert.equal(rows.size, manifest.templates.length, 'no duplicate rows')
	for (const f of htmlFiles) assert.ok(rows.has(`template/shaders/${f}`), `${f} has no manifest entry`)
	for (const e of manifest.templates) assert.ok(fs.existsSync(path.join(ROOT, e.file)), `${e.file} listed but missing`)
})

test('every manifest licence is known and redistributable; author and source are present', () => {
	for (const e of [...manifest.templates, ...manifest.boxLibrary]) {
		assert.ok(e.licence && lic.LICENCES[e.licence], `${e.file}: unknown licence "${e.licence}"`)
		assert.doesNotMatch(String(e.licenceLine), lic.FORBIDDEN_RE, `${e.file}: forbidden licence line`)
		assert.ok(e.author && e.source, `${e.file}: attribution (author + source) missing`)
	}
	assert.equal(manifest.counts.UNKNOWN, undefined, 'no UNKNOWN licence bucket')
})

test('every shipped template starts with a parseable attribution header naming a known licence', () => {
	for (const f of htmlFiles) {
		const cfg = configFromHtml(fs.readFileSync(path.join(TPL, f), 'utf8'))
		assert.ok(cfg, `${f}: no embedded config`)
		const h = lic.parseShaderHeader(cfg.passes.image.source)
		assert.ok(h, `${f}: image pass has no attribution header`)
		assert.ok(h.licence, `${f}: licence line "${h.licenceLine}" names no known licence`)
	}
})

test('the committed manifest is what the generator builds from the templates (not stale)', () => {
	const { manifest: fresh, problems } = buildManifest({ previous: manifest })
	assert.deepEqual(problems, [])
	assert.deepEqual(fresh.templates, manifest.templates, 'run node tools/shaders/shader-licence-manifest.js --write')
})

test('retired shaders are gone from the tree, listed in opt-in.json, and hidden until attributed', () => {
	const optIn = JSON.parse(fs.readFileSync(path.join(TPL, 'LICENSES', 'opt-in.json'), 'utf8'))
	const listed = [...optIn.optIn, ...optIn.removed].map((e) => e.id).sort()
	assert.deepEqual(listed, [...lic.RETIRED_SHADER_IDS].sort())
	for (const id of lic.RETIRED_SHADER_IDS)
		assert.ok(!fs.existsSync(path.join(TPL, `${id}.html`)), `${id}.html still shipped`)
	const bare = { name: 'x', passes: { image: { source: 'void mainImage(out vec4 o, vec2 f){o=vec4(1);}' } } }
	assert.equal(lic.isRetiredShader('sh-blue-thunder', bare), true)
	const hdr = lic.buildShaderHeader({
		title: 'Blue Thunder',
		author: 'Owner',
		url: 'https://example.org',
		licence: 'AGPL-3.0-or-later',
	})
	const attributed = { ...bare, passes: { image: { source: hdr + bare.passes.image.source } } }
	assert.equal(lic.isRetiredShader('sh-blue-thunder', attributed), false, 'a valid header is the opt-in')
	assert.equal(lic.isRetiredShader('sh-wavy', bare), false, 'only listed ids are retired')
})

test('the shader store neither re-exports nor lists a retired config without a header', async () => {
	const { store, cleanup } = require('./lib/shader-store-tmp').loadShaderStoreInTempRoot()
	try {
		const cfg = {
			id: 'sh-mario',
			name: 'mario',
			common: '',
			passes: { image: { source: 'void mainImage(out vec4 o, vec2 f){o=vec4(1);}', channels: [] } },
			audio: { enabled: false },
			opts: { alpha: false },
		}
		fs.writeFileSync(path.join(store.SHADERS_DATA_DIR, 'sh-mario.json'), JSON.stringify(cfg))
		const list = await store.listShaders()
		assert.ok(list.length > 100, 'library still lists')
		assert.ok(!list.some((s) => s.id === 'sh-mario'), 'retired shader hidden')
		assert.ok(!fs.existsSync(path.join(store.SHADERS_TEMPLATE_DIR, 'sh-mario.html')), 'retired shader not re-exported')
	} finally {
		cleanup()
	}
})

test('the Shadertoy link import writes the attribution header (stated licence, else Shadertoy default)', () => {
	const api = (code) => ({
		Shader: {
			info: { id: 'lldcR8', name: 'Example', username: 'someone' },
			renderpass: [{ type: 'image', code, inputs: [] }],
		},
	})
	const plain = shadertoyConfigFromApiJson(api('void mainImage(out vec4 o, vec2 f){o=vec4(1);}'))
	const h = lic.parseShaderHeader(plain.passes.image.source)
	assert.equal(h.author, 'someone')
	assert.equal(h.url, 'https://www.shadertoy.com/view/lldcR8')
	assert.equal(h.licence, 'CC-BY-NC-SA-3.0')
	assert.match(h.licenceLine, /Shadertoy default licence/)
	const mit = shadertoyConfigFromApiJson(api('// License: MIT\nvoid mainImage(out vec4 o, vec2 f){o=vec4(1);}'))
	assert.equal(lic.parseShaderHeader(mit.passes.image.source).licence, 'MIT')
	const arr = shadertoyConfigFromApiJson(api('// All rights reserved\nvoid mainImage(out vec4 o, vec2 f){o=vec4(1);}'))
	assert.equal(lic.parseShaderHeader(arr.passes.image.source), null, 'no header invented for "All rights reserved"')
	assert.ok(
		arr.skipped.some((s) => /All rights reserved/.test(s)),
		'the refusal is reported'
	)
})

test('the store and the README name the licence split (third-party, not AGPL)', () => {
	const readme = fs.readFileSync(path.join(TPL, 'LICENSES', 'README.md'), 'utf8')
	assert.match(readme, /NOT covered by HighAsCG's AGPL-3\.0-or-later/)
	assert.match(readme, /ShaderToyLite\.js`: vendored renderer, \*\*BSD-3-Clause\*\*/)
	const store = fs.readFileSync(path.join(ROOT, 'src/shaderfx/shader-store.js'), 'utf8')
	assert.equal((store.match(/isRetiredShader\(/g) || []).length, 3, 'reconcile (both directions) + listShaders')
})
