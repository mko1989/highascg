'use strict'

/**
 * WO-1074 §3 — toy scale on the server (modules/rc-game/server/rc-scale.js, rc-scene-occ.js, rc-toy-*.js, rc-track-check-occ.js,
 * the bake at scale 0.1): the occupancy grid (band, RLE format, JSON round trip), the toy track set on a live-like
 * furnished hall with tablecloth tables and with legged tables (a toy drives under them), the §3 mix (short / medium /
 * long, laps), every track valid and re-measured from its points and the grids' RLE (lib/rc-track-measure.js
 * measureToy: the toy rules in metres, every v2 / §2.7 rule in the unit frame), determinism, the validator's toy
 * rejections (a ribbon by a blocked cell, a deck over one, widths, laps), the bake at scale 0.1 vs 1 (scale, occ, no
 * obstacle boxes, rev), the Narvil scene baked at 0.1 (read-only, when present; §3.1: ≥ 2 tracks tunnel through its
 * tables, a medium hall track and a long tour, ≥ 3 do not) and the newest live scene (any show: valid tracks, budgets).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { generateTracks, validateTrack } = require('../../modules/rc-game/server/rc-tracks')
const O = require('../../modules/rc-game/server/rc-scene-occ')
const SC = require('../../modules/rc-game/server/rc-scale')
const { bakeScene, sceneInputs, revOf } = require('../../modules/rc-game/server/rc-scene')
const { measureToy, decodeRle, toyHall, boxTris } = require('./lib/rc-track-measure')
const { liveScene, NARVIL } = require('./lib/rc-live-scene')

/** A scene as the client gets it: JSON text (grids → RLE, field → heights). */
const asJson = (sc, tracks) => JSON.parse(JSON.stringify({ scale: sc.scale, floors: sc.floors, obstacles: sc.obstacles, bounds: sc.bounds,
	heights: sc.field.toJSON(), occ: sc.occ.map((g) => g.toJSON()), tracks }))

const lenOf = (t) => t.length
const MIX = { short: (t) => lenOf(t) >= 4 && lenOf(t) <= 10, medium: (t) => lenOf(t) >= 12 && lenOf(t) <= 30, long: (t) => lenOf(t) >= 60 }

/** Every track valid on the JSON scene and re-measured; laps; unique ids (what holds for ANY scene). */
function checkTracks(json, label) {
	const T = json.tracks
	assert.equal(new Set(T.map((t) => t.id)).size, T.length, `${label}: unique ids`)
	for (const t of T) {
		const v = validateTrack(t, json)
		assert.ok(v.ok, `${label} ${t.id}: ${v.errors.join(', ')}`)
		measureToy(t, json, label)
		assert.equal(t.laps, MIX.long(t) ? 1 : 3, `${label} ${t.id}: laps ${t.laps}`)
	}
}

/** checkTracks + ≥ 8 tracks and the §3 mix (a furnished hall with a stage). */
function checkSet(json, label) {
	const T = json.tracks
	assert.ok(T.length >= 8, `${label}: ${T.length} tracks (${T.map((t) => t.id).join()})`)
	checkTracks(json, label)
	const n = (f) => T.filter(f).length
	assert.ok(n(MIX.short) >= 2, `${label}: ≥ 2 short tracks (4–10 m): ${T.map(lenOf).join()}`)
	assert.ok(n(MIX.medium) >= 3, `${label}: ≥ 3 medium tracks (12–30 m)`)
	assert.ok(n(MIX.long) >= 1 && n(MIX.long) <= 2, `${label}: 1–2 long tours (≥ 60 m)`)
	for (const t of T.filter(MIX.long)) assert.equal(t.kind, 'room-long', `${label} ${t.id}: a long tour is room-long`)
	const stage = json.floors.find((f) => f.id === 'stage'), hall = json.floors.find((f) => f.id === 'hall')
	const onStage = (p) => Math.abs(p[1] - stage.y) <= 0.002
	assert.ok(T.some((t) => t.floor === 'room' && t.ramps.length && t.points.some(onStage)), `${label}: a ramp onto the stage`)
	assert.ok(T.some((t) => t.drops.some((d) => onStage(t.points[d.at]) && Math.abs(t.points[d.land][1] - hall.y) <= 0.002)), `${label}: a drop off the stage`)
	const bridge = T.find((t) => (t.decks || []).length)
	assert.ok(bridge, `${label}: a bridge track`)
	for (const d of bridge.decks) {
		const h = bridge.points[d.from][1] - hall.y
		assert.ok(h >= 0.1 && h <= 0.4, `${label}: deck ${h.toFixed(3)} m high (0.1–0.4)`)
	}
}

