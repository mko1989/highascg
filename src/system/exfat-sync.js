/**
 * WO-47: exFAT ↔ project mtime-priority sync + status for Settings UI.
 * Map: HIGHASCG_EXFAT_SYNC_MAP, else /etc/highascg/exfat-sync.json, else <repo>/config/exfat-sync.json
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

/** @type {readonly string[]} */
const DEFAULT_PROJECT_ROOT_PREFIX = '/home/casparcg/highascg'

/**
 * @param {string} rel
 * @param {string[]} excludes
 */
function isExcluded(rel, excludes) {
	const norm = rel.replace(/\\/g, '/').replace(/^\/+/, '')
	const parts = norm.split('/').filter(Boolean)
	for (const rule of excludes || []) {
		const r = String(rule || '').replace(/\\/g, '/').replace(/^\/+/, '')
		if (!r) continue
		if (parts.includes(r)) return true
		if (norm === r || norm.startsWith(`${r}/`)) return true
	}
	return false
}

/**
 * @param {unknown} m
 * @returns {{ version: number, exfatRoot: string, pairs: object[] }}
 */
function validateMap(m) {
	if (!m || typeof m !== 'object') throw new Error('exfat-sync map: not an object')
	const pairs = /** @type {unknown} */ (m).pairs
	if (!Array.isArray(pairs)) throw new Error('exfat-sync map: pairs must be an array')
	for (const p of pairs) {
		if (!p || typeof p !== 'object') throw new Error('exfat-sync map: invalid pair entry')
		const id = String(p.id || '').trim()
		const exfat = String(p.exfat || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
		const proj = String(p.project || '').trim()
		if (!id) throw new Error('exfat-sync map: pair missing id')
		if (!exfat) throw new Error(`exfat-sync map: pair ${id} missing exfat`)
		if (!proj) throw new Error(`exfat-sync map: pair ${id} missing project`)
		const dir = String(p.direction || 'both').toLowerCase()
		if (!['both', 'to_project', 'to_exfat'].includes(dir)) {
			throw new Error(`exfat-sync map: pair ${id} invalid direction`)
		}
		if (p.exclude !== undefined && !Array.isArray(p.exclude)) {
			throw new Error(`exfat-sync map: pair ${id} exclude must be an array of strings`)
		}
	}
	const root = String(m.exfatRoot || '/home/casparcg/exfat').trim() || '/home/casparcg/exfat'
	const version = Number(m.version) || 1
	return { version, exfatRoot: path.resolve(root), pairs }
}

function mapCandidatePaths() {
	const { REPO_ROOT } = require('../repo-paths')
	const repoDefault = path.join(REPO_ROOT, 'config/exfat-sync.json')
	const env = process.env.HIGHASCG_EXFAT_SYNC_MAP
	const list = []
	if (env) list.push(path.resolve(env))
	list.push('/etc/highascg/exfat-sync.json')
	list.push(repoDefault)
	return list
}

function loadExfatSyncMapFromDisk() {
	/** @type {{ path: string, error: string }[]} */
	const tried = []
	for (const p of mapCandidatePaths()) {
		try {
			if (!p || !fs.existsSync(p)) {
				tried.push({ path: p || '(empty)', error: 'missing' })
				continue
			}
			const st = fs.statSync(p)
			if (!st.isFile()) {
				tried.push({ path: p, error: 'not a file' })
				continue
			}
			const raw = fs.readFileSync(p, 'utf8')
			const parsed = JSON.parse(raw)
			const map = validateMap(parsed)
			return { mapPath: p, map }
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			tried.push({ path: p || '(empty)', error: msg })
		}
	}
	const summary = tried.length ? tried.map((t) => `${t.path}: ${t.error}`).join('; ') : 'no candidates'
	return {
		mapPath: '',
		map: { version: 1, exfatRoot: '/home/casparcg/exfat', pairs: [] },
		loadError: `no valid exfat-sync map (${summary})`,
	}
}

/**
 * @param {string} projectAbs
 */
function assertSafeProjectPath(projectAbs) {
	const r = path.resolve(projectAbs)
	if (!r.startsWith(DEFAULT_PROJECT_ROOT_PREFIX + path.sep) && r !== DEFAULT_PROJECT_ROOT_PREFIX) {
		throw new Error(`Refusing sync: project path must be under ${DEFAULT_PROJECT_ROOT_PREFIX}: ${r}`)
	}
}

/**
 * @param {string} exfatRoot
 * @param {string} abs
 */
function assertUnderExfat(exfatRoot, abs) {
	const root = path.resolve(exfatRoot)
	const a = path.resolve(abs)
	if (a !== root && !a.startsWith(root + path.sep)) {
		throw new Error(`Refusing sync: path escapes exfat root: ${a}`)
	}
}

/** @returns {Promise<{ mounted: boolean, source?: string, fstype?: string, target: string }>} */
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
		return {
			mounted: mountedHere,
			target,
			source: String(f.source || '').trim() || undefined,
			fstype: String(f.fstype || '').trim() || undefined,
			...(mountedHere ? {} : { inheritsFromFilesystem: tgt || undefined }),
		}
	} catch {
		return { mounted: false, target }
	}
}

