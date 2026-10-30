'use strict'

/**
 * WO-857 part 1 — the console-selection feed, the grandMA3 plugin's UDP path and the OSC `/cmd` return path, all on
 * loopback: a UDP sender stub emulating the Lua plugin's packets, an OSC receiver stub standing in for the console
 * (127.0.0.1 only, ephemeral ports). No console, no Art-Net, nothing leaves the machine.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const dgram = require('dgram')
const fs = require('fs')
const os = require('os')
const path = require('path')
const osc = require('osc')

const { buildFidMap, sceneFids, createFidResolver } = require('../../src/fixtures/console-fid-map')
const { createConsoleSelection, getService } = require('../../src/fixtures/console-selection')
const { Gma3SelectionListener, parsePacket, parseHeads, encodePacket, listenConfig, DEFAULT_PORT } = require('../../src/fixtures/gma3-selection-listener')
const { selectCommand, atCommand, attributeCommand, commandsFor } = require('../../src/lighting-console/gma3-return')
const { createLightingService } = require('../../src/lighting-console/console-service')
const { RouteRegistry } = require('../../src/api/route-registry')
const consoleRoutes = require('../../src/api/routes-console-selection')

const dirs = []
const socks = []
after(() => {
	for (const s of socks) {
		try {
			s.close()
		} catch (_) {
			/* closed */
		}
	}
	for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
})

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(pred, what, ms = 1500) {
	const end = Date.now() + ms
	while (Date.now() < end) {
		if (pred()) return
		await wait(5)
	}
	assert.fail('timed out: ' + what)
}
async function freeUdpPort() {
	const s = dgram.createSocket('udp4')
	await new Promise((r) => s.bind(0, '127.0.0.1', r))
	const { port } = s.address()
	await new Promise((r) => s.close(r))
	return port
}

// A project as the box has it: three heads from an MVR scene (uuids -> FixtureIDs 101..103), one hand-patched head
// with an explicit fid, one head with no number at all.
const SCENE = { scene: { objects: [
	{ uuid: 'AAAA-1', name: 'a', fixture: { id: '101' } },
	{ uuid: 'AAAA-2', name: 'b', fixture: { id: '102' } },
	{ uuid: 'AAAA-3', name: 'c', fixture: { id: '103' } },
	{ uuid: 'TRUSS', name: 'truss' },
] } }
const PROJECT = { previs: { mvr: { id: 'abcdef012345' } }, fixtures: { patch: [
	{ id: 'mvr-aaaa-1' }, { id: 'mvr-aaaa-2' }, { id: 'mvr-aaaa-3' }, { id: 'hand1', fid: 900 }, { id: 'nofid' },
] } }

function fakeResolver(project = PROJECT) {
	const state = { project }
	const r = createFidResolver({ loadProject: () => state.project, loadScene: (id) => (id === 'abcdef012345' ? SCENE : null) })
	return { ...r, state }
}

describe('WO-857 FixtureID map', () => {
	it('maps MVR uuids through the scene and explicit fids, and leaves the rest alone', () => {
		const m = buildFidMap(PROJECT.fixtures.patch, (u) => sceneFids(SCENE).get(u) || 0)
		assert.deepEqual([...m.byId], [['mvr-aaaa-1', 101], ['mvr-aaaa-2', 102], ['mvr-aaaa-3', 103], ['hand1', 900]])
		assert.deepEqual(m.byFid.get(900), ['hand1'])
	})
	it('heads() and fids() are inverse, report what is unmatched, and follow the project', () => {
		const r = fakeResolver()
		assert.deepEqual(r.heads([103, 101, 7, 900, 101]), { ids: ['mvr-aaaa-3', 'mvr-aaaa-1', 'hand1'], unmatched: [7] })
		assert.deepEqual(r.fids(['hand1', 'mvr-aaaa-2', 'nofid']), { fids: [102, 900], unmatched: ['nofid'] })
		r.state.project = { fixtures: { patch: [{ id: 'mvr-aaaa-1' }] } } // no scene any more: nothing maps
		assert.deepEqual(r.heads([101]), { ids: [], unmatched: [101] })
	})
	it('a missing scene file only loses the scene numbers', () => {
		const r = createFidResolver({ loadProject: () => PROJECT, loadScene: () => { throw new Error('gone') } })
		assert.deepEqual(r.heads([101, 900]), { ids: ['hand1'], unmatched: [101] })
	})
})

