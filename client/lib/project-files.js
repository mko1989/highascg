/**
 * Server-side project files (named JSON on disk) — list, load, download.
 * @see to_server/PROJECT_FILES_API.md
 */

import { api, resolveApiUrl } from './api-client.js'
import { normalizeProjectPayload } from './project-load.js'

/**
 * @typedef {object} ProjectFileEntry
 * @property {string} id
 * @property {string} name
 * @property {string} filename
 * @property {string|null} savedAt
 * @property {string|null} modifiedAt
 * @property {number|null} sizeBytes
 * @property {boolean} active
 * @property {boolean} [legacy] — synthetic row from GET /api/project when list API missing
 */

const LEGACY_CURRENT_ID = '__current__'

/**
 * @param {unknown} entry
 * @returns {ProjectFileEntry|null}
 */
export function normalizeProjectFileEntry(entry) {
	if (!entry || typeof entry !== 'object') return null
	const e = /** @type {Record<string, unknown>} */ (entry)
	const rawId = e.id ?? e.slug ?? e.key
	const filename = e.filename != null ? String(e.filename) : ''
	const id =
		rawId != null
			? String(rawId)
			: filename
				? filename.replace(/\.json$/i, '')
				: ''
	if (!id) return null
	return {
		id,
		name: String(e.name ?? e.title ?? id),
		filename: filename || `${id}.json`,
		savedAt: e.savedAt != null ? String(e.savedAt) : e.mtime != null ? String(e.mtime) : null,
		modifiedAt:
			e.modifiedAt != null
				? String(e.modifiedAt)
				: e.savedAt != null
					? String(e.savedAt)
					: null,
		sizeBytes: typeof e.sizeBytes === 'number' ? e.sizeBytes : typeof e.size === 'number' ? e.size : null,
		active: e.active === true || e.isActive === true,
	}
}

/**
 * @param {unknown} res
 * @returns {ProjectFileEntry[]}
 */
export function normalizeProjectFileList(res) {
	if (!res) return []
	if (Array.isArray(res)) {
		return res.map(normalizeProjectFileEntry).filter(Boolean)
	}
	if (typeof res !== 'object') return []
	const r = /** @type {Record<string, unknown>} */ (res)
	const files = r.files ?? r.projects ?? r.items
	if (!Array.isArray(files)) return []
	return files.map(normalizeProjectFileEntry).filter(Boolean)
}

/**
 * @returns {Promise<{ files: ProjectFileEntry[], activeId: string|null, fromListApi: boolean }>}
 */
export async function fetchProjectFileList() {
	let activeId = null
	try {
		const res = await api.get('/api/project/list')
		if (res && typeof res === 'object') {
			const r = /** @type {Record<string, unknown>} */ (res)
			if (r.activeId != null) activeId = String(r.activeId)
			const files = normalizeProjectFileList(res)
			if (files.length) {
				if (!activeId) {
					const active = files.find((f) => f.active)
					if (active) activeId = active.id
				}
				return { files, activeId, fromListApi: true }
			}
		}
	} catch {
		/* list API not implemented yet */
	}

	try {
		const current = normalizeProjectPayload(await api.get('/api/project'))
		if (current) {
			const files = [
				{
					id: LEGACY_CURRENT_ID,
					name: current.name || 'Current project',
					filename: 'current.json',
					savedAt: current.savedAt != null ? String(current.savedAt) : null,
					modifiedAt: current.savedAt != null ? String(current.savedAt) : null,
					sizeBytes: null,
					active: true,
					legacy: true,
				},
			]
			return { files, activeId: LEGACY_CURRENT_ID, fromListApi: false }
		}
	} catch {
		/* no project on server */
	}

	return { files: [], activeId: null, fromListApi: false }
}

/**
 * Load project JSON without activating it on the server (GET file only when possible).
 * Use before hardware reconcile so POST /api/project/load does not merge routing early.
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function fetchProjectFileContentById(id) {
	if (id === LEGACY_CURRENT_ID) {
		const { fetchProjectFromServer } = await import('./project-load.js')
		return fetchProjectFromServer()
	}
	try {
		const getRes = await api.get(`/api/project/file/${encodeURIComponent(id)}`)
		const fromGet = normalizeProjectPayload(getRes)
		if (fromGet) return fromGet
	} catch {
		/* fall through */
	}
	return loadProjectFileById(id)
}

/**
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function loadProjectFileById(id) {
	if (id === LEGACY_CURRENT_ID) {
		const { fetchProjectFromServer } = await import('./project-load.js')
		return fetchProjectFromServer()
	}

	try {
		const postRes = await api.post('/api/project/load', { id })
		const fromPost = normalizeProjectPayload(postRes)
		if (fromPost) return fromPost
	} catch {
		/* try GET file */
	}

	const getRes = await api.get(`/api/project/file/${encodeURIComponent(id)}`)
	const fromGet = normalizeProjectPayload(getRes)
	if (fromGet) return fromGet
	throw new Error(`Could not load project file “${id}”`)
}

/**
 * @param {ProjectFileEntry} entry
 * @param {object} [project] — required for legacy __current__ download
 */
export async function downloadProjectFile(entry, project) {
	const id = entry?.id
	if (!id) throw new Error('No file selected')

	if (entry.legacy || id === LEGACY_CURRENT_ID) {
		const payload = project ?? normalizeProjectPayload(await api.get('/api/project'))
		if (!payload) throw new Error('No project on server to download')
		triggerJsonDownload(payload, entry.filename || 'project.json')
		return
	}

	const url = resolveApiUrl(`/api/project/file/${encodeURIComponent(id)}/download`)
	let res = await fetch(url)
	if (!res.ok) {
		const body = normalizeProjectPayload(await api.get(`/api/project/file/${encodeURIComponent(id)}`))
		if (body) {
			triggerJsonDownload(body, entry.filename || `${id}.json`)
			return
		}
		throw new Error(`Download failed (HTTP ${res.status})`)
	}

	const blob = await res.blob()
	const name =
		parseContentDispositionFilename(res.headers.get('content-disposition')) ||
		entry.filename ||
		`${id}.json`
	triggerBlobDownload(blob, name)
}

/**
 * @param {string|null} header
 * @returns {string|null}
 */
function parseContentDispositionFilename(header) {
	if (!header) return null
	const m = /filename\*?=(?:UTF-8''|")?([^";\n]+)/i.exec(header)
	if (!m) return null
	try {
		return decodeURIComponent(m[1].replace(/"/g, '').trim())
	} catch {
		return m[1].replace(/"/g, '').trim()
	}
}

/**
 * @param {Blob} blob
 * @param {string} filename
 */
function triggerBlobDownload(blob, filename) {
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = filename
	a.click()
	URL.revokeObjectURL(url)
}

/**
 * @param {object} data
 * @param {string} filename
 */
function triggerJsonDownload(data, filename) {
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
	triggerBlobDownload(blob, filename)
}

/**
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function formatProjectFileDate(iso) {
	if (!iso) return '—'
	const d = new Date(iso)
	return Number.isFinite(d.getTime()) ? d.toLocaleString() : '—'
}

/**
 * @param {number|null} bytes
 * @returns {string}
 */
export function formatProjectFileSize(bytes) {
	if (bytes == null || !Number.isFinite(bytes)) return ''
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * @param {string} [name]
 * @returns {string}
 */
export function projectFileIdFromName(name) {
	return (
		String(name || 'project')
			.trim()
			.toLowerCase()
			.replace(/[^\w.-]+/g, '_') || 'project'
	)
}

export { LEGACY_CURRENT_ID }
