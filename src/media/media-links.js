/**
 * WO-592 A — media links service: renames/moves that every look, playlist and timeline follows.
 *
 * - renameMediaFiles: all-or-nothing batch rename (multi-rename, single rename, mojibake repair)
 *   — validates every pair first, renames, rolls back the done ones on any failure.
 * - applyRenamesToProjects: rewrites references in EVERY project. The active one goes through
 *   persistProject + project_sync (clients import it); the rest are rewritten on disk
 *   (project file + its autosave).
 * - scheduleMediaReconcile: after each media rescan, re-link files renamed outside the UI.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const registry = require('./media-library-registry')
const { rewriteProjectMediaRefs, findProjectMediaUsage } = require('./media-reference-rewrite')
const { getMediaIngestBasePath } = require('./local-media-paths')
const { resolveSafe } = require('./local-media-paths')

const nfc = (s) => String(s || '').normalize('NFC').replace(/\\/g, '/').replace(/^\/+/, '')

let projectStoreOverride = null
function projectStore() {
	return projectStoreOverride || require('../engine/project-store')
}
/** Tests: point the walk at a temp projects dir (never the live projects/). */
function _setProjectStoreForTests(ps) {
	projectStoreOverride = ps || null
}

/** @returns {string[]} slugs with a project file on disk */
function listProjectSlugs() {
	const ps = projectStore()
	let names = []
	try {
		names = fs.readdirSync(ps.projectsDir())
	} catch {
		return []
	}
	return names
		.filter((n) => n.endsWith('.json'))
		.map((n) => n.slice(0, -5))
		.filter((s) => ps.isSafeProjectSlug(s))
}

function readJson(p) {
	try {
		return JSON.parse(fs.readFileSync(p, 'utf8'))
	} catch {
		return null
	}
}

function writeJsonAtomic(p, obj) {
	const tmp = p + '.tmp'
	fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8')
	fs.renameSync(tmp, p)
}

/**
 * @param {object} ctx
 * @param {Array<{ from: string, to: string }>} renames - media-root relative, with extension
 * @returns {Promise<{ projects: number, refs: number }>}
 */
async function applyRenamesToProjects(ctx, renames) {
	const ps = projectStore()
	const persistence = ctx.persistence || require('../utils/persistence')
	const active = ps.getActiveSlug(persistence)
	let projects = 0
	let refs = 0
	for (const slug of listProjectSlugs()) {
		if (slug === active) {
			const { loadFullProject, persistProject } = require('../engine/project-scenes')
			const cur = loadFullProject()
			if (!cur) continue
			const r = rewriteProjectMediaRefs(cur, slug, renames, ctx.config)
			if (!r.changed) continue
			const persisted = await persistProject(ctx, { ...r.project, savedAt: new Date().toISOString() }, { writeAutosave: true, pushVolumes: false })
			if (!persisted?.unchanged) {
				require('../api/routes-data-project-sync').scheduleProjectSyncBroadcast(ctx, persisted?.project || r.project)
			}
			projects++
			refs += r.changed
			continue
		}
		let touched = false
		for (const file of [ps.projectFilePath(slug), ps.autosaveFilePath(slug)]) {
			if (!fs.existsSync(file)) continue
			const cur = readJson(file)
			if (!cur) continue
			const r = rewriteProjectMediaRefs(cur, slug, renames, ctx.config)
			if (!r.changed) continue
			writeJsonAtomic(file, r.project)
			if (file === ps.projectFilePath(slug)) refs += r.changed
			touched = true
		}
		if (touched) projects++
	}
	return { projects, refs }
}

/**
 * All-or-nothing batch rename. `to` may change folder and/or name; extension changes are refused
 * (a link's file type never changes under it).
 * @param {object} ctx
 * @param {Array<{ from: string, to: string }>} pairs
 * @returns {Promise<{ status: number, body: object }>}
 */
