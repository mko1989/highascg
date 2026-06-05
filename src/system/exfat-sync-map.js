/**
 * exFAT sync map: load, validate, path guards (v1 single USB + v2 bridge/usb volumes).
 */
'use strict'

const fs = require('fs')
const path = require('path')

/** @type {readonly string[]} */
const DEFAULT_PROJECT_ROOT_PREFIX = '/home/casparcg/highascg'

/** @typedef {{ id: string, label?: string, mount: string, mediaMount?: string }} VolumeDef */
/** @typedef {{ id: string, volume: string, exfat: string, project: string, direction: string, bootPrefer?: string, exclude?: string[], label?: string, pushOnSave?: boolean }} NormalizedPair */

const DEFAULT_VOLUMES = {
	bridge: {
		id: 'bridge',
		label: 'Bridge disk (HIGHASCGDAT)',
		mount: '/home/casparcg/bridge',
		mediaMount: '/home/casparcg/highascg/media',
	},
	usb: {
		id: 'usb',
		label: 'USB stick (HIGHASCGEXF)',
		mount: '/home/casparcg/exfat',
	},
}

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
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, VolumeDef>}
 */
function normalizeVolumes(raw) {
	const version = Number(raw.version) || 1
	const vols = raw.volumes && typeof raw.volumes === 'object' ? raw.volumes : null
	/** @type {Record<string, VolumeDef>} */
	const out = {}

	if (vols) {
		for (const [key, v] of Object.entries(vols)) {
			if (!v || typeof v !== 'object') continue
			const id = String(v.id || key).trim() || key
			const mount = path.resolve(String(v.mount || '').trim() || DEFAULT_VOLUMES[key]?.mount || '')
			if (!mount) continue
			out[id] = {
				id,
				label: String(v.label || DEFAULT_VOLUMES[key]?.label || id),
				mount,
				...(v.mediaMount ? { mediaMount: path.resolve(String(v.mediaMount)) } : {}),
			}
		}
	}

	if (!out.usb) {
		const legacyRoot = String(raw.exfatRoot || DEFAULT_VOLUMES.usb.mount).trim() || DEFAULT_VOLUMES.usb.mount
		out.usb = { ...DEFAULT_VOLUMES.usb, mount: path.resolve(legacyRoot) }
	}
	if (!out.bridge) {
		out.bridge = { ...DEFAULT_VOLUMES.bridge }
	}
	return out
}

