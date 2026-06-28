/**
 * WO-47 / WO-52: cross-volume mtime sync (bridge disk + USB stick).
 */
'use strict'

const fs = require('fs')
const path = require('path')

const {
	isExcluded,
	loadExfatSyncMapFromDisk,
	assertSafeProjectPath,
	assertUnderExfat,
	validateMap,
	mapCandidatePaths,
	resolvePairExfatRoot,
	sortPairsForSync,
} = require('./exfat-sync-map')
const {
	walkRelativeFiles,
	copyFilePreserveTimes,
	syncOneFilePair,
	syncPairBootPreferExfat,
} = require('./exfat-sync-fs')
const { getExfatMountStatus, getExfatSyncDashboard } = require('./exfat-sync-status')
const { shouldSyncShowDataPairFromExfat } = require('../replication/replication-show-authority')

/** @type {Map<string, { mounted: boolean, source?: string, fstype?: string, target: string }>} */
const mountCache = new Map()

async function volumeMountStatus(mountPath) {
	const key = path.resolve(mountPath)
	if (mountCache.has(key)) return mountCache.get(key)
	const st = await getExfatMountStatus(key)
	mountCache.set(key, st)
	return st
}

function clearMountCache() {
	mountCache.clear()
}

/**
 * @param {import('./exfat-sync-map').NormalizedPair} pair
 * @param {ReturnType<typeof validateMap>} map
 */
/** Push project → exFAT only for explicit pushOnSave pairs (bridge always; USB only on Settings save while stick mounted). */
function pairPushOnSave(pair, map) {
	if (pair.pushOnSave === true) return true
	if (map.version < 2 && ['modular-config', 'drop-config', 'state-highascg', 'state-module'].includes(pair.id)) {
		return true
	}
	return ['bridge-modular-config', 'bridge-drop-config', 'bridge-state-highascg', 'bridge-state-module'].includes(
		pair.id,
	)
}

