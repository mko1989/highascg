'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { loadExfatSyncMapFromDisk } = require('../system/exfat-sync-map')
const { copyFilePreserveTimes } = require('../system/exfat-sync-fs')
const { shouldAllowExfatPullShowData } = require('../replication/replication-show-authority')

const PROJECTS_SUBDIR = 'projects'
const AUTOSAVE_SUBDIR = '_autosave'

/** @typedef {{ slug: string, name: string, savedAt: string | null, path: string, source: string }} ProjectCatalogEntry */

function isVolumeMountedSync(mountPath) {
	if (process.platform !== 'linux') return false
	const target = path.resolve(String(mountPath || ''))
	if (!target) return false
	try {
		const out = execFileSync('findmnt', ['-n', '-o', 'TARGET', '-T', target], {
			encoding: 'utf8',
			timeout: 3000,
		}).trim()
		return path.resolve(out) === target
	} catch {
		return false
	}
}

/**
 * @returns {{ usb: string | null, bridge: string | null, local: string }}
 */
function getProjectRoots() {
	const { REPO_ROOT } = require('../repo-paths')
	const loaded = loadExfatSyncMapFromDisk()
	const vols = loaded.map?.volumes || {}
	return {
		usb: vols.usb?.mount ? path.resolve(vols.usb.mount) : null,
		bridge: vols.bridge?.mount ? path.resolve(vols.bridge.mount) : null,
		local: path.join(REPO_ROOT, PROJECTS_SUBDIR),
	}
}

function volumeProjectsDir(mountRoot) {
	return path.join(mountRoot, PROJECTS_SUBDIR)
}

/**
 * @param {string} projectsDir
 * @param {string} source
 * @returns {ProjectCatalogEntry[]}
 */
function scanProjectsDir(projectsDir, source) {
	/** @type {ProjectCatalogEntry[]} */
	const out = []
	if (!projectsDir || !fs.existsSync(projectsDir)) return out
	let names
	try {
		names = fs.readdirSync(projectsDir)
	} catch {
		return out
	}
	for (const ent of names) {
		if (!ent.endsWith('.json')) continue
		if (ent.startsWith('.')) continue
		const slug = ent.slice(0, -5)
		if (!slug || slug === AUTOSAVE_SUBDIR) continue
		const p = path.join(projectsDir, ent)
		let project
		try {
			project = JSON.parse(fs.readFileSync(p, 'utf8'))
		} catch {
			continue
		}
		if (!project || typeof project !== 'object') continue
		out.push({
			slug,
			name: String(project.name || slug),
			savedAt: project.savedAt || null,
			path: p,
			source,
		})
	}
	return out
}

/**
 * Merge catalogs; newest savedAt wins per slug. When USB is mounted its entries take
 * precedence on equal timestamps (stick is the field catalog).
 * @param {ProjectCatalogEntry[]} lists
 * @param {{ usbMounted?: boolean }} [opts]
 */
function mergeProjectCatalogs(lists, opts = {}) {
	/** @type {Map<string, ProjectCatalogEntry>} */
	const bySlug = new Map()
	const rank = (source) => {
		if (opts.usbMounted && source === 'usb') return 3
		if (source === 'bridge') return 2
		if (source === 'local') return 1
		if (source === 'usb') return 2
		return 0
	}
	for (const list of lists) {
		for (const entry of list) {
			const prev = bySlug.get(entry.slug)
			if (!prev) {
				bySlug.set(entry.slug, entry)
				continue
			}
			const tNew = Date.parse(entry.savedAt || '') || 0
			const tOld = Date.parse(prev.savedAt || '') || 0
			if (tNew > tOld || (tNew === tOld && rank(entry.source) >= rank(prev.source))) {
				bySlug.set(entry.slug, entry)
			}
		}
	}
	return [...bySlug.values()].sort((a, b) => {
		const ta = Date.parse(a.savedAt || '') || 0
		const tb = Date.parse(b.savedAt || '') || 0
		return tb - ta
	})
}

/**
 * List projects for the UI: USB catalog when stick mounted, plus bridge/local merge.
 */
function listProjectsFromVolumes() {
	const roots = getProjectRoots()
	/** @type {ProjectCatalogEntry[][]} */
	const lists = []
	const usbMounted = !!(roots.usb && isVolumeMountedSync(roots.usb))
	const bridgeMounted = !!(roots.bridge && isVolumeMountedSync(roots.bridge))

	if (usbMounted && roots.usb) {
		lists.push(scanProjectsDir(volumeProjectsDir(roots.usb), 'usb'))
	} else {
		lists.push(scanProjectsDir(roots.local, 'local'))
	}
	if (bridgeMounted && roots.bridge) {
		lists.push(scanProjectsDir(volumeProjectsDir(roots.bridge), 'bridge'))
	}

	const merged = mergeProjectCatalogs(lists, { usbMounted })
	return merged.map(({ slug, name, savedAt, path: filePath, source }) => ({
		slug,
		name,
		savedAt,
		path: filePath,
		source,
	}))
}

