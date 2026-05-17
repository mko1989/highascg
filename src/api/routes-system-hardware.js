/**
 * WO-39: NVIDIA pool info + guarded apply; DeckLink host summary; allow-listed GUI launches on :0.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { execSync, execFileSync, spawn, execFile } = require('child_process')
const { promisify } = require('util')

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { checkNuclearPassword } = require('./routes-system-setup')
const { getXAuthority } = require('../utils/hardware-info')
const { probeDecklinkHardware, probeDecklinkFromCasparLog } = require('../utils/decklink-enum')

const execFileAsync = promisify(execFile)

/** @readonly */
const NVIDIA_SCRIPT =
	process.env.HIGHASCG_NVIDIA_APPLY_SCRIPT || '/usr/local/lib/highascg/nvidia-apply-from-pool.sh'

const NVIDIA_REQ = '/run/highascg/nvidia-apply.req'

/** Fallback when env unset — matches live image picker default path. */
const POOL_DEFAULT = process.env.NVIDIA_DEB_POOL || '/opt/nvidia-pool'

/** @readonly */
const ALLOWED_BRANCHES = new Set(['535', '580', '595'])

const NVIDIA_SETTINGS_BINARIES = ['/usr/bin/nvidia-settings', '/usr/local/bin/nvidia-settings']

/**
 * Drivers present in pool: `nvidia-driver-<branch>_*.deb`
 * @param {string} poolPath
 * @returns {number[]}
 */
function scanPoolBranches(poolPath) {
	const out /** @type {number[]} */ = []
	const seen = new Set()
	try {
		if (!fs.existsSync(poolPath)) return out
		const files = fs.readdirSync(poolPath)
		const re = /^nvidia-driver-(\d+)_.+\.deb$/i
		for (const f of files) {
			const m = f.match(re)
			if (!m) continue
			const bn = parseInt(m[1], 10)
			if (!seen.has(bn) && ALLOWED_BRANCHES.has(String(bn))) {
				seen.add(bn)
				out.push(bn)
			}
		}
	} catch {
		/* ignore */
	}
	out.sort((a, b) => a - b)
	return out
}

async function gpuNvidiaGet() {
	/** @type {string[]|null} */
	let nvidiaSmiLines = null
	try {
		const { stdout } = await execFileAsync(
			'nvidia-smi',
			['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader'],
			{
				timeout: 8000,
				maxBuffer: 65536,
			},
		)
		const lines = String(stdout || '')
			.trim()
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean)
		if (lines.length) nvidiaSmiLines = lines
	} catch {
		nvidiaSmiLines = null
	}

	/** @type {string|null} */
	let loadedModuleVersion = null
	try {
		loadedModuleVersion =
			execFileSync('modinfo', ['-F', 'version', 'nvidia'], {
				encoding: 'utf8',
				timeout: 4000,
			}).trim() || null
	} catch {
		loadedModuleVersion = null
	}

	/** @type {string|null} */
	let dpkgDriverLine = null
	try {
		const { stdout } = await execFileAsync(
			'dpkg-query',
			['-W', '-f=${Package}\\t${Version}\\n', 'nvidia-driver-*', 'nvidia-dkms-*'],
			{
				timeout: 8000,
				maxBuffer: 256 * 1024,
			},
		)
		const lines = String(stdout || '')
			.trim()
			.split(/\r?\n/)
			.filter(Boolean)
		const pick =
			lines.find((l) => l.startsWith('nvidia-driver-')) || lines.find((l) => l.startsWith('nvidia-dkms-')) || null
		dpkgDriverLine = pick ? pick.replace(/\t/, ' ') : null
	} catch {
		dpkgDriverLine = null
	}

	const poolPath = POOL_DEFAULT
	const poolBranches = scanPoolBranches(poolPath)
	let poolStats = {}
	try {
		const st = fs.statSync(poolPath)
		poolStats = { exists: true, isDirectory: st.isDirectory(), mtimeMs: st.mtimeMs }
	} catch {
		poolStats = { exists: false, isDirectory: false }
	}

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			nvidiaSmiLines,
			loadedModuleVersion,
			dpkgDriverLine,
			poolPath,
			poolStats,
			poolBranches,
			allowedBranches: [...ALLOWED_BRANCHES].map((x) => parseInt(x, 10)).sort((a, b) => a - b),
			helperScript: NVIDIA_SCRIPT,
			helperPresent: fs.existsSync(NVIDIA_SCRIPT),
		}),
	}
}

/**
 * @returns {string|null}
 */
function resolveNvidiaSettings() {
	for (const bin of NVIDIA_SETTINGS_BINARIES) {
		try {
			if (fs.existsSync(bin)) return bin
		} catch {
			/* ignore */
		}
	}
	try {
		const p =
			execFileSync('/usr/bin/command', ['-v', 'nvidia-settings'], {
				encoding: 'utf8',
				timeout: 2000,
			}).trim() || null
		return p || null
	} catch {
		return null
	}
}

/**
 * @returns {string|null}
 */
