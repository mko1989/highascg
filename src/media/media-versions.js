/**
 * WO-592 B — media version control. Older versions live outside Caspar's media root in
 * data/media-versions/<entry id>/v<n><ext> (same filesystem → rename, no copy).
 * WO-921: a new version takes ITS OWN file name, in the folder of the file it replaces (owner 01.11: "change the
 * file name in media browser and in looks to the latest version so the user is sure it's using the new version").
 * The caller rewrites every reference (`renamed` in the result), like a rename. Without a name (WO-775 callers) only
 * a different extension renames (previz .mp4 → show .mov). Go back restores the version's own name.
 *
 * Entry fields (media-library-registry): currentV (number, default 1) and
 *   versions: [{ v, file, name, size, addedAt, replacedAt }]  — every NON-current version, kept until
 *   purged by hand (owner 04.10: "keep them until you purge manually"; "a list of the old versions
 *   and ability to go back to a chosen one").
 * Restore swaps: the current file becomes a version, the chosen one takes the path — nothing lost.
 * Swapping a clip that is on air is safe on Linux: Caspar's open handle keeps the old inode.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const registry = require('./media-library-registry')
const { getMediaIngestBasePath, resolveSafe } = require('./local-media-paths')

const DEFAULT_ROOT = path.join(__dirname, '..', '..', 'data', 'media-versions')
let versionsRoot = DEFAULT_ROOT

function versionDir(id) {
	return path.join(versionsRoot, id)
}

/** rename, falling back to copy+unlink across devices (bridge/exFAT mounts). */
function moveFile(src, dest) {
	fs.mkdirSync(path.dirname(dest), { recursive: true })
	try {
		fs.renameSync(src, dest)
	} catch (e) {
		if (e?.code !== 'EXDEV') throw e
		fs.copyFileSync(src, dest)
		fs.unlinkSync(src)
	}
}

/** Keep the registry's stats true right away (reconcile would only catch up on the next rescan). */
function refreshStats(e, abs) {
	try {
		const st = fs.statSync(abs)
		Object.assign(e, { dev: st.dev, ino: st.ino, size: st.size, mtimeMs: Math.round(st.mtimeMs) })
	} catch {
		/* stats are advisory */
	}
}

function nextV(e) {
	return Math.max(e.currentV || 1, ...(e.versions || []).map((x) => x.v)) + 1
}

function stash(e, abs, now) {
	const st = fs.statSync(abs)
	const v = e.currentV || 1
	const file = `v${v}${path.extname(abs)}`
	moveFile(abs, path.join(versionDir(e.id), file))
	const name = path.posix.basename(e.path)
	e.versions = [...(e.versions || []).filter((x) => x.v !== v), { v, file, name, size: st.size, addedAt: e.currentAddedAt || e.addedAt || null, replacedAt: now }]
}

/**
 * WO-921: a client-supplied file name, safe as one path segment (NFC, no folders, no control characters), or ''.
 * @param {string} raw
 */
function versionFileName(raw) {
	const base = path.posix.basename(String(raw || '').normalize('NFC').replace(/\\/g, '/'))
	const clean = [...base].filter((ch) => ch >= ' ' && ch !== '\u007f').join('').trim()
	return clean && !clean.startsWith('.') && path.extname(clean) ? clean : ''
}

/**
 * Where version `file` lives in the media root. With `name` (the new version's own file name, WO-921): that name in
 * the current file's folder. Without: the entry's path, with `file`'s extension when it differs (WO-775).
 * @returns {{ path: string, abs: string|null, renamed: { from: string, to: string } | null }}
 */
function targetFor(config, e, file, name) {
	const base = getMediaIngestBasePath(config)
	const ext = path.extname(e.path)
	const nextExt = path.extname(file)
	const dir = path.posix.dirname(e.path)
	const to = name
		? (dir === '.' ? name : `${dir}/${name}`)
		: nextExt.toLowerCase() === ext.toLowerCase()
			? e.path
			: e.path.slice(0, e.path.length - ext.length) + nextExt
	if (to === e.path) return { path: e.path, abs: resolveSafe(base, e.path), renamed: null }
	return { path: to, abs: resolveSafe(base, to), renamed: { from: e.path, to } }
}

