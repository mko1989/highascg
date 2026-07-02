'use strict'

const crypto = require('crypto')
const pkg = require('../../package.json')
const { APP_ID } = require('../system/hardware-identity')
const { ensureDeviceIdentity, getDevicePublicKeyPem, signMessage, verifyMessage } = require('../system/device-identity')
const { getHardwareIdentity } = require('../system/hardware-identity')
const { getReplicationConfig, normalizeReplicationConfig } = require('../config/replication-config')

/**
 * @param {string} version
 * @returns {number[]}
 */
function parseSemverParts(version) {
	return String(version || '')
		.trim()
		.split('.')
		.map((p) => parseInt(p, 10) || 0)
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function semverGte(a, b) {
	const pa = parseSemverParts(a)
	const pb = parseSemverParts(b)
	for (let i = 0; i < 3; i++) {
		const av = pa[i] || 0
		const bv = pb[i] || 0
		if (av > bv) return true
		if (av < bv) return false
	}
	return true
}

function minAppVersion() {
	return String(process.env.HIGHASCG_REPL_MIN_APP_VERSION || '2026.05.20').trim()
}

/**
 * @param {{ nonce: string, pairId: string, hardwareId: string, role: string }} fields
 * @returns {string}
 */
function canonicalHandshakeMessage(fields) {
	return JSON.stringify({
		nonce: String(fields.nonce || ''),
		pairId: String(fields.pairId || ''),
		hardwareId: String(fields.hardwareId || ''),
		role: String(fields.role || ''),
	})
}

/**
 * @param {{ nonce: string, pairId: string, hardwareId: string, role: string }} fields
 * @returns {string}
 */
function signHandshakeFields(fields) {
	ensureDeviceIdentity()
	return signMessage(canonicalHandshakeMessage(fields))
}

/**
 * @param {string} publicKeyPem
 * @param {{ nonce?: string, pairId?: string, hardwareId?: string, role?: string, signature?: string }} handshake
 * @returns {boolean}
 */
function verifyHandshakeFields(publicKeyPem, handshake) {
	if (!publicKeyPem || !handshake) return false
	const { signature, ...fields } = handshake
	if (!signature) return false
	return verifyMessage(publicKeyPem, canonicalHandshakeMessage(fields), signature)
}

/**
 * @param {object} ctx
 * @param {{ pairId: string, role?: string }} opts
 */
function buildRegisterHandshakeExtras(ctx, opts) {
	const hw = getHardwareIdentity({ networkCfg: ctx?.config?.network })
	const nonce = crypto.randomBytes(16).toString('hex')
	const role = String(opts.role || 'follower')
	const handshake = {
		nonce,
		pairId: String(opts.pairId || ''),
		hardwareId: hw.hardwareId,
		role,
	}
	return {
		appId: APP_ID,
		appVersion: pkg.version,
		hardwareId: hw.hardwareId,
		devicePublicKey: getDevicePublicKeyPem(),
		handshake: {
			...handshake,
			signature: signHandshakeFields(handshake),
		},
	}
}

/**
 * @param {object} ctx
 * @param {{ nonce: string, pairId: string }} opts
 */
function buildLeaderRegisterHandshakeResponse(ctx, opts) {
	const hw = getHardwareIdentity({ networkCfg: ctx?.config?.network })
	const handshake = {
		nonce: String(opts.nonce || ''),
		pairId: String(opts.pairId || ''),
		hardwareId: hw.hardwareId,
		role: 'leader',
	}
	return {
		appId: APP_ID,
		appVersion: pkg.version,
		devicePublicKey: getDevicePublicKeyPem(),
		handshake: {
			...handshake,
			signature: signHandshakeFields(handshake),
		},
	}
}

/**
 * @param {object} body
 * @param {(level: string, msg: string) => void} [log]
 */
function verifyRegisterFollowerRequest(body, log) {
	const appId = String(body?.appId || '').trim()
	if (appId !== APP_ID) {
		if (typeof log === 'function') {
			log('warn', `[replication] rejected register-follower from non-HighAsCG peer (appId=${appId || 'missing'})`)
		}
		return { ok: false, status: 403, error: 'not a HighAsCG peer', rejectUnknown: true }
	}
	const appVersion = String(body?.appVersion || '').trim()
	if (!appVersion || !semverGte(appVersion, minAppVersion())) {
		return { ok: false, status: 403, error: `app version must be >= ${minAppVersion()}` }
	}
	const devicePublicKey = String(body?.devicePublicKey || '').trim()
	const hs = body?.handshake
	if (!devicePublicKey || !hs) {
		return { ok: false, status: 403, error: 'handshake required' }
	}
	if (String(body?.hardwareId || '') !== String(hs.hardwareId || '')) {
		return { ok: false, status: 403, error: 'hardwareId mismatch' }
	}
	if (String(hs.role || '') !== 'follower') {
		return { ok: false, status: 403, error: 'invalid handshake role' }
	}
	if (String(hs.pairId || '') !== String(body?.pairId || '').trim()) {
		return { ok: false, status: 403, error: 'pairId mismatch in handshake' }
	}
	if (!verifyHandshakeFields(devicePublicKey, hs)) {
		return { ok: false, status: 403, error: 'invalid handshake signature' }
	}
	return {
		ok: true,
		devicePublicKey,
		nonce: String(hs.nonce || ''),
		hardwareId: String(hs.hardwareId || ''),
	}
}

/**
 * @param {object} response
 * @param {{ pairId: string, nonce: string }} expected
 */
function verifyLeaderRegisterResponse(response, expected) {
	const devicePublicKey = String(response?.devicePublicKey || '').trim()
	const hs = response?.handshake
	if (!devicePublicKey || !hs) return { ok: false, error: 'leader handshake missing' }
	if (String(response?.appId || '') !== APP_ID) return { ok: false, error: 'leader appId mismatch' }
	if (String(hs.role || '') !== 'leader') return { ok: false, error: 'leader handshake role mismatch' }
	if (String(hs.pairId || '') !== String(expected.pairId || '')) return { ok: false, error: 'leader pairId mismatch' }
	if (String(hs.nonce || '') !== String(expected.nonce || '')) return { ok: false, error: 'leader nonce mismatch' }
	if (!verifyHandshakeFields(devicePublicKey, hs)) return { ok: false, error: 'invalid leader handshake signature' }
	return { ok: true, devicePublicKey }
}

/**
 * @param {object} ctx
 * @param {{ pairId: string, role: string }} opts
 */
function buildRepairHandshakeBody(ctx, opts) {
	const hw = getHardwareIdentity({ networkCfg: ctx?.config?.network })
	const nonce = crypto.randomBytes(12).toString('hex')
	const handshake = {
		nonce,
		pairId: String(opts.pairId || ''),
		hardwareId: hw.hardwareId,
		role: String(opts.role || ''),
	}
	return {
		appId: APP_ID,
		devicePublicKey: getDevicePublicKeyPem(),
		handshake: {
			...handshake,
			signature: signHandshakeFields(handshake),
		},
	}
}

/**
 * @param {import('http').IncomingMessage} [req]
 * @returns {string}
 */
function normalizeRemoteAddress(req) {
	return String(req?.socket?.remoteAddress || '')
		.replace(/^::ffff:/, '')
		.trim()
}

/**
 * @param {object} ctx
 * @param {object} body
 * @param {import('http').IncomingMessage} [req]
 * @param {{ expectedRole?: string }} [opts]
 */
function verifyReplicationRepairRequest(ctx, body, req, opts = {}) {
	const repl = getReplicationConfig(ctx?.config)
	const pairId = String(body?.pairId || '').trim()
	if (!pairId || pairId !== repl.pairId) {
		return { ok: false, error: 'pairId mismatch' }
	}
	const peerKey = String(repl.peerDevicePublicKey || '').trim()
	const bodyKey = String(body?.devicePublicKey || '').trim()
	const publicKey = peerKey || bodyKey
	const hs = body?.handshake
	if (publicKey && hs && String(body?.appId || '') === APP_ID) {
		if (opts.expectedRole && String(hs.role || '') !== opts.expectedRole) {
			return { ok: false, error: 'repair handshake role mismatch' }
		}
		if (String(hs.pairId || '') !== pairId) {
			return { ok: false, error: 'repair handshake pairId mismatch' }
		}
		if (verifyHandshakeFields(publicKey, hs)) {
			return { ok: true, method: 'handshake' }
		}
	}
	const remote = normalizeRemoteAddress(req)
	const peerHost = String(repl.peer?.host || '').trim()
	if (peerHost && remote && remote === peerHost) {
		return { ok: true, method: 'peer-ip' }
	}
	return { ok: false, error: 'repair auth failed' }
}

/**
 * @param {object} ctx
 * @param {string} publicKeyPem
 */
function persistPeerDevicePublicKey(ctx, publicKeyPem) {
	const line = String(publicKeyPem || '').trim()
	if (!line || !ctx?.configManager) return false
	const repl = getReplicationConfig(ctx.config)
	if (repl.peerDevicePublicKey === line) return true
	const cfg = {
		...ctx.configManager.get(),
		replication: normalizeReplicationConfig({ ...repl, peerDevicePublicKey: line }),
	}
	const ok = ctx.configManager.save(cfg)
	if (ok && ctx.config) Object.assign(ctx.config, ctx.configManager.get())
	return ok
}

module.exports = {
	APP_ID,
	minAppVersion,
	semverGte,
	canonicalHandshakeMessage,
	signHandshakeFields,
	verifyHandshakeFields,
	buildRegisterHandshakeExtras,
	buildLeaderRegisterHandshakeResponse,
	verifyRegisterFollowerRequest,
	verifyLeaderRegisterResponse,
	buildRepairHandshakeBody,
	verifyReplicationRepairRequest,
	persistPeerDevicePublicKey,
}
