/**
 * NVIDIA driver pool scan, status GET, guarded apply POST (WO-39).
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execFileSync } = require('child_process')
const { promisify } = require('util')

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { checkNuclearPassword } = require('./routes-system-setup')

const execFileAsync = promisify(require('child_process').execFile)

/** @readonly */
const NVIDIA_SCRIPT =
	process.env.HIGHASCG_NVIDIA_APPLY_SCRIPT || '/usr/local/lib/highascg/nvidia-apply-from-pool.sh'

const NVIDIA_REQ = '/run/highascg/nvidia-apply.req'

/** Fallback when env unset — matches live image picker default path. */
const POOL_DEFAULT = process.env.NVIDIA_DEB_POOL || '/opt/nvidia-pool'

/** @readonly */
const ALLOWED_BRANCHES = new Set(['535', '580', '595'])

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
 * @param {string} body
 * @param {*} ctx
 */
async function handleGpuNvidiaApply(body, ctx) {
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

module.exports = {
	gpuNvidiaGet,
	handleGpuNvidiaApply,
}