describe('WO-857 packet format', () => {
	it('round-trips, ranges only from three in a row', () => {
		assert.equal(encodePacket('gma3', 7, [110, 101, 102, 111, 112, 121]), 'HACG-SEL 1 gma3 7 101,102,110-112,121')
		assert.equal(encodePacket('gma3', 8, []), 'HACG-SEL 1 gma3 8 -')
		const p = parsePacket(Buffer.from('HACG-SEL 1 gma3 7 101,102,110-112,121\n'))
		assert.deepEqual(p, { source: 'gma3', seq: 7, heads: [101, 102, 110, 111, 112, 121] })
		assert.deepEqual(parsePacket(Buffer.from('HACG-SEL 1 gma3 8 -')).heads, [])
	})
	it('rejects anything else', () => {
		for (const bad of ['', 'hello', 'HACG-SEL 2 gma3 1 1', 'HACG-SEL 1 GMA3 1 1', 'HACG-SEL 1 gma3 x 1', 'HACG-SEL 1 gma3 1 1,,2',
			'HACG-SEL 1 gma3 1 5-3', 'HACG-SEL 1 gma3 1 0', 'HACG-SEL 1 gma3 1 1-99999', 'HACG-SEL 1 gma3 1 1;rm', '\u0000HACG-SEL 1 gma3 1 1']) {
			assert.equal(parsePacket(Buffer.from(bad)), null, JSON.stringify(bad))
		}
		assert.equal(parsePacket(Buffer.alloc(20000, 49)), null)
		assert.equal(parseHeads('1-4096').length, 4096)
		assert.equal(parseHeads('1-4096,5000'), null) // over the head cap
	})
})

describe('WO-857 console-selection feed', () => {
	it('sets, resolves, broadcasts once per change and re-resolves on a project change', () => {
		const sent = []
		const r = fakeResolver({ fixtures: { patch: [] } })
		let fire = null
		const s = createConsoleSelection({ resolver: r, broadcast: (t, d) => sent.push([t, d]), now: () => 1000, onProject: (fn) => { fire = fn; return () => { fire = null } } }).start()
		assert.deepEqual(s.snapshot(), { source: '', heads: [], ids: [], unmatched: [], ts: 0 })
		let res = s.set({ source: 'gma3', heads: [101, 102, 101, '103'] })
		assert.equal(res.changed, true)
		assert.deepEqual(res.selection, { source: 'gma3', heads: [101, 102, 103], ids: [], unmatched: [101, 102, 103], ts: 1000 })
		assert.equal(s.set({ source: 'gma3', heads: [101, 102, 103] }).changed, false) // same set: silent
		assert.equal(sent.length, 1)
		r.state.project = PROJECT // the MVR arrives: the same heads now have fixtures
		fire(PROJECT)
		assert.equal(sent.length, 2)
		assert.deepEqual(sent[1][1].ids, ['mvr-aaaa-1', 'mvr-aaaa-2', 'mvr-aaaa-3'])
		assert.equal(sent[1][0], 'fixtures:console_selection')
		fire(PROJECT) // nothing new
		assert.equal(sent.length, 2)
		assert.equal(s.clear().changed, true)
		assert.deepEqual(sent[2][1].heads, [])
		s.stop()
		assert.equal(fire, null)
	})
	it('refuses bad input', () => {
		const s = createConsoleSelection({ resolver: fakeResolver() })
		assert.match(s.set({ source: 'Bad Name', heads: [] }).error, /source/)
		assert.match(s.set({ source: 'gma3', heads: 'x' }).error, /list/)
		assert.match(s.set({ source: 'gma3', heads: [1, 0] }).error, /positive/)
		assert.match(s.set({ source: 'gma3', heads: [1.5] }).error, /positive/)
		assert.match(s.set({ source: 'gma3', heads: new Array(5000).fill(1) }).error, /at most/)
		assert.equal(s.snapshot().source, '')
	})
	it('a resolver that throws leaves the heads unmatched, never an exception', () => {
		const s = createConsoleSelection({ resolver: { heads: () => { throw new Error('boom') } } })
		assert.deepEqual(s.set({ source: 'gma3', heads: [5] }).selection.unmatched, [5])
	})
})