function resolveDesktopvideoSetup() {
	try {
		const p =
			execFileSync('/usr/bin/command', ['-v', 'desktopvideo_setup'], {
				encoding: 'utf8',
				timeout: 2000,
			}).trim() || null
		if (p) return p
	} catch {
		/* ignore */
	}
	for (const p of ['/usr/bin/desktopvideo_setup', '/usr/local/bin/desktopvideo_setup']) if (fs.existsSync(p)) return p
	return null
}

/**
 * Blackmagic Desktop Video GUI updater heuristic (bundle layout varies).
 * @returns {string|null}
 */
function resolveBmdUpdater() {
	const candidates = []
	for (const pkg of ['desktopvideo-gui', 'desktopvideo']) {
		let out = ''
		try {
			out = execFileSync('dpkg', ['-L', pkg], { encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024 })
		} catch {
			continue
		}
		const lines = out.split('\n').map((s) => s.trim()).filter(Boolean)
		for (const line of lines) {
			if (!/^\/usr\/(s?bin)\//i.test(line)) continue
			try {
				const st = fs.statSync(line)
				if (!st.isFile() || !(st.mode & 0o111)) continue
			} catch {
				continue
			}
			const bn = path.basename(line).toLowerCase()
			const looksUpdater = bn.includes('updater') || bn.includes('installer')
			const looksBm = bn.includes('blackmagic') || bn.includes('desktopvideo')
			const looksFirmware = bn.includes('firmware')
			if ((looksBm && looksUpdater) || (looksFirmware && looksUpdater))
				candidates.push(line)
		}
	}
	return candidates.sort((a, b) => a.length - b.length)[0] || null
}

/**
 * Prefer ffmpeg enumeration; augment from recent Caspar log (model + internal device id).
 * @param {*} ff
 * @param {*} clog
 */
function mergeDecklinks(ff, clog) {
	/** @type {Map<number, { index: number, label: string, externalRef?: string }>} */
	const byIdx = new Map()
	for (const c of ff?.connectors || []) {
		byIdx.set(c.index, { index: c.index, label: c.label || `DeckLink [${c.index}]`, externalRef: c.externalRef })
	}
	for (const c of clog?.connectors || []) {
		const existing = byIdx.get(c.index)
		if (!existing) {
			byIdx.set(c.index, {
				index: c.index,
				label: c.label || `DeckLink [${c.index}]`,
				externalRef: c.externalRef,
			})
		} else {
			const labelBetter = existing.label.length < (c.label || '').length
			if (labelBetter && c.label) existing.label = c.label
			if (existing.externalRef == null && c.externalRef != null) existing.externalRef = c.externalRef
		}
	}
	const devices = [...byIdx.values()].sort((a, b) => a.index - b.index)
	return devices
}

async function decklinkGet() {
	let ff = null
	try {
		ff = await probeDecklinkHardware({ timeoutMs: 2600 })
	} catch {
		ff = null
	}

	const clog = probeDecklinkFromCasparLog({})
	const ffmpeg = ff || { source: 'ffmpeg_decklink', connectors: [], warning: 'ffmpeg probe failed or timed out' }
	const devices = mergeDecklinks(ffmpeg, clog)

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			devices,
			sourcesTried: {
				ffmpeg: ffmpeg.source,
				casparLog: clog.source,
				casparLogPath: clog.logPath ?? null,
			},
			warnings: [
				ffmpeg.warning,
				clog.warning,
			].filter(Boolean),
			updaterPath: resolveBmdUpdater(),
		}),
	}
}

/**
 * @param {string} action
 */
function spawnGuiDetached(action) {
	const bin =
		action === 'nvidia-settings' ?
			resolveNvidiaSettings()
		: action === 'desktopvideo_setup' ?
			resolveDesktopvideoSetup()
		: action === 'desktop_video_updater' ?
			resolveBmdUpdater()
		:	null

	if (!bin || !fs.existsSync(bin))
		throw new Error(`Launcher not installed or not on PATH (${action}).`)

	const env = { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() }

	const proc = spawn(bin, [], {
		env,
		detached: true,
		stdio: 'ignore',
	})
	proc.unref()
	return bin
}

/**
 * @param {string} p
 */
async function hardwareHandleGet(p) {
	if (p === '/api/system/gpu-nvidia') return gpuNvidiaGet()
	if (p === '/api/system/decklink') return decklinkGet()
	return null
}

/**
 * @param {string} p
 * @param {string} body
 * @param {*} ctx
 */
