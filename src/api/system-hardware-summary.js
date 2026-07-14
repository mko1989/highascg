/**
 * WO-189: Aggregator for hardware summary display in settings.
 * Collects CPU, memory, disks, GPU, DeckLink, audio, network, and system info.
 * Cached static sections (~60 s), all probes with per-probe timeouts, total budget <3 s.
 */

'use strict'

const os = require('os')
const fs = require('fs')
const { execFile } = require('child_process')
const { promisify } = require('util')
const execFileAsync = promisify(execFile)

const { JSON_HEADERS, jsonBody } = require('./response')
const { gpuNvidiaGet } = require('./system-hardware-nvidia')
const { decklinkGet } = require('./system-hardware-decklink')
const { getPhysicalPortsFromXrandrInventory } = require('./system-hardware-gpu-layout')
const { listAudioDevices } = require('../audio/audio-devices')
const { buildNetworkStatus } = require('../system/network-inventory')

const STATIC_CACHE_TTL_MS = 60000

/** @type {{ cpuModel: string|null, osRelease: string|null, kernel: string|null, at: number }} */
let _staticCache = { cpuModel: null, osRelease: null, kernel: null, at: 0 }

/**
 * Read CPU model name from /proc/cpuinfo (first occurrence).
 * @returns {string|null}
 */
function readCpuModelName() {
	try {
		if (process.platform !== 'linux') return null
		const text = fs.readFileSync('/proc/cpuinfo', 'utf8')
		const match = text.match(/^model name\s*:\s*(.+)$/m)
		return match ? match[1].trim() : null
	} catch {
		return null
	}
}

/**
 * Read distro name from /etc/os-release PRETTY_NAME.
 * @returns {string|null}
 */
function readOsRelease() {
	try {
		if (process.platform !== 'linux') {
			return `${os.type()} ${os.release()}`
		}
		const text = fs.readFileSync('/etc/os-release', 'utf8')
		const match = text.match(/^PRETTY_NAME\s*=\s*"?([^"\n]+)"?$/m)
		return match ? match[1].trim() : null
	} catch {
		return null
	}
}

/**
 * Read kernel version via os.release().
 * @returns {string|null}
 */
function readKernel() {
	try {
		return os.release()
	} catch {
		return null
	}
}

/**
 * Parse `lsblk -J` output for disk info; skip loop/ram devices.
 * @returns {Promise<Array<{name: string, size: string, type: string, mountpoint: string|null}>>}
 */
async function readDisksFromLsblk() {
	try {
		const { stdout } = await execFileAsync('lsblk', ['-J'], { timeout: 2000, maxBuffer: 2e6 })
		const data = JSON.parse(stdout)
		const disks = []
		const blockdevices = Array.isArray(data?.blockdevices) ? data.blockdevices : []
		for (const dev of blockdevices) {
			const type = String(dev.type || '').toLowerCase()
			const name = String(dev.name || '')
			if (type === 'loop' || type === 'ram' || /^loop|^ram/.test(name)) continue
			disks.push({
				name,
				size: dev.size || null,
				type,
				mountpoint: dev.mountpoint || null,
			})
		}
		return disks
	} catch {
		return []
	}
}

/**
 * Get static cached sections, or refresh if TTL expired.
 * @returns {{ cpuModel: string|null, osRelease: string|null, kernel: string|null }}
 */
function getStaticCached() {
	const now = Date.now()
	if (now - _staticCache.at < STATIC_CACHE_TTL_MS && _staticCache.cpuModel != null) {
		return {
			cpuModel: _staticCache.cpuModel,
			osRelease: _staticCache.osRelease,
			kernel: _staticCache.kernel,
		}
	}
	const cpuModel = readCpuModelName()
	const osRelease = readOsRelease()
	const kernel = readKernel()
	_staticCache = { cpuModel, osRelease, kernel, at: now }
	return { cpuModel, osRelease, kernel }
}

/**
 * Safely gather CPU info with load average.
 * @returns {{modelName: string|null, cores: number, load1: number, load5: number, load15: number}|null}
 */
async function gatherCpu() {
	try {
		const static_ = getStaticCached()
		const cores = os.cpus()?.length || 0
		const load = os.loadavg()
		return {
			modelName: static_.cpuModel,
			cores,
			load1: load[0],
			load5: load[1],
			load15: load[2],
		}
	} catch {
		return null
	}
}

/**
 * Safely gather memory info.
 * @returns {{totalBytes: number, usedBytes: number, freeBytes: number}|null}
 */
async function gatherMemory() {
	try {
		const total = os.totalmem()
		const free = os.freemem()
		return {
			totalBytes: total,
			usedBytes: total - free,
			freeBytes: free,
		}
	} catch {
		return null
	}
}

/**
 * Safely gather GPU NVIDIA info.
 * @returns {{name: string|null, driver: string|null, vramMiB: string|null}|null}
 */
