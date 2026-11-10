'use strict'

/**
 * WO-1029 — POST /api/project/rescope-looks { from: <old index> | 'unscoped' | <destination id>, to: <destination id> }
 *
 * The operator's one-off repair for looks whose index no longer names their screen (box B, 10.11: the wall moved from
 * index 2 to 1 when two destinations were deleted; its looks still said "2" and now have no screen). `from`:
 *  - an old index ("2"): the looks with NO screen whose stored index is 2;
 *  - 'unscoped': every look with no screen;
 *  - a destination id: the looks scoped to it (a deleted destination's looks, or moving a whole column).
 * `to` must be a destination of today's list (or 'all'). The live deck and the active project are both rewritten
 * (`destScope` = to, `mainScope` = its current index), persisted and broadcast. Never run automatically.
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const DS = require('../config/dest-scope')

function out(status, payload) {
	return { status, headers: JSON_HEADERS, body: jsonBody(payload) }
}

/**
 * @param {unknown} body
 * @param {object} ctx
 * @param {{ project?: () => object | null, persist?: (project: object) => object }} [deps]
 */
async function handleRescopeLooks(body, ctx, deps = {}) {
	const b = parseBody(body) || {}
	const from = String(b.from ?? '').trim()
	const to = String(b.to ?? '').trim()
	if (!from || !to) return out(400, { ok: false, error: 'from and to required' })
	const rows = DS.screenRows(ctx?.config)
	if (!rows) return out(409, { ok: false, error: 'this server has no destination list: looks are scoped by screen index only' })
	if (to !== DS.ALL && DS.indexOfDest(rows, to) < 0) return out(404, { ok: false, error: `destination ${to} is not a screen of this show` })

	const loadProject = deps.project || (() => require('../engine/project-scenes').loadFullProject())
	const project = loadProject()
	const looks = Array.isArray(project?.scenes?.scenes) ? project.scenes.scenes : null
	if (!looks) return out(404, { ok: false, error: 'no open project' })
	const ids = new Set(looks.filter((l) => l && DS.matchesFrom(l, from, rows)).map((l) => String(l.id)))
	const n = DS.rescopeLooks(looks, from, to, rows)
	// the live deck is what the next autosave is built from (enrichProjectScenesFromLiveDeck): rewrite it too
	const snaps = Array.isArray(ctx?.sceneDeck?.sceneSnapshots) ? ctx.sceneDeck.sceneSnapshots : []
	const idx = to === DS.ALL ? DS.ALL : String(DS.indexOfDest(rows, to))
	for (const s of snaps) {
		if (s && ids.has(String(s.id))) {
			s.destScope = to
			s.mainScope = idx
		}
	}
	for (const l of Array.isArray(ctx?.sceneDeck?.looks) ? ctx.sceneDeck.looks : []) {
		if (l && ids.has(String(l.id))) {
			l.destScope = to
			l.mainScope = idx
		}
	}
	if (n > 0) {
		const persist =
			deps.persist ||
			((p) => {
				const r = require('../engine/project-scenes').persistProject(ctx, p, { writeAutosave: true, pushVolumes: false, userSave: true })
				if (!r.unchanged) require('./routes-data-project-sync').scheduleProjectSyncBroadcast(ctx, r.project)
				return r
			})
		persist(project)
		ctx?.log?.('info', `[project] WO-1029 rescope-looks: ${n} look(s) from ${from} → ${to}`)
	}
	return out(200, { ok: true, from, to, rescoped: n, ids: [...ids] })
}

module.exports = { handleRescopeLooks }
