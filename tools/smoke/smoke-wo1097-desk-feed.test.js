'use strict'
/**
 * WO-1097 — the desk feed (src/fixtures/desk-feed.js + desk-feed-layout.js): the layout builder against the patch
 * (16-bit, invert, a head with no fine / no dimmer, heads on two rig universes), the refusals, hold-last / dimmer 0
 * for heads not fed (rest, nobody, parked after leaving the pool), the feed bytes identical to the engine's own frame
 * for the same tick (mirror, byte for byte, through a walk with take-overs), compact content, refresh rate, the off
 * switch independent of the rig masters, sACN priority, the CSV table, and the wiring pins.
 * Typed heads: tools/fixtures/gdtf/test-spot.xml (Standard: Pan 1/2, Tilt 3/4 (physically inverted), Dimmer @6 8-bit).
 */
const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { parseDescription } = require('../../src/fixtures/gdtf-parse')
const { FollowEngine } = require('../../src/fixtures/follow-engine')
const { normalizePatch } = require('../../src/fixtures/follow-patch')
const { decodeArtDmx, encodeArtDmx } = require('../../src/fixtures/artdmx')
const { decodeE131 } = require('../../src/fixtures/sacn')
const { MarkerHub } = require('../../src/tracking/marker-hub')
const { AUTO_MARKER_ID } = require('../../src/tracking/auto-follow')
const L = require('../../src/fixtures/desk-feed-layout')

const ROOT = path.join(__dirname, '../..')
const TYPE = 'aaaaaaaaaaaa'
const DT = 25
const DESK = '127.0.0.1:6455'
let modes = null
before(async () => {
	modes = (await parseDescription(fs.readFileSync(path.join(ROOT, 'tools/fixtures/gdtf/test-spot.xml'), 'utf8'))).modes
})
const resolveMode = (id, name) => (id === TYPE ? modes.find((m) => m.name === name) || null : null)

const heads = (n = 8, extra = {}) =>
	Array.from({ length: n }, (_, i) => ({ id: `h${i + 1}`, name: `Head ${i + 1}`, typeId: TYPE, mode: 'Standard', universe: 1,
		address: 1 + 10 * i, dest: '127.0.0.1:6455', follow: AUTO_MARKER_ID, pose: { x: -7 + 2 * i, y: 0, z: 6 }, ...extra }))

/** An engine on the test rig; `feed` = project.fixtures.feed. Packets split into rig / feed by universe. */
function rig({ feed = { enabled: true, dest: DESK }, handover = { mode: 'handover' }, output = { enabled: false }, dmx = { enabled: false }, patch = heads(), selfLoop = () => false, reachesSelf = () => false, consoleFrames } = {}) {
	let t = 1000
	const hub = new MarkerHub({ now: () => t })
	const sent = []
	const eng = new FollowEngine({ hub, now: () => t, send: (to, pkt) => sent.push({ to, t, pkt }), isSelfLoop: selfLoop, reachesSelf, resolveMode, consoleFrames })
	eng.resolveAuto = (fx, marks) => marks.get(AUTO_MARKER_ID) || null
	eng.autoLanes = () => ({ lanes: hub.markers.has(AUTO_MARKER_ID) ? [{ id: 1, marker: AUTO_MARKER_ID }] : [], home: null })
	const slice = { output: { protocol: 'artnet', ...output }, dmx, handover, feed, patch }
	eng.configure(slice)
	const person = (x, y = 3) => hub.set({ id: AUTO_MARKER_ID, x, y, z: 0, status: 1 })
	const run = (seconds, fn = () => {}) => {
		for (let k = 0; k < (seconds * 1000) / DT; k++) {
			fn(t)
			t += DT
			eng.tick()
		}
	}
	const feedUnis = () => new Set(eng.feed.layout.universes)
	const feedPackets = () => sent.map((p) => ({ ...p, d: decodeArtDmx(p.pkt) })).filter((p) => p.d && feedUnis().has(p.d.portAddress))
	const lastFeed = (u = eng.feed.cfg.universe) => feedPackets().filter((p) => p.d.portAddress === u).at(-1)?.d.data
	return { eng, hub, sent, person, run, feedPackets, lastFeed, slice, clock: () => t }
}