/**
 * @param {{ mapPath: string, map: object | null, loadError?: string }} loaded
 */
async function buildPairView(loaded) {
	const exfatRoot = loaded.map?.exfatRoot ? path.resolve(loaded.map.exfatRoot) : '/home/casparcg/exfat'
	const mount = await getExfatMountStatus(exfatRoot)
	const pairs = Array.isArray(loaded.map?.pairs) ? loaded.map.pairs : []

	const out = []
	for (const p of pairs) {
		const id = String(p.id || '').trim()
		const exfatRel = String(p.exfat || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
		const projectPath = String(p.project || '').trim()
		const direction = String(p.direction || 'both').toLowerCase()
		const exclude = Array.isArray(p.exclude) ? p.exclude.map((x) => String(x)) : []
		let exfatAbs = ''
		let projectAbs = ''
		let pairError = ''
		try {
			exfatAbs = path.join(exfatRoot, exfatRel)
			projectAbs = path.resolve(projectPath)
			assertUnderExfat(exfatRoot, exfatAbs)
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
		out.push({
			id,
			label: String(p.label || id),
			direction,
			exclude,
			exfatRelative: exfatRel,
			projectPath,
			exfatAbs,
			projectAbs,
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
		mapPath: loaded.mapPath || '',
		mapLoadError: loaded.loadError,
		mounted: mount.mounted,
		mountSource: mount.source,
		mountFstype: mount.fstype,
		mountTarget: mount.target,
		inheritsFromFilesystem: mount.inheritsFromFilesystem,
		pairs: out,
	}
}

/**
 * @returns {Promise<object>}
 */
async function getExfatSyncDashboard() {
	if (process.platform !== 'linux') {
		return { unsupported: true, exfatRoot: '/home/casparcg/exfat', pairs: [] }
	}
	const loaded = loadExfatSyncMapFromDisk()
	const dash = { unsupported: false, ...(await buildPairView(loaded)) }
	if (loaded.loadError) dash.mapLoadError = loaded.loadError
	return dash
}

/**
 * @param {string} dir
 * @param {(rel: string) => boolean} excludePred
 * @returns {string[]}
 */
function walkRelativeFiles(dir, excludePred) {
	/** @type {string[]} */
	const files = []
	function walk(abs, rel) {
		let st
		try {
			st = fs.statSync(abs)
		} catch {
			return
		}
		if (st.isFile()) {
			if (!excludePred(rel)) files.push(rel)
			return
		}
		if (!st.isDirectory()) return
		let names
		try {
			names = fs.readdirSync(abs)
		} catch {
			return
		}
		for (const name of names) {
			const relNext = rel ? `${rel}/${name}` : name
			if (excludePred(relNext)) continue
			walk(path.join(abs, name), relNext)
		}
	}
	walk(path.resolve(dir), '')
	return files.sort()
}

/**
 * @param {string} src
 * @param {string} dst
 */
function copyFilePreserveTimes(src, dst) {
	fs.mkdirSync(path.dirname(dst), { recursive: true })
	fs.copyFileSync(src, dst)
	const st = fs.statSync(src)
	fs.utimesSync(dst, st.atime, st.mtime)
}

/**
 * @param {{ dryRun?: boolean, log?: (lvl: string, m: string) => void }} opts
 * @returns {Promise<{ copied: number, skipped: number, errors: string[] }>}
 */
async function runExfatSync(opts) {
	const log = opts?.log || (() => {})
	const dryRun = !!opts?.dryRun
	const loaded = loadExfatSyncMapFromDisk()
	if (!loaded.mapPath) {
		const msg = loaded.loadError || 'no exfat sync map'
		log('warn', `[exfat-sync] ${msg}`)
		return { copied: 0, skipped: 0, errors: [msg] }
	}
	const exfatRoot = path.resolve(loaded.map.exfatRoot || '/home/casparcg/exfat')
	const mount = await getExfatMountStatus(exfatRoot)
	if (!mount.mounted) {
		const msg = `[exfat-sync] ${exfatRoot} is not a mount point — refusing sync (WO-47 safety)`
		log('warn', msg)
		return { copied: 0, skipped: 0, errors: [msg] }
	}

	let copied = 0
	let skipped = 0
	/** @type {string[]} */
	const errors = []

	for (const p of loaded.map.pairs) {
		const id = String(p.id || '').trim()
		const exfatRel = String(p.exfat || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
		const projectPath = String(p.project || '').trim()
		const direction = String(p.direction || 'both').toLowerCase()
		const excludes = Array.isArray(p.exclude) ? p.exclude.map((x) => String(x)) : []
		const exPred = (rel) => isExcluded(rel, excludes)

		let exfatAbs
		let projectAbs
		try {
			exfatAbs = path.join(exfatRoot, exfatRel)
			projectAbs = path.resolve(projectPath)
			assertUnderExfat(exfatRoot, exfatAbs)
			assertSafeProjectPath(projectAbs)
		} catch (e) {
			errors.push(`${id}: ${e instanceof Error ? e.message : e}`)
			continue
		}

		let exSt
		let prSt
		try {
			exSt = fs.statSync(exfatAbs)
		} catch {
			exSt = null
		}
		try {
			prSt = fs.statSync(projectAbs)
		} catch {
			prSt = null
		}

		/** Single-file pair (one or both sides may be missing on disk) */
		if (exSt?.isFile() || prSt?.isFile()) {
			const rel = path.basename(exfatRel) || id
			const r = syncOneFilePair(exfatAbs, projectAbs, direction, dryRun, id, rel)
			copied += r.copied
			skipped += r.skipped
			if (r.error) errors.push(r.error)
			continue
		}

		if (!exSt?.isDirectory() && !prSt?.isDirectory()) {
			log('info', `[exfat-sync] ${id}: neither side exists yet — skip`)
			skipped += 1
			continue
		}

		const rels = new Set()
		if (exSt?.isDirectory()) for (const r of walkRelativeFiles(exfatAbs, exPred)) rels.add(r)
		if (prSt?.isDirectory()) for (const r of walkRelativeFiles(projectAbs, exPred)) rels.add(r)

		for (const rel of rels) {
			if (exPred(rel)) {
				skipped += 1
				continue
			}
			const a = path.join(exfatAbs, rel)
			const b = path.join(projectAbs, rel)
			let stA = null
			let stB = null
			try {
				stA = fs.statSync(a)
			} catch {}
			try {
				stB = fs.statSync(b)
			} catch {}
			if (stA?.isDirectory() || stB?.isDirectory()) continue
			const r = syncOneFilePair(a, b, direction, dryRun, id, rel)
			copied += r.copied
			skipped += r.skipped
			if (r.error) errors.push(r.error)
		}
	}

	log('info', `[exfat-sync] done dryRun=${dryRun} copied=${copied} skipped=${skipped} errors=${errors.length}`)
	return { copied, skipped, errors }
}

/**
 * @param {string} pathExfat - exfat side path (file may not exist yet)
 * @param {string} pathProject - project side path (file may not exist yet)
 */
function syncOneFilePair(pathExfat, pathProject, direction, dryRun, pairId, rel) {
	let copied = 0
	let skipped = 0
	/** @type {fs.Stats | null} */
	let stA = null
	/** @type {fs.Stats | null} */
	let stB = null
	try {
		stA = fs.statSync(pathExfat)
	} catch {}
	try {
		stB = fs.statSync(pathProject)
	} catch {}
	const hasA = stA?.isFile() === true
	const hasB = stB?.isFile() === true
	if (!hasA && !hasB) return { copied: 0, skipped: 1 }
	try {
		if (hasA && !hasB) {
			if (direction === 'to_exfat') return { copied: 0, skipped: 1 }
			if (dryRun) return { copied: 1, skipped: 0 }
			copyFilePreserveTimes(pathExfat, pathProject)
			return { copied: 1, skipped: 0 }
		}
		if (!hasA && hasB) {
			if (direction === 'to_project') return { copied: 0, skipped: 1 }
			if (dryRun) return { copied: 1, skipped: 0 }
			copyFilePreserveTimes(pathProject, pathExfat)
			return { copied: 1, skipped: 0 }
		}
		if (hasA && hasB) {
			const mtA = /** @type {fs.Stats} */ (stA).mtimeMs
			const mtB = /** @type {fs.Stats} */ (stB).mtimeMs
			if (mtA > mtB) {
				if (direction === 'to_project') return { copied: 0, skipped: 1 }
				if (dryRun) return { copied: 1, skipped: 0 }
				copyFilePreserveTimes(pathExfat, pathProject)
				return { copied: 1, skipped: 0 }
			}
			if (mtB > mtA) {
				if (direction === 'to_exfat') return { copied: 0, skipped: 1 }
				if (dryRun) return { copied: 1, skipped: 0 }
				copyFilePreserveTimes(pathProject, pathExfat)
				return { copied: 1, skipped: 0 }
			}
			if (/** @type {fs.Stats} */ (stA).size !== /** @type {fs.Stats} */ (stB).size) {
				if (/** @type {fs.Stats} */ (stA).size > /** @type {fs.Stats} */ (stB).size) {
					if (direction === 'to_project') return { copied: 0, skipped: 1 }
					if (dryRun) return { copied: 1, skipped: 0 }
					copyFilePreserveTimes(pathExfat, pathProject)
					return { copied: 1, skipped: 0 }
				}
				if (/** @type {fs.Stats} */ (stB).size > /** @type {fs.Stats} */ (stA).size) {
					if (direction === 'to_exfat') return { copied: 0, skipped: 1 }
					if (dryRun) return { copied: 1, skipped: 0 }
					copyFilePreserveTimes(pathProject, pathExfat)
					return { copied: 1, skipped: 0 }
				}
			}
			return { copied: 0, skipped: 1 }
		}
	} catch (e) {
		const m = e instanceof Error ? e.message : String(e)
		return { copied: 0, skipped: 0, error: `${pairId} ${rel}: ${m}` }
	}
	return { copied: 0, skipped: 0 }
}

module.exports = {
	DEFAULT_EXFAT_ROOT: '/home/casparcg/exfat',
	mapCandidatePaths,
	loadExfatSyncMapFromDisk,
	getExfatSyncDashboard,
	getExfatMountStatus,
	runExfatSync,
	isExcluded,
	validateMap,
}
