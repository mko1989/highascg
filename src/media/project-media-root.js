/**
 * Project-scoped media root (WO-62): default ingest under media/projects/<slug>/.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { getMediaIngestBasePath, normalizeMediaIdKey, resolveSafe } = require('./local-media-paths')
const projectStore = require('../engine/project-store')
const persistence = require('../utils/persistence')
const { collectProjectAssetRefs } = require('../replication/project-media-refs')

const PROJECTS_NAMESPACE = 'projects'

/**
 * @param {object} [config]
 * @returns {boolean}
 */
function isProjectScopedMediaEnabled(config) {
	const cfg = config && typeof config === 'object' ? config : {}
	const block = cfg.projectScopedMedia
	if (block && typeof block === 'object' && block.enabled === false) return false
	return true
}

/**
 * @param {import('../utils/persistence')} [store]
 * @param {object} [project]
 * @returns {string}
 */
function getActiveProjectSlug(store, project) {
	if (project && typeof project === 'object') {
		const fromProject = String(project.slug || '').trim()
		if (fromProject) return fromProject
		const fromName = projectStore.projectSlugFromName(project.name)
		if (fromName) return fromName
	}
	const p = store || persistence
	return projectStore.getActiveSlug(p) || ''
}

/**
 * @param {string} slug
 * @returns {string}
 */
function getProjectMediaRelId(slug) {
	const s = String(slug || '').trim()
	if (!s) return ''
	return `${PROJECTS_NAMESPACE}/${s}`
}

/**
 * @param {object} [config]
 * @param {import('../utils/persistence')} [store]
 * @param {string} [slug]
 * @returns {string}
 */
function getProjectMediaRoot(config, store, slug) {
	const mediaRoot = getMediaIngestBasePath(config)
	const s = String(slug || getActiveProjectSlug(store) || '').trim()
	if (!s) return mediaRoot
	return path.join(mediaRoot, PROJECTS_NAMESPACE, s)
}

/**
 * @param {object} [config]
 * @param {import('../utils/persistence')} [store]
 * @returns {string}
 */
function getDefaultIngestSubdir(config, store) {
	if (!isProjectScopedMediaEnabled(config)) return ''
	const slug = getActiveProjectSlug(store)
	return slug ? getProjectMediaRelId(slug) : ''
}

/**
 * @param {object} [config]
 * @param {string} [explicitSubdir]
 * @param {import('../utils/persistence')} [store]
 * @returns {string}
 */
function getIngestEffectiveBase(config, explicitSubdir, store) {
	const mediaBase = getMediaIngestBasePath(config)
	const sub = String(explicitSubdir || '').trim() || getDefaultIngestSubdir(config, store)
	if (!sub) return mediaBase
	const resolved = resolveSafe(mediaBase, sub)
	return resolved || mediaBase
}

/**
 * @param {object} [config]
 * @param {string} [slug]
 * @param {import('../utils/persistence')} [store]
 * @returns {string | null}
 */
function ensureProjectMediaDir(config, slug, store) {
	if (!isProjectScopedMediaEnabled(config)) return null
	const s = String(slug || getActiveProjectSlug(store) || '').trim()
	if (!s) return null
	const dir = getProjectMediaRoot(config, store, s)
	fs.mkdirSync(dir, { recursive: true })
	return dir
}

/**
 * @param {string} storedId
 * @param {string} slug
 * @returns {string}
 */
function normalizeMediaIdForProject(storedId, slug) {
	const id = normalizeMediaIdKey(storedId).trim()
	if (!id || !slug) return id
	const prefix = `${PROJECTS_NAMESPACE}/${slug}/`
	if (id.startsWith(prefix)) return id.slice(prefix.length)
	return id
}

/**
 * @param {string} storedId
 * @param {string} slug
 * @returns {string}
 */
function expandMediaIdToMediaRoot(storedId, slug) {
	const id = normalizeMediaIdKey(storedId).trim()
	if (!id || !slug) return id
	if (/^(https?|rtsp|rtmp|srt|udp|ndi|alsa|decklink|route):/i.test(id)) return id
	if (id.startsWith(`${PROJECTS_NAMESPACE}/`)) return id
	if (id.includes('/') && !id.startsWith('../')) return id
	return `${PROJECTS_NAMESPACE}/${slug}/${id}`
}

/**
 * @param {object} config
 * @param {string} filename
 * @param {import('../utils/persistence')} [store]
 * @returns {string[]}
 */
function getProjectMediaResolveCandidates(config, filename, store) {
	if (!isProjectScopedMediaEnabled(config)) return []
	const slug = getActiveProjectSlug(store)
	if (!slug) return []
	const id = normalizeMediaIdKey(filename).trim()
	if (!id || id.includes('..')) return []
	const mediaRoot = getMediaIngestBasePath(config)
	const prefix = `${PROJECTS_NAMESPACE}/${slug}/`
	const out = []
	if (id.startsWith(prefix)) {
		out.push(id)
	} else if (!id.startsWith(`${PROJECTS_NAMESPACE}/`) && !/^[a-z]+:\/\//i.test(id)) {
		out.push(`${prefix}${id}`)
	}
	const projectRoot = path.join(mediaRoot, PROJECTS_NAMESPACE, slug)
	const relUnderProject = id.startsWith(prefix) ? id.slice(prefix.length) : id
	const abs = resolveSafe(projectRoot, relUnderProject)
	if (abs) out.push(path.relative(mediaRoot, abs).replace(/\\/g, '/'))
	return [...new Set(out.filter(Boolean))]
}

