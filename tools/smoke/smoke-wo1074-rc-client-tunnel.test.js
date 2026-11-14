'use strict'

/**
 * WO-1074 §3.1 — tunnels through tables in the RC client (modules/rc-game/client/occ.js carveCells / carveTracks, tunnel.js,
 * physics-world.js createEnv / ceilingOf / tunnelOf, cameras.js chase + Director, track-tunnel.js, tunnel-cut.js,
 * trackdraw.js) on the server's tunnel loop through a tablecloth table of the synthetic toy hall
 * (lib/rc-client-fixtures.js tunnelWorld): the client's carve is the server's cell for cell (rc-scene-occ.js), the
 * shared decoded grids stay untouched, a bot laps the track through the table without touching a wall, the same
 * track without its `tunnels` entry hits the table, the chase eye stays under the tube's ceiling, the director looks
 * in from the exit portal, the tube mesh builds headless without NaN, the scene cut patches materials, the minimap
 * dashes the tunnel.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const F = require('./lib/rc-client-fixtures.js')
const SO = require('../../modules/rc-game/server/rc-scene-occ')

let P, TM, ST, CAM, OCC, TUN, MESH, CUT, DRAW, THREE, W

before(async () => {
	P = await F.load('physics.js')
	TM = await F.load('track-math.js')
	ST = await F.load('standings.js')
	CAM = await F.load('cameras.js')
	OCC = await F.load('occ.js')
	TUN = await F.load('tunnel.js')
	const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 60 }) : k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => ((t[k] = v), true) })
	const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, ownerDocument: doc }) }
	if (!globalThis.document) globalThis.document = doc
	THREE = await import('three')
	MESH = await F.load('track-mesh.js')
	CUT = await F.load('tunnel-cut.js')
	DRAW = await F.load('trackdraw.js')
	W = F.tunnelWorld()
})

const S = 0.1
const envOf = (raw, occ = W.json.occ) => {
	const T = TM.prepareTrack(raw, S)
	return { T, env: P.createEnv(T, W.json.floors, [], { scale: S, occ }) }
}

/** Bot drive of one lap (≤ 120 s): walls (with the segment), frames in a tunnel, the chase eye's worst height under its ceiling. */
function drive(raw) {
	const { T, env } = envOf(raw)
	const car = P.createCar(TM.gridPose(T, 0))
	const r = new ST.RaceTracker(T)
	r.reset(0)
	r.move('me', car.x, car.z, 0, true, car.y)
	const out = { done: 0, walls: [], inside: 0, eyeGap: Infinity, steps: 0, shots: [] }
	const D = new CAM.Director(3)
	D.ceilAt = (x, z, y) => P.ceilingOf(env, x, z, y)
	D.tunnelAt = (x, z, y) => P.tunnelOf(env, x, z, y)
	let hint = -1
	for (let i = 0; i < 60 * 120 && !out.done; i++) {
		const b = F.botInput(TM, P, T, car, hint)
		hint = b.near.seg
		P.stepCar(car, b.input, env)
		for (const e of car.ev) if (e.k === 'wall') out.walls.push(hint)
		car.ev.length = 0
		assert.ok([car.x, car.y, car.z].every(Number.isFinite))
		const tn = P.tunnelOf(env, car.x, car.z, car.y)
		if (tn) {
			out.inside++
			const c = CAM.chaseTarget(car, car.v ?? 0, D.ceilAt, S, (x, z, y) => P.eyeBlockedOf(env, x, z, y))
			out.eyeGap = Math.min(out.eyeGap, tn.top - c.eye[1])
			D.shot = 'overview' // the spectator's overview / trackside angles cannot see in: the director looks from the portal
			D.until = Infinity
			const pose = D.update(i / 60, 1 / 60, T, ['me'], () => ({ ...car, v: car.v ?? 0 }))
			out.shots.push({ eye: pose.eye, portal: TUN.portalShot(tn.tube, S).eye })
		}
		const e = r.move('me', car.x, car.z, (i * 1000) / 60, false, car.y)
		if (e?.type === 'lap') out.done = e.lap
		out.steps = i
	}
	return out
}

