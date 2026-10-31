'use strict'

/**
 * WO-893 — pixel-map smoothing (src/fixtures/pixel-map-smooth.js, wired in pixel-map-service.js): the exponential step
 * (63.2 % at t = τ, frame-rate independent, dt clamped), one k for all channels (no overshoot on a red → blue change),
 * 0 / 0 = the unsmoothed WO-807 path, the snap on a cut, stale → release, the resets, the unrounded write (16-bit fades),
 * the settings clamp, the server-owned project key and GET / POST /api/fixtures/pixelmap/settings.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const sm = require('../../src/fixtures/pixel-map-smooth')
const model = require('../../src/fixtures/pixel-map-model')
const { normalizePatch } = require('../../src/fixtures/follow-patch')
const { createPixelMapService, HOLD_MS } = require('../../src/fixtures/pixel-map-service')
const { SERVER_OWNED_SLICES, preserveClientOwnedSlices } = require('../../src/engine/project-client-slices')
const routesPm = require('../../src/api/routes-pixel-map')

const ROOT = path.join(__dirname, '../..')
const SRC = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const fn = (attribute) => [{ name: attribute, attribute, from: 0, to: 255, default: 0, physFrom: 0, physTo: 1, sets: [] }]
const ch = (geometry, attribute, offsets, def = 0) => ({ name: `${geometry}_${attribute}`, geometry, break: 1, offsets, res: 1,
	attribute, default: def, initial: 0, functions: fn(attribute) })
const TYPE = '6ad826d14d1b'
function pixelLineMode() {
	const channels = [ch('Body 6', 'Dimmer', [1])]
	for (let i = 0; i < 16; i++) {
		const o = 5 + 3 * i
		channels.push(ch(`Array ${109 + i}`, 'ColorAdd_R', [o], 255), ch(`Array ${109 + i}`, 'ColorAdd_G', [o + 1], 255), ch(`Array ${109 + i}`, 'ColorAdd_B', [o + 2], 255))
	}
	return { name: 'Mode11 70DMX', geometry: 'Body 6', breaks: [1], footprint: 52, channels }
}
const patch = normalizePatch({ patch: [{ id: 'pl', name: 'Pixel Line', typeId: TYPE, mode: 'Mode11 70DMX', universe: 18, address: 1, dest: '127.0.0.1:6455' }] },
	{ resolveMode: (t, m) => (t === TYPE && m === 'Mode11 70DMX' ? pixelLineMode() : null) })

function writeSegment(file, { width, height, pixels }, seq) {
	const stride = width * 4
	const slotSize = Math.ceil((4096 + stride * height) / 4096) * 4096
	const buf = Buffer.alloc(4096 + 3 * slotSize)
	buf.write('HASCGSHM', 0, 'latin1')
	buf.writeUInt32LE(1, 8)
	buf.writeUInt32LE(4096, 12)
	buf.writeUInt32LE(width, 16)
	buf.writeUInt32LE(height, 20)
	buf.writeUInt32LE(stride, 24)
	for (let s = 0; s < 3; s++) buf.writeBigUInt64LE(BigInt(4096 + s * slotSize), 48 + 8 * s)
	const slot = seq % 3
	const base = 4096 + slot * slotSize
	buf.writeBigUInt64LE(BigInt(2 * seq), base)
	pixels.copy(buf, base + 4096)
	buf.writeBigUInt64LE((BigInt(seq) << 8n) | BigInt(slot), 96)
	fs.writeFileSync(file, buf)
}
/** 64 × 16 BGRA picture: region A = x 0…9, region B = x 20…29 (both y 0…9) painted; the rest black. */
function picture(a, b) {
	const W = 64
	const H = 16
	const px = Buffer.alloc(W * H * 4)
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		const i = (y * W + x) * 4
		const c = y < 10 && x < 10 ? a : y < 10 && x >= 20 && x < 30 ? b : [0, 0, 0]
		;[px[i], px[i + 1], px[i + 2], px[i + 3]] = [c[2], c[1], c[0], 255]
	}
	return { width: W, height: H, pixels: px }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo893-'))
