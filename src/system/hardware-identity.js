'use strict'

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { REPO_ROOT } = require('../repo-paths')
const { isSandbox } = require('../bootstrap/sandbox')
const { isUsableMac, pickPrimaryInterface, storedIdentityStillValid } = require('./hardware-identity-select')
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
 * @param {object} [networkCfg]
 * @param {Array<{ name: string, mac?: string, internal?: boolean }>} [interfaces] test seam (default: live NICs)
 * @returns {{ mac: string, primaryInterface: string | null }}
 */
function getPrimaryEthernetMac(networkCfg, interfaces) {
	return pickPrimaryInterface(interfaces || listEthernetInterfaces(), networkCfg) // WO-1029 P1d: one rule
}

/**
 * @param {object} [networkCfg]
 * @returns {{ hardwareId: string, mac: string, hostname: string, derivedAt: string, source: string, primaryInterface: string | null }}
 */
function deriveHardwareIdentity(networkCfg, interfaces) {
	const { mac, primaryInterface } = getPrimaryEthernetMac(networkCfg, interfaces)
	let hardwareId = isUsableMac(mac) ? deriveHardwareIdFromMac(mac) : null
	let source = 'mac'
	if (!hardwareId) {
		let machineId = ''
		try {
			machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim()
		} catch {
			/* /etc/machine-id unreadable — stays '' */
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

/** The identity a `highascg<NNNN>` hostname stands for, when one of the box's wired NICs derives that id; else null. */
function identityOfHostname(hostname, interfaces) {
	const m = /^highascg(\d{4})$/.exec(String(hostname || '').trim())
	if (!m) return null
	const nic = (interfaces || []).find((i) => deriveHardwareIdFromMac(i.mac) === m[1])
	if (!nic) return null
	return { hardwareId: m[1], mac: String(nic.mac).toLowerCase(), hostname: `highascg${m[1]}`, derivedAt: new Date().toISOString(), source: 'mac', primaryInterface: nic.name }
}

/**
 * @param {object} [opts]
 * @param {object} [opts.networkCfg]
 * @param {boolean} [opts.refresh]
 * @returns {{ hardwareId: string, mac: string, hostname: string, derivedAt: string, source?: string, primaryInterface?: string | null }}
 */
function getHardwareIdentity(opts = {}) {
	if (_cached && !opts.refresh) return _cached

	// WO-1029 P1d: a stored id whose MAC is still on the box wins over any derivation, so the boot unit
	// (no config) and the node (config.network) can never disagree and a config change cannot rename the box.
	// opts.interfaces / opts.stored / opts.persist=false are test seams.
	const interfaces = opts.interfaces || listEthernetInterfaces()
	const cached = opts.stored !== undefined ? opts.stored : readHardwareIdentityFile()
	// The name the box already carries is what linked servers know it by: when the stored file disagrees with a
	// highascg<NNNN> hostname that one of the box's own NICs derives, the hostname wins and the file is repaired
	// (boxes whose file was flipped by the old two-rule derivation heal without a rename).
	const named = identityOfHostname(opts.hostname !== undefined ? opts.hostname : os.hostname(), interfaces)
	if (named && cached?.hardwareId !== named.hardwareId) {
		if (opts.persist === false) return named
		if (isSandbox()) return (_cached = named)
		writeHardwareIdentityFile(named)
		return _cached
	}
	if (cached && storedIdentityStillValid(cached, interfaces)) {
		const kept = { ...cached, hostname: cached.hostname || hardwareIdToHostname(cached.hardwareId) }
		if (opts.persist === false) return kept
		return (_cached = kept)
	}

	const derived = deriveHardwareIdentity(opts.networkCfg, interfaces)
	if (opts.persist === false) return derived
	if (isSandbox()) return (_cached = { ...derived, hostname: os.hostname() }) // WO-719: no write to the live config/
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
 * @param {{ exec?: typeof execFileSync, isRoot?: boolean, current?: string, writeEtcHostname?: (name: string) => void }} [deps]
 *   test seams (default: the real execFileSync / uid / os.hostname / /etc/hostname)
 * @returns {{ ok: boolean, applied: boolean, hostname: string, error?: string }}
 */
function applySystemHostname(hostname, log, deps = {}) {
	const exec = deps.exec || execFileSync
	const isRoot = deps.isRoot ?? (typeof process.getuid === 'function' && process.getuid() === 0)
	const writeEtcHostname = deps.writeEtcHostname || ((name) => fs.writeFileSync('/etc/hostname', `${name}\n`))
	const target = String(hostname || '').trim()
	const current = deps.current ?? os.hostname()
	if (!target) return { ok: false, applied: false, hostname: current, error: 'empty hostname' }
	if (current === target) return { ok: true, applied: false, hostname: current }

	/* Third attempt is the one that works unprivileged: `sudo -n hostnamectl` is NOT in the
	 * allowlist and never will be — scripts/setup/12-passwordless-sudo.sh grants exact command
	 * paths only (WO-97: no NOPASSWD wildcards), and set-hostname needs a per-box argument. The
	 * installed helper derives the same MAC-based highascg#### name itself and runs as root.
	 * WO-702: AS ROOT the sudo attempts are never made. The old comment promised "the first
	 * attempt succeeds — no recursion", but at boot hostnamectl has no D-Bus yet ("Failed to
	 * connect to bus"), so root fell through to sudo → the helper → node → sudo … (179 sudo
	 * runs in 20 s on the .64 live boot until spawnSync ETIMEDOUT). Root instead sets the kernel
	 * name and /etc/hostname directly, which needs no bus. */
	const attempts = isRoot
		? [
				() => exec('hostnamectl', ['set-hostname', target], { encoding: 'utf8', timeout: 10000 }),
				() => {
					exec('hostname', [target], { encoding: 'utf8', timeout: 5000 })
					writeEtcHostname(target)
				},
			]
		: [
				() => exec('hostnamectl', ['set-hostname', target], { encoding: 'utf8', timeout: 10000 }),
				() => exec('sudo', ['-n', 'hostnamectl', 'set-hostname', target], { encoding: 'utf8', timeout: 10000 }),
				() =>
					exec('sudo', ['-n', '/usr/local/lib/highascg/highascg-apply-hardware-hostname.sh'], {
						encoding: 'utf8',
						timeout: 20000,
					}),
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
		error: isRoot ? 'hostnamectl and hostname both failed as root' : 'hostnamectl failed (needs root or passwordless sudo)',
	}
}

/**
 * @param {object} [ctx]
 * @returns {{ identity: object, hostnameApplied: boolean, hostnameError?: string }}
 */
function ensureHardwareHostname(ctx) {
	if (isSandbox()) return { identity: getHardwareIdentity(), hostnameApplied: false } // WO-719: never hostnamectl
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
	isUsableMac,
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
