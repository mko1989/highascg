'use strict'

/**
 * WO-1106 B67 — NonCommercial shaders do not ship (owner 17.11.26: "Don't ship them"; HighAsCG is used at paid shows).
 *
 *   - no file under template/shaders (tracked or present) belongs to a withdrawn NC id;
 *   - every template there passes the store's own rule (tools/shaders/check-shipped-templates.js) — not NC, not retired;
 *   - LICENSES/withdrawn-nc.json is the licence-derived record (169 rows, every one -NC, attributed), and the manifest
 *     records only shippable shaders (an NC row is a manifest problem);
 *   - the shipped set is pinned (14 ids).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..', '..')
const TPL = path.join(ROOT, 'template', 'shaders')
const lic = require('../../src/shaderfx/shader-licence')
const { problemsOf, MANIFEST_REL } = require('../shaders/shader-licence-manifest')
const { unshippableReason, htmlFilesUnder } = require('../shaders/check-shipped-templates')

const record = JSON.parse(fs.readFileSync(lic.WITHDRAWN_NC_FILE, 'utf8'))
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST_REL), 'utf8'))

const SHIPPED = [
	'sh-bg-anya-s-rose',
	'sh-bg-perlin-noise-fire',
	'sh-fft-test',
	'sh-sa-attempt-at-vdj-effects',
	'sh-sa-ictalurus-forest',
	'sh-sa-mind-flowers',
	'sh-sa-mind-flowers-2',
	'sh-sa-more-glow-experiments',
	'sh-sa-moving-without-travelling',
	'sh-sa-sound-oscilloscope-from-spectrum',
	'sh-sa-synthwave-canyon',
	'sh-sa-tribute-to-my-old-atari',
	'sh-sa-truchet-kaleidoscope-ftw',
	'sh-triangle',
]

/** Files under template/shaders: git's index (that still exist — a staged-to-be deletion is gone) plus the folder. */
function trackedShaderFiles() {
	const out = new Set()
	const git = spawnSync('git', ['ls-files', '-z', '--', 'template/shaders'], { cwd: ROOT, encoding: 'utf8' })
	if (git.status === 0) for (const f of git.stdout.split('\0')) if (f && fs.existsSync(path.join(ROOT, f))) out.add(f)
	const walk = (d) => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name)
			if (e.isDirectory()) walk(p)
			else out.add(path.relative(ROOT, p))
		}
	}
	walk(TPL)
	return [...out]
}

test('B67: the withdrawn record is licence-derived — 169 rows, every one NonCommercial and attributed', () => {
	assert.equal(record.withdrawn.length, 169)
	const ids = record.withdrawn.map((e) => e.id)
	assert.equal(new Set(ids).size, ids.length, 'no duplicate ids')
	for (const e of record.withdrawn) {
		assert.ok(lic.isNonCommercialLicence(e.licence), `${e.id}: ${e.licence} is not an NC licence`)
		assert.ok(lic.LICENCES[e.licence], `${e.id}: unknown licence ${e.licence}`)
		assert.ok(e.author && e.source && e.title, `${e.id}: who / where kept`)
	}
	assert.equal(lic.WITHDRAWN_NC_SHADERS.size, 169, 'shader-licence.js reads the record')
	for (const id of [...lic.REMOVED_SHADER_IDS, ...lic.OPT_IN_SHADER_IDS])
		assert.ok(!lic.WITHDRAWN_NC_SHADERS.has(id), `${id} stays in opt-in.json`)
})

test('B67: no file under template/shaders belongs to a withdrawn or retired id', () => {
	const files = trackedShaderFiles()
	assert.ok(files.length > 0)
	const ids = (f) => path.basename(f).replace(/\.[^.]+$/, '')
	for (const f of files) {
		assert.ok(!lic.WITHDRAWN_NC_SHADERS.has(ids(f)), `${f}: withdrawn NonCommercial shader is tracked`)
		assert.ok(!lic.RETIRED_SHADER_IDS.has(ids(f)), `${f}: retired shader is tracked`)
	}
	for (const e of record.withdrawn) assert.ok(!fs.existsSync(path.join(TPL, `${e.id}.html`)), `${e.id}.html present`)
})

