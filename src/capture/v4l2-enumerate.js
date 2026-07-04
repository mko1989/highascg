'use strict'

const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')

const LOOPBACK_NAME_RE = /v4l2loopback|casparcg out|highascg virtual cam/i
const METADATA_FORMAT_RE = /^UVCH$/i

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {number} timeoutMs
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function execFileAsync(cmd, args, timeoutMs = 2000) {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
			if (err && !stdout && !stderr) {
				reject(err)
				return
			}
			resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') })
		})
	})
}

/**
 * @param {string} name
 * @returns {string|null}
 */
function excludedReasonForName(name) {
	const n = String(name || '').trim()
	if (!n) return null
	if (LOOPBACK_NAME_RE.test(n)) return 'loopback_output'
	return null
}

/**
 * Parse `v4l2-ctl --list-devices` blocks.
 * @param {string} text
 * @returns {Array<{ name: string, paths: string[] }>}
 */
function parseListDevices(text) {
	const blocks = String(text || '')
		.split(/\n\s*\n/)
		.map((b) => b.trim())
		.filter(Boolean)
	/** @type {Array<{ name: string, paths: string[] }>} */
	const out = []
	for (const block of blocks) {
		const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
		if (!lines.length) continue
		const name = lines[0].replace(/:$/, '').trim()
		const paths = lines.slice(1).filter((l) => l.startsWith('/dev/'))
		if (name && paths.length) out.push({ name, paths })
	}
	return out
}

/**
 * @param {string} pixelFormat e.g. MJPG
 * @returns {string}
 */
function normalizeInputFormat(pixelFormat) {
	const pf = String(pixelFormat || '').trim().toUpperCase()
	if (pf === 'MJPG' || pf === 'MJPEG') return 'mjpeg'
	if (pf === 'YUYV' || pf === 'YUYV422') return 'yuyv422'
	return pf.toLowerCase()
}

/**
 * @param {string} listFormatsExt
 * @returns {Array<{ pixelFormat: string, width: number, height: number, fps: number[] }>}
 */
function parseListFormatsExt(listFormatsExt) {
	const text = String(listFormatsExt || '')
	const formats = []
	const typeRe = /^\s*\[\d+\]:\s*'([^']+)'/gm
	let m
	while ((m = typeRe.exec(text)) !== null) {
		const pixelFormat = m[1]
		const start = m.index
		const next = typeRe.exec(text)
		typeRe.lastIndex = next ? next.index : text.length
		const chunk = text.slice(start, typeRe.lastIndex)
		const sizeRe = /Size:\s*Discrete\s+(\d+)x(\d+)/g
		let sm
		while ((sm = sizeRe.exec(chunk)) !== null) {
			const width = parseInt(sm[1], 10)
			const height = parseInt(sm[2], 10)
			const intervalChunk = chunk.slice(sm.index, sm.index + 400)
			const fps = []
			const fpsRe = /Interval:\s*Discrete\s+(?:[\d.]+s\s+\(([\d.]+)\s+fps\)|[\d.]+\s+fps,\s+([\d.]+)\s+fps)/g
			let fm
			while ((fm = fpsRe.exec(intervalChunk)) !== null) {
				const f = parseFloat(fm[1] || fm[2])
				if (Number.isFinite(f) && f > 0 && !fps.includes(f)) fps.push(f)
			}
			formats.push({ pixelFormat, width, height, fps })
		}
		if (!formats.some((f) => f.pixelFormat === pixelFormat)) {
			formats.push({ pixelFormat, width: 0, height: 0, fps: [] })
		}
	}
	return formats.filter((f) => !METADATA_FORMAT_RE.test(f.pixelFormat))
}

/**
 * @param {string} devicePath
 * @returns {Promise<{ capabilities: string[], formats: object[] }>}
 */
async function probeCaptureDevice(devicePath) {
	try {
		const { stdout } = await execFileAsync('v4l2-ctl', ['-d', devicePath, '--all'], 1500)
		const caps = []
		if (/Video Capture/i.test(stdout)) caps.push('capture')
		if (/Metadata Capture/i.test(stdout) && !/Device Caps[\s\S]*Video Capture/i.test(stdout)) {
			// metadata-only node on composite devices
		}
		if (/Streaming/i.test(stdout)) caps.push('streaming')
		let formats = []
		try {
			const fm = await execFileAsync('v4l2-ctl', ['-d', devicePath, '--list-formats-ext'], 1500)
			formats = parseListFormatsExt(fm.stdout)
		} catch (_) {}
		const hasVideoCapture =
			caps.includes('capture') && formats.some((f) => f.width > 0 && f.height > 0 && !METADATA_FORMAT_RE.test(f.pixelFormat))
		if (!hasVideoCapture && /Device Caps[\s\S]*Video Capture/i.test(stdout)) {
			// Device Caps says capture even if --list-formats-ext failed
			if (!caps.includes('capture')) caps.push('capture')
		}
		return { capabilities: caps, formats }
	} catch {
		return { capabilities: [], formats: [] }
	}
}

/**
 * @param {string} devicePath
 * @returns {string|null}
 */
function resolveStableId(devicePath) {
	try {
		const base = path.basename(devicePath)
		const dir = `/dev/v4l/by-id`
		if (!fs.existsSync(dir)) return null
		for (const ent of fs.readdirSync(dir)) {
			const full = path.join(dir, ent)
			try {
				if (fs.realpathSync(full) === fs.realpathSync(devicePath)) return full
			} catch (_) {}
			try {
				if (fs.readlinkSync(full).endsWith(base)) return full
			} catch (_) {}
		}
	} catch (_) {}
	return null
}

/**
 * @param {{ refresh?: boolean }} [opts]
 * @returns {Promise<{ devices: object[], warnings: object[] }>}
 */
async function enumerateV4l2CaptureDevices(opts = {}) {
	void opts
	/** @type {object[]} */
	const devices = []
	/** @type {object[]} */
	const warnings = []

	try {
		const { stdout, stderr } = await execFileAsync('v4l2-ctl', ['--list-devices'], 2000)
		if (stderr && /not found|No such file/i.test(stderr)) {
			warnings.push({ code: 'v4l2_enum_unavailable', message: 'v4l2-ctl failed', detail: stderr.slice(0, 200) })
			return { devices, warnings }
		}
		const blocks = parseListDevices(stdout)
		for (const block of blocks) {
			const nameExcluded = excludedReasonForName(block.name)
			for (const devicePath of block.paths) {
				const probe = await probeCaptureDevice(devicePath)
				const metadataOnly =
					probe.formats.length > 0 &&
					probe.formats.every((f) => METADATA_FORMAT_RE.test(f.pixelFormat))
				const captureCapable =
					!metadataOnly &&
					(probe.capabilities.includes('capture') ||
						probe.formats.some((f) => f.width > 0 && f.height > 0))
				let excludedReason = nameExcluded
				if (!excludedReason && !captureCapable) excludedReason = 'metadata_only'
				devices.push({
					path: devicePath,
					name: block.name,
					stableId: resolveStableId(devicePath),
					capabilities: probe.capabilities,
					formats: probe.formats,
					captureCapable: captureCapable && !excludedReason,
					excludedReason,
				})
			}
		}
	} catch (e) {
		warnings.push({
			code: 'v4l2_enum_unavailable',
			message: 'Could not enumerate V4L2 devices (install v4l-utils)',
			detail: e?.message || String(e),
		})
	}

	return { devices, warnings }
}

module.exports = {
	enumerateV4l2CaptureDevices,
	parseListDevices,
	parseListFormatsExt,
	normalizeInputFormat,
	excludedReasonForName,
}
