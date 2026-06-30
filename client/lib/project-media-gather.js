/**
 * Move clips referenced by the open project into its media folder.
 */
import { api } from './api-client.js'
import { collectProjectAssetRefs, forEachProjectMediaSource } from './project-media-refs.js'
import { moveMediaFiles } from './media-file-ops.js'
import { normalizeMediaIdForProject, normalizeProjectMediaRefs } from './project-media-context.js'
import { projectFileIdFromName } from './project-files.js'

const SKIP_VALUE_RE = /^(https?|rtsp|rtmp|srt|udp|ndi|alsa|decklink|route):/i

/**
 * @param {string} id
 * @returns {string}
 */
function normId(id) {
	return String(id || '').replace(/\\/g, '/').replace(/\/+/g, '/').trim()
}

/**
 * @param {string} mediaId
 * @param {string} projectFolder
 */
function isInsideProjectFolder(mediaId, projectFolder) {
	const id = normId(mediaId)
	const folder = normId(projectFolder)
	if (!folder) return true
	const prefix = `${folder}/`
	return id === folder || id.startsWith(prefix)
}

/**
 * @param {string} ref
 * @param {Array<{ id?: string }>} mediaList
 * @param {string} [projectFolder]
 * @returns {string | null}
 */
function resolveRefToCatalogId(ref, mediaList, projectFolder) {
	const want = normId(ref)
	if (!want) return null
	const byId = new Map()
	for (const item of mediaList || []) {
		const id = normId(item?.id)
		if (id) byId.set(id, id)
	}
	if (byId.has(want)) return want

	const leaf = want.split('/').pop() || want
	/** @type {string[]} */
	const matches = []
	for (const id of byId.values()) {
		if (id === want || id.endsWith(`/${want}`) || id.split('/').pop() === leaf) matches.push(id)
	}
	if (!matches.length) return null
	if (matches.length === 1) return matches[0]

	const folder = normId(projectFolder)
	if (folder) {
		const inProject = matches.filter((id) => isInsideProjectFolder(id, folder))
		if (inProject.length === 1) return inProject[0]
		if (inProject.length > 1) return inProject[0]
	}
	return matches[0]
}

/**
 * @param {object} source
 * @param {string} newValue
 */
function applyMediaSourceValue(source, newValue) {
	const oldVal = normId(source.value)
	const next = String(newValue || '')
	source.value = next
	if (source.label != null && normId(source.label) === oldVal) {
		source.label = next
	}
}

/**
 * @param {string[]} idsToMove
 * @param {string} folder
 * @param {string} slug
 * @param {object} [settings]
 * @param {string[]} projectRefs
 * @param {Array<{ id?: string }>} mediaList
 * @returns {Map<string, string>}
 */
function buildGatherRefMap(idsToMove, folder, slug, settings, projectRefs, mediaList) {
	/** @type {Map<string, string>} */
	const map = new Map()
	const moved = new Set(idsToMove.map((id) => normId(id)))

	const add = (from, to) => {
		const f = normId(from)
		const t = normId(to)
		if (f && t) map.set(f, t)
	}

	for (const oldId of idsToMove) {
		const leaf = oldId.split('/').pop() || oldId
		add(oldId, normalizeMediaIdForProject(`${folder}/${leaf}`, slug, settings))
		const leafOnly = normId(leaf)
		if (leafOnly) add(leafOnly, normalizeMediaIdForProject(`${folder}/${leaf}`, slug, settings))
	}

	for (const ref of projectRefs) {
		const catalogId = resolveRefToCatalogId(ref, mediaList, folder)
		if (!catalogId || !moved.has(normId(catalogId))) continue
		const leaf = catalogId.split('/').pop() || catalogId
		const normalized = normalizeMediaIdForProject(`${folder}/${leaf}`, slug, settings)
		add(ref, normalized)
		add(catalogId, normalized)
	}

	return map
}

/**
 * @param {object | null | undefined} source
 * @param {Map<string, string>} refMap
 */
function rewriteSourceRef(source, refMap) {
	if (!source || typeof source !== 'object') return false
	const t = String(source.type || 'media').toLowerCase()
	if (t === 'template' || t === 'html' || t === 'timeline' || t === 'effect' || t === 'live') return false
	const value = normId(source.value)
	if (!value || SKIP_VALUE_RE.test(value)) return false
	if (!refMap.has(value)) return false
	applyMediaSourceValue(source, refMap.get(value))
	return true
}

/**
 * Point every look/timeline source at the project-relative id when the file lives in the project folder.
 * @param {object} project
 * @param {string} folder
 * @param {string} slug
 * @param {object} [settings]
 * @param {Array<{ id?: string }>} mediaList
 */