after(() => fs.rmSync(dir, { recursive: true, force: true }))
const MAPS = [
	{ id: 'a', fixtureId: 'pl', pixel: 1, channelNo: 1, rect: { x: 0, y: 0, w: 10, h: 10 } },
	{ id: 'b', fixtureId: 'pl', pixel: 2, channelNo: 1, rect: { x: 20, y: 0, w: 10, h: 10 } },
]
let n = 0
/** A service on a fresh shm file; frame(a, b) publishes the next picture; tick(ms) = sample + write. */
function rig(settings, { live = true } = {}) {
	const file = path.join(dir, `pgm1-${++n}`)
	const state = { t: 1_000_000, seq: 0, live, saved: [] }
	const engine = { fixtures: patch.fixtures, isLive: () => state.live }
	const svc = createPixelMapService({}, engine, { subscribe: false, now: () => state.t, surfacePath: () => file, lease: async () => {},
		channelMap: () => ({ programChannels: [1], previewChannels: [], channelResolutionsByChannel: { 1: { w: 64, h: 16 } } }),
		persistSettings: async (s) => state.saved.push(s) })
	svc.load({ pixelMappings: MAPS, pixelMapSettings: settings })
	const buf = new Uint8Array(512)
	const r = {
		svc, buf, state,
		frame: (a, b) => writeSegment(file, picture(a, b), ++state.seq),
		tick: (ms = 23) => {
			state.t += ms
			svc.sample(state.t)
			svc.write(buf, engine.fixtures[0], state.t)
		},
	}
	return r
}
// pixel p (0-based) sits at offsets 5 + 3p… of the head at address 1 → buffer index 4 + 3p…
const px = (buf, p) => [...buf.subarray(4 + 3 * p, 7 + 3 * p)]
const S = (attack_ms, release_ms, snap = 0) => ({ smooth: { attack_ms, release_ms, snap } })

describe('WO-893 the smoothing step (pure)', () => {
	const run = (from, to, tauMs, dt, seconds, which = 'attack_ms') => {
		let s = from
		const smooth = { attack_ms: 0, release_ms: 0, snap: 0, [which]: tauMs }
		for (let i = 0; i < Math.round(seconds / dt); i++) s = sm.stepRgb(s, to, dt, smooth)
		return s
	}

	it('0 / 0 is the target exactly (the unsmoothed path)', () => {
		assert.deepEqual(sm.stepRgb([10, 20, 30], [200, 100, 50.5], 0.023, { attack_ms: 0, release_ms: 0, snap: 0 }), [200, 100, 50.5])
		assert.equal(sm.isOff({ attack_ms: 0, release_ms: 0, snap: 99 }), true)
	})

	it('63.2 % of the way after t = τ, rising (attack) and falling (release)', () => {
		const up = run([0, 0, 0], [100, 100, 100], 1000, 0.01, 1)
		assert.ok(Math.abs(up[0] - 63.2) < 0.1, `attack ${up[0]}`)
		const down = run([100, 100, 100], [0, 0, 0], 1000, 0.01, 1, 'release_ms')
		assert.ok(Math.abs(down[0] - 36.8) < 0.1, `release ${down[0]}`)
		assert.deepEqual(run([5, 5, 5], [0, 0, 0], 1000, 0.01, 1, 'attack_ms'), [0, 0, 0], 'falling uses the release time: release 0 → straight there')
	})

	it('frame-rate independent: 44 steps of 1/44 s and 25 steps of 1/25 s agree within 0.5', () => {
		const a = run([0, 0, 0], [255, 128, 0], 400, 1 / 44, 1)
		const b = run([0, 0, 0], [255, 128, 0], 400, 1 / 25, 1)
		for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - b[i]) <= 0.5, `channel ${i}: ${a[i]} vs ${b[i]}`)
	})

	it('dt is clamped to 0.1 s (a stalled engine does not jump the colour)', () => {
		const smooth = { attack_ms: 500, release_ms: 500, snap: 0 }
		assert.deepEqual(sm.stepRgb([0, 0, 0], [100, 0, 0], 30, smooth), sm.stepRgb([0, 0, 0], [100, 0, 0], sm.MAX_DT_S, smooth))
		assert.deepEqual(sm.stepRgb([0, 0, 0], [100, 0, 0], -1, smooth), [0, 0, 0])
	})

	it('red → blue with attack ≠ release: one k for every channel, no component leaves its start–end range', () => {
		for (const [from, to] of [[[255, 0, 0], [0, 0, 255]], [[0, 0, 255], [255, 0, 0]]]) {
			for (const smooth of [{ attack_ms: 60, release_ms: 900, snap: 0 }, { attack_ms: 900, release_ms: 60, snap: 0 }]) {
				let s = from
				let prev = from
				for (let i = 0; i < 200; i++) {
					s = sm.stepRgb(s, to, 1 / 44, smooth)
					for (let c = 0; c < 3; c++) {
						assert.ok(s[c] >= Math.min(from[c], to[c]) - 1e-9 && s[c] <= Math.max(from[c], to[c]) + 1e-9, `component ${c} overshoots: ${s}`)
						assert.ok((s[c] - prev[c]) * (to[c] - from[c]) >= -1e-9, 'monotone toward the target')
					}
					assert.ok(Math.abs(s[1]) < 1e-9, 'green stays 0: no magenta swell')
					prev = s
				}
			}
		}
	})

	it('frameJump: mean over the mappings of the largest component change; nulls skipped', () => {
		assert.equal(sm.frameJump([[0, 0, 0], [10, 10, 10]], [[200, 0, 0], [10, 10, 10]]), 100)
		assert.equal(sm.frameJump([null, [0, 0, 0]], [[1, 1, 1], [40, 20, 0]]), 40)
		assert.equal(sm.frameJump([], []), 0)
	})
})

