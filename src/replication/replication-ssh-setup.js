'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const DEFAULT_KEY_BASENAME = 'highascg_replication'

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
 * @param {{ log?: (level: string, msg: string) => void }} [opts]
 */
function installPeerAuthorizedKey(publicKeyLine, opts = {}) {
	const line = normalizeSshPublicKeyLine(publicKeyLine)
	if (!line) return { ok: false, error: 'invalid ssh public key' }

	const authPath = path.join(os.homedir(), '.ssh', 'authorized_keys')
	ensureSshDir(replicationSshKeyPath())
	if (!fs.existsSync(authPath)) fs.writeFileSync(authPath, '', { mode: 0o600 })
	else fs.chmodSync(authPath, 0o600)

	const existing = fs.readFileSync(authPath, 'utf8')
	if (existing.split('\n').some((l) => l.trim() === line)) {
		return { ok: true, installed: false, alreadyPresent: true }
	}

	fs.appendFileSync(authPath, `${line}\n`, { mode: 0o600 })
	if (typeof opts.log === 'function') {
		opts.log('info', `[replication] authorized SSH key for peer (${line.slice(0, 40)}…)`)
	}
	return { ok: true, installed: true, alreadyPresent: false }
}

/**
 * Re-apply stored peer key after reboot (authorized_keys may have been reset on live image).
 * @param {object} ctx
 */
function ensurePeerAuthorizedKeyFromConfig(ctx) {
	const repl = require('../config/replication-config').getReplicationConfig(ctx?.config)
	const line = String(repl.peerSshPublicKey || '').trim()
	if (!line) return { ok: true, skipped: true }
	return installPeerAuthorizedKey(line, { log: ctx?.log })
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
 * @param {{ peerPublicKey?: string, log?: Function }} opts
 */
function prepareReplicationSshForPairing(ctx, opts = {}) {
	const log = opts.log || ctx?.log
	const local = ensureReplicationSshKey(log)
	let peerInstall = null
	if (opts.peerPublicKey) {
		peerInstall = installPeerAuthorizedKey(opts.peerPublicKey, { log })
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
	const sshArgs = [
		'-o',
		'BatchMode=yes',
		'-o',
		'StrictHostKeyChecking=accept-new',
		'-o',
		'ConnectTimeout=10',
		'-i',
		keyPath,
		`${user}@${host}`,
		'echo highascg-replication-ssh-ok',
	]
	const res = spawnSync('ssh', sshArgs, { encoding: 'utf8', timeout: 15000 })
	const ok = res.status === 0 && /highascg-replication-ssh-ok/.test(res.stdout || '')
	if (!ok && typeof log === 'function') {
		log(
			'warn',
			`[replication] SSH probe ${user}@${host} failed: ${(res.stderr || res.stdout || '').trim() || res.status}`,
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
	if (!repl.enabled || !repl.peer?.host || !repl.peer?.token) {
		return { ok: false, error: 'replication not paired' }
	}
	const local = ensureReplicationSshKey(ctx?.log)
	const { peerHttpRequest, SYNC_REQUEST_TIMEOUT_MS } = require('./peer-client')
	const res = await peerHttpRequest(repl.peer, '/api/replication/exchange-ssh', {
		method: 'POST',
		body: { sshPublicKey: local.publicKeyLine },
		timeoutMs: SYNC_REQUEST_TIMEOUT_MS,
	})
	if (!res.ok) return { ok: false, error: res.error || 'exchange-ssh failed' }
	if (res.json?.sshPublicKey) {
		prepareReplicationSshForPairing(ctx, { peerPublicKey: res.json.sshPublicKey, log: ctx?.log })
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
