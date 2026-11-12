'use strict'
/**
 * WO-1045 — the VU meters lagged because a web client's Media tab fetched /api/project/list + /api/settings on every
 * redraw (~7×/s each), and every list call JSON-parsed every show file on the event loop. Pins both halves.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

test('head cache: a show file is parsed again only when it changes', () => {
	const { readProjectHead, _headCache } = require(path.join(ROOT, 'src', 'engine', 'project-head-cache'))
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1045-'))
	const p = path.join(dir, 'a.json')
	fs.writeFileSync(p, JSON.stringify({ name: 'A', savedAt: '1' }))
	const origParse = JSON.parse
	let parses = 0
	JSON.parse = (...a) => (parses++, origParse(...a))
	try {
		const h1 = readProjectHead(p, fs.statSync(p))
		const h2 = readProjectHead(p, fs.statSync(p))
		assert.equal(h1.name, 'A')
		assert.strictEqual(h2, h1)
		assert.equal(parses, 1, 'unchanged file served from the cache')
		fs.writeFileSync(p, JSON.stringify({ name: 'Bee', savedAt: '2' }))
		const h3 = readProjectHead(p, fs.statSync(p))
		assert.equal(h3.name, 'Bee')
		assert.equal(parses, 2, 'a changed file (size/mtime) is parsed again')
		assert.equal(readProjectHead(p, null).name, 'Bee')
		assert.equal(parses, 3, 'no stat → no cache')
	} finally {
		JSON.parse = origParse
		_headCache.clear()
		fs.rmSync(dir, { recursive: true, force: true })
	}
	fs.mkdirSync(dir)
	const bad = path.join(dir, 'bad.json')
	fs.writeFileSync(bad, '{nope')
	assert.throws(() => readProjectHead(bad, fs.statSync(bad)), 'corrupt files still throw (scanProjectsDir quarantines them)')
	fs.rmSync(dir, { recursive: true, force: true })
})

test('scanProjectsDir reads heads through the cache', () => {
	const src = read('src/engine/project-volume-sync.js')
	assert.match(src, /project = readProjectHead\(p, st\)/)
	assert.doesNotMatch(src, /project = JSON\.parse\(fs\.readFileSync\(p/)
})

test('web Sources render never fetches the project list', () => {
	const render = read('client/components/sources-panel-render.js')
	assert.match(render, /void refreshProjectMediaBar\(\{ fetch: false \}\)/)
	assert.doesNotMatch(render, /refreshProjectMediaBar\(\)/)
	const gather = read('client/components/sources-panel-project-gather.js')
	assert.match(gather, /opts\.fetch === false \? getProjectMediaContext\(\) : await refreshProjectMediaContext\(\)/)
})
