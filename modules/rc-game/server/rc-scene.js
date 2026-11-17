'use strict'

/**
 * WO-1074 — RC car game: the scene from the active project — the MVR scene the previs shows (project.previs.mvr, read
 * through src/stage/mvr-store.js), the tracking stage (project.previs.tracking.grid) and the stage objects
 * (project.previs.stage.objects) → { rev, name, glb, bounds, floors, obstacles, tracks, dropped, stats, venue } + ONE merged GLB.
 * WO-1082: with a venue .glb (project.previs.mvr.venue_glb, WO-1003) the room is drawn from it the way the previs draws
 * it (rc-scene-venue.js): Capture's meshes, materials and (shrunk, rc-scene-tex.js) textures instead of the MVR's flat
 * 3DS parts, plus the objects only the .glb has; the floors, occupancy and height field come from those triangles.
 * WO-1090: an MVR-archive mesh with pictures keeps its materials (rc-scene-rich.js), and the patched heads are drawn
 * from their GDTF rigs at their patch poses, their moving parts in nodes of their own (rc-scene-fixtures.js) — both as
 * the previs draws them; the heads have their own budget (rc-scene-mesh.js planFixtures) and are never obstacles.
 * Baked once per `rev` off the request path (awaiting setImmediate between chunks), one bake at a time, cached on disk
 * under ~/.highascg/cache/rc-game/<rev>.{json,glb,glb.gz} — never in the repo or under projects/. A request during the
 * bake waits for it. Never touches Caspar: reads the project and the MVR store only.
 */

const { core } = require('./host')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const G = require('./rc-scene-geom')
const M = require('./rc-scene-mesh')
const H = require('./rc-scene-height')
const O = require('./rc-scene-occ')
const V = require('./rc-scene-venue')
const T = require('./rc-scene-tex')
const { sceneGlb } = require('./rc-scene-glb')
const R = require('./rc-scene-rich')
const F = require('./rc-scene-fixtures')
const { drapeParts } = require('./rc-scene-drape')
const { RC_SCALE, sceneScale } = require('./rc-scale')
const { generateTracksAsync, GENERATOR_VERSION } = require('./rc-tracks')

const BAKE_VERSION = 10 // bump when the bake's output changes for the same input (2: v2 hall floor, 3D tracks; 3: heights; 4: §3 scale + occ; 5: venue .glb; 6: occ band from FLAT_DECOR; 7: hall level by union area, roomy tours; 8: stage field cleared to FLAT_DECOR; 9: MVR mesh materials, patched heads from their rigs; 10: WO-1104 stage drapes)
const FLAT_DECOR = 0.3 // u (× scale = 3 cm live): what lies this low on a floor is floor, not an occupancy obstacle
const REV_MEMO_MS = 2000
const KEEP_CACHED = 6
const BOX = 'game:box'

const defaultCacheDir = () => path.join(os.homedir(), '.highascg', 'cache', 'rc-game')
const nextTick = () => new Promise((r) => setImmediate(r))

/** What the bake reads from a project → { id, name, cfg, venue, grid, stageObjects, projectName, patch, fixtureColors }. */
function sceneInputs(project) {
	const pv = project?.previs && typeof project.previs === 'object' ? project.previs : {}
	const cfg = pv.mvr && typeof pv.mvr === 'object' ? pv.mvr : {}
	const id = /^[0-9a-f]{12}$/.test(String(cfg.id || '')) ? String(cfg.id) : ''
	return { id, name: String(cfg.name || ''), cfg, venue: typeof cfg.venue_glb === 'string' ? cfg.venue_glb : '', grid: pv.tracking?.grid || null,
		stageObjects: Array.isArray(pv.stage?.objects) ? pv.stage.objects : [], projectName: String(project?.name || ''),
		patch: F.patchOf(project), fixtureColors: pv.fixture_colors && typeof pv.fixture_colors === 'object' ? pv.fixture_colors : {} }
}

let sceneCtx = null
/** The app context (rc-game.js getRcGame / register onBoot): the venue file is found in the project folder of its config. */
function setSceneCtx(ctx) {
	if (ctx) sceneCtx = ctx
}
/** The venue .glb `name` in the open project's folder → its path or null (src/media/project-files.js). */
function defaultVenueFile(name) {
	try {
		return core('src/media/project-files').resolve(sceneCtx || {}, name)
	} catch {
		return null
	}
}

