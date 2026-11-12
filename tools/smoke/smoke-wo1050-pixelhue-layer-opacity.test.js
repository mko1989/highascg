'use strict'

/**
 * WO-1050 smoke — a controller fader on a PixelHue layer's opacity: POST /api/pixelhue/layer-opacity, coalesced per
 * layer (one PUT in flight, latest value wins, never a backlog), against a fake reader (no network).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { OPACITY_PATH, createOpacityWriter } = require('../../src/pixelhue/pixelhue-opacity')
const { handleSetConfig, handleLayerOpacity } = require('../../src/api/routes-pixelhue')

/** A put that records its calls and resolves only when told to (one PUT "in flight" until release()). */
function slowPut() {
	const calls = []
	const waiting = []
	const put = (p, body) => {
		calls.push({ path: p, body })
		return new Promise((resolve) => waiting.push(resolve))
	}
	const release = async () => {
		while (waiting.length) waiting.shift()({ code: 0 })
		await new Promise((r) => setImmediate(r))
	}
	return { calls, put, release }
}

const tick = () => new Promise((r) => setImmediate(r))
let hostN = 0
function freshDeps(reader) {
	const storePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wo1050-')), 'pixelhue.json')
	const deps = { storePath, createReader: (host) => ({ host, ...reader }) }
	handleSetConfig(JSON.stringify({ host: `10.50.0.${++hostN}` }), deps) // a new address: a new reader
	return deps
}

describe('WO-1050 PixelHue layer opacity', () => {
	it('a burst of 50 values → at most 2 PUTs, in order, the last value wins', async () => {
		const sw = slowPut()
		const w = createOpacityWriter(sw.put, { log: () => {} })
		const answers = []
		for (let v = 0; v < 50; v++) answers.push(w.set(7, v * 2))
		assert.equal(answers[0].queued, false, 'the first goes out at once')
		assert.ok(answers.slice(1).every((a) => a.queued), 'the rest wait behind it')
		for (let i = 0; i < 5; i++) await sw.release()
		assert.ok(sw.calls.length <= 2, `${sw.calls.length} PUTs`)
		assert.deepEqual(
			sw.calls.map((c) => c.body[0].opacity),
			[0, 98],
			'the first value, then only the newest — no backlog',
		)
		assert.ok(sw.calls.every((c) => c.path === OPACITY_PATH && c.body.length === 1 && c.body[0].layerId === 7))
		assert.equal(OPACITY_PATH, '/unico/v1/layers/opacity')
		w.set(7, 55)
		await sw.release()
		assert.deepEqual(sw.calls.at(-1).body, [{ layerId: 7, opacity: 55 }], 'idle again: the next value goes at once')
	})

	it('layers are independent: one layer in flight does not hold another', async () => {
		const sw = slowPut()
		const w = createOpacityWriter(sw.put, { log: () => {} })
		w.set(1, 10)
		w.set(1, 11)
		assert.equal(w.set(2, 20).queued, false, 'layer 2 goes out while layer 1 is in flight')
		assert.deepEqual(sw.calls.map((c) => c.body[0]), [{ layerId: 1, opacity: 10 }, { layerId: 2, opacity: 20 }])
		await sw.release()
		await sw.release()
		assert.deepEqual(sw.calls.map((c) => c.body[0]).at(-1), { layerId: 1, opacity: 11 })
		assert.equal(sw.calls.length, 3)
	})

	it('a refused PUT is reported on the next call and does not stall the layer', async () => {
		let n = 0
		const w = createOpacityWriter(async () => {
			if (++n === 1) throw new Error('PixelHue /unico/v1/layers/opacity: code 5 nope')
		}, { log: () => {} })
		w.set(3, 40)
		await tick()
		const r = w.set(3, 41)
		assert.match(r.error, /code 5 nope/)
		await tick()
		assert.deepEqual(w.set(3, 42), { queued: false, sent: 41, error: '' })
	})

	it('route: raw JSON string body → the reader put, answers at once', async () => {
		const sw = slowPut()
		const deps = freshDeps({ put: sw.put })
		const r = handleLayerOpacity(JSON.stringify({ layerId: 88145921, opacity: 37.4 }), deps)
		assert.equal(r.status, 200)
		assert.deepEqual(JSON.parse(r.body), { ok: true, queued: false, sent: null, error: '' })
		assert.deepEqual(sw.calls, [{ path: '/unico/v1/layers/opacity', body: [{ layerId: 88145921, opacity: 37 }] }])
		for (let v = 0; v <= 100; v += 5) handleLayerOpacity(JSON.stringify({ layerId: 88145921, opacity: v }), deps)
		await sw.release()
		await sw.release()
		assert.deepEqual(sw.calls.map((c) => c.body[0].opacity), [37, 100], 'the route coalesces too')
	})

	it('route: validation → 400, no address → 409', () => {
		const sw = slowPut()
		const deps = freshDeps({ put: sw.put })
		for (const bad of [
			{ layerId: 5, opacity: -1 },
			{ layerId: 5, opacity: 101 },
			{ layerId: 5, opacity: 'x' },
			{ layerId: 5 },
			{ opacity: 50 },
			{ layerId: 'abc', opacity: 50 },
			{ layerId: -3, opacity: 50 },
			{ layerId: 1.5, opacity: 50 },
		]) {
			assert.equal(handleLayerOpacity(JSON.stringify(bad), deps).status, 400, JSON.stringify(bad))
		}
		assert.equal(handleLayerOpacity('{not json', deps).status, 400, 'a broken body')
		assert.equal(sw.calls.length, 0, 'nothing reached the switcher')
		assert.equal(handleLayerOpacity(JSON.stringify({ layerId: 5, opacity: 0 }), deps).status, 200, '0 is a value')
		handleSetConfig(JSON.stringify({ host: '' }), deps)
		assert.equal(handleLayerOpacity(JSON.stringify({ layerId: 5, opacity: 50 }), deps).status, 409)
	})

	it('the route is registered (literal path, before nothing that swallows it)', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/api/routes-pixelhue.js'), 'utf8')
		assert.match(src, /routes\.post\('\/api\/pixelhue\/layer-opacity', \(\{ body \}\) => handleLayerOpacity\(body\), opt\)/)
	})
})
