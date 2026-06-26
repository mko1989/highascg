'use strict'

const fs = require('fs')
const path = require('path')
const { getMachineId } = require('../config/machine-identity')
const { loadExfatSyncMapFromDisk } = require('./exfat-sync-map')
const { getExfatMountStatus } = require('./exfat-sync-status')
const { walkRelativeFiles, copyFilePreserveTimes } = require('./exfat-sync-fs')
const { exportSecretsToPrivateDir } = require('./private-secrets-export')

const REPO_ROOT = path.resolve(__dirname, '../..')
const PRIVATE_HOST_ROOT = path.join(REPO_ROOT, '.private')
const PRIVATE_VOLUME_DIR = '.private'

/**
 * @param {string} machineId
 */
function hostPrivateDir(machineId) {
	return path.join(PRIVATE_HOST_ROOT, machineId)
}

/**
 * @param {string} volumeMount
 * @param {string} machineId
 */
function volumePrivateDir(volumeMount, machineId) {
	return path.join(path.resolve(volumeMount), PRIVATE_VOLUME_DIR, machineId)
}

/**
 * @param {string} abs
 * @param {string} root
 */
function assertUnderRoot(root, abs) {
	const r = path.resolve(root)
	const a = path.resolve(abs)
	if (a !== r && !a.startsWith(r + path.sep)) {
		throw new Error(`path escapes private root: ${a}`)
	}
}

/**
 * Sync one file with mtime-wins bidirectional.
 */
function syncFileMtime(a, b, dryRun) {
	let stA = null
	let stB = null
	try {
		stA = fs.statSync(a)
	} catch {}
	try {
		stB = fs.statSync(b)
	} catch {}
	const hasA = stA?.isFile()
	const hasB = stB?.isFile()
	if (!hasA && !hasB) return { copied: 0, skipped: 1 }
	if (hasA && !hasB) {
		if (!dryRun) {
			copyFilePreserveTimes(a, b)
		}
		return { copied: 1, skipped: 0 }
	}
	if (!hasA && hasB) {
		if (!dryRun) {
			copyFilePreserveTimes(b, a)
		}
		return { copied: 1, skipped: 0 }
	}
	const mA = stA.mtimeMs
	const mB = stB.mtimeMs
	if (mA === mB) return { copied: 0, skipped: 1 }
	if (mA > mB) {
		if (!dryRun) copyFilePreserveTimes(a, b)
	} else if (!dryRun) copyFilePreserveTimes(b, a)
	return { copied: 1, skipped: 0 }
}

/**
 * @param {string} hostDir
 * @param {string} volDir
 * @param {{ dryRun?: boolean, boot?: boolean, preferVolume?: boolean }} opts
 */
function syncPrivateTree(hostDir, volDir, opts = {}) {
	const dryRun = !!opts.dryRun
	const preferVolume = !!opts.preferVolume
	let copied = 0
	let skipped = 0

	assertUnderRoot(PRIVATE_HOST_ROOT, hostDir)
	fs.mkdirSync(hostDir, { recursive: true, mode: 0o700 })
	fs.mkdirSync(volDir, { recursive: true, mode: 0o700 })

	const rels = new Set()
	if (fs.existsSync(hostDir)) {
		for (const r of walkRelativeFiles(hostDir, () => false)) rels.add(r)
	}
	if (fs.existsSync(volDir)) {
		for (const r of walkRelativeFiles(volDir, () => false)) rels.add(r)
	}

	for (const rel of rels) {
		const h = path.join(hostDir, rel)
		const v = path.join(volDir, rel)
		assertUnderRoot(hostDir, h)
		assertUnderRoot(volDir, v)

		let stH = null
		let stV = null
		try {
			stH = fs.statSync(h)
		} catch {}
		try {
			stV = fs.statSync(v)
		} catch {}

		if (preferVolume && stV?.isFile()) {
			if (!dryRun) copyFilePreserveTimes(v, h)
			copied += 1
			continue
		}
		if (stH?.isDirectory() || stV?.isDirectory()) continue

		const r = syncFileMtime(h, v, dryRun)
		copied += r.copied
		skipped += r.skipped
	}

	return { copied, skipped }
}

/**
 * @param {object} opts
 * @param {object} [opts.ctx]
 * @param {boolean} [opts.boot]
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.pushOnly]
 * @param {(lvl: string, msg: string) => void} [opts.log]
 */