function alignProjectMediaRefsToFolder(project, folder, slug, settings, mediaList) {
	const next = structuredClone(project)
	let changed = false
	forEachProjectMediaSource(next, (source) => {
		const t = String(source.type || 'media').toLowerCase()
		if (t === 'template' || t === 'html' || t === 'timeline' || t === 'effect' || t === 'live') return
		const value = normId(source.value)
		if (!value || SKIP_VALUE_RE.test(value)) return
		const catalogId = resolveRefToCatalogId(value, mediaList, folder)
		if (!catalogId || !isInsideProjectFolder(catalogId, folder)) return
		const normalized = normalizeMediaIdForProject(catalogId, slug, settings)
		if (normId(source.value) !== normId(normalized)) {
			applyMediaSourceValue(source, normalized)
			changed = true
		}
	})
	return changed ? next : project
}

/**
 * @param {object} project
 * @param {Map<string, string>} refMap
 * @returns {object}
 */
function applyGatherRefMapToProject(project, refMap) {
	if (!refMap.size) return project
	const next = structuredClone(project)
	let changed = false
	forEachProjectMediaSource(next, (source) => {
		if (rewriteSourceRef(source, refMap)) changed = true
	})
	return changed ? next : project
}

/**
 * @param {Array<{ id?: string }>} [fallback]
 * @returns {Promise<Array<{ id?: string }>>}
 */
async function fetchFreshMediaList(fallback) {
	try {
		const data = await api.get('/api/media')
		const list = data?.media ?? data
		return Array.isArray(list) ? list : fallback || []
	} catch {
		return fallback || []
	}
}

/**
 * @param {{
 *   project: object,
 *   mediaList: Array<{ id?: string }>,
 *   projectFolder: string,
 *   settings?: object,
 * }} opts
 */
export function planGatherProjectMediaIntoFolder(opts) {
	const { project, mediaList, projectFolder, settings } = opts
	const folder = normId(projectFolder)
	if (!folder) throw new Error('Project media folder is not configured')

	const slug = String(project.slug || projectFileIdFromName(project.name) || '').trim()
	const refs = collectProjectAssetRefs(project)
	/** @type {string[]} */
	const idsToMove = []
	const seen = new Set()

	for (const ref of refs.media) {
		const mediaId = resolveRefToCatalogId(ref, mediaList, folder)
		if (!mediaId || seen.has(mediaId)) continue
		seen.add(mediaId)
		if (!isInsideProjectFolder(mediaId, folder)) idsToMove.push(mediaId)
	}

	return {
		pending: idsToMove.length,
		idsToMove,
		project,
		folder,
		slug,
		settings,
		mediaList,
		projectRefs: refs.media,
		skipped: refs.media.length - idsToMove.length,
	}
}

/**
 * @param {ReturnType<typeof planGatherProjectMediaIntoFolder>} plan
 * @param {{ refreshMedia?: () => Promise<void> }} [opts]
 */
export async function executeGatherProjectMedia(plan, opts = {}) {
	const { idsToMove, project, folder, slug, settings, mediaList, projectRefs, skipped } = plan
	const before = JSON.stringify(project)

	/** @type {{ ok: number, failed: number, errors: { id: string, message: string }[] }} */
	let transfer = { ok: 0, failed: 0, errors: [] }
	if (idsToMove?.length) {
		await api.post('/api/media/mkdir', { path: folder }).catch(() => {})
		transfer = await moveMediaFiles(idsToMove, folder)
	}

	if (typeof opts.refreshMedia === 'function') {
		await opts.refreshMedia()
	}
	const freshMediaList = await fetchFreshMediaList(mediaList)

	const refMap = buildGatherRefMap(idsToMove || [], folder, slug, settings, projectRefs, mediaList)
	let projectUpdated = applyGatherRefMapToProject(project, refMap)
	projectUpdated = alignProjectMediaRefsToFolder(projectUpdated, folder, slug, settings, freshMediaList)
	projectUpdated = normalizeProjectMediaRefs(projectUpdated, settings)

	const pathsUpdated = JSON.stringify(projectUpdated) !== before

	return {
		moved: transfer.ok,
		failed: transfer.failed,
		skipped,
		pathsUpdated,
		projectUpdated: pathsUpdated ? projectUpdated : null,
		errors: transfer.errors || [],
	}
}

/**
 * @param {{
 *   project: object,
 *   mediaList: Array<{ id?: string }>,
 *   projectFolder: string,
 *   settings?: object,
 * }} opts
 * @param {{ refreshMedia?: () => Promise<void> }} [runOpts]
 */
export async function gatherProjectMediaIntoFolder(opts, runOpts) {
	const plan = planGatherProjectMediaIntoFolder(opts)
	return executeGatherProjectMedia(plan, runOpts)
}
