'use strict'

/**
 * WO-1090 — the patched heads in the game scene, as the previs draws them (godot/client/features/previs/fixtures/
 * fixtures_3d.gd `_build`): every enabled patched fixture whose GDTF type + mode has a rig (src/fixtures/gdtf-store.js
 * `visual(typeId, mode).rig`) is its rig's meshes — models/gltf/*.glb or models/3ds/*.3ds read as the previs reads them
 * (GET /api/fixtures/types/<id>/model: a 3DS colour left unspecified is the black fixture body, FIXTURE_BODY) — at
 * pose_xform(pose) · node chain · mesh_xf, tinted by its type's colour (project.previs.fixture_colors), else by the
 * colour of the MVR layer it was patched from (`mvr-<uuid>`), else its own. A head on a hidden MVR layer is not drawn.
 * The MVR object a patched head came from is not drawn either (mvr_scene.gd `set_patched`) — only once its rig is
 * found, so a box without the type keeps the MVR's own parts.
 *
 * Moving heads: the rig's pan / tilt axes above its first beam (rc-lights-fk.js `fk` pivot chain). The parts under the
 * tilt axis go into the GLB node of `<id>|tilt`, the rest under the pan axis into `<id>|pan`; `heads` tells the client
 * where those axes are at rest (world origin + unit axis) and the beam's rest direction, so the client (head-follow.js)
 * turns them to the direction the live lights stream (`lx`) for that head.
 *
 *   patchOf(project) → [{ id, typeId, mode, pose, enabled }] (sceneInputs: part of the bake's revision)
 *   rigParts(inp, scene, gdtf, readTemplate) → Promise<{ parts, templates: Map, heads, replaced: Set uuid, failed }>
 *     gdtf: { visual(typeId, mode), member(typeId, path) → Promise<Buffer | null>, describe?(typeId) }
 */

const { core } = require('./host')
const G = require('./rc-scene-geom')
const { boxTemplate } = require('./rc-scene-mesh')
const { headFrame } = require('./rc-lights-fk')

const KEY = 'rig:' // template keys: rig:<typeId>:<archive path>
const MAX_HEADS = 64 // moving heads the client turns (more stay at rest: one draw call per moving group)

function patchOf(project) {
	let list
	try {
		list = core('src/fixtures/follow-patch').normalizePatch(project?.fixtures).fixtures
	} catch {
		list = []
	}
	return list.filter((f) => /^[0-9a-f]{12}$/.test(String(f.typeId || '')) && f.mode)
		.map((f) => ({ id: String(f.id), typeId: String(f.typeId), mode: String(f.mode), pose: f.pose, enabled: f.enabled !== false }))
}

const xfOf = (xf) => (Array.isArray(xf) && xf.length === 12 && xf.every(Number.isFinite) ? xf : G.IDENTITY)
const unit = (v) => {
	const l = Math.hypot(v[0], v[1], v[2]) || 1
	return v.map((x) => Math.round((x / l) * 1e6) / 1e6)
}
const r4 = (v) => Math.round(v * 1e4) / 1e4

/** The largest declared side (m) of the GDTF model whose file is `file` (routes-fixture-types.js declaredSize), or 0. */
function declaredSize(gdtf, typeId, file) {
	const stem = String(file).split('/').pop().replace(/\.[^.]+$/, '').toLowerCase()
	let best = 0
	for (const m of Object.values(gdtf.describe?.(typeId)?.models || {})) {
		if (String(m?.file || '').toLowerCase() === stem && Array.isArray(m.size)) best = Math.max(best, ...m.size.map((v) => Number(v) || 0))
	}
	return best
}

/** One rig mesh as a template (null when missing / unreadable). */
async function meshTemplate(gdtf, typeId, file, readTemplate) {
	if (String(file).startsWith('prim:')) return boxTemplate() // a GDTF built-in shape: its box (mesh_xf sizes it)
	const buf = await gdtf.member(typeId, file)
	if (!buf) return null
	let glb
	if (/\.glb$/i.test(file)) glb = core('src/stage/glb-units').fixGlbUnits(buf, declaredSize(gdtf, typeId, file)).glb
	else glb = core('src/stage/mvr-3ds').threeDsToGlb(buf, { fixtureBody: true })
	return readTemplate(glb)
}

