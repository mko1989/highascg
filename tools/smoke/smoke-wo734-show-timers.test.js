'use strict'

/**
 * WO-734 — show timers on the served pages. The presentation clock (OSCPoint has none: timed from its `state`), the
 * main-video pick (looped clips never timed, live bank, kiosk layer rules), the service against a fake Companion v4 HTTP
 * API (connections, variables, media only while a clip plays, a non-Companion port), and the page/route wiring.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const { createPresentationClock, GRACE_MS } = require('../../src/show-timers/presentation-clock')
const { mainVideos, STALE_MS } = require('../../src/show-timers/main-video')
const { createShowTimers } = require('../../src/show-timers/show-timers-service')
const routes = require('../../src/show-timers/show-timers-routes')

const ROOT = path.join(__dirname, '..', '..')
const S = 1000

describe('WO-734 presentation clock', () => {
	it('runs in the slideshow (paused auto-advance included), stops in edit, carries on after a quick Esc', () => {
		const c = createPresentationClock()
		const t0 = 1_000_000
		assert.deepEqual(c.update({ name: 'Talk.pptx', state: 'edit' }, t0), { live: false, elapsed_s: 0 })
		c.update({ name: 'Talk.pptx', state: 'running' }, t0)
		assert.equal(c.update({ name: 'Talk.pptx', state: 'paused' }, t0 + 5 * S).elapsed_s, 5)
		assert.deepEqual(c.update({ name: 'Talk.pptx', state: 'edit' }, t0 + 10 * S), { live: false, elapsed_s: 10 })
		assert.equal(c.update({ name: 'Talk.pptx', state: 'edit' }, t0 + 30 * S).elapsed_s, 10, 'held in edit')
		c.update({ name: 'Talk.pptx', state: 'running' }, t0 + 30 * S)
		assert.equal(c.update({ name: 'Talk.pptx', state: 'running' }, t0 + 40 * S).elapsed_s, 20, 'continued')
	})

	it('starts from zero after a long break or for another presentation', () => {
		const c = createPresentationClock()
		c.update({ name: 'A.pptx', state: 'running' }, 0)
		c.update({ name: 'A.pptx', state: 'edit' }, 60 * S)
		c.update({ name: 'A.pptx', state: 'running' }, 60 * S + GRACE_MS + S)
		assert.equal(c.update({ name: 'A.pptx', state: 'running' }, 60 * S + GRACE_MS + 4 * S).elapsed_s, 3)
		const t = 500 * S
		assert.equal(c.update({ name: 'B.pptx', state: 'running' }, t).elapsed_s, 0, 'another file, straight into the show')
		assert.equal(c.update({ name: 'B.pptx', state: 'running' }, t + 7 * S).elapsed_s, 7)
	})
})

const now = 2_000_000
const clip = (o = {}) => ({ type: 'ffmpeg', paused: false, _lastOscAt: now - 100, file: { name: 'PROJECTS/X/OPENER', elapsed: 10, remaining: 50, duration: 60, ...o } })
const cm = { programChannels: [1, 3], screenLabels: ['PGM 1', 'PGM 2'] }

describe('WO-734 main video', () => {
	it('a looped clip is a background: none timed; a clip under a looped overlay is', () => {
		const loopOnly = { channels: { 1: { layers: { 10: clip({ loop: true }), 11: clip({ loop: true }) } } } }
		assert.deepEqual(mainVideos(loopOnly, cm, {}, now), [], 'the live box today: two looped backgrounds on PGM')
		const v = mainVideos({ channels: { 1: { layers: { 10: clip(), 20: clip({ loop: true }) } } } }, cm, {}, now)
		assert.deepEqual(v, [{ screen: 'PGM 1', channel: 1, layer: 10, label: 'OPENER', elapsed_s: 10, remaining_s: 50, duration_s: 60, paused: false }])
	})

	it('the topmost clip of the live bank only; timer band, border, routes, stale and duration-less layers skipped', () => {
		const layers = { 10: clip({ name: 'A' }), 120: clip({ name: 'B' }), 985: clip({ name: 'T' }), 998: clip({ name: 'BORDER' }) }
		assert.equal(mainVideos({ channels: { 1: { layers } } }, cm, { 1: 'a' }, now)[0].label, 'A')
		assert.equal(mainVideos({ channels: { 1: { layers } } }, cm, { 1: 'b' }, now)[0].label, 'B')
		const skipped = {
			30: { type: 'route', file: {} },
			20: { ...clip({ name: 'OLD' }), _lastOscAt: now - STALE_MS - 1 },
			15: clip({ name: 'LIVE?', duration: undefined }),
			12: { ...clip({ name: 'HELD' }), paused: true },
		}
		const v = mainVideos({ channels: { 3: { layers: skipped } } }, cm, {}, now)
		assert.deepEqual([v[0].screen, v[0].label, v[0].paused], ['PGM 2', 'HELD', true])
		assert.deepEqual(mainVideos({ channels: { 2: { layers: { 10: clip() } } } }, cm, {}, now), [], 'preview channels are not timed')
	})
})

/** Companion v4 as far as WO-734 reads it. */
function fakeCompanion(vars, connections) {
	const hits = []
	const server = http.createServer((req, res) => {
		hits.push(req.url)
		if (req.url === '/api/connections') return res.end(JSON.stringify(connections))
		const m = /^\/api\/variable\/([^/]+)\/([^/]+)\/value$/.exec(req.url)
		const v = m && vars[decodeURIComponent(m[1])]?.[m[2]]
		if (v == null) return res.writeHead(404).end('Not found')
		res.end(String(v))
	})
	return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, hits, base: `http://127.0.0.1:${server.address().port}` })))
}

