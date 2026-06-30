/**
 * Active project media folder context (WO-62) — upload defaults, browser filter, path normalize.
 */

import { api } from './api-client.js'
import { projectFileIdFromName } from './project-files.js'
import { forEachProjectMediaSource } from './project-media-refs.js'
import { projectState } from './project-state.js'
import { settingsState } from './settings-state.js'
import {
	getProjectMediaRelId,
	projectMediaIdPrefixesForSlug,
} from './project-media-location.js'

/** @type {{ activeSlug: string, mediaFolder: string, projectScopedEnabled: boolean, projectName: string }} */
let _ctx = {
	activeSlug: '',
	mediaFolder: '',
	projectScopedEnabled: true,
	projectName: '',
}

/** @type {object | null} */
let _settings = null

const SKIP_VALUE_RE = /^(https?|rtsp|rtmp|srt|udp|ndi|alsa|decklink|route):/i

/**
 * @param {object} [settings]
 * @returns {object | null}
 */
function resolveSettings(settings) {
	return settings || _settings || settingsState.getSettings() || null
}

/**
 * Slug for the project currently open in the UI (not necessarily server activeSlug).
 * @returns {string}
 */
function getClientProjectSlug() {
	const name = projectState.getProjectName()
	return name ? projectFileIdFromName(name) : ''
}

/**
 * @param {string} slug
 * @param {object} [settings]
 * @param {string} [projectName]
 */
function applySlugToContext(slug, settings, projectName) {
	const s = String(slug || '').trim()
	const cfg = resolveSettings(settings)
	setProjectMediaContext({
		activeSlug: s,
		mediaFolder: s && cfg ? getProjectMediaRelId(s, cfg) : s ? `projects/${s}` : '',
		projectName: projectName != null ? String(projectName) : s,
	})
}

/**
 * @returns {{ activeSlug: string, mediaFolder: string, projectScopedEnabled: boolean, projectName: string }}
 */
export function getProjectMediaContext() {
	return { ..._ctx }
}

/**
 * @param {unknown} patch
 */
export function setProjectMediaContext(patch) {
	if (!patch || typeof patch !== 'object') return
	const p = /** @type {Record<string, unknown>} */ (patch)
	if (p.activeSlug != null) _ctx.activeSlug = String(p.activeSlug || '').trim()
	if (p.mediaFolder != null) _ctx.mediaFolder = String(p.mediaFolder || '').trim()
	if (p.projectScopedEnabled != null) _ctx.projectScopedEnabled = p.projectScopedEnabled !== false
	if (p.projectName != null) _ctx.projectName = String(p.projectName || '').trim()
}

/**
 * Refresh from server list + settings.
 * @returns {Promise<ReturnType<typeof getProjectMediaContext>>}
 */
export async function refreshProjectMediaContext() {
	/** @type {object | null} */
	let settings = null
	try {
		const res = await api.get('/api/project/list')
		if (res && typeof res === 'object') {
			const r = /** @type {Record<string, unknown>} */ (res)
			const slug = String(r.activeSlug || '').trim()
			const apm = r.activeProjectMedia
			let mediaFolder = ''
			if (apm && typeof apm === 'object' && /** @type {{ relId?: string }} */ (apm).relId) {
				mediaFolder = String(/** @type {{ relId?: string }} */ (apm).relId)
			}
			const files = Array.isArray(r.projects) ? r.projects : []
			const active = files.find((f) => f && typeof f === 'object' && (f.slug === slug || f.id === slug))
			setProjectMediaContext({
				activeSlug: slug,
				mediaFolder,
				projectName: active?.name ? String(active.name) : slug,
			})
		}
	} catch {
		/* keep previous */
	}
	try {
		settings = await api.get('/api/settings')
		_settings = settings
		if (settings?.projectScopedMedia) {
			setProjectMediaContext({ projectScopedEnabled: settings.projectScopedMedia.enabled !== false })
		}
	} catch {
		/* optional */
	}
	if (_ctx.activeSlug && !_ctx.mediaFolder && settings) {
		setProjectMediaContext({ mediaFolder: getProjectMediaRelId(_ctx.activeSlug, settings) })
	}
	const clientSlug = getClientProjectSlug()
	if (clientSlug) {
		applySlugToContext(clientSlug, settings, projectState.getProjectName())
	}
	return getProjectMediaContext()
}

