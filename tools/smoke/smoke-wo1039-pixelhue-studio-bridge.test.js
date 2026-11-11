'use strict'

/**
 * WO-1039 smoke — the bridge to the vendored PixelHue Studio: it connects Studio to the configured switcher, adds
 * Studio's session to every request, turns a POST into Studio's PUT, reconnects once on a changed connection, and
 * passes Studio's answers and errors through. The vendored app itself loads and serves its API in-process.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { createStudioBridge } = require('../../src/pixelhue/studio-bridge')
const { handleStudio } = require('../../src/api/routes-pixelhue-studio')

/** A stand-in Studio app: one session per connect; refuses a wrong session like the real one. */
function fakeStudio() {
	const seen = []
	let n = 0
	let session = ''
	const server = http.createServer((req, res) => {
		let body = ''
		req.on('data', (c) => (body += c)).on('end', () => {
			const url = new URL(req.url, 'http://x')
			const j = body ? JSON.parse(body) : null
			seen.push([req.method, url.pathname, Object.fromEntries(url.searchParams), j])
			const send = (status, obj) => {
				res.writeHead(status, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify(obj))
			}
			if (req.method === 'POST' && url.pathname === '/api/connect') {
				if (j.host === 'dead') return send(502, { error: 'Cannot reach dead:8088' })
				session = `s${++n}`
				return send(200, { session, device: { model: 'P20', host: j.host }, capabilities: { mvr: true } })
			}
			const given = j?.session ?? url.searchParams.get('session')
			if (given !== session) return send(409, { error: 'Connection changed. Reconnect before using these controls.' })
			if (url.pathname === '/api/gallery/thumb') {
				res.writeHead(200, { 'Content-Type': 'image/jpeg' })
				return res.end(Buffer.from([0xff, 0xd8, 0xff]))
			}
			if (url.pathname === '/api/programming' && req.method === 'PUT' && j.action === 'bad') return send(409, { error: 'PGM of Screen 1 is locked.' })
			send(200, { session, echo: req.method, path: url.pathname })
		})
	})
	return {
		seen,
		dropSession: () => (session = 'gone'),
		start: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => server.close() }))),
	}
}

describe('WO-1039 PixelHue Studio bridge', () => {
	it('connects, adds the session, POST → PUT, passes answers and errors through', async () => {
		const studio = fakeStudio()
		const bridge = createStudioBridge({ startApp: studio.start })
		const deps = { bridge, readSettings: () => ({ host: '10.0.0.7', drive: false }) }
		const st = JSON.parse((await handleStudio('GET', '/api/pixelhue/studio/status', {}, undefined, deps)).body)
		assert.deepEqual([st.connected, st.device.model, st.capabilities], [true, 'P20', { mvr: true }])
		const read = await handleStudio('GET', '/api/pixelhue/studio/programming/geometry', { session: 'client-nonsense' }, undefined, deps)
		assert.deepEqual([read.status, JSON.parse(read.body).path], [200, '/api/programming/geometry'])
		assert.deepEqual(studio.seen.at(-1).slice(0, 3), ['GET', '/api/programming/geometry', { session: 's1' }], 'the bridge owns the session')
		const write = await handleStudio('POST', '/api/pixelhue/studio/screens', {}, JSON.stringify({ action: 'freeze', id: 1, enable: 1 }), deps)
		assert.equal(JSON.parse(write.body).echo, 'PUT')
		assert.deepEqual(studio.seen.at(-1)[3], { action: 'freeze', id: 1, enable: 1, session: 's1' })
		const refused = await handleStudio('POST', '/api/pixelhue/studio/programming', {}, JSON.stringify({ action: 'bad' }), deps)
		assert.deepEqual([refused.status, JSON.parse(refused.body).error], [409, 'PGM of Screen 1 is locked.'])
		const thumb = await handleStudio('GET', '/api/pixelhue/studio/gallery/thumb', { id: '3' }, undefined, deps)
		assert.deepEqual([thumb.headers['Content-Type'], Buffer.isBuffer(thumb.body), studio.seen.at(-1)[2].id], ['image/jpeg', true, '3'])
		assert.equal(studio.seen.filter((x) => x[1] === '/api/connect').length, 1, 'one connect for all of it')
		bridge.stop()
	})

	it('a changed connection reconnects once and repeats the request; a dead switcher is an error, not a throw', async () => {
		const studio = fakeStudio()
		const bridge = createStudioBridge({ startApp: studio.start })
		let host = '10.0.0.7'
		const deps = { bridge, readSettings: () => ({ host }) }
		await handleStudio('GET', '/api/pixelhue/studio/inputs', {}, undefined, deps)
		studio.dropSession()
		const again = await handleStudio('GET', '/api/pixelhue/studio/inputs', {}, undefined, deps)
		assert.equal(again.status, 200)
		assert.equal(studio.seen.filter((x) => x[1] === '/api/connect').length, 2)
		host = 'dead'
		const dead = await handleStudio('GET', '/api/pixelhue/studio/inputs', {}, undefined, deps)
		assert.deepEqual([dead.status, JSON.parse(dead.body).error], [502, 'Cannot reach dead:8088'])
		host = ''
		assert.equal((await handleStudio('GET', '/api/pixelhue/studio/inputs', {}, undefined, deps)).status, 409)
		assert.equal(JSON.parse((await handleStudio('GET', '/api/pixelhue/studio/status', {}, undefined, deps)).body).connected, false)
		bridge.stop()
	})

	it('only Studio resources: connect / discovery and odd paths are not reachable', async () => {
		const deps = { bridge: { call: async () => assert.fail('must not be called') }, readSettings: () => ({ host: 'x' }) }
		for (const p of ['connect', 'discovery', '../x', 'a/b/c', 'Programming', '']) {
			assert.equal((await handleStudio('GET', '/api/pixelhue/studio/' + p, {}, undefined, deps)).status, 404, p)
		}
	})

	it('the vendored Studio is pinned and loads in-process', async () => {
		const dir = path.join(__dirname, '../../src/pixelhue/vendor/pixelhue-studio')
		assert.match(fs.readFileSync(path.join(dir, 'VENDORED_COMMIT'), 'utf8').trim(), /^[0-9a-f]{40}$/)
		assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).type, 'module')
		const bridge = createStudioBridge()
		const r = await bridge.call('GET', '/api/state', undefined, '') // no address: answered without touching the network
		assert.equal(r.status, 409)
		const mod = await import(require('node:url').pathToFileURL(path.join(dir, 'server.js')).href)
		assert.equal(typeof mod.createApp, 'function')
		bridge.stop()
	})
})