/**
 * @param {object} source
 * @param {string} slug
 */
function normalizeSourceRef(source, slug) {
	if (!source || typeof source !== 'object' || !slug) return
	const t = String(source.type || 'media').toLowerCase()
	if (t === 'template' || t === 'html' || t === 'timeline' || t === 'effect' || t === 'live') return
	const value = String(source.value || '').trim()
	if (!value || /^(https?|rtsp|rtmp|srt|udp|ndi|alsa|decklink|route):/i.test(value)) return
	source.value = normalizeMediaIdForProject(value, slug)
}

/**
 * @param {object} project
 * @param {object} [config]
 * @param {import('../utils/persistence')} [store]
 * @returns {object}
 */
function normalizeProjectMediaRefs(project, config, store) {
	if (!project || typeof project !== 'object') return project
	if (!isProjectScopedMediaEnabled(config)) return project
	const slug = getActiveProjectSlug(store, project)
	if (!slug) return project

	const next = JSON.parse(JSON.stringify(project))
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
			normalizeSourceRef(layer.source, slug)
			for (const item of layer.playlist || []) normalizeSourceRef(item, slug)
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
			for (const clip of layer?.clips || []) normalizeSourceRef(clip?.source, slug)
		}
	}

	return next
}

/**
 * @param {object} config
 * @param {import('../utils/persistence')} [store]
 * @param {object} [project]
 * @returns {Array<{ path: string, size: number, mtime: number }>}
 */
function buildProjectMediaManifest(config, store, project) {
	const mediaBase = getMediaIngestBasePath(config)
	if (!mediaBase || !fs.existsSync(mediaBase)) return []

	const slug = getActiveProjectSlug(store, project)
	const seen = new Set()
	/** @type {Array<{ path: string, size: number, mtime: number }>} */
	const manifest = []

	function addRel(relPath) {
		const rel = normalizeMediaIdKey(relPath).replace(/^\/+/, '')
		if (!rel || rel.includes('..') || seen.has(rel)) return
		const full = path.join(mediaBase, rel)
		try {
			if (!fs.existsSync(full)) return
			const stat = fs.statSync(full)
			if (!stat.isFile()) return
			seen.add(rel)
			manifest.push({ path: rel, size: stat.size, mtime: stat.mtimeMs })
		} catch {
			/* ignore */
		}
	}

	if (isProjectScopedMediaEnabled(config) && slug) {
		const proj = project && typeof project === 'object' ? project : null
		if (proj) {
			const refs = collectProjectAssetRefs(proj)
			let resolveMediaFileOnDisk
			try {
				resolveMediaFileOnDisk = require('./local-media-paths').resolveMediaFileOnDisk
			} catch {
				resolveMediaFileOnDisk = null
			}
			for (const ref of refs.media) {
				if (resolveMediaFileOnDisk) {
					const abs = resolveMediaFileOnDisk(config, ref)
					if (abs && abs.startsWith(mediaBase)) {
						addRel(path.relative(mediaBase, abs))
						continue
					}
				}
				addRel(expandMediaIdToMediaRoot(ref, slug))
				addRel(ref)
			}
		}

		const projectDir = path.join(mediaBase, PROJECTS_NAMESPACE, slug)
		if (fs.existsSync(projectDir)) {
			/** @param {string} relDir */
			function walk(relDir) {
				const full = path.join(projectDir, relDir)
				let entries
				try {
					entries = fs.readdirSync(full, { withFileTypes: true })
				} catch {
					return
				}
				for (const ent of entries) {
					if (ent.name.startsWith('.')) continue
					const rel = relDir ? `${relDir}/${ent.name}` : ent.name
					if (ent.isDirectory()) walk(rel)
					else addRel(`${PROJECTS_NAMESPACE}/${slug}/${rel}`)
				}
			}
			walk('')
		}
		return manifest.sort((a, b) => a.path.localeCompare(b.path))
	}

	const { scanMediaRecursiveForBrowser } = require('./local-media-paths')
	for (const entry of scanMediaRecursiveForBrowser(mediaBase, 20000)) {
		if (entry.isDir) continue
		addRel(entry.id)
	}
	return manifest.sort((a, b) => a.path.localeCompare(b.path))
}

module.exports = {
	PROJECTS_NAMESPACE,
	isProjectScopedMediaEnabled,
	getActiveProjectSlug,
	getProjectMediaRelId,
	getProjectMediaRoot,
	getDefaultIngestSubdir,
	getIngestEffectiveBase,
	ensureProjectMediaDir,
	normalizeMediaIdForProject,
	expandMediaIdToMediaRoot,
	getProjectMediaResolveCandidates,
	normalizeProjectMediaRefs,
	buildProjectMediaManifest,
}
