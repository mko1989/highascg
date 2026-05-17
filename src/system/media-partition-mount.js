/**
 * WO-38: Mount a persisted partition UUID onto /home/casparcg/highascg/media via root helper + sudo NOPASSWD.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')

const defaults = require('../config/defaults')

const execFileAsync = promisify(execFile)

const FIXED_MEDIA_MOUNT = '/home/casparcg/highascg/media'
const REQ_DIR = '/run/highascg'
const REQ_PATH = `${REQ_DIR}/media-mount.req`
const HELPER_SCRIPT =
	process.env.HIGHASCG_MEDIA_MOUNT_SCRIPT || '/usr/local/lib/highascg/media-mount.sh'

/** sliding window throttle for destructive mount */
let _rate = { windowStart: 0, count: 0 }

function rateLimitFail() {
	const now = Date.now()
	if (now - _rate.windowStart > 60_000) {
		_rate = { windowStart: now, count: 0 }
	}
	_rate.count += 1
	return _rate.count > 8
}

/** @returns {Promise<void>} */
async function mkdirReqDirEarly(log) {
	if (process.platform !== 'linux') return
	try {
		fs.mkdirSync(REQ_DIR, { recursive: true })
		fs.chmodSync(REQ_DIR, 0o770)
	} catch (e) {
		if (typeof log === 'function') log('warn', `[media-mount] cannot prepare ${REQ_DIR}: ${e && e.message ? e.message : e}`)
	}
}

/**
 * @param {string | undefined} uuid
 */
function normalizeUuid(uuid) {
	const u = String(uuid ?? '')
		.trim()
		.toLowerCase()
	if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(u)) return ''
	return u
}

/**
 * @returns {Promise<{ mounted: boolean, uuid?: string, source?: string, fstype?: string, target: string }>}
 */
async function getMediaMountStatus() {
	const target = FIXED_MEDIA_MOUNT
	if (process.platform !== 'linux') {
		return { mounted: false, target }
	}
	try {
		const { stdout } = await execFileAsync(
			'findmnt',
			['-J', '-o', 'SOURCE,TARGET,FSTYPE,UUID', '-T', FIXED_MEDIA_MOUNT],
			{ timeout: 5000 },
		).catch(() => ({
			stdout: '',
		}))
		if (!stdout) return { mounted: false, target }
		const data = JSON.parse(stdout)
		const f = Array.isArray(data.filesystems) ? data.filesystems[0] : null
		if (!f) return { mounted: false, target }
		const mountedHere = String(f.target || '').trim() === FIXED_MEDIA_MOUNT
		return {
			mounted: mountedHere,
			target,
			source: String(f.source || '').trim(),
			uuid: String(f.uuid || '').trim().toLowerCase() || undefined,
			fstype: String(f.fstype || '').trim() || undefined,
			...(mountedHere ?
				{}
			:	{ inheritsFromFilesystem: String(f.target || '').trim() || undefined }),
		}
	} catch {
		return { mounted: false, target }
	}
}

/**
 * @returns {Promise<string>}
 */
async function sudoApplyMount(uuid, log) {
	const u = normalizeUuid(uuid)
	if (!u) throw new Error('Invalid UUID')

	if (rateLimitFail()) throw new Error('Too many mount attempts — wait and retry')

	await mkdirReqDirEarly(log)

	if (!fs.existsSync(HELPER_SCRIPT)) throw new Error(`Mount helper missing (${HELPER_SCRIPT}). Run install-phase4 or copy script + sudoers.`)

	const tmpReq = `${REQ_PATH}.${process.pid}.${Date.now()}`
	fs.writeFileSync(tmpReq, `${u}\n`, { encoding: 'utf8', mode: 0o600 })

	try {
		fs.renameSync(tmpReq, REQ_PATH)
	} catch (e) {
		try {
			fs.unlinkSync(tmpReq)
		} catch {}
		throw e instanceof Error ? e : new Error(String(e))
	}
	try {
		fs.chmodSync(REQ_PATH, 0o600)
	} catch {}

	const { stdout, stderr } = await execFileAsync('sudo', ['-n', HELPER_SCRIPT], {
		timeout: 120000,
		maxBuffer: 2e6,
	})
	log?.('info', `[media-mount] ${(stderr || '').trim()}`)
	const line = String(stdout || '')
		.trim()
		.split('\n')
		.filter(Boolean)
		.pop()
	if (!line) throw new Error('Mount helper produced no output')
	let payload
	try {
		payload = JSON.parse(line)
	} catch {
		throw new Error(line || 'Mount helper failed')
	}
	if (!payload.ok) throw new Error(payload.error || 'Mount failed')

	return String(payload.source || '')
}

