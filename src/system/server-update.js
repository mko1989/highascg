'use strict'

const fs = require('fs')
const path = require('path')
const { execFile, execFileSync } = require('child_process')
const { promisify } = require('util')
const https = require('https')

const { REPO_ROOT } = require('../repo-paths')
const { readBuildStampFromDir, compareBuildStamps, parseServerReleaseAssetStamp } = require('./build-stamp')

const execFileAsync = promisify(execFile)

const DEFAULT_GITHUB_REPO = 'mko1989/highascg'
const CACHE_ROOT = '/var/cache/highascg/updates'
/** Second source root the sudo apply helper accepts (validate_source_path) — see WO-455. */
const FALLBACK_CACHE = '/tmp/highascg-updates'

/**
 * WO-455: installed systems ship WITHOUT /var/cache/highascg (eggs excludes `var/cache/*`),
 * and the node process (user casparcg) cannot mkdir under root-owned /var/cache — the GUI
 * update died with EACCES before downloading anything. /tmp/highascg-updates is already
 * whitelisted by the deployed sudo helper, so it works on existing installs unmodified.
 * @param {(line: string) => void} [logLine]
 */
function resolveUpdateCacheDir(logLine) {
	const preferred = process.env.HIGHASCG_UPDATE_CACHE || CACHE_ROOT
	try {
		fs.mkdirSync(preferred, { recursive: true })
		return preferred
	} catch (e) {
		if (!['EACCES', 'EPERM', 'EROFS'].includes(e?.code)) throw e
		fs.mkdirSync(FALLBACK_CACHE, { recursive: true })
		if (typeof logLine === 'function') {
			logLine(`Cache ${preferred} not writable (${e.code}) — using ${FALLBACK_CACHE}`)
		}
		return FALLBACK_CACHE
	}
}
const APPLY_DROP_SH = '/usr/local/lib/highascg/highascg-apply-server-drop.sh'
const CHECK_CACHE_MS = 15 * 60 * 1000

/** @type {{ at: number, data: object } | null} */
let checkCache = null

/** @type {null | { id: string, phase: string, log: string[], startedAt: string, done: boolean, ok: boolean, error: string|null }} */
let applyJob = null

function isMountPoint(mp) {
	try {
		execFileSync('mountpoint', ['-q', mp], { timeout: 2000 })
		return true
	} catch {
		return false
	}
}

function getVolumeStatus() {
	const usb = '/home/casparcg/exfat'
	const bridge = '/home/casparcg/bridge'
	const dropUsb = path.join(usb, 'drop-update')
	const dropBridge = path.join(bridge, 'drop-update')
	return {
		usb: {
			mount: usb,
			mounted: isMountPoint(usb),
			dropUpdate: dropUsb,
			dropStamp: isMountPoint(usb) ? readBuildStampFromDir(dropUsb) : null,
			appliedStamp: isMountPoint(usb) ? readAppliedStamp(dropUsb) : null,
		},
		bridge: {
			mount: bridge,
			mounted: isMountPoint(bridge),
			dropUpdate: dropBridge,
			dropStamp: isMountPoint(bridge) ? readBuildStampFromDir(dropBridge) : null,
		},
	}
}

/**
 * @param {string} dropRoot
 * @returns {string|null}
 */
function readAppliedStamp(dropRoot) {
	try {
		const p = path.join(dropRoot, '.applied-stamp')
		if (!fs.existsSync(p)) return null
		return fs.readFileSync(p, 'utf8').trim() || null
	} catch {
		return null
	}
}

function detectRetainMode() {
	const applySh = fs.existsSync(APPLY_DROP_SH)
		? APPLY_DROP_SH
		: path.join(REPO_ROOT, 'scripts/exfat/highascg-apply-server-drop.sh')
	try {
		const out = execFileSync(applySh, ['--print-retain-mode'], { encoding: 'utf8', timeout: 4000 }).trim()
		return out === 'retain'
	} catch {
		return fs.existsSync('/etc/highascg/server-update-retain-drop') || fs.existsSync('/run/live')
	}
}

function getVersionInfo() {
	const runningStamp = readBuildStampFromDir(REPO_ROOT)
	let packageVersion = null
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
		packageVersion = pkg?.version || null
	} catch {
		/* ignore */
	}
	return {
		buildStamp: runningStamp,
		packageVersion,
		repoRoot: REPO_ROOT,
		retainDrop: detectRetainMode(),
		volumes: getVolumeStatus(),
	}
}

function resolveGithubRepo() {
	const env = String(process.env.HIGHASCG_GITHUB_RELEASE_REPO || '').trim()
	if (env && /^[\w.-]+\/[\w.-]+$/.test(env)) return env
	return DEFAULT_GITHUB_REPO
}

