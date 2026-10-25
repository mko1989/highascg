'use strict'

/**
 * WO-612 T6 — imported MVR scenes: projects/_mvr/<id>.mvr (id = content hash, so a re-import is the same scene) +
 * <id>.json (name, import time, parsed scene). Meshes are read from the archive on demand and cached as GLB
 * (glb as-is, 3DS converted, nested GDTF members, the unit box).
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const unzipper = require('unzipper')
const { fixGlbUnits } = require('./glb-units')
const { projectsRoot } = require('../engine/projects-root')
const { parseScene } = require('./mvr-scene')
const { gdtfParts } = require('./mvr-gdtf')
const { threeDsToGlb } = require('./mvr-3ds')
const { writeGlb, embedGlbImages } = require('./glb-write')

const ID = /^[0-9a-f]{12}$/
const CACHE_MAX = 400
const _meshes = new Map() // `${id}|${key}` → GLB (insertion-ordered LRU)

function dir() {
	return path.join(projectsRoot(), '_mvr')
}

function fileOf(id, ext) {
	if (!ID.test(String(id))) return null
	return path.join(dir(), `${id}${ext}`)
}

async function members(zipDir) {
	const map = new Map()
	for (const f of zipDir.files) if (f.type !== 'Directory') map.set(f.path, f)
	return map
}

function find(map, name) {
	if (map.has(name)) return map.get(name)
	const lc = String(name).toLowerCase()
	for (const [k, v] of map) if (k.toLowerCase() === lc) return v
	return null
}

/** The GDTF member for an MVR GDTFSpec ("Maker@Type", "Maker@Type.gdtf", or a bare "Type" as some exports write). */
function gdtfMember(map, spec) {
	const hit = find(map, spec) || find(map, `${spec}.gdtf`)
	if (hit || !spec) return hit
	const type = String(spec).replace(/\.gdtf$/i, '').toLowerCase()
	for (const [k, v] of map) if (/\.gdtf$/i.test(k) && k.slice(k.indexOf('@') + 1, -5).toLowerCase() === type) return v
	return null
}

/** @returns {Promise<{ id, name, importedAt, bytes, scene }>} */
async function importMvr(buf, name) {
	const id = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12)
	const map = await members(await unzipper.Open.buffer(buf))
	const xml = find(map, 'GeneralSceneDescription.xml')
	if (!xml) throw new Error('not an MVR file (no GeneralSceneDescription.xml)')
	const resolveGdtf = async (spec, mode) => {
		const m = gdtfMember(map, spec)
		if (!m) return null
		const inner = await members(await unzipper.Open.buffer(await m.buffer()))
		const desc = find(inner, 'description.xml')
		if (!desc) return null
		const g = await gdtfParts((await desc.buffer()).toString('utf8'), mode, (p) => inner.has(p))
		return { file: m.path, parts: g.parts }
	}
	const scene = await parseScene((await xml.buffer()).toString('utf8'), { has: (f) => map.has(f), resolveGdtf })
	fs.mkdirSync(dir(), { recursive: true })
	fs.writeFileSync(fileOf(id, '.mvr'), buf)
	const rec = { id, name: String(name || 'scene').replace(/\.mvr$/i, '').slice(0, 120), importedAt: new Date().toISOString(),
		bytes: buf.length, scene }
	fs.writeFileSync(fileOf(id, '.json'), JSON.stringify(rec))
	return rec
}

/**
 * WO-615 T10 — the scene's fixtures re-read from the stored archive (scenes imported before T10 have no fixture matrix in
 * their JSON) plus a reader for each GDTFSpec's embedded .gdtf. No meshes are built. null = no such scene.
 * @returns {Promise<{ objects: object[], gdtf: (spec: string) => Promise<{ name: string, buf: Buffer } | null> } | null>}
 */
