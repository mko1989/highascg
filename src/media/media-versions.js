/**
 * WO-592 B — media version control. A file's PATH never changes across versions (so every look,
 * playlist and timeline plays the newest without any rewrite); older versions live outside
 * Caspar's media root in data/media-versions/<entry id>/v<n><ext> (same filesystem → rename, no copy).
 *
 * Entry fields (media-library-registry): currentV (number, default 1) and
 *   versions: [{ v, file, size, addedAt, replacedAt }]  — every NON-current version, kept until
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
	e.versions = [...(e.versions || []).filter((x) => x.v !== v), { v, file, size: st.size, addedAt: e.currentAddedAt || e.addedAt || null, replacedAt: now }]
}

/**
 * Make `incomingAbs` (a finished upload) the new current version of `mediaPath`.
 * @returns {{ ok: true, entry: object } | { ok: false, status: number, error: string }}
 */
function installNewVersion(config, mediaPath, incomingAbs) {
	const abs = resolveSafe(getMediaIngestBasePath(config), mediaPath)
	if (!abs || !fs.existsSync(abs)) return { ok: false, status: 404, error: 'file not found' }
	const e = registry.getEntryByPath(mediaPath)
	if (!e) return { ok: false, status: 404, error: 'not in media library' }
	const now = Date.now()
	const v = nextV(e)
	stash(e, abs, now)
	try {
		moveFile(incomingAbs, abs)
	} catch (err) {
		moveFile(path.join(versionDir(e.id), `v${e.currentV || 1}${path.extname(abs)}`), abs) // put the old one back
		e.versions = e.versions.filter((x) => x.v !== (e.currentV || 1))
		return { ok: false, status: 500, error: `could not install new version: ${err?.message || err}` }
	}
	e.currentV = v
	e.currentAddedAt = now
	refreshStats(e, abs)
	registry.save()
	return { ok: true, entry: e }
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
	const now = Date.now()
	const tmp = path.join(versionDir(e.id), `.restoring-${target.file}`)
	moveFile(src, tmp)
	if (fs.existsSync(abs)) stash(e, abs, now)
	moveFile(tmp, abs)
	e.versions = e.versions.filter((x) => x.v !== target.v)
	e.currentV = target.v
	e.currentAddedAt = target.addedAt
	refreshStats(e, abs)
	registry.save()
	return { ok: true, entry: e }
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
	_setVersionsRootForTests,
}