describe('WO-734 show-timers service', () => {
	it('reads the enabled OSCPoint connection, times the show, adds the media only while a clip plays', async () => {
		const vars = {
			OSCPoint: { state: 'running', presentationName: 'Keynote.pptx', currentSlide: 4, slideCountVisible: 18, mediaState: 'stopped', mediaPosition: 9, mediaRemaining: 1, mediaDuration: 10 },
		}
		const conns = [
			{ id: 'a', label: 'OSCPoint', moduleId: 'zinc-oscpoint', enabled: true },
			{ id: 'b', label: 'Laptop2', moduleId: 'zinc-oscpoint', enabled: false },
			{ id: 'c', label: 'HighAsCG', moduleId: 'highpass-highascg', enabled: true },
		]
		const fc = await fakeCompanion(vars, conns)
		let t = 5_000_000
		const st = createShowTimers({ companionBase: () => fc.base, osc: () => ({}), channelMap: () => cm, banks: () => ({}), now: () => t })
		try {
			let s = await st.snapshot()
			assert.deepEqual(s.companion, { ok: true, error: '' })
			assert.deepEqual(s.presentations, [{ source: 'OSCPoint', name: 'Keynote.pptx', state: 'running', slide: 4, slides: 18, elapsed_s: 0, video: null }])
			assert.ok(!fc.hits.some((u) => u.includes('mediaPosition')), 'stale media values of a stopped clip are not read')
			assert.ok(!fc.hits.some((u) => u.includes('Laptop2')), 'a disabled connection is not read')
			await st.tick()
			assert.equal(fc.hits.filter((u) => u === '/api/connections').length, 1, 'the connection list is cached')
			t += 65 * S
			vars.OSCPoint.mediaState = 'playing'
			vars.OSCPoint.mediaPosition = 12
			vars.OSCPoint.mediaRemaining = 30
			vars.OSCPoint.mediaDuration = 42
			await st.tick()
			s = await st.snapshot()
			assert.equal(s.presentations[0].elapsed_s, 65)
			assert.deepEqual(s.presentations[0].video, { paused: false, elapsed_s: 12, remaining_s: 30, duration_s: 42 })
			vars.OSCPoint.state = 'edit'
			await st.tick()
			assert.deepEqual((await st.snapshot()).presentations, [], 'out of the slideshow: no presentation timer')
			assert.equal(fc.hits.filter((u) => u === '/api/connections').length, 2, 'and read again after CONNECTIONS_TTL_MS')
		} finally {
			st.stop()
			fc.server.close()
		}
	})

	it('a port that is not Companion (this box: 8000 is the scanner) says so instead of a timer', async () => {
		const other = http.createServer((_q, res) => res.writeHead(404).end('<html>nope</html>'))
		await new Promise((r) => other.listen(0, '127.0.0.1', r))
		const port = other.address().port
		const st = createShowTimers({ companionBase: () => `http://127.0.0.1:${port}`, osc: () => ({}), channelMap: () => cm, banks: () => ({}) })
		try {
			const s = await st.snapshot()
			assert.equal(s.companion.ok, false)
			assert.equal(s.companion.error, `no Companion at 127.0.0.1:${port} (HTTP 404)`)
			assert.deepEqual(s.presentations, [])
		} finally {
			st.stop()
			other.close()
		}
	})
})

describe('WO-734 wiring', () => {
	it('the routes answer the timers and the widget; the dispatcher asks them before the module hook', async () => {
		const ctx = { _showTimers: { snapshot: async () => ({ presentations: [], videos: [], companion: { ok: true, error: '' } }) } }
		const r = await routes.handle('GET', '/api/show-timers', ctx)
		assert.equal(r.status, 200)
		assert.deepEqual(JSON.parse(r.body).videos, [])
		const w = await routes.handle('GET', '/api/show-timers/widget.js', ctx)
		assert.match(w.headers['Content-Type'], /javascript/)
		assert.ok(w.body.includes("document.getElementById('show-timers')"))
		assert.equal(await routes.handle('POST', '/api/show-timers', ctx), null)
		const d = fs.readFileSync(path.join(ROOT, 'src/api/router-dispatch.js'), 'utf8')
		assert.ok(d.includes("const showTimers = require('../show-timers/" + "show-timers-routes')")) // concat: not a require
		assert.ok(d.indexOf('await showTimers.handle(method, p, ctx)') < d.indexOf('await moduleRegistry.handleApi('))
	})

	it('both served pages carry the strip', () => {
		for (const f of ['src/tracking/presenter-intake.html', 'src/audio-desk/audio-page.html']) {
			const html = fs.readFileSync(path.join(ROOT, f), 'utf8')
			assert.ok(html.includes('<div id="show-timers"></div>'), f)
			assert.ok(html.includes('<script src="/api/show-timers/widget.js"></script>'), f)
		}
	})
})