async function renameMediaFiles(ctx, pairs) {
	const base = getMediaIngestBasePath(ctx.config || {})
	const list = (pairs || []).map((p) => ({ from: nfc(p?.from), to: nfc(p?.to) })).filter((p) => p.from && p.to && p.from !== p.to)
	if (!list.length) return { status: 400, body: { error: 'nothing to rename' } }
	const targets = new Set()
	const plan = []
	for (const { from, to } of list) {
		if (from.includes('..') || to.includes('..')) return { status: 400, body: { error: `invalid path: ${from}` } }
		if (path.extname(from).toLowerCase() !== path.extname(to).toLowerCase()) {
			return { status: 400, body: { error: `extension must stay ${path.extname(from)}: ${to}` } }
		}
		const src = resolveSafe(base, from)
		const dest = resolveSafe(base, to)
		if (!src || !dest || !fs.existsSync(src)) return { status: 404, body: { error: `not found: ${from}` } }
		const caseOnly = src.toLowerCase() === dest.toLowerCase()
		if (!caseOnly && fs.existsSync(dest)) return { status: 409, body: { error: `already exists: ${to}` } }
		if (targets.has(to.toLowerCase())) return { status: 409, body: { error: `two files would be named ${to}` } }
		targets.add(to.toLowerCase())
		plan.push({ from, to, src, dest })
	}
	const done = []
	try {
		for (const step of plan) {
			fs.mkdirSync(path.dirname(step.dest), { recursive: true })
			fs.renameSync(step.src, step.dest)
			done.push(step)
		}
	} catch (e) {
		for (const step of done.reverse()) {
			try {
				fs.renameSync(step.dest, step.src)
			} catch (re) {
				ctx.log?.('error', `[media-links] rollback ${step.to} → ${step.from} failed: ${re?.message || re}`)
			}
		}
		return { status: 500, body: { error: `rename failed, nothing changed: ${e?.message || e}` } }
	}
	const renames = plan.map(({ from, to }) => ({ from, to }))
	registry.recordRenames(renames)
	const rewritten = await applyRenamesToProjects(ctx, renames)
	ctx.log?.('info', `[media-links] renamed ${renames.length} file(s); ${rewritten.refs} reference(s) in ${rewritten.projects} project(s) follow`)
	if (typeof ctx.runMediaLibraryQueryCycle === 'function') ctx.runMediaLibraryQueryCycle()
	return { status: 200, body: { ok: true, renamed: renames, ...rewritten } }
}

/** A UI move already happened on disk (local-media-api moveMediaFile): record it + rewrite refs. */
async function followMediaMoves(ctx, moves) {
	const renames = moves.map((m) => ({ from: nfc(m.from), to: nfc(m.to) })).filter((m) => m.from && m.to && m.from !== m.to)
	if (!renames.length) return { projects: 0, refs: 0 }
	registry.recordRenames(renames)
	const rw = await applyRenamesToProjects(ctx, renames)
	ctx.log?.('info', `[media-links] moved ${renames.length} file(s); ${rw.refs} reference(s) in ${rw.projects} project(s) follow`)
	return rw
}

let reconcileTimer = null
let reconcileChain = Promise.resolve()

/** Debounced, serialized: registry vs disk; re-linked files drag their references along. */
function scheduleMediaReconcile(ctx, delayMs = 3000) {
	if (reconcileTimer) clearTimeout(reconcileTimer)
	reconcileTimer = setTimeout(() => {
		reconcileTimer = null
		reconcileChain = reconcileChain
			.then(async () => {
				const r = registry.reconcileWithDisk(ctx.config || {})
				if (r.relinked.length) {
					const rw = await applyRenamesToProjects(ctx, r.relinked)
					ctx.log?.('info', `[media-links] re-linked ${r.relinked.length} externally moved file(s); ${rw.refs} reference(s) updated`)
				}
			})
			.catch((e) => ctx.log?.('warn', `[media-links] reconcile failed: ${e?.message || e}`))
	}, delayMs)
}

/**
 * Where a file is used, across every project.
 * @returns {Array<{ project: string, kind: string, id: string, name: string, count: number }>}
 */
function findMediaUsage(ctx, filePath) {
	const ps = projectStore()
	const out = []
	for (const slug of listProjectSlugs()) {
		const proj = readJson(ps.projectFilePath(slug))
		if (!proj) continue
		for (const row of findProjectMediaUsage(proj, slug, nfc(filePath), ctx.config)) out.push({ project: slug, ...row })
	}
	return out
}

module.exports = {
	applyRenamesToProjects,
	renameMediaFiles,
	followMediaMoves,
	scheduleMediaReconcile,
	findMediaUsage,
	listProjectSlugs,
	_setProjectStoreForTests,
}
