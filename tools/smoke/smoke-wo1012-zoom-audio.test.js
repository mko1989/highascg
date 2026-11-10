'use strict'

/** WO-1012 stage C — two-way Zoom audio: commands, idempotency, mix-minus, cleanup, the route's raw-JSON POST body. */

const test = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('events')
const { createZoomAudio, defaultFeeds } = require('../../src/zoom/zoom-audio')
const { wantedLinks, portConfigs } = require('../../src/zoom/zoom-audio-links')
const { buildConf } = require('../../src/zoom/zoom-audio-conf')

const node = (id, name, cls, app) => ({ id, type: 'PipeWire:Interface:Node', info: { props: { 'node.name': name, 'media.class': cls, 'application.name': app } } })
const port = (id, nid, dir, ch, monitor) => ({ id, type: 'PipeWire:Interface:Port', info: { props: { 'node.id': nid, 'port.direction': dir, 'audio.channel': ch, 'port.monitor': !!monitor } } })

function graph(withPorts) {
	const nodes = [
		node(10, 'highascg_zoom_in', 'Audio/Sink'),
		node(11, 'highascg_zoom_out', 'Audio/Source'),
		node(12, 'highascg_zoom_out_feed', 'Audio/Sink'),
		node(13, 'highascg_zoom_in_tap', 'Stream/Input/Audio', 'pw-cat'),
		node(14, 'highascg_zoom_out_feeder', 'Stream/Output/Audio', 'pw-cat'),
		node(20, 'ZOOM VoiceEngine', 'Stream/Output/Audio', 'ZOOM VoiceEngine'),
		node(21, 'ZOOM VoiceEngine', 'Stream/Input/Audio', 'ZOOM VoiceEngine'),
		node(30, 'foreign', 'Stream/Output/Audio', 'firefox'),
	]
	const ports = withPorts
		? [
				port(100, 10, 'in', 'FL'), port(101, 10, 'in', 'FR'), port(102, 10, 'out', 'FL', true), port(103, 10, 'out', 'FR', true),
				port(110, 11, 'out', 'FL'), port(111, 11, 'out', 'FR'),
				port(120, 12, 'in', 'FL'), port(121, 12, 'in', 'FR'),
				port(130, 13, 'in', 'FL'), port(131, 13, 'in', 'FR'),
				port(140, 14, 'out', 'FL'), port(141, 14, 'out', 'FR'),
				port(200, 20, 'out', 'FL'), port(201, 20, 'out', 'FR'),
				port(210, 21, 'in', 'FL'), port(211, 21, 'in', 'FR'),
				port(300, 30, 'out', 'FL'), port(301, 30, 'out', 'FR'),
			]
		: []
	return { nodes, ports, links: [] }
}

test('policy: port configs for our nodes and Zoom streams only; links only touch Zoom + our bridges', () => {
	const cfg = portConfigs(graph(false))
	assert.deepStrictEqual(cfg.map((c) => c.id).sort((a, b) => a - b), [10, 11, 12, 13, 14, 20, 21])
	assert.strictEqual(cfg.find((c) => c.id === 10).monitor, true)
	assert.strictEqual(cfg.find((c) => c.id === 11).direction, 'Output')
	assert.deepStrictEqual(portConfigs(graph(true)), [])
	const pairs = wantedLinks(graph(true)).map((p) => p.join('>')).sort()
	assert.deepStrictEqual(pairs, ['102>130', '103>131', '110>210', '111>211', '140>120', '141>121', '200>100', '201>101'].sort())
	assert.ok(!pairs.some((p) => p.startsWith('300')), 'firefox stream is never linked')
	const g = graph(true)
	g.links = [{ info: { 'output-port-id': 200, 'input-port-id': 100 } }]
	assert.ok(!wantedLinks(g).some(([o, i]) => o === 200 && i === 100), 'existing link not repeated')
})

