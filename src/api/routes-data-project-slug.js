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
		// WO-918 F14/F15: the bridge / stick copies too, or the Load list keeps a ghost and the exFAT sync revives it
		const log = typeof ctx?.log === 'function' ? ctx.log.bind(ctx) : undefined
		require('../engine/project-volume-sync').retireProjectSlugOnVolumes(s, { log })
	} catch (e) {
		if (typeof ctx?.log === 'function') ctx.log('warn', `[project] retire ${s} on volumes: ${e?.message || e}`)
	}
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
 *
 * WO-918 F27/F28: guessing from the looks alone trashed shows — an EMPTY payload shares nothing, so
 * isLikelyStaleProjectReplace said "not stale" and any empty autosave under another name retired the open show.
 * The Godot client now says which slug it is editing (`editingSlug`): a rename is exactly "editing the active
 * slug, saving under another name"; editing any other slug means the server switched shows under this client
 * (`stale_client`, refused — the client adopts the active show). Without `editingSlug` (web client) a rename needs
 * positive evidence: shared looks.
 * @param {object} payload the client's project (not the deck-enriched copy)
 * @param {{ imported?: boolean, editingSlug?: string }} [opts]
 * @returns {null | 'rename' | 'imported' | 'other_show' | 'stale_client'} null when the name did not change
 */
function previousSlugKind(prevSlug, slug, payload, opts = {}) {
	if (!prevSlug || prevSlug === slug) return null
	if (opts.imported === true) return 'imported'
	if (opts.editingSlug) return opts.editingSlug === prevSlug ? 'rename' : 'stale_client'
	const { isLikelyStaleProjectReplace, sceneIdSet } = require('../engine/project-scenes')
	const prev = projectStore.readProjectFile(prevSlug)
	if (!prev) return 'rename'
	const prevIds = sceneIdSet(prev)
	const shared = [...sceneIdSet(payload)].some((id) => prevIds.has(id))
	return shared && !isLikelyStaleProjectReplace(payload, prev) ? 'rename' : 'other_show'
}

/**
 * WO-918: the save/autosave a slug decision forbids, as a 409 body — or null.
 * `stale_client`: this client still edits a show the server no longer has open (another client / an API load switched
 * it) — writing would fork or clobber; the client re-pulls the active show. `rename` onto a name another stored show
 * already has would overwrite that show (F10: a fresh Untitled renamed onto the previous show's name).
 * @param {null | string} kind from previousSlugKind
 * @param {null | string} prevSlug the server's active slug
 * @param {string} slug the payload's target slug
 * @param {object | null} existing the stored project under `slug`
 * @returns {null | { reason: string, error: string, activeSlug: string | null }}
 */
function slugConflict(kind, prevSlug, slug, existing) {
	if (kind === 'stale_client') {
		return {
			reason: 'not_active',
			error: `The server switched to another show ("${prevSlug}") — this client's show was not saved`,
			activeSlug: prevSlug,
		}
	}
	if (kind === 'rename' && existing) {
		return { reason: 'name_taken', error: `A project named "${existing.name || slug}" already exists`, activeSlug: prevSlug }
	}
	return null
}

/**
 * Retire the previously active slug when `kind` (from previousSlugKind) says the save was a rename of it.
 * @param {object} ctx
 * @param {string | null} prevSlug
 * @param {string} slug
 * @param {null | 'rename' | 'imported' | 'other_show'} kind
 * @param {object} [project] the renamed project: its media folder follows the rename (WO-919 N5)
 * @returns {boolean} true when prevSlug was retired
 */
function retireRenamedSlug(ctx, prevSlug, slug, kind, project) {
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
	if (kind !== 'rename') return false
	try {
		const moved = retireSlugWithReplication(ctx, prevSlug, { reason: 'rename', replacementSlug: slug })
		log(`[project] renamed "${prevSlug}" → "${slug}": "${prevSlug}" moved to projects/_trash`) // WO-918: never silent
		require('../media/project-media-rename').moveProjectMediaOnRename(ctx, prevSlug, slug, project) // WO-919 N5: never throws
		return moved
	} catch (e) {
		if (typeof ctx?.log === 'function') ctx.log('warn', `[project] retire previous slug ${prevSlug}: ${e?.message || e}`)
		return false
	}
}

/** WO-918: the slug the (Godot) client says it is editing; absent for the web client. */
function editingSlugOf(b) {
	return typeof b?.editingSlug === 'string' && b.editingSlug.trim() ? b.editingSlug.trim() : undefined
}

/**
 * WO-918 F23: Load from file of an OLDER copy of a stored show, and the operator chose "Replace". A copy of the stored
 * show goes to the trash; the file's content then wins with the stored rev (the rev check would refuse the file).
 * @param {object} project the file's project (mutated: rev, savedAt)
 * @returns {string | null} the trash directory name of the backup
 */
function replaceFromFile(ctx, project, existing, slug) {
	if (!existing) return null
	const backup = projectStore.backupProjectToTrash(slug)
	project.rev = existing.rev
	project.savedAt = new Date().toISOString()
	if (typeof ctx?.log === 'function') {
		ctx.log('info', `[project] "${slug}" replaced from a file — previous version kept in projects/_trash/${backup}`)
	}
	return backup
}

module.exports = {
	retireSlugWithReplication,
	previousSlugKind,
	retireRenamedSlug,
	slugConflict,
	editingSlugOf,
	replaceFromFile,
}
