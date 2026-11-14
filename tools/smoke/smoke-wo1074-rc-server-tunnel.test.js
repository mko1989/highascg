'use strict'

/**
 * WO-1074 §3.1 — tunnels through tables on the server (modules/rc-game/server/rc-toy-blobs.js, rc-toy-tunnel.js, rc-toy-route.js
 * `tunnelLoop` / tunnel tours, rc-track-check-tunnel.js, rc-scene-occ.js `carveCells`): the tunnel-able blobs of the
 * synthetic tablecloth hall (every table, nothing else; none with legged tables), the generated tunnel tracks (a medium
 * hall loop and the grand tour) valid on the JSON scene and re-measured independently (lib/rc-tunnel-measure.js:
 * own carve, own blob flood), the carve equal to the measure's, and the validator's rejections: a checkpoint, pad or
 * box inside, a tube too tight (a bend under 2 × the floor's radius), a portal that opens onto a table, a ribbon through a table
 * without a tunnel entry, a tunnel through no table, bad ranges.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { generateTracks, validateTrack } = require('../../modules/rc-game/server/rc-tracks')
const O = require('../../modules/rc-game/server/rc-scene-occ')
const B = require('../../modules/rc-game/server/rc-toy-blobs')
const { measureToy, toyHall } = require('./lib/rc-track-measure')
const TM = require('./lib/rc-tunnel-measure')

const asJson = (sc, tracks) => JSON.parse(JSON.stringify({ scale: sc.scale, floors: sc.floors, obstacles: sc.obstacles, bounds: sc.bounds,
	heights: sc.field.toJSON(), occ: sc.occ.map((g) => g.toJSON()), tracks }))
const inTable = (sc, x, z) => sc.tables.some((q) => x > q[0] && x < q[2] && z > q[1] && z < q[3])

let cached = null
/** The synthetic tablecloth hall and its generated track set (once per file). */
function set() {
	if (!cached) {
		const sc = toyHall()
		cached = { sc, json: asJson(sc, generateTracks(sc).tracks) }
	}
	return cached
}
const errs = (t, json) => validateTrack(t, json).errors.join(' | ')

test('§3.1 blobs: every tablecloth table is tunnel-able, nothing else is; legged tables have none', () => {
	const sc = toyHall()
	const g = sc.occ.find((q) => q.floor === 'hall')
	const { blobs } = B.blobsOf(g, sc.floors, sc.field)
	const ok = blobs.filter((b) => b.ok)
	assert.equal(ok.length, sc.tables.length, `${ok.length} tunnel-able blobs for ${sc.tables.length} tables`)
	for (const q of sc.tables) assert.equal(ok.filter((b) => inTable({ tables: [q] }, ...b.c)).length, 1, `one blob for the table at ${q}`)
	for (const b of ok) {
		const sx = b.rect[2] - b.rect[0], sz = b.rect[3] - b.rect[1]
		assert.ok(sx >= B.BLOB_MIN && sx <= B.BLOB_MAX && sz >= B.BLOB_MIN && sz <= B.BLOB_MAX, `blob ${b.id} ${sx} × ${sz}`)
	}
	assert.ok(blobs.some((b) => !b.ok && b.why === 'size' && b.rect[2] - b.rect[0] > 20), 'the far wall is too big for a table')
	assert.ok(B.blobsOf(g, sc.floors, sc.field) === B.blobsOf(g, sc.floors, sc.field), 'cached per grid')
	assert.equal(B.blobsOf(g, sc.floors, null).blobs.filter((b) => b.ok).length, 0, 'no height field → no roof → no tunnel')
	const legs = toyHall({ legs: true })
	const lg = legs.occ.find((q) => q.floor === 'hall')
	assert.equal(B.blobsOf(lg, legs.floors, legs.field).blobs.filter((b) => b.ok).length, 0, 'legs are not tables to tunnel through')
})

test('§3.1 generated: a medium hall loop and the grand tour tunnel through a table, valid and re-measured', { timeout: 180000 }, () => {
	const { sc, json } = set()
	const tun = json.tracks.filter((t) => t.tunnels?.length)
	assert.ok(tun.some((t) => t.kind === 'hall' && t.length >= 12 && t.length <= 30), `a medium hall track with a tunnel (${tun.map((t) => t.id)})`)
	assert.ok(tun.some((t) => t.kind === 'room-long'), 'a long tour with a tunnel')
	assert.ok(json.tracks.length - tun.length >= 3, '≥ 3 tracks without one')
	for (const t of tun) {
		assert.ok(validateTrack(t, json).ok, `${t.id}: ${errs(t, json)}`)
		measureToy(t, json, 'tunnel')
		const m = TM.measureTunnels(t, json, `tunnel ${t.id}`)
		assert.ok(m.length >= 1 && m.length <= 3)
		for (const q of m) {
			assert.ok(q.len >= 0.6 && q.len <= 4, `${t.id}: ${q.len} m`)
			assert.ok(q.blobs.every((c) => inTable(sc, ...c)), `${t.id}: through tables only`)
			const inside = t.points.slice(q.from + 1, q.to).filter((p) => inTable(sc, p[0], p[2])).length
			assert.ok(inside >= 10, `${t.id}: ${inside} points under the table`)
		}
		// outside its tunnels no point is under a table
		const tube = (i) => t.tunnels.some((q) => i >= q.from && i <= q.to)
		t.points.forEach((p, i) => assert.ok(tube(i) || !inTable(sc, p[0], p[2]), `${t.id}: point ${i} under a table outside a tunnel`))
		// the server's carve is the measure's
		for (const q of t.tunnels) {
			const g = sc.occ.find((o) => Math.abs(o.y - t.points[q.from][1]) <= 0.002)
			const line = t.points.slice(q.from, q.to + 1).map((p) => [p[0], p[2]])
			const r = t.width / 2 + g.cell
			assert.deepEqual(O.carveCells(g, line, r), [...TM.carveFast(g, line, r)].sort((a, b) => a - b), `${t.id}: carve`)
			assert.deepEqual([...TM.carveFast(g, line.slice(0, 4), r)].sort((a, b) => a - b), [...TM.carveSet(g, line.slice(0, 4), r)].sort((a, b) => a - b))
		}
	}
})

