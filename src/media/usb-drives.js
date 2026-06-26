/**
 * USB / removable volume enumeration, sandboxed browse, streamed copy, eject.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const execFileAsync = promisify(execFile)

const Discovery = require('./usb-drives-discovery')
const CopyLogic = require('./usb-drives-copy')

const MEDIA_EXT = new Set([
	'.mp4', '.mov', '.mxf', '.mkv', '.webm', '.avi', '.m4v', '.mpg', '.mpeg', '.wmv',
	'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tga', '.svg',
	'.wav', '.mp3', '.aac', '.m4a', '.flac', '.aiff', '.ogg', '.zip',
])

function encodeDriveId(mountpoint) { return Buffer.from(path.resolve(mountpoint), 'utf8').toString('base64url') }
function decodeDriveId(id) { try { return Buffer.from(id, 'base64url').toString('utf8') || null } catch { return null } }

async function listUsbDrives() { return Discovery.listUsbDrives(encodeDriveId) }
async function getDriveById(id) { const mp = decodeDriveId(id); return mp ? (await listUsbDrives()).find(d => d.mountpoint === path.resolve(mp)) || null : null }

async function listDirectory(driveId, relPath) {
	const drive = await getDriveById(driveId); if (!drive) return { error: 'Drive not found' }
	const full = CopyLogic.resolveUnderMount(drive.mountpoint, relPath); if (!full) return { error: 'Invalid path' }
	try {
		const dirents = fs.readdirSync(full, { withFileTypes: true })
		const baseRel = relPath ? String(relPath).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : ''
		const entries = dirents.map(d => {
			const child = path.join(full, d.name); let st; try { st = fs.lstatSync(child) } catch { return null }
			if (st.isSymbolicLink()) return null
			return { name: d.name, rel: baseRel ? `${baseRel}/${d.name}` : d.name, isDirectory: st.isDirectory(), size: st.isDirectory() ? 0 : st.size }
		}).filter(Boolean).sort((a, b) => a.isDirectory !== b.isDirectory ? (a.isDirectory ? -1 : 1) : a.name.localeCompare(b.name))
		return { path: full, entries }
	} catch (e) { return { error: e.message } }
}

async function listRemovableBlockDevices() {
	return Discovery.listRemovableBlockDevices()
}

async function mountUsbBlockDevice(blockDevice) {
	if (process.platform === 'darwin') {
		return { ok: false, message: 'Mount from UI is not supported on macOS' }
	}
	if (process.platform !== 'linux') return { ok: false, message: 'OS not supported' }
	const dev = String(blockDevice || '').trim()
	if (!/^\/dev\/[a-z0-9]+$/i.test(dev)) return { ok: false, message: 'Invalid device path' }
	const candidates = await listRemovableBlockDevices()
	if (!candidates.some((c) => c.blockDevice === dev)) {
		return { ok: false, message: 'Device is not a removable volume eligible for mount' }
	}
	try {
		const { stdout, stderr } = await execFileAsync(
			'udisksctl',
			['mount', '-b', dev, '--no-user-interaction'],
			{ timeout: 120000 },
		)
		const text = `${stdout || ''}${stderr || ''}`.trim()
		const m = text.match(/\bat\s+(\S+)\s*\.?\s*$/m)
		let mountpoint = m ? m[1].trim() : null
		if (!mountpoint) {
			const drives = await listUsbDrives()
			const hit = drives.find((d) => d.device === dev)
			mountpoint = hit?.mountpoint || null
		}
		return { ok: true, mountpoint, message: text || 'Mounted' }
	} catch (e) {
		const raw = [e.stderr, e.stdout, e.message].filter(Boolean).join(' ').trim() || 'Mount failed'
		const needsPolkit =
			/NotAuthorized|polkit-error|authentication agent|no user interaction/i.test(raw)
		const message = needsPolkit
			? 'USB mount not authorized by polkit. Re-apply USB ingest setup, then restart polkit and HighAsCG: sudo bash scripts/setup/13-usb-ingest.sh casparcg && sudo systemctl restart polkit highascg'
			: raw
		return { ok: false, message, needsPolkit: !!needsPolkit }
	}
}

async function ejectUsb(drive) {
	if (process.platform === 'darwin') {
		try { await execFileAsync('diskutil', ['eject', drive.mountpoint], { timeout: 60000 }); return { ok: true } }
		catch (e) { return { ok: false, message: e.message } }
	}
	if (process.platform !== 'linux') return { ok: false, message: 'OS not supported' }
	const dev = drive.device; if (!dev) return { ok: false, message: 'No device path' }
	try {
		await execFileAsync('udisksctl', ['unmount', '-b', dev], { timeout: 120000 })
		let disk = dev; try { const { stdout } = await execFileAsync('lsblk', ['-no', 'PKNAME', dev]); const pk = stdout.trim(); if (pk) disk = `/dev/${pk}` } catch {}
		await execFileAsync('udisksctl', ['power-off', '-b', disk], { timeout: 120000 })
		return { ok: true }
	} catch (e) { return { ok: false, message: e.message } }
}

function startUsbHotplugWatcher(ctx, options = {}) {
	const interval = options.intervalMs ?? 2000; let lastSig = ''; let timer = null
	const tick = async () => {
		try {
			const drives = await listUsbDrives(); const sig = drives.map(d => d.id).sort().join('|')
			if (sig === lastSig) return
			const prev = new Set(lastSig ? lastSig.split('|') : []); const next = new Set(drives.map(d => d.id))
			for (const id of next) if (!prev.has(id) && ctx._wsBroadcast) ctx._wsBroadcast('usb:attached', { drive: drives.find(d => d.id === id) })
			for (const id of prev) if (id && !next.has(id) && ctx._wsBroadcast) ctx._wsBroadcast('usb:detached', { driveId: id })
			lastSig = sig
		} catch {}
	}
	timer = setInterval(tick, interval); if (timer.unref) timer.unref(); void tick()
	return () => { clearInterval(timer); timer = null }
}

function formatImportSubdirTemplate(template, drive) {
	const label = (drive.label || 'USB').replace(/[/\\?*:|"<>]/g, '_'); const date = new Date().toISOString().slice(0, 10)
	return String(template || '').trim().replace(/\{label\}/g, label).replace(/\{date\}/g, date).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

module.exports = {
	encodeDriveId,
	decodeDriveId,
	listUsbDrives,
	listRemovableBlockDevices,
	mountUsbBlockDevice,
	getDriveById,
	listDirectory,
	collectFilesForImport: CopyLogic.collectFilesForImport,
	copyFromUsb: (ctx, opts) => CopyLogic.copyFromUsb(ctx, opts, getDriveById),
	ejectUsb,
	startUsbHotplugWatcher,
	formatImportSubdirTemplate,
	parseLsblkJson: (jsonText) => Discovery.parseLsblkJson(jsonText, encodeDriveId),
	parseRemovableCandidates: (jsonText) => Discovery.parseRemovableCandidates(jsonText),
	resolveUnderMount: CopyLogic.resolveUnderMount,
	MEDIA_EXT,
}
