'use strict'

/**
 * WO-1074 — RC car game: the scene from the active project — the MVR scene the previs shows (project.previs.mvr, read
 * through src/stage/mvr-store.js), the tracking stage (project.previs.tracking.grid) and the stage objects
 * (project.previs.stage.objects) → { rev, name, glb, bounds, floors, obstacles, tracks, dropped, stats } + ONE merged GLB.
 * Baked once per `rev` off the request path (awaiting setImmediate between chunks), one bake at a time, cached on disk
 * under ~/.highascg/cache/rc-game/<rev>.{json,glb,glb.gz} — never in the repo or under projects/. A request during the
 * bake waits for it. Never touches Caspar: reads the project and the MVR store only.
 */

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const G = require('./rc-scene-geom')
const M = require('./rc-scene-mesh')
const { generateTracksAsync } = require('./rc-tracks')

const BAKE_VERSION = 1 // bump when the bake's output changes for the same input
const REV_MEMO_MS = 2000
const KEEP_CACHED = 6
const BOX = 'game:box'

const defaultCacheDir = () => path.join(os.homedir(), '.highascg', 'cache', 'rc-game')
const nextTick = () => new Promise((r) => setImmediate(r))

/** What the bake reads from a project → { id, name, cfg, grid, stageObjects, projectName }. */
function sceneInputs(project) {
	const pv = project?.previs && typeof project.previs === 'object' ? project.previs : {}
	const cfg = pv.mvr && typeof pv.mvr === 'object' ? pv.mvr : {}
	const id = /^[0-9a-f]{12}$/.test(String(cfg.id || '')) ? String(cfg.id) : ''
	return { id, name: String(cfg.name || ''), cfg, grid: pv.tracking?.grid || null,
		stageObjects: Array.isArray(pv.stage?.objects) ? pv.stage.objects : [], projectName: String(project?.name || '') }
}

/** The revision: scene id + a hash of everything that changes the bake. */
function revOf(inp, recStat) {
	const c = inp.cfg
	const h = crypto.createHash('sha1').update(JSON.stringify([BAKE_VERSION, inp.id, recStat, c.place, c.hidden_layers, c.hidden_objects,
		c.layer_colors, c.moved, inp.grid, inp.stageObjects, M.MAX_TRIS, M.MAX_BYTES]))
	return `${inp.id || 'none'}-${h.digest('hex').slice(0, 10)}`
}

