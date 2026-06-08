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
const ACTIVE_SLUG_KEY = 'web_project_active_slug'
const LEGACY_AUTOSAVE_PATH = path.join(REPO_ROOT, 'autosave.json')

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

function projectFilePath(slug) {
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
	persistence.set(ACTIVE_SLUG_KEY, String(slug || '').trim() || 'untitled')
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
		fs.writeFileSync(projectFilePath(slug), JSON.stringify(legacy, null, 2), 'utf8')
		setActiveSlug(persistence, slug)
	} catch (e) {
		console.warn('[project-store] legacy migrate failed:', e.message)
	}
}

/**
 * @param {string} slug
 * @returns {object | null}
 */
function readProjectFile(slug) {
	if (!slug) return null
	try {
		pullProjectSlugFromUsbIfNewer(slug)
	} catch (_) {}
	const p = projectFilePath(slug)
	if (!fs.existsSync(p)) return null
	try {
		const project = JSON.parse(fs.readFileSync(p, 'utf8'))
		return project && typeof project === 'object' ? project : null
	} catch {
		return null
	}
}

/**
 * @param {string} slug
 * @param {object} project
 */
function autosaveFilePath(slug) {
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
	if (!slug) return
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
	if (!slug) return null
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
	ACTIVE_SLUG_KEY,
	LEGACY_AUTOSAVE_PATH,
	projectSlugFromName,
	projectsDir,
	projectFilePath,
	autosaveFilePath,
	ensureProjectsDir,
	getActiveSlug,
	setActiveSlug,
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
