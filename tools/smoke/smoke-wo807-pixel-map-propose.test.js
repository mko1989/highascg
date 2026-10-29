'use strict'

/**
 * WO-807 — automatic LED wall edge proposal (src/fixtures/pixel-map-propose.js, pixel-map-proposal.js): a linear pixel
 * fixture next to a wall edge gets its RGB pixels mapped to a strip `inset_px` inside that edge, spaced by its own pixel
 * pitch; beyond the threshold it is not mapped; the pending proposal, accept and the server-owned key.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '../..')
const SRC = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const { normalizePatch } = require('../../src/fixtures/follow-patch')
const { validateMappings } = require('../../src/fixtures/pixel-map-model')
const P = require('../../src/fixtures/pixel-map-propose')
const { createPixelMapProposalService, channelForRole, isApplied } = require('../../src/fixtures/pixel-map-proposal')
const { SERVER_OWNED_SLICES, preserveClientOwnedSlices } = require('../../src/engine/project-client-slices')

const TYPE = '6ad826d14d1b'
const fn = (attribute) => [{ name: attribute, attribute, from: 0, to: 255, default: 0, physFrom: 0, physTo: 1, sets: [] }]
const ch = (geometry, attribute, offsets) => ({ name: `${geometry}_${attribute}`, geometry, break: 1, offsets, res: offsets.length,
	attribute, default: 0, initial: 0, functions: fn(attribute) })

/** Pixel Line IP "Mode11 70DMX" shape: Dimmer, 16 RGB cells `Array 109…124` @5 (stride 3), 16 white segments. */
function pixelLineMode() {
	const channels = [ch('Body 6', 'Dimmer', [1])]
	for (let i = 0; i < 16; i++) {
		const o = 5 + 3 * i
		channels.push(ch(`Array ${109 + i}`, 'ColorAdd_R', [o]), ch(`Array ${109 + i}`, 'ColorAdd_G', [o + 1]), ch(`Array ${109 + i}`, 'ColorAdd_B', [o + 2]))
	}
	for (let i = 0; i < 16; i++) channels.push(ch(`Array ${125 + i}`, 'ColorAdd_W', [53 + i]))
	return { name: 'Mode11 70DMX', geometry: 'Body 6', footprint: 70, channels }
}

const xf = (x, y = 0, z = 0) => [1, 0, 0, 0, 1, 0, 0, 0, 1, x, y, z]
/** The type's rig as gdtf-rig.js builds it: a 1 m body, RGB cell i's two beams at x = −0.465 + 0.062 i (Godot frame). */
function pixelLineRig() {
	const nodes = [{ id: 'Body 6', parent: -1, kind: 'Geometry', xf: xf(0) }]
	for (let i = 0; i < 16; i++) {
		const at = nodes.push({ id: `Array ${109 + i}`, parent: 0, kind: 'Geometry', xf: xf(0) }) - 1
		nodes.push({ id: `Beam ${i}a`, parent: at, kind: 'Beam', xf: xf(-0.465 + 0.062 * i, -0.036, 0.024) })
		nodes.push({ id: `Beam ${i}b`, parent: at, kind: 'Beam', xf: xf(-0.465 + 0.062 * i, -0.036, -0.024) })
	}
	return { nodes }
}

const patchOf = (heads) => normalizePatch({ patch: heads.map((h, i) => ({ id: h.id || `pl${i + 1}`, name: h.name || `Pixel Line ${i + 1}`,
	protocol: 'artnet', universe: 18, address: 1 + 70 * i, dest: '127.0.0.1', typeId: TYPE, mode: 'Mode11 70DMX', pose: h.pose })) },
{ resolveMode: (t, m) => (t === TYPE && m === 'Mode11 70DMX' ? pixelLineMode() : null) }).fixtures

/** 4 m × 2 m wall (8 × 4 panels of 500 mm / 128 px), bottom centre at Godot (0, 1, 0) → picture 1024 × 512, top at y 3 m. */
const WALL_OBJ = { id: 'w1', type: 'led_wall', name: 'Wall', panel_px: [128, 128], panel_mm: [500, 500], panels: [8, 4],
	position: [0, 1, 0], rotation: [0, 0, 0], source: { role: 'pgm1', rect: { x: 0, y: 0, w: 1024, h: 512 } } }