describe('WO-857 grandMA3 plugin -> UDP listener -> feed (sender stub on loopback)', () => {
	it('feeds the common feed from the plugin packets, drops stale / garbage, ignores keep-alives', async () => {
		const sent = []
		const service = createConsoleSelection({ resolver: fakeResolver(), broadcast: (t, d) => sent.push(d) })
		const listener = new Gma3SelectionListener({ service })
		const port = await freeUdpPort()
		assert.equal(await listener.start({ port, bind: '127.0.0.1' }), port)
		assert.equal(listener.status().listening, true)
		const tx = dgram.createSocket('udp4') // the stub: what highascg_selection.lua's udp:send does
		socks.push(tx)
		const send = (text) => new Promise((r) => tx.send(Buffer.from(text), port, '127.0.0.1', r))

		await send(encodePacket('gma3', 100, [101, 102, 103]))
		await until(() => sent.length === 1, 'first selection')
		assert.deepEqual(sent[0].ids, ['mvr-aaaa-1', 'mvr-aaaa-2', 'mvr-aaaa-3'])
		assert.equal(sent[0].source, 'gma3')

		await send(encodePacket('gma3', 101, [101, 102, 103])) // keep-alive: same set, newer seq
		await send(encodePacket('gma3', 99, [900])) // older seq: a reordered / replayed packet
		await send('not a selection packet')
		await send(encodePacket('gma3', 102, [900, 7]))
		await until(() => sent.length === 2, 'second selection')
		assert.deepEqual(sent[1].ids, ['hand1'])
		assert.deepEqual(sent[1].unmatched, [7])
		assert.equal(sent.length, 2)

		await send(encodePacket('gma3', 103, [])) // nothing selected
		await until(() => sent.length === 3, 'cleared')
		assert.deepEqual(sent[2].heads, [])
		const st = listener.status()
		assert.equal(st.packets, 4)
		assert.equal(st.stale, 1)
		assert.equal(st.rejected, 1)
		assert.equal(st.last_from, '127.0.0.1')
		listener.stop()
		assert.equal(listener.status().listening, false)
	})
	it('a plugin restart (seq far below the last one) is accepted', () => {
		const sent = []
		const l = new Gma3SelectionListener({ service: { set: (x) => sent.push(x) } })
		assert.equal(l.feed(Buffer.from(encodePacket('gma3', 1790000000, [1])), { address: 'a' }), true)
		assert.equal(l.feed(Buffer.from(encodePacket('gma3', 5, [2])), { address: 'a' }), true)
		assert.equal(l.feed(Buffer.from(encodePacket('gma3', 4, [3])), { address: 'a' }), false)
		assert.deepEqual(sent.map((x) => x.heads[0]), [1, 2])
	})
	it('reports a port that is taken instead of throwing', async () => {
		const hog = dgram.createSocket('udp4')
		socks.push(hog)
		await new Promise((r) => hog.bind(0, '127.0.0.1', r))
		const l = new Gma3SelectionListener({ service: { set() {} } })
		assert.equal(await l.start({ port: hog.address().port, bind: '127.0.0.1' }), 0)
		assert.match(l.status().error, /EADDRINUSE|in use/)
	})
	it('port config: default 6290, env / config override, 0 and off disable, sandbox and tests stay off', () => {
		assert.equal(DEFAULT_PORT, 6290)
		assert.deepEqual(listenConfig({}, {}), { port: 6290, bind: '0.0.0.0' })
		assert.equal(listenConfig({ config: { lighting: { gma3SelectionPort: 7001, gma3SelectionBind: '10.0.0.2' } } }, {}).port, 7001)
		assert.equal(listenConfig({ config: { lighting: { gma3SelectionBind: '10.0.0.2' } } }, {}).bind, '10.0.0.2')
		assert.equal(listenConfig({ config: { lighting: { gma3SelectionPort: 7001 } } }, { HIGHASCG_GMA3_SELECTION_PORT: '7002' }).port, 7002)
		assert.equal(listenConfig({}, { HIGHASCG_GMA3_SELECTION_PORT: 'off' }).port, 0)
		assert.equal(listenConfig({}, { HIGHASCG_GMA3_SELECTION_PORT: '0' }).port, 0)
		assert.equal(listenConfig({}, { HIGHASCG_GMA3_SELECTION_PORT: '99999' }).port, 0)
		assert.equal(listenConfig({}, { HIGHASCG_SANDBOX: '1' }).port, 0)
		assert.equal(listenConfig({}, { NODE_TEST_CONTEXT: 'child-v8' }).port, 0)
		assert.equal(listenConfig({}, { HIGHASCG_SANDBOX: '1', HIGHASCG_GMA3_SELECTION_PORT: '7003' }).port, 7003)
	})
})