async function gatherGpuNvidia() {
	try {
		const res = await gpuNvidiaGet()
		const body = res?.body
		if (!body) return null
		const json = typeof body === 'string' ? JSON.parse(body) : body
		const lines = Array.isArray(json?.nvidiaSmiLines) ? json.nvidiaSmiLines : []
		if (!lines.length) return null
		const parts = lines[0].split(',').map((s) => s.trim())
		return {
			name: parts[0] || null,
			driver: json.loadedModuleVersion || parts[1] || null,
			vramMiB: parts[2] || null,
		}
	} catch {
		return null
	}
}

/**
 * Safely gather GPU display ports from xrandr inventory.
 * @returns {Array<{type: string, connected: boolean, name: string}>|null}
 */
async function gatherGpuDisplayPorts() {
	try {
		const ports = getPhysicalPortsFromXrandrInventory()
		return Array.isArray(ports)
			? ports.map((p) => ({
					type: p.type,
					connected: !!p.connected,
					name: p.sys_name,
				}))
			: null
	} catch {
		return null
	}
}

/**
 * Safely gather DeckLink devices.
 * @returns {{devices: Array<{index: number, label: string}>, source: string}|null}
 */
async function gatherDecklink() {
	try {
		const res = await decklinkGet()
		const body = res?.body
		if (!body) return null
		const json = typeof body === 'string' ? JSON.parse(body) : body
		const devices = Array.isArray(json?.devices)
			? json.devices.map((d) => ({
					index: d.index,
					label: d.label,
				}))
			: []
		return { devices, source: json?.sourcesTried?.primary || null }
	} catch {
		return null
	}
}

/**
 * Safely gather audio device count.
 * @returns {{deviceCount: number, devices: Array<{type: string, name: string}>}|null}
 */
async function gatherAudio() {
	try {
		const info = listAudioDevices({ refresh: false })
		const devices = Array.isArray(info?.devices) ? info.devices : []
		return {
			deviceCount: devices.length,
			devices: devices.slice(0, 10).map((d) => ({
				type: d.type || 'unknown',
				name: d.name || d.id || 'unnamed',
			})),
		}
	} catch {
		return null
	}
}

/**
 * Safely gather network info.
 * @param {object} [ctx]
 * @returns {{hostname: string, interfaceCount: number, interfaces: Array<{name: string, address: string|null}>}|null}
 */
async function gatherNetwork(ctx) {
	try {
		const hostname = os.hostname()
		const networkCfg = ctx?.config?.network || null
		const status = buildNetworkStatus(networkCfg)
		const interfaces = Array.isArray(status?.interfaces)
			? status.interfaces.map((i) => ({
					name: i.name,
					address: i.address,
				}))
			: []
		return {
			hostname,
			interfaceCount: interfaces.length,
			interfaces,
		}
	} catch {
		return null
	}
}

/**
 * Safely gather system info.
 * @returns {{osRelease: string|null, kernel: string|null, uptimeSec: number}|null}
 */
async function gatherSystem() {
	try {
		const static_ = getStaticCached()
		return {
			osRelease: static_.osRelease,
			kernel: static_.kernel,
			uptimeSec: Math.round(os.uptime()),
		}
	} catch {
		return null
	}
}

/**
 * Main aggregator: gather all hardware info with timeouts and error handling.
 * @param {object} [ctx]
 * @returns {Promise<object>}
 */
async function getHardwareSummary(ctx) {
	const results = await Promise.allSettled([
		gatherCpu(),
		gatherMemory(),
		readDisksFromLsblk(),
		gatherGpuNvidia(),
		gatherGpuDisplayPorts(),
		gatherDecklink(),
		gatherAudio(),
		gatherNetwork(ctx),
		gatherSystem(),
	])

	const [cpu, memory, disks, gpuNvidia, gpuPorts, decklink, audio, network, system] = results.map((r) =>
		r.status === 'fulfilled' ? r.value : null,
	)

	return {
		cpu: cpu ? { ...cpu } : { error: 'Unable to read CPU info' },
		memory: memory ? { ...memory } : { error: 'Unable to read memory info' },
		disks: Array.isArray(disks) && disks.length > 0 ? disks : [{ error: 'Unable to read disk info' }],
		gpu: {
			nvidia: gpuNvidia ? { ...gpuNvidia } : { error: 'No NVIDIA GPU detected' },
			displayPorts: Array.isArray(gpuPorts) ? gpuPorts : [],
		},
		decklink: decklink
			? { devices: decklink.devices, source: decklink.source }
			: { devices: [], error: 'Unable to probe DeckLink' },
		audio: audio ? { ...audio } : { error: 'Unable to enumerate audio devices' },
		network: network ? { ...network } : { error: 'Unable to read network info' },
		system: system ? { ...system } : { error: 'Unable to read system info' },
	}
}

/**
 * Handler for GET /api/system/hardware
 * @param {object} [ctx]
 */
async function handleHardwareSummaryGet(ctx) {
	try {
		const data = await getHardwareSummary(ctx)
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody(data),
		}
	} catch (err) {
		return {
			status: 500,
			headers: JSON_HEADERS,
			body: jsonBody({
				error: 'Failed to gather hardware summary',
				message: err instanceof Error ? err.message : String(err),
			}),
		}
	}
}

module.exports = {
	handleHardwareSummaryGet,
	getHardwareSummary,
}