function copyIfExists(src, dst) {
	if (!fs.existsSync(src)) return false
	fs.mkdirSync(path.dirname(dst), { recursive: true })
	copyFilePreserveTimes(src, dst)
	return true
}

/**
 * Copy `src` → `dst` when source is newer than destination (or dest missing).
 * @returns {boolean}
 */
function copyIfSrcNewer(src, dst) {
	if (!fs.existsSync(src)) return false
	let stSrc
	try {
		stSrc = fs.statSync(src)
	} catch {
		return false
	}
	let stDst = null
	try {
		stDst = fs.statSync(dst)
	} catch {
		stDst = null
	}
	if (stDst && stDst.mtimeMs >= stSrc.mtimeMs && stDst.size >= stSrc.size) return false
	fs.mkdirSync(path.dirname(dst), { recursive: true })
	copyFilePreserveTimes(src, dst)
	return true
}

/**
 * Push one saved project (and its autosave) to mounted USB and/or bridge.
 * Never bulk-copies the whole projects/ tree — only the slug being saved.
 * @param {string} slug
 * @param {{ log?: (lvl: string, msg: string) => void }} [opts]
 */
function pushProjectSlugToVolumes(slug, opts = {}) {
	const log = opts.log || (() => {})
	const s = String(slug || '').trim()
	if (!s) return { usb: false, bridge: false }

	const roots = getProjectRoots()
	const localDir = roots.local
	const localFile = path.join(localDir, `${s}.json`)
	const localAutosave = path.join(localDir, AUTOSAVE_SUBDIR, `${s}.json`)

	let usb = false
	let bridge = false

	if (roots.usb && isVolumeMountedSync(roots.usb)) {
		const usbDir = volumeProjectsDir(roots.usb)
		if (copyIfExists(localFile, path.join(usbDir, `${s}.json`))) usb = true
		if (copyIfExists(localAutosave, path.join(usbDir, AUTOSAVE_SUBDIR, `${s}.json`))) usb = true
		if (usb) log('info', `[project] pushed ${s}.json → USB (${roots.usb}/projects/)`)
	}

	if (roots.bridge && isVolumeMountedSync(roots.bridge)) {
		const bridgeDir = volumeProjectsDir(roots.bridge)
		if (copyIfExists(localFile, path.join(bridgeDir, `${s}.json`))) bridge = true
		if (copyIfExists(localAutosave, path.join(bridgeDir, AUTOSAVE_SUBDIR, `${s}.json`))) bridge = true
		if (bridge) log('info', `[project] pushed ${s}.json → bridge (${roots.bridge}/projects/)`)
	}

	return { usb, bridge }
}

/**
 * After boot/volume sync, refresh working copy of one slug from USB if newer.
 * @param {string} slug
 */
function pullProjectSlugFromUsbIfNewer(slug) {
	if (!shouldAllowExfatPullShowData()) return false
	const roots = getProjectRoots()
	if (!roots.usb || !isVolumeMountedSync(roots.usb)) return false
	const s = String(slug || '').trim()
	if (!s) return false
	const usbFile = path.join(volumeProjectsDir(roots.usb), `${s}.json`)
	const localFile = path.join(roots.local, `${s}.json`)
	return copyIfSrcNewer(usbFile, localFile)
}

/**
 * After boot / before load: refresh working autosave from USB or bridge (newest wins).
 * @param {string} slug
 */
function pullAutosaveSlugFromVolumesIfNewer(slug) {
	if (!shouldAllowExfatPullShowData()) return false
	const roots = getProjectRoots()
	const s = String(slug || '').trim()
	if (!s) return false
	const localFile = path.join(roots.local, AUTOSAVE_SUBDIR, `${s}.json`)
	/** @type {string[]} */
	const sources = []
	if (roots.usb && isVolumeMountedSync(roots.usb)) {
		sources.push(path.join(volumeProjectsDir(roots.usb), AUTOSAVE_SUBDIR, `${s}.json`))
	}
	if (roots.bridge && isVolumeMountedSync(roots.bridge)) {
		sources.push(path.join(volumeProjectsDir(roots.bridge), AUTOSAVE_SUBDIR, `${s}.json`))
	}
	let best = ''
	let bestMtime = -1
	for (const src of sources) {
		if (!fs.existsSync(src)) continue
		try {
			const st = fs.statSync(src)
			if (st.mtimeMs > bestMtime) {
				bestMtime = st.mtimeMs
				best = src
			}
		} catch {
			/* skip */
		}
	}
	if (!best) return false
	return copyIfSrcNewer(best, localFile)
}

module.exports = {
	PROJECTS_SUBDIR,
	AUTOSAVE_SUBDIR,
	getProjectRoots,
	isVolumeMountedSync,
	volumeProjectsDir,
	scanProjectsDir,
	mergeProjectCatalogs,
	listProjectsFromVolumes,
	pushProjectSlugToVolumes,
	pullProjectSlugFromUsbIfNewer,
	pullAutosaveSlugFromVolumesIfNewer,
	copyIfSrcNewer,
}
