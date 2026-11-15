'use strict'

/**
 * WO-1074 — full-screen button on the game page (owner 15.11: "need a fullscreen button on the client game browser").
 *  - enters and leaves through the standard API, or the webkit names where only those exist;
 *  - asks for a landscape lock after entering, and a refused lock or a refused request never throws;
 *  - a browser without the API (iPhone Safari) reports unsupported, so no dead button is drawn;
 *  - the button sits in the toolbar, on the join form and in the lobby; the spectator page gets none.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const RC = path.join(__dirname, '..', '..', 'modules', 'rc-game', 'client')
const load = (f) => import(pathToFileURL(path.join(RC, f)).href)
const src = (f) => fs.readFileSync(path.join(RC, f), 'utf8')

function fakeDoc({ webkit = false, none = false, refuse = false } = {}) {
	const calls = []
	const doc = { documentElement: {}, listeners: {}, addEventListener: (n, f) => (doc.listeners[n] = f) }
	if (none) return { doc, calls }
	const el = webkit ? 'webkitFullscreenElement' : 'fullscreenElement'
	doc.documentElement[webkit ? 'webkitRequestFullscreen' : 'requestFullscreen'] = async function (opts) {
		calls.push(['enter', this === doc.documentElement, opts])
		if (refuse) throw new TypeError('not allowed')
		doc[el] = doc.documentElement
	}
	doc[webkit ? 'webkitExitFullscreen' : 'exitFullscreen'] = async function () {
		calls.push(['leave', this === doc])
		doc[el] = null
	}
	return { doc, calls }
}

describe('WO-1074 full-screen button', () => {
	it('standard API: enter with a landscape lock, then leave', async () => {
		const { createFullscreen } = await load('fullscreen.js')
		const { doc, calls } = fakeDoc()
		const locks = []
		const screen = { orientation: { lock: async (o) => locks.push(o), unlock: () => locks.push('unlock') } }
		const f = createFullscreen({ doc, screen })
		assert.equal(f.supported, true)
		assert.equal(f.active, false)
		assert.equal(await f.toggle(), true)
		assert.deepEqual(calls, [['enter', true, { navigationUI: 'hide' }]])
		assert.deepEqual(locks, ['landscape'])
		assert.equal(await f.toggle(), false)
		assert.deepEqual(calls[1], ['leave', true])
		assert.deepEqual(locks, ['landscape', 'unlock'])
	})

	it('webkit names work; a refused lock or request never throws', async () => {
		const { createFullscreen } = await load('fullscreen.js')
		const w = fakeDoc({ webkit: true })
		const noLock = { orientation: { lock: () => Promise.reject(new Error('NotSupportedError')) } }
		const f = createFullscreen({ doc: w.doc, screen: noLock })
		assert.equal(f.supported, true)
		assert.equal(await f.toggle(), true, 'entered although the lock was refused')
		assert.equal(await f.toggle(), false)
		const r = fakeDoc({ refuse: true })
		assert.equal(await createFullscreen({ doc: r.doc, screen: {} }).toggle(), false, 'refused request: stays windowed')
		const fn = () => {}
		f.onChange(fn)
		assert.equal(w.doc.listeners.fullscreenchange, fn)
		assert.equal(w.doc.listeners.webkitfullscreenchange, fn)
	})

	it('no API (iPhone Safari) or disabled by policy: unsupported', async () => {
		const { createFullscreen } = await load('fullscreen.js')
		const f = createFullscreen({ doc: fakeDoc({ none: true }).doc, screen: {} })
		assert.equal(f.supported, false)
		assert.equal(await f.toggle(), false)
		const off = fakeDoc()
		off.doc.fullscreenEnabled = false
		assert.equal(createFullscreen({ doc: off.doc, screen: {} }).supported, false)
		assert.match(src('fullscreen.js'), /if \(!fs\.supported\) return null/, 'no dead button')
	})

	it('wired: toolbar (players only), join form and lobby', () => {
		const game = src('game.js')
		assert.match(game, /if \(!spectator && fsEl\) toolbar\.push\(\{ el: fsEl \}\)/)
		const lobby = src('lobby.js')
		assert.match(lobby, /h\('div\.panel-head', h\('h1', \{ text: 'Stage Sprint RC' \}\), fullscreenButton\(\)\)/)
		assert.match(lobby, /h\('div\.actions', readyBtn, driveBtn, changeBtn, fullscreenButton\(\)\)/)
		assert.match(src('rc-ui.css'), /\.fs-ico \{/)
	})
})
