'use strict'
/**
 * WO-1085 — spot handover in the follow engine (src/fixtures/follow-handover.js): the Dimmer from the level (own DMX,
 * programmer intensity), read-through with the LD's grant channel (granted / revoked / per head / a lost console that
 * holds then releases with a fade), the "automation levels" universe (content, PSN-only mode, collision and self-loop
 * guards), Split mode byte-for-byte unchanged, and the real Auto director feeding it. Typed heads use the synthetic
 * tools/fixtures/gdtf/test-spot.xml (Standard: Pan 1/2, Tilt 3/4, Dimmer @6, footprint 7).
 */
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { parseDescription } = require('../../src/fixtures/gdtf-parse')
const { FollowEngine } = require('../../src/fixtures/follow-engine')
const { normalizeHandover, GRANT_HOLD_MS, EXTRA_CH } = require('../../src/fixtures/follow-handover')
const { decodeArtDmx, encodeArtDmx } = require('../../src/fixtures/artdmx')
const { STALE_MS } = require('../../src/fixtures/follow-through')
const { MarkerHub } = require('../../src/tracking/marker-hub')
const { AUTO_MARKER_ID } = require('../../src/tracking/auto-follow')
const { createAutoDirector } = require('../../src/tracking/auto-director')
const { normalizeDetection } = require('../../src/tracking/detect-model')

