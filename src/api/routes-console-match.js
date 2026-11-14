'use strict'

/**
 * WO-1072 — match the project to the lighting console's head positions from its CSV (src/fixtures/console-match.js).
 *   POST /api/fixtures/console-match { csv: string, apply?: 'shift' | 'heads' }
 *     → { ok, rows, matched, by, universe_offset, unmatched: [{ head, name, universe, address }], unpaired_patch,
 *         fit: { shift {x,y,z}, rms, max, yaw_deg, turned_rms, mirrored, worst: [{ id, name, head, err }] }, applied }
 *   No `apply`: a preview, nothing is written. 'shift': the whole project (scene placement, fixtures, tracking stage,
 *   cameras + their calibration points, PTZ, stage objects, marks) moves by fit.shift. 'heads': the shift, then every
 *   paired head takes the console's own position. A mirrored plan is never applied (a move cannot fix it).
 *   The write goes through the autosave handler, so the clients reload it as a remote sync.
 */

const { JSON_HEADERS, jsonBody, parseBodyStrict } = require('./response')
const match = require('../fixtures/console-match')

const reply = (status, obj) => ({ status, headers: JSON_HEADERS, body: jsonBody(obj) })

/** @param {object} b request body @param {object} deps { loadProject, fidOf, save(project) → Promise<{ status, body }> } */
async function handle(b, deps) {
	const parsed = match.parseCsv(b?.csv)
	if (!parsed.rows.length) return reply(400, { ok: false, error: parsed.problems[0] || 'No head positions in the file.' })
	const project = deps.loadProject()
	if (!project?.fixtures?.patch?.length) return reply(409, { ok: false, error: 'This project has no patched fixtures to match.' })
	const pr = match.pair(parsed.rows, project.fixtures.patch, deps.fidOf)
	if (!pr.pairs.length) return reply(409, { ok: false, error: 'No head of the file matches a patched fixture (by DMX address or head number).', rows: parsed.rows.length })
	const fit = match.fit(pr.pairs)
	const out = {
		ok: true,
		rows: parsed.rows.length,
		matched: pr.pairs.length,
		by: pr.by,
		universe_offset: pr.universe_offset,
		unmatched: pr.unmatched.slice(0, 50).map(({ head, name, universe, address }) => ({ head, name, universe, address })),
		unpaired_patch: pr.unpaired_patch,
		fit,
		applied: null,
	}
	const mode = b?.apply
	if (!mode) return reply(200, out)
	if (mode !== 'shift' && mode !== 'heads') return reply(400, { ok: false, error: "apply must be 'shift' or 'heads'" })
	if (fit.mirrored) return reply(409, { ...out, ok: false, error: 'The console plan is mirrored against ours; moving the project cannot fix that.' })
	match.shiftProject(project, fit.shift)
	const heads = mode === 'heads' ? match.setHeads(project, pr.pairs.map((p) => ({ ...p }))) : 0
	const saved = await deps.save(project)
	if (saved.status !== 200) return reply(saved.status, { ...out, ok: false, error: 'The project could not be saved.', detail: String(saved.body).slice(0, 300) })
	return reply(200, { ...out, applied: { mode, shift: fit.shift, heads } })
}

/** @param {any} routes */
function register(routes) {
	routes.post('/api/fixtures/console-match', async ({ body, ctx }) => {
		const p = parseBodyStrict(body)
		if (!p.ok) return reply(400, { ok: false, error: `body must be JSON: ${p.error}` })
		const fids = require('../fixtures/console-fid-map').createFidResolver().map().byId
		return handle(p.value, {
			loadProject: () => require('../engine/project-scenes').loadFullProject(),
			fidOf: (id) => fids.get(id) || 0,
			save: (project) => require('./routes-data').handleProject('/api/project/autosave', JSON.stringify({ project }), ctx),
		})
	}, { requireCaspar: false })
}

module.exports = { register, handle }