async function hardwareHandlePost(p, body, ctx) {
	if (p === '/api/system/gpu-nvidia/apply') {
		const pw = checkNuclearPassword(body, ctx)
		if (!pw.ok) return { status: pw.status || 403, headers: JSON_HEADERS, body: jsonBody({ error: pw.error }) }

		const parsed = parseBody(body)
		const branch = String(parsed?.branch ?? '').trim()
		if (!ALLOWED_BRANCHES.has(branch)) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Unsupported branch.' }) }
		}
		if (!fs.existsSync(NVIDIA_SCRIPT))
			return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: `Missing ${NVIDIA_SCRIPT} (installer phase 4?).` }) }

		try {
			await fs.promises.mkdir(path.dirname(NVIDIA_REQ), { recursive: true })
			await fs.promises.writeFile(NVIDIA_REQ, `${branch}\n`, { encoding: 'utf8', mode: 0o660 })
		} catch (e) {
			const m = e instanceof Error ? e.message : String(e)
			return {
				status: 500,
				headers: JSON_HEADERS,
				body: jsonBody({ error: `Cannot write request file: ${m}` }),
			}
		}

		let stdout = ''
		let stderr = ''
		let exitCode = 1
		try {
			await new Promise((resolve, reject) => {
				const child = spawn('sudo', ['-n', NVIDIA_SCRIPT], { env: process.env })
				child.stdout?.setEncoding?.('utf8')
				child.stderr?.setEncoding?.('utf8')
				child.stdout?.on('data', (d) => {
					stdout += d
				})
				child.stderr?.on('data', (d) => {
					stderr += d
				})
				const timer = setTimeout(() => {
					try {
						child.kill('SIGTERM')
					} catch {}
					reject(new Error('nvidia apply timed out'))
				}, 20 * 60 * 1000)
				child.once('error', (err) => {
					clearTimeout(timer)
					reject(err)
				})
				child.once('close', (code) => {
					clearTimeout(timer)
					exitCode = code ?? 1
					resolve()
				})
			})
		} catch (e) {
			const raw = stderr || (e && e.stderr) || (e instanceof Error ? e.message : String(e))
			const combinedCatch = String(stdout || '').trim() + (stderr ? `\n${String(stderr).trim()}` : '')
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({
					ok: false,
					exitCode: -1,
					error: String(raw || 'nvidia apply failed'),
					output: combinedCatch || String(raw || ''),
					rebootLikely: false,
				}),
			}
		}

		const combined =
			String(stdout || '').trim() + (stderr ? `\n${String(stderr).trim()}` : '')
		const okApply = exitCode === 0
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: okApply,
				exitCode,
				output: combined,
				error: okApply ? null : `Installer exited ${exitCode} — see output`,
				rebootLikely: okApply,
			}),
		}
	}

	if (p === '/api/system/gui-launch') {
		const pw = checkNuclearPassword(body, ctx)
		if (!pw.ok) return { status: pw.status || 403, headers: JSON_HEADERS, body: jsonBody({ error: pw.error }) }

		const b = parseBody(body)
		const action = String(b?.action ?? '').trim()
		const okActions = /** @type {const} */ (['nvidia-settings', 'desktopvideo_setup', 'desktop_video_updater'])
		if (!okActions.includes(/** @type {any} */ (action))) {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({ error: `Unknown action: ${action}` }),
			}
		}
		try {
			const exe = spawnGuiDetached(action)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, action, exe }) }
		} catch (e) {
			const m = e instanceof Error ? e.message : String(e)
			return {
				status: 502,
				headers: JSON_HEADERS,
				body: jsonBody({ error: m }),
			}
		}
	}

	if (p === '/api/system/gpu-ports-reset') {
		let raw = ''
		try {
			raw = execSync('xrandr --query', {
				env: { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() },
				stdio: ['ignore', 'pipe', 'ignore'],
			}).toString()
		} catch (e) {
			raw = ''
		}
		
		const lines = raw.split('\n')
		const outputs = []
		for (const line of lines) {
			const m = line.match(/^(\S+)\s+(connected|disconnected)\b/)
			if (m) {
				const name = m[1].replace(/^card\d+-/i, '')
				if (/^(DP|HDMI)/i.test(name)) {
					outputs.push(name)
				}
			}
		}
		
		function getCanonicalPair(port) {
			const match = port.match(/^(DP|HDMI)-(\d+)/i)
			if (!match) return [port]
			const prefix = match[1].toUpperCase()
			const num = parseInt(match[2], 10)
			const isEven = num % 2 === 0
			const first = isEven ? num : num - 1
			const second = first + 1
			return [`${prefix}-${first}`, `${prefix}-${second}`]
		}
		
		const pairs = []
		const seenPairs = new Set()
		
		for (const out of outputs) {
			const pArr = getCanonicalPair(out)
			const key = pArr.join(',')
			if (!seenPairs.has(key)) {
				seenPairs.add(key)
				const prefix = pArr[0].split('-')[0]
				const nums = pArr.map(x => x.split('-')[1]).join('/')
				const idx = pairs.length * 2
				pairs.push({
					id: `gpu_p${idx}_${idx+1}`,
					label: `${prefix} ${nums}`,
					pairs: pArr,
					type: prefix.toLowerCase() === 'hdmi' ? 'hdmi' : 'dp'
				})
			}
			if (pairs.length >= 4) break
		}
		
		while (pairs.length < 4) {
			const idx = pairs.length * 2
			pairs.push({
				id: `gpu_p${idx}_${idx+1}`,
				label: `None ${idx}/${idx+1}`,
				pairs: [],
				type: 'dp'
			})
		}
		
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, pairs }) }
	}

	return null
}

module.exports = {
	hardwareHandleGet,
	hardwareHandlePost,
}