function validateMap(m) {
	if (!m || typeof m !== 'object') throw new Error('exfat-sync map: not an object')
	let pairs = /** @type {unknown} */ (m).pairs
	if (!Array.isArray(pairs)) throw new Error('exfat-sync map: pairs must be an array')
	pairs = pairs.filter((p) => {
		if (!p || typeof p !== 'object') return true
		const id = String(p.id || '').trim()
		const exfat = String(p.exfat || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
		if (id === 'sim-highascg' || exfat === 'sim/highascg' || exfat.startsWith('sim/highascg/')) {
			return false
		}
		return true
	})
	const volumes = normalizeVolumes(m)
	/** @type {NormalizedPair[]} */
	const normalized = []

	for (const p of pairs) {
		if (!p || typeof p !== 'object') throw new Error('exfat-sync map: invalid pair entry')
		const id = String(p.id || '').trim()
		const exfat = String(p.exfat || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
		const proj = String(p.project || '').trim()
		const volume = String(p.volume || 'usb').trim() || 'usb'
		if (!id) throw new Error('exfat-sync map: pair missing id')
		if (!exfat) throw new Error(`exfat-sync map: pair ${id} missing exfat`)
		if (!proj) throw new Error(`exfat-sync map: pair ${id} missing project`)
		if (!volumes[volume]) throw new Error(`exfat-sync map: pair ${id} unknown volume "${volume}"`)
		const dir = String(p.direction || 'both').toLowerCase()
		if (!['both', 'to_project', 'to_exfat'].includes(dir)) {
			throw new Error(`exfat-sync map: pair ${id} invalid direction`)
		}
		if (p.exclude !== undefined && !Array.isArray(p.exclude)) {
			throw new Error(`exfat-sync map: pair ${id} exclude must be an array of strings`)
		}
		if (p.bootPrefer !== undefined && p.bootPrefer !== null && String(p.bootPrefer).trim() !== '') {
			const bp = String(p.bootPrefer).toLowerCase()
			if (bp !== 'exfat' && bp !== 'project') {
				throw new Error(`exfat-sync map: pair ${id} bootPrefer must be exfat or project`)
			}
		}
		normalized.push({
			id,
			volume,
			exfat,
			project: proj,
			direction: dir,
			...(p.bootPrefer != null && String(p.bootPrefer).trim() ? { bootPrefer: String(p.bootPrefer).toLowerCase() } : {}),
			...(Array.isArray(p.exclude) ? { exclude: p.exclude.map((x) => String(x)) } : {}),
			...(p.label != null ? { label: String(p.label) } : {}),
			...(p.pushOnSave === true ? { pushOnSave: true } : {}),
		})
	}

	const version = Number(m.version) || 1
	const exfatRoot = volumes.usb.mount
	return { version: version >= 2 ? version : 2, exfatRoot, volumes, pairs: normalized }
}

/**
 * @param {{ volumes: Record<string, VolumeDef>, pairs: NormalizedPair[] }} map
 * @param {NormalizedPair} pair
 */
function resolvePairExfatRoot(map, pair) {
	const vol = map.volumes[pair.volume]
	return vol ? path.resolve(vol.mount) : path.resolve(map.exfatRoot || DEFAULT_VOLUMES.usb.mount)
}

/**
 * Boot / sync order: bridge config → USB config → USB media ingest → other.
 * @param {NormalizedPair[]} pairs
 */
function sortPairsForSync(pairs, boot) {
	const rank = (p) => {
		const v = p.volume
		const id = p.id
		if (v === 'bridge' && p.direction !== 'to_project') return 10
		if (v === 'usb' && id.includes('config')) return 20
		if (v === 'usb' && p.direction === 'to_project') return 30
		if (v === 'bridge') return 15
		return 40
	}
	const sorted = [...pairs].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
	if (!boot) return sorted
	return sorted
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
		map: {
			version: 2,
			exfatRoot: DEFAULT_VOLUMES.usb.mount,
			volumes: { ...DEFAULT_VOLUMES },
			pairs: [],
		},
		loadError: `no valid exfat-sync map (${summary})`,
	}
}

function assertSafeProjectPath(projectAbs) {
	const r = path.resolve(projectAbs)
	if (!r.startsWith(DEFAULT_PROJECT_ROOT_PREFIX + path.sep) && r !== DEFAULT_PROJECT_ROOT_PREFIX) {
		throw new Error(`Refusing sync: project path must be under ${DEFAULT_PROJECT_ROOT_PREFIX}: ${r}`)
	}
}

function assertUnderExfat(exfatRoot, abs) {
	const root = path.resolve(exfatRoot)
	const a = path.resolve(abs)
	if (a !== root && !a.startsWith(root + path.sep)) {
		throw new Error(`Refusing sync: path escapes volume root: ${a}`)
	}
	const rel = a === root ? '' : a.slice(root.length + 1).replace(/\\/g, '/')
	if (rel === 'sim' || rel.startsWith('sim/')) {
		throw new Error(`Refusing sync: deprecated path sim/ (use drop-update/ on USB sticks)`)
	}
}

module.exports = {
	DEFAULT_PROJECT_ROOT_PREFIX,
	DEFAULT_VOLUMES,
	isExcluded,
	validateMap,
	mapCandidatePaths,
	loadExfatSyncMapFromDisk,
	resolvePairExfatRoot,
	sortPairsForSync,
	assertSafeProjectPath,
	assertUnderExfat,
}
