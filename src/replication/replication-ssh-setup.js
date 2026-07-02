'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { REPO_ROOT } = require('../repo-paths')

const DEFAULT_KEY_BASENAME = 'highascg_replication'
const INSTALLED_WRAPPER_PATH = '/usr/local/bin/highascg-replication-ssh'
const REPO_WRAPPER_PATH = path.join(REPO_ROOT, 'tools/runtime/highascg-replication-ssh.sh')

/**
 * @returns {string}
 */
function replicationSshKeyPath() {
	const fromEnv = String(process.env.HIGHASCG_REPL_SSH_KEY || '').trim()
	if (fromEnv) return path.resolve(fromEnv)
	return path.join(os.homedir(), '.ssh', DEFAULT_KEY_BASENAME)
}

/**
 * @param {string} line
 * @returns {string | null}
 */
function normalizeSshPublicKeyLine(line) {
	const s = String(line || '').trim()
	if (!s || s.startsWith('#')) return null
	if (!/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256)\s+\S+/.test(s)) return null
	const parts = s.split(/\s+/)
	if (parts.length < 2) return null
	const type = parts[0]
	const key = parts[1]
	if (!/^[A-Za-z0-9+/=]+$/.test(key)) return null
	const comment = parts.slice(2).join(' ') || 'highascg-replication-peer'
	return `${type} ${key} ${comment}`.trim()
}

function resolveReplicationSshWrapperPath() {
	if (fs.existsSync(INSTALLED_WRAPPER_PATH)) return INSTALLED_WRAPPER_PATH
	if (fs.existsSync(REPO_WRAPPER_PATH)) return REPO_WRAPPER_PATH
	return INSTALLED_WRAPPER_PATH
}

/**
 * @param {string} value
 * @returns {string}
 */