describe('WO-857 return path (OSC /cmd, no bundles)', () => {
	it('builds the command lines', () => {
		assert.equal(selectCommand([101, 102, 103, 110]), 'Fixture 101 Thru 103 + 110')
		assert.equal(selectCommand([5, 3]), 'Fixture 3 + 5')
		assert.equal(selectCommand([7]), 'Fixture 7')
		assert.equal(atCommand(50), 'At 50')
		assert.equal(atCommand('12.5'), 'At 12.5')
		assert.equal(attributeCommand('Pan', 12.5), 'Attribute "Pan" At 12.5')
		assert.equal(attributeCommand('Color Mix', -3), 'Attribute "Color Mix" At -3')
		assert.deepEqual(commandsFor({ action: 'attribute', fids: [1, 2], attribute: 'Tilt', value: 30 }), ['Fixture 1 + 2', 'Attribute "Tilt" At 30'])
		assert.deepEqual(commandsFor({ action: 'at', level: 100 }), ['At 100'])
	})
	it('refuses what is not a plain command', () => {
		for (const f of [() => selectCommand([]), () => selectCommand([0]), () => selectCommand(['1; Delete']), () => atCommand(101), () => atCommand(''),
			() => attributeCommand('Pan" At 1; Delete "x', 1), () => attributeCommand('Pan', 'x'), () => attributeCommand('', 1),
			() => commandsFor({ action: 'delete' }), () => selectCommand(Array.from({ length: 300 }, (_, i) => i * 2 + 1))]) {
			assert.throws(f)
		}
	})

	async function setup() {
		const rx = dgram.createSocket('udp4')
		socks.push(rx)
		const got = []
		const raw = []
		rx.on('message', (buf) => {
			raw.push(buf)
			got.push(osc.readPacket(buf, { metadata: true }))
		})
		await new Promise((r) => rx.bind(0, '127.0.0.1', r))
		const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wo857-'))
		dirs.push(d)
		const lighting = createLightingService(null, { file: path.join(d, 'lighting-consoles.json') })
		lighting.upsert({ id: 'ma3', name: 'MA3 onPC', kind: 'grandma3', host: '127.0.0.1', port: rx.address().port })
		lighting.upsert({ id: 'mq', name: 'MagicQ', kind: 'magicq', host: '127.0.0.1', port: rx.address().port })
		const sel = createConsoleSelection({ resolver: fakeResolver() })
		const ctx = { lightingConsoles: lighting, consoleSelection: sel }
		const routes = new RouteRegistry()
		consoleRoutes.register(routes)
		const call = async (m, p, body) => {
			const r = await routes.dispatch(m, p, body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body), ctx, null, {})
			return { status: r.status, json: JSON.parse(r.body) }
		}
		return { call, got, raw, ctx }
	}
	const wire = (m) => `${m.address} ${m.args.map((a) => `${a.type}:${a.value}`).join(' ')}`

	it('POST .../send types select + attribute into the console as /cmd messages, in order, never as a bundle', async () => {
		const { call, got, raw } = await setup()
		const r = await call('POST', '/api/fixtures/console-selection/send',
			{ console: 'ma3', action: 'attribute', ids: ['mvr-aaaa-1', 'mvr-aaaa-2', 'mvr-aaaa-3', 'hand1', 'nofid'], attribute: 'Pan', value: 12.5 })
		assert.equal(r.status, 200)
		assert.deepEqual(r.json.sent, ['Fixture 101 Thru 103 + 900', 'Attribute "Pan" At 12.5'])
		assert.deepEqual(r.json.unmatched, ['nofid'])
		await until(() => got.length === 2, 'two datagrams')
		assert.deepEqual(got.map(wire), ['/cmd s:Fixture 101 Thru 103 + 900', '/cmd s:Attribute "Pan" At 12.5'])
		for (const b of raw) assert.notEqual(b.subarray(0, 7).toString('latin1'), '#bundle')
		assert.equal(raw[0][0], 0x2f) // an OSC message starts with the address '/'
		got.length = 0
		assert.equal((await call('POST', '/api/fixtures/console-selection/send', { console: 'ma3', action: 'at', level: 50 })).status, 200)
		assert.equal((await call('POST', '/api/fixtures/console-selection/send', { console: 'ma3', action: 'select', heads: [7, 8, 9] })).status, 200)
		await until(() => got.length === 2, 'two more')
		assert.deepEqual(got.map(wire), ['/cmd s:At 50', '/cmd s:Fixture 7 Thru 9'])
	})
	it('answers 400 / 404 for bad requests and sends nothing', async () => {
		const { call, got } = await setup()
		const url = '/api/fixtures/console-selection/send'
		assert.equal((await call('POST', url, '{oops')).status, 400)
		assert.equal((await call('POST', url, { console: 'ma3', action: 'at', level: 500 })).status, 400)
		assert.equal((await call('POST', url, { console: 'ma3', action: 'select', heads: [] })).status, 400)
		assert.equal((await call('POST', url, { console: 'nope', action: 'at', level: 5 })).status, 404)
		const mq = await call('POST', url, { console: 'mq', action: 'at', level: 5 })
		assert.equal(mq.status, 400)
		assert.match(mq.json.error, /grandMA3/)
		await wait(60)
		assert.equal(got.length, 0)
	})
	it('GET / POST /api/fixtures/console-selection: inject, read back, 400 on bad input', async () => {
		const { call, ctx } = await setup()
		assert.deepEqual((await call('GET', '/api/fixtures/console-selection')).json, { selection: ctx.consoleSelection.snapshot(), listener: null })
		const p = await call('POST', '/api/fixtures/console-selection', { source: 'test', heads: [101, 900] })
		assert.equal(p.status, 200)
		assert.deepEqual(p.json.selection.ids, ['mvr-aaaa-1', 'hand1'])
		assert.deepEqual((await call('GET', '/api/fixtures/console-selection')).json.selection.heads, [101, 900])
		assert.equal((await call('POST', '/api/fixtures/console-selection', { source: 'test', heads: ['x'] })).status, 400)
		assert.equal((await call('POST', '/api/fixtures/console-selection', '[bad')).status, 400)
	})
})