describe('WO-893 pixel-map-service smoothing', () => {
	it('0 / 0: byte-identical to the unsmoothed path (rounded means, stale = cut to black)', () => {
		const r = rig(S(0, 0))
		r.frame([200, 100, 50], [1, 2, 3])
		r.tick()
		assert.deepEqual([px(r.buf, 0), px(r.buf, 1)], [[200, 100, 50], [1, 2, 3]])
		r.tick()
		assert.deepEqual(px(r.buf, 0), [200, 100, 50], 'a tick without a frame keeps it')
		r.tick(HOLD_MS)
		assert.deepEqual(px(r.buf, 0), [0, 0, 0], 'no frame for HOLD_MS → black at once')
		const live = r.svc.live(r.state.t).mappings[0]
		assert.deepEqual([live.rgb, live.raw], [null, null])
	})

	it('attack / release: steps toward each new frame, every tick, and the value converges', () => {
		const r = rig(S(0, 1000))
		r.frame([200, 200, 200], [0, 0, 0])
		r.tick()
		assert.deepEqual(px(r.buf, 0), [200, 200, 200], 'first value: the state starts at the raw colour')
		r.frame([0, 0, 0], [0, 0, 0])
		r.tick()
		const first = px(r.buf, 0)[0]
		assert.ok(first > 190 && first < 200, `release step ${first}`)
		let last = first
		for (let i = 0; i < 42; i++) {
			r.tick() // no new frame: the smoothing still runs
			assert.ok(px(r.buf, 0)[0] <= last)
			last = px(r.buf, 0)[0]
		}
		assert.ok(last > 60 && last < 90, `~1 s after the cut ≈ 200·e^-1 = 73.6, got ${last}`)
		const live = r.svc.live(r.state.t).mappings[0]
		assert.deepEqual([live.rgb[0], live.raw], [last, [0, 0, 0]], '/live: rgb = as written, raw = the last frame mean')
	})

	it('attack 0 / release > 0: rising goes in at once, falling is smoothed', () => {
		const r = rig(S(0, 500))
		r.frame([10, 10, 10], [0, 0, 0])
		r.tick()
		r.frame([250, 250, 250], [0, 0, 0])
		r.tick()
		assert.equal(px(r.buf, 0)[0], 250)
	})

	it('stale: the smoothed colour releases to black (smoothing on) instead of cutting (0 / 0 cuts)', () => {
		const r = rig(S(0, 1000))
		r.frame([200, 200, 200], [0, 0, 0])
		r.tick()
		r.tick(HOLD_MS) // no frame for HOLD_MS: the target is black from here
		const v = px(r.buf, 0)[0]
		assert.ok(v > 150, `still on the way down, ${v}`)
		for (let i = 0; i < 44; i++) r.tick()
		assert.ok(px(r.buf, 0)[0] < v && px(r.buf, 0)[0] > 40, `released, not cut: ${px(r.buf, 0)[0]}`)
		for (let i = 0; i < 400; i++) r.tick()
		assert.equal(px(r.buf, 0)[0], 0)
	})

	it('snap: a cut of the whole channel jumps, one region changing does not; snap 0 never jumps', () => {
		const run = (snap) => {
			const r = rig(S(500, 500, snap))
			r.frame([50, 50, 50], [250, 250, 250])
			r.tick()
			r.frame([250, 250, 250], [250, 250, 250]) // A +200, B 0 → mean 100
			r.tick()
			const a = px(r.buf, 0)[0]
			r.frame([100, 100, 100], [250, 250, 250]) // A −150, B 0 → mean 75
			r.tick()
			return { whole: a, single: px(r.buf, 0)[0] }
		}
		const snapped = run(100)
		assert.equal(snapped.whole, 250, 'mean change 100 ≥ snap 100: the whole channel jumps to the raw colour')
		assert.ok(snapped.single > 200, `mean change 75 < 100: no jump, ${snapped.single}`)
		const off = run(0)
		assert.ok(off.whole > 50 && off.whole < 250, `snap 0: smoothed, ${off.whole}`)
		const both = run(60)
		assert.equal(both.single, 100, 'a lower snap catches the 75 change too')
	})

	it('resets: a reload (changed mappings) and the resume from idle start at the raw colour', () => {
		const r = rig(S(1000, 1000))
		r.frame([200, 200, 200], [0, 0, 0])
		r.tick()
		r.svc.load({ pixelMappings: [MAPS[0], { ...MAPS[1], pixel: 3 }], pixelMapSettings: S(1000, 1000) })
		r.frame([20, 20, 20], [0, 0, 0])
		r.tick()
		assert.deepEqual(px(r.buf, 0), [20, 20, 20], 'after a reload: the new raw value, no ramp from the old colour')

		const idle = rig(S(1000, 1000), { live: true })
		idle.frame([200, 200, 200], [0, 0, 0])
		idle.tick()
		idle.state.live = false
		idle.tick()
		assert.equal(idle.svc.live(0).channels[0].state, 'idle')
		idle.state.live = true
		idle.frame([30, 30, 30], [0, 0, 0])
		idle.tick()
		assert.deepEqual(px(idle.buf, 0), [30, 30, 30], 'resume from idle: raw, not a slow release from 200')
	})
})