const WALL = P.wallOf(WALL_OBJ, { channelNo: 1, raster: { w: 1024, h: 512 } })
// a horizontal bar (rest pose: pixels along Godot x) 0.3 m above the top edge, centred: PSN (x 0, y 0, z 3.3)
const ABOVE = { x: 0, y: 0, z: 3.3, hang: 'truss', yaw: 0, pitch: 0, roll: 0 }
// a vertical bar (roll −90: pixel 1 at the top) 0.25 m left of the left edge (x −2), centred at 2 m height
const LEFT = { x: -2.25, y: 0, z: 2, hang: 'truss', yaw: 0, pitch: 0, roll: -90 }
const fixturesFor = (fxs, rig = pixelLineRig()) => fxs.map((f) => P.fixtureOf(f, rig))

describe('WO-807 edge proposal — the rule', () => {
	it('the wall: size from the panels, rect from the source, bound to its channel', () => {
		assert.deepEqual(WALL.size_m, [4, 2])
		assert.deepEqual(WALL.rect, { x: 0, y: 0, w: 1024, h: 512 })
		assert.equal(P.wallOf({ ...WALL_OBJ, source: undefined }, { channelNo: 1, raster: { w: 1920, h: 1080 } }).rect.w, 1920)
		assert.equal(P.wallOf(WALL_OBJ, { channelNo: null, raster: { w: 1024, h: 512 } }), null)
	})

	it('a PixelLine is linear: its 16 RGB cells (not the white segments), at the GDTF beam positions', () => {
		const [f] = fixturesFor(patchOf([{ pose: ABOVE }]))
		assert.equal(f.linear, true)
		assert.deepEqual(f.pixels.map((p) => p.pixel), [...Array(16)].map((_, i) => i + 1))
		assert.equal(f.span_m, 0.93)
		assert.ok(Math.abs(f.pixels[0].pos[0] + 0.465) < 1e-9 && Math.abs(f.pixels[0].pos[1] - (3.3 - 0.036)) < 1e-9)
	})

	it('a fixture 0.3 m above the top edge maps to the top edge: 16 pixels, 50 px inset, spacing = its pitch', () => {
		const patch = patchOf([{ id: 'top', pose: ABOVE }])
		const r = P.proposePixelMappings({ walls: [WALL], fixtures: fixturesFor(patch) })
		const s = r.fixtures[0]
		assert.equal(s.mapped, true)
		assert.equal(s.edge, 'top')
		assert.ok(Math.abs(s.distance_m - 0.264) < 0.001, `distance ${s.distance_m}`) // pixel centres sit 36 mm below the pose
		assert.equal(s.rule, 'gdtf')
		assert.equal(s.spacing_m, 0.062)
		assert.equal(s.spacing_px, 16) // 0.062 m × 256 px/m = 15.87 → 16
		assert.equal(r.mappings.length, 16)
		assert.deepEqual(r.mappings.map((m) => m.pixel), [...Array(16)].map((_, i) => i + 1))
		for (const m of r.mappings) {
			assert.equal(m.rect.y, 50) // inset from the top edge
			assert.equal(m.rect.h, 40) // depth
			assert.equal(m.rect.w, 16)
			assert.equal(m.channelNo, 1)
			assert.equal(m.mode, 'average')
		}
		// pixel 1 at x = −0.465 m → 512 − 119.04 = 392.96 px centre; pixel 16 at +0.465 m → 631.04
		assert.equal(r.mappings[0].rect.x, 385)
		assert.equal(r.mappings[15].rect.x, 623)
		assert.equal(r.mappings[0].id, 'auto-top-1')
		// the mappings pass the POST's validation against the same patch
		const v = validateMappings(r.mappings, { fixtures: patch, resolutionOf: () => ({ w: 1024, h: 512 }) })
		assert.equal(v.ok, true, JSON.stringify(v.errors))
	})

	it('a fixture 3 m away is not mapped (threshold 1.5 m), with a warning', () => {
		const far = patchOf([{ id: 'far', pose: { ...ABOVE, z: 6 } }])
		const r = P.proposePixelMappings({ walls: [WALL], fixtures: fixturesFor(far) })
		assert.equal(r.mappings.length, 0)
		assert.equal(r.mapped, 0)
		assert.equal(r.out_of_range, 1)
		assert.equal(r.fixtures[0].mapped, false)
		assert.match(r.fixtures[0].warning, /beyond 1\.5 m — not mapped/)
		assert.equal(P.DEFAULTS.threshold_m, 1.5)
		// a wider threshold maps it
		assert.equal(P.proposePixelMappings({ walls: [WALL], fixtures: fixturesFor(far) }, { threshold_m: 4 }).mapped, 1)
	})

	it('a vertical bar beside the left edge: x = rect.x + inset, pixel 1 at the top, spacing 16 px down', () => {
		const r = P.proposePixelMappings({ walls: [WALL], fixtures: fixturesFor(patchOf([{ id: 'l', pose: LEFT }])) })
		assert.equal(r.fixtures[0].edge, 'left')
		const ys = r.mappings.map((m) => m.rect.y)
		assert.ok(r.mappings.every((m) => m.rect.x === 50 && m.rect.w === 40 && m.rect.h === 16))
		assert.ok(ys.every((y, i) => i === 0 || y > ys[i - 1]), 'pixel 1 on top, increasing downwards')
		// centre 2 m high = 1 m below the top → 256 px; pixel 1 is 0.465 m above → 256 − 119.04
		assert.equal(ys[0], Math.round(256 - 119.04 - 8))
		const gaps = ys.slice(1).map((y, i) => y - ys[i])
		assert.ok(gaps.every((g) => g === 15 || g === 16), `gaps ${gaps}`)
	})

	it('the inset is a parameter and is measured from each edge inwards (right / bottom too)', () => {
		const right = patchOf([{ id: 'r', pose: { ...LEFT, x: 2.25 } }])
		const below = patchOf([{ id: 'b', pose: { ...ABOVE, z: 0.7 } }])
		const r = P.proposePixelMappings({ walls: [WALL], fixtures: fixturesFor([...right, ...below]) }, { inset_px: 80, depth_px: 20 })
		const [sr, sb] = r.fixtures
		assert.equal(sr.edge, 'right')
		assert.equal(sb.edge, 'bottom')
		for (const m of r.mappings.filter((m) => m.fixtureId === 'r')) assert.equal(m.rect.x + m.rect.w, 1024 - 80)
		for (const m of r.mappings.filter((m) => m.fixtureId === 'b')) assert.equal(m.rect.y + m.rect.h, 512 - 80)
		assert.equal(r.params.inset_px, 80)
	})

	it('a rotated wall with an offset source rect: the edge is found in the wall frame, rects in its part of the raster', () => {
		const wall = P.wallOf({ ...WALL_OBJ, position: [5, 1, -3], rotation: [0, 30, 0], source: { role: 'pgm1', rect: { x: 2000, y: 100, w: 1024, h: 512 } } },
			{ channelNo: 1, raster: { w: 3840, h: 1080 } })
		// 0.25 m outside the wall's left edge along its own −x, at 2 m height (Godot: x = cos30, z = −sin30)
		const c = Math.cos(Math.PI / 6)
		const s = Math.sin(Math.PI / 6)
		const gx = 5 - 2.25 * c
		const gz = -3 + 2.25 * s
		const fx = patchOf([{ id: 'rot', pose: { x: gx, y: -gz, z: 2, yaw: -30, pitch: 0, roll: -90 } }])
		const r = P.proposePixelMappings({ walls: [wall], fixtures: fixturesFor(fx) })
		assert.equal(r.fixtures[0].edge, 'left')
		// 0.25 m + the beams' 36 mm offset from the pose (roll −90 turns it away from the wall)
		assert.ok(Math.abs(r.fixtures[0].distance_m - 0.286) < 0.002, `distance ${r.fixtures[0].distance_m}`)
		assert.ok(r.mappings.every((m) => m.rect.x === 2050 && m.rect.y >= 100 && m.rect.y + m.rect.h <= 612))
	})

	it('without GDTF positions: length = the foot → nearest corner distance, centred on the foot (rule corner)', () => {
		const [f] = fixturesFor(patchOf([{ id: 'n', pose: { ...ABOVE, x: 1 } }]), null)
		assert.equal(f.linear, true) // 16 mixing pixels, shape unknown
		const r = P.proposePixelMappings({ walls: [WALL], fixtures: [f] })
		const s = r.fixtures[0]
		assert.equal(s.edge, 'top')
		assert.equal(s.rule, 'corner')
		// foot at 3 m along the 4 m top edge → 1 m to the right corner → 16 cells of 62.5 mm = 16 px, from x 640 to 896
		assert.equal(s.spacing_m, 0.063)
		assert.equal(r.mappings[0].rect.x, 640)
		assert.equal(r.mappings[15].rect.x + r.mappings[15].rect.w, 896)
	})

	it('pixels past the end of the edge are clamped to the wall and counted', () => {
		const r = P.proposePixelMappings({ walls: [WALL], fixtures: fixturesFor(patchOf([{ id: 'c', pose: { ...ABOVE, x: 1.8 } }])) })
		const s = r.fixtures[0]
		assert.ok(s.off_edge > 0)
		assert.match(s.warning, /past the end of the top edge/)
		assert.ok(r.mappings.every((m) => m.rect.x + m.rect.w <= 1024))
	})

	it('not linear (a ring of pixels) → not a candidate; nearest of several walls wins', () => {
		const ring = { nodes: [{ id: 'Body 6', parent: -1, kind: 'Geometry', xf: xf(0) }] }
		for (let i = 0; i < 16; i++) {
			const a = (i / 16) * 2 * Math.PI
			ring.nodes.push({ id: `Array ${109 + i}`, parent: 0, kind: 'Geometry', xf: xf(0.2 * Math.cos(a), 0, 0.2 * Math.sin(a)) })
		}
		assert.equal(P.fixtureOf(patchOf([{ pose: ABOVE }])[0], ring).linear, false)
		const wall2 = P.wallOf({ ...WALL_OBJ, id: 'w2', position: [0, 5, 0], source: { role: 'pgm1', rect: { x: 0, y: 512, w: 1024, h: 512 } } },
			{ channelNo: 1, raster: { w: 1024, h: 1024 } })
		const r = P.proposePixelMappings({ walls: [WALL, wall2], fixtures: fixturesFor(patchOf([{ pose: { ...ABOVE, z: 4.8 } }])) })
		assert.equal(r.fixtures[0].wall, 'w2')
		assert.equal(r.fixtures[0].edge, 'bottom')
	})
})