function shellDoubleQuote(value) {
	return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Strip authorized_keys option prefix, leaving type key [comment].
 * @param {string} line
 * @returns {string}
 */
function stripAuthorizedKeyOptions(line) {
	const s = String(line || '').trim()
	if (!s) return ''
	if (/^(ssh-|ecdsa-)/.test(s)) return s
	const m = s.match(/\s(ssh-(?:ed25519|rsa)|ecdsa-sha2-nistp256)\s+/)
	if (!m || m.index == null) return s
	return s.slice(m.index + 1).trim()
}

/**
 * @param {string} line
 * @returns {string | null}
 */
function extractSshPublicKeyMaterial(line) {
	const normalized = normalizeSshPublicKeyLine(stripAuthorizedKeyOptions(line))
	if (!normalized) return null
	const parts = normalized.split(/\s+/)
	return `${parts[0]} ${parts[1]}`
}

/**
 * @param {string} publicKeyLine
 * @param {{ fromHost?: string, useForcedCommand?: boolean }} [opts]
 * @returns {string | null}
 */
function buildForcedCommandAuthorizedKeysEntry(publicKeyLine, opts = {}) {
	const line = normalizeSshPublicKeyLine(publicKeyLine)
	if (!line) return null
	if (opts.useForcedCommand === false) return line

	const wrapper = resolveReplicationSshWrapperPath()
	/** @type {string[]} */
	const options = []
	const fromHost = String(opts.fromHost || '').trim()
	if (fromHost && fromHost !== '127.0.0.1' && fromHost !== '::1') {
		options.push(`from=${shellDoubleQuote(fromHost)}`)
	}
	options.push(`command=${shellDoubleQuote(wrapper)}`)
	options.push('no-port-forwarding')
	options.push('no-X11-forwarding')
	options.push('no-agent-forwarding')
	options.push('no-pty')
	return `${options.join(',')} ${line}`
}

/**
 * @param {string} authPath
 * @param {string} publicKeyLine
 * @param {{ fromHost?: string, log?: (level: string, msg: string) => void }} [opts]
 */
function upsertPeerAuthorizedKey(authPath, publicKeyLine, opts = {}) {
	const entry = buildForcedCommandAuthorizedKeysEntry(publicKeyLine, { fromHost: opts.fromHost })
	if (!entry) return { ok: false, error: 'invalid ssh public key' }

	const material = extractSshPublicKeyMaterial(publicKeyLine)
	const lines = fs.existsSync(authPath)
		? fs.readFileSync(authPath, 'utf8').split('\n')
		: []
	const kept = lines.filter((raw) => {
		const trimmed = raw.trim()
		if (!trimmed || trimmed.startsWith('#')) return true
		if (!material) return true
		return extractSshPublicKeyMaterial(trimmed) !== material
	})
	while (kept.length && !kept[kept.length - 1].trim()) kept.pop()
	const hadEntry = lines.some((raw) => {
		const trimmed = raw.trim()
		return trimmed && extractSshPublicKeyMaterial(trimmed) === material
	})
	const alreadyPresent = hadEntry && lines.some((raw) => raw.trim() === entry)
	if (alreadyPresent) {
		return { ok: true, installed: false, alreadyPresent: true, entry }
	}
	const next = [...kept, entry].join('\n') + '\n'
	fs.writeFileSync(authPath, next, { mode: 0o600 })
	if (typeof opts.log === 'function') {
		opts.log('info', `[replication] authorized replication SSH key (${entry.slice(0, 72)}…)`)
	}
	return { ok: true, installed: true, alreadyPresent: false, upgraded: hadEntry, entry }
}

/**
 * @param {string} [forKeyPath]
 */
function ensureSshDir(forKeyPath) {
	const dir = path.dirname(forKeyPath || replicationSshKeyPath())
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
	else fs.chmodSync(dir, 0o700)
}

/**
 * @param {(level: string, msg: string) => void} [log]
 * @returns {{ keyPath: string, publicKeyLine: string, created: boolean }}
 */
function ensureReplicationSshKey(log) {
	const keyPath = replicationSshKeyPath()
	const pubPath = `${keyPath}.pub`
	ensureSshDir(keyPath)

	let created = false
	if (!fs.existsSync(keyPath) || !fs.existsSync(pubPath)) {
		const host = os.hostname().split('.')[0] || 'highascg'
		const res = spawnSync(
			'ssh-keygen',
			['-t', 'ed25519', '-f', keyPath, '-N', '', '-C', `highascg-replication@${host}`],
			{ encoding: 'utf8' },
		)
		if (res.status !== 0) {
			throw new Error(`ssh-keygen failed: ${res.stderr?.trim() || res.status}`)
		}
		created = true
		if (typeof log === 'function') log('info', `[replication] created SSH key ${keyPath}`)
	}

	try {
		fs.chmodSync(keyPath, 0o600)
		fs.chmodSync(pubPath, 0o644)
	} catch {
		/* ignore */
	}

	const publicKeyLine = normalizeSshPublicKeyLine(fs.readFileSync(pubPath, 'utf8'))
	if (!publicKeyLine) throw new Error(`invalid replication public key at ${pubPath}`)

	return { keyPath, publicKeyLine, created }
}

/**
 * @returns {string}
 */
function resolveReplicationSshIdentityPath() {
	const keyPath = replicationSshKeyPath()
	return fs.existsSync(keyPath) ? keyPath : ''
}

/**
 * @param {string} publicKeyLine
 * @param {{ log?: (level: string, msg: string) => void, fromHost?: string }} [opts]
 */
function installPeerAuthorizedKey(publicKeyLine, opts = {}) {
	const authPath = path.join(os.homedir(), '.ssh', 'authorized_keys')
	ensureSshDir(replicationSshKeyPath())
	if (!fs.existsSync(authPath)) fs.writeFileSync(authPath, '', { mode: 0o600 })
	else fs.chmodSync(authPath, 0o600)
	return upsertPeerAuthorizedKey(authPath, publicKeyLine, opts)
}

function rsyncRemoteRoot() {
	return String(process.env.HIGHASCG_REPL_RSYNC_REMOTE_ROOT || REPO_ROOT).replace(/\/+$/, '')
}

function rsyncSshOptsForProbe() {
	const identity =
		String(process.env.HIGHASCG_REPL_RSYNC_IDENTITY_FILE || '').trim() || resolveReplicationSshIdentityPath()
	const identityOpt = identity ? `-i ${identity}` : ''
	const base =
		process.env.HIGHASCG_REPL_RSYNC_SSH_OPTS ||
		'-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15'
	return [base, identityOpt].filter(Boolean).join(' ').trim()
}

/**
 * Re-apply stored peer key after reboot (authorized_keys may have been reset on live image).
 * @param {object} ctx
 */
function ensurePeerAuthorizedKeyFromConfig(ctx) {
	const repl = require('../config/replication-config').getReplicationConfig(ctx?.config)
	const line = String(repl.peerSshPublicKey || '').trim()
	if (!line) return { ok: true, skipped: true }
	return installPeerAuthorizedKey(line, { log: ctx?.log, fromHost: repl.peer?.host })
}

/**
 * @param {object} ctx
 * @param {string} peerPublicKeyLine
 */
function persistPeerSshPublicKey(ctx, peerPublicKeyLine) {
	const line = normalizeSshPublicKeyLine(peerPublicKeyLine)
	if (!line || !ctx?.configManager) return false
	const repl = require('../config/replication-config').getReplicationConfig(ctx.config)
	if (repl.peerSshPublicKey === line) return true
	const cfg = { ...ctx.configManager.get(), replication: { ...repl, peerSshPublicKey: line } }
	const ok = ctx.configManager.save(cfg)
	if (ok && ctx.config) Object.assign(ctx.config, ctx.configManager.get())
	return ok
}

/**
 * Exchange SSH keys during leader/follower pairing (no sudo — casparcg ~/.ssh only).
 * @param {object} ctx
 * @param {{ peerPublicKey?: string, log?: Function, fromHost?: string }} opts
 */
function prepareReplicationSshForPairing(ctx, opts = {}) {
	const log = opts.log || ctx?.log
	const local = ensureReplicationSshKey(log)
	let peerInstall = null
	if (opts.peerPublicKey) {
		const fromHost =
			String(opts.fromHost || '').trim() ||
			String(require('../config/replication-config').getReplicationConfig(ctx?.config).peer?.host || '').trim()
		peerInstall = installPeerAuthorizedKey(opts.peerPublicKey, { log, fromHost })
		if (peerInstall.ok) persistPeerSshPublicKey(ctx, opts.peerPublicKey)
	}
	return { local, peerInstall }
}

/**
 * @param {string} peerHost
 * @param {(level: string, msg: string) => void} [log]
 */
function testReplicationSshToPeer(peerHost, log) {
	const host = String(peerHost || '').trim()
	if (!host) return { ok: false, error: 'peer host missing' }
	const keyPath = resolveReplicationSshIdentityPath()
	if (!keyPath) return { ok: false, error: 'replication SSH key missing' }
	const user = String(process.env.HIGHASCG_REPL_RSYNC_USER || 'casparcg').trim() || 'casparcg'
	const remoteRoot = rsyncRemoteRoot()
	const remote = `${user}@${host}:${path.posix.join(remoteRoot, 'media/')}`
	const sshCommand = `ssh ${rsyncSshOptsForProbe()}`
	const res = spawnSync('rsync', ['-avzn', '--dry-run', '-e', sshCommand, remote, '/dev/null'], {
		encoding: 'utf8',
		timeout: 20000,
	})
	const ok = res.status === 0
	if (!ok && typeof log === 'function') {
		log(
			'warn',
			`[replication] rsync SSH probe ${user}@${host} failed: ${(res.stderr || res.stdout || '').trim() || res.status}`,
		)
	}
	return { ok, stderr: res.stderr, stdout: res.stdout }
}

/**
 * Authenticated SSH pubkey re-exchange (repair after wiped authorized_keys).
 * @param {object} ctx
 */
async function exchangeReplicationSshWithPeer(ctx) {
	const repl = require('../config/replication-config').getReplicationConfig(ctx?.config)
	if (!repl.enabled || !repl.peer?.host || !repl.pairId) {
		return { ok: false, error: 'replication not paired' }
	}
	const local = ensureReplicationSshKey(ctx?.log)
	const { peerHttpRequest, SYNC_REQUEST_TIMEOUT_MS } = require('./peer-client')
	const { buildRepairHandshakeBody } = require('./replication-handshake')
	const rt = require('./replication-service').getReplicationRuntime(ctx)
	const role = rt?.roleState?.getRole() || repl.role
	const repairRole = role === 'leader' ? 'leader' : 'follower'
	const repairBody = buildRepairHandshakeBody(ctx, { pairId: repl.pairId, role: repairRole })

	let res = await peerHttpRequest(repl.peer, '/api/replication/exchange-ssh', {
		method: 'POST',
		body: { sshPublicKey: local.publicKeyLine, ...repairBody },
		timeoutMs: SYNC_REQUEST_TIMEOUT_MS,
	})
	if (res.status === 401) {
		res = await peerHttpRequest(
			{ host: repl.peer.host, port: repl.peer.port || 4200, token: '' },
			'/api/replication/exchange-ssh',
			{
				method: 'POST',
				body: { sshPublicKey: local.publicKeyLine, ...repairBody },
				timeoutMs: SYNC_REQUEST_TIMEOUT_MS,
			},
		)
	}
	if (!res.ok) return { ok: false, error: res.error || res.json?.error || 'exchange-ssh failed' }
	if (res.json?.sshPublicKey) {
		const latest = require('../config/replication-config').getReplicationConfig(ctx?.config)
		prepareReplicationSshForPairing(ctx, {
			peerPublicKey: res.json.sshPublicKey,
			fromHost: latest.peer?.host,
			log: ctx?.log,
		})
	}
	return { ok: true, sshPublicKey: res.json?.sshPublicKey || '' }
}

/**
 * Handle inbound exchange-ssh (paired peer only).
 * @param {object} ctx
 * @param {{ sshPublicKey?: string }} body
 */
function handleExchangeReplicationSsh(ctx, body) {
	const repl = require('../config/replication-config').getReplicationConfig(ctx?.config)
	if (!repl.enabled || !repl.peer?.host) return { ok: false, error: 'not paired' }
	try {
		const prepared = prepareReplicationSshForPairing(ctx, {
			peerPublicKey: body?.sshPublicKey,
			fromHost: repl.peer?.host,
			log: ctx?.log,
		})
		return { ok: true, sshPublicKey: prepared.local.publicKeyLine }
	} catch (e) {
		return { ok: false, error: e?.message || String(e) }
	}
}

module.exports = {
	replicationSshKeyPath,
	normalizeSshPublicKeyLine,
	resolveReplicationSshWrapperPath,
	buildForcedCommandAuthorizedKeysEntry,
	extractSshPublicKeyMaterial,
	ensureReplicationSshKey,
	resolveReplicationSshIdentityPath,
	installPeerAuthorizedKey,
	ensurePeerAuthorizedKeyFromConfig,
	persistPeerSshPublicKey,
	prepareReplicationSshForPairing,
	testReplicationSshToPeer,
	exchangeReplicationSshWithPeer,
	handleExchangeReplicationSsh,
}
