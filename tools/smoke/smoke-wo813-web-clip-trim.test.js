'use strict'

/**
 * WO-813 (owner 29.10, "add to web client as cmd or something click as i guess right clicks doesnt work in a web gui")
 * — the web inspector's compact Trim row (client/components/inspector-clip-trim.js + client/lib/clip-trim-model.js):
 * folded by default, Ctrl / Cmd+click on Trim in / Trim out and the ↺ beside each point reset it to the clip's start /
 * end through the same reset (null = no trim), a plain click sets the slider position, and the start drop-down has no
 * "Custom". The component runs here against a minimal fake DOM (no jsdom in this repo).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

class FakeNode {
	constructor(tag) {
		this.tagName = tag
		this.children = []
		this.dataset = {}
		this.listeners = {}
		this.attrs = {}
		this.style = {}
		this.hidden = false
		this.value = ''
	}
	append(...c) {
		this.children.push(...c)
	}
	appendChild(c) {
		this.children.push(c)
		return c
	}
	addEventListener(k, f) {
		;(this.listeners[k] ||= []).push(f)
	}
	setAttribute(k, v) {
		this.attrs[k] = v
	}
	select() {}
	blur() {}
	remove() {}
	fire(k, e = {}) {
		for (const f of this.listeners[k] || []) f({ button: 0, preventDefault() {}, ...e })
	}
	find(pred) {
		if (pred(this)) return this
		for (const c of this.children) {
			const hit = c instanceof FakeNode ? c.find(pred) : null
			if (hit) return hit
		}
		return null
	}
}

/** Every request the client modules make: offline here. A layer-scrub answers "not on PRV" like the server. */
const requests = []
function installFakeDom() {
	globalThis.document = {
		createElement: (t) => new FakeNode(t),
		body: { contains: () => true, appendChild: (c) => c, removeChild: (c) => c },
		activeElement: null,
		addEventListener() {},
		removeEventListener() {},
		dispatchEvent() {},
		querySelector: () => null,
		querySelectorAll: () => [],
		getElementById: () => null,
		documentElement: { style: {} },
	}
	globalThis.fetch = async (url, init) => {
		requests.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null })
		const scrub = String(url).endsWith('/api/scene/layer-scrub')
		return {
			ok: scrub,
			status: scrub ? 200 : 503,
			statusText: 'offline (test)',
			headers: { get: () => 'application/json' },
			json: async () => (scrub ? { ok: true, onPrv: false, reason: 'not_on_prv' } : {}),
		}
	}
	globalThis.window = globalThis
	globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
	globalThis.CustomEvent = class {
		constructor(type, init) {
			this.type = type
			this.detail = init?.detail
		}
	}
}
installFakeDom() // before any client module loads (they read settings at import)

/** Renders the section for a 10 s clip @ 25 fps and returns its parts plus the patches it sent. */
async function render(layerFields = {}, sceneId = 'look-a') {
	const { _setMediaForTest } = await import('../../client/lib/media-duration.js')
	_setMediaForTest([{ id: 'CLIP', durationMs: 10000, fps: 25, codec: 'h264' }])
	const { appendClipTrimSection } = await import('../../client/components/inspector-clip-trim.js')
	const layer = { layerNumber: 10, source: { type: 'media', value: 'CLIP' }, ...layerFields }
	const patches = []
	const sceneState = {
		getScene: () => ({ id: sceneId, layers: [layer] }),
		patchLayer: (_s, _i, p) => {
			patches.push(p)
			Object.assign(layer, p)
		},
	}
	const parent = new FakeNode('div')
	appendClipTrimSection(parent, {
		sceneId,
		layerIndex: 0,
		layer,
		scene: { id: sceneId, layers: [layer] },
		sceneState,
		stateStore: { getState: () => ({ media: [{ id: 'CLIP', fps: 25 }] }) },
		isClip: true,
	})
	const q = (pred) => parent.find(pred)
	return {
		patches,
		layer,
		toggle: q((n) => n.className === 'inspector-clip-trim__toggle'),
		body: q((n) => n.className === 'inspector-clip-trim__body'),
		summary: q((n) => n.className === 'inspector-clip-trim__summary'),
		slider: q((n) => n.className === 'inspector-clip-trim__slider'),
		set: (w) => q((n) => n.dataset.trimSet === w),
		reset: (w) => q((n) => n.dataset.trimReset === w),
	}
}