describe('WO-807 edge proposal — pending, accept, the project key', () => {
	const map = { programChannels: [1, 3], previewChannels: [2, 4], channelResolutionsByChannel: { 1: { w: 1024, h: 512 } } }
	const setup = (project) => {
		const engine = { fixtures: patchOf([{ id: 'top', pose: ABOVE }, { id: 'far', pose: { ...ABOVE, z: 9 } }]) }
		const writes = []
		const sets = []
		const pixelMap = {
			mappings: () => [{ id: 'old', fixtureId: 'top', pixel: 1, channelNo: 1, rect: { x: 1, y: 1, w: 9, h: 9 }, mode: 'point', problem: null },
				{ id: 'keep', fixtureId: 'other', pixel: 2, channelNo: 1, rect: { x: 0, y: 0, w: 5, h: 5 }, mode: 'average', problem: null }],
			set: async (list, opts) => {
				sets.push({ list, opts })
				return { ok: true, mappings: list }
			},
		}
		const svc = createPixelMapProposalService({}, engine, pixelMap, { subscribe: false, channelMap: () => map, rigOf: () => pixelLineRig(),
			loadProject: () => project, persist: async (v) => writes.push(v), now: () => 0 })
		return { svc, writes, sets }
	}

	it('roles resolve to channels through the channel map', () => {
		assert.equal(channelForRole('pgm2', map), 3)
		assert.equal(channelForRole('prv1', map), 2)
		assert.equal(channelForRole('ch6', map), 6)
		assert.equal(channelForRole('pgm9', map), null)
	})

	it('an MVR + a bound wall + a PixelLine → a pending proposal stored with its input signature, never applied', async () => {
		const loaded = { previs: { mvr: { id: 'b' }, stage: { objects: [WALL_OBJ] } } }
		const { svc, writes, sets } = setup(loaded)
		const value = await svc.check(loaded)
		assert.equal(writes.length, 1)
		assert.equal(value.state, 'pending')
		assert.match(value.sig, /^[0-9a-f]{16}$/)
		assert.equal(value.mapped, 1)
		assert.equal(value.out_of_range, 1)
		assert.equal(value.mappings.length, 16)
		assert.equal(sets.length, 0) // never applied by the hook
		const g = svc.get({})
		assert.equal(g.pending, true)
		assert.equal(g.fixtures.find((f) => f.fixtureId === 'top').rects.length, 16)
		assert.equal(svc.get({ fresh: '1' }).pending, false)
		// our own write comes back (the stored key) and later autosaves with the same inputs: nothing
		assert.equal(await svc.check({ ...loaded, pixelMappingProposal: value }), null)
		assert.equal(await svc.check(loaded), null)
		assert.equal(writes.length, 1)
		// a restart (no in-memory signature) with the stored key: still nothing
		const again = setup(loaded)
		assert.equal(await again.svc.check({ ...loaded, pixelMappingProposal: value }), null)
		assert.equal(again.writes.length, 0)
		// the wall moved: proposed again
		const moved = { ...loaded, pixelMappingProposal: value, previs: { ...loaded.previs, stage: { objects: [{ ...WALL_OBJ, position: [0, 1.1, 0] }] } } }
		assert.equal((await svc.check(moved)).state, 'pending')
		assert.equal(writes.length, 2)
	})

	it('dismissed or accepted inputs are not proposed again', async () => {
		const loaded = { previs: { mvr: { id: 'b' }, stage: { objects: [WALL_OBJ] } } }
		const a = setup(loaded)
		const value = await a.svc.check(loaded)
		assert.deepEqual(await a.svc.dismiss(), { ok: true, dismissed: true })
		assert.equal(a.writes[1].state, 'dismissed')
		assert.equal(a.writes[1].sig, value.sig)
		const b = setup(loaded)
		assert.equal(await b.svc.check({ ...loaded, pixelMappingProposal: a.writes[1] }), null)
		assert.equal(b.writes.length, 0)
		assert.equal(b.svc.get({}).pending, false)
		assert.equal(b.svc.get({}).last.state, 'dismissed')
	})

	it('no MVR, no raster yet, or already applied → no pending', async () => {
		const noMvr = { previs: { stage: { objects: [WALL_OBJ] } } }
		const a = setup(noMvr)
		assert.equal(await a.svc.check(noMvr), null)
		assert.equal(a.writes.length, 0)
		const fresh = setup({}).svc.compute({ previs: { stage: { objects: [WALL_OBJ] } } })
		const applied = { previs: { mvr: { id: 'c' }, stage: { objects: [WALL_OBJ] } }, pixelMappings: fresh.mappings }
		assert.equal(isApplied(fresh.mappings, applied.pixelMappings), true)
		const b = setup(applied)
		assert.equal(await b.svc.check(applied), null)
		assert.equal(b.writes.length, 0)
		const noRaster = createPixelMapProposalService({}, { fixtures: patchOf([{ id: 'top', pose: ABOVE }]) }, {}, { subscribe: false,
			channelMap: () => ({ programChannels: [1] }), rigOf: () => pixelLineRig(), persist: async () => assert.fail('no write') })
		assert.equal(await noRaster.check({ previs: { mvr: { id: 'c' }, stage: { objects: [WALL_OBJ] } } }), null)
	})

	it('accept replaces the covered fixtures\' mappings, keeps the others, records "accepted" in the same write', async () => {
		const project = { previs: { mvr: { id: 'a' }, stage: { objects: [WALL_OBJ] } } }
		const { svc, sets } = setup(project)
		const r = await svc.accept({})
		assert.equal(r.ok, true)
		assert.equal(r.accepted, 16)
		assert.equal(r.kept, 1)
		const { list, opts } = sets[0]
		assert.deepEqual(list.filter((m) => m.fixtureId === 'other').map((m) => m.id), ['keep'])
		assert.ok(!list.some((m) => m.id === 'old'))
		assert.ok(!('problem' in list[0]))
		assert.equal(opts.extra.pixelMappingProposal.state, 'accepted')
		assert.match(opts.extra.pixelMappingProposal.sig, /^[0-9a-f]{16}$/)
		assert.equal((await svc.accept({ replace: true })).kept, 0)
		const none = await setup(project).svc.accept({ threshold_m: 0.1 })
		assert.equal(none.ok, false)
		assert.equal(none.status, 400)
	})

	it('the hook: a project-changed event (an MVR loaded by the client\'s save) stores the pending proposal once', async () => {
		const { emitProjectChanged } = require('../../src/engine/project-events')
		const engine = { fixtures: patchOf([{ id: 'top', pose: ABOVE }]) }
		const writes = []
		const first = { previs: { stage: { objects: [WALL_OBJ] } } }
		const svc = createPixelMapProposalService({}, engine, { mappings: () => [], set: async () => ({ ok: true }) }, { channelMap: () => map,
			rigOf: () => pixelLineRig(), loadProject: () => first, persist: async (v) => writes.push(v), debounceMs: 5 })
		const wait = () => new Promise((r) => setTimeout(r, 40))
		await wait() // boot: no MVR yet, nothing
		assert.equal(writes.length, 0)
		const loaded = { previs: { mvr: { id: 'm1' }, stage: { objects: [WALL_OBJ] } } }
		emitProjectChanged(loaded)
		emitProjectChanged(loaded) // a burst of autosaves: debounced, one check
		await wait()
		assert.equal(writes.length, 1)
		assert.equal(writes[0].mappings.length, 16)
		emitProjectChanged({ ...loaded, [require('../../src/fixtures/pixel-map-proposal').KEY]: writes[0] }) // our own write comes back
		await wait()
		assert.equal(writes.length, 1, 'same inputs: no recompute')
		assert.equal(svc.get({}).pending, true)
		svc.stop()
	})

	it('pixelMappingProposal is server-owned; a stale client copy cannot bring back a dropped one', () => {
		assert.ok(SERVER_OWNED_SLICES.includes('pixelMappingProposal'))
		const stale = { name: 'Show', pixelMappingProposal: { mapped: 3 }, pixelMappings: [{ id: 'z' }] }
		preserveClientOwnedSlices(stale, { name: 'Show' })
		assert.equal(stale.pixelMappingProposal, undefined)
		assert.equal(stale.pixelMappings, undefined)
		const kept = { name: 'Show' }
		preserveClientOwnedSlices(kept, { name: 'Show', pixelMappingProposal: { mapped: 2 } })
		assert.deepEqual(kept.pixelMappingProposal, { mapped: 2 })
	})

	it('wiring: the routes, the hook after the patch apply, the accept through set()', () => {
		const routes = SRC('src/api/routes-pixel-map.js')
		assert.match(routes, /routes\.get\('\/api\/fixtures\/pixelmap\/proposal'/)
		assert.match(routes, /routes\.post\('\/api\/fixtures\/pixelmap\/proposal\/accept'/)
		assert.match(routes, /routes\.post\('\/api\/fixtures\/pixelmap\/proposal\/dismiss'/)
		const svc = SRC('src/fixtures/follow-service.js')
		assert.ok(svc.indexOf('onProjectChanged(apply)') < svc.indexOf('createPixelMapProposalService(ctx, engine, pixelMap'))
		assert.match(SRC('src/fixtures/pixel-map-service.js'), /async function set\(list, \{ extra \} = \{\}\)/)
	})
})

describe('WO-807 sampling cost with many strips', () => {
	it('sampling idles while no mapped head is on the wire and /live was not read for 5 s', () => {
		const { createPixelMapService } = require('../../src/fixtures/pixel-map-service')
		const fixtures = patchOf([{ id: 'top', pose: ABOVE }])
		let live = false
		let reads = 0
		let t = 10000
		const engine = { fixtures, isLive: () => live }
		const fsImpl = { openSync: () => { reads++; throw Object.assign(new Error('x'), { code: 'ENOENT' }) }, closeSync: () => {} }
		const svc = createPixelMapService({}, engine, { subscribe: false, now: () => t, lease: async () => {}, surfacePath: () => '/nonexistent',
			channelMap: () => ({ programChannels: [1], previewChannels: [], channelResolutionsByChannel: { 1: { w: 1024, h: 512 } } }), fsImpl })
		svc.load({ pixelMappings: [{ id: 'a', fixtureId: 'top', pixel: 1, channelNo: 1, rect: { x: 0, y: 0, w: 10, h: 10 } }] })
		svc.sample(t)
		assert.equal(reads, 0, 'master off, nobody watching: no read')
		assert.equal(svc.live(t).channels[0].state, 'idle')
		svc.sample(t + 1000)
		assert.equal(reads, 1, 'a /live reader keeps it sampling')
		t += 7000
		svc.sample(t)
		assert.equal(reads, 1, 'idle again 5 s after the last /live read')
		live = true
		svc.sample(t)
		assert.equal(reads, 2, 'on the wire: sampled every tick')
		svc.stop()
	})

	it('spans up to 1024 px apart on a row are read as one (one pread costs the same up to ~8 KB)', () => {
		const { buildPlan } = require('../../src/fixtures/pixel-map-frame')
		const strips = [50, 934, 1074, 2726, 2866, 3750].map((x) => ({ x, y: 0, w: 40, h: 16, mode: 'average' }))
		const plan = buildPlan(strips, 3840, 1792)
		assert.deepEqual(plan.rows[0].spans, [[50, 1114], [2726, 3790]])
	})
})
