'use strict'

const projectStore = require('../engine/project-store')

/**
 * Move slug to trash and notify replication peers (WO-106).
 * @param {object} ctx
 * @param {string} slug
 * @param {{ reason?: string, replacementSlug?: string | null }} [opts]
 */
function retireSlugWithReplication(ctx, slug, opts = {}) {
	const s = String(slug || '').trim()
	if (!s) return false
	const moved = projectStore.retireProjectSlug(s)
	try {
		const { notifyProjectSlugRetired } = require('../replication/project-tombstone')
		notifyProjectSlugRetired(ctx, { slug: s, reason: opts.reason || 'delete', replacementSlug: opts.replacementSlug })
	} catch {
		/* replication optional */
	}
	return moved
}

module.exports = {
	retireSlugWithReplication,
}
