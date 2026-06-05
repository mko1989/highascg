/**
 * exFAT mount status and Settings dashboard view (WO-52 multi-volume).
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

const {
	loadExfatSyncMapFromDisk,
	assertSafeProjectPath,
	assertUnderExfat,
	resolvePairExfatRoot,
} = require('./exfat-sync-map')

/** @returns {Promise<{ mounted: boolean, source?: string, fstype?: string, target: string, inheritsFromFilesystem?: string }>} */
async function getExfatMountStatus(exfatRoot) {
	const target = path.resolve(exfatRoot)
	if (process.platform !== 'linux') {
		return { mounted: false, target }
	}
	try {
		const { stdout } = await execFileAsync(
			'findmnt',
			['-J', '-o', 'SOURCE,TARGET,FSTYPE', '-T', target],
			{ timeout: 5000 },
		).catch(() => ({ stdout: '' }))
		if (!stdout) return { mounted: false, target }
		const data = JSON.parse(stdout)
		const f = Array.isArray(data.filesystems) ? data.filesystems[0] : null
		if (!f) return { mounted: false, target }
		const tgt = String(f.target || '').trim()
		const mountedHere = tgt === target
		let source = String(f.source || '').trim()
		let fstype = String(f.fstype || '').trim()
		if (mountedHere && (!source || !fstype)) {
			try {
				const { stdout: plain } = await execFileAsync(
					'findmnt',
					['-n', '-o', 'SOURCE,FSTYPE', '-T', target],
					{ timeout: 3000 },
				)
				const parts = String(plain || '').trim().split(/\s+/)
				if (!source && parts[0]) source = parts[0]
				if (!fstype && parts[1]) fstype = parts[1]
			} catch {
				/* keep JSON fields */
			}
		}
		return {
			mounted: mountedHere,
			target,
			source: source || undefined,
			fstype: fstype || undefined,
			...(mountedHere ? {} : { inheritsFromFilesystem: tgt || undefined }),
		}
	} catch {
		return { mounted: false, target }
	}
}

async function buildVolumeViews(map) {
	/** @type {Record<string, object>} */
	const volumes = {}
	for (const [key, vol] of Object.entries(map.volumes || {})) {
		const mount = await getExfatMountStatus(vol.mount)
		let mediaMountStatus = null
		if (vol.mediaMount) {
			mediaMountStatus = await getExfatMountStatus(vol.mediaMount)
		}
		volumes[key] = {
			id: vol.id,
			label: vol.label || key,
			mount: vol.mount,
			mediaMount: vol.mediaMount,
			mounted: mount.mounted,
			mountSource: mount.source,
			mountFstype: mount.fstype,
			mediaMounted: mediaMountStatus?.mounted,
			mediaMountSource: mediaMountStatus?.source,
		}
	}
	return volumes
}

async function buildPairView(loaded) {
	const map = loaded.map
	const volumes = await buildVolumeViews(map)
	const exfatRoot = map.exfatRoot ? path.resolve(map.exfatRoot) : '/home/casparcg/exfat'
	const usbMount = volumes.usb || (await getExfatMountStatus(exfatRoot))

	const out = []
	for (const p of map.pairs || []) {
		const id = String(p.id || '').trim()
		const exfatRel = String(p.exfat || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
		const projectPath = String(p.project || '').trim()
		const direction = String(p.direction || 'both').toLowerCase()
		const exclude = Array.isArray(p.exclude) ? p.exclude.map((x) => String(x)) : []
		const volume = String(p.volume || 'usb')
		const pairExfatRoot = resolvePairExfatRoot(map, p)
		let exfatAbs = ''
		let projectAbs = ''
		let pairError = ''
		try {
			exfatAbs = path.join(pairExfatRoot, exfatRel)
			projectAbs = path.resolve(projectPath)
			assertUnderExfat(pairExfatRoot, exfatAbs)
			assertSafeProjectPath(projectAbs)
		} catch (e) {
			pairError = e instanceof Error ? e.message : String(e)
		}
		let exfatExists = false
		let projectExists = false
		let exfatIsDirectory = false
		let projectIsDirectory = false
		let exfatIsFile = false
		let projectIsFile = false
		if (!pairError && exfatAbs) {
			try {
				const st = fs.statSync(exfatAbs)
				exfatExists = true
				exfatIsDirectory = st.isDirectory()
				exfatIsFile = st.isFile()
			} catch {
				exfatExists = false
			}
			try {
				const st = fs.statSync(projectAbs)
				projectExists = true
				projectIsDirectory = st.isDirectory()
				projectIsFile = st.isFile()
			} catch {
				projectExists = false
			}
		}
		const volView = volumes[volume]
		out.push({
			id,
			volume,
			label: String(p.label || id),
			direction,
			exclude,
			exfatRelative: exfatRel,
			projectPath,
			exfatAbs,
			projectAbs,
			volumeMount: pairExfatRoot,
			volumeMounted: volView?.mounted === true,
			exfatExists,
			projectExists,
			exfatIsDirectory,
			projectIsDirectory,
			exfatIsFile,
			projectIsFile,
			pairError: pairError || undefined,
		})
	}

	return {
		exfatRoot,
		volumes,
		mapPath: loaded.mapPath || '',
		mapLoadError: loaded.loadError,
		mounted: usbMount.mounted,
		mountSource: usbMount.source,
		mountFstype: usbMount.fstype,
		mountTarget: usbMount.target,
		inheritsFromFilesystem: usbMount.inheritsFromFilesystem,
		pairs: out,
	}
}

async function getExfatSyncDashboard() {
	if (process.platform !== 'linux') {
		return { unsupported: true, exfatRoot: '/home/casparcg/exfat', pairs: [], volumes: {} }
	}
	const loaded = loadExfatSyncMapFromDisk()
	const dash = { unsupported: false, ...(await buildPairView(loaded)) }
	if (loaded.loadError) dash.mapLoadError = loaded.loadError
	return dash
}

module.exports = {
	getExfatMountStatus,
	buildPairView,
	getExfatSyncDashboard,
}
