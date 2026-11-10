/**
 * WO-603 — the project media bar on the server: where the open project's media folder is, and
 * "Gather" (web sources-panel-project-gather.js) — move every clip the project references into
 * that folder. The web planned the moves and rewrote the project in the browser; here the moves
 * go through moveMediaFile + followMediaMoves (WO-592 links), so every look, playlist and timeline
 * — in every project — follows, and clients re-import through project_sync.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { getRawMediaCatalog } = require('../api/media-catalog')
const { isProjectScopedMediaEnabled, getProjectMediaRelId } = require('./project-media-root')
const { projectReferencedFiles } = require('./media-reference-rewrite')

const nfc = (s) => String(s || '').normalize('NFC').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

/** True when `id` already lives under `folder` (case-insensitive — Caspar ids are). */
function insideFolder(id, folder) {
	const f = nfc(folder).toLowerCase()
	return !f || nfc(id).toLowerCase().startsWith(`${f}/`)
}

/**
 * Pure: the referenced files outside the project folder.
 * @returns {string[]}
 */
function planGather(project, slug, catalogIds, folder, config) {
	return projectReferencedFiles(project, slug, catalogIds, config).filter((id) => !insideFolder(id, folder))
}

let activeOverride = null
/** Tests: `() => ({ slug, project })` instead of the live project store (never the real projects/). */
function _setActiveProjectForTests(fn) {
	activeOverride = fn || null
}

function activeProject(ctx) {
	if (activeOverride) return activeOverride()
	const ps = require('../engine/project-store')
	const slug = ps.getActiveSlug(ctx.persistence || require('../utils/persistence')) || ''
	const project = slug ? require('../engine/project-scenes').loadFullProject() : null
	return { slug, project }
}

/**
 * GET /api/media/project — `{ enabled, slug, folder, pending[] }`; the bar shows when enabled + slug.
 */
function projectMediaInfo(ctx) {
	const config = ctx.config || {}
	const enabled = isProjectScopedMediaEnabled(config)
	const { slug, project } = activeProject(ctx)
	const folder = slug ? getProjectMediaRelId(slug, config) : ''
	if (!enabled || !slug || !project) return { enabled, slug, folder, pending: [] }
	const ids = getRawMediaCatalog(ctx).filter((m) => m && !m.isDir).map((m) => m.id)
	return { enabled, slug, folder, pending: planGather(project, slug, ids, folder, config) }
}

/** Copy mode: originals stay; refs follow the copies (registry entries of the originals are not repointed). */
async function copyPending(ctx, info, opts) {
	const safe = require('./media-safe-copy')
	const { getMediaIngestBasePath, resolveSafe, resolveMediaFileOnDiskExact } = require('./local-media-paths')
	const config = ctx.config || {}
	const folderAbs = resolveSafe(getMediaIngestBasePath(config), info.folder)
	if (!folderAbs) return { status: 400, body: { ok: false, error: 'Invalid project media folder.' } }
	const jobs = []
	let need = 0
	for (const id of info.pending) {
		const src = resolveMediaFileOnDiskExact(config, id)
		if (!src) {
			jobs.push({ id, error: 'Source not found' })
			continue
		}
		const files = [src, ...safe.sidecarsOf(src)]
		need += files.reduce((n, f) => n + fs.statSync(f).size, 0)
		jobs.push({ id, src, files })
	}
	fs.mkdirSync(folderAbs, { recursive: true })
	const free = await (opts.freeBytes || safe.freeBytes)(folderAbs)
	if (need > free) {
		const error = `Not enough free space to copy: need ${safe.fmtBytes(need)}, ${safe.fmtBytes(free)} available.`
		return { status: 507, body: { ok: false, mode: 'copy', error, needed: need, available: free } }
	}
	const copied = []
	const failed = []
	for (const j of jobs) {
		if (j.error) {
			failed.push({ id: j.id, error: j.error })
			continue
		}
		const name = path.basename(j.src)
		if (safe.existsCaseInsensitive(folderAbs, name)) {
			failed.push({ id: j.id, error: 'Destination file already exists' })
			continue
		}
		const made = []
		try {
			for (const f of j.files) {
				const dest = path.join(folderAbs, path.basename(f))
				if (f !== j.src && fs.existsSync(dest)) continue
				await safe.copyFileAtomic(f, dest)
				made.push(dest)
			}
			copied.push({ from: j.id, to: `${nfc(info.folder)}/${name.normalize('NFC')}` })
		} catch (e) {
			for (const d of made) fs.rmSync(d, { force: true }) // no half-gathered clip
			failed.push({ id: j.id, error: e?.message || 'Copy failed' })
		}
	}
	const follow = copied.length ? await require('./media-links').applyRenamesToProjects(ctx, copied, { onlySlug: info.slug }) : { refs: 0 }
	ctx.log?.('info', `[media] gather copy → ${info.folder}: ${copied.length} copied, ${failed.length} failed, ${follow.refs} ref(s) follow`)
	return { status: 200, body: { ok: failed.length === 0, mode: 'copy', folder: info.folder, moved: [], copied, failed, refs: follow.refs } }
}

/**
 * POST /api/media/gather — bring every pending clip into the project folder (refs follow).
 * @param {{ mode?: 'move'|'copy', freeBytes?: (dir: string) => Promise<number> }} [opts] freeBytes: tests inject free space
 * @returns {Promise<{ status: number, body: object }>}
 */
async function gatherProjectMedia(ctx, opts = {}) {
	const mode = opts.mode == null ? 'move' : opts.mode
	if (mode !== 'move' && mode !== 'copy') return { status: 400, body: { ok: false, error: `Unknown mode "${mode}" (use move or copy).` } }
	const info = projectMediaInfo(ctx)
	if (!info.enabled) return { status: 409, body: { ok: false, error: 'Project media folders are off (Settings → project-scoped media).' } }
	if (!info.slug) return { status: 409, body: { ok: false, error: 'No project is open.' } }
	if (mode === 'copy') return copyPending(ctx, info, opts)
	const { moveMediaFile } = require('./local-media-api')
	const moved = []
	const failed = []
	for (const id of info.pending) {
		const r = await moveMediaFile(ctx.config || {}, id, info.folder)
		let j = {}
		try {
			j = JSON.parse(r.body)
		} catch {
			/* moveMediaFile always answers JSON */
		}
		if (r.status === 200 && j.id && !j.copiedOnly) moved.push({ from: id, to: String(j.id) })
		else failed.push({ id, error: j.error || (j.copiedOnly ? 'copied but the original could not be removed' : `HTTP ${r.status}`) })
	}
	const follow = moved.length ? await require('./media-links').followMediaMoves(ctx, moved) : { refs: 0 }
	ctx.log?.('info', `[media] gather → ${info.folder}: ${moved.length} moved, ${failed.length} failed, ${follow.refs} ref(s) follow`)
	return { status: 200, body: { ok: failed.length === 0, mode: 'move', folder: info.folder, moved, failed, refs: follow.refs } }
}

module.exports = { planGather, projectMediaInfo, gatherProjectMedia, activeProject, _setActiveProjectForTests }
