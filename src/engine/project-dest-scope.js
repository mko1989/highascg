'use strict'

/**
 * WO-1029 — keep the project's scope holders (looks, look presets, timeline targets) on their DESTINATION while the
 * destination list changes. Pure rules: src/config/dest-scope.js. Here: when they run.
 *  - read of a project file (project-channel-scheme.js adaptProjectOnRead): ids stamped from the list the project was
 *    made under (its own hardwareConfig.screenDestinations, else the live one), indices rewritten to the live list;
 *  - write (adaptProjectOnWrite) and a live deck sync: ids stamped from the live list (a client's indices are the ones
 *    it sees now), indices rewritten;
 *  - a destination added / changed / deleted (device-view-crud.js): ids stamped from the list BEFORE the edit, indices
 *    rewritten to the list after it, the active project persisted and broadcast. Without this, a delete in the middle
 *    would leave unstamped looks pointing at the screen that slid into their old index.
 * What it cannot know: an index already shifted by an earlier delete (before this build) names the screen sitting
 * there today — it is stamped as such (where the deck shows it), or `unscoped` when no screen has that index. Logged.
 */

const DS = require('../config/dest-scope')

const _logged = new Set()
/** While a list change is committed: the list BEFORE it. Reads then stamp with it and do not re-index (so the persist
 * below sees the re-index as a change; a re-indexing read would make the stored file look already up to date). */
let _before = null

function liveRows(cfg) {
	return DS.screenRows(cfg)
}

function logOnce(project, stats, where) {
	if (!stats.stamped && !stats.unscoped) return
	const key = `${project?.slug || project?.name || '?'}|${stats.stamped}|${stats.unscoped}`
	if (_logged.has(key)) return
	_logged.add(key)
	console.warn(
		`[project] WO-1029 dest scope on ${where} of ${project?.slug || project?.name || 'project'}: ${stats.stamped} holder(s) stamped from their screen index` +
			` (an index shifted by an earlier delete cannot be told apart), ${stats.unscoped} with no screen (index past the screen list)` +
			` ${JSON.stringify(stats.byKind)}`,
	)
}

/** project-store read hook. `cfg` = the live config (null: offline tools — untouched). Mutates; returns the project. */
function adaptOnRead(project, cfg) {
	if (!cfg || !project || typeof project !== 'object') return project
	try {
		const live = liveRows(cfg)
		const own = DS.screenRows(project.hardwareConfig?.screenDestinations)
		const stats = _before
			? DS.reconcileProject(project, { stampWith: _before })
			: DS.reconcileProject(project, { stampWith: own && own.length ? own : live, indexWith: live || own })
		logOnce(project, stats, 'read')
	} catch {
		/* a scope stamp must never fail a load */
	}
	return project
}

/** project-store / persistProject write hook: the payload's indices are the live list's. */
function adaptOnWrite(project, cfg) {
	if (!cfg || !project || typeof project !== 'object') return project
	try {
		const live = liveRows(cfg)
		const stats = DS.reconcileProject(project, { stampWith: live, indexWith: live })
		logOnce(project, stats, 'write')
	} catch {
		/* never fail a save */
	}
	return project
}

/** A live deck sync (ctx.sceneDeck): same rule as a write. */
function adaptLiveDeck(deck, cfg) {
	if (!cfg || !deck || typeof deck !== 'object') return
	try {
		const live = liveRows(cfg)
		DS.reconcileProject(deck, { stampWith: live, indexWith: live })
	} catch {
		/* the deck stays as sent */
	}
}

/**
 * The destination list was committed (device-view add / update / delete). `beforeRows` = DS.screenRows(config) taken
 * BEFORE the edit; ctx.config holds the new list. Stamps + re-indexes the live deck and the active project, persists
 * and broadcasts it when anything changed, and announces the new list (the Godot deck maps index ↔ destination by it).
 * @returns {{ changed: boolean, stamped: number, unscoped: number, reindexed: number } | null}
 */
function onDestinationsCommitted(ctx, beforeRows) {
	if (!ctx?.config) return null
	const after = liveRows(ctx.config)
	let stats = null
	_before = beforeRows || null
	try {
		if (ctx.sceneDeck) DS.reconcileProject(ctx.sceneDeck, { stampWith: beforeRows, indexWith: after })
		const { loadFullProject, persistProject } = require('./project-scenes')
		const project = loadFullProject()
		if (project && typeof project === 'object') {
			stats = DS.reconcileProject(project, { stampWith: beforeRows, indexWith: after })
			if (stats.changed) {
				const r = persistProject(ctx, project, { writeAutosave: true, pushVolumes: false })
				if (!r.unchanged) require('../api/routes-data-project-sync').scheduleProjectSyncBroadcast(ctx, r.project)
				ctx.log?.('info', `[project] WO-1029 destination list changed: ${stats.reindexed} scope(s) moved to their destination's new index, ${stats.stamped} stamped, ${stats.unscoped} with no screen`)
			}
		}
	} catch (e) {
		ctx.log?.('warn', `[project] WO-1029 dest scope reconcile failed: ${e?.message || e}`)
	} finally {
		_before = null
	}
	announceDestinations(ctx)
	return stats
}

function announceDestinations(ctx) {
	if (typeof ctx?._wsBroadcast !== 'function') return
	try {
		const { normalizeScreenDestinations } = require('../config/screen-destinations')
		ctx._wsBroadcast('change', { path: 'screenDestinations', value: normalizeScreenDestinations(ctx.config.screenDestinations) })
	} catch {
		/* a broadcast failure must not fail the edit */
	}
}

/**
 * The screen a request for this look lands on: `mainIdx` when given; else the look's destination (its current
 * index); 'all' / no scope → 0 (as before); a look whose destination is gone → null (the caller refuses: a take needs
 * an explicit screen).
 * @param {object} ctx
 * @param {object | null} scene
 * @param {unknown} mainIdxIn
 * @returns {number | null}
 */
function lookMainIdx(ctx, scene, mainIdxIn) {
	if (mainIdxIn !== null && mainIdxIn !== undefined && mainIdxIn !== '' && Number.isFinite(Number(mainIdxIn))) return Math.max(0, Math.floor(Number(mainIdxIn)))
	const r = DS.resolveScope(scene || {}, liveRows(ctx?.config))
	if (r.unscoped) return null
	return r.idx ?? 0
}

/** The 409 for a take / preview of a look with no screen. */
function noScreenReply(scene) {
	const { JSON_HEADERS, jsonBody } = require('../api/response')
	const name = scene?.name ? `"${scene.name}"` : String(scene?.id || 'this look')
	return {
		status: 409,
		headers: JSON_HEADERS,
		body: jsonBody({
			ok: false,
			code: 'NO_SCREEN',
			error: `look ${name} has no screen (its destination no longer exists) — pick a screen (mainIdx) or attach it to one`,
		}),
	}
}

module.exports = { adaptOnRead, adaptOnWrite, adaptLiveDeck, onDestinationsCommitted, lookMainIdx, noScreenReply }
