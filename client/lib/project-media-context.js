/**
 * Active project media folder context (WO-62) — upload defaults, browser filter, path normalize.
 */

import { api } from './api-client.js'
import { projectFileIdFromName } from './project-files.js'
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

const SKIP_VALUE_RE = /^(https?|rtsp|rtmp|srt|udp|ndi|alsa|decklink|route):/i

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
		if (settings?.projectScopedMedia) {
			setProjectMediaContext({ projectScopedEnabled: settings.projectScopedMedia.enabled !== false })
		}
	} catch {
		/* optional */
	}
	if (_ctx.activeSlug && !_ctx.mediaFolder && settings) {
		setProjectMediaContext({ mediaFolder: getProjectMediaRelId(_ctx.activeSlug, settings) })
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
	setProjectMediaContext({
		activeSlug: slug,
		mediaFolder: slug ? getProjectMediaRelId(slug, settings) : '',
		projectName: String(project.name || slug),
	})
}

/**
 * Default ingest subdir relative to media root (empty = flat root).
 * @returns {string}
 */
export function getDefaultUploadSubdir() {
	if (!_ctx.projectScopedEnabled || !_ctx.mediaFolder) return ''
	return _ctx.mediaFolder
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
	source.value = normalizeMediaIdForProject(value, slug, settings)
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
	const scenesBlock = next.scenes
	const sceneList = Array.isArray(scenesBlock)
		? scenesBlock
		: Array.isArray(scenesBlock?.scenes)
			? scenesBlock.scenes
			: scenesBlock && typeof scenesBlock === 'object'
				? Object.values(scenesBlock)
				: []

	for (const scene of sceneList) {
		for (const layer of scene?.layers || []) {
			normalizeSourceRef(layer.source, slug, settings)
			for (const item of layer.playlist || []) normalizeSourceRef(item, slug, settings)
		}
	}

	const timelinesBlock = next.timelines
	const timelineList = Array.isArray(timelinesBlock)
		? timelinesBlock
		: Array.isArray(timelinesBlock?.timelines)
			? timelinesBlock.timelines
			: []

	for (const tl of timelineList) {
		for (const layer of tl?.layers || []) {
			for (const clip of layer?.clips || []) normalizeSourceRef(clip?.source, slug, settings)
		}
	}

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