async function fixtureScene(id) {
	const f = fileOf(id, '.mvr')
	if (!f || !fs.existsSync(f)) return null
	const map = await members(await unzipper.Open.file(f))
	const xml = find(map, 'GeneralSceneDescription.xml')
	if (!xml) return null
	const scene = await parseScene((await xml.buffer()).toString('utf8'), { has: () => false, resolveGdtf: async () => null })
	const gdtf = async (spec) => {
		const m = gdtfMember(map, spec)
		return m ? { name: path.posix.basename(m.path), buf: await m.buffer() } : null
	}
	return { objects: scene.objects.filter((o) => o.fixture), gdtf }
}

function list() {
	if (!fs.existsSync(dir())) return []
	return fs.readdirSync(dir()).filter((f) => /^[0-9a-f]{12}\.json$/.test(f)).map((f) => {
		try {
			const r = JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8'))
			return { id: r.id, name: r.name, importedAt: r.importedAt, bytes: r.bytes, objects: r.scene?.objects?.length || 0 }
		} catch {
			return null
		}
	}).filter(Boolean)
}

function get(id) {
	const f = fileOf(id, '.json')
	if (!f || !fs.existsSync(f)) return null
	return JSON.parse(fs.readFileSync(f, 'utf8'))
}

function remove(id) {
	const files = [fileOf(id, '.json'), fileOf(id, '.mvr')].filter((f) => f && fs.existsSync(f))
	for (const f of files) fs.unlinkSync(f)
	for (const k of [..._meshes.keys()]) if (k.startsWith(`${id}|`)) _meshes.delete(k)
	return files.length > 0
}

let _box = null
function unitBox() {
	if (_box) return _box
	const pos = [], idx = [], nrm = []
	for (const [ax, s] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) {
		const [u, v] = [(ax + 1) % 3, (ax + 2) % 3]
		const base = pos.length / 3
		for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
			const p = [0, 0, 0]
			p[ax] = 0.5 * s
			p[u] = 0.5 * a
			p[v] = 0.5 * b
			pos.push(...p)
			const n = [0, 0, 0]
			n[ax] = s
			nrm.push(...n)
		}
		idx.push(...(s > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]).map((i) => base + i))
	}
	_box = writeGlb([{ name: 'box', primitives: [{ positions: new Float32Array(pos), normals: new Float32Array(nrm),
		indices: new Uint32Array(idx), color: [0.35, 0.35, 0.38, 1] }] }])
	return _box
}

/** Archive member → self-contained GLB; image URIs resolve next to the member inside the same archive. */
async function asGlb(map, file) {
	const buf = await map.get(file).buffer()
	if (!/\.glb$/i.test(file)) return threeDsToGlb(buf)
	const near = (uri) => find(map, path.posix.join(path.posix.dirname(file), uri))?.buffer() ?? null
	return embedGlbImages(buf, near)
}

/** GLB bytes for a scene mesh key, or null. */
async function mesh(id, key) {
	if (key === 'prim:box') return unitBox()
	const cacheKey = `${id}|${key}`
	if (_meshes.has(cacheKey)) {
		const hit = _meshes.get(cacheKey)
		_meshes.delete(cacheKey)
		_meshes.set(cacheKey, hit)
		return hit
	}
	const f = fileOf(id, '.mvr')
	if (!f || !fs.existsSync(f)) return null
	const map = await members(await unzipper.Open.file(f))
	let out = null
	const m = /^(mvr|gdtf):(.+)$/.exec(String(key))
	if (m?.[1] === 'mvr') {
		if (map.has(m[2])) out = await asGlb(map, m[2])
	} else if (m?.[1] === 'gdtf') {
		const cut = m[2].lastIndexOf(':')
		const outer = cut > 0 ? map.get(m[2].slice(0, cut)) : null
		if (outer) {
			const inner = await members(await unzipper.Open.buffer(await outer.buffer()))
			const member = m[2].slice(cut + 1)
			if (inner.has(member)) out = await asGlb(inner, member)
			if (out && /\.glb$/i.test(member)) out = fixGlbUnits(out).glb // WO-767: a mm fixture mesh (no body is > 20 m)
		}
	}
	if (out) {
		_meshes.set(cacheKey, out)
		if (_meshes.size > CACHE_MAX) _meshes.delete(_meshes.keys().next().value)
	}
	return out
}

module.exports = { importMvr, fixtureScene, list, get, remove, mesh, unitBox }
