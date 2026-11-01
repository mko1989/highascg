'use strict'

/**
 * WO-919 N2 — the outgoing show's final autosave of its rig, at the moment another show's hardware replaces it.
 *
 * Screen destinations and cables are edited in the LIVE config (/api/device-view) and reach the open show only when its
 * next save/autosave stamps the live rig into it (`stampProjectHardware`). A Devices edit fires no autosave, so a switch
 * that applies another show's hardware (Godot header Load, New project, a taken cluster show) used to throw away every
 * destination edit made since that show's last autosave — "loading that show later brings the removed destination
 * back". Call `stampOutgoingShowRig` BEFORE the new show's hardware is applied: it writes the live rig into the show
 * that is open now, with exactly the guards an autosave of that show would apply:
 *  - only a different slug than the incoming one, with a stored file (never creates / resurrects one);
 *  - not held (WO-821: a show loaded without its hardware keeps its stored slice — the live rig is not its own);
 *  - never an empty / factory rig (WO-311 / WO-882, `stampProjectHardware` autosave mode + operator intent);
 *  - only when the stamped `hardwareConfig` differs from the stored one (no rev bump for an unchanged rig);
 *  - written with `persistProject(..., { activate: false })`: rev bump, _autosave copy, volume copies, no activation.
 * One info line per stamp. A failure is logged and never blocks the switch.
 *
 * The stamp bumps the outgoing show's rev, so a stale client's last autosave of that show (WO-919 N2 stale path) would
 * read as `stale_rev`. `switchStampRebase` lets exactly that one through: the client's rev is the one the stamp
 * started from and nothing else wrote the show since — the stale write keeps the stamped slice (its hardware rule
 * keeps the stored slice after a hardware-applying switch), so nothing the stamp saved is lost.
 */

const persistence = require('../utils/persistence')
const projectStore = require('./project-store')
const { isProjectHardwareHeld, stampProjectHardware } = require('./project-hardware-hold')
const { hardwareConfigHasOperatorIntent } = require('./project-hardware-config')

const STAMP_KEY = 'project_switch_stamp'

/**
 * @param {object} ctx
 * @param {string} nextSlug the show about to replace the live rig (log text and the same-slug check)
 * @returns {null | { slug: string, rev: number }} what was written
 */
function stampOutgoingShowRig(ctx, nextSlug) {
	const store = ctx?.persistence || persistence
	const slug = projectStore.getActiveSlug(store)
	if (!slug || slug === nextSlug || isProjectHardwareHeld(slug)) return null
	try {
		const existing = projectStore.readProjectFile(slug)
		if (!existing) return null
		const { persistProject, canonicalJson, projectRevOf } = require('./project-scenes')
		const project = JSON.parse(JSON.stringify(existing))
		if (stampProjectHardware(ctx, project, { slug, existing, autosave: true }) !== 'live') return null
		if (!hardwareConfigHasOperatorIntent(project.hardwareConfig)) return null // WO-311: an empty rig is not an edit
		if (canonicalJson(project.hardwareConfig) === canonicalJson(existing.hardwareConfig)) return null
		const r = persistProject(ctx, project, { writeAutosave: true, activate: false })
		if (r.unchanged === true) return null
		persistence.set(STAMP_KEY, { slug, fromRev: projectRevOf(existing), rev: r.rev })
		ctx.log?.('info', `[project] "${slug}": live rig saved into it before switching to "${nextSlug}" (rev ${r.rev})`)
		return { slug, rev: r.rev }
	} catch (e) {
		ctx.log?.('warn', `[project] "${slug}": saving the live rig before the switch failed: ${e?.message || e}`)
		return null
	}
}

/**
 * The stored rev a stale autosave of `slug` at `incomingRev` may be written as: the switch stamp's rev when the stamp
 * is the only write since that rev, else null.
 * @param {string} slug
 * @param {number|null} incomingRev
 * @param {number|null} storedRev
 * @returns {number|null}
 */
function switchStampRebase(slug, incomingRev, storedRev) {
	const s = persistence.get(STAMP_KEY)
	if (!s || s.slug !== slug || incomingRev == null || s.fromRev !== incomingRev || s.rev !== storedRev) return null
	return s.rev
}

module.exports = { stampOutgoingShowRig, switchStampRebase }
