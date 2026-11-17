'use strict'

/**
 * WO-1106 C41 — the Studio bridge after a switcher restart / power cycle, offline: a stand-in Studio app on 127.0.0.1
 * whose "switcher" restarts (new startTime → the token Studio made at connect is dead). The real switcher is not
 * tested here. Studio wraps a switcher failure as 502 `Device HTTP 401 at …` / `Device rejected …: … (code n).` /
 * `Cannot reach …` (vendor lib/pixelhue.js requestJson).
 *   - a dead token drops the session, reconnects once and repeats the request once; a second failure is answered;
 *   - a rejected read is retried (the switcher's stale-token code is not documented), a rejected write is not;
 *   - an unreachable switcher drops the session: the next request and status() connect again;
 *   - concurrent requests that hit the dead token share one reconnect (C11).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { createStudioBridge } = require('../../src/pixelhue/studio-bridge')

function fakeStudio() {
	const st = { startTime: 1, tokenAt: 0, session: '', n: 0, connects: 0, requests: [], dead: '401', down: false, alwaysDead: false }
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
				st.connects++
				if (st.down) return send(502, { error: `Cannot reach ${j.host}:8088: connect ECONNREFUSED` })
				st.tokenAt = st.startTime
				st.session = `s${++st.n}`
				return setTimeout(() => send(200, { session: st.session, device: { model: 'P20' }, capabilities: {} }), 10)
			}
			st.requests.push([req.method, url.pathname])
			const given = j?.session ?? url.searchParams.get('session')
			if (given !== st.session) return send(409, { error: 'Connection changed. Reconnect before using these controls.' })
			if (st.down) return send(502, { error: `Cannot reach 10.0.0.7:8088: connect EHOSTUNREACH` })
			if (j?.action === 'bad') return send(502, { error: 'Device rejected /unico/v1/layers/create: capacity exceeded (code 12).' })
			if (st.alwaysDead || st.tokenAt !== st.startTime) {
				if (st.dead === '401') return send(502, { error: 'Device HTTP 401 at /unico/v1/screen/list-detail.' })
				return send(502, { error: 'Device rejected /unico/v1/screen/list-detail: token invalid (code 4001).' })
			}
			send(200, { session: st.session, method: req.method })
		})
	})
	return {
		st,
		restart: () => st.startTime++, // the switcher restarted: Studio's token is dead
		start: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => server.close() }))),
	}
}

const H = '10.0.0.7'
const err = (r) => JSON.parse(r.body.toString('utf8')).error

test('C41: a switcher restart (Device HTTP 401) reconnects once and repeats the read and the write', async () => {
	const studio = fakeStudio()
	const bridge = createStudioBridge({ startApp: studio.start })
	try {
		assert.equal((await bridge.call('GET', '/api/state', undefined, H)).status, 200)
		assert.equal(studio.st.connects, 1)
		studio.restart()
		const r = await bridge.call('GET', '/api/state', undefined, H)
		assert.equal(r.status, 200, 'answered after the reconnect')
		assert.equal(studio.st.connects, 2, 'one reconnect')
		studio.restart()
		const w = await bridge.call('POST', '/api/screens', { action: 'freeze', id: 1 }, H)
		assert.deepEqual([w.status, JSON.parse(w.body).method], [200, 'PUT'], 'a write refused for its token is repeated once')
		assert.equal(studio.st.connects, 3)
	} finally {
		bridge.stop()
	}
})

test('C41: a read the switcher rejects is retried; a rejected write is answered as is, the session kept', async () => {
	const studio = fakeStudio()
	studio.st.dead = 'rejected'
	const bridge = createStudioBridge({ startApp: studio.start })
	try {
		await bridge.call('GET', '/api/state', undefined, H)
		studio.restart()
		assert.equal((await bridge.call('GET', '/api/inputs', undefined, H)).status, 200)
		assert.equal(studio.st.connects, 2)
		const before = studio.st.requests.length
		const bad = await bridge.call('POST', '/api/layers', { action: 'bad' }, H)
		assert.deepEqual([bad.status, err(bad)], [502, 'Device rejected /unico/v1/layers/create: capacity exceeded (code 12).'])
		assert.equal(studio.st.requests.length, before + 1, 'the write went out once')
		assert.equal(studio.st.connects, 2, 'no reconnect for a refused write')
	} finally {
		bridge.stop()
	}
})

test('C41: a token still refused after the reconnect is answered (one retry, no loop)', async () => {
	const studio = fakeStudio()
	const bridge = createStudioBridge({ startApp: studio.start })
	try {
		await bridge.call('GET', '/api/state', undefined, H)
		studio.st.alwaysDead = true // every token is refused, the fresh one too
		const realConnects = studio.st.connects
		const before = studio.st.requests.length
		const r = await bridge.call('GET', '/api/state', undefined, H)
		assert.deepEqual([r.status, err(r)], [502, 'Device HTTP 401 at /unico/v1/screen/list-detail.'])
		assert.equal(studio.st.connects, realConnects + 1, 'one reconnect')
		assert.equal(studio.st.requests.length, before + 2, 'the request was sent twice, not more')
	} finally {
		bridge.stop()
	}
})

test('C41: an unreachable switcher drops the session — status() and the next call connect again', async () => {
	const studio = fakeStudio()
	let t = 1000
	const bridge = createStudioBridge({ startApp: studio.start, now: () => t })
	try {
		await bridge.call('GET', '/api/state', undefined, H)
		studio.st.down = true // power cycle: off
		const r = await bridge.call('GET', '/api/state', undefined, H)
		assert.match(err(r), /^Cannot reach /)
		assert.equal(studio.st.connects, 1, 'no reconnect while it cannot be reached')
		const s = await bridge.status(H)
		assert.equal(s.connected, false, '"connected" is no longer the cached answer')
		assert.equal(studio.st.connects, 2)
		studio.st.down = false // back on, new startTime
		studio.restart()
		t += 3000 // past the refused-connect cache
		assert.equal((await bridge.call('GET', '/api/state', undefined, H)).status, 200)
		assert.equal((await bridge.status(H)).connected, true)
		assert.equal(studio.st.connects, 3)
	} finally {
		bridge.stop()
	}
})

test('C41 + C11: concurrent requests that hit the dead token share one reconnect', async () => {
	const studio = fakeStudio()
	const bridge = createStudioBridge({ startApp: studio.start })
	try {
		await bridge.call('GET', '/api/state', undefined, H)
		studio.restart()
		const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => bridge.call('GET', `/api/x${i}`, undefined, H)))
		for (const r of rs) assert.equal(r.status, 200)
		assert.equal(studio.st.connects, 2, 'one reconnect for five refused requests')
	} finally {
		bridge.stop()
	}
})