test('occupancy grid: only the toy band blocks, RLE starts free, JSON round trip, exact segment distance', () => {
	const floor = { id: 'hall', y: 0, rect: [0, 0, 0.3, 0.3] }
	const g = O.createOcc(floor, { cell: 0.03, lo: 0.005, hi: 0.06 })
	assert.deepEqual([g.w, g.h], [10, 10])
	boxTris([0.065, 0.72, 0.035], [0.255, 0.75, 0.255], (...v) => g.tri(...v)) // a table top: a roof
	boxTris([0.1, 0, 0.1], [0.27, 0.003, 0.27], (...v) => g.tri(...v)) // a 3 mm mat: under the band
	assert.equal(g.count(), 0, 'a top above the band and a mat under it block nothing')
	boxTris([0.065, 0, 0.065], [0.085, 0.72, 0.085], (...v) => g.tri(...v)) // a 2 cm leg in cell (2, 2)
	assert.ok(g.blocked(0.075, 0.075) && g.count() >= 1 && g.count() <= 4, `${g.count()} cells for one leg`)
	assert.ok(!g.blocked(0.15, 0.15))
	const j = g.toJSON()
	assert.deepEqual(Object.keys(j).sort(), ['cell', 'floor', 'h', 'rle', 'w', 'x0', 'y', 'z0'])
	assert.ok(j.rle[0] > 0, 'the first run is free')
	assert.deepEqual([...decodeRle(j)], [...g.bits], 'the RLE decodes (independently) to the grid')
	const back = O.fromJSON(JSON.parse(JSON.stringify(j)))
	assert.deepEqual([...back.bits], [...g.bits])
	assert.equal(back.segNear(0, 0.15, 0.3, 0.15, 0.2), g.segNear(0, 0.15, 0.3, 0.15, 0.2))
	assert.ok(Math.abs(g.segNear(0, 0.15, 0.3, 0.15, 1) - (0.15 - 0.09)) < 1e-9, 'distance to the leg cells, exact')
	// a blocked first cell → a leading 0
	const c = O.createOcc(floor, { cell: 0.03 })
	boxTris([0, 0, 0], [0.02, 0.5, 0.02], (...v) => c.tri(...v))
	assert.equal(c.toJSON().rle[0], 0)
	assert.equal(O.occOf({ occ: [j] }, 'hall').count(), g.count())
	assert.equal(O.fromJSON({ ...j, rle: [1, 2] }), null, 'a short RLE is refused')
})

test('§3 toy tracks on a furnished hall (tablecloths to the floor): ≥ 8, the mix, valid, re-measured, deterministic', { timeout: 120000 }, () => {
	const sc = toyHall()
	const r = generateTracks(sc)
	const json = asJson(sc, r.tracks)
	checkSet(json, 'toy')
	assert.ok(json.tracks.every((t) => t.points.length <= SC.TOY_MAX_POINTS))
	assert.ok(json.tracks.some((t) => t.points.length > 200), 'a toy track may carry more than 200 points')
	const again = generateTracks(toyHall())
	assert.deepEqual(again.tracks, r.tracks, 'deterministic')
	// the tables are blocks: no point of any track inside one — except in a §3.1 tunnel (smoke-wo1074-rc-server-tunnel)
	for (const t of json.tracks) {
		const tube = (i) => (t.tunnels || []).some((q) => i >= q.from && i <= q.to)
		t.points.forEach((p, i) => assert.ok(tube(i) || !sc.tables.some((q) => p[0] > q[0] && p[0] < q[2] && p[2] > q[1] && p[2] < q[3]), `${t.id} inside a table`))
	}
})

test('§3 legged tables: a toy track drives under a table top, between the legs', { timeout: 120000 }, () => {
	const sc = toyHall({ legs: true })
	const json = asJson(sc, generateTracks(sc).tracks)
	checkSet(json, 'legs')
	const under = json.tracks.map((t) => t.points.filter((p) => sc.tables.some((q) => p[0] > q[0] && p[0] < q[2] && p[2] > q[1] && p[2] < q[3])).length)
	assert.ok(Math.max(...under) >= 10, `points under a table top: ${under.join()}`)
})

