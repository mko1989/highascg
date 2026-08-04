'use strict'

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')
const {
	listProjectsFromVolumes,
	pullProjectSlugFromUsbIfNewer,
	pullAutosaveSlugFromVolumesIfNewer,
} = require('./project-volume-sync')

const PROJECTS_DIR = path.join(REPO_ROOT, 'projects')
const AUTOSAVE_SUBDIR = '_autosave'
const TRASH_SUBDIR = '_trash'
const ACTIVE_SLUG_KEY = 'web_project_active_slug'
const LEGACY_AUTOSAVE_PATH = path.join(REPO_ROOT, 'autosave.json')
const SYNC_CONFLICT_RE = /^(.+)\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]+$/

/**
 * @param {string} name
 * @returns {string}
 */
function projectSlugFromName(name) {
	let s = String(name || '')
		.trim()
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
	if (!s) s = 'untitled'
	return s.slice(0, 80)
}

function projectsDir() {
	return PROJECTS_DIR
}

/**
 * Slug containment (review 2026-08-03 src-api §1): slugs reach path.join from URL
 * parts and request bodies; `..%2f` traversal read config/general.json live and
 * would let the autosave loop overwrite config/*.json. Legit slugs come from
 * projectSlugFromName ([a-z0-9_]) plus Syncthing conflict copies (dots, dashes,
 * uppercase) — so allow those, refuse separators/dotfiles outright, and belt-and-
 * braces resolve-check the joined path.
 * @param {string} slug
 */
function isSafeProjectSlug(slug) {
	const s = String(slug || '')
	if (!s || s.length > 160) return false
	if (/[/\\\0]/.test(s) || s.startsWith('.') || s.includes('..')) return false
	const resolved = path.resolve(PROJECTS_DIR, `${s}.json`)
	return resolved.startsWith(PROJECTS_DIR + path.sep)
}

function projectFilePath(slug) {
	if (!isSafeProjectSlug(slug)) {
		throw new Error(`invalid project slug: ${JSON.stringify(String(slug || '')).slice(0, 80)}`)
	}
	return path.join(PROJECTS_DIR, `${slug}.json`)
}

function ensureProjectsDir() {
	if (!fs.existsSync(PROJECTS_DIR)) {
		fs.mkdirSync(PROJECTS_DIR, { recursive: true })
	}
}

/**
 * @param {import('../utils/persistence')} persistence
 */
function getActiveSlug(persistence) {
	const slug = persistence.get(ACTIVE_SLUG_KEY)
	return slug && typeof slug === 'string' ? slug.trim() : ''
}

/**
 * @param {import('../utils/persistence')} persistence
 * @param {string} slug
 */
function setActiveSlug(persistence, slug) {
	const s = String(slug || '').trim() || 'untitled'
	// Never persist a traversal slug — the autosave loop would write through it forever.
	if (!isSafeProjectSlug(s)) {
		console.warn(`[project-store] refused to activate unsafe slug: ${JSON.stringify(s).slice(0, 80)}`)
		return
	}
	persistence.set(ACTIVE_SLUG_KEY, s)
}

/**
 * One-time: copy legacy `web_project` into `projects/<slug>.json` when no active slug yet.
 * @param {import('../utils/persistence')} persistence
 */
function migrateLegacySingleProject(persistence) {
	if (getActiveSlug(persistence)) return
	ensureProjectsDir()
	const legacy = persistence.get('web_project')
	if (!legacy || typeof legacy !== 'object') return
	const slug = projectSlugFromName(legacy.name)
	try {
		writeProjectFile(slug, legacy)
		setActiveSlug(persistence, slug)
	} catch (e) {
		console.warn('[project-store] legacy migrate failed:', e.message)
	}
}

/**
 * @param {string} filename — e.g. `show.json` or `show.sync-conflict-….json`
 */
function parseProjectListFilename(filename) {
	if (!filename || !filename.endsWith('.json')) return null
	const stem = filename.slice(0, -5)
	const conflict = stem.match(SYNC_CONFLICT_RE)
	if (conflict) {
		return { slug: stem, baseSlug: conflict[1], isSyncConflict: true }
	}
	if (stem.includes('.corrupt-')) {
		const baseSlug = stem.split('.corrupt-')[0]
		return { slug: stem, baseSlug, isCorrupt: true }
	}
	return { slug: stem, baseSlug: stem, isSyncConflict: false, isCorrupt: false }
}

/**
 * Move an unreadable project file aside so list/load can report it.
 * @param {string} filePath
 */
function quarantineCorruptFile(filePath) {
	if (!filePath || !fs.existsSync(filePath)) return null
	const ts = new Date().toISOString().replace(/[:.]/g, '-')
	const quarantinePath = `${filePath}.corrupt-${ts}`
	try {
		fs.renameSync(filePath, quarantinePath)
		return quarantinePath
	} catch (e) {
		console.warn('[project-store] quarantine failed:', e.message)
		return null
	}
}

/**
 * Move main + autosave for a slug into `projects/_trash/` (not hard delete).
 * @param {string} slug
 */
function retireProjectSlug(slug) {
	const s = String(slug || '').trim()
	if (!s || !isSafeProjectSlug(s)) return false
	ensureProjectsDir()
	const trashDir = path.join(PROJECTS_DIR, TRASH_SUBDIR, `${s}-${Date.now()}`)
	fs.mkdirSync(trashDir, { recursive: true })
	let moved = false
	const main = projectFilePath(s)
	if (fs.existsSync(main)) {
		fs.renameSync(main, path.join(trashDir, `${s}.json`))
		moved = true
	}
	const autosave = autosaveFilePath(s)
	if (fs.existsSync(autosave)) {
		fs.renameSync(autosave, path.join(trashDir, `${s}.autosave.json`))
		moved = true
	}
	return moved
}

