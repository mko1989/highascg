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

/**
 * WO-824: what a save/autosave under a new name means for the previously active slug. Only a RENAME of that project
 * may retire it (and carry its WO-821 hardware hold). Bringing another show in must not: Godot Load from file sends
 * `imported`; the web import autosaves the file under its own name, and a payload whose looks share nothing with the
 * stored previous project is a different show (same heuristic as the stale-replace guard).
 * Call before persisting: the previous project is read from disk.
 * @param {string | null} prevSlug
 * @param {string} slug
 * @param {object} payload the client's project (not the deck-enriched copy)
 * @param {{ imported?: boolean }} [opts]
 * @returns {null | 'rename' | 'imported' | 'other_show'} null when the name did not change
 */
function previousSlugKind(prevSlug, slug, payload, opts = {}) {
	if (!prevSlug || prevSlug === slug) return null
	if (opts.imported === true) return 'imported'
	const { isLikelyStaleProjectReplace } = require('../engine/project-scenes')
	const prev = projectStore.readProjectFile(prevSlug)
	return prev && isLikelyStaleProjectReplace(payload, prev) ? 'other_show' : 'rename'
}

/**
 * Retire the previously active slug when `kind` (from previousSlugKind) says the save was a rename of it.
 * @param {object} ctx
 * @param {string | null} prevSlug
 * @param {string} slug
 * @param {null | 'rename' | 'imported' | 'other_show'} kind
 * @returns {boolean} true when prevSlug was retired
 */
function retireRenamedSlug(ctx, prevSlug, slug, kind) {
	if (!kind) return false
	const log = (m) => typeof ctx?.log === 'function' && ctx.log('info', m)
	if (kind === 'imported') {
		log(`[project] "${slug}" imported: the previous project "${prevSlug}" stays in the list`)
		return false
	}
	if (kind === 'other_show') {
		log(`[project] "${slug}" shares no looks with "${prevSlug}": another show, not a rename — "${prevSlug}" kept`)
		return false
	}
	try {
		return retireSlugWithReplication(ctx, prevSlug, { reason: 'rename', replacementSlug: slug })
	} catch (e) {
		if (typeof ctx?.log === 'function') ctx.log('warn', `[project] retire previous slug ${prevSlug}: ${e?.message || e}`)
		return false
	}
}

module.exports = {
	retireSlugWithReplication,
	previousSlugKind,
	retireRenamedSlug,
}