async function pushProjectConfigToExfat(opts) {
	clearMountCache()
	const log = opts?.log || (() => {})
	const dryRun = !!opts?.dryRun
	const loaded = loadExfatSyncMapFromDisk()
	if (!loaded.mapPath) return { copied: 0, skipped: 0, errors: [loaded.loadError || 'no map'] }

	const want = opts?.pairIds?.length
		? new Set(opts.pairIds.map((x) => String(x)))
		: null

	let copied = 0
	let skipped = 0
	/** @type {string[]} */
	const errors = []

	for (const p of loaded.map.pairs) {
		if (!pairPushOnSave(p, loaded.map)) continue
		if (want && !want.has(p.id)) continue

		const exfatRoot = resolvePairExfatRoot(loaded.map, p)
		const mount = await volumeMountStatus(exfatRoot)
		if (!mount.mounted) {
			skipped += 1
			continue
		}

		const exfatRel = String(p.exfat || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
		const projectPath = String(p.project || '').trim()
		const exfatAbs = path.join(exfatRoot, exfatRel)
		const projectAbs = path.resolve(projectPath)
		let prSt = null
		try {
			assertUnderExfat(exfatRoot, exfatAbs)
			assertSafeProjectPath(projectAbs)
			prSt = fs.statSync(projectAbs)
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			// Optional state / drop-config files may not exist until the app has run once.
			if (/ENOENT|no such file or directory/i.test(msg)) {
				skipped += 1
				continue
			}
			errors.push(`${p.id}: ${msg}`)
			continue
		}
		const exPred = (rel) => isExcluded(rel, p.exclude || [])
		if (prSt.isFile()) {
			if (dryRun) {
				copied += 1
				continue
			}
			try {
				copyFilePreserveTimes(projectAbs, exfatAbs)
				copied += 1
			} catch (e) {
				errors.push(`${p.id}: ${e instanceof Error ? e.message : e}`)
			}
			continue
		}
		if (!prSt.isDirectory()) continue
		for (const rel of walkRelativeFiles(projectAbs, exPred)) {
			const b = path.join(projectAbs, rel)
			const a = path.join(exfatAbs, rel)
			try {
				if (!fs.statSync(b).isFile()) continue
			} catch {
				continue
			}
			if (dryRun) {
				copied += 1
				continue
			}
			try {
				copyFilePreserveTimes(b, a)
				copied += 1
			} catch (e) {
				errors.push(`${p.id} ${rel}: ${e instanceof Error ? e.message : e}`)
			}
		}
	}

	log('info', `[exfat-sync] push to volume(s) copied=${copied} skipped=${skipped}`)
	return { copied, skipped, errors }
}

async function syncOnePair(p, map, opts) {
	const log = opts.log || (() => {})
	const dryRun = !!opts.dryRun
	const boot = !!opts.boot
	const id = p.id
	const exfatRoot = resolvePairExfatRoot(map, p)
	const mount = await volumeMountStatus(exfatRoot)
	if (!mount.mounted) {
		log('info', `[exfat-sync] ${id}: volume ${p.volume} not mounted at ${exfatRoot} — skip`)
		return { copied: 0, skipped: 1, errors: [] }
	}

	const exfatRel = String(p.exfat || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
	const projectPath = String(p.project || '').trim()
	const direction = String(p.direction || 'both').toLowerCase()
	const bootPrefer = String(p.bootPrefer || '').toLowerCase()
	const excludes = p.exclude || []
	const exPred = (rel) => isExcluded(rel, excludes)
	const blockExfatToProject = !shouldSyncShowDataPairFromExfat(id)
	const fileSyncOpts = {
		...(boot ? { bootPreferExfat: bootPrefer === 'exfat' } : {}),
		...(blockExfatToProject ? { blockExfatToProject: true } : {}),
	}

	if (blockExfatToProject) {
		log(
			'info',
			`[exfat-sync] ${id}: skip volume → project (replication leader owns active show; push to stick still allowed)`,
		)
	}

	let copied = 0
	let skipped = 0
	/** @type {string[]} */
	const errors = []

	let exfatAbs
	let projectAbs
	try {
		exfatAbs = path.join(exfatRoot, exfatRel)
		projectAbs = path.resolve(projectPath)
		assertUnderExfat(exfatRoot, exfatAbs)
		assertSafeProjectPath(projectAbs)
	} catch (e) {
		return { copied: 0, skipped: 0, errors: [`${id}: ${e instanceof Error ? e.message : e}`] }
	}

	if (blockExfatToProject && boot && bootPrefer === 'exfat') {
		return { copied: 0, skipped: 1, errors: [] }
	}

	if (boot && bootPrefer === 'exfat') {
		const br = syncPairBootPreferExfat(exfatAbs, projectAbs, dryRun, id, exPred, syncOneFilePair, fileSyncOpts)
		log('info', `[exfat-sync] boot ${id} (${p.volume}): volume → project only (copied=${br.copied})`)
		return br
	}

	// USB stick: never apply RAM/ISO configs onto the stick at boot (only pull stick → project above).
	if (boot && p.volume === 'usb') {
		log('info', `[exfat-sync] boot ${id}: USB mounted — no project → stick at boot`)
		return { copied: 0, skipped: 1, errors: [] }
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

	if (exSt?.isFile() || prSt?.isFile()) {
		const rel = path.basename(exfatRel) || id
		const r = syncOneFilePair(exfatAbs, projectAbs, direction, dryRun, id, rel, fileSyncOpts)
		return { copied: r.copied, skipped: r.skipped, errors: r.error ? [r.error] : [] }
	}

	if (!exSt?.isDirectory() && !prSt?.isDirectory()) {
		log('info', `[exfat-sync] ${id}: neither side exists yet — skip`)
		return { copied: 0, skipped: 1, errors: [] }
	}

	const rels = new Set()
	if (exSt?.isDirectory()) for (const r of walkRelativeFiles(exfatAbs, exPred)) rels.add(r)
	if (prSt?.isDirectory() && direction !== 'to_project') {
		for (const r of walkRelativeFiles(projectAbs, exPred)) rels.add(r)
	}

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
		const r = syncOneFilePair(a, b, direction, dryRun, id, rel, fileSyncOpts)
		copied += r.copied
		skipped += r.skipped
		if (r.error) errors.push(r.error)
	}

	return { copied, skipped, errors }
}

async function runExfatSync(opts) {
	clearMountCache()
	const log = opts?.log || (() => {})
	const dryRun = !!opts?.dryRun
	const boot = !!opts?.boot
	const loaded = loadExfatSyncMapFromDisk()
	if (!loaded.mapPath) {
		const msg = loaded.loadError || 'no exfat sync map'
		log('warn', `[exfat-sync] ${msg}`)
		return { copied: 0, skipped: 0, errors: [msg] }
	}

	const map = loaded.map
	const ordered = sortPairsForSync(map.pairs, boot)
	let copied = 0
	let skipped = 0
	/** @type {string[]} */
	const errors = []
	let anyVolumeMounted = false

	for (const vol of Object.values(map.volumes || {})) {
		const st = await volumeMountStatus(vol.mount)
		if (st.mounted) anyVolumeMounted = true
	}

	if (!anyVolumeMounted) {
		log('info', '[exfat-sync] no bridge (HIGHASCGDAT) or USB (HIGHASCGEXF) mounted — sync skipped (RAM-only OK)')
		return { copied: 0, skipped: 0, errors: [] }
	}

	for (const p of ordered) {
		const r = await syncOnePair(p, map, { log, dryRun, boot })
		copied += r.copied
		skipped += r.skipped
		errors.push(...r.errors)
	}

	// Boot pulls volume → project first (bootPrefer exfat). Empty configs/ on bridge/USB
	// never get seeded without this push (eggs build clears stick; playout host edits RAM only).
	if (boot && anyVolumeMounted) {
		const push = await pushProjectConfigToExfat({ log, dryRun })
		copied += push.copied
		skipped += push.skipped
		errors.push(...(push.errors || []))
	}

	log('info', `[exfat-sync] done boot=${boot} dryRun=${dryRun} copied=${copied} skipped=${skipped} errors=${errors.length}`)
	return { copied, skipped, errors }
}

module.exports = {
	DEFAULT_EXFAT_ROOT: '/home/casparcg/exfat',
	mapCandidatePaths,
	loadExfatSyncMapFromDisk,
	getExfatSyncDashboard,
	getExfatMountStatus,
	runExfatSync,
	pushProjectConfigToExfat,
	isExcluded,
	validateMap,
	clearMountCache,
}