/** A renamed target must not land on another file (a case-only change of the same file is not a clash). */
function targetClash(t, currentAbs) {
	if (!t.abs) return { ok: false, status: 400, error: `invalid path: ${t.path}` }
	if (t.renamed && fs.existsSync(t.abs) && t.abs.toLowerCase() !== String(currentAbs || '').toLowerCase()) {
		return { ok: false, status: 409, error: `${t.path} already exists — rename the new file or remove that one first` }
	}
	return null
}

/**
 * Make `incomingAbs` (a finished upload) the new current version of `mediaPath`.
 * @param {{ name?: string }} [opts] `name`: the uploaded file's own name (WO-921) — the version takes it
 * @returns {{ ok: true, entry: object, renamed: { from: string, to: string } | null } | { ok: false, status: number, error: string }}
 */
function installNewVersion(config, mediaPath, incomingAbs, opts = {}) {
	const abs = resolveSafe(getMediaIngestBasePath(config), mediaPath)
	if (!abs || !fs.existsSync(abs)) return { ok: false, status: 404, error: 'file not found' }
	const e = registry.getEntryByPath(mediaPath)
	if (!e) return { ok: false, status: 404, error: 'not in media library' }
	const t = targetFor(config, e, incomingAbs, versionFileName(opts.name))
	const clash = targetClash(t, abs)
	if (clash) return clash
	const now = Date.now()
	const v = nextV(e)
	stash(e, abs, now)
	try {
		moveFile(incomingAbs, t.abs)
	} catch (err) {
		moveFile(path.join(versionDir(e.id), `v${e.currentV || 1}${path.extname(abs)}`), abs) // put the old one back
		e.versions = e.versions.filter((x) => x.v !== (e.currentV || 1))
		return { ok: false, status: 500, error: `could not install new version: ${err?.message || err}` }
	}
	e.path = t.path
	e.currentV = v
	e.currentAddedAt = now
	refreshStats(e, t.abs)
	registry.save()
	return { ok: true, entry: e, renamed: t.renamed }
}

/** Go back to version `v`; the current file becomes a version. */
function restoreVersion(config, mediaPath, v) {
	const abs = resolveSafe(getMediaIngestBasePath(config), mediaPath)
	const e = registry.getEntryByPath(mediaPath)
	if (!abs || !e) return { ok: false, status: 404, error: 'not in media library' }
	const target = (e.versions || []).find((x) => x.v === Number(v))
	if (!target) return { ok: false, status: 404, error: `no version v${v}` }
	const src = path.join(versionDir(e.id), target.file)
	if (!fs.existsSync(src)) return { ok: false, status: 410, error: `version file missing: ${target.file}` }
	const t = targetFor(config, e, target.file, versionFileName(target.name))
	const clash = targetClash(t, abs)
	if (clash) return clash
	const now = Date.now()
	const tmp = path.join(versionDir(e.id), `.restoring-${target.file}`)
	moveFile(src, tmp)
	if (fs.existsSync(abs)) stash(e, abs, now)
	moveFile(tmp, t.abs)
	e.versions = e.versions.filter((x) => x.v !== target.v)
	e.path = t.path
	e.currentV = target.v
	e.currentAddedAt = target.addedAt
	refreshStats(e, t.abs)
	registry.save()
	return { ok: true, entry: e, renamed: t.renamed }
}

/** Purge one old version — final. */
function purgeVersion(mediaPath, v) {
	const e = registry.getEntryByPath(mediaPath)
	const target = e && (e.versions || []).find((x) => x.v === Number(v))
	if (!target) return { ok: false, status: 404, error: `no version v${v}` }
	fs.rmSync(path.join(versionDir(e.id), target.file), { force: true })
	e.versions = e.versions.filter((x) => x.v !== target.v)
	registry.save()
	return { ok: true, entry: e }
}

/** Final delete of a file also removes every stored version. */
function removeAllVersions(entryIds) {
	for (const id of entryIds) if (/^m_[0-9a-f]+$/.test(id)) fs.rmSync(versionDir(id), { recursive: true, force: true })
}

/** Where an upload is staged before install (inside the versions root → same fs as data/). */
function stagingPathFor(entryId, ext) {
	return path.join(versionDir(entryId), `.incoming-${Date.now()}${ext}`)
}

function _setVersionsRootForTests(dir) {
	versionsRoot = dir || DEFAULT_ROOT
}

module.exports = {
	installNewVersion,
	restoreVersion,
	purgeVersion,
	removeAllVersions,
	stagingPathFor,
	versionFileName,
	_setVersionsRootForTests,
}
