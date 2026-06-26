'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

/**
 * @returns {string|null}
 */
function readSyncthingDeviceId() {
	try {
		const out = execFileSync('syncthing', ['--device-id'], { encoding: 'utf8', timeout: 5000 })
		const line = String(out || '')
			.trim()
			.split(/\r?\n/)
			.filter(Boolean)
			.pop()
		return line && line.length > 10 ? line.trim() : null
	} catch {
		/* fall through */
	}
	const home = os.homedir()
	const cfgPath = path.join(home, '.local', 'state', 'syncthing', 'config.xml')
	try {
		if (!fs.existsSync(cfgPath)) return null
		const xml = fs.readFileSync(cfgPath, 'utf8')
		const m = xml.match(/<device[^>]+deviceID="([^"]+)"/)
		return m ? m[1] : null
	} catch {
		return null
	}
}

/**
 * @param {object} ctx
 * @returns {object}
 */
function buildReplicationPairingManifest(ctx) {
	const repl = ctx?.config?.replication
	if (!repl || !repl.enabled) return { enabled: false }
	return {
		enabled: true,
		pairId: repl.pairId || '',
		selfId: repl.selfId || '',
		role: repl.role || 'auto',
		followerMode: repl.followerMode || 'mirror',
		peer: {
			host: repl.peer?.host || '',
			port: repl.peer?.port || 4200,
		},
		syncthingMediaFolderId: repl.syncthingMediaFolderId || 'highascg-media',
		leaderEpoch: repl.leaderEpoch ?? 0,
	}
}

/**
 * @returns {{ connected: boolean, ipv4: string|null, statusLine: string|null }}
 */
function readTailscaleStatus() {
	let ipv4 = null
	let statusLine = null
	try {
		ipv4 = execFileSync('tailscale', ['ip', '-4'], { encoding: 'utf8', timeout: 4000 }).trim() || null
	} catch {
		ipv4 = null
	}
	try {
		statusLine = execFileSync('tailscale', ['status', '--self'], { encoding: 'utf8', timeout: 4000 })
			.trim()
			.split(/\r?\n/)[0]
	} catch {
		statusLine = null
	}
	return { connected: !!ipv4, ipv4, statusLine }
}

/**
 * Refresh export files under host .private before pushing to stick/bridge.
 * @param {string} hostPrivateDir
 * @param {object} ctx
 */
function exportSecretsToPrivateDir(hostPrivateDir, ctx) {
	fs.mkdirSync(hostPrivateDir, { recursive: true, mode: 0o700 })
	const synDir = path.join(hostPrivateDir, 'syncthing')
	const tsDir = path.join(hostPrivateDir, 'tailscale')
	const replDir = path.join(hostPrivateDir, 'replication')
	fs.mkdirSync(synDir, { recursive: true, mode: 0o700 })
	fs.mkdirSync(tsDir, { recursive: true, mode: 0o700 })
	fs.mkdirSync(replDir, { recursive: true, mode: 0o700 })

	const deviceId = readSyncthingDeviceId()
	if (deviceId) {
		fs.writeFileSync(path.join(synDir, 'device-id.txt'), `${deviceId}\n`, { mode: 0o600 })
	}

	const repl = ctx?.config?.replication
	const folders = {
		exportedAt: new Date().toISOString(),
		deviceId: deviceId || null,
		folders: [
			{
				id: repl?.syncthingMediaFolderId || 'highascg-media',
				role: 'media-replication',
			},
		],
	}
	fs.writeFileSync(path.join(synDir, 'folders.json'), JSON.stringify(folders, null, 2) + '\n', { mode: 0o600 })

	const pairing = buildReplicationPairingManifest(ctx)
	fs.writeFileSync(path.join(replDir, 'pairing.json'), JSON.stringify(pairing, null, 2) + '\n', { mode: 0o600 })

	const ts = readTailscaleStatus()
	fs.writeFileSync(
		path.join(tsDir, 'status.json'),
		JSON.stringify({ ...ts, exportedAt: new Date().toISOString() }, null, 2) + '\n',
		{ mode: 0o600 },
	)

	const readme = path.join(hostPrivateDir, 'README.txt')
	if (!fs.existsSync(readme)) {
		fs.writeFileSync(
			readme,
			`HighAsCG private machine folder — Tailscale / Syncthing / replication pairing hints.\n` +
				`Not synced via configs/ or projects/. exFAT is not encrypted — treat stick as physical secret storage.\n`,
			{ mode: 0o600 },
		)
	}
}

module.exports = {
	readSyncthingDeviceId,
	buildReplicationPairingManifest,
	readTailscaleStatus,
	exportSecretsToPrivateDir,
}