/**
 * @param {string} url
 * @returns {Promise<object>}
 */
function fetchJson(url) {
	return new Promise((resolve, reject) => {
		const req = https.get(
			url,
			{
				headers: {
					Accept: 'application/vnd.github+json',
					'User-Agent': 'highascg-server-update',
				},
				timeout: 20000,
			},
			(res) => {
				if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
					fetchJson(res.headers.location).then(resolve, reject)
					return
				}
				let raw = ''
				res.setEncoding('utf8')
				res.on('data', (c) => {
					raw += c
				})
				res.on('end', () => {
					if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
						reject(new Error(`GitHub HTTP ${res.statusCode || '?'}: ${raw.slice(0, 200)}`))
						return
					}
					try {
						resolve(JSON.parse(raw))
					} catch (e) {
						reject(e)
					}
				})
			},
		)
		req.on('error', reject)
		req.on('timeout', () => {
			req.destroy()
			reject(new Error('GitHub request timed out'))
		})
	})
}

/**
 * @param {{ force?: boolean }} [opts]
 */
async function checkForUpdate(opts = {}) {
	const current = readBuildStampFromDir(REPO_ROOT)
	const now = Date.now()
	if (!opts.force && checkCache && now - checkCache.at < CHECK_CACHE_MS) {
		return { ...checkCache.data, cached: true }
	}

	const repo = resolveGithubRepo()
	const base = {
		current,
		latest: null,
		updateAvailable: null,
		releaseUrl: `https://github.com/${repo}/releases/latest`,
		publishedAt: null,
		assetName: null,
		assetUrl: null,
		githubRepo: repo,
		error: null,
		cached: false,
	}

	try {
		/* WO-424: server builds are published as PRERELEASES (make-github-release-server.sh),
		 * and GitHub's /releases/latest endpoint only ever returns the newest FULL release —
		 * so the shipped check could never see a server drop and the whole GUI update flow sat
		 * dead. Scan the release list instead and pick the newest release (prerelease or not,
		 * drafts excluded) that actually carries a highascg-server_*.tar.gz asset. */
		const releases = await fetchJson(`https://api.github.com/repos/${repo}/releases?per_page=15`)
		let rel = null
		let serverAsset = null
		for (const cand of Array.isArray(releases) ? releases : []) {
			if (cand?.draft) continue
			const asset = (Array.isArray(cand?.assets) ? cand.assets : []).find((a) =>
				/^highascg-server_.+\.tar\.gz$/i.test(String(a?.name || '')),
			)
			if (!asset) continue
			const stamp = parseServerReleaseAssetStamp(asset.name)
			const best = serverAsset ? parseServerReleaseAssetStamp(serverAsset.name) : null
			if (!serverAsset || (stamp && best && compareBuildStamps(stamp, best) > 0)) {
				rel = cand
				serverAsset = asset
			}
		}
		const latest = serverAsset ? parseServerReleaseAssetStamp(serverAsset.name) : null
		base.latest = latest
		base.publishedAt = rel?.published_at || null
		base.releaseUrl = rel?.html_url || base.releaseUrl
		base.assetName = serverAsset?.name || null
		base.assetUrl = serverAsset?.browser_download_url || null
		if (latest && current) {
			base.updateAvailable = compareBuildStamps(latest, current) > 0
		} else if (latest && !current) {
			base.updateAvailable = true
		} else {
			base.updateAvailable = false
		}
	} catch (e) {
		base.error = e instanceof Error ? e.message : String(e)
	}

	checkCache = { at: now, data: base }
	return base
}

/**
 * @param {string} url
 * @param {string} destPath
 */
