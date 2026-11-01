/**
 * WO-919 N5 — a project rename moves the project-scoped media folder with it.
 *
 * Project media lives in media/projects/<slug>/ (project-media-root.js). A rename retires the old slug, but nothing
 * touched its folder: the new slug got a fresh empty one (persistProject → ensureProjectMediaDir) and the old one stayed.
 * Project-relative refs (`clip.mov`, resolved under the project's own folder — media-reference-rewrite.js
 * resolveRefValue) follow a moved folder with no rewrite. Refs that name the old slug (`projects/<old>/…`, or the
 * Caspar form `PROJECTS/<OLD>/…`) would not, so a project that has any keeps the folder where it is.
 * Never deletes media: only a folder with no file in it is removed.
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { getProjectMediaRoot, isProjectScopedMediaEnabled } = require('./project-media-root')

/** @returns {number} files (any kind but directories) under dir, recursively; -1 when dir is missing */
function countFiles(dir) {
	let entries
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true })
	} catch {
		return -1
	}
	let n = 0
	for (const ent of entries) {
		if (ent.isDirectory()) n += Math.max(0, countFiles(path.join(dir, ent.name)))
		else n += 1
	}
	return n
}

/** Remove a directory tree that holds no files (empty subdirectories only). */
function removeEmptyTree(dir) {
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		if (ent.isDirectory()) removeEmptyTree(path.join(dir, ent.name))
	}
	fs.rmdirSync(dir)
}

/** Does the project name the old slug's folder in a stored media value? */
function referencesSlugFolder(project, slug) {
	if (!project || typeof project !== 'object') return false
	return JSON.stringify(project).toLowerCase().includes(`projects/${String(slug).toLowerCase()}/`)
}

/**
 * @param {object} ctx
 * @param {string} prevSlug
 * @param {string} slug
 * @param {object} [project] the renamed project (refs to the old folder keep it in place)
 * @returns {{ action: 'disabled' | 'none' | 'removed_empty' | 'kept_referenced' | 'kept_both' | 'moved' | 'failed', from?: string, to?: string }}
 */
function moveProjectMediaOnRename(ctx, prevSlug, slug, project) {
	const config = ctx?.config
	const store = ctx?.persistence
	if (!prevSlug || !slug || prevSlug === slug || !isProjectScopedMediaEnabled(config)) return { action: 'disabled' }
	const from = getProjectMediaRoot(config, store, prevSlug)
	const to = getProjectMediaRoot(config, store, slug)
	// a test process only touches folders under a temp media root it chose (cf. ensureProjectMediaDir, WO-626)
	if (require('../engine/projects-root').underTestRunner() && !path.resolve(from).startsWith(path.resolve(os.tmpdir()) + path.sep)) {
		return { action: 'disabled' }
	}
	const log = (lvl, m) => typeof ctx?.log === 'function' && ctx.log(lvl, m)
	try {
		const fromFiles = countFiles(from)
		if (fromFiles < 0) return { action: 'none' }
		if (fromFiles === 0) {
			removeEmptyTree(from)
			log('info', `[project] rename ${prevSlug} → ${slug}: removed the empty media folder ${from}`)
			return { action: 'removed_empty', from }
		}
		if (referencesSlugFolder(project, prevSlug)) {
			log('info', `[project] rename ${prevSlug} → ${slug}: media folder kept at ${from} (the project names it as projects/${prevSlug}/…)`)
			return { action: 'kept_referenced', from, to }
		}
		const toFiles = countFiles(to)
		if (toFiles > 0) {
			log('warn', `[project] rename ${prevSlug} → ${slug}: both media folders hold files — nothing moved (${from}, ${to})`)
			return { action: 'kept_both', from, to }
		}
		if (toFiles === 0) removeEmptyTree(to) // the fresh folder persistProject made for the new slug
		fs.mkdirSync(path.dirname(to), { recursive: true })
		fs.renameSync(from, to)
		log('info', `[project] rename ${prevSlug} → ${slug}: media folder moved ${from} → ${to}`)
		return { action: 'moved', from, to }
	} catch (e) {
		log('warn', `[project] rename ${prevSlug} → ${slug}: media folder not moved: ${e?.message || e}`)
		return { action: 'failed', from, to }
	}
}

module.exports = { moveProjectMediaOnRename }