async function runPrivateVolumeSync(opts = {}) {
	const log = opts.log || (() => {})
	const dryRun = !!opts.dryRun
	const boot = !!opts.boot
	const pushOnly = !!opts.pushOnly
	const ctx = opts.ctx || {}
	const machineId = getMachineId(ctx)
	const hostDir = hostPrivateDir(machineId)

	if (!pushOnly && !dryRun) {
		try {
			exportSecretsToPrivateDir(hostDir, ctx)
		} catch (e) {
			log('warn', `[private-sync] export: ${e?.message || e}`)
		}
	}

	const loaded = loadExfatSyncMapFromDisk()
	const volumes = loaded.map?.volumes || {}
	/** @type {Array<{ id: string, mount: string, mounted: boolean, copied: number, skipped: number }>} */
	const results = []
	let totalCopied = 0
	let totalSkipped = 0
	/** @type {string[]} */
	const errors = []

	const order = ['bridge', 'usb']
	for (const key of order) {
		const vol = volumes[key]
		if (!vol?.mount) continue
		const mount = await getExfatMountStatus(vol.mount)
		if (!mount.mounted) {
			log('info', `[private-sync] ${key}: not mounted at ${vol.mount}`)
			results.push({ id: key, mount: vol.mount, mounted: false, copied: 0, skipped: 0 })
			continue
		}
		const volDir = volumePrivateDir(vol.mount, machineId)
		try {
			const preferVolume = boot && key === 'usb'
			const pushHostToVolume = pushOnly
			let copied = 0
			let skipped = 0
			if (pushHostToVolume) {
				const rels = fs.existsSync(hostDir) ? walkRelativeFiles(hostDir, () => false) : []
				for (const rel of rels) {
					const h = path.join(hostDir, rel)
					const v = path.join(volDir, rel)
					if (!dryRun) copyFilePreserveTimes(h, v)
					copied += 1
				}
			} else {
				const r = syncPrivateTree(hostDir, volDir, { dryRun, boot, preferVolume })
				copied = r.copied
				skipped = r.skipped
			}
			totalCopied += copied
			totalSkipped += skipped
			log('info', `[private-sync] ${key} machine=${machineId} copied=${copied} skipped=${skipped}`)
			results.push({ id: key, mount: vol.mount, mounted: true, copied, skipped, volumePath: volDir })
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			errors.push(`${key}: ${msg}`)
			log('warn', `[private-sync] ${key}: ${msg}`)
		}
	}

	return {
		ok: errors.length === 0,
		machineId,
		hostDir,
		boot,
		dryRun,
		copied: totalCopied,
		skipped: totalSkipped,
		volumes: results,
		errors,
	}
}

/**
 * @param {object} ctx
 */
async function getPrivateSyncDashboard(ctx) {
	const machineId = getMachineId(ctx)
	const hostDir = hostPrivateDir(machineId)
	const loaded = loadExfatSyncMapFromDisk()
	const volumes = loaded.map?.volumes || {}
	/** @type {Record<string, object>} */
	const out = {}

	for (const [key, vol] of Object.entries(volumes)) {
		const mount = vol?.mount ? await getExfatMountStatus(vol.mount) : { mounted: false }
		const volDir = vol?.mount ? volumePrivateDir(vol.mount, machineId) : null
		let fileCount = 0
		if (volDir && fs.existsSync(volDir)) {
			fileCount = walkRelativeFiles(volDir, () => false).length
		}
		out[key] = {
			mount: vol?.mount,
			mounted: mount.mounted,
			volumePrivatePath: volDir,
			fileCount,
		}
	}

	const { readSyncthingDeviceId, readTailscaleStatus } = require('./private-secrets-export')
	return {
		machineId,
		hostPrivatePath: hostDir,
		hostFileCount: fs.existsSync(hostDir) ? walkRelativeFiles(hostDir, () => false).length : 0,
		volumes: out,
		syncthingDeviceId: readSyncthingDeviceId(),
		tailscale: readTailscaleStatus(),
		note: 'Private folder holds per-machine Tailscale/Syncthing/replication pairing — not synced via configs/ or Syncthing repo folder.',
	}
}

module.exports = {
	REPO_ROOT,
	PRIVATE_HOST_ROOT,
	PRIVATE_VOLUME_DIR,
	hostPrivateDir,
	volumePrivateDir,
	syncPrivateTree,
	runPrivateVolumeSync,
	getPrivateSyncDashboard,
}
