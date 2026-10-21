'use strict'

/**
 * WO-598 B (JS side) — the web client's exportProject∘importProject. Two clients edit the same show; the server
 * compares JSON.stringify output (projectContentEquals), so a web load + autosave must hand back the same
 * document: same values, same key order. The fixture is a real show shape (media names anonymised) already
 * passed through the web export once; the Godot test_project_roundtrip.gd reads the same directory.
 * Known one-way normalisations (not losses): WO-160 renumbers look layers from 10; the flat legacy
 * `scenes.previewSceneId` is rewritten from previewSceneIdByMain; a legacy single `pipOverlay` becomes
 * `pipOverlays[]`; absent slices come back as their defaults. Look-level keys are a whitelist (migrateScene,
 * WO-572): a new look field must be added there or a web load drops it — the Godot client writes none today.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '../..')
const FIXTURES = path.join(ROOT, 'tools/fixtures/projects')
const SLICES = ['scenes', 'programOutput', 'timelines', 'multiview', 'placeholders']

/* Just enough browser for the state modules (no DOM is touched on import / export). */
function browserStubs() {
	const mem = new Map()
	globalThis.fetch = async () => ({ ok: false, status: 0, json: async () => ({}) })
	globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
	globalThis.window = globalThis
	globalThis.document = { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {} }), querySelector: () => null }
	globalThis.CustomEvent = class {
		constructor(type, o) {
			this.type = type
			this.detail = o?.detail
		}
	}
	globalThis.addEventListener = () => {}
	globalThis.dispatchEvent = () => {}
}

let web
async function webClient() {
	if (web) return web
	browserStubs()
	const quiet = console.log
	const quietWarn = console.warn
	const quietErr = console.error
	console.log = console.warn = console.error = () => {}
	try {
		const m = (p) => import(path.join(ROOT, 'client/lib', p))
		const { sceneState } = await m('scene-state.js')
		const { timelineState } = await m('timeline-state.js')
		const { multiviewState } = await m('multiview-state.js')
		const { programOutputState } = await m('program-output-state.js')
		const { placeholderState } = await m('placeholder-state.js')
		globalThis.placeholderState = placeholderState
		const { projectState } = await m('project-state.js')
		const roundtrip = (doc) => {
			projectState.importProject(JSON.parse(JSON.stringify(doc)), sceneState, timelineState, multiviewState, programOutputState, { silent: true })
			return projectState.exportProject(sceneState, timelineState, multiviewState, programOutputState)
		}
		web = { roundtrip: (doc) => withQuiet(() => roundtrip(doc)) }
	} finally {
		console.log = quiet
		console.warn = quietWarn
		console.error = quietErr
	}
	return web
}

function withQuiet(fn) {
	const saved = [console.log, console.warn, console.error]
	console.log = console.warn = console.error = () => {}
	try {
		return fn()
	} finally {
		;[console.log, console.warn, console.error] = saved
	}
}

/** Input leaves that the round trip changed or dropped: `path: before -> after`. */
function changedLeaves(a, b, p, out = []) {
	if (a && typeof a === 'object') {
		if (!b || typeof b !== 'object') out.push(`${p} (gone)`)
		else for (const k of Object.keys(a)) changedLeaves(a[k], b[k], `${p}.${k}`, out)
	} else if (a !== b && !(a == null && b == null)) out.push(`${p}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`)
	return out
}

const load = (f) => JSON.parse(fs.readFileSync(path.join(FIXTURES, f), 'utf8'))

test('the real-show fixture is a fixed point: web import → export is byte-identical per slice (values + key order)', async () => {
	const { roundtrip } = await webClient()
	const doc = load('web-roundtrip-show.json')
	assert.ok(doc.scenes.scenes.length >= 2 && doc.multiview.cells.length >= 3, 'fixture covers looks + multiview cells')
	assert.ok(doc.timelines && doc.programOutput, 'fixture covers timelines + program output')
	const out = roundtrip(doc)
	for (const k of SLICES) assert.equal(JSON.stringify(out[k]), JSON.stringify(doc[k]), `${k} changed on a web load + save`)
	const again = roundtrip(out)
	for (const k of SLICES) assert.equal(JSON.stringify(again[k]), JSON.stringify(out[k]), `${k}: second round trip`)
})

test('every committed fixture: no input leaf is lost; only the documented one-way normalisations differ', async () => {
	const { roundtrip } = await webClient()
	const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json'))
	assert.ok(files.length >= 2)
	for (const f of files) {
		const doc = load(f)
		const out = roundtrip(doc)
		const lost = SLICES.filter((k) => k in doc).flatMap((k) => changedLeaves(doc[k], out[k], k))
		const migratedPip = (s) => {
			const m = /^scenes\.scenes\.(\d+)\.layers\.(\d+)\.pipOverlay \(gone\)$/.exec(s)
			const before = m && doc.scenes.scenes[m[1]].layers[m[2]].pipOverlay
			return !!m && JSON.stringify(out.scenes.scenes[m[1]].layers[m[2]].pipOverlays) === JSON.stringify([before])
		}
		const unexpected = lost.filter((s) => !/\.layers\.\d+\.layerNumber: /.test(s) && !/^scenes\.previewSceneId: /.test(s) && !migratedPip(s))
		assert.deepEqual(unexpected, [], `${f}: round trip changed`)
		const again = roundtrip(out)
		for (const k of SLICES) assert.equal(JSON.stringify(again[k]), JSON.stringify(out[k]), `${f} ${k}: not a fixed point`)
	}
})

test('a layer key the web does not know survives (Godot-only layer fields are not wiped)', async () => {
	const { roundtrip } = await webClient()
	const doc = load('web-roundtrip-show.json')
	doc.scenes.scenes[0].layers[0].godotOnly = { a: 1 }
	const out = roundtrip(doc)
	assert.deepEqual(out.scenes.scenes[0].layers[0].godotOnly, { a: 1 })
	assert.deepEqual(changedLeaves({ a: { b: 1 } }, { a: {} }, '$'), ['$.a.b: 1 -> undefined'], 'the leaf walk reports losses')
})
