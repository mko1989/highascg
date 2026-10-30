'use strict'

/**
 * WO-837 phase 1 — lighting consoles: store validation, each driver's exact OSC messages / UDP datagrams (against a
 * local receiver on 127.0.0.1, ephemeral port), the HTTP routes, and the router order. Nothing leaves loopback.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const dgram = require('dgram')
const fs = require('fs')
const os = require('os')
const path = require('path')
const osc = require('osc')

const { validateConsole, loadConsoles, saveConsoles } = require('../../src/lighting-console/console-store')
const { normalizeAction } = require('../../src/lighting-console/actions')
const { driverFor } = require('../../src/lighting-console/console-models')
const { createLightingService } = require('../../src/lighting-console/console-service')
const { RouteRegistry } = require('../../src/api/route-registry')
const lightingRoutes = require('../../src/api/routes-lighting')

const dirs = []
const tmpFile = () => {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wo837-light-'))
	dirs.push(d)
	return path.join(d, 'lighting-consoles.json')
}
const receivers = []
after(() => {
	for (const r of receivers) r.close()
	for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
})

/** UDP receiver on 127.0.0.1:<ephemeral>; collect(n) → the next n decoded OSC messages. */
async function receiver() {
	const sock = dgram.createSocket('udp4')
	const got = []
	sock.on('message', (buf) => got.push(osc.readPacket(buf, { metadata: true })))
	await new Promise((r) => sock.bind(0, '127.0.0.1', r))
	receivers.push(sock)
	return {
		port: sock.address().port,
		close: () => sock.close(),
		collect: (n) =>
			new Promise((resolve, reject) => {
				const t = setTimeout(() => reject(new Error(`expected ${n} datagrams, got ${got.length}`)), 1500)
				const check = () => {
					if (got.length >= n) {
						clearTimeout(t)
						resolve(got.splice(0, n))
					} else setTimeout(check, 5)
				}
				check()
			}),
	}
}

const wire = (m) => `${m.address} ${m.args.map((a) => `${a.type}:${a.value}`).join(' ')}`.trim()

describe('WO-837 console store validation', () => {
	const ok = { id: 'mq1', name: 'MagicQ', kind: 'magicq', host: '10.0.0.5', port: 8000 }
	it('accepts a full record and defaults the port from the kind', () => {
		assert.deepEqual(validateConsole(ok), { ok: true, console: ok })
		const { port: _p, ...noPort } = ok
		assert.equal(validateConsole(noPort).console.port, 8000)
	})
	it('rejects bad id / name / kind / host / port', () => {
		const err = (patch) => validateConsole({ ...ok, ...patch })
		assert.match(err({ id: 'Bad Id' }).error, /id/)
		assert.match(err({ name: '' }).error, /name/)
		assert.match(err({ name: 'x'.repeat(41) }).error, /name/)
		assert.match(err({ kind: 'dmx512' }).error, /kind/)
		assert.match(err({ host: 'a b' }).error, /host/)
		assert.match(err({ host: '1.2.3.4/evil' }).error, /host/)
		assert.match(err({ port: 0 }).error, /port/)
		assert.match(err({ port: 70000 }).error, /port/)
		assert.match(err({ port: '8000' }).error, /port/)
		assert.equal(validateConsole(null).ok, false)
	})
	it('generic OSC needs a port; prefix and templates are kind-scoped and checked', () => {
		const g = { name: 'Gen', kind: 'osc', host: 'lights.local', id: 'g1' }
		assert.match(validateConsole(g).error, /port is required/)
		const t = { go: { address: '/pb/{list}/go', args: [1, '{cue}'] } }
		assert.equal(validateConsole({ ...g, port: 9000, templates: t }).ok, true)
		assert.match(validateConsole({ ...g, port: 9000, templates: { go: { address: 'pb' } } }).error, /address/)
		assert.match(validateConsole({ ...g, port: 9000, templates: { nope: { address: '/x' } } }).error, /unknown action/)
		assert.match(validateConsole({ ...ok, templates: t }).error, /only for generic/)
		assert.match(validateConsole({ ...ok, prefix: 'gma3' }).error, /only for grandMA3/)
		assert.match(validateConsole({ ...ok, kind: 'grandma3', prefix: 'a/b' }).error, /prefix/)
		assert.equal(validateConsole({ ...ok, kind: 'grandma3', prefix: 'gma3' }).console.prefix, 'gma3')
	})
	it('persists atomically and drops invalid / duplicate records on load', () => {
		const f = tmpFile()
		assert.equal(saveConsoles([ok, { ...ok, id: 'bad id' }, ok], f), true)
		assert.deepEqual(loadConsoles(f), [ok])
		assert.deepEqual(loadConsoles(path.join(path.dirname(f), 'missing.json')), [])
	})
	it('action validation keeps junk out of OSC addresses', () => {
		assert.deepEqual(normalizeAction({ action: 'go', list: 2, cue: '2.5' }), { action: 'go', list: '2', cue: '2.5' })
		assert.throws(() => normalizeAction({ action: 'go', list: '1/../x' }), /list/)
		assert.throws(() => normalizeAction({ action: 'go' }), /list/)
		assert.throws(() => normalizeAction({ action: 'fader', fader: 1, level: 101 }), /level/)
		assert.throws(() => normalizeAction({ action: 'fader', fader: 1, level: '' }), /level/)
		assert.throws(() => normalizeAction({ action: 'command', command: 'a\nb' }), /command/)
		assert.throws(() => normalizeAction({ action: 'blackout' }), /unknown action/)
	})
})