/** @returns {Promise<string>} kernel name short */
async function lsblkKernelName(uuid) {
	const u = normalizeUuid(uuid)
	if (!u || process.platform !== 'linux') return ''
	try {
		const { stdout } = await execFileAsync(
			'lsblk',
			['-n', '-o', 'NAME', `/dev/disk/by-uuid/${u}`],
			{ timeout: 6000 },
		)
		return String(stdout || '')
			.trim()
			.split('\n')[0]
			.trim()
	}
	catch {
		return ''
	}
}

/**
 * Persist uuid + kernel label to config.
 * @param {import('../config/config-manager')} configManager
 * @param {string} uuid
 * @param {string} kernelName
 */
function saveMediaMountToConfig(configManager, uuid, kernelName) {
	const u = normalizeUuid(uuid)
	const cur = configManager.get()
	const next = {
		...cur,
		mediaMount: {
			...defaults.mediaMount,
			...(cur.mediaMount || {}),
			uuid: u,
			lastKernelName: String(kernelName || '').trim(),
		},
	}
	configManager.save(next)
}

/**
 * If config has mediaMount.uuid, ensure it is mounted (no-op when already mounted with same UUID).
 * @param {{ configManager?: import('../config/config-manager'), config: object, log?: (lvl: string, m: string) => void }} ctx
 */
async function ensurePersistedMediaPartitionMounted(ctx) {
	const log = typeof ctx?.log === 'function' ? ctx.log : console.log.bind(console)

	if (process.platform !== 'linux') return

	let uuid = normalizeUuid(ctx.config?.mediaMount?.uuid ?? ctx.configManager?.get?.()?.mediaMount?.uuid ?? '')
	const fromMgr =
		ctx.configManager && typeof ctx.configManager.get === 'function' ?
			normalizeUuid(ctx.configManager.get().mediaMount?.uuid)
		:	''
	if (!uuid && fromMgr) uuid = fromMgr
	if (!uuid) return

	let st
	try {
		st = await getMediaMountStatus()
	} catch {
		st = { mounted: false, target: FIXED_MEDIA_MOUNT }
	}
	if (st.mounted && st.uuid && normalizeUuid(st.uuid) === uuid) {
		log('info', `[media-mount] startup: ${uuid} already mounted at ${FIXED_MEDIA_MOUNT}`)
		return
	}

	log('info', `[media-mount] startup: mounting ${uuid} at ${FIXED_MEDIA_MOUNT}`)
	try {
		await sudoApplyMount(uuid, log)
		const kern = await lsblkKernelName(uuid)
		if (kern && ctx.configManager) saveMediaMountToConfig(ctx.configManager, uuid, kern)
		log('info', `[media-mount] startup ok ${uuid}`)
	} catch (e) {
		const m = e instanceof Error ? e.message : String(e)
		log(
			`warn`,
			`[media-mount] startup mount failed (playback may miss media): ${m}`,
		)
	}
}

/**
 * Interactive mount + persist.
 * @param {{ configManager?: import('../config/config-manager'), confirm?: string, uuid?: string, log?: (lvl: string, msg: string) => void }} args
 */
async function mountAndPersistConfiguredPartition(args) {
	const log =
		args && typeof args.log === 'function' ?
			args.log
		:	(l, m) => {
				if (l === 'warn' || l === 'error') console.error(m)
				else console.log(m)
			}

	const conf = args?.confirm ?? ''
	const uuid = normalizeUuid(args?.uuid ?? '')
	const confTrim = typeof conf === 'string' ? conf.trim().toUpperCase() : ''

	if (!uuid) throw new Error('uuid required')
	if (confTrim !== 'DELETE_MEDIA')
		throw new Error('confirmation required')

	const src = await sudoApplyMount(uuid, log)
	const kern =
	(await lsblkKernelName(uuid).catch(() => '')) || path.basename(src || '') || ''

	if (!args?.configManager) throw new Error('configManager missing')
	saveMediaMountToConfig(args.configManager, uuid, kern)

	return {
		ok: true,
		uuid,
		source: src,
		kernelName: kern,
	}
}

module.exports = {
	FIXED_MEDIA_MOUNT,
	getMediaMountStatus,
	ensurePersistedMediaPartitionMounted,
	mountAndPersistConfiguredPartition,
	mkdirReqDirEarly,
}
