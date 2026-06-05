/**
 * Platform-specific USB/removable drive discovery.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

function isAllowedMountpoint(mp, platform) {
	if (!mp || typeof mp !== 'string') return false
	const norm = path.resolve(mp)
	if (platform === 'darwin') return norm.startsWith('/Volumes/') && !norm.startsWith('/Volumes/Macintosh HD')
	return norm.startsWith('/media/') || norm.startsWith('/run/media/') || norm.startsWith('/mnt/')
}

function flattenLsblk(nodes, acc = []) {
	if (!Array.isArray(nodes)) return acc
	for (const n of nodes) {
		if (n && typeof n === 'object') acc.push(n)
		if (n && typeof n === 'object' && Array.isArray(n.children)) flattenLsblk(n.children, acc)
	}
	return acc
}

function parseLsblkJson(jsonText, encodeDriveId) {
	let root; try { root = JSON.parse(jsonText) } catch { return [] }
	const flat = flattenLsblk(root.blockdevices || [])
	const out = []
	for (const n of flat) {
		const mp = n.mountpoint || null
		if (!mp || !isAllowedMountpoint(mp, 'linux')) continue
		const name = String(n.name || ''); if (name.startsWith('loop')) continue
		const removable = (n.rm === true || n.rm === 1 || n.rm === 'true') || (n.hotplug === true || n.hotplug === 1) || String(n.tran).toLowerCase() === 'usb'
		const fsType = n.fstype || n.fsType || ''
		if (!removable && !['vfat', 'fat32', 'exfat', 'ntfs', 'fuseblk'].includes(String(fsType).toLowerCase())) continue
		out.push({
			id: encodeDriveId(mp), label: n.label || path.basename(mp), mountpoint: path.resolve(mp),
			size: String(n.size || ''), fsType, removable: true, readOnly: n.ro === true || n.ro === 1 || String(n.mode).includes('ro'),
			device: name.startsWith('/') ? name : `/dev/${name}`, platform: 'linux'
		})
	}
	return out
}

function runLsblkJson() {
	return new Promise(resolve => {
		const child = spawn('lsblk', ['-J', '-o', 'NAME,TYPE,SIZE,MOUNTPOINT,LABEL,RM,HOTPLUG,RO,TRAN,FSTYPE'], { stdio: ['ignore', 'pipe', 'pipe'] })
		let out = ''; child.stdout.on('data', c => { out += c })
		child.on('close', () => resolve(out || '{"blockdevices":[]}'))
	})
}

function listLinuxFallbackMounts(encodeDriveId) {
	const roots = ['/media', '/run/media', '/mnt']; const out = []; const seen = new Set()
	for (const root of roots) {
		if (!fs.existsSync(root)) continue
		try {
			const sub = fs.readdirSync(root, { withFileTypes: true })
			for (const d of sub) {
				if (!d.isDirectory()) continue
				const p1 = path.join(root, d.name)
				const inner = fs.readdirSync(p1, { withFileTypes: true })
				for (const d2 of inner) {
					const mp = path.resolve(path.join(p1, d2.name))
					if (!d2.isDirectory() || !isAllowedMountpoint(mp, 'linux') || seen.has(mp)) continue
					seen.add(mp); let ro = false; try { fs.accessSync(mp, fs.constants.W_OK) } catch { ro = true }
					out.push({ id: encodeDriveId(mp), label: d2.name, mountpoint: mp, size: '', fsType: '', removable: true, readOnly: ro, device: '', platform: 'linux-fallback' })
				}
			}
		} catch {}
	}
	return out
}

function listDarwinVolumes(encodeDriveId) {
	const vol = '/Volumes'; if (!fs.existsSync(vol)) return []
	try {
		return fs.readdirSync(vol, { withFileTypes: true })
			.filter(d => d.isDirectory() && isAllowedMountpoint(path.join(vol, d.name), 'darwin'))
			.map(d => {
				const mp = path.resolve(path.join(vol, d.name)); let ro = false; try { fs.accessSync(mp, fs.constants.W_OK) } catch { ro = true }
				return { id: encodeDriveId(mp), label: d.name, mountpoint: mp, size: '', fsType: '', removable: true, readOnly: ro, device: '', platform: 'darwin' }
			})
	} catch { return [] }
}

async function listUsbDrives(encodeDriveId) {
	if (process.platform === 'win32') return []
	if (process.platform === 'darwin') return listDarwinVolumes(encodeDriveId)
	const json = await runLsblkJson(); let drives = parseLsblkJson(json, encodeDriveId)
	return drives.length ? drives : listLinuxFallbackMounts(encodeDriveId)
}

module.exports = { listUsbDrives, parseLsblkJson }
