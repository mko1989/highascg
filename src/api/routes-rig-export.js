'use strict'

/**
 * WO-765 — the calibrated rig for the desk (Lighting → Calibrate and the previs MVR section, "Export calibrated rig").
 *   GET /api/stage/rig-export                 → .mvr download: the imported scene's archive with each calibrated head's
 *                                              <Matrix> replaced (mvr-rig-export.js), every other byte kept
 *   GET /api/stage/rig-export?format=csv      → the position table, MVR / grandMA3 frame (rig-csv.js);
 *                                              &desk=magicq → MagicQ's frame and CSV headings
 *   GET /api/stage/rig-export?format=json     → the report alone (per head: calibrated / inferred / unchanged / added,
 *                                              moved m, turned °, fit)
 *   &types=highascg  write HighAsCG's own GDTF types / modes / addresses (the WO-796 MagicQ path, for a scene whose
 *                    GDTFs are placeholders); default keeps the file's GDTFSpec / GDTFMode / Addresses as they are
 *   &marks=0         leave the stage marks out (default: a "HighAsCG marks" layer of FocusPoints)
 */

const fs = require('fs')
const { buildRigExport } = require('../stage/mvr-rig-export')
const { rigCsv } = require('../stage/rig-csv')
const { JSON_HEADERS, jsonBody } = require('./response')

const reply = (status, o) => ({ status, headers: JSON_HEADERS, body: jsonBody(o) })
const fileName = (name, ext) => `${String(name || 'rig').replace(/[^\w.-]+/g, '_') || 'rig'}_calibrated.${ext}`

/** The imported archive's members + its parsed objects (world matrices), or null. */
async function readArchive(id, deps) {
	const file = (deps.mvrFile || ((x) => require('../stage/mvr-store').fileOf(x, '.mvr')))(id)
	if (!file || !fs.existsSync(file)) return null
	const unzipper = require('unzipper')
	const files = {}
	for (const e of (await unzipper.Open.buffer(fs.readFileSync(file))).files) if (e.type !== 'Directory') files[e.path] = await e.buffer()
	const key = Object.keys(files).find((k) => k.toLowerCase() === 'generalscenedescription.xml')
	if (!key) return null
	const sceneXml = files[key].toString('utf8')
	if (key !== 'GeneralSceneDescription.xml') delete files[key]
	const { parseScene } = require('../stage/mvr-scene')
	const scene = await parseScene(sceneXml, { has: () => false, resolveGdtf: async () => null })
	return { files, sceneXml, objects: scene.objects }
}

/**
 * @param {Record<string, string>} query
 * @param {{ loadProject?: () => object, mvrFile?: (id: string) => string | null, gdtfInfo?: Function, gdtfFile?: Function }} [deps]
 */
async function handleRigExport(query = {}, deps = {}) {
	const project = (deps.loadProject || (() => require('../engine/project-scenes').loadFullProject()))() || {}
	const patch = project?.fixtures?.patch
	if (!Array.isArray(patch) || !patch.length) return reply(404, { error: 'Nothing is patched — there is no rig to export.' })
	const mvr = project?.previs?.mvr
	const archive = mvr?.id ? await readArchive(mvr.id, deps) : null
	const gdtf = require('../fixtures/gdtf-store')
	const { gdtfName } = require('../vr/magicq-mvr')
	const names = new Map()
	const nameOf = (id) => {
		if (!names.has(id)) names.set(id, gdtfName(id, (deps.gdtfInfo || gdtf.info)(id)))
		return names.get(id)
	}
	const gdtfOf = (id) => {
		const f = (deps.gdtfFile || ((x) => gdtf.fileOf(x, '.gdtf')))(id)
		return f && fs.existsSync(f) ? fs.readFileSync(f) : null
	}
	const { files, report } = buildRigExport({ patch, marks: project?.fixtures?.marks, place: mvr?.place, nameOf, gdtfOf,
		patchTypes: query.types === 'highascg', withMarks: query.marks !== '0', ...(archive || {}) })
	if (!archive && mvr?.id) report.notes.push('the imported MVR file is gone: built a new MVR of the patch alone')
	const format = String(query.format || 'mvr')
	if (format === 'json') return reply(200, { ...report, heads: report.heads.map(({ matrix: _m, ...h }) => h) })
	const name = project.name || mvr?.name
	if (format === 'csv') {
		const byId = new Map(patch.map((f) => [f.id, f]))
		const addressOf = (id) => {
			const f = byId.get(id)
			return f && Number.isFinite(Number(f.address)) ? { universe: Number(f.universe) || 0, address: Number(f.address), protocol: f.protocol } : null
		}
		const desk = query.desk === 'magicq' ? 'magicq' : 'mvr'
		return { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${fileName(name, desk === 'magicq' ? 'magicq.csv' : 'csv')}"` },
		body: rigCsv(report.heads, { desk, addressOf }) }
	}
	const buffer = require('../support/zip-store').buildZipStore(files)
	return { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${fileName(name, 'mvr')}"`,
		'X-Rig-Calibrated': String(report.counts.calibrated), 'X-Rig-Inferred': String(report.counts.inferred),
		'X-Rig-Unchanged': String(report.counts.unchanged), 'X-Rig-Added': String(report.counts.added) }, body: buffer }
}

function register(routes) {
	routes.get('/api/stage/rig-export', ({ query }) => handleRigExport(query), { requireCaspar: false })
}

module.exports = { register, handleRigExport }