describe('WO-1097 layout', () => {
	it('normalize: off by default, Art-Net 200, mirror; clamps and the sACN range', () => {
		assert.deepEqual(L.normalizeFeed(null), { enabled: false, protocol: 'artnet', universe: 200, dest: '', priority: 100, layout: 'mirror', address: 1 })
		const s = L.normalizeFeed({ enabled: true, protocol: 'sacn', universe: 0, priority: 999, layout: 'compact', address: 600, dest: ' 10.0.0.5 ' })
		assert.deepEqual(s, { enabled: true, protocol: 'sacn', universe: 1, dest: '10.0.0.5', priority: 200, layout: 'compact', address: 512 })
		assert.deepEqual(normalizePatch({ feed: { enabled: true } }).feed.enabled, true, 'follow-patch normalizes the slice key')
	})

	it('mirror: pan / tilt / dimmer at the real patch channels, one feed universe per rig universe', () => {
		const p = normalizePatch({ patch: [
			...heads(2),
			{ id: 'g1', name: 'Generic 8-bit', universe: 3, address: 101, dest: DESK, follow: 1, pan: { ch: 1, fine: 0 }, tilt: { ch: 2, fine: 0 } },
			{ id: 'n1', name: 'Not following', typeId: TYPE, mode: 'Standard', universe: 1, address: 401, dest: DESK, follow: 0 },
		] }, { resolveMode })
		const lay = L.buildLayout(L.feedHeads(p.fixtures), L.normalizeFeed({ universe: 50 }))
		assert.deepEqual(lay.universes, [50, 51], 'rig U1 → feed 50, rig U3 → feed 51')
		const map = Object.fromEntries(lay.heads.map((h) => [h.fx.id, h.slots.map((s) => `${s.role}@${s.feedUniverse}.${s.feedCh}`)]))
		assert.deepEqual(map.h1, ['pan@50.1', 'pan fine@50.2', 'tilt@50.3', 'tilt fine@50.4', 'dimmer@50.6'])
		assert.deepEqual(map.h2, ['pan@50.11', 'pan fine@50.12', 'tilt@50.13', 'tilt fine@50.14', 'dimmer@50.16'])
		assert.deepEqual(map.g1, ['pan@51.101', 'tilt@51.102'], 'no fine, no dimmer channel')
		assert.equal(map.n1, undefined, 'a head that follows nothing is not fed')
		const rows = L.tableRows(lay, L.normalizeFeed({ universe: 50 }))
		const r = rows.find((x) => x.id === 'h1' && x.role === 'tilt')
		assert.deepEqual([r.rig, r.feed, r.bits, r.range], ['Art-Net 1.3', 'Art-Net 50.3', 16, '270° inverted'], 'GDTF tilt 135 → −135 is inverted')
		assert.equal(rows.find((x) => x.id === 'g1' && x.role === 'pan').bits, 8)
		const csv = L.tableCsv(rows)
		assert.match(csv.split('\n')[0], /^Head,Fixture ID,Channel,Real patch/)
		assert.equal(csv.trim().split('\n').length, 1 + rows.length)
	})

	it('compact: 8 channels per head from the address; an 8-bit axis has fine 0; overflow past 512', () => {
		const p = normalizePatch({ patch: [heads(1)[0], { id: 'g1', name: 'G', universe: 3, address: 101, dest: DESK, follow: 1, pan: { ch: 1, fine: 0 }, tilt: { ch: 2, fine: 0 } }] }, { resolveMode })
		const lay = L.buildLayout(L.feedHeads(p.fixtures), L.normalizeFeed({ layout: 'compact', universe: 7, address: 501 }))
		assert.deepEqual(lay.universes, [7])
		assert.deepEqual(lay.heads[0].slots.map((s) => [s.role, s.ch, s.feedCh]), [['pan', 1, 501], ['pan fine', 2, 502], ['tilt', 3, 503],
			['tilt fine', 4, 504], ['dimmer', 6, 505], ['dimmer fine', 0, 506], ['active', 0, 507], ['level', 0, 508]])
		assert.deepEqual(lay.overflow, ['g1'], 'the second head would end at 516')
	})

	it('refusals: destination, rig / levels / grant universes, own input, read-back', () => {
		const ctx = (o = {}) => ({ fixtures: [{ protocol: 'artnet', universe: 1, name: 'Head 1' }], levels: { enabled: true, protocol: 'artnet', universe: 100 },
			grant: { enabled: true, universe: 5 }, reads: new Set([9]), isSelfLoop: () => false, reachesSelf: () => true, ...o })
		const cfg = (o) => L.normalizeFeed({ dest: '10.0.0.5', ...o })
		const why = (o, u, c) => L.refusal(cfg(o), u, L.feedDest(cfg(o), u), ctx(c))
		assert.equal(why({}, 200), null)
		assert.match(why({ dest: '' }, 200), /desk's IP/)
		assert.match(why({ dest: '255.255.255.255' }, 200), /desk's IP|bad destination/)
		assert.match(why({ dest: '10.0.0.255' }, 200), /bad destination/)
		assert.equal(why({ protocol: 'sacn', dest: '' }, 200), null, 'sACN multicast is allowed')
		assert.match(why({}, 1), /rig output universe \(Head 1\)/)
		assert.match(why({}, 100), /levels universe/)
		assert.match(why({}, 5), /grant universe/)
		assert.match(why({}, 9), /read back/)
		assert.match(why({}, 200, { isSelfLoop: () => true }), /own input/)
	})
})

describe('WO-1097 engine', () => {
	it('mirror is byte-for-byte the engine frame on every tick of a walk with take-overs; rig masters off = no rig packets', () => {
		const r = rig()
		let compared = 0
		const tap = []
		r.eng._send = ((orig) => (to, pkt) => {
			const d = decodeArtDmx(pkt)
			if (d?.portAddress === 200) tap.push({ d, frames: r.eng.fixtures.map((fx) => Uint8Array.from(r.eng.frameOf(fx))) })
			orig(to, pkt)
		})(r.eng._send)
		r.run(12, (t) => r.person(-6 + ((t - 1000) / 1000) * 1, 3)) // walks −6 → +6 m along the row
		for (const { d, frames } of tap) {
			r.eng.fixtures.forEach((fx, i) => {
				for (const ch of [1, 2, 3, 4, 6]) assert.equal(d.data[fx.address + ch - 2], frames[i][fx.address + ch - 2], `${fx.id} ch ${ch}`)
				compared++
			})
			for (const ch of [5, 7]) assert.equal(d.data[ch - 1], 0, 'channels the feed does not carry are 0')
		}
		assert.ok(tap.length > 300, `sent at the engine rate while moving (${tap.length})`)
		assert.ok(compared > 2400)
		const lit = new Set(tap.flatMap(({ d }) => r.eng.fixtures.filter((fx) => d.data[fx.address + 4] > 0).map((fx) => fx.id)))
		assert.ok(lit.size >= 7, `take-overs visible in the feed (${[...lit]})`)
		assert.equal(r.sent.filter((p) => decodeArtDmx(p.pkt)?.portAddress === 1).length, 0, 'never the rig universe')
		assert.equal(r.eng.status().feed.live, true)
	})

	it('a resting head holds its aim dark; nobody followed → held, dark; never 0 / 0', () => {
		const r = rig()
		r.run(3, () => r.person(-1, 3))
		const d = r.lastFeed()
		assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => d[10 * i + 5]), [0, 0, 255, 255, 255, 0, 0, 0])
		const pt = d.slice(0, 4)
		r.run(5) // the person is gone (stale, then nobody)
		const e = r.lastFeed()
		assert.deepEqual([...e.slice(0, 4)], [...pt], 'h1 held where it was')
		assert.notDeepEqual([...e.slice(20, 24)], [0, 0, 0, 0], 'h3 holds a real aim')
	})

	it('a head leaving the pool is parked: last aim held, dimmer 0, channels unchanged; compact active 0', () => {
		const r = rig({ feed: { enabled: true, dest: DESK, layout: 'compact', address: 1 } })
		r.run(3, () => r.person(-1, 3))
		const before = r.lastFeed()
		assert.deepEqual([before[2 * 8 + 4], before[2 * 8 + 6], before[2 * 8 + 7]], [255, 255, 255], 'h3 lit, active, level 255')
		const p = heads()
		p[2].follow = 0
		r.eng.configure({ ...r.slice, patch: p })
		r.run(1, () => r.person(-1, 3))
		const after = r.lastFeed()
		assert.deepEqual([...after.slice(16, 20)], [...before.slice(16, 20)], 'h3 pan / tilt held in its slot')
		assert.deepEqual([after[16 + 4], after[16 + 6], after[16 + 7]], [0, 0, 0], 'dark, not active')
		assert.deepEqual(r.eng.status().feed.parked, ['h3'])
		assert.equal(after[3 * 8 + 6], 255, 'h4 keeps its slot (no shift)')
	})

	it('compact carries the real bytes; Split mode: dimmer full while following, the programmer intensity wins', () => {
		const r = rig({ handover: { mode: 'split' }, feed: { enabled: true, dest: DESK, layout: 'compact', address: 11 } })
		r.run(2, () => r.person(0, 3))
		const d = r.lastFeed()
		r.eng.fixtures.forEach((fx, i) => {
			const f = r.eng.frameOf(fx)
			const at = 10 + 8 * i
			assert.deepEqual([...d.slice(at, at + 4)], [...f.slice(fx.address - 1, fx.address + 3)], `${fx.id} pan / tilt bytes`)
			assert.deepEqual([d[at + 4], d[at + 5], d[at + 6], d[at + 7]], [255, 0, 255, 255], `${fx.id} dimmer 8-bit, fine 0, active, level`)
		})
		r.eng.program(r.eng.fixtures.map((f) => f.id), { Dimmer: 0.5 })
		r.run(0.1, () => r.person(0, 3))
		assert.equal(r.lastFeed()[10 + 4], 128)
	})

	it('the LD grant fader scales the fed dimmers (any desk); console lost → dark; pan / tilt untouched', () => {
		const grant = { v: 255, on: true }
		const cons = { frame: (pa) => (pa === 9 && grant.on ? Uint8Array.from({ length: 512 }, (_, i) => (i === 511 ? grant.v : 0)) : null) }
		const r = rig({ handover: { mode: 'handover', grant: { enabled: true, universe: 9, address: 512 } }, consoleFrames: cons })
		r.run(3, () => r.person(-1, 3))
		const full = r.lastFeed()
		assert.deepEqual([2, 3, 4].map((i) => full[10 * i + 5]), [255, 255, 255], 'grant full = the handover dimmers')
		grant.v = 128
		r.run(2, () => r.person(-1, 3))
		const half = r.lastFeed()
		assert.deepEqual([2, 3, 4].map((i) => half[10 * i + 5]), [128, 128, 128], 'grant 50 % = half')
		assert.deepEqual([...half.slice(20, 24)], [...r.eng.frameOf(r.eng.fixtures[2]).slice(20, 24)], 'pan / tilt still the engine bytes')
		grant.on = false
		r.run(12, () => r.person(-1, 3))
		const lost = r.lastFeed()
		assert.deepEqual([2, 3, 4].map((i) => lost[10 * i + 5]), [0, 0, 0], 'console silent → dark (fail-safe)')
		assert.match(r.eng.status().handover.grant.state, /lost/)
	})

	it('refresh: 1 packet a second when static, nothing when off; output master + DMX master untouched', () => {
		const r = rig()
		r.run(3, () => r.person(-1, 3))
		r.run(4) // nobody: settles (fades done)
		const n0 = r.feedPackets().length
		r.run(5)
		const n = r.feedPackets().length - n0
		assert.ok(n >= 5 && n <= 6, `${n} packets in 5 s static`)
		assert.ok(r.eng.status().feed.pps <= 1.5)
		r.eng.configure({ ...r.slice, feed: { enabled: false, dest: DESK } })
		const m0 = r.sent.length
		r.run(3, () => r.person(2, 3))
		assert.equal(r.sent.length, m0, 'feed off, masters off → silent')
	})

	it('a refused universe is never sent (rig universe, self-loop)', () => {
		const a = rig({ feed: { enabled: true, dest: DESK, universe: 1 } })
		a.run(2, () => a.person(0, 3))
		assert.equal(a.sent.length, 0)
		assert.match(a.eng.status().feed.problems[0], /U1: universe 1 is a rig output universe/)
		const b = rig({ selfLoop: (to, u) => u === 200 })
		b.run(1, () => b.person(0, 3))
		assert.equal(b.sent.length, 0)
		assert.match(b.eng.status().feed.problems[0], /own input/)
	})

	it('sACN: E1.31 at the feed priority, unicast to the desk', () => {
		const r = rig({ feed: { enabled: true, protocol: 'sacn', universe: 300, dest: '127.0.0.1:5569', priority: 150 } })
		r.run(1, () => r.person(0, 3))
		const p = r.sent.map((x) => ({ to: x.to, d: decodeE131(x.pkt) })).filter((x) => x.d)
		assert.ok(p.length > 0)
		assert.deepEqual([p[0].to.host, p[0].to.port, p[0].d.universe, p[0].d.priority], ['127.0.0.1', 5569, 300, 150])
	})

	it('wiring: tapped after the tick, status, route, CSV', () => {
		const src = fs.readFileSync(path.join(ROOT, 'src/fixtures/follow-engine.js'), 'utf8')
		assert.match(src, /return sent \+ this\.handover\.send\(now, marks\) \+ this\.feed\.send\(now\)/)
		assert.match(src, /feed: this\.feed\.status\(\)/)
		assert.match(fs.readFileSync(path.join(ROOT, 'src/fixtures/follow-patch.js'), 'utf8'), /feed: normalizeFeed\(s\.feed\)/)
		assert.match(fs.readFileSync(path.join(ROOT, 'src/tracking/register.js'), 'utf8'), /\/api\/tracking\/follow\/feed\.csv/)
		assert.ok(encodeArtDmx)
	})
})
