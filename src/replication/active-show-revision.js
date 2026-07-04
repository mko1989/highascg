'use strict'

const crypto = require('crypto')
const { stripDeviceLocalFromProject } = require('../config/config-classify')
const projectStore = require('../engine/project-store')

/**
 * Stable hash of the show slice (device-local keys stripped) for replication ping/compare.
 * @param {object|null|undefined} project
 * @returns {{ revision: string|null, savedAt: string|null, slug: string|null }}
 */
function computeActiveShowRevision(project) {
	if (!project || typeof project !== 'object') {
		return { revision: null, savedAt: null, slug: null }
	}
	const stripped = stripDeviceLocalFromProject(project)
	let revision = null
	try {
		revision = crypto.createHash('sha256').update(JSON.stringify(stripped)).digest('hex').slice(0, 12)
	} catch {
		revision = null
	}
	const savedAt =
		typeof stripped.savedAt === 'string' && stripped.savedAt
			? stripped.savedAt
			: typeof project.savedAt === 'string' && project.savedAt
				? project.savedAt
				: null
	const slug =
		typeof project.slug === 'string' && project.slug
			? project.slug
			: typeof project.name === 'string' && project.name
				? projectStore.projectSlugFromName(project.name)
				: null
	return { revision, savedAt, slug }
}

/**
 * Leader ping fields for WO-79 show sync fallback.
 * @param {object} ctx
 * @returns {Promise<{ activeShowSlug: string|null, activeShowRevision: string|null, activeShowSavedAt: string|null }>}
 */
async function getLeaderActiveShowPingFields(ctx) {
	try {
		const { loadFullProject } = require('../engine/project-scenes')
		const persistence = ctx.persistence || require('../utils/persistence')
		const slug = projectStore.getActiveSlug(persistence)
		const project = await loadFullProject()
		const { revision, savedAt, slug: fromProject } = computeActiveShowRevision(project)
		return {
			activeShowSlug: slug || fromProject || null,
			activeShowRevision: revision,
			activeShowSavedAt: savedAt,
		}
	} catch {
		return { activeShowSlug: null, activeShowRevision: null, activeShowSavedAt: null }
	}
}

module.exports = {
	computeActiveShowRevision,
	getLeaderActiveShowPingFields,
}
