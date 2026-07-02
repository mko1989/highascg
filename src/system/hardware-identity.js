'use strict'

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { REPO_ROOT } = require('../repo-paths')
const { isAllowedEthernetIface } = require('../config/network-settings')
const { listEthernetInterfaces } = require('./network-inventory')

const HARDWARE_IDENTITY_PATH = path.join(REPO_ROOT, 'config', 'hardware-identity.json')
const APP_ID = 'highascg'
const LEGACY_HOSTNAME_RE = /^highascg-nvidia-/i

/** @type {{ hardwareId: string, mac: string, hostname: string, derivedAt: string, source?: string, primaryInterface?: string | null } | null} */
let _cached = null

/**
 * @param {string} mac
 * @returns {string|null}
 */
function deriveHardwareIdFromMac(mac) {
	if (!isUsableMac(mac)) return null
	const parts = String(mac || '')
		.trim()
		.toLowerCase()
		.split(':')
		.map((p) => parseInt(p, 16))
	if (parts.length !== 6 || parts.some((n) => Number.isNaN(n))) return null
	const n = ((parts[4] << 8) | parts[5]) % 10000
	return String(n).padStart(4, '0')
}

/**
 * @param {string} input
 * @returns {string}
 */
function deriveHardwareIdFromMachineId(input) {
	const hash = crypto.createHash('sha256').update(String(input || '')).digest()
	const n = hash.readUInt32BE(0) % 10000
	return String(n).padStart(4, '0')
}

/**
 * @param {string} hardwareId
 * @returns {string}
 */
function hardwareIdToHostname(hardwareId) {
	return `highascg${String(hardwareId || '').padStart(4, '0')}`
}

/**
 * @param {string} mac
 * @returns {boolean}
 */
function isUsableMac(mac) {
	const norm = String(mac || '').trim().toLowerCase()
	if (!norm || norm === '00:00:00:00:00:00') return false
	return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(norm)
}

/**
 * @param {object} [networkCfg]
 * @returns {{ mac: string, primaryInterface: string | null }}
 */
function getPrimaryEthernetMac(networkCfg) {
	const interfaces = listEthernetInterfaces()
	const primaryName =
		(networkCfg?.primaryInterface && isAllowedEthernetIface(networkCfg.primaryInterface)
			? networkCfg.primaryInterface
			: null) ||
		interfaces.find((i) => i.address && !i.internal)?.name ||
		interfaces.find((i) => !i.internal && isUsableMac(i.mac))?.name ||
		interfaces[0]?.name ||
		null
	if (!primaryName) return { mac: '', primaryInterface: null }
	const iface = interfaces.find((i) => i.name === primaryName)
	return { mac: iface?.mac || '', primaryInterface: primaryName }
}

/**
 * @param {object} [networkCfg]
 * @returns {{ hardwareId: string, mac: string, hostname: string, derivedAt: string, source: string, primaryInterface: string | null }}
 */
function deriveHardwareIdentity(networkCfg) {
	const { mac, primaryInterface } = getPrimaryEthernetMac(networkCfg)
	let hardwareId = isUsableMac(mac) ? deriveHardwareIdFromMac(mac) : null
	let source = 'mac'
	if (!hardwareId) {
		let machineId = ''
		try {
			machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim()
		} catch {
			machineId = ''
		}
		hardwareId = deriveHardwareIdFromMachineId(machineId || os.hostname() || 'highascg')
		source = machineId ? 'machine-id' : 'hostname-fallback'
	}
	return {
		hardwareId,
		mac: isUsableMac(mac) ? mac.toLowerCase() : '',
		hostname: hardwareIdToHostname(hardwareId),
		derivedAt: new Date().toISOString(),
		source,
		primaryInterface,
	}
}

/**
 * @returns {{ hardwareId: string, mac: string, hostname: string, derivedAt?: string, source?: string, primaryInterface?: string | null } | null}
 */
function readHardwareIdentityFile() {
	try {
		if (!fs.existsSync(HARDWARE_IDENTITY_PATH)) return null
		const raw = JSON.parse(fs.readFileSync(HARDWARE_IDENTITY_PATH, 'utf8'))
		const hardwareId = String(raw?.hardwareId || '').trim()
		const hostname = String(raw?.hostname || '').trim() || (hardwareId ? hardwareIdToHostname(hardwareId) : '')
		if (!hardwareId || !hostname) return null
		return {
			hardwareId,
			mac: String(raw?.mac || '').trim(),
			hostname,
			derivedAt: raw?.derivedAt,
			source: raw?.source,
			primaryInterface: raw?.primaryInterface ?? null,
		}
	} catch {
		return null
	}
}

/**
 * @param {object} identity
 */
