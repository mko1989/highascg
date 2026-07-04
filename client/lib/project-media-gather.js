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
 * @returns {Map<string, string>}
 */
function buildMovedTargetMap(idsToMove, folder, slug, settings) {
	/** @type {Map<string, string>} */
	const map = new Map()
	for (const oldId of idsToMove || []) {
		const leaf = oldId.split('/').pop() || oldId
		const target = normalizeMediaIdForProject(`${folder}/${leaf}`, slug, settings)
		const key = normId(oldId)
		if (key && target) map.set(key, target)
		const leafKey = normId(leaf)
		if (leafKey && target && !map.has(leafKey)) map.set(leafKey, target)
	}
	return map
}

/**
 * @param {string[]} idsToMove
 * @param {string} folder
 * @param {string} slug
 * @param {object} [settings]
 * @param {string[]} projectRefs
 * @param {Array<{ id?: string }>} preMoveMediaList
 * @param {Array<{ id?: string }>} [postMoveMediaList]
 * @returns {Map<string, string>}
 */
function buildGatherRefMap(idsToMove, folder, slug, settings, projectRefs, preMoveMediaList, postMoveMediaList) {
	/** @type {Map<string, string>} */
	const map = new Map()
	const moved = new Set(idsToMove.map((id) => normId(id)))
	const movedTargets = buildMovedTargetMap(idsToMove, folder, slug, settings)

	const add = (from, to) => {
		const f = normId(from)
		const t = normId(to)
		if (f && t) map.set(f, t)
	}

	for (const [from, to] of movedTargets) {
		add(from, to)
	}

	for (const ref of projectRefs) {
		const catalogId =
			resolveRefToCatalogId(ref, preMoveMediaList, folder) ||
			resolveRefToCatalogId(ref, postMoveMediaList, folder)
		if (!catalogId || !moved.has(normId(catalogId))) continue
		const target = movedTargets.get(normId(catalogId)) || movedTargets.get(normId(catalogId.split('/').pop() || ''))
		if (!target) continue
		add(ref, target)
		add(catalogId, target)
	}

	return map
}

/**
 * @param {object | null | undefined} source
 * @returns {boolean}
 */
function isGatherableMediaSource(source) {
	if (!source || typeof source !== 'object') return false
	const t = String(source.type || 'media').toLowerCase()
	if (t === 'template' || t === 'html' || t === 'timeline' || t === 'effect' || t === 'live') return false
	const value = normId(source.value)
	return !!value && !SKIP_VALUE_RE.test(value)
}

/**
 * @param {object | null | undefined} source
 * @param {Map<string, string>} refMap
 * @param {Map<string, string>} movedTargets
 * @param {string} folder
 * @param {string} slug
 * @param {object} [settings]
 * @param {Array<{ id?: string }>} mediaList
 * @returns {boolean}
 */
function rewriteSourceAfterGather(source, refMap, movedTargets, folder, slug, settings, mediaList) {
	if (!isGatherableMediaSource(source)) return false
	const value = normId(source.value)
	let next = refMap.get(value) || null

	if (!next) {
		const catalogId = resolveRefToCatalogId(value, mediaList, folder)
		if (catalogId) {
			next =
				movedTargets.get(normId(catalogId)) ||
				movedTargets.get(normId(catalogId.split('/').pop() || '')) ||
				null
			if (!next && isInsideProjectFolder(catalogId, folder)) {
				next = normalizeMediaIdForProject(catalogId, slug, settings)
			}
		}
	}

	if (!next) {
		const leaf = value.split('/').pop() || value
		next = movedTargets.get(normId(leaf)) || null
	}

	if (!next || normId(next) === value) return false
	applyMediaSourceValue(source, next)
	return true
}

/**
 * Rewrite look/timeline/multiview sources after files were gathered into the project folder.
 * @param {object} project
 * @param {Map<string, string>} refMap
 * @param {Map<string, string>} movedTargets
 * @param {string} folder
 * @param {string} slug
 * @param {object} [settings]
 * @param {Array<{ id?: string }>} mediaList
 */
function rewriteProjectPathsAfterGather(project, refMap, movedTargets, folder, slug, settings, mediaList) {
	if (!refMap.size && !movedTargets.size) return project
	const next = structuredClone(project)
	let changed = false
	forEachProjectMediaSource(next, (source) => {
		if (rewriteSourceAfterGather(source, refMap, movedTargets, folder, slug, settings, mediaList)) {
			changed = true
		}
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
	try {
		await api.post('/api/media/refresh', {})
	} catch {
		/* optional — GET /api/media still rescans on many builds */
	}
	const freshMediaList = await fetchFreshMediaList(mediaList)

	const movedTargets = buildMovedTargetMap(idsToMove || [], folder, slug, settings)
	const refMap = buildGatherRefMap(
		idsToMove || [],
		folder,
		slug,
		settings,
		projectRefs,
		mediaList,
		freshMediaList,
	)
	let projectUpdated = rewriteProjectPathsAfterGather(
		project,
		refMap,
		movedTargets,
		folder,
		slug,
		settings,
		freshMediaList,
	)
	projectUpdated = normalizeProjectMediaRefs(projectUpdated, settings)

	const pathsUpdated = JSON.stringify(projectUpdated) !== before

	return {
		moved: transfer.ok,
		failed: transfer.failed,
		skipped,
		pathsUpdated,
		projectUpdated: pathsUpdated || transfer.ok > 0 ? projectUpdated : null,
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

export const __test = {
	buildGatherRefMap,
	buildMovedTargetMap,
	rewriteProjectPathsAfterGather,
	resolveRefToCatalogId,
	normId,
}
