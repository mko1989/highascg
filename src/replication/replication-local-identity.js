'use strict'

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')
const { getReplicationConfig, normalizeReplicationConfig } = require('../config/replication-config')

const LOCAL_IDENTITY_PATH = path.join(REPO_ROOT, 'config', 'replication-local-identity.json')

/**
 * @returns {string|null}
 */
function getHardwareHostnameSelfId() {
	try {
		const { getHardwareIdentity } = require('../system/hardware-identity')
		const hw = getHardwareIdentity()
		return hw?.hostname ? String(hw.hostname).trim() : null
	} catch {
		return null
	}
}

/**
 * @returns {{ selfId: string, createdAt?: string } | null}
 */
function readLocalIdentityFile() {
	try {
		if (!fs.existsSync(LOCAL_IDENTITY_PATH)) return null
		const raw = JSON.parse(fs.readFileSync(LOCAL_IDENTITY_PATH, 'utf8'))
		const selfId = String(raw?.selfId || '').trim()
		return selfId ? { selfId, createdAt: raw?.createdAt } : null
	} catch {
		return null
	}
}

/**
 * @param {string} selfId
 */
function writeLocalIdentityFile(selfId) {
	const id = String(selfId || '').trim()
	if (!id) return
	fs.mkdirSync(path.dirname(LOCAL_IDENTITY_PATH), { recursive: true })
	fs.writeFileSync(
		LOCAL_IDENTITY_PATH,
		JSON.stringify({ selfId: id, createdAt: new Date().toISOString(), hostname: os.hostname() }, null, 2),
		'utf8',
	)
}

/**
 * Stable per-machine replication selfId (never synced via exFAT).
 * @param {object} [ctx]
 * @param {{ persistToReplication?: boolean }} [opts]
 * @returns {string}
 */
function getOrCreateLocalReplicationSelfId(ctx, opts = {}) {
	const hwHostname = getHardwareHostnameSelfId()
	if (hwHostname) {
		const file = readLocalIdentityFile()
		if (file?.selfId === hwHostname) return hwHostname
		writeLocalIdentityFile(hwHostname)
		if (opts.persistToReplication !== false && ctx?.configManager && ctx?.config) {
			const repl = getReplicationConfig(ctx.config)
			if (repl.selfId !== hwHostname) {
				const next = normalizeReplicationConfig({ ...repl, selfId: hwHostname })
				const cfg = { ...ctx.configManager.get(), replication: next }
				ctx.configManager.save(cfg)
				Object.assign(ctx.config, ctx.configManager.get())
			}
		}
		return hwHostname
	}

	const file = readLocalIdentityFile()
	if (file?.selfId) return file.selfId

	const repl = getReplicationConfig(ctx?.config || {})
	const configured = String(repl.selfId || '').trim()
	const host = os.hostname()
	const hostId = String(host || '').trim()

	// Keep intentional operator ids; avoid cloned stick ids matching hostname on a different box.
	let selfId = configured
	if (!selfId || (selfId === hostId && process.env.HIGHASCG_FORCE_UNIQUE_REPL_SELF_ID === '1')) {
		selfId = ''
	}
	if (!selfId) {
		const suffix = crypto.randomBytes(3).toString('hex')
		selfId = hostId ? `${hostId}-${suffix}` : `highascg-${suffix}`
	}

	writeLocalIdentityFile(selfId)

	if (opts.persistToReplication !== false && ctx?.configManager && ctx?.config) {
		const next = normalizeReplicationConfig({ ...getReplicationConfig(ctx.config), selfId })
		if (next.selfId !== repl.selfId) {
			const cfg = { ...ctx.configManager.get(), replication: next }
			ctx.configManager.save(cfg)
			Object.assign(ctx.config, ctx.configManager.get())
		}
	}

	return selfId
}

/**
 * Apply local identity before pairing UI / connect flows.
 * @param {object} ctx
 */
function ensureLocalReplicationSelfId(ctx) {
	return getOrCreateLocalReplicationSelfId(ctx, { persistToReplication: true })
}

module.exports = {
	LOCAL_IDENTITY_PATH,
	readLocalIdentityFile,
	getOrCreateLocalReplicationSelfId,
	ensureLocalReplicationSelfId,
}
