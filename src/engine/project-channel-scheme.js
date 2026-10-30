'use strict'

/**
 * WO-868 — a project's channel numbers belong to the channel scheme it was written in. While "Operator GUI first" is
 * on, project files carry `channelScheme: 'operator-first-v1'`; while it is off they carry no key (legacy, exactly as
 * before the switch existed). This module converts a project between the two with the role-identity remap
 * (src/config/channel-remap.js), computed from the project's OWN hardware slice when it has one (its route numbers
 * were made under that rig), else from the live config.
 *
 * project-store.js calls {@link adaptProjectOnRead} / {@link adaptProjectOnWrite} on every project / autosave file,
 * so a restored backup, a synced file or a project from another box is converted the first time it is touched. Both
 * are no-ops until the server registers its live config ({@link setChannelSchemeConfigSource}); offline tools and
 * tests that never register see the files unchanged.
 *
 * Read: a file without a stamp is legacy. Write: a payload without a stamp is in the CURRENT scheme — it came from a
 * client that loaded it through the read path (the web client rebuilds its save payload from a fixed key list and
 * drops the stamp); an import of a file from disk is marked legacy by the save route before it gets here.
 */

const { CHANNEL_SCHEME_FIRST, CHANNEL_SCHEME_LEGACY, channelSchemeFor, withOperatorGuiFirst } = require('../config/operator-gui-first')
const { buildChannelRemap, remapDeep, isIdentityRemap } = require('../config/channel-remap')

/** @type {(() => object | null) | null} */
let _configSource = null

/** @param {(() => object | null) | null} fn returns the live app config */
function setChannelSchemeConfigSource(fn) {
	_configSource = typeof fn === 'function' ? fn : null
}

function liveConfig() {
	try {
		return _configSource ? _configSource() : null
	} catch {
		return null
	}
}

/**
 * @param {object} project
 * @param {string} absent scheme assumed when the project carries no stamp
 */
function storedChannelScheme(project, absent = CHANNEL_SCHEME_LEGACY) {
	const s = project && typeof project === 'object' ? project.channelScheme : undefined
	if (s === CHANNEL_SCHEME_FIRST || s === CHANNEL_SCHEME_LEGACY) return s
	return absent
}

/**
 * The app config the project's route numbers were made under: the live config with the project's hardware slice
 * laid over it (same merge a load does, applyHardwareConfigToCtx), or the live config when the project has none.
 * @param {object} config live app config
 * @param {object} project
 */
function configForProject(config, project) {
	const hc = project?.hardwareConfig
	try {
		const phc = require('./project-hardware-config')
		if (!hc || typeof hc !== 'object' || !phc.hardwareConfigHasOperatorData(hc)) return config
		const { applySnapshotToConfigClone } = require('../config/device-snapshot')
		const next = { ...config, casparServer: { ...(config?.casparServer || {}) } }
		applySnapshotToConfigClone(next, { payload: phc.hardwareConfigToSnapshotPayload(hc) }, 'full')
		for (const k of phc.ROUTING_EXTRA_KEYS) if (hc[k] !== undefined) next[k] = hc[k]
		return next
	} catch {
		return config
	}
}

/**
 * old → new channel remap for one project between two schemes.
 * @param {object} config live app config
 * @param {object} project
 * @param {string} fromScheme
 * @param {string} toScheme
 * @returns {Map<number, number>}
 */
function projectChannelRemap(config, project, fromScheme, toScheme) {
	const { getChannelMap } = require('../config/routing')
	const base = configForProject(config || {}, project)
	const oldMap = getChannelMap(withOperatorGuiFirst(base, fromScheme === CHANNEL_SCHEME_FIRST))
	const newMap = getChannelMap(withOperatorGuiFirst(base, toScheme === CHANNEL_SCHEME_FIRST))
	return buildChannelRemap(oldMap, newMap)
}

/**
 * @param {object} project
 * @param {string} scheme
 * @returns {object} the same object when the stamp is already right, else a shallow copy
 */
function stampChannelScheme(project, scheme) {
	if (scheme === CHANNEL_SCHEME_FIRST) {
		return project.channelScheme === CHANNEL_SCHEME_FIRST ? project : { ...project, channelScheme: CHANNEL_SCHEME_FIRST }
	}
	if (!Object.prototype.hasOwnProperty.call(project, 'channelScheme')) return project
	const { channelScheme, ...rest } = project
	void channelScheme
	return rest
}

/**
 * Convert a project into `toScheme` (default: the scheme of `config`).
 * @param {object} project
 * @param {object} config live app config
 * @param {{ toScheme?: string, absent?: string }} [opts]
 * @returns {{ project: object, converted: boolean, count: number, from: string, to: string }}
 */
function convertProjectChannelScheme(project, config, opts = {}) {
	const to = opts.toScheme || channelSchemeFor(config)
	if (!project || typeof project !== 'object' || Array.isArray(project)) {
		return { project, converted: false, count: 0, from: to, to }
	}
	const from = storedChannelScheme(project, opts.absent || CHANNEL_SCHEME_LEGACY)
	if (from === to) return { project: stampChannelScheme(project, to), converted: false, count: 0, from, to }
	const remap = projectChannelRemap(config, project, from, to)
	if (isIdentityRemap(remap)) return { project: stampChannelScheme(project, to), converted: false, count: 0, from, to }
	const stats = { count: 0 }
	const next = remapDeep(project, remap, stats)
	if (!stats.count) return { project: stampChannelScheme(project, to), converted: false, count: 0, from, to }
	return { project: stampChannelScheme(next, to), converted: true, count: stats.count, from, to }
}

function logConverted(r, where) {
	if (!r.converted) return
	console.warn(`[project] WO-868 channel scheme ${r.from} → ${r.to} on ${where}: ${r.count} channel reference(s) renumbered`)
}

/** project-store read hook: an unstamped file is legacy. */
function adaptProjectOnRead(project) {
	const cfg = liveConfig()
	if (!cfg || !project || typeof project !== 'object') return project
	try {
		const r = convertProjectChannelScheme(project, cfg, { absent: CHANNEL_SCHEME_LEGACY })
		logConverted(r, `read of ${project.slug || project.name || 'project'}`)
		return r.project
	} catch {
		return project
	}
}

/** project-store write hook: an unstamped payload is in the current scheme. */
function adaptProjectOnWrite(project) {
	const cfg = liveConfig()
	if (!cfg || !project || typeof project !== 'object') return project
	try {
		const r = convertProjectChannelScheme(project, cfg, { absent: channelSchemeFor(cfg) })
		logConverted(r, `write of ${project.slug || project.name || 'project'}`)
		return r.project
	} catch {
		return project
	}
}

module.exports = {
	setChannelSchemeConfigSource,
	projectChannelRemap,
	convertProjectChannelScheme,
	adaptProjectOnRead,
	adaptProjectOnWrite,
}