test('config names only our nodes and the private socket', () => {
	const c = buildConf().replace(/^#.*$/gm, '')
	for (const s of ['highascg_zoom_in', 'highascg_zoom_out', 'highascg_zoom_out_feed', 'core.name = highascg-pw', 'unix:native']) assert.ok(c.includes(s), s)
	assert.ok(!/alsa|default\.audio/i.test(c), 'no hardware, no default sink/source')
})

function rig({ amcpInfo = () => '' } = {}) {
	const calls = []
	const spawns = []
	let up = false
	let portsReady = false
	const raw = []
	const files = {}
	const exec = async (bin, args) => {
		calls.push([bin, ...args])
		if (bin === 'pw-dump') {
			if (!up) throw new Error('Host is down')
			return { stdout: JSON.stringify(Object.values(graph(portsReady)).flat()) }
		}
		if (bin === 'pw-cli') portsReady = true
		return { stdout: '' }
	}
	const spawn = (bin, args) => {
		const p = new EventEmitter()
		p.bin = bin
		p.args = args
		p.killed = []
		p.kill = (s) => p.killed.push(s)
		p.unref = () => {}
		p.stdin = new EventEmitter()
		p.stdin.write = () => true
		p.stdout = { pipe: () => {} }
		spawns.push(p)
		// the daemon starts in its own user scope (a node restart must not kill it under Zoom)
		if (bin === '/usr/bin/systemd-run' && args.includes('pipewire')) up = true
		return p
	}
	const sock = new EventEmitter()
	sock.bind = () => {}
	sock.close = () => (sock.closed = true)
	const amcp = { isConnected: true, info: async (c) => {
			const has = raw.filter((x) => x.includes(` ${c}-9277`)).pop()
			return { data: amcpInfo(c) + (has && has.startsWith('ADD') ? ' port_9277' : '') }
		}, raw: async (c) => raw.push(c) }
	const fs = {
		existsSync: () => true,
		mkdirSync: () => {},
		writeFileSync: (f, d) => (files[f] = d),
		readFileSync: (f) => {
			if (files[f]) return files[f]
			throw new Error('ENOENT')
		},
	}
	const feeds = () => [{ id: 'pgm:1', label: 'Screen 1 program (ch 2)', channel: 2 }, { id: 'prv:1', label: 'Screen 1 preview (ch 3)', channel: 3 }]
	const timers = { setInterval: () => ({ unref() {} }), clearInterval: () => {} }
	const za = createZoomAudio({ exec, spawn, fs, createSocket: () => sock, timers, getAmcp: () => amcp, feeds, dir: '/x/zdir', runtimeBase: '/x', stateFile: '/x/state.json' })
	return { za, calls, spawns, raw, files, sock, isUp: () => up }
}

test('enable: daemon, bridges, links and the AMCP consumer; idempotent; disable cleans up', async () => {
	const r = rig()
	let s = await r.za.apply({ enabled: true, feed: 'pgm:1' })
	assert.strictEqual(s.enabled, true)
	assert.strictEqual(s.in.present, true)
	assert.strictEqual(s.out.present, true)
	assert.strictEqual(s.out.feed, 'pgm:1')
	assert.deepStrictEqual(s.feeds.map((f) => f.id), ['pgm:1', 'prv:1'])
	assert.strictEqual(s.env.PULSE_SINK, 'highascg_zoom_in')
	assert.strictEqual(s.env.PULSE_SOURCE, 'highascg_zoom_out')
	assert.match(s.env.PULSE_SERVER, /^unix:\/x\/zdir\/native$/)
	assert.match(r.files['/x/zdir/pipewire.conf'], /highascg_zoom_in/)
	assert.deepStrictEqual(r.spawns.map((p) => p.bin), ['/usr/bin/systemd-run', 'pw-cat', 'ffmpeg', 'pw-cat'])
	assert.deepStrictEqual(r.spawns[0].args.slice(0, 6), ['--user', '--scope', '--collect', '--quiet', '--', 'pipewire'])
	assert.ok(r.calls.some((c) => c[0] === 'pw-cli' && c[1] === 's' && c[3] === 'PortConfig' && c[2] === '10'))
	assert.ok(r.calls.some((c) => c[0] === 'pw-link' && c[1] === '200' && c[2] === '100'))
	assert.strictEqual(r.raw.length, 1)
	assert.match(r.raw[0], /^ADD 2-9277 STREAM udp:\/\/127\.0\.0\.1:52232/)
	assert.ok(!r.calls.some((c) => /pactl|default/.test(c.join(' '))), 'no default sink/source commands')
	const n = r.spawns.length
	await r.za.apply({ enabled: true })
	assert.strictEqual(r.spawns.length, n, 'second enable spawns nothing new')
	// change feed -> REMOVE on the old channel
	await r.za.apply({ feed: 'prv:1' })
	assert.strictEqual(r.spawns.length, n)
	assert.deepStrictEqual(r.raw.map((c) => c.split(' ').slice(0, 2).join(' ')), ['ADD 2-9277', 'REMOVE 2-9277', 'ADD 3-9277'])
	await r.za.apply({ enabled: false })
	assert.strictEqual(r.raw.pop(), 'REMOVE 3-9277')
	assert.ok(r.spawns.filter((p) => p.bin !== '/usr/bin/systemd-run').every((p) => p.killed.includes('SIGTERM')))
	assert.ok(r.sock.closed)
	assert.strictEqual(JSON.parse(r.files['/x/state.json']).enabled, false)
	s = await r.za.status()
	assert.deepStrictEqual(r.za.zoomEnv(), {})
	assert.strictEqual(s.enabled, false)
})

test('mix-minus: a feed that plays the Zoom input (directly or via route://) is refused', async () => {
	const info = (c) => (c === 2 ? 'LAYER udp://127.0.0.1:52233' : c === 3 ? 'route://2-10' : '')
	const r = rig({ amcpInfo: info })
	let s = await r.za.apply({ enabled: true, feed: 'pgm:1' })
	assert.ok(/Mix-minus/.test(s.note), s.note)
	assert.ok(!r.raw.some((c) => c.startsWith('ADD')))
	assert.ok(!r.spawns.some((p) => p.bin === 'pw-cat' && p.args.includes('--playback')), 'no return bridge')
	s = await r.za.apply({ feed: 'prv:1' })
	assert.ok(/Mix-minus/.test(s.note), 'one route:// hop is followed')
	assert.ok(!r.raw.some((c) => c.startsWith('ADD')))
})

test('unknown feed is rejected; defaultFeeds tolerates an empty config', async () => {
	const r = rig()
	await assert.rejects(r.za.apply({ feed: 'nope' }), /unknown feed/)
	assert.ok(Array.isArray(defaultFeeds({})))
})

test('route: POST takes the raw JSON string body', async () => {
	const routes = { h: {} }
	routes.get = (p, fn) => (routes.h['GET ' + p] = fn)
	routes.post = (p, fn) => (routes.h['POST ' + p] = fn)
	require('../../src/api/routes-zoom-audio').register(routes)
	assert.ok(routes.h['GET /api/zoom/audio'] && routes.h['POST /api/zoom/audio'])
	const res = await routes.h['POST /api/zoom/audio']({ ctx: { config: {} }, body: JSON.stringify({ feed: 'nope' }) })
	assert.strictEqual(res.status, 400)
	assert.match(JSON.parse(res.body).error, /unknown feed "nope"/, 'the string body was parsed')
})
