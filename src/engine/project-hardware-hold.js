'use strict'

/**
 * WO-821 — a project loaded WITHOUT applying its hardware keeps its stored `hardwareConfig`.
 *
 * Save and autosave stamp the live config into the project (`injectHardwareConfigToProject`). That is only
 * right when the live config IS the project's hardware. After `POST /api/project/load` without
 * `applyHardware`, the box keeps its own screens. The next autosave then wrote this box's rig over the show's
 * (frontex_big, 29.10, an autosave right after a node restart). So the load records a per-slug HOLD in the
 * persisted state (it must survive restarts), and while a slug is held every save/autosave writes the stored
 * slice back unchanged.
 *
 * Only an explicit hardware APPLY ends the hold: a load with `applyHardware: true`, `/api/project/apply-hardware`,
 * or a save with `captureHardware: true`. A plain save does not: Ctrl+S means "keep my looks", and the Godot
 * stick dialog saves automatically before copying the show to a stick (WO-821 "Decision").
 */

const persistence = require('../utils/persistence')
const projectStore = require('./project-store')
const { injectHardwareConfigToProject } = require('./project-hardware-config')

const HOLD_KEY = 'project_hardware_hold'

function holds() {
	const v = persistence.get(HOLD_KEY)
	return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

function isProjectHardwareHeld(slug) {
	return !!slug && Object.prototype.hasOwnProperty.call(holds(), slug)
}

function holdProjectHardware(slug, reason = 'load', ctx = null) {
	if (!slug || isProjectHardwareHeld(slug)) return
	persistence.set(HOLD_KEY, { ...holds(), [slug]: { since: new Date().toISOString(), reason } })
	if (typeof ctx?.log === 'function') {
		ctx.log('info', `[project] "${slug}" loaded without its hardware: saves keep its stored hardwareConfig until the hardware is applied (WO-821)`)
	}
}

function releaseProjectHardware(slug) {
	if (!isProjectHardwareHeld(slug)) return false
	const next = { ...holds() }
	delete next[slug]
	persistence.set(HOLD_KEY, Object.keys(next).length ? next : null)
	return true
}

/**
 * Set `project.hardwareConfig` for a save/autosave about to be written to `slug`.
 * @param {object} ctx
 * @param {object} project incoming payload (mutated)
 * @param {{ slug: string, prevSlug?: string|null, existing?: object|null, autosave?: boolean, capture?: boolean, keepPayload?: boolean }} o
 *   `keepPayload` (WO-823, import / load-from-file only): the payload's own `hardwareConfig` is written as given.
 *   It beats the hold and the live stamp, because the payload IS the show being brought in, not this box.
 * @returns {'held' | 'live' | 'payload'}
 */
function stampProjectHardware(ctx, project, o) {
	const { slug, prevSlug, existing } = o
	if (o.keepPayload === true && o.capture !== true) {
		if (typeof ctx?.log === 'function') {
			ctx.log('info', `[project] save kept the file's own hardwareConfig for "${slug}" (import, WO-823)`)
		}
		return 'payload'
	}
	if (o.capture === true) {
		releaseProjectHardware(slug)
		if (prevSlug) releaseProjectHardware(prevSlug)
	} else {
		let source = null
		if (existing && isProjectHardwareHeld(slug)) source = existing
		else if (!existing && prevSlug && prevSlug !== slug && isProjectHardwareHeld(prevSlug)) {
			source = projectStore.readProjectFile(prevSlug) // a rename of a held project: the hold moves with it
			if (source) holdProjectHardware(slug, 'rename')
		}
		if (source && typeof source === 'object') {
			if (source.hardwareConfig !== undefined) project.hardwareConfig = source.hardwareConfig
			else delete project.hardwareConfig
			if (typeof ctx?.log === 'function') {
				ctx.log(o.autosave ? 'debug' : 'info', `[project] ${o.autosave ? 'autosave' : 'save'} kept the stored hardwareConfig of "${slug}" (loaded without its hardware, WO-821)`)
			}
			return 'held'
		}
	}
	/* Not held (or nothing stored to protect): WO-311 rule — an autosave never stamps an empty live config. */
	injectHardwareConfigToProject(ctx, project, o.autosave ? { preserveWhenEmpty: true } : {})
	return 'live'
}

module.exports = {
	HOLD_KEY,
	isProjectHardwareHeld,
	holdProjectHardware,
	releaseProjectHardware,
	stampProjectHardware,
}