const ROOT = path.join(__dirname, '../..')
const TYPE = 'aaaaaaaaaaaa'
const DIM = 6 // the Dimmer's offset in the Standard mode
const DT = 25
let modes = null
before(async () => {
	modes = (await parseDescription(fs.readFileSync(path.join(ROOT, 'tools/fixtures/gdtf/test-spot.xml'), 'utf8'))).modes
})
const tmpDirs = []
after(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

const patch = (n = 8) =>
	Array.from({ length: n }, (_, i) => ({ id: `h${i + 1}`, name: `Head ${i + 1}`, typeId: TYPE, mode: 'Standard', universe: 1,
		address: 1 + 10 * i, dest: '127.0.0.1:6455', follow: AUTO_MARKER_ID, pose: { x: -7 + 2 * i, y: 0, z: 6 } }))

/** A fake console: frames per port-address, fresh while fed (STALE_MS), the last one held. */
function fakeConsole(clock) {
	const frames = new Map()
	return {
		feed(pa, data) {
			frames.set(pa, { data: Uint8Array.from(data), at: clock() })
		},
		frame(pa, now = clock()) {
			const f = frames.get(pa)
			return f && now - f.at <= STALE_MS ? f.data : null
		},
		last: (pa) => frames.get(pa)?.data || null,
	}
}

function rig({ handover = { mode: 'handover' }, output = {}, dmx = { enabled: true, universes: ['artnet:1'] }, withConsole = false, selfLoop = () => false, reachesSelf = () => false } = {}) {
	let t = 1000
	const clock = () => t
	const hub = new MarkerHub({ now: clock })
	const sent = []
	const cons = withConsole ? fakeConsole(clock) : null
	const eng = new FollowEngine({ hub, now: clock, send: (to, pkt) => sent.push({ to, t, d: decodeArtDmx(pkt) }), consoleFrames: cons,
		isSelfLoop: selfLoop, reachesSelf, resolveMode: (id, name) => (id === TYPE ? modes.find((m) => m.name === name) || null : null) })
	eng.resolveAuto = (fx, marks) => marks.get(AUTO_MARKER_ID) || null
	eng.autoLanes = () => ({ lanes: hub.markers.has(AUTO_MARKER_ID) ? [{ id: 1, marker: AUTO_MARKER_ID }] : [], home: null })
	eng.configure({ output: { enabled: true, protocol: 'artnet', ...output }, dmx, ...(handover ? { handover } : {}), patch: patch() }) // null = no key
	const person = (x, y = 3) => hub.set({ id: AUTO_MARKER_ID, x, y, z: 0, status: 1 })
	const tick = (ms = DT) => {
		t += ms
		return eng.tick()
	}
	const run = (seconds, fn = () => {}) => {
		for (let k = 0; k < (seconds * 1000) / DT; k++) {
			fn(t)
			tick()
		}
	}
	const byte = (i, off) => eng.frameOf(eng.fixtures[i])[eng.fixtures[i].address - 1 + off - 1]
	const dims = () => eng.fixtures.map((_, i) => byte(i, DIM))
	return { eng, hub, sent, cons, person, tick, run, byte, dims, clock: () => t }
}

describe('WO-1085 engine: own DMX', () => {
	it('three nearest heads at full, the rest dark; a resting head holds its aim', () => {
		const r = rig()
		r.run(3, () => r.person(-1, 3))
		assert.deepEqual(r.dims(), [0, 0, 255, 255, 255, 0, 0, 0], 'h3 h4 h5 around x −1')
		r.run(4, (t) => r.person(-1 + ((t - 4000) / 1000) * 0.5, 3)) // walks 2 m to stage left, past the h3 | h6 threshold
		r.run(2, () => r.person(1, 3))
		assert.deepEqual(r.dims(), [0, 0, 0, 255, 255, 255, 0, 0], 'h6 took over from h3')
		assert.equal(r.eng.status().fixtures[2].state, 'rest')
		assert.equal(r.eng.status().fixtures[3].level, 1)
		assert.equal(r.eng.status().handover.mode, 'handover')
		const aim3 = [1, 2, 3, 4].map((o) => r.byte(2, o))
		r.run(1, () => r.person(1.5, 3))
		assert.deepEqual([1, 2, 3, 4].map((o) => r.byte(2, o)), aim3, 'the dark h3 holds its last aim')
		assert.notDeepEqual(aim3, [0x80, 0, 0x80, 0])
	})

	it('the programmer sets the spot intensity: Dimmer 0.5 → the active heads at 128', () => {
		const r = rig()
		r.eng.program(r.eng.fixtures.map((f) => f.id), { Dimmer: 0.5 })
		r.run(3, () => r.person(5, 3))
		assert.deepEqual(r.dims(), [0, 0, 0, 0, 0, 128, 128, 128])
	})

	it('a head with no Dimmer channel is listed (generic profile)', () => {
		const r = rig()
		r.eng.configure({ output: { enabled: true, protocol: 'artnet' }, handover: { mode: 'handover' },
			patch: [{ id: 'g1', follow: AUTO_MARKER_ID, dest: '127.0.0.1:6455', pose: { x: 0, y: 0, z: 6 } }] })
		assert.deepEqual(r.eng.status().handover.no_dimmer, ['g1'])
	})
})

describe('WO-1085 engine: read-through and the grant channel', () => {
	const CONSOLE = (() => {
		const d = new Uint8Array(512)
		for (let i = 0; i < 8; i++) {
			d[10 * i + 0] = 100 // pan coarse
			d[10 * i + 2] = 90 // tilt coarse
			d[10 * i + DIM - 1] = 200 // the LD's intensity
			d[10 * i + 6] = 77 // colour
		}
		return d
	})()
	const grantFrame = (v, per = null) => {
		const d = new Uint8Array(512)
		if (per) per.forEach((x, i) => (d[i] = x))
		else d[0] = v
		return d
	}
	const setup = (grant = { enabled: true, universe: 5, address: 1 }) =>
		rig({ withConsole: true, output: { through: { enabled: true, offset: 0, fade_s: 1 } }, handover: { mode: 'handover', grant } })

	it('granted: the active heads at the console intensity, the rest dark, colour still the console', () => {
		const r = setup()
		r.run(4, () => {
			r.cons.feed(1, CONSOLE)
			r.cons.feed(5, grantFrame(255))
			r.person(-1, 3)
		})
		assert.deepEqual(r.dims(), [0, 0, 200, 200, 200, 0, 0, 0])
		assert.equal(r.byte(0, 7), 77, 'colour passes through')
		assert.equal(r.eng.status().handover.grant.state, 'live')
	})

	it('revoked: every head fades back to the console frame, byte for byte', () => {
		const r = setup()
		r.run(4, () => {
			r.cons.feed(1, CONSOLE)
			r.cons.feed(5, grantFrame(255))
			r.person(-1, 3)
		})
		let prev = r.dims()
		r.run(3, () => {
			r.cons.feed(1, CONSOLE)
			r.cons.feed(5, grantFrame(40))
			r.person(-1, 3)
			const d = r.dims()
			d.forEach((v, i) => assert.ok(Math.abs(v - prev[i]) <= 6, `head ${i + 1} dimmer ${prev[i]} → ${v} in one tick (snap)`))
			prev = d
		})
		const out = r.eng.frameOf(r.eng.fixtures[0])
		for (let i = 0; i < 80; i++) assert.equal(out[i], CONSOLE[i], `channel ${i + 1}`)
	})

	it('per-head grant: a revoked head stays the console and the next one is used', () => {
		const r = setup({ enabled: true, universe: 5, address: 1, per_head: true })
		r.run(4, () => {
			r.cons.feed(1, CONSOLE)
			r.cons.feed(5, grantFrame(0, [255, 255, 255, 0, 255, 255, 255, 255]))
			r.person(-1, 3)
		})
		const d = r.dims()
		assert.equal(d[3], 200, 'h4 is the console (its 200), not ours')
		assert.equal(r.eng.status().fixtures[3].through, 'console')
		assert.equal(d.filter((v, i) => i !== 3 && v === 200).length, 3, 'three other heads lit by the automation')
	})

	it('a lost console: the grant is held for GRANT_HOLD_MS after the frame goes stale, then released with the fade', () => {
		const r = setup()
		r.run(4, () => {
			r.cons.feed(1, CONSOLE)
			r.cons.feed(5, grantFrame(255))
			r.person(-1, 3)
		})
		const lastPacket = r.clock()
		const lit = r.dims()
		r.run((STALE_MS + GRANT_HOLD_MS - 300) / 1000, () => r.person(-1, 3)) // the console is silent
		assert.deepEqual(r.dims(), lit, 'still granted while held')
		assert.equal(r.eng.status().handover.grant.state, 'held')
		let prev = r.dims()
		r.run(3, () => {
			r.person(-1, 3)
			const d = r.dims()
			d.forEach((v, i) => assert.ok(Math.abs(v - prev[i]) <= 6, `head ${i + 1} ${prev[i]} → ${v} (snap)`))
			prev = d
		})
		assert.ok(r.clock() - lastPacket > STALE_MS + GRANT_HOLD_MS)
		assert.equal(r.eng.status().handover.grant.state, 'lost')
		assert.deepEqual(r.dims(), [200, 200, 200, 200, 200, 200, 200, 200], "the console's last frame, held")
	})

	it('never seen = not granted; the grant needs read-through', () => {
		const r = setup()
		r.run(2, () => {
			r.cons.feed(1, CONSOLE)
			r.person(-1, 3)
		})
		assert.equal(r.eng.status().handover.grant.state, 'none')
		assert.deepEqual(r.dims(), Array(8).fill(200))
		const own = rig({ handover: { mode: 'handover', grant: { enabled: true } } })
		assert.equal(own.eng.status().handover.grant.needs_through, true)
	})
})

describe('WO-1085 engine: the automation levels universe', () => {
	const levels = { enabled: true, universe: 100, address: 11, dest: '127.0.0.1:6455' }

	it('head levels in patch order, then "someone followed" and A1; sent in PSN-only mode too', () => {
		const r = rig({ handover: { mode: 'handover', levels }, output: { protocol: 'psn' }, dmx: { enabled: false } })
		r.run(3, () => r.person(5, 3))
		const pkts = r.sent.filter((p) => p.d.portAddress === 100)
		assert.ok(pkts.length > 0, 'levels sent')
		assert.equal(r.sent.filter((p) => p.d.portAddress === 1).length, 0, 'the rig universe is not (PSN mode)')
		const d = pkts.at(-1).d.data
		assert.deepEqual([...d.subarray(10, 18)], [0, 0, 0, 0, 0, 255, 255, 255])
		assert.equal(d[18], 255, 'someone is followed')
		assert.equal(d[19], 255, 'A1')
		assert.equal(d[20], 0, 'A2')
		assert.equal(r.eng.status().handover.levels.live, true)
		assert.equal(EXTRA_CH, 20)
	})

	it('Split mode: following heads 255; sent only while the follow output master is on', () => {
		const r = rig({ handover: { mode: 'split', levels } })
		r.run(1, () => r.person(5, 3))
		assert.deepEqual([...r.sent.filter((p) => p.d.portAddress === 100).at(-1).d.data.subarray(10, 18)], Array(8).fill(255))
		const off = rig({ handover: { mode: 'split', levels }, output: { enabled: false }, dmx: { enabled: false } })
		off.run(1, () => off.person(5, 3))
		assert.equal(off.sent.length, 0)
	})

	it('never on a rig universe, never into this box, never read back as the console frame', () => {
		assert.match(rig({ handover: { levels: { ...levels, universe: 1 } } }).eng.status().handover.levels.problem, /rig/)
		assert.match(rig({ handover: { levels }, selfLoop: (to, u) => u === 100 }).eng.status().handover.levels.problem, /loop/)
		const back = rig({ handover: { levels: { ...levels, universe: 6 } }, output: { through: { enabled: true, offset: 5 } }, reachesSelf: () => true })
		assert.match(back.eng.status().handover.levels.problem, /read back/)
		const r = rig({ handover: { levels: { ...levels, universe: 1 } } })
		r.run(1, () => r.person(5, 3))
		assert.ok(r.sent.every((p) => p.d.data.length === 512 && p.d.portAddress === 1), 'only the rig universe went out')
	})
})

describe('WO-1085 engine: the grant scales the levels universe (PSN + levels)', () => {
	const levels = { enabled: true, universe: 100, address: 11, dest: '127.0.0.1:6455' }
	const ECHO = 10 + 8 + EXTRA_CH - 1 // after the 8 head levels, "someone followed", A1…A9, Pin 1…9
	const psn = (grant = { enabled: true, universe: 5, address: 1 }, extra = {}) =>
		rig({ withConsole: true, handover: { mode: 'handover', levels, grant, ...extra }, output: { protocol: 'psn' }, dmx: { enabled: false } })
	const grantFrame = (v, per = null) => {
		const d = new Uint8Array(512)
		if (per) per.forEach((x, i) => (d[i] = x))
		else d[0] = v
		return d
	}
	const last = (r) => r.sent.filter((p) => p.d.portAddress === 100).at(-1).d.data
	const heads = (d) => [...d.subarray(10, 18)]

	for (const [v, want] of [[0, 0], [128, 128], [255, 255]]) {
		it(`grant ${v}: head levels × ${v} / 255, presence unscaled, the echo says ${want}`, () => {
			const r = psn()
			r.run(4, () => {
				r.cons.feed(5, grantFrame(v))
				r.person(5, 3)
			})
			const d = last(r)
			assert.deepEqual(heads(d), [0, 0, 0, 0, 0, want, want, want])
			assert.equal(d[18], 255, '"someone followed" is information: never scaled')
			assert.equal(d[19], 255, 'A1 never scaled')
			assert.equal(d[ECHO], want, 'the grant HighAsCG applies, echoed')
			assert.equal(r.sent.filter((p) => p.d.portAddress === 1).length, 0, 'PSN: no rig universe')
			assert.equal(r.eng.status().handover.grant.applies, 'levels')
			assert.equal(r.eng.status().handover.grant.needs_through, false)
		})
	}

	it('a fader snapped 255 → 0 → 255 fades the levels at 1 / fade_s (never a step)', () => {
		const r = psn(undefined, { fade_s: 1 })
		r.run(4, () => {
			r.cons.feed(5, grantFrame(255))
			r.person(5, 3)
		})
		const maxStep = Math.ceil((255 * DT) / 1000) + 1
		let prev = heads(last(r))
		let lowest = 255
		for (const v of [0, 255])
			r.run(2, () => {
				r.cons.feed(5, grantFrame(v))
				r.person(5, 3)
				const h = heads(last(r))
				h.forEach((x, i) => assert.ok(Math.abs(x - prev[i]) <= maxStep, `head ${i + 1} ${prev[i]} → ${x} in one tick`))
				lowest = Math.min(lowest, h[5])
				prev = h
			})
		assert.equal(lowest, 0, 'reached 0')
		assert.deepEqual(prev, [0, 0, 0, 0, 0, 255, 255, 255], 'and back')
	})

	it('a lost console: the last grant held GRANT_HOLD_MS past stale, then the levels fade to 0', () => {
		const r = psn()
		r.run(4, () => {
			r.cons.feed(5, grantFrame(255))
			r.person(5, 3)
		})
		r.run((STALE_MS + GRANT_HOLD_MS - 300) / 1000, () => r.person(5, 3))
		assert.deepEqual(heads(last(r)), [0, 0, 0, 0, 0, 255, 255, 255], 'held')
		assert.equal(r.eng.status().handover.grant.state, 'held')
		let prev = heads(last(r))
		r.run(2, () => {
			r.person(5, 3)
			const h = heads(last(r))
			h.forEach((x, i) => assert.ok(Math.abs(x - prev[i]) <= 8, `head ${i + 1} ${prev[i]} → ${x} (step)`))
			prev = h
		})
		assert.equal(r.eng.status().handover.grant.state, 'lost')
		assert.deepEqual(prev, Array(8).fill(0), 'stopped asking for light')
		assert.equal(last(r)[18], 255, 'still says someone is followed')
		assert.equal(last(r)[ECHO], 0)
	})

	it('never seen = 0; per-head grant scales each head; levels on the grant universe refused', () => {
		const r = psn()
		r.run(2, () => r.person(5, 3))
		assert.deepEqual(heads(last(r)), Array(8).fill(0))
		assert.equal(r.eng.status().handover.grant.state, 'none')
		const p = psn({ enabled: true, universe: 5, address: 1, per_head: true })
		p.run(4, () => {
			p.cons.feed(5, grantFrame(0, [255, 255, 255, 255, 255, 255, 0, 128]))
			p.person(5, 3)
		})
		assert.deepEqual(heads(last(p)), [0, 0, 0, 0, 0, 255, 0, 128])
		assert.equal(last(p)[ECHO], Math.round(((6 * 255 + 128) / 8 / 255) * 255), 'the echo: the mean')
		const clash = rig({ handover: { levels: { ...levels, universe: 5 }, grant: { enabled: true, universe: 5 } } })
		assert.match(clash.eng.status().handover.levels.problem, /grant/)
	})

	it('no grant configured: full scale and the echo channel 0, as before', () => {
		const r = psn({ enabled: false })
		r.run(3, () => r.person(5, 3))
		const d = last(r)
		assert.deepEqual(heads(d), [0, 0, 0, 0, 0, 255, 255, 255])
		assert.equal(d[ECHO], 0)
		assert.equal(r.eng.status().handover.grant.applied, null)
	})

	it('wiring: the console input is listened to whenever a grant is configured', () => {
		const svc = fs.readFileSync(path.join(ROOT, 'src/fixtures/follow-service.js'), 'utf8')
		assert.match(svc, /\|\| engine\.handover\.cfg\.grant\.enabled \|\| vis\.length\) consoleFrames\.start\(\)/)
	})
})