test('§3.1 validator: deco inside, too tight, a blocked portal, no tunnel entry, no table, bad ranges', { timeout: 180000 }, () => {
	const { json } = set()
	const t = json.tracks.find((q) => q.id === 'hall-tunnel')
	assert.ok(t, 'the hall tunnel loop')
	assert.ok(validateTrack(t, json).ok, errs(t, json))
	const q = t.tunnels[0], mid = Math.floor((q.from + q.to) / 2), P = t.points
	const near = (o) => P.reduce((b, p, i) => (Math.hypot(p[0] - o.x, p[2] - o.z) < Math.hypot(P[b][0] - o.x, P[b][2] - o.z) ? i : b), 0)
	const at = (o, i) => ({ ...o, x: P[i][0], y: P[i][1] + (o.y - P[near(o)][1]), z: P[i][2] })
	// decoration inside
	const cps = [...t.checkpoints]
	cps[cps.length - 1] = mid
	assert.match(errs({ ...t, checkpoints: cps.sort((a, b) => a - b) }, json), /tunnel 0: checkpoint \d+ inside/)
	assert.match(errs({ ...t, pads: t.pads.map((o, k) => (k ? o : at(o, mid))) }, json), /tunnel 0: pad 0 inside/)
	assert.match(errs({ ...t, boxes: t.boxes.map((o, k) => (k ? o : at(o, mid))) }, json), /tunnel 0: box 0 inside/)
	assert.match(errs({ ...t, tunnels: [{ from: 1, to: q.to - q.from + 1 }] }, json), /tunnel 0/)
	// too tight: a bend inside (the carve follows the car's width, so the walls always clear width/2 — the radius is the limit)
	const ux = P[q.to][0] - P[q.from][0], uz = P[q.to][2] - P[q.from][2], ul = Math.hypot(ux, uz)
	const bump = (i) => (i < mid - 4 || i > mid + 4 ? 0 : (0.02 * (1 - Math.cos((Math.PI * (i - mid + 4)) / 4))) / 2) // a 2 cm kink over 8 points
	const bent = P.map((p, i) => [p[0] - (uz / ul) * bump(i), p[1], p[2] + (ux / ul) * bump(i)])
	assert.match(errs({ ...t, points: bent }, json), /tunnel 0: turn radius/)
	// a portal that opens onto the table: a portal moved 0.2 m in
	const k = Math.ceil(0.2 / Math.hypot(P[q.from + 1][0] - P[q.from][0], P[q.from + 1][2] - P[q.from][2]))
	assert.match(errs({ ...t, tunnels: [{ from: q.from + k, to: q.to }] }, json), /tunnel 0: the entry portal does not open onto free floor/)
	assert.match(errs({ ...t, tunnels: [{ from: q.from, to: q.to - k }] }, json), /tunnel 0: the exit portal does not open onto free floor/)
	// the same ribbon without its tunnel entry runs into the table
	const { tunnels: _tunnels, ...plain } = t
	assert.match(errs(plain, json), /toy: a blocked cell of the hall within width\/2 \+ 1 cell/)
	// a "tunnel" on open floor, through no table
	const other = json.tracks.find((o) => o.id === 'hall-gp')
	assert.ok(other && validateTrack(other, json).ok)
	assert.match(errs({ ...other, tunnels: [{ from: 10, to: 20 }] }, json), /tunnel 0 passes through no blocked cell|tunnel 0/)
	// ranges
	assert.match(errs({ ...t, tunnels: {} }, json), /tunnels must be an array/)
	assert.match(errs({ ...t, tunnels: [{ from: 5, to: 5 }] }, json), /tunnel 0: bad range/)
	assert.match(errs({ ...t, tunnels: [q, q] }, json), /tunnel 1 overlaps/)
	assert.match(errs({ ...t, tunnels: [1, 2, 3, 4].map((m) => ({ from: m * 10, to: m * 10 + 5 })) }, json), /at most 3/)
	assert.throws(() => TM.measureTunnels(plain.tunnels ? plain : { ...t, tunnels: [{ from: q.from + k, to: q.to }] }, json, 'neg'), /portal/)
	assert.throws(() => TM.measureTunnels({ ...t, checkpoints: cps }, json, 'neg'), /checkpoint/)
})