test('§3 validator: a blocked cell by the ribbon, a leg under a deck, toy widths and laps; scale from the scene', { timeout: 120000 }, () => {
	const sc = toyHall()
	const json = asJson(sc, generateTracks(sc).tracks)
	const hallG = json.occ.find((g) => g.floor === 'hall')
	/** The scene with one more blocked cell under plan point (x, z). */
	const withLeg = (x, z) => {
		const bits = decodeRle(hallG)
		bits[Math.floor((z - hallG.z0) / hallG.cell) * hallG.w + Math.floor((x - hallG.x0) / hallG.cell)] = 1
		return { ...json, occ: json.occ.map((g) => (g === hallG ? { ...g, rle: O.encodeRle(bits) } : g)) }
	}
	const flat = json.tracks.find((t) => t.kind === 'hall')
	const p = flat.points[Math.floor(flat.points.length / 3)]
	assert.ok(validateTrack(flat, json).ok)
	assert.match(validateTrack(flat, withLeg(p[0], p[2])).errors.join(), /toy: a blocked cell of the hall within width\/2 \+ 1 cell/)
	// beside the ribbon: 1 cell outside width/2 + 1 cell is fine, inside it is not
	const q = flat.points[Math.floor(flat.points.length / 3) + 1]
	const ux = (q[0] - p[0]) / Math.hypot(q[0] - p[0], q[2] - p[2]), uz = (q[2] - p[2]) / Math.hypot(q[0] - p[0], q[2] - p[2])
	const side = (d) => withLeg(p[0] - uz * d, p[2] + ux * d)
	assert.equal(validateTrack(flat, side(flat.width / 2 + 0.03 * 3)).ok, true, 'a leg 2 cells off the ribbon edge')
	assert.equal(validateTrack(flat, side(flat.width / 2 + 0.01)).ok, false, 'a leg 1 cm off the ribbon edge')
	const bridge = json.tracks.find((t) => (t.decks || []).length)
	const d = bridge.decks[0], mid = bridge.points[(d.from + Math.floor(((d.to - d.from + bridge.points.length) % bridge.points.length) / 2)) % bridge.points.length]
	assert.match(validateTrack(bridge, withLeg(mid[0], mid[2])).errors.join(), /toy: (a deck stands over a blocked cell|a blocked cell)/)
	assert.match(validateTrack({ ...flat, width: 0.5 }, json).errors.join(), /toy: width 0.500 m/)
	assert.match(validateTrack({ ...flat, laps: 0 }, json).errors.join(), /laps/)
	assert.match(validateTrack({ ...flat, laps: 2.5 }, json).errors.join(), /laps/)
	// the scale comes from the scene (or opts): the same world track at scale 1 is a 0.4 m road — too narrow for v2
	const { scale, ...noScale } = json
	assert.equal(scale, 0.1)
	assert.equal(validateTrack(flat, noScale).ok, false)
	assert.equal(validateTrack(flat, noScale, { scale: 0.1 }).ok, true)
	assert.equal(SC.sceneScale(noScale), 1)
	assert.equal(SC.RC_SCALE, 0.1)
})

const noStore = { get: () => null, mesh: async () => null }

test('§3 bake at scale 0.1: scale, one grid per floor, no obstacle boxes, deflated heights; scale 1 unchanged; rev hashes the scale', { timeout: 120000 }, async () => {
	const inp = sceneInputs({ previs: { tracking: { grid: { width: 10, depth: 8, z_offset: 1 } } } })
	const { json } = await bakeScene(inp, 'toy', { mvrStore: noStore, scale: 0.1 })
	assert.equal(json.scale, 0.1)
	assert.deepEqual(json.occ.map((g) => g.floor), json.floors.map((f) => f.id))
	for (const g of json.occ) assert.ok(Math.abs(g.cell - 0.03) < 1e-12 && decodeRle(g).length === g.w * g.h)
	assert.deepEqual(json.obstacles, [])
	assert.equal(json.heights.enc, 'deflate')
	const back = JSON.parse(JSON.stringify(json))
	assert.ok(back.tracks.length >= 2)
	for (const t of back.tracks) {
		const v = validateTrack(t, back)
		assert.ok(v.ok, `${t.id}: ${v.errors.join()}`)
		measureToy(t, back, 'bake')
	}
	const v2 = await bakeScene(inp, 'v2', { mvrStore: noStore })
	assert.equal(v2.json.scale, undefined)
	assert.equal(v2.json.occ, undefined)
	assert.ok(v2.json.tracks.every((t) => t.laps === undefined && t.width >= 2.5))
	assert.notEqual(revOf(inp, null, 0.1), revOf(inp, null))
	assert.equal(revOf(inp, null, 1), revOf(inp, null))
})