describe('WO-837 driver wire formats (pure messages)', () => {
	const msgs = (con, a) => driverFor(con.kind).messages(con, normalizeAction(a)).map(wire)
	it('MagicQ: /pb/<n>/go, /pb/<n>/<cue>, /pb/<n> level, /pb/<n>/release, /rpc', () => {
		const c = { kind: 'magicq' }
		assert.deepEqual(msgs(c, { action: 'go', list: 3 }), ['/pb/3/go i:1'])
		assert.deepEqual(msgs(c, { action: 'go', list: 3, cue: '2.5' }), ['/pb/3/2.5 i:1'])
		assert.deepEqual(msgs(c, { action: 'fader', fader: 4, level: 75 }), ['/pb/4 i:75'])
		assert.deepEqual(msgs(c, { action: 'release', list: 3 }), ['/pb/3/release i:1'])
		assert.deepEqual(msgs(c, { action: 'command', command: '1,5A' }), ['/rpc s:1,5A'])
	})
	it('Eos: cue fire, newcmd, virtual fader bank, # terminator', () => {
		const c = { kind: 'eos' }
		assert.deepEqual(msgs(c, { action: 'go', list: 3, cue: 9 }), ['/eos/cue/3/9/fire'])
		assert.deepEqual(msgs(c, { action: 'go', list: 2 }), ['/eos/newcmd s:Cue 2 Go#'])
		assert.deepEqual(msgs(c, { action: 'fader', fader: 3, level: 50 }), ['/eos/fader/1/config/10', '/eos/fader/1/3 f:0.5'])
		assert.deepEqual(msgs(c, { action: 'fader', fader: '2.12', level: 100 }), ['/eos/fader/2/config/12', '/eos/fader/2/12 f:1'])
		assert.deepEqual(msgs(c, { action: 'release', list: 2 }), ['/eos/newcmd s:Cue 2 Release#'])
		assert.deepEqual(msgs(c, { action: 'command', command: 'Chan 1 At 50' }), ['/eos/newcmd s:Chan 1 At 50#'])
		assert.deepEqual(msgs(c, { action: 'command', command: 'Chan 1 At 50#' }), ['/eos/newcmd s:Chan 1 At 50#'])
	})
	it('grandMA3: /cmd strings and /Page<p>/Fader<n>, optional prefix', () => {
		const c = { kind: 'grandma3' }
		assert.deepEqual(msgs(c, { action: 'go', list: 3 }), ['/cmd s:Go+ Sequence 3'])
		assert.deepEqual(msgs(c, { action: 'go', list: '1.101', cue: 4 }), ['/cmd s:Goto Cue 4 Executor 1.101'])
		assert.deepEqual(msgs(c, { action: 'fader', fader: 201, level: 100 }), ['/Page1/Fader201 i:100'])
		assert.deepEqual(msgs(c, { action: 'fader', fader: '2.201', level: 30 }), ['/Page2/Fader201 i:30'])
		assert.deepEqual(msgs(c, { action: 'release', list: 3 }), ['/cmd s:Off Sequence 3'])
		assert.deepEqual(msgs(c, { action: 'command', command: 'Fixture 1 At 75' }), ['/cmd s:Fixture 1 At 75'])
		assert.deepEqual(msgs({ kind: 'grandma3', prefix: 'gma3' }, { action: 'fader', fader: 201, level: 5 }), ['/gma3/Page1/Fader201 i:5'])
		assert.deepEqual(msgs({ kind: 'grandma3', prefix: 'gma3' }, { action: 'command', command: 'Go+' }), ['/gma3/cmd s:Go+'])
	})
	it('generic OSC: templates fill placeholders; a missing template is a clear error', () => {
		const c = {
			kind: 'osc',
			name: 'Gen',
			templates: {
				go: { address: '/pb/{list}/go', args: [1] },
				goCue: { address: '/pb/{list}/cue', args: ['{cue}', 'go {list}'] },
				fader: { address: '/fader/{fader}', args: ['{level01}'] },
				command: { address: '/cmd', args: ['{command}'] },
			},
		}
		assert.deepEqual(msgs(c, { action: 'go', list: 7 }), ['/pb/7/go i:1'])
		assert.deepEqual(msgs(c, { action: 'go', list: 7, cue: 3 }), ['/pb/7/cue i:3 s:go 7'])
		assert.deepEqual(msgs(c, { action: 'fader', fader: 2, level: 25 }), ['/fader/2 f:0.25'])
		assert.deepEqual(msgs(c, { action: 'command', command: 'hi' }), ['/cmd s:hi'])
		assert.throws(() => msgs(c, { action: 'release', list: 1 }), /no "release" address template/)
		const noCue = { ...c, templates: { go: { address: '/pb/{list}/{cue}', args: [] } } }
		assert.throws(() => msgs(noCue, { action: 'go', list: 1 }), /uses \{cue\}/)
		assert.throws(() => driverFor('nope'), /unknown/)
	})
})