async function downloadFile(url, destPath) {
	if (!/^https:\/\/github\.com\//i.test(url) && !/^https:\/\/objects\.githubusercontent\.com\//i.test(url)) {
		throw new Error('Download URL must be a GitHub releases asset')
	}
	fs.mkdirSync(path.dirname(destPath), { recursive: true })
	/* WO-424 (review 03.08 config §5): every failure path must settle the promise and clean the
	 * partial file — an unhandled 'error' on the write stream was a process.exit(1) via the
	 * uncaughtException guard, and a stalled body left the apply job wedged forever. The write
	 * stream is also created only for the final 200 (it used to be shared across redirects). */
	await new Promise((resolve, reject) => {
		let settled = false
		const fail = (err) => {
			if (settled) return
			settled = true
			try { fs.unlinkSync(destPath) } catch { /* nothing written yet */ }
			reject(err instanceof Error ? err : new Error(String(err)))
		}
		const go = (fetchUrl, redirects) => {
			if (redirects > 5) return fail(new Error('Download: too many redirects'))
			const req = https.get(fetchUrl, { timeout: 120000 }, (res) => {
				if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
					res.resume()
					go(res.headers.location, redirects + 1)
					return
				}
				if ((res.statusCode || 0) !== 200) {
					res.resume()
					fail(new Error(`Download HTTP ${res.statusCode || '?'}`))
					return
				}
				const file = fs.createWriteStream(destPath)
				res.pipe(file)
				res.on('error', (e) => {
					file.destroy()
					fail(e)
				})
				file.on('error', (e) => {
					res.destroy()
					fail(e)
				})
				file.on('finish', () =>
					file.close(() => {
						if (!settled) {
							settled = true
							resolve(undefined)
						}
					}),
				)
			})
			req.on('error', fail)
			req.on('timeout', () => req.destroy(new Error('Download stalled (no activity for 120 s)')))
		}
		go(url, 0)
	})
}

function appendJobLog(line) {
	if (!applyJob) return
	applyJob.log.push(line)
	if (applyJob.log.length > 200) applyJob.log.shift()
}

async function extractTarball(tarPath, destDir) {
	fs.mkdirSync(destDir, { recursive: true })
	await execFileAsync('tar', ['-xzf', tarPath, '-C', destDir], { timeout: 600000 })
}

async function runApplyHelper(extractDir) {
	const helper = fs.existsSync('/usr/local/lib/highascg/highascg-webui-server-update.sh')
		? '/usr/local/lib/highascg/highascg-webui-server-update.sh'
		: path.join(REPO_ROOT, 'scripts/exfat/highascg-webui-server-update.sh')
	if (!fs.existsSync(helper)) throw new Error(`Missing apply helper: ${helper}`)
	const { stdout, stderr } = await execFileAsync('sudo', ['-n', helper, '--source', extractDir], {
		encoding: 'utf8',
		timeout: 900000,
		maxBuffer: 4 * 1024 * 1024,
	})
	const out = [stdout, stderr].filter(Boolean).join('\n').trim()
	if (out) out.split('\n').forEach((l) => appendJobLog(l))
}

/**
 * @param {{ releaseTag?: string, assetUrl?: string, assetName?: string }} opts
 */
async function startApplyJob(opts = {}) {
	if (applyJob && !applyJob.done) {
		throw new Error('Update already in progress')
	}
	const check = await checkForUpdate({ force: true })
	const assetUrl = String(opts.assetUrl || check.assetUrl || '').trim()
	const assetName = String(opts.assetName || check.assetName || '').trim()
	if (!assetUrl) throw new Error('No server release asset URL available')

	const stamp = parseServerReleaseAssetStamp(assetName) || check.latest || `unknown-${Date.now()}`
	const id = `upd-${Date.now()}`
	applyJob = {
		id,
		phase: 'starting',
		log: [],
		startedAt: new Date().toISOString(),
		done: false,
		ok: false,
		error: null,
		stamp,
	}

	void (async () => {
		try {
			const cacheDir = resolveUpdateCacheDir(appendJobLog)
			const tarPath = path.join(cacheDir, assetName || `highascg-server_${stamp}.tar.gz`)
			const extractDir = path.join(cacheDir, `extract-${stamp}`)

			applyJob.phase = 'download'
			appendJobLog(`Downloading ${assetName || tarPath}`)
			await downloadFile(assetUrl, tarPath)

			applyJob.phase = 'extract'
			appendJobLog(`Extracting to ${extractDir}`)
			fs.rmSync(extractDir, { recursive: true, force: true })
			await extractTarball(tarPath, extractDir)

			applyJob.phase = 'apply'
			appendJobLog('Applying server drop (privileged)')
			await runApplyHelper(extractDir)

			applyJob.phase = 'done'
			applyJob.ok = true
			appendJobLog('Update applied successfully')
		} catch (e) {
			applyJob.phase = 'error'
			applyJob.error = e instanceof Error ? e.message : String(e)
			appendJobLog(applyJob.error)
		} finally {
			applyJob.done = true
			checkCache = null
		}
	})()

	return { jobId: id, status: 'running', stamp }
}

function getApplyStatus() {
	if (!applyJob) return { active: false }
	return {
		active: !applyJob.done,
		...applyJob,
		runningStamp: applyJob.done && applyJob.ok ? readBuildStampFromDir(REPO_ROOT) : null,
	}
}

module.exports = {
	getVersionInfo,
	checkForUpdate,
	startApplyJob,
	getApplyStatus,
	resolveGithubRepo,
}
