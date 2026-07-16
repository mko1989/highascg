'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')
const persistence = require('../utils/persistence')
const { loadFullProject, loadProjectForSlug } = require('../engine/project-scenes')
const projectStore = require('../engine/project-store')
const { maskProjectStreamCredentials } = require('../engine/project-stream-credentials')
const { getProjectMediaRelId, getProjectMediaRoot } = require('../media/project-media-root')
const { retireSlugWithReplication } = require('./routes-data-project-slug')

async function loadProjectMerged(_ctx) {
	return loadFullProject()
}

async function handleProjectList(ctx) {
	projectStore.migrateLegacySingleProject(persistence)
	const projects = projectStore.listProjectFiles()
	const activeSlug = projectStore.getActiveSlug(persistence)
	const { getProjectRoots, isVolumeMountedSync } = require('../engine/project-volume-sync')
	const roots = getProjectRoots()
	const activeProjectMedia =
		activeSlug && ctx.config
			? {
					relId: getProjectMediaRelId(activeSlug, ctx.config),
					absPath: getProjectMediaRoot(ctx.config, persistence, activeSlug),
				}
			: null
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			activeSlug: activeSlug || null,
			activeProjectMedia,
			projects: projects.map((p) => ({
				...p,
				active: p.slug === activeSlug,
				mediaFolder: p.slug ? getProjectMediaRelId(p.slug, ctx.config) : null,
			})),
			volumes: {
				usb: {
					mount: roots.usb,
					mounted: !!(roots.usb && isVolumeMountedSync(roots.usb)),
				},
				bridge: {
					mount: roots.bridge,
					mounted: !!(roots.bridge && isVolumeMountedSync(roots.bridge)),
				},
			},
		}),
	}
}

async function handleProjectGet(ctx) {
	const project = await loadProjectMerged(ctx)
	if (!project) {
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({}) }
	}
	// WO-261: never emit raw stream keys to clients.
	return { status: 200, headers: JSON_HEADERS, body: jsonBody(maskProjectStreamCredentials(project)) }
}

/** GET /api/project/file/:slug and …/download — read JSON without activating slug. */
async function handleProjectFile(path) {
	const m = path.match(/^\/api\/project\/file\/([^/]+)(\/download)?$/)
	if (!m) return null
	const slug = decodeURIComponent(m[1]).trim()
	if (!slug) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Missing project slug' }) }
	}
	projectStore.migrateLegacySingleProject(persistence)
	const project = projectStore.readProjectFile(slug)
	if (!project) {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Project file not found' }) }
	}
	// WO-261: browser-bound project JSON (view + download) carries masked keys only; the canonical
	// key transport is USB/replication (server-side), never the browser.
	const body = jsonBody(maskProjectStreamCredentials(project))
	if (m[2]) {
		return {
			status: 200,
			headers: {
				...JSON_HEADERS,
				'Content-Disposition': `attachment; filename="${slug}.json"`,
			},
			body,
		}
	}
	return { status: 200, headers: JSON_HEADERS, body }
}

async function handleProjectDelete(ctx, path) {
	const m = path.match(/^\/api\/project\/([^/]+)$/)
	if (!m) return null
	const slug = decodeURIComponent(m[1]).trim()
	if (!slug || slug === 'list' || slug === 'file' || slug === 'save' || slug === 'load') {
		return null
	}
	projectStore.migrateLegacySingleProject(persistence)
	const existing = projectStore.readProjectFile(slug)
	if (!existing) {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Project not found' }) }
	}
	const activeSlug = projectStore.getActiveSlug(persistence)
	if (activeSlug === slug) {
		return {
			status: 409,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'Cannot delete the active project — load another project first' }),
		}
	}
	const moved = retireSlugWithReplication(ctx, slug, { reason: 'delete' })
	if (!moved) {
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: 'Failed to move project to trash' }) }
	}
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, slug, trashed: true }) }
}

module.exports = {
	loadProjectMerged,
	handleProjectList,
	handleProjectGet,
	handleProjectFile,
	handleProjectDelete,
}