/**
 * @param {object} [project]
 * @param {object} [settings]
 */
export function syncProjectMediaContextFromProject(project, settings) {
	if (!project || typeof project !== 'object') return
	const slug = String(project.slug || projectFileIdFromName(project.name) || '').trim()
	applySlugToContext(slug, settings, String(project.name || slug))
}

/** Sync upload target from the in-memory project name (e.g. New project, rename). */
export function syncProjectMediaContextFromClient(settings) {
	const name = projectState.getProjectName()
	const slug = name ? projectFileIdFromName(name) : ''
	applySlugToContext(slug, settings, name)
}

/**
 * Default ingest subdir relative to media root (empty = flat root).
 * Uses the UI project name so uploads land in the correct folder even before server save/load.
 * @returns {string}
 */
export function getDefaultUploadSubdir() {
	if (!_ctx.projectScopedEnabled) return ''
	const slug = getClientProjectSlug() || _ctx.activeSlug
	if (!slug) return ''
	return getProjectMediaRelId(slug, resolveSettings())
}

/**
 * @param {string} storedId
 * @param {string} slug
 * @param {object} [settings]
 * @returns {string}
 */
export function normalizeMediaIdForProject(storedId, slug, settings) {
	const id = String(storedId || '')
		.replace(/\\/g, '/')
		.replace(/\/+/g, '/')
		.trim()
	if (!id || !slug) return id
	for (const prefix of projectMediaIdPrefixesForSlug(slug, settings)) {
		if (id.startsWith(prefix)) return id.slice(prefix.length)
	}
	return id
}

/**
 * @param {object | null | undefined} source
 * @param {string} slug
 * @param {object} [settings]
 */
function normalizeSourceRef(source, slug, settings) {
	if (!source || typeof source !== 'object' || !slug) return
	const t = String(source.type || 'media').toLowerCase()
	if (t === 'template' || t === 'html' || t === 'timeline' || t === 'effect' || t === 'live') return
	const value = String(source.value || '').trim()
	if (!value || SKIP_VALUE_RE.test(value)) return
	const normalized = normalizeMediaIdForProject(value, slug, settings)
	if (normalized !== value) {
		source.value = normalized
		if (source.label != null && String(source.label).trim() === value) {
			source.label = normalized
		}
	}
}

/**
 * @param {object} project
 * @param {object} [settings]
 * @returns {object}
 */
export function normalizeProjectMediaRefs(project, settings) {
	if (!project || typeof project !== 'object') return project
	if (!_ctx.projectScopedEnabled) return project
	const slug = String(project.slug || projectFileIdFromName(project.name) || _ctx.activeSlug || '').trim()
	if (!slug) return project

	const next = structuredClone(project)
	forEachProjectMediaSource(next, (source) => normalizeSourceRef(source, slug, settings))
	return next
}

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isMediaInActiveProject(id) {
	if (!_ctx.projectScopedEnabled || !_ctx.activeSlug) return true
	const s = String(id || '').replace(/\\/g, '/')
	const folder = _ctx.mediaFolder || `projects/${_ctx.activeSlug}`
	const prefix = `${folder}/`
	if (s.startsWith(prefix)) return true
	if (s === folder) return true
	if (!s.startsWith('projects/') && !s.startsWith('exfat/projects/') && !s.startsWith('bridge/projects/') && !s.includes('/')) {
		return true
	}
	return false
}

/**
 * @param {Array<{ id?: string, isDir?: boolean }>} list
 * @returns {Array<{ id?: string, isDir?: boolean }>}
 */
export function filterMediaForActiveProject(list) {
	if (!_ctx.projectScopedEnabled || !_ctx.activeSlug) return list
	const folder = _ctx.mediaFolder || `projects/${_ctx.activeSlug}`
	const prefix = `${folder}/`
	const root = folder
	return list.filter((item) => {
		const id = String(item?.id ?? item ?? '').replace(/\\/g, '/')
		if (item?.isDir) {
			return id === root || id.startsWith(prefix)
		}
		return isMediaInActiveProject(id)
	})
}

/**
 * @returns {string}
 */
export function formatProjectMediaUploadHint() {
	const { mediaFolder, projectName, projectScopedEnabled } = _ctx
	if (!projectScopedEnabled || !mediaFolder) return ''
	const label = projectName || _ctx.activeSlug || 'project'
	return `Uploads go to ${mediaFolder}/ (${label})`
}