describe('WO-837 UDP bytes through the service (127.0.0.1 receiver)', () => {
	it('sends the driver messages to the console host:port and test() sends the harmless one', async () => {
		const rx = await receiver()
		const svc = createLightingService(null, { file: tmpFile() })
		const add = svc.upsert({ id: 'mq', name: 'MQ', kind: 'magicq', host: '127.0.0.1', port: rx.port })
		assert.equal(add.ok, true)
		const r = await svc.fire('mq', { action: 'go', list: 2, cue: 5, type: 'light', timeMs: 100, label: 'x' })
		assert.deepEqual(r.sent, ['/pb/2/5'])
		assert.deepEqual((await rx.collect(1)).map(wire), ['/pb/2/5 i:1'])
		await svc.fire('mq', { action: 'fader', fader: 1, level: 80 })
		assert.deepEqual((await rx.collect(1)).map(wire), ['/pb/1 i:80'])
		const t = await svc.test('mq')
		assert.equal(t.ok, true)
		assert.deepEqual((await rx.collect(1)).map(wire), ['/feedback/off'])

		svc.upsert({ id: 'eos', name: 'Eos', kind: 'eos', host: '127.0.0.1', port: rx.port })
		await svc.fire('eos', { action: 'fader', fader: 2, level: 25 })
		assert.deepEqual((await rx.collect(2)).map(wire), ['/eos/fader/1/config/10', '/eos/fader/1/2 f:0.25']) // float32-exact
		await svc.test('eos')
		assert.deepEqual((await rx.collect(1)).map(wire), ['/eos/ping s:HighAsCG'])

		svc.upsert({ id: 'ma', name: 'MA', kind: 'grandma3', host: '127.0.0.1', port: rx.port })
		await svc.fire('ma', { action: 'command', command: 'Go+ Sequence 1' })
		assert.deepEqual((await rx.collect(1)).map(wire), ['/cmd s:Go+ Sequence 1'])
		await svc.test('ma')
		assert.deepEqual((await rx.collect(1)).map(wire), ['/cmd s:Echo "HighAsCG link test"'])
	})
	it('unknown console / bad action reject with a readable error and send nothing', async () => {
		const svc = createLightingService(null, { file: tmpFile(), send: () => assert.fail('must not send') })
		await assert.rejects(svc.fire('ghost', { action: 'go', list: 1 }), /not configured/)
		svc.upsert({ id: 'g', name: 'G', kind: 'osc', host: '127.0.0.1', port: 9, templates: {} })
		await assert.rejects(svc.fire('g', { action: 'go', list: 1 }), /no "go" address template/)
		await assert.rejects(svc.fire('g', { action: 'fader', fader: 1, level: 200 }), /level/)
		assert.equal((await svc.test('g')).ok, false)
		assert.equal((await svc.test('nobody')).status, 404)
	})
	it('the store survives a restart (new service, same file)', () => {
		const f = tmpFile()
		createLightingService(null, { file: f }).upsert({ id: 'a', name: 'A', kind: 'eos', host: '1.2.3.4', port: 8001 })
		assert.deepEqual(createLightingService(null, { file: f }).list(), [{ id: 'a', name: 'A', kind: 'eos', host: '1.2.3.4', port: 8001 }])
	})
})

