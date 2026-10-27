'use strict'

/**
 * WO-796 — the rig as HighAsCG has it patched, as an MVR in MagicQ's show folder ("<scene name>.mvr"), so MagicQ's File
 * Manager imports the same rig: the loaded scene (project.previs.mvr, projects/_mvr/<id>.mvr) with every patched
 * fixture's GDTFSpec / GDTFMode / Addresses rewritten from project.fixtures.patch, and the GDTFs the previs decodes with
 * (projects/_gdtf/<typeId>.gdtf) packed in. The scene's own GDTFs are often placeholders HighAsCG has replaced (WO-633:
 * "Martin MAC Quantum 27CH" = 27 × DimmerN), and a desk patched from those would not light the previs it drives.
 * Everything else in the archive (trusses, geometry, matrices) is kept byte for byte. Rewritten only when it changed;
 * a missing scene, file or folder returns null (never fatal).
 *
 *   address: Art-Net port-address U → MVR universe U + 1 (MagicQ universe U + 1 outputs Art-Net U by default);
 *            sACN universe U → MVR universe U.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const SHOW_DIR = path.join(os.homedir(), 'Documents/MagicQ/show')
const SCENE_XML = 'GeneralSceneDescription.xml'
const FIXTURE = /<Fixture\b([^>]*)>([\s\S]*?)<\/Fixture>/g

/** A scene name → a file name MagicQ's File Manager shows (no path separators or quotes). */
function fileName(name) {
	const base = String(name || '')
		.replace(/[\\/:*?"<>|]+/g, ' ')
		.replace(/\p{Cc}+/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 80)
	return `${base || 'HighAsCG scene'}.mvr`
}

const xmlEsc = (s) =>
	String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** "Manufacturer@Name@hacg-<id>.gdtf" — the GDTF naming MVR exporters use, unique per HighAsCG type. */
function gdtfName(id, info) {
	const part = (s) => String(s || '').replace(/[@/\\]+/g, ' ').trim() || 'Fixture'
	return `${part(info?.manufacturer)}@${part(info?.name)}@hacg-${id}.gdtf`
}

/** A patch entry → the MVR absolute address (1 = universe 1, channel 1), or 0. */
function absAddress(fx) {
	const u = Number(fx.universe)
	const a = Number(fx.address)
	if (!Number.isInteger(u) || !Number.isInteger(a) || a < 1 || a > 512) return 0
	const mvrUniverse = fx.protocol === 'sacn' ? u : u + 1
	return mvrUniverse >= 1 ? (mvrUniverse - 1) * 512 + a : 0
}

/** Set (or add) one child element of a Fixture body. */
function setChild(body, tag, inner) {
	const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>|<${tag}\\b[^>]*/>`)
	const el = `<${tag}>${inner}</${tag}>`
	return re.test(body) ? body.replace(re, el) : `${body}${el}`
}

/**
 * Pure: the scene XML + the patch → { xml, types: Set<typeId>, patched, kept }. A fixture of the scene that the patch
 * has (id "mvr-<uuid>", typed) gets HighAsCG's type, mode and address; the rest stay as the scene has them.
 */
function rewriteScene(xml, patch, nameOf) {
	const byUuid = new Map()
	for (const fx of Array.isArray(patch) ? patch : []) {
		const m = /^mvr-(.+)$/.exec(String(fx?.id || ''))
		if (m && fx.typeId && fx.mode && fx.enabled !== false && absAddress(fx)) byUuid.set(m[1].toLowerCase(), fx)
	}
	const types = new Set()
	let patched = 0
	let kept = 0
	const out = String(xml).replace(FIXTURE, (whole, attrs, body) => {
		const uuid = (/\buuid="([^"]+)"/i.exec(attrs) || [])[1]
		const fx = uuid && byUuid.get(uuid.toLowerCase())
		if (!fx) {
			kept++
			return whole
		}
		types.add(fx.typeId)
		patched++
		let b = setChild(body, 'GDTFSpec', xmlEsc(nameOf(fx.typeId)))
		b = setChild(b, 'GDTFMode', xmlEsc(fx.mode))
		b = setChild(b, 'Addresses', `<Address break="0">${absAddress(fx)}</Address>`)
		return `<Fixture${attrs}>${b}</Fixture>`
	})
	return { xml: out, types, patched, kept }
}

/**
 * @param {object} [deps] { loadProject, mvrFile(id), gdtfFile(id), gdtfInfo(id), showDir, fs }
 * @returns {Promise<{ name: string, path: string, written: boolean, patched: number, kept: number } | null>}
 */
async function stageMvrForMagicq(deps = {}) {
	const xfs = deps.fs || fs
	const showDir = deps.showDir || SHOW_DIR
	const loadProject = deps.loadProject || (() => require('../engine/project-scenes').loadFullProject())
	const mvrFile = deps.mvrFile || ((id) => require('../stage/mvr-store').fileOf(id, '.mvr'))
	const gdtfFile = deps.gdtfFile || ((id) => require('../fixtures/gdtf-store').fileOf(id, '.gdtf'))
	const gdtfInfo = deps.gdtfInfo || ((id) => require('../fixtures/gdtf-store').info(id))
	const project = loadProject()
	const mvr = project?.previs?.mvr
	const src = mvr && mvr.id ? mvrFile(mvr.id) : null
	if (!src || !xfs.existsSync(src) || !xfs.existsSync(showDir)) return null
	const unzipper = require('unzipper')
	const files = {}
	for (const e of (await unzipper.Open.buffer(xfs.readFileSync(src))).files) {
		if (e.type !== 'Directory') files[e.path] = await e.buffer()
	}
	if (!files[SCENE_XML]) return null
	const names = new Map()
	const nameOf = (id) => {
		if (!names.has(id)) names.set(id, gdtfName(id, gdtfInfo(id)))
		return names.get(id)
	}
	const r = rewriteScene(files[SCENE_XML].toString('utf8'), project?.fixtures?.patch, nameOf)
	files[SCENE_XML] = Buffer.from(r.xml, 'utf8')
	for (const id of r.types) {
		const f = gdtfFile(id)
		if (f && xfs.existsSync(f)) files[nameOf(id)] = xfs.readFileSync(f)
	}
	const used = new Set([...r.xml.matchAll(/<GDTFSpec>([^<]*)<\/GDTFSpec>/g)].map((m) => m[1].replace(/\.gdtf$/i, '')))
	for (const k of Object.keys(files)) if (/\.gdtf$/i.test(k) && !used.has(k.replace(/\.gdtf$/i, ''))) delete files[k] // replaced
	const buf = require('../support/zip-store').buildZipStore(files)
	const dest = path.join(showDir, fileName(mvr.name))
	const same = xfs.existsSync(dest) && Buffer.compare(xfs.readFileSync(dest), buf) === 0
	if (!same) xfs.writeFileSync(dest, buf)
	return { name: path.basename(dest), path: dest, written: !same, patched: r.patched, kept: r.kept }
}

module.exports = { stageMvrForMagicq, rewriteScene, absAddress, gdtfName, fileName, SHOW_DIR }
