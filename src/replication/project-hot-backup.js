'use strict'

const os = require('os')
const { getReplicationConfig } = require('../config/replication-config')
const { getHardwareIdentity } = require('../system/hardware-identity')

/**
 * @param {object} [ctx]
 * @param {{ host?: string, hardwareId?: string, hostname?: string }} [overrides]
 */
function buildLocalHotBackupBox(ctx, overrides = {}) {
	let hardwareId = String(overrides.hardwareId || '').trim()
	let hostname = String(overrides.hostname || '').trim()
	try {
		const hw = getHardwareIdentity({ networkCfg: ctx?.config?.network })
		if (!hardwareId) hardwareId = hw.hardwareId
		if (!hostname) hostname = hw.hostname
	} catch {
		/* optional */
	}
	const host = String(overrides.host || '').trim() || os.hostname()
	return {
		hardwareId: hardwareId || null,
		hostname: hostname || os.hostname(),
		host,
	}
}

/**
 * @param {object} [ctx]
 * @param {'leader'|'follower'} role
 * @param {{ pairId: string, peer: { hardwareId?: string, hostname?: string, host: string } }} opts
 */
function buildHotBackupMetadata(ctx, role, opts) {
	const pairId = String(opts?.pairId || '').trim()
	const peer = opts?.peer || {}
	return {
		pairId,
		role,
		self: buildLocalHotBackupBox(ctx),
		peer: {
			hardwareId: peer.hardwareId ? String(peer.hardwareId).trim() : null,
			hostname: String(peer.hostname || peer.selfId || '').trim() || null,
			host: String(peer.host || '').trim(),
		},
		pairedAt: new Date().toISOString(),
	}
}

/**
 * @param {object|null|undefined} hotBackup
 * @param {'leader'|'follower'|'standalone'|string} viewerRole
 * @returns {{ hardwareId: string|null, hostname: string|null, host: string }|null}
 */
function hotBackupPeerBoxForViewer(hotBackup, viewerRole) {
	if (!hotBackup || typeof hotBackup !== 'object') return null
	const role = String(hotBackup.role || '')
	const viewer = String(viewerRole || '')
	if (role && viewer && role === viewer) return hotBackup.peer || null
	return hotBackup.self || hotBackup.peer || null
}

/**
 * @param {object|null|undefined} hotBackup
 * @param {'leader'|'follower'|'standalone'|string} [viewerRole]
 * @returns {string|null}
 */
function hotBackupPeerLabel(hotBackup, viewerRole) {
	const peer = hotBackupPeerBoxForViewer(hotBackup, viewerRole || hotBackup?.role || '')
	if (!peer) return null
	return (
		String(peer.hostname || '').trim() ||
		(peer.hardwareId ? `highascg${String(peer.hardwareId).padStart(4, '0')}` : '') ||
		String(peer.host || '').trim() ||
		null
	)
}

/**
 * @param {object} ctx
 * @param {object|null} hotBackup
 */
async function writeProjectHotBackup(ctx, hotBackup) {
	const { loadFullProject, persistProject } = require('../engine/project-scenes')
	const project = loadFullProject()
	if (!project) return { ok: false, error: 'no active project' }
	const next = { ...project, hotBackup: hotBackup || null }
	const ok = persistProject(ctx, next, { writeAutosave: true, pushVolumes: false })
	return ok ? { ok: true, hotBackup: next.hotBackup } : { ok: false, error: 'persist failed' }
}

/**
 * @param {object} ctx
 * @param {'leader'|'follower'} role
 * @param {{ pairId: string, peer: object, peerHardwareId?: string, peerHostname?: string, peerHost?: string }} opts
 */
async function applyHotBackupToActiveProject(ctx, role, opts) {
	const peer = {
		hardwareId: opts.peerHardwareId || opts.peer?.hardwareId || null,
		hostname: opts.peerHostname || opts.peer?.hostname || opts.peer?.selfId || null,
		host: opts.peerHost || opts.peer?.host || '',
	}
	const hotBackup = buildHotBackupMetadata(ctx, role, { pairId: opts.pairId, peer })
	return writeProjectHotBackup(ctx, hotBackup)
}

/**
 * @param {object} ctx
 */
async function clearHotBackupOnActiveProject(ctx) {
	return writeProjectHotBackup(ctx, null)
}

/**
 * @param {object} ctx
 * @param {object} body register-follower payload
 */
async function applyLeaderHotBackupFromRegister(ctx, body) {
	const repl = getReplicationConfig(ctx.config)
	const pairId = String(body?.pairId || repl.pairId || '').trim()
	const followerHost = String(body?.followerHost || body?.peerHost || repl.peer?.host || '').trim()
	return applyHotBackupToActiveProject(ctx, 'leader', {
		pairId,
		peerHardwareId: body?.hardwareId || body?.handshake?.hardwareId || null,
		peerHostname: body?.selfId || null,
		peerHost: followerHost,
	})
}

module.exports = {
	buildLocalHotBackupBox,
	buildHotBackupMetadata,
	hotBackupPeerBoxForViewer,
	hotBackupPeerLabel,
	writeProjectHotBackup,
	applyHotBackupToActiveProject,
	clearHotBackupOnActiveProject,
	applyLeaderHotBackupFromRegister,
}