/**
 * Was this slug deliberately retired (deleted / factory reset) at some point?
 *
 * WO-311: `retireProjectSlug` moves the files to `projects/_trash/<slug>-<timestamp>/` rather
 * than hard-deleting, so the trash directory IS the record that a human (or a factory reset)
 * threw this project away. That distinction matters: "no stored file" alone cannot tell a
 * deleted project from a brand-new one that has simply never been saved, and rejecting the
 * latter would break creating a project.
 *
 * @param {string} slug
 * @returns {boolean}
 */
function wasProjectSlugRetired(slug) {
	const s = String(slug || '').trim()
	if (!s || !isSafeProjectSlug(s)) return false
	const trashRoot = path.join(PROJECTS_DIR, TRASH_SUBDIR)
	try {
		if (!fs.existsSync(trashRoot)) return false
		const re = new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`)
		return fs.readdirSync(trashRoot).some((name) => re.test(name))
	} catch {
		return false
	}
}

/**
 * @param {string} slug
 * @returns {object | null}
 */
function readProjectFile(slug) {
	if (!slug || !isSafeProjectSlug(slug)) return null
	try {
		pullProjectSlugFromUsbIfNewer(slug)
	} catch (_) {}
	const p = projectFilePath(slug)
	if (!fs.existsSync(p)) return null
	try {
		const project = JSON.parse(fs.readFileSync(p, 'utf8'))
		return project && typeof project === 'object' ? project : null
	} catch (e) {
		quarantineCorruptFile(p)
		console.warn(`[project-store] corrupt project quarantined (${slug}): ${e?.message || e}`)
		return null
	}
}

/**
 * @param {string} slug
 * @param {object} project
 */
function autosaveFilePath(slug) {
	if (!isSafeProjectSlug(slug)) {
		throw new Error(`invalid project slug: ${JSON.stringify(String(slug || '')).slice(0, 80)}`)
	}
	ensureProjectsDir()
	const dir = path.join(PROJECTS_DIR, AUTOSAVE_SUBDIR)
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
	return path.join(dir, `${slug}.json`)
}

/**
 * Stamp slug on project JSON so loaders can match autosave to a file.
 * @param {object} project
 * @param {string} slug
 * @returns {object}
 */
function withProjectSlug(project, slug) {
	if (!project || typeof project !== 'object') return project
	return { ...project, slug: String(slug || projectSlugFromName(project.name)) }
}

function writeProjectFile(slug, project) {
	ensureProjectsDir()
	const payload = withProjectSlug(project, slug)
	const p = projectFilePath(slug)
	const tmp = p + '.tmp'
	fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
	fs.renameSync(tmp, p)
}

/**
 * @param {string} slug
 * @param {object} project
 */
function writeAutosaveFile(slug, project) {
	if (!slug || !isSafeProjectSlug(slug)) return
	const payload = withProjectSlug(project, slug)
	const p = autosaveFilePath(slug)
	const tmp = p + '.tmp'
	fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
	fs.renameSync(tmp, p)
}

/**
 * @param {string} slug
 * @returns {object | null}
 */
function readAutosaveFile(slug) {
	if (!slug || !isSafeProjectSlug(slug)) return null
	try {
		pullAutosaveSlugFromVolumesIfNewer(slug)
	} catch (_) {}
	const p = autosaveFilePath(slug)
	if (!fs.existsSync(p)) return null
	try {
		const project = JSON.parse(fs.readFileSync(p, 'utf8'))
		if (!project || typeof project !== 'object') return null
		const fileSlug = String(project.slug || projectSlugFromName(project.name))
		return fileSlug === slug ? project : null
	} catch {
		return null
	}
}

/** Legacy root autosave — only used when it matches `slug`. */
function readLegacyAutosaveIfMatches(slug) {
	if (!slug || !fs.existsSync(LEGACY_AUTOSAVE_PATH)) return null
	try {
		const project = JSON.parse(fs.readFileSync(LEGACY_AUTOSAVE_PATH, 'utf8'))
		if (!project || typeof project !== 'object') return null
		const fileSlug = String(project.slug || projectSlugFromName(project.name))
		return fileSlug === slug ? project : null
	} catch {
		return null
	}
}

/**
 * @returns {Array<{ slug: string, name: string, savedAt: string | null, path: string, source?: string }>}
 */
function listProjectFiles() {
	ensureProjectsDir()
	try {
		return listProjectsFromVolumes()
	} catch (_) {
		return []
	}
}

/**
 * @param {import('../utils/persistence')} persistence
 * @param {string} [slug]
 * @returns {object | null}
 */
function loadProjectBySlug(persistence, slug) {
	migrateLegacySingleProject(persistence)
	const s = String(slug || getActiveSlug(persistence) || '').trim()
	if (!s) return null
	return readProjectFile(s)
}

module.exports = {
	PROJECTS_DIR,
	AUTOSAVE_SUBDIR,
	TRASH_SUBDIR,
	ACTIVE_SLUG_KEY,
	LEGACY_AUTOSAVE_PATH,
	projectSlugFromName,
	isSafeProjectSlug,
	parseProjectListFilename,
	quarantineCorruptFile,
	retireProjectSlug,
	projectsDir,
	projectFilePath,
	autosaveFilePath,
	ensureProjectsDir,
	getActiveSlug,
	setActiveSlug,
	wasProjectSlugRetired,
	migrateLegacySingleProject,
	readProjectFile,
	readAutosaveFile,
	readLegacyAutosaveIfMatches,
	writeProjectFile,
	writeAutosaveFile,
	withProjectSlug,
	listProjectFiles,
	loadProjectBySlug,
}