/** The pan / tilt node indices on the chain above the rig's first beam (pan outermost), or null each. */
function axesOf(nodes) {
	const first = nodes.findIndex((n) => n?.kind === 'Beam')
	let pan = null, tilt = null
	for (let j = first, guard = 0; j >= 0 && guard < 64; j = nodes[j].parent, guard++) {
		if (nodes[j].axis === 'tilt' && tilt == null && pan == null) tilt = j
		else if (nodes[j].axis === 'pan' && pan == null) pan = j
		if (!Number.isInteger(nodes[j].parent)) break
	}
	return { pan, tilt }
}

async function rigParts(inp, scene, gdtf, readTemplate) {
	const cfg = inp.cfg && typeof inp.cfg === 'object' ? inp.cfg : {}
	const hidden = new Set((Array.isArray(cfg.hidden_layers) ? cfg.hidden_layers : []).map(String))
	const typeColors = inp.fixtureColors && typeof inp.fixtureColors === 'object' ? inp.fixtureColors : {}
	const layerColors = cfg.layer_colors && typeof cfg.layer_colors === 'object' ? cfg.layer_colors : {}
	const objects = new Map((scene?.objects || []).map((o) => [String(o?.uuid || '').toLowerCase(), o]))
	const out = { parts: [], templates: new Map(), heads: [], replaced: new Set(), failed: [] }
	const tried = new Set()
	for (const f of Array.isArray(inp.patch) ? inp.patch : []) {
		let rig
		try {
			rig = gdtf.visual(f.typeId, f.mode)?.rig || null
		} catch {
			rig = null
		}
		const nodes = Array.isArray(rig?.nodes) ? rig.nodes : []
		if (!nodes.length) continue
		const uuid = f.id.startsWith('mvr-') ? f.id.slice(4).toLowerCase() : ''
		const obj = uuid ? objects.get(uuid) : null
		if (uuid) out.replaced.add(uuid)
		if (!f.enabled || (obj && hidden.has(String(obj.layer || '')))) continue
		const color = G.hexToLinear(typeColors[f.typeId]) || (obj ? G.hexToLinear(layerColors[String(obj.layer || '')]) : null)
		const root = core('src/fixtures/gdtf-ik').poseXf(f.pose || {})
		const world = []
		nodes.forEach((n, i) => {
			const parent = Number.isInteger(n?.parent) && n.parent >= 0 && n.parent < i ? world[n.parent] : root
			world.push(G.compose(parent, xfOf(n?.xf)))
		})
		const ax = axesOf(nodes)
		const moving = out.heads.length < MAX_HEADS && (ax.pan != null || ax.tilt != null)
		const under = (i, j) => {
			for (let k = i, guard = 0; k >= 0 && guard < 64; k = nodes[k].parent, guard++) {
				if (k === j) return true
				if (!Number.isInteger(nodes[k].parent)) break
			}
			return false
		}
		let moved = 0
		for (let i = 0; i < nodes.length; i++) {
			const n = nodes[i]
			if (!n?.mesh) continue
			const key = `${KEY}${f.typeId}:${n.mesh}`
			if (!tried.has(key)) {
				tried.add(key)
				let t
				try {
					t = await meshTemplate(gdtf, f.typeId, n.mesh, readTemplate)
				} catch {
					t = null
				}
				if (t) out.templates.set(key, t)
				else out.failed.push(key)
			}
			if (!out.templates.has(key)) continue
			const group = !moving ? null : ax.tilt != null && under(i, ax.tilt) ? 'tilt' : ax.pan != null && under(i, ax.pan) ? 'pan' : null
			if (group) moved++
			out.parts.push({ key, xf: G.compose(world[i], xfOf(n.mesh_xf)), layer: String(obj?.layer || ''), uuid: f.id, fixture: true, ghost: true, color,
				...(group ? { node: `${f.id}|${group}` } : {}) })
		}
		if (moved) {
			const axis = (j, col) => (j == null ? null : { o: world[j].slice(9, 12).map(r4), a: unit(world[j].slice(col * 3, col * 3 + 3)) })
			out.heads.push({ id: f.id, pan: axis(ax.pan, 1), tilt: axis(ax.tilt, 0), d: headFrame(rig, f.pose, null).slice(0, 3) })
		}
	}
	return out
}

module.exports = { KEY, MAX_HEADS, patchOf, rigParts, axesOf }