function writeHardwareIdentityFile(identity) {
	const hardwareId = String(identity?.hardwareId || '').trim()
	const hostname = String(identity?.hostname || '').trim() || hardwareIdToHostname(hardwareId)
	if (!hardwareId || !hostname) return
	fs.mkdirSync(path.dirname(HARDWARE_IDENTITY_PATH), { recursive: true })
	fs.writeFileSync(
		HARDWARE_IDENTITY_PATH,
		JSON.stringify(
			{
				hardwareId,
				mac: String(identity?.mac || '').trim(),
				hostname,
				derivedAt: identity?.derivedAt || new Date().toISOString(),
				...(identity?.source ? { source: String(identity.source) } : {}),
				...(identity?.primaryInterface ? { primaryInterface: String(identity.primaryInterface) } : {}),
			},
			null,
			2,
		),
		'utf8',
	)
	_cached = {
		hardwareId,
		mac: String(identity?.mac || '').trim(),
		hostname,
		derivedAt: identity?.derivedAt || new Date().toISOString(),
		source: identity?.source,
		primaryInterface: identity?.primaryInterface ?? null,
	}
}

/**
 * @param {object} [opts]
 * @param {object} [opts.networkCfg]
 * @param {boolean} [opts.refresh]
 * @returns {{ hardwareId: string, mac: string, hostname: string, derivedAt: string, source?: string, primaryInterface?: string | null }}
 */
function getHardwareIdentity(opts = {}) {
	if (_cached && !opts.refresh) return _cached

	const networkCfg = opts.networkCfg
	const derived = deriveHardwareIdentity(networkCfg)
	const cached = readHardwareIdentityFile()
	const currentMac = derived.mac
	const cachedMac = cached?.mac || ''

	if (cached && (!currentMac || !cachedMac || cachedMac === currentMac)) {
		_cached = {
			...cached,
			hostname: cached.hostname || hardwareIdToHostname(cached.hardwareId),
		}
		return _cached
	}

	writeHardwareIdentityFile(derived)
	return _cached
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isLegacyHighascgHostname(hostname) {
	return LEGACY_HOSTNAME_RE.test(String(hostname || '').trim())
}

/**
 * @param {string} hostname
 * @param {(level: string, msg: string) => void} [log]
 * @returns {{ ok: boolean, applied: boolean, hostname: string, error?: string }}
 */
function applySystemHostname(hostname, log) {
	const target = String(hostname || '').trim()
	if (!target) return { ok: false, applied: false, hostname: os.hostname(), error: 'empty hostname' }
	const current = os.hostname()
	if (current === target) return { ok: true, applied: false, hostname: current }

	const attempts = [
		() => execFileSync('hostnamectl', ['set-hostname', target], { encoding: 'utf8', timeout: 10000 }),
		() => execFileSync('sudo', ['-n', 'hostnamectl', 'set-hostname', target], { encoding: 'utf8', timeout: 10000 }),
	]

	for (const run of attempts) {
		try {
			run()
			log?.('info', `[hardware-identity] hostname ${current} → ${target}`)
			return { ok: true, applied: true, hostname: target }
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			log?.('debug', `[hardware-identity] hostname apply attempt failed: ${msg}`)
		}
	}

	return {
		ok: false,
		applied: false,
		hostname: current,
		error: 'hostnamectl failed (needs root or passwordless sudo)',
	}
}

/**
 * @param {object} [ctx]
 * @returns {{ identity: object, hostnameApplied: boolean, hostnameError?: string }}
 */
function ensureHardwareHostname(ctx) {
	const log = typeof ctx?.log === 'function' ? ctx.log : null
	const identity = getHardwareIdentity({ networkCfg: ctx?.config?.network, refresh: true })
	const current = os.hostname()
	const shouldMigrate =
		isLegacyHighascgHostname(current) || current !== identity.hostname

	let hostnameApplied = false
	let hostnameError
	if (shouldMigrate) {
		const res = applySystemHostname(identity.hostname, log)
		hostnameApplied = !!res.applied
		if (!res.ok && res.error) hostnameError = res.error
	}

	try {
		const { ensureLocalReplicationSelfId } = require('../replication/replication-local-identity')
		ensureLocalReplicationSelfId(ctx, { persistToReplication: true })
	} catch (e) {
		log?.('warn', `[hardware-identity] replication selfId align failed: ${e?.message || e}`)
	}

	return { identity, hostnameApplied, ...(hostnameError ? { hostnameError } : {}) }
}

/**
 * @returns {{ appId: string, hardwareId: string | null, hostname: string }}
 */
function getHardwareIdentityPingFields() {
	const identity = getHardwareIdentity()
	return {
		appId: APP_ID,
		hardwareId: identity?.hardwareId || null,
		hostname: identity?.hostname || os.hostname(),
	}
}

module.exports = {
	APP_ID,
	HARDWARE_IDENTITY_PATH,
	LEGACY_HOSTNAME_RE,
	deriveHardwareIdFromMac,
	deriveHardwareIdFromMachineId,
	hardwareIdToHostname,
	getPrimaryEthernetMac,
	deriveHardwareIdentity,
	readHardwareIdentityFile,
	writeHardwareIdentityFile,
	getHardwareIdentity,
	isLegacyHighascgHostname,
	applySystemHostname,
	ensureHardwareHostname,
	getHardwareIdentityPingFields,
}