describe('WO-837 HTTP routes', () => {
	function setup() {
		const routes = new RouteRegistry()
		lightingRoutes.register(routes)
		const ctx = { lightingConsoles: createLightingService(null, { file: tmpFile() }) }
		const call = async (m, p, body) => {
			const r = await routes.dispatch(m, p, body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body), ctx, null, {})
			return { status: r.status, json: JSON.parse(r.body) }
		}
		return { call, ctx }
	}
	it('CRUD + malformed JSON 400 + validation 400', async () => {
		const { call } = setup()
		assert.deepEqual((await call('GET', '/api/lighting/consoles')).json.consoles, [])
		assert.ok((await call('GET', '/api/lighting/consoles')).json.kinds.some((k) => k.kind === 'grandma3'))
		const bad = await call('POST', '/api/lighting/consoles', '{not json')
		assert.equal(bad.status, 400)
		assert.match(bad.json.error, /JSON/)
		const inv = await call('POST', '/api/lighting/consoles', { name: 'x', kind: 'zzz', host: 'h' })
		assert.equal(inv.status, 400)
		const add = await call('POST', '/api/lighting/consoles', { name: 'Front', kind: 'magicq', host: '10.1.1.1' })
		assert.equal(add.status, 200)
		const id = add.json.console.id
		assert.match(id, /^c[0-9a-f]{8}$/)
		assert.equal(add.json.console.port, 8000)
		assert.equal((await call('GET', `/api/lighting/consoles/${id}`)).json.console.name, 'Front')
		assert.equal((await call('POST', '/api/lighting/consoles', { id, name: 'Renamed', kind: 'magicq', host: '10.1.1.1', port: 8001 })).json.console.port, 8001)
		assert.equal((await call('GET', '/api/lighting/consoles')).json.consoles.length, 1)
		assert.equal((await call('DELETE', `/api/lighting/consoles/${id}`)).status, 200)
		assert.equal((await call('DELETE', `/api/lighting/consoles/${id}`)).status, 404)
		assert.equal((await call('GET', `/api/lighting/consoles/${id}`)).status, 404)
		const again = await call('POST', '/api/lighting/consoles', { id: 'k1', name: 'K', kind: 'eos', host: 'h.local' })
		assert.equal(again.status, 200)
		assert.equal((await call('DELETE', '/api/lighting/consoles', { id: 'k1' })).status, 200)
		assert.equal((await call('DELETE', '/api/lighting/consoles', '[oops')).status, 400)
	})
	it('POST /:id/test sends to the console; unknown id 404', async () => {
		const rx = await receiver()
		const { call } = setup()
		await call('POST', '/api/lighting/consoles', { id: 'e1', name: 'E', kind: 'eos', host: '127.0.0.1', port: rx.port })
		const t = await call('POST', '/api/lighting/consoles/e1/test', {})
		assert.equal(t.status, 200)
		assert.deepEqual(t.json.sent, ['/eos/ping'])
		assert.deepEqual((await rx.collect(1)).map(wire), ['/eos/ping s:HighAsCG'])
		assert.equal((await call('POST', '/api/lighting/consoles/zz/test', {})).status, 404)
	})
	it('on the real router the lighting routes are registered and no earlier route swallows them', () => {
		const { routes } = require('../../src/api/router')
		const first = (m, p) => routes.routes.find((r) => r.method === m && r.regex.test(p))
		for (const [m, p, want] of [
			['GET', '/api/lighting/consoles', '/api/lighting/consoles'],
			['POST', '/api/lighting/consoles', '/api/lighting/consoles'],
			['DELETE', '/api/lighting/consoles', '/api/lighting/consoles'],
			['GET', '/api/lighting/consoles/x', '/api/lighting/consoles/:id'],
			['DELETE', '/api/lighting/consoles/x', '/api/lighting/consoles/:id'],
			['POST', '/api/lighting/consoles/x/test', '/api/lighting/consoles/:id/test'],
		]) {
			assert.equal(first(m, p)?.path, want, `${m} ${p}`)
			assert.equal(first(m, p).options.requireCaspar, false)
		}
	})
})