describe('WO-1085 engine: Split stays what it was', () => {
	it('no handover key, or mode split with grant / levels off: the same packets byte for byte', () => {
		const walk = (r) => {
			r.run(6, (t) => r.person(-7 + (t - 1000) / 500, 3))
			return r.sent.map((p) => Buffer.from(encodeArtDmx({ portAddress: p.d.portAddress, sequence: p.d.sequence, data: p.d.data })).toString('hex'))
		}
		const plain = rig({ handover: null })
		const split = rig({ handover: { mode: 'split', heads: 2, margin_m: 2, fade_s: 3, levels: { enabled: false }, grant: { enabled: false } } })
		const a = walk(plain)
		assert.ok(a.length > 10)
		assert.deepEqual(walk(split), a)
		assert.deepEqual(plain.dims(), Array(8).fill(0), 'Split never touches the Dimmer (the GDTF default)')
		assert.equal(normalizeHandover(undefined).mode, 'split')
	})
})

describe('WO-1085 engine + the real Auto director', () => {
	it("a detected person: the director's lanes feed the handover, its snapshot shows the handover's heads", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1085-'))
		tmpDirs.push(dir)
		const r = rig()
		const director = createAutoDirector({ file: path.join(dir, 'tracking-auto.json') })
		r.eng.resolveAuto = director.resolveAuto
		r.eng.autoLanes = director.handoverInput
		const cfg = normalizeDetection({ enabled: true, pin_mode: 'assist', smoothing: 1, prediction: 0 })
		const persons = [{ key: 'w:1', camera: 'world', tid: 1, world: [3, 3], score: 0.9, age_s: 0, area: 5000 }]
		r.run(3, (t) => director.step({ cfg, available: true, persons, hub: r.hub, planeZ: 0, now: t, dt: DT / 1000, fixtures: r.eng.fixtures }))
		assert.deepEqual(r.dims(), [0, 0, 0, 0, 255, 255, 255, 0])
		assert.deepEqual(director.snapshot().persons[0].heads.sort(), ['h5', 'h6', 'h7'])
		r.eng.configure({ output: { enabled: true, protocol: 'artnet' }, dmx: { enabled: true, universes: ['artnet:1'] }, patch: patch() })
		r.run(0.2, (t) => director.step({ cfg, available: true, persons, hub: r.hub, planeZ: 0, now: t, dt: DT / 1000, fixtures: r.eng.fixtures }))
		assert.equal(director.snapshot().persons[0].heads.length, 8, 'back to Split: the whole pool')
	})

	it('wiring: register.js hands the engine the lanes; the engine steps the handover every tick', () => {
		const reg = fs.readFileSync(path.join(ROOT, 'src/tracking/register.js'), 'utf8')
		assert.match(reg, /_follow\.engine\.autoLanes = auto\.handoverInput/)
		const eng = fs.readFileSync(path.join(ROOT, 'src/fixtures/follow-engine.js'), 'utf8')
		assert.match(eng, /this\.handover\.step\(now, marks\)/)
		assert.match(eng, /if \(hd\) this\.handover\.dim\(u\.buf, fx, hd, cf, this\._w\.get\(fx\.id\)\)/)
		assert.match(fs.readFileSync(path.join(ROOT, 'src/fixtures/follow-patch.js'), 'utf8'), /handover: normalizeHandover\(s\.handover\)/)
	})
})