test('B67: every template in the folder passes the store rule (header licence, not a helper snippet)', () => {
	const html = htmlFilesUnder(TPL)
	assert.deepEqual(html.map((f) => path.basename(f, '.html')).sort(), [...SHIPPED].sort(), 'the shipped set')
	for (const f of html) assert.equal(unshippableReason(f), null, path.basename(f))
	// sh-triangle carries a "License: MIT OR CC-BY-NC-4.0" helper snippet below a CC0 header — it still ships
	assert.match(fs.readFileSync(path.join(TPL, 'sh-triangle.html'), 'utf8'), /License: MIT OR CC-BY-NC/)
	const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/shaders/check-shipped-templates.js'), TPL], { encoding: 'utf8' })
	assert.equal(r.status, 0, r.stdout + r.stderr)
})

test('B67: the manifest records only shippable shaders, and an NC row is a problem', () => {
	assert.equal(manifest.templates.length, SHIPPED.length)
	for (const e of [...manifest.templates, ...manifest.boxLibrary]) {
		assert.equal(e.nonCommercial, false, e.file)
		assert.deepEqual(problemsOf(e), [], e.file)
	}
	for (const k of Object.keys(manifest.counts)) assert.equal(lic.isNonCommercialLicence(k), false, `count bucket ${k}`)
	const nc = { ...manifest.templates[0], id: 'sh-new', file: 'template/shaders/sh-new.html', licence: 'CC-BY-NC-SA-4.0' }
	assert.ok(problemsOf(nc).some((p) => /non-commercial licence CC-BY-NC-SA-4\.0: not shippable/.test(p)))
	const withdrawn = { ...manifest.templates[0], id: 'sh-sa-ribbons', licence: 'CC0-1.0' }
	assert.ok(problemsOf(withdrawn).some((p) => /withdrawn/.test(p)), 'a withdrawn id with a new header still fails')
})

test('B67: the licence rule — -NC ids, withdrawn ids and their Shader Live children, FragCoord nc imports', () => {
	for (const l of ['CC-BY-NC-SA-3.0', 'CC-BY-NC-SA-4.0', 'CC-BY-NC-4.0']) assert.equal(lic.isNonCommercialLicence(l), true, l)
	for (const l of ['CC0-1.0', 'MIT', 'CC-BY-3.0', 'CC-BY-4.0', 'AGPL-3.0-or-later', null]) assert.equal(lic.isNonCommercialLicence(l), false, String(l))
	const bare = { passes: { image: { source: 'void mainImage(out vec4 o, in vec2 f) { o = vec4(1.0); }' } } }
	assert.equal(lic.nonCommercialLicenceOf('sh-sa-ribbons', bare), 'CC-BY-NC-SA-3.0', 'withdrawn by id, header or not')
	assert.equal(lic.nonCommercialLicenceOf('sh-sa-ribbons-c2', { ...bare, parentId: 'sh-sa-ribbons' }), 'CC-BY-NC-SA-3.0', 'a child')
	const hdr = lic.buildShaderHeader({ title: 't', author: 'a', url: 'https://www.shadertoy.com/view/x', licence: 'CC-BY-NC-4.0' })
	const own = { passes: { image: { source: hdr + bare.passes.image.source } } }
	assert.equal(lic.nonCommercialLicenceOf('sh-my-import', own), 'CC-BY-NC-4.0', 'any id, by its header')
	assert.equal(lic.nonCommercialLicenceOf('sh-triangle', bare), null)
	const fc = { dialect: 'fragcoord', source: { author: 'a', url: 'https://fragcoord.xyz/s/x', license: 'CC BY-NC-SA 4.0', licenseKind: 'nc' } }
	assert.equal(lic.nonCommercialLicenceOf('sh-fc-x', fc), 'CC-BY-NC-SA-4.0')
	assert.equal(lic.isShippableShader('sh-triangle', bare), true)
	assert.equal(lic.isShippableShader('sh-sa-ribbons', bare), false)
	assert.equal(lic.isShippableShader('sh-mario', bare), false, 'removed ids stay out')
})
