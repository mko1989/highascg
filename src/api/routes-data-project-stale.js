'use strict'

/**
 * WO-919 N2 (owner decision 01.11.26: write it) — a stale client's last edit goes into ITS show's file.
 *
 * Client A edits show X; another client (or an API Load) opens show Y; A's last autosave of X arrives after the switch.
 * `previousSlugKind` calls that `stale_client` and the autosave answers 409 `not_active` (A adopts Y) — but the edit
 * itself used to be dropped, so loading X later brought back e.g. a destination A had removed. Now, when the payload is
 * X itself (payload slug === editingSlug, not a rename), it is written into X's stored file:
 *  - the same guards as a normal autosave (`validateIncomingProject`: a newer stored rev wins, no empty-over-looks, no
 *    unrelated look set) plus a server-issued `rev` is required — a stale write never wins on a client clock;
 *  - only an existing, not retired show (never creates or resurrects a file);
 *  - the client's RAW payload, never the live-deck-enriched copy (the live deck is Y's now);
 *  - X's hardwareConfig per `stampStaleShowHardware` (live rig only while it provably still is X's);
 *  - written without activating it (`persistProject(..., { activate: false })`): X's file, its _autosave copy and its
 *    bridge / stick copies — no active slug, no web_project mirror, no deck, no project_sync broadcast, no replication
 *    push (the WO-79 peer push sends the ACTIVE slug and the follower adopts it as its live show), no Art-Net reconfigure.
 * A stale RENAME (payload slug ≠ editingSlug) stays refused and unsaved: renaming a show nobody has open is not an edit.
 * A hardware-applying switch first saves X's live rig into X (project-switch-stamp.js), which bumps X's rev; a stale
 * autosave at exactly the rev that stamp started from is rebased onto it (`switchStampRebase`) and keeps the stamped slice.
 */

const projectStore = require('../engine/project-store')
const { validateIncomingProject, persistProject, projectRevOf } = require('../engine/project-scenes')
const { preserveClientOwnedSlices } = require('../engine/project-client-slices')
const { stampStaleShowHardware } = require('../engine/project-hardware-hold')
const { switchStampRebase } = require('../engine/project-switch-stamp')

/**
 * @param {object} ctx
 * @param {object} payload the client's project as posted (not the deck-enriched copy)
 * @param {{ slug: string, editingSlug?: string, activeSlug: string }} o
 * @returns {Promise<{ savedTo: string, rev: number|null, changed: boolean, hardware: string, error: string }
 *   | { savedTo: null, notSaved: string }>}
 */
async function saveStaleClientEdit(ctx, payload, o) {
	const { slug, editingSlug, activeSlug } = o
	const info = (m) => typeof ctx?.log === 'function' && ctx.log('info', m)
	const skip = (why, detail) => {
		info(`[project] stale client's last edit of "${editingSlug || slug}" NOT saved (${why}${detail ? `: ${detail}` : ''}) — active "${activeSlug}" untouched`)
		return { savedTo: null, notSaved: why }
	}
	if (!editingSlug || slug !== editingSlug) return skip('rename', `saved as "${slug}"`)
	const existing = projectStore.readProjectFile(slug)
	if (!existing) return skip('no_stored_show')
	const project = JSON.parse(JSON.stringify(payload))
	if (projectRevOf(project) == null) return skip('no_rev')
	const hardware = stampStaleShowHardware(ctx, project, { slug, activeSlug, existing })
	// the switch's own stamp of the live rig (project-switch-stamp.js) is the only write since the client's rev: rebase
	const rebased = switchStampRebase(slug, projectRevOf(project), projectRevOf(existing))
	if (rebased != null) project.rev = rebased
	preserveClientOwnedSlices(project, existing) // WO-614 / WO-807, as on every autosave
	const check = validateIncomingProject(project, existing)
	if (!check.ok) {
		const d = check.details || {}
		return skip(check.reason, check.reason === 'stale_rev' ? `incoming rev ${d.incomingRev} < stored rev ${d.storedRev}` : '')
	}
	let result
	try {
		result = await persistProject(ctx, project, { writeAutosave: true, activate: false })
	} catch (e) {
		return skip('write_failed', e?.message || String(e))
	}
	const changed = result.unchanged !== true
	info(
		`[project] stale client's last edit of "${slug}" ${changed ? `saved into its file (rev ${result.rev}, hardware ${hardware}${rebased != null ? ', over the switch stamp' : ''})` : 'matched its file (nothing written)'} — active "${activeSlug}" untouched`,
	)
	return {
		savedTo: slug,
		rev: result.rev,
		changed,
		hardware,
		error: `The server switched to another show ("${activeSlug}") — this client's last edit was saved into "${slug}"`,
	}
}

module.exports = { saveStaleClientEdit }