/** A live scene baked at 0.1 (read-only; one bake per scene id for this file). */
const liveBakes = new Map()
function bakeLive(live) {
	if (!liveBakes.has(live.inp.id)) liveBakes.set(live.inp.id, bakeScene(live.inp, 'smoke-toy', { mvrStore: live.mvrStore, scale: SC.RC_SCALE }))
	return liveBakes.get(live.inp.id)
}

// WO-1082: the show-specific facts are pinned to the scene they describe (Narvil: a furnished 27 × 61 m banquet hall,
// stage 0.58 m) — never to "whatever is newest" (the owner loading another show broke them, 15.11); off this box: skip.
test('§3 the Narvil scene baked at 0.1 (read-only): ≥ 8 toy tracks, the mix, tunnels through its tables, JSON size', { timeout: 300000 }, async (t) => {
	const live = liveScene({ id: NARVIL })
	if (!live) return t.skip(`the Narvil scene (projects/_mvr/${NARVIL}) is not on this machine`)
	const { json } = await bakeLive(live)
	const text = JSON.stringify(json)
	const back = JSON.parse(text)
	assert.ok(back.floors.some((f) => f.id === 'stage'), 'Narvil: a stage')
	checkSet(back, 'Narvil')
	// §3.1: tunnels through the live tables — a medium hall track and a long tour, ≥ 3 tracks without
	const tun = back.tracks.filter((q) => q.tunnels?.length)
	assert.ok(tun.some((q) => q.length >= 12 && q.length <= 30 && q.floor === 'hall'), `Narvil: a medium hall track with a tunnel (${tun.map((q) => q.id)})`)
	assert.ok(tun.some((q) => q.length >= 60), 'Narvil: a long tour with a tunnel')
	assert.ok(back.tracks.length - tun.length >= 3, 'Narvil: ≥ 3 tracks without a tunnel')
	// refinement 15.11: 3–4 tunnel tracks, each tunnel under a roof, ≤ 0.15 m out per end, no table used twice
	assert.ok(tun.length >= 3 && tun.length <= 4, `Narvil: ${tun.length} tracks with a tunnel`)
	const TM = require('./lib/rc-tunnel-measure')
	const seen = new Map()
	for (const q of tun) {
		for (const m of TM.measureTunnels(q, back, `Narvil ${q.id}`)) {
			const key = m.blobs.map((c) => c.map((v) => v.toFixed(2)).join()).sort().join(';')
			assert.ok(!seen.has(key), `Narvil: ${q.id} shares a table with ${seen.get(key)}`)
			seen.set(key, q.id)
		}
	}
	assert.ok(JSON.stringify(back.occ).length <= 400 * 1024, 'occ ≤ 400 kB')
	assert.ok(text.length <= 1024 * 1024, `scene JSON ${text.length} bytes`)
})

// WO-1082: whatever show is live (the newest project with an MVR scene) — only what holds for ANY show
test('§3 the newest live scene baked at 0.1 (read-only): bakes, every track valid and re-measured, budgets', { timeout: 300000 }, async (t) => {
	const live = liveScene()
	if (!live) return t.skip('no project with an MVR scene on this machine')
	const { json } = await bakeLive(live)
	const text = JSON.stringify(json)
	const back = JSON.parse(text)
	const label = `newest (${live.name})`
	assert.ok(back.floors.some((f) => f.id === 'hall'), `${label}: a hall floor`)
	assert.ok(back.tracks.length >= 1, `${label}: at least one track`)
	checkTracks(back, label)
	assert.ok(JSON.stringify(back.occ).length <= 400 * 1024, `${label}: occ ≤ 400 kB`)
	assert.ok(text.length <= 1024 * 1024, `${label}: scene JSON ${text.length} bytes`)
})