test('model: Ctrl / Cmd+click is a reset, a plain click is not', async () => {
	const T = await import('../../client/lib/clip-trim-model.js')
	assert.equal(T.isResetClick({ button: 0, ctrlKey: true }), true, 'Ctrl+click')
	assert.equal(T.isResetClick({ button: 0, metaKey: true }), true, 'Cmd+click (macOS)')
	assert.equal(T.isResetClick({ button: 0 }), false, 'plain click sets the point')
	assert.equal(T.isResetClick({ button: 1, ctrlKey: true }), false, 'middle button')
	assert.equal(T.isResetClick(null), false)
	assert.deepEqual(T.resetIn({ trimInMs: 2000, trimOutMs: 6000 }, 25).patch, { trimInMs: null })
	assert.deepEqual(T.resetIn({ trimInMs: 2000, trimOutMs: 0 }, 25).patch, { trimInMs: null, trimOutMs: null })
	assert.deepEqual(T.resetOut({ trimInMs: 2000, trimOutMs: 6000 }, 10000, 25).patch, { trimOutMs: null })
	assert.deepEqual(T.resetOut({ trimInMs: 9000, trimOutMs: 9500 }, 8000, 25).patch, { trimOutMs: null, trimInMs: null })
	assert.deepEqual(T.setIn({}, 2019, 10000, 25).patch, { trimInMs: 2000 }, 'in snapped to its frame')
	assert.equal(T.setIn({ trimOutMs: 4000 }, 4000, 10000, 25).ok, false, 'in at the out point refused')
	assert.deepEqual(T.setOut({}, 10000, 10000, 25).patch, { trimOutMs: null }, 'out at the end clears')
	assert.equal(T.parseTc('0:01.12', 25), 1480, 'm:ss.ff — .12 is frames')
	assert.equal(T.parseTc('2*3', 25), 6000, 'maths (RULES.md)')
	assert.ok(Number.isNaN(T.parseTc('abc', 25)))
	assert.equal(T.formatTc(9.36, 25), '0:09.09', 'same timecode as Godot format_timecode')
	assert.equal(T.summary({ trimInMs: 240, trimOutMs: 9360 }, 10000, 25), '0:00.06 – 0:09.09')
	assert.equal(T.summary({}, 10000, 25), 'Full clip')
	assert.deepEqual(
		T.STARTS.map((s) => s[0]),
		['beginning', 'relativeToPrevious'],
		'same two start options as Godot'
	)
})

test('Trim row: folded by default, opens on its header, folds again for another layer', async () => {
	const a = await render({ trimInMs: 240, trimOutMs: 9360 })
	assert.equal(a.body.hidden, true, 'folded by default')
	assert.equal(a.toggle.textContent, '▸ Trim')
	assert.equal(a.summary.textContent, '0:00.06 – 0:09.09')
	a.toggle.fire('click')
	assert.equal(a.body.hidden, false, 'open')
	assert.equal(a.toggle.textContent, '▾ Trim')
	const again = await render({ trimInMs: 240, trimOutMs: 9360 })
	assert.equal(again.body.hidden, false, 'a re-render of the same layer (every patch) keeps it open')
	await render({}, 'look-b')
	const back = await render({ trimInMs: 240, trimOutMs: 9360 })
	assert.equal(back.body.hidden, true, 'another layer shown in between → folded again')
})

test('Ctrl+click on Trim in / Trim out and the ↺ beside it send the same reset; a plain click sets the point', async () => {
	for (const w of ['in', 'out']) {
		const key = w === 'in' ? 'trimInMs' : 'trimOutMs'
		const ctrl = await render({ trimInMs: 2000, trimOutMs: 6000 })
		ctrl.set(w).fire('click', { ctrlKey: true })
		const cmd = await render({ trimInMs: 2000, trimOutMs: 6000 })
		cmd.set(w).fire('click', { metaKey: true })
		const icon = await render({ trimInMs: 2000, trimOutMs: 6000 })
		icon.reset(w).fire('click')
		const right = await render({ trimInMs: 2000, trimOutMs: 6000 })
		right.set(w).fire('contextmenu')
		assert.deepEqual(ctrl.patches, [{ [key]: null }], `Ctrl+click Trim ${w} → null`)
		assert.deepEqual(cmd.patches, ctrl.patches, `Cmd+click Trim ${w} = Ctrl+click`)
		assert.deepEqual(icon.patches, ctrl.patches, `↺ ${w} = Ctrl+click`)
		assert.deepEqual(right.patches, ctrl.patches, `right-click ${w}, where a browser delivers it, = the same`)
		const plain = await render({ trimInMs: 2000, trimOutMs: 6000 })
		plain.slider.value = '3000'
		plain.slider.fire('input')
		plain.set(w).fire('click')
		assert.deepEqual(plain.patches, [{ [key]: 3000 }], `plain click Trim ${w} → the slider position`)
		await new Promise((r) => setTimeout(r, 0))
		const scrubs = requests.filter((q) => q.url.endsWith('/api/scene/layer-scrub'))
		assert.deepEqual(
			scrubs.at(-1)?.body,
			{ sceneId: 'look-a', mainIdx: 0, layerNumber: 10, ms: 3000 },
			'the slider scrubs PRV through layer-scrub (the route the Godot slider uses)'
		)
	}
	const tip = (await render()).set('in').title
	assert.match(tip, /Set In to the slider position\nCtrl\+click or ↺ to reset to the clip's start/)
	assert.match((await render()).reset('out').title, /Ctrl\+click or ↺ to reset to the clip's end/)
})

test('web start drop-down: no Custom; the trim moved from the transport into the Trim row', () => {
	const src = read('client/components/inspector-scene-layer.js')
	assert.doesNotMatch(src, /<option value="custom">|Custom \(trim in/, 'no Custom option')
	assert.match(src, /startSel\.value = layer\.startBehaviour === 'relativeToPrevious' \? 'relativeToPrevious' : 'beginning'/)
	assert.match(src, /appendClipTrimSection\(takeGrp, \{/)
	const tr = read('client/components/inspector-media-transport.js')
	assert.doesNotMatch(tr, /Trim in \(s\)|Set in ← playhead/, 'one trim UI, not two')
	const css = read('client/styles.css')
	assert.match(css, /@import url\('\.\/styles\/05d2-inspector-clip-trim\.css'\);/)
})