describe('WO-857 wiring', () => {
	it('the real router registers the routes ahead of any wildcard, and the fixture service starts the feed', () => {
		const { routes } = require('../../src/api/router')
		const first = (m, p) => routes.routes.find((r) => r.method === m && r.regex.test(p))
		for (const [m, p] of [['GET', '/api/fixtures/console-selection'], ['POST', '/api/fixtures/console-selection'], ['POST', '/api/fixtures/console-selection/send']]) {
			assert.equal(first(m, p)?.path, p, `${m} ${p}`)
			assert.equal(first(m, p).options.requireCaspar, false)
		}
		const follow = fs.readFileSync(path.join(__dirname, '../../src/fixtures/follow-service.js'), 'utf8')
		assert.match(follow, /startConsoleSelection\(ctx, log\)/)
		assert.match(follow, /consoleSel\.stop\(\)/)
	})
	it('getService keeps one feed per ctx and broadcasts through ctx._wsBroadcast', () => {
		const sent = []
		const ctx = { _wsBroadcast: (t, d) => sent.push([t, d]) }
		const s = getService(ctx)
		assert.equal(getService(ctx), s)
		s.set({ source: 'test', heads: [3] })
		assert.equal(sent[0][0], 'fixtures:console_selection')
	})
	it('the Lua plugin sends the exact wire format the listener parses', () => {
		const lua = fs.readFileSync(path.join(__dirname, '../lighting/grandma3/highascg_selection.lua'), 'utf8')
		assert.match(lua, /"HACG-SEL 1 gma3 %d %s"/)
		assert.match(lua, /udp:setpeername\(host, port\)/)
		assert.match(lua, /local PORT = 6290/)
		assert.equal(DEFAULT_PORT, 6290)
		assert.match(lua, /SelectionFirst\(\)[\s\S]*SelectionNext\(idx\)/)
		assert.match(lua, /HookObjectChange\(/)
		assert.match(lua, /return Main, Cleanup/)
	})
})