/** The revision: scene id + a hash of everything that changes the bake (§3: the scale too). */
function revOf(inp, recStat, scale = 1) {
	const c = inp.cfg
	const h = crypto.createHash('sha1').update(JSON.stringify([BAKE_VERSION, GENERATOR_VERSION, inp.id, recStat, c.place, c.hidden_layers, c.hidden_objects,
		c.layer_colors, c.moved, inp.grid, inp.stageObjects, M.MAX_TRIS, M.MAX_BYTES, scale, FLAT_DECOR,
		...(inp.venue ? [inp.venue, inp.venueStat ?? null, T.TEX_BUDGET, T.MAX_EDGE] : []),
		...(inp.patch?.length ? [inp.patch, inp.fixtureColors || {}, inp.typeStat ?? null, M.FIX_MAX_TRIS] : [])]))
	return `${inp.id || 'none'}-${h.digest('hex').slice(0, 10)}`
}

const boxPart = (min, max, color, name) => ({ key: BOX, name, color, fixture: false, uuid: name,
	xf: [max[0] - min[0], 0, 0, 0, max[1] - min[1], 0, 0, 0, max[2] - min[2], (min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] })

/**
 * The bake itself (exported for the smokes and the timing probe). deps: { mvrStore: { get, mesh }, pause, scale, gdtf, meanColor, encodeImage }.
 * → { json, glb }. deps.scale (§3, default 1 = the v2 bake): below 1 the scene carries `scale`, one occupancy grid per
 * floor (`occ`: the band floor … + 0.6 × scale at 0.3 × scale cells), a finer deflated height field and no obstacle
 * boxes (the grids replace them), and the tracks are the toy set (rc-toy-tracks.js).
 */
async function bakeScene(inp, rev, deps = {}) {
	const t0 = Date.now()
	const scale = sceneScale(null, { scale: deps.scale })
	const toy = scale !== 1
	const pause = deps.pause || nextTick
	const store = deps.mvrStore || core('src/stage/mvr-store')
	const rec = inp.id ? store.get(inp.id) : null
	const templates = new Map([[BOX, M.boxTemplate()]])
	const venue = rec?.scene && inp.venue ? await loadVenue(inp, rec.scene, deps.venueFile || defaultVenueFile, deps.meanColor || T.ffmpegMeanColor) : null
	const rig = rec?.scene ? await F.rigParts(inp, rec.scene, deps.gdtf || core('src/fixtures/gdtf-store'), M.readTemplate) : null
	// a patched head drawn from its rig replaces the MVR object it was patched from (the previs hides that one too)
	const parts = (venue?.parts || (rec?.scene ? G.visibleParts(rec.scene, inp.cfg) : [])).filter((p) => !(p.fixture && rig?.replaced.has(p.uuid)))
	const failed = [...(rig?.failed || [])]
	const rich = R.createRich()
	for (const key of new Set(parts.map((p) => p.key))) {
		let t
		try {
			if (key.startsWith(V.KEY)) t = venue.model.template(Number(key.slice(V.KEY.length)))
			else {
				const buf = await store.mesh(inp.id, key)
				t = buf && !rich.add(key, buf) ? M.readTemplate(buf) : null
			}
		} catch {
			t = null
		}
		if (t) templates.set(key, t)
		else if (!rich.has(key)) failed.push(key)
		if (!key.startsWith(V.KEY) || templates.size % 64 === 0) await pause()
	}
	const richFlat = await rich.flatten(parts, deps.meanColor || T.ffmpegMeanColor)
	for (const key of new Set(parts.map((p) => p.key))) {
		if (!rich.has(key)) continue
		const t = rich.template(key)
		if (t) templates.set(key, t)
		else failed.push(key)
	}
	for (const [k, t] of rig?.templates || []) templates.set(k, t)
	if (rig) parts.push(...rig.parts)
	for (const b of G.stageObjectBoxes(inp.stageObjects)) parts.push({ key: BOX, xf: b.xf, color: b.color, fixture: false, uuid: b.name })
	const drapes = drapeParts(inp.stageObjects) // WO-1104: their own pleats, obstacles like any wall
	for (const [k, t] of drapes.templates) templates.set(k, t)
	parts.push(...drapes.parts)
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
	const plan = await planAll(parts, templates, pause)
	const grids = toy ? [] : floors.map((f) => ({ floor: f, grid: G.slabGrid(f, Math.max(0.25, Math.max(f.rect[2] - f.rect[0], f.rect[3] - f.rect[1]) / 400)) }))
	// WO-1082: the band starts at FLAT_DECOR (3 cm live), not 5 mm: what stays lower in a cell is floor to drive on (v2's
	// ground rule — a step ≤ 0.3 u is driven over), also where a large / sloped triangle only rises above it elsewhere
	const occ = toy ? floors.map((f) => O.createOcc(f, { cell: 0.3 * scale, lo: FLAT_DECOR * scale, hi: 0.6 * scale })) : []
	const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
	// §2.7: the height field (what stands under / hangs over an elevated deck) is filled in the same pass
	const field = H.createHeightField(hall.rect, hall.y, toy ? { cell: 0.5 * scale, bin: 0.25 * scale, eps: 0.05 * scale, deflate: true } : {})
	const onTri = (...v) => {
		for (let k = 0; k < 9; k++) {
			if (v[k] < lo[k % 3]) lo[k % 3] = v[k]
			if (v[k] > hi[k % 3]) hi[k % 3] = v[k]
		}
		for (const g of grids) g.grid.tri(...v)
		// WO-1082: flat decor — a triangle lying wholly within FLAT_DECOR u of a floor (a rug, a mat, a cable cover, a carpet
		// laid on the hall floor) is driven over, not around: it never blocks a cell (v2's ground rule: a step ≤ 0.3 u)
		const top = Math.max(v[1], v[4], v[7])
		for (const g of occ) if (top > g.y + FLAT_DECOR * scale) g.tri(...v)
		field.tri(...v)
	}
	const inst = await M.instanceParts(parts, templates, plan, onTri, pause)
	// (parts the GLB leaves out — fixtures, dropped small objects — are not drawn, so a deck may pass through them)
	// the stage seen from the hall is a wall of the ground model (and its ramps' destination), not an obstacle
	if (stage && stage.y > hall.y + 0.05) for (const g of [grids[0]?.grid, occ[0]]) if (g) g.clear(stage.rect, 0.02)
	// WO-1082: the stage's own flat decor (a covering 1 cm proud, tape, a mat) is stage floor in the height field too, as in occ
	if (stage && stage.y > hall.y) field.clearBelow(stage.rect, stage.y + FLAT_DECOR * scale)
	const obstacles = G.obstaclesFrom(grids.map((g) => ({ floor: g.floor, grid: g.grid })))
	for (const f of floors) {
		lo[0] = Math.min(lo[0], f.rect[0]); lo[1] = Math.min(lo[1], f.y); lo[2] = Math.min(lo[2], f.rect[1])
		hi[0] = Math.max(hi[0], f.rect[2]); hi[1] = Math.max(hi[1], f.y + 3); hi[2] = Math.max(hi[2], f.rect[3])
	}
	const r3 = (v) => Math.round(v * 1000) / 1000
	const gen = await generateTracksAsync({ floors, obstacles, bounds: { min: lo, max: hi }, field, ...(toy ? { scale, occ } : {}) }, pause)
	const arena = gen.floors.find((f) => f.id === 'arena')
	if (arena) inst.primitives.push(...arenaSlab(arena))
	const lines = venue?.model ? V.venueLines(venue.lineParts, venue.model, Math.max(plan.cell, 0.01)) : []
	inst.primitives.push(...lines)
	const matOf = (tex) => (typeof tex === 'string' ? rich.material(tex) : venueMaterial(venue.model, tex))
	const tex = await sceneTextures(matOf, inst.primitives, { encode: deps.encodeImage, pause, meanColor: deps.meanColor || T.ffmpegMeanColor })
	const heads = (rig?.heads || []).filter((h) => inst.primitives.some((p) => p.node?.startsWith(`${h.id}|`)))
	const nodeExtras = new Map(heads.flatMap((h) => ['pan', 'tilt'].map((a) => [`${h.id}|${a}`, { rcHead: h.id, rcAxis: a }])))
	const own = venue?.model || inst.primitives.some((p) => p.tex != null || p.node)
	const glb = own ? sceneGlb(inst.primitives, tex.mats, nodeExtras) : M.sceneGlb(inst.primitives)
	const json = {
		rev, name: rec?.name || inp.name || inp.projectName || 'Empty arena', glb: `/api/game/rc/scene.glb?rev=${rev}`,
		...(toy ? { scale } : {}),
		bounds: { min: gen.bounds.min.map(r3), max: gen.bounds.max.map(r3) }, floors: gen.floors, obstacles, heights: field.toJSON(),
		...(toy ? { occ: occ.map((g) => g.toJSON()) } : {}), tracks: gen.tracks,
		dropped: { fixtures: plan.dropped.fixtures, objects: plan.dropped.objects, simplifiedCellM: plan.dropped.cell,
			meshesFailed: failed.length, venueGlb: venue ? venue.status : null },
		...(heads.length ? { heads } : {}),
		...(rig?.parts.length ? { rig: { heads: new Set(rig.parts.map((p) => p.uuid)).size, drawn: plan.fixtures.drawn, moving: heads.length,
			triangles: plan.fixtures.tris, perHead: plan.fixtures.perFix } } : {}),
		...(tex.count || tex.leftOut || richFlat.length ? { materials: { textures: tex.count, textureBytes: tex.bytes, flatTextures: richFlat, leftOut: tex.leftOut } } : {}),
		...(venue?.model ? { venue: { file: inp.venue, swapped: venue.swapped, extra: venue.extra, extraLayers: venue.layers, textures: tex.count, textureBytes: tex.bytes,
			flatTextures: venue.flat, lineSegments: lines.reduce((n, l) => n + l.indices.length / 2, 0) } } : {}),
		stats: { triangles: inst.tris + (arena ? 2 : 0), bytes: glb.length, parts: plan.keep.filter(Boolean).length, bakeMs: Date.now() - t0 },
	}
	return { json, glb }
}

/**
 * The venue .glb → { status: 'used' | 'missing' | 'unreadable', model, parts, swapped, extra, layers }. Anything short of
 * a readable file leaves `parts` null (the MVR's own parts are drawn) and says why in `status`.
 */
async function loadVenue(inp, scene, venueFile, meanColor) {
	let buf
	try {
		const file = venueFile(inp.venue)
		buf = file ? await fs.promises.readFile(file) : null
	} catch {
		buf = null
	}
	if (!buf) return { status: 'missing', parts: null }
	let model
	try {
		model = V.parseVenue(buf)
	} catch {
		return { status: 'unreadable', parts: null }
	}
	if (!model.meshes) return { status: 'unreadable', parts: null }
	const v = V.venueParts(scene, inp.cfg, model)
	const mesh = (p) => (p.key.startsWith(V.KEY) ? Number(p.key.slice(V.KEY.length)) : -1)
	const lineParts = v.parts.filter((p) => mesh(p) >= 0 && model.hasLines(mesh(p)))
	const parts = v.parts.filter((p) => mesh(p) < 0 || model.hasTris(mesh(p)) || !model.hasLines(mesh(p))) // line-only meshes: venueLines
	const flat = await V.flattenHeavyTextures(model, parts, meanColor)
	return { status: 'used', model, ...v, parts, lineParts, flat }
}

/** A venue material (by index) as a texture record: its name and picture (rc-scene-glb.js keeps the rest as before). */
const venueMaterial = (model, i) => {
	const m = model?.materials[i]
	return m ? { name: m.name || '', image: m.image != null ? model.images[m.image] : null } : null
}

/**
 * The pictures the kept textured buckets use — the venue's and (WO-1090) the MVR meshes' own — shrunk together under
 * one budget (rc-scene-tex.js). matOf(tex) → material record | null. A picture that is left out (over the budget, or
 * not encodable) leaves its buckets in its mean colour × the colour factor, without UVs (the venue's heavy-texture
 * rule). → { mats: Map tex → record with shrunk `image` / `emissiveImage`, count, bytes, leftOut }.
 */
async function sceneTextures(matOf, primitives, o = {}) {
	const recs = new Map()
	for (const p of primitives) if (p.tex != null && !recs.has(p.tex)) recs.set(p.tex, matOf(p.tex) || { name: '' })
	const images = []
	const at = new Map()
	const slot = (im) => {
		if (!im?.data) return null
		if (!at.has(im)) at.set(im, images.push(im) - 1)
		return at.get(im)
	}
	const want = new Map([...recs].map(([k, m]) => [k, { base: slot(m.image), glow: slot(m.emissiveImage) }]))
	const shrunk = images.length ? await T.shrinkImages(images, { encode: o.encode, pause: o.pause }) : []
	const mats = new Map()
	let leftOut = 0
	for (const [k, m] of recs) {
		const w = want.get(k)
		const image = w.base != null ? shrunk[w.base] : null
		mats.set(k, { ...m, name: m.name || '', image, emissiveImage: w.glow != null ? shrunk[w.glow] : null })
		if (w.base == null || image) continue
		leftOut++
		const c = o.meanColor ? await o.meanColor(m.image).catch(() => null) : null
		if (!Array.isArray(c) || c.length < 3) continue
		for (const p of primitives) {
			if (p.tex !== k) continue
			p.color = [0, 1, 2].map((n) => (p.color?.[n] ?? 1) * c[n]).concat(1)
			delete p.uvs
		}
	}
	const keys = new Map(shrunk.filter(Boolean).map((s) => [s.key, s.data.length]))
	return { mats, count: keys.size, bytes: [...keys.values()].reduce((a, b) => a + b, 0), leftOut }
}

/**
 * The room's plan — planBudget over the parts that are not fixtures, as before WO-1090, so the rig never coarsens the
 * room (or moves its obstacles) — then the fixtures in what the room left (planFixtures). → planBudget's shape plus
 * `cells` (per part) and `fixtures: { drawn, tris, perFix }`; dropped.fixtures = heads not drawn.
 */
async function planAll(parts, templates, pause) {
	const roomAt = [], fxAt = []
	parts.forEach((p, i) => (p.fixture ? fxAt : roomAt).push(i))
	const room = await M.planBudget(roomAt.map((i) => parts[i]), templates, pause)
	const fx = await M.planFixtures(fxAt.map((i) => parts[i]), templates, { tris: M.MAX_TRIS - room.tris, bytes: M.MAX_BYTES - room.bytes }, pause)
	const keep = parts.map(() => false)
	const cells = parts.map(() => room.cell)
	roomAt.forEach((i, k) => (keep[i] = room.keep[k]))
	fxAt.forEach((i, k) => {
		keep[i] = fx.keep[k]
		cells[i] = fx.cells[k]
	})
	/* The obstacles and the height field never depend on how the heads are drawn: an MVR fixture part (no rig found) is
	   one only when the bake before WO-1090 kept it too — everything fitting unsimplified (planBudget's first step) —
	   else it is drawn only (`ghost`), like a rig's head always is. */
	const left = { maxTris: M.MAX_TRIS - room.tris, maxBytes: M.MAX_BYTES - room.bytes }
	const solid = room.cell === M.CELLS[0] && !room.dropped.objects && fxAt.length > 0 && left.maxTris > 0 && left.maxBytes > 0
		&& (await M.planBudget(fxAt.map((i) => parts[i]), templates, pause, left)).dropped.fixtures === 0
	for (const i of fxAt) if (!solid) parts[i].ghost = true
	const all = new Set(fxAt.map((i) => parts[i].uuid))
	const drawn = new Set(fxAt.filter((i) => keep[i]).map((i) => parts[i].uuid))
	return { cell: room.cell, keep, cells, tris: room.tris + fx.tris, bytes: room.bytes + fx.bytes,
		dropped: { ...room.dropped, fixtures: all.size - drawn.size }, fixtures: { drawn: drawn.size, tris: fx.tris, perFix: fx.perFix } }
}

function arenaSlab(a) {
	const pos = new Float32Array([a.rect[0], a.y, a.rect[1], a.rect[2], a.y, a.rect[1], a.rect[2], a.y, a.rect[3], a.rect[0], a.y, a.rect[3]])
	return [{ positions: pos, indices: new Uint32Array([0, 2, 1, 0, 3, 2]), color: [0.1, 0.1, 0.11, 1], flat: true }]
}

/**
 * The scene service. deps: { loadProject, mvrStore, cacheDir, log, now, pause, scale (default RC_SCALE), gdtf (default gdtf-store) }.
 * → { rev(), get() → Promise<{ rev, json, text, glb, gz }>, peek() }
 */
function createSceneBaker(deps = {}) {
	const loadProject = deps.loadProject || (() => core('src/engine/project-scenes').loadFullProject())
	const store = deps.mvrStore || core('src/stage/mvr-store')
	const cacheDir = deps.cacheDir || defaultCacheDir()
	const now = deps.now || Date.now
	const log = deps.log || (() => {})
	const scale = deps.scale ?? RC_SCALE // §3: the live game is toy scale
	let memo = null // { at, inp, rev }
	let ready = null // the last finished bake
	const inflight = new Map()
	let queue = Promise.resolve()
	let gen = 0 // WO-1106 B52: drop() bumps it, so a bake that finishes after a disable is not kept

	function current() {
		if (memo && now() - memo.at < REV_MEMO_MS) return memo
		let project
		try {
			project = loadProject()
		} catch {
			project = null
		}
		const inp = sceneInputs(project)
		if (inp.venue) {
			try {
				const f = (deps.venueFile || defaultVenueFile)(inp.venue)
				const s = f ? fs.statSync(f) : null
				inp.venueStat = s ? [s.size, Math.round(s.mtimeMs)] : 'missing'
			} catch {
				inp.venueStat = 'missing'
			}
		}
		if (inp.patch.length) {
			// WO-1090: a type imported (or removed) since changes what the heads are drawn from
			const g = deps.gdtf || core('src/fixtures/gdtf-store')
			inp.typeStat = [...new Set(inp.patch.map((f) => f.typeId))].map((t) => {
				try {
					return [t, !!g.info(t)]
				} catch {
					return [t, false]
				}
			})
		}
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
		memo = { at: now(), inp, rev: revOf(inp, st, scale) }
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
		const { json, glb } = await bakeScene(inp, rev, { mvrStore: store, pause: deps.pause, scale, venueFile: deps.venueFile, encodeImage: deps.encodeImage, gdtf: deps.gdtf })
		const gz = await new Promise((res) => zlib.gzip(glb, { level: 6 }, (e, b) => res(e ? null : b)))
		const out = { rev, json, text: JSON.stringify(json), glb, gz }
		log('info', `[rc-game] scene ${rev} baked in ${json.stats.bakeMs} ms: ${json.stats.triangles} triangles, ${glb.length} bytes, ` +
			`${json.floors.length} floors, ${json.obstacles.length} obstacles, ${json.tracks.length} tracks`)
		await toDisk(out)
		return out
	}

	/**
	 * The current scene, baked (or from the cache). Concurrent callers share one bake; bakes run one at a time.
	 * WO-1106 B40: a queued bake whose rev is no longer current bakes (or reuses) the current one instead — edits during
	 * a long bake cost one more bake, not one each.
	 */
	function get() {
		const { inp, rev } = current()
		if (ready && ready.rev === rev) return Promise.resolve(ready)
		if (inflight.has(rev)) return inflight.get(rev)
		const g = gen
		const step = () => {
			const cur = current()
			const job = cur.rev === rev ? { inp, rev } : cur
			return ready && ready.rev === job.rev ? ready : build(job.inp, job.rev)
		}
		const p = (queue = queue.then(step).then((out) => {
			if (g === gen) ready = out
			return out
		}).finally(() => inflight.delete(rev)))
		queue = p.catch(() => {})
		inflight.set(rev, p)
		return p
	}

	/** WO-1106 B52: forget the last bake and the rev memo (the game was disabled); the disk cache stays. */
	function drop() {
		gen++
		ready = memo = null
	}

	return { rev: () => current().rev, get, peek: () => ready, drop, cacheDir }
}

module.exports = { createSceneBaker, bakeScene, sceneInputs, revOf, setSceneCtx }