describe('WO-1074 §3.1 tunnels in the client', () => {
	it('the carve: the server cell set exactly; carveTracks copies the grid it cuts, the shared decoded grids stay', () => {
		const t = W.track
		const q = t.tunnels[0]
		const line = t.points.slice(q.from, q.to + 1).map((p) => [p[0], p[2]])
		const srv = W.sc.occ.find((g) => g.floor === 'hall')
		const grids = OCC.prepareOcc(W.json.occ)
		const cli = grids.find((g) => g.floor === 'hall')
		const r = t.width / 2 + cli.cell
		const a = OCC.carveCells(cli, line, r)
		const b = SO.carveCells(srv, line, r)
		assert.ok(a.length > 100, `${a.length} cells`)
		assert.deepEqual(a, b, 'client carve = server carve')
		assert.ok(a.some((c) => cli.bits[c]), 'it frees blocked cells of the table')
		const before = cli.bits.slice()
		const out = OCC.carveTracks(grids, TM.prepareTrack(t, S), S)
		assert.deepEqual(cli.bits, before, 'the decoded scene grid is not touched')
		const cut = out.find((g) => g.floor === 'hall')
		assert.notEqual(cut, cli)
		assert.ok(out.find((g) => g.floor === 'stage') === grids.find((g) => g.floor === 'stage'), 'an uncut grid passes through')
		const server = SO.carved(srv, b)
		assert.deepEqual(Array.from(cut.bits), Array.from(server.bits), 'the carved grid = the server validator’s')
		assert.equal(cut.count, cli.count - a.filter((c) => cli.bits[c]).length)
		assert.equal(OCC.carveTracks(grids, TM.prepareTrack({ ...t, tunnels: undefined }, S), S), grids, 'no tunnels → the same list')
		const { env } = envOf(t)
		assert.deepEqual(Array.from(env.ground.occ.find((g) => g.floor === 'hall').bits), Array.from(server.bits), 'createEnv carves the active track')
	})

	it('a bot laps the tunnel track through the table, no wall; without the tunnel entry the same ribbon hits the table', () => {
		const q = W.track.tunnels[0]
		const a = drive(W.track)
		assert.equal(a.done, 1, `lap in ${a.steps} steps`)
		assert.deepEqual(a.walls, [], 'no wall on the whole lap')
		assert.ok(a.inside >= 30, `${a.inside} frames in the tunnel`)
		const b = drive({ ...W.track, tunnels: undefined })
		const atTable = b.walls.filter((s) => s >= q.from - 10 && s <= q.to + 10).length
		assert.ok(atTable >= 10, `${atTable} wall hits at the table (of ${b.walls.length})`)
		assert.equal(b.inside, 0)
	})

	it('cameras: the chase eye stays under the tube ceiling; the director looks in from the exit portal', () => {
		const a = drive(W.track)
		assert.ok(a.eyeGap >= CAM.CEIL_GAP * S - 1e-9, `the chase eye ${a.eyeGap.toFixed(4)} m under the ceiling`)
		assert.ok(a.shots.length >= 30)
		for (const s of a.shots.slice(1)) assert.ok(s.eye.every((v, k) => Math.abs(v - s.portal[k]) < 0.05), 'the portal shot')
		const { T, env } = envOf(W.track)
		const tube = env.tubes[0]
		const mid = T.pts[Math.floor((tube.from + tube.to) / 2)]
		assert.ok(Math.abs(P.ceilingOf(env, mid[0], mid[1], tube.y) - (tube.y + tube.hi)) < 1e-9, 'the apex over the centre line')
		assert.equal(P.ceilingOf(env, mid[0], mid[1], tube.y + 1), Infinity, 'above the tube: no ceiling')
		assert.ok(Math.abs(tube.hi - TUN.TUBE_H * T.width) < 1e-12, 'height 0.75 × width')
		const out = T.pts[(tube.to + 20) % T.n]
		assert.equal(P.tunnelOf(env, out[0], out[1], tube.y), null, 'past the portal: not in it')
	})

	it('tube mesh headless: portals, walls, lights — no NaN, inside the tube volume; minimap dashes; scene cut', () => {
		const { T, env } = envOf(W.track)
		const g = MESH.buildTrackMesh(T, env.ground)
		const tg = g.getObjectByName('tunnels')
		assert.ok(tg, 'a tunnels group')
		const tube = env.tubes[0]
		let n = 0
		tg.traverse((o) => {
			if (!o.isMesh) return
			const p = o.geometry.getAttribute('position').array
			for (let i = 0; i < p.length; i += 3) {
				assert.ok(Number.isFinite(p[i]) && Number.isFinite(p[i + 1]) && Number.isFinite(p[i + 2]), 'no NaN')
				assert.ok(p[i + 1] >= tube.y - 1e-6 && p[i + 1] <= tube.y + tube.ho + 0.12 * S + 1e-6, `y ${p[i + 1]}`)
				n++
			}
		})
		assert.ok(n > 1000, `${n} vertices`)
		assert.equal(MESH.buildTrackMesh(TM.prepareTrack({ ...W.track, tunnels: undefined }, S)).getObjectByName('tunnels'), undefined)
		// the minimap: a dashed stroke over the tunnel stretch
		const dashes = []
		const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'setLineDash' ? (d) => dashes.push(d) : () => {}), set: (t, k, v) => ((t[k] = v), true) })
		DRAW.drawTrack(ctx, T, 200, 200)
		assert.ok(dashes.some((d) => d.length === 2 && d[0] > 0), 'a dash pattern')
		// the scene cut: material patched once, uniforms shared, discard injected
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
		CUT.applyCut(mesh)
		CUT.applyCut(mesh)
		const sh = { uniforms: {}, vertexShader: 'void main() {\n#include <project_vertex>\n}', fragmentShader: 'void main() {\n}' }
		mesh.material.onBeforeCompile(sh)
		assert.match(sh.fragmentShader, /if \(rcInCut\(vRcWorld\)\) discard;/)
		assert.equal(sh.fragmentShader.match(/rcInCut\(vRcWorld\)/g).length, 1, 'patched once')
		CUT.setCut(TUN.cutSegments(env.tubes))
		assert.ok(sh.uniforms.rcCutN.value >= 1 && sh.uniforms.rcCutN.value <= CUT.CUT_MAX)
		CUT.setCut([])
		assert.equal(sh.uniforms.rcCutN.value, 0)
	})
})
