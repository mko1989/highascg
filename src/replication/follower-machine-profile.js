'use strict'

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')
const { getReplicationConfig } = require('../config/replication-config')
const {
	buildHardwareConfigFromCtx,
	applyHardwareConfigToCtx,
} = require('../engine/project-hardware-config')
const {
	DEVICE_HARDWARE_SLICES,
	SHOW_ROUTING_HARDWARE_SLICES,
	FOLLOWER_LOCAL_PROJECT_SLICES,
} = require('../config/config-classify')

const LOCAL_PROFILE_PATH = path.join(REPO_ROOT, 'config', 'replication-local-machine.json')

function isFollowerRole(ctx) {
	try {
		const rt = ctx?._replication
		if (rt?.roleState?.getRole() === 'follower') return true
	} catch {
		/* ignore */
	}
	const repl = getReplicationConfig(ctx?.config || {})
	return repl.enabled && repl.role === 'follower'
}

/**
 * @param {object|null|undefined} hc
 * @returns {object}
 */
function pickLocalSlices(hc) {
	if (!hc || typeof hc !== 'object') return { version: 2 }
	const out = { version: hc.version || 2 }
	for (const key of FOLLOWER_LOCAL_PROJECT_SLICES) {
		if (hc[key] !== undefined) out[key] = hc[key]
	}
	return out
}

/**
 * @param {object} ctx
 * @returns {object|null}
 */
function buildMachineProfileFromCtx(ctx) {
	const full = buildHardwareConfigFromCtx(ctx)
	return full ? pickLocalSlices(full) : null
}

/**
 * @param {object} ctx
 * @returns {object|null}
 */
function loadLocalMachineProfile() {
	try {
		if (!fs.existsSync(LOCAL_PROFILE_PATH)) return null
		const raw = JSON.parse(fs.readFileSync(LOCAL_PROFILE_PATH, 'utf8'))
		return raw && typeof raw === 'object' ? pickLocalSlices(raw) : null
	} catch {
		return null
	}
}

/**
 * @param {object} profile
 */
function saveLocalMachineProfile(profile) {
	if (!profile || typeof profile !== 'object') return
	fs.mkdirSync(path.dirname(LOCAL_PROFILE_PATH), { recursive: true })
	fs.writeFileSync(LOCAL_PROFILE_PATH, JSON.stringify(pickLocalSlices(profile), null, 2), 'utf8')
}

/**
 * Persist follower's Device View / routing as the source of truth for Caspar generation.
 * @param {object} ctx
 * @param {Record<string, unknown>} [patch]
 */
function onDeviceConfigSaved(ctx, patch = {}) {
	if (!isFollowerRole(ctx)) return
	const touchesMachine =
		DEVICE_HARDWARE_SLICES.some((k) => patch[k] !== undefined) ||
		SHOW_ROUTING_HARDWARE_SLICES.some((k) => patch[k] !== undefined) ||
		patch.deviceGraph !== undefined ||
		patch.casparServer !== undefined
	if (!touchesMachine) return
	const snap = buildMachineProfileFromCtx(ctx)
	if (snap) saveLocalMachineProfile(snap)
}

/**
 * @param {object|null} existing
 * @param {object} local
 * @returns {object}
 */
function mergeLocalHardwareIntoProject(existing, local) {
	const base = existing && typeof existing === 'object' ? { ...existing } : {}
	const hc = base.hardwareConfig && typeof base.hardwareConfig === 'object' ? { ...base.hardwareConfig } : { version: 2 }
	for (const key of FOLLOWER_LOCAL_PROJECT_SLICES) {
		if (local[key] !== undefined) hc[key] = local[key]
	}
	base.hardwareConfig = hc
	return base
}

/**
 * Before merging leader show data, ensure project carries this box's machine profile.
 * @param {object} ctx
 * @param {object|null} existing
 * @returns {object|null}
 */
function seedProjectHardwareFromLocalProfile(ctx, existing) {
	const local = loadLocalMachineProfile() || buildMachineProfileFromCtx(ctx)
	if (!local) return existing
	return mergeLocalHardwareIntoProject(existing, local)
}

/**
 * Push local machine profile into live server config (modular JSON + ctx.config).
 * @param {object} ctx
 * @param {object} [hardwareConfig]
 * @returns {boolean}
 */
function applyLocalMachineProfileToConfig(ctx, hardwareConfig) {
	const local =
		(hardwareConfig && typeof hardwareConfig === 'object' ? pickLocalSlices(hardwareConfig) : null) ||
		loadLocalMachineProfile() ||
		buildMachineProfileFromCtx(ctx)
	if (!local) return false

	const deviceOnly = { version: local.version || 2 }
	for (const slice of DEVICE_HARDWARE_SLICES) {
		if (local[slice] !== undefined) deviceOnly[slice] = local[slice]
	}
	applyHardwareConfigToCtx(ctx, deviceOnly)

	if (ctx?.configManager) {
		const next = { ...ctx.configManager.get() }
		let changed = false
		for (const key of SHOW_ROUTING_HARDWARE_SLICES) {
			if (local[key] !== undefined) {
				next[key] = local[key]
				changed = true
			}
		}
		if (changed) {
			ctx.configManager.save(next)
			if (ctx.config) Object.assign(ctx.config, ctx.configManager.get())
		}
	} else if (ctx?.config) {
		for (const key of SHOW_ROUTING_HARDWARE_SLICES) {
			if (local[key] !== undefined) ctx.config[key] = local[key]
		}
	}

	return true
}

/**
 * Follower: regenerate casparcg.config from local Device View after show sync.
 * @param {object} ctx
 */
async function regenerateFollowerCasparFromDeviceView(ctx) {
	if (!isFollowerRole(ctx)) return { ok: false, skipped: true }
	const { applyCasparConfigToDiskAndRestart } = require('../api/routes-caspar-config')
	const res = await applyCasparConfigToDiskAndRestart(ctx)
	let body = {}
	try {
		body = JSON.parse(String(res.body || '{}'))
	} catch {
		body = {}
	}
	return { ok: res.status < 300 && body.ok !== false, body }
}

module.exports = {
	LOCAL_PROFILE_PATH,
	isFollowerRole,
	loadLocalMachineProfile,
	saveLocalMachineProfile,
	buildMachineProfileFromCtx,
	pickLocalSlices,
	onDeviceConfigSaved,
	seedProjectHardwareFromLocalProfile,
	mergeLocalHardwareIntoProject,
	applyLocalMachineProfileToConfig,
	regenerateFollowerCasparFromDeviceView,
}