const boxPart = (min, max, color, name) => ({ key: BOX, name, color, fixture: false, uuid: name,
	xf: [max[0] - min[0], 0, 0, 0, max[1] - min[1], 0, 0, 0, max[2] - min[2], (min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] })

/**
 * The bake itself (exported for the smokes and the timing probe). deps: { mvrStore: { get, mesh }, pause }.
 * → { json, glb }.
 */
async function bakeScene(inp, rev, deps = {}) {
	const t0 = Date.now()
	const pause = deps.pause || nextTick
	const store = deps.mvrStore || require('../stage/mvr-store')
	const rec = inp.id ? store.get(inp.id) : null
	const templates = new Map([[BOX, M.boxTemplate()]])
	const parts = rec?.scene ? G.visibleParts(rec.scene, inp.cfg) : []
	const failed = []
	for (const key of new Set(parts.map((p) => p.key))) {
		let t
		try {
			const buf = await store.mesh(inp.id, key)
			t = buf ? M.readTemplate(buf) : null
		} catch {
			t = null
		}
		if (t) templates.set(key, t)
		else failed.push(key)
		await pause()
	}
	for (const b of G.stageObjectBoxes(inp.stageObjects)) parts.push({ key: BOX, xf: b.xf, color: b.color, fixture: false, uuid: b.name })
	const boxes = []
	for (const p of parts) {
		const t = templates.get(p.key)
		if (t && !p.fixture) boxes.push(G.boxUnder(p.xf, t.bounds.min, t.bounds.max))
	}
	const footprint = boxes.length ? boxes.reduce((r, b) => [Math.min(r[0], b.min[0]), Math.min(r[1], b.min[2]), Math.max(r[2], b.max[0]), Math.max(r[3], b.max[2])],
		[Infinity, Infinity, -Infinity, -Infinity]) : null
	const stage = G.stageFloor(inp.grid)
	const hall = G.hallFloor(rec ? boxes : [], rec ? footprint : null, stage)
	const floors = stage ? [hall, stage] : [hall]
	if (!rec) {
		// No MVR: the floors are drawn so the arena is not a void (the hall's slab, the stage as a deck standing on it).
		parts.push(boxPart([hall.rect[0], hall.y - 0.05, hall.rect[1]], [hall.rect[2], hall.y, hall.rect[3]], [0.1, 0.1, 0.11, 1], 'hall floor'))
		if (stage && stage.y > hall.y + 0.05) parts.push(boxPart([stage.rect[0], hall.y, stage.rect[1]], [stage.rect[2], stage.y, stage.rect[3]], [0.05, 0.05, 0.06, 1], 'stage deck'))
	}
	const plan = await M.planBudget(parts, templates, pause)
	const grids = floors.map((f) => ({ floor: f, grid: G.slabGrid(f, Math.max(0.25, Math.max(f.rect[2] - f.rect[0], f.rect[3] - f.rect[1]) / 400)) }))
	const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
	const onTri = (...v) => {
		for (let k = 0; k < 9; k++) {
			if (v[k] < lo[k % 3]) lo[k % 3] = v[k]
			if (v[k] > hi[k % 3]) hi[k % 3] = v[k]
		}
		for (const g of grids) g.grid.tri(...v)
	}
	const inst = await M.instanceParts(parts, templates, plan, onTri, pause)
	if (stage && stage.y > hall.y + 0.05) grids[0].grid.box([stage.rect[0], hall.y, stage.rect[1]], [stage.rect[2], stage.y, stage.rect[3]])
	const obstacles = G.obstaclesFrom(grids.map((g) => ({ floor: g.floor, rects: g.grid.rects() })))
	for (const f of floors) {
		lo[0] = Math.min(lo[0], f.rect[0]); lo[1] = Math.min(lo[1], f.y); lo[2] = Math.min(lo[2], f.rect[1])
		hi[0] = Math.max(hi[0], f.rect[2]); hi[1] = Math.max(hi[1], f.y + 3); hi[2] = Math.max(hi[2], f.rect[3])
	}
	const r3 = (v) => Math.round(v * 1000) / 1000
	const gen = await generateTracksAsync({ floors, obstacles, bounds: { min: lo, max: hi } }, pause)
	const arena = gen.floors.find((f) => f.id === 'arena')
	if (arena) inst.primitives.push(...arenaSlab(arena))
	const glb = M.sceneGlb(inst.primitives)
	const json = {
		rev, name: rec?.name || inp.name || inp.projectName || 'Empty arena', glb: `/api/game/rc/scene.glb?rev=${rev}`,
		bounds: { min: gen.bounds.min.map(r3), max: gen.bounds.max.map(r3) }, floors: gen.floors, obstacles, tracks: gen.tracks,
		dropped: { fixtures: plan.dropped.fixtures, objects: plan.dropped.objects, simplifiedCellM: plan.dropped.cell,
			meshesFailed: failed.length, venueGlb: inp.cfg.venue_glb ? 'ignored' : null },
		stats: { triangles: inst.tris + (arena ? 2 : 0), bytes: glb.length, parts: plan.keep.filter(Boolean).length, bakeMs: Date.now() - t0 },
	}
	return { json, glb }
}

function arenaSlab(a) {
	const pos = new Float32Array([a.rect[0], a.y, a.rect[1], a.rect[2], a.y, a.rect[1], a.rect[2], a.y, a.rect[3], a.rect[0], a.y, a.rect[3]])
	return [{ positions: pos, indices: new Uint32Array([0, 2, 1, 0, 3, 2]), color: [0.1, 0.1, 0.11, 1], flat: true }]
}

/**
 * The scene service. deps: { loadProject, mvrStore, cacheDir, log, now, pause }.
 * → { rev(), get() → Promise<{ rev, json, text, glb, gz }>, peek() }
 */
function createSceneBaker(deps = {}) {
	const loadProject = deps.loadProject || (() => require('../engine/project-scenes').loadFullProject())
	const store = deps.mvrStore || require('../stage/mvr-store')
	const cacheDir = deps.cacheDir || defaultCacheDir()
	const now = deps.now || Date.now
	const log = deps.log || (() => {})
	let memo = null // { at, inp, rev }
	let ready = null // the last finished bake
	const inflight = new Map()
	let queue = Promise.resolve()

	function current() {
		if (memo && now() - memo.at < REV_MEMO_MS) return memo
		let project
		try {
			project = loadProject()
		} catch {
			project = null
		}
		const inp = sceneInputs(project)
		let st = null
		if (inp.id) {
			try {
				const f = store.fileOf ? store.fileOf(inp.id, '.json') : null
				const s = f ? fs.statSync(f) : null
				st = s ? [s.size, Math.round(s.mtimeMs)] : 'gone'
			} catch {
				st = 'gone'
			}
		}
		if (st === 'gone') inp.id = ''
		memo = { at: now(), inp, rev: revOf(inp, st) }
		return memo
	}

	async function fromDisk(rev) {
		try {
			const base = path.join(cacheDir, rev)
			const [text, glb, gz] = await Promise.all([fs.promises.readFile(`${base}.json`, 'utf8'), fs.promises.readFile(`${base}.glb`),
				fs.promises.readFile(`${base}.glb.gz`).catch(() => null)])
			return { rev, json: JSON.parse(text), text, glb, gz }
		} catch {
			return null
		}
	}

	async function toDisk(out) {
		try {
			await fs.promises.mkdir(cacheDir, { recursive: true })
			for (const [ext, data] of [['.glb', out.glb], ['.glb.gz', out.gz], ['.json', out.text]]) {
				if (!data) continue
				const f = path.join(cacheDir, out.rev + ext)
				await fs.promises.writeFile(`${f}.tmp`, data)
				await fs.promises.rename(`${f}.tmp`, f)
			}
			const all = (await fs.promises.readdir(cacheDir)).filter((f) => /\.json$/.test(f))
			const stats = await Promise.all(all.map(async (f) => ({ f, t: (await fs.promises.stat(path.join(cacheDir, f))).mtimeMs })))
			stats.sort((a, b) => b.t - a.t)
			for (const { f } of stats.slice(KEEP_CACHED)) {
				const base = f.replace(/\.json$/, '')
				for (const ext of ['.json', '.glb', '.glb.gz']) await fs.promises.rm(path.join(cacheDir, base + ext), { force: true })
			}
		} catch (e) {
			log('warn', `[rc-game] scene cache not written: ${e.message}`)
		}
	}

	async function build(inp, rev) {
		const disk = await fromDisk(rev)
		if (disk) return disk
		const { json, glb } = await bakeScene(inp, rev, { mvrStore: store, pause: deps.pause })
		const gz = await new Promise((res) => zlib.gzip(glb, { level: 6 }, (e, b) => res(e ? null : b)))
		const out = { rev, json, text: JSON.stringify(json), glb, gz }
		log('info', `[rc-game] scene ${rev} baked in ${json.stats.bakeMs} ms: ${json.stats.triangles} triangles, ${glb.length} bytes, ` +
			`${json.floors.length} floors, ${json.obstacles.length} obstacles, ${json.tracks.length} tracks`)
		await toDisk(out)
		return out
	}

	/** The current scene, baked (or from the cache). Concurrent callers share one bake; bakes run one at a time. */
	function get() {
		const { inp, rev } = current()
		if (ready && ready.rev === rev) return Promise.resolve(ready)
		if (inflight.has(rev)) return inflight.get(rev)
		const p = (queue = queue.then(() => build(inp, rev)).then((out) => {
			ready = out
			return out
		}).finally(() => inflight.delete(rev)))
		queue = p.catch(() => {})
		inflight.set(rev, p)
		return p
	}

	return { rev: () => current().rev, get, peek: () => ready, cacheDir }
}

module.exports = { createSceneBaker, bakeScene, sceneInputs, revOf }