describe('WO-893 unrounded write', () => {
	const px16 = { channels: [{ comp: 'r', res: 2, offsets: [1, 2] }] }
	const px8 = { channels: [{ comp: 'r', res: 1, offsets: [1] }] }
	const fx = { address: 1 }

	it('a float 100.5: 16-bit → 25829 (fine fade), 8-bit → 101', () => {
		const b16 = new Uint8Array(512)
		model.writePixel(b16, fx, px16, [100.5, 0, 0])
		assert.equal(b16[0] * 256 + b16[1], 25829)
		const b8 = new Uint8Array(512)
		model.writePixel(b8, fx, px8, [100.5, 0, 0])
		assert.equal(b8[0], 101)
	})

	it('the rounded ints of WO-807 give the same bytes as before (amber included)', () => {
		const amber = { channels: [{ comp: 'a', res: 1, offsets: [1] }] }
		const b = new Uint8Array(512)
		model.writePixel(b, fx, amber, [101, 120, 0])
		assert.equal(b[0], 51, 'round(min(r, g) · 0.5) = round(50.5) = 51')
	})
})

describe('WO-893 settings', () => {
	it('clamp: attack 0–5000, release 0–10000, snap 0–255, junk → 0', () => {
		assert.deepEqual(sm.normalizeSettings({ smooth: { attack_ms: 99999, release_ms: -4, snap: 300 } }), S(5000, 0, 255))
		assert.deepEqual(sm.normalizeSettings({ smooth: { attack_ms: 'x', release_ms: null, snap: NaN } }), S(0, 0, 0))
		assert.deepEqual(sm.normalizeSettings({ smooth: { attack_ms: '60', release_ms: 250.4 } }), S(60, 250, 0))
		assert.deepEqual(sm.normalizeSettings(undefined), S(0, 0, 0))
		assert.deepEqual(sm.normalizeSettings({ smooth: 'junk' }), S(0, 0, 0))
		assert.deepEqual(sm.normalizeSettings({ smooth: { release_ms: 99999 } }), S(0, 10000, 0))
	})

	it('validate (POST): junk is an error, omitted fields keep the current value, numbers clamp', () => {
		assert.equal(sm.validateSettings('x').ok, false)
		assert.equal(sm.validateSettings({}).ok, false)
		assert.equal(sm.validateSettings({ smooth: [] }).ok, false)
		assert.equal(sm.validateSettings({ smooth: { attack_ms: 'fast' } }).ok, false)
		assert.equal(sm.validateSettings({ smooth: { snap: {} } }).ok, false)
		assert.deepEqual(sm.validateSettings({ smooth: { release_ms: 250 } }, S(60, 0, 5)).settings, S(60, 250, 5))
		assert.deepEqual(sm.validateSettings({ smooth: { attack_ms: 1e9, snap: -3 } }).settings, S(5000, 0, 0))
	})

	it('pixelMapSettings is a server-owned project key: a client save keeps the stored copy', () => {
		assert.ok(SERVER_OWNED_SLICES.includes('pixelMapSettings'))
		const stale = { name: 'Show', pixelMapSettings: S(0, 0, 0) }
		preserveClientOwnedSlices(stale, { name: 'Show', pixelMapSettings: S(60, 250, 0) })
		assert.deepEqual(stale.pixelMapSettings, S(60, 250, 0))
		const web = { name: 'Show' }
		preserveClientOwnedSlices(web, { name: 'Show', pixelMapSettings: S(60, 250, 0) })
		assert.deepEqual(web.pixelMapSettings, S(60, 250, 0))
	})

	it('the service loads the project key and the persisted write goes to it (source)', () => {
		const svc = SRC('src/fixtures/pixel-map-service.js')
		assert.match(svc, /settings = smoothing\.normalizeSettings\(project\?\.pixelMapSettings\)/)
		assert.match(svc, /\.\.\.project, pixelMapSettings:/)
		assert.match(SRC('src/fixtures/pixel-map-frame.js'), /return \{ state: 'frame', seq, width, height, colours, means, reads \}/)
	})
})

