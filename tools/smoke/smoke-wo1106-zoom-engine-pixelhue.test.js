'use strict'

/**
 * WO-1106 C11 / C16 — PixelHue, offline (a stand-in Studio app on 127.0.0.1, never a switcher):
 *   C11 concurrent bridge calls share ONE connect per host (each connect invalidates Studio's previous session); a
 *       refused connect is answered from a 3 s cache, a forced reconnect bypasses it.
 *   C16 a switcher layer removed during a look drive is reported as not kept (the read-back threw before).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { createStudioBridge } = require('../../src/pixelhue/studio-bridge')
const { driveLook } = require('../../src/pixelhue/pixelhue-look-drive')

function fakeStudio() {
	const connects = []
	let n = 0
	let session = ''
	const server = http.createServer((req, res) => {
		let body = ''
		req.on('data', (c) => (body += c)).on('end', () => {
			const url = new URL(req.url, 'http://x')
			const j = body ? JSON.parse(body) : null
			const send = (status, obj) => {
				res.writeHead(status, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify(obj))
			}
			if (req.method === 'POST' && url.pathname === '/api/connect') {
				connects.push(j.host)
				if (j.host === 'dead') return send(502, { error: 'Cannot reach dead:8088' })
				session = `s${++n}`
				return setTimeout(() => send(200, { session, device: { model: 'P20' }, capabilities: {} }), 20) // a login takes a moment
			}
			const given = j?.session ?? url.searchParams.get('session')
			if (given !== session) return send(409, { error: 'Connection changed. Reconnect before using these controls.' })
			send(200, { session })
		})
	})
	return {
		connects,
		start: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => server.close() }))),
	}
}

test('C11: a burst of calls logs in once; every call is answered with that session', async () => {
	const studio = fakeStudio()
	const bridge = createStudioBridge({ startApp: studio.start })
	try {
		const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => bridge.call('GET', `/api/x${i}`, undefined, '10.0.0.7')))
		assert.deepEqual(studio.connects, ['10.0.0.7'], 'one connect for six concurrent calls')
		for (const r of rs) assert.equal(r.status, 200)
		await Promise.all([bridge.status('10.0.0.7', true), bridge.status('10.0.0.7', true)])
		assert.equal(studio.connects.length, 2, 'two forced reconnects at once share one connect')
	} finally {
		bridge.stop()
	}
})

test('C11: a dead switcher is asked again only after 3 s, unless forced', async () => {
	const studio = fakeStudio()
	let t = 1000
	const bridge = createStudioBridge({ startApp: studio.start, now: () => t })
	try {
		const first = await bridge.call('GET', '/api/inputs', undefined, 'dead')
		assert.deepEqual([first.status, JSON.parse(first.body).error], [502, 'Cannot reach dead:8088'])
		const again = await Promise.all([1, 2, 3].map(() => bridge.call('GET', '/api/inputs', undefined, 'dead')))
		for (const r of again) assert.equal(JSON.parse(r.body).error, 'Cannot reach dead:8088', 'the cached reason')
		assert.equal(studio.connects.length, 1, 'not hammered within 3 s')
		assert.equal((await bridge.status('dead', true)).connected, false)
		assert.equal(studio.connects.length, 2, 'a forced reconnect bypasses the cache')
		t += 3000
		await bridge.call('GET', '/api/inputs', undefined, 'dead')
		assert.equal(studio.connects.length, 3, 'asked again after 3 s')
		assert.equal((await bridge.call('GET', '/api/inputs', undefined, '10.0.0.7')).status, 200, 'another host is not held by the cache')
	} finally {
		bridge.stop()
	}
})

test('C16: a layer removed during the drive is reported as not kept, the drive does not throw', async () => {
	const snap = (layers) => ({ screens: [{ screenId: 1, name: 'Screen 1', x: 0, y: 0, width: 3072, height: 1024, layers }] })
	const layer = { layerId: 7, x: 0, y: 0, width: 100, height: 100, type: 'normal', scene: 'pgm', sourceId: 25, sourceType: 2 }
	let gone = false
	const puts = []
	const reader = {
		read: async () => snap(gone ? [] : [{ ...layer }]),
		put: async (p, body) => {
			puts.push(p)
			gone = true // the operator deleted the layer on the switcher meanwhile
			return body
		},
	}
	const look = { layers: [{ layerNumber: 11, fill: { x: 0.5, y: 0.25, scaleX: 0.25, scaleY: 0.5 }, pixelhue: { layerId: 7, screenId: 1, name: 'L7' } }] }
	const r = await driveLook(look, reader, { wait: async () => {} })
	assert.deepEqual(puts, ['/unico/v1/layers/window'], 'the write went out')
	assert.deepEqual([r.sent, r.kept], [1, 0])
	assert.deepEqual(r.skipped, ['L7: the switcher did not keep the rectangle'])
})
