/**
 * NVIDIA driver status (read-only) + GPU → ISO branch recommendation guide.
 * Single-driver-per-ISO: no pool apply (see WO_single-nvidia-driver-per-iso.md).
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { promisify } = require('util')

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

const execFileAsync = promisify(require('child_process').execFile)

const ISO_DRIVER_STAMP = '/etc/highascg/nvidia-iso-driver'
const GUIDE_PATH = path.join(__dirname, '../../data/nvidia-driver-guide.json')

/** @readonly */
const KNOWN_BRANCHES = new Set(['535', '580', '595'])

function readIsoDriverStamp() {
	try {
		if (!fs.existsSync(ISO_DRIVER_STAMP)) return null
		const br = String(fs.readFileSync(ISO_DRIVER_STAMP, 'utf8')).trim()
		return KNOWN_BRANCHES.has(br) ? br : br || null
	} catch {
		return null
	}
}

function loadDriverGuide() {
	try {
		if (!fs.existsSync(GUIDE_PATH)) return null
		return JSON.parse(fs.readFileSync(GUIDE_PATH, 'utf8'))
	} catch {
		return null
	}
}

/**
 * @param {string} gpuLine e.g. "NVIDIA GeForce RTX 3060, 12288 MiB"
 * @param {object|null} guide
 */
function recommendBranchForGpu(gpuLine, guide) {
	if (!guide || typeof guide !== 'object') return { branch: null, note: null }
	const name = String(gpuLine || '').toUpperCase()
	const rules = Array.isArray(guide.gpuRules) ? guide.gpuRules : []
	for (const rule of rules) {
		const m = String(rule.match || '').toUpperCase()
		if (!m || !name.includes(m)) continue
		const br = String(rule.recommendedBranch ?? '').trim()
		return {
			branch: KNOWN_BRANCHES.has(br) ? br : null,
			note: rule.note ? String(rule.note) : null,
		}
	}
	const def = String(guide.defaultBranch ?? '').trim()
	return {
		branch: KNOWN_BRANCHES.has(def) ? def : null,
		note: guide.defaultNote ? String(guide.defaultNote) : null,
	}
}

async function ubuntuDriversRecommendedBranch() {
	try {
		const { stdout } = await execFileAsync('ubuntu-drivers', ['devices'], {
			timeout: 15000,
			maxBuffer: 256 * 1024,
		})
		const line = String(stdout || '')
			.split(/\r?\n/)
			.find((l) => /recommended/i.test(l))
		if (!line) return null
		const m = line.match(/nvidia-driver-(\d+)/i)
		return m ? String(m[1]) : null
	} catch {
		return null
	}
}

async function gpuNvidiaGet() {
	/** @type {string[]|null} */
	let nvidiaSmiLines = null
	try {
		const { stdout } = await execFileAsync(
			'nvidia-smi',
			['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader'],
			{ timeout: 8000, maxBuffer: 65536 },
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
	let loadedModuleVersion
	try {
		loadedModuleVersion =
			execFileSync('modinfo', ['-F', 'version', 'nvidia'], { encoding: 'utf8', timeout: 4000 }).trim() || null
	} catch {
		loadedModuleVersion = null
	}

	/** @type {string|null} */
	let dpkgDriverLine
	try {
		const { stdout } = await execFileAsync(
			'dpkg-query',
			['-W', '-f=${Package}\\t${Version}\\n', 'nvidia-driver-*', 'nvidia-dkms-*'],
			{ timeout: 8000, maxBuffer: 256 * 1024 },
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

	const isoDriver = readIsoDriverStamp()
	const guide = loadDriverGuide()
	const primaryGpu = nvidiaSmiLines?.[0] || null
	const guidePick = recommendBranchForGpu(primaryGpu || '', guide)
	const ubuntuRecommended = await ubuntuDriversRecommendedBranch()

	const isoMatchesRecommended =
		isoDriver && guidePick.branch ? isoDriver === guidePick.branch : null
	const isoMatchesUbuntu =
		isoDriver && ubuntuRecommended ? isoDriver === ubuntuRecommended : null

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			nvidiaSmiLines,
			loadedModuleVersion,
			dpkgDriverLine,
			isoDriver,
			ubuntuDriversRecommendedBranch: ubuntuRecommended,
			recommendedBranch: guidePick.branch,
			guideNote: guidePick.note,
			isoMatchesRecommended,
			isoMatchesUbuntu,
			driverSwitchSupported: false,
			message:
				'This image uses one baked NVIDIA driver per ISO. Flash the ISO built for your GPU branch (535 / 580 / 595).',
			branchLabels: guide?.branches || null,
		}),
	}
}

/**
 * @param {string} body
 */
async function handleGpuNvidiaApply(body) {
	parseBody(body)
	return {
		status: 410,
		headers: JSON_HEADERS,
		body: jsonBody({
			error:
				'NVIDIA driver branch switching was removed. Build or flash the correct single-driver ISO (HIGHASCG_NVIDIA_DRIVER=535|580|595). See GET /api/system/gpu-nvidia for recommendations.',
			driverSwitchSupported: false,
		}),
	}
}

module.exports = {
	gpuNvidiaGet,
	handleGpuNvidiaApply,
}