describe('WO-893 routes GET / POST /api/fixtures/pixelmap/settings', () => {
	const handlers = {}
	routesPm.register({ get: (p, h) => (handlers[`GET ${p}`] = h), post: (p, h) => (handlers[`POST ${p}`] = h) })
	const r = rig(S(0, 0))
	const ctx = { fixtureService: { pixelMap: r.svc, engine: {} } }
	const call = async (verb, body) => {
		const res = await handlers[`${verb} /api/fixtures/pixelmap/settings`]({ ctx, body })
		return { status: res.status, json: JSON.parse(res.body) }
	}

	it('GET → the active settings; POST (raw JSON string body) clamps, keeps omitted fields, persists', async () => {
		assert.deepEqual((await call('GET')).json, { ok: true, settings: S(0, 0, 0) })
		const post = await call('POST', JSON.stringify({ smooth: { attack_ms: 60, release_ms: 99999 } }))
		assert.equal(post.status, 200)
		assert.deepEqual(post.json.settings, S(60, 10000, 0))
		assert.deepEqual(r.state.saved, [S(60, 10000, 0)])
		assert.deepEqual((await call('GET')).json.settings, S(60, 10000, 0))
		const part = await call('POST', JSON.stringify({ smooth: { snap: 40 } }))
		assert.deepEqual(part.json.settings, S(60, 10000, 40), 'omitted fields keep their value')
	})

	it('POST: 400 on a non-object, a missing smooth, a non-numeric value, a malformed body; nothing persisted', async () => {
		const before = r.state.saved.length
		for (const body of ['"x"', '{}', '{"smooth":5}', '{"smooth":{"attack_ms":"fast"}}', '{"smooth":', '']) {
			const res = await call('POST', body)
			assert.equal(res.status, 400, body)
			assert.equal(res.json.ok, false)
			assert.ok(res.json.error)
		}
		assert.equal(r.state.saved.length, before)
	})

	it('503 without the fixture engine', async () => {
		const res = await handlers['GET /api/fixtures/pixelmap/settings']({ ctx: {} })
		assert.equal(res.status, 503)
	})
})
