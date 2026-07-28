'use strict'

/**
 * GET /api/system/gpu-layout — legacy GPU port layout (deprecated WO-108).
 * Prefer live.gpu.physicalMap from GET /api/device-view or buildGpuPhysicalMap server-side.
 */

const fs = require('fs')
const path = require('path')
const { promisify } = require('util')
const execFileAsync = promisify(require('child_process').execFile)
const { getGpuConnectorInventory } = require('../utils/hardware-info')
const { JSON_HEADERS, jsonBody } = require('./response')

const DB_PATH = path.join(__dirname, '../../data/gpu_database.json')

/**
 * Helper to get the installed NVIDIA GPU name via nvidia-smi.
 */
async function getInstalledGpuName() {
	try {
		const { stdout } = await execFileAsync(
			'nvidia-smi',
			['--query-gpu=name', '--format=csv,noheader'],
			{ timeout: 5000, maxBuffer: 65536 }
		)
		const lines = String(stdout || '').trim().split(/\r?\n/)
		if (lines.length > 0) return lines[0].trim()
	} catch {
		// Suppress or log error if no nvidia GPU is found.
		return null
	}
	return null
}

/**
 * Physical GPU ports from live connector inventory (xrandr + EDID).
 */
function getPhysicalPortsFromXrandrInventory() {
	const connectors = getGpuConnectorInventory() || []
	const ports = connectors.map((c, i) => {
		const connectorName = String(c.shortName || c.name || '').replace(/^card\d+-/i, '')
		let type = connectorName
		if (type.startsWith('DP-')) type = 'DisplayPort'
		else if (type.startsWith('eDP-')) type = 'eDP'
		else if (type.startsWith('HDMI-')) type = 'HDMI'
		else if (type.startsWith('DVI-')) type = 'DVI'
		else if (type.startsWith('VGA-')) type = 'VGA'

		return {
			id: `port-${i}`,
			type,
			sys_name: connectorName,
			xrandr_name: c.xrandrName || null,
			connected: !!c.connected,
			version: 'unknown',
			position: i + 1,
		}
	})

	ports.sort((a, b) => {
		if (a.type === 'eDP' && b.type !== 'eDP') return -1
		if (b.type === 'eDP' && a.type !== 'eDP') return 1
		return a.sys_name.localeCompare(b.sys_name)
	})
	ports.forEach((p, i) => {
		p.id = `port-${i}`
		p.position = i + 1
	})
	return ports
}

/**
 * Generates the GPU layout JSON to send to the client.
 */
async function handleGpuLayoutGet() {
	let db = []
	try {
		if (fs.existsSync(DB_PATH)) {
			db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'))
		}
	} catch {
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: 'Failed to load GPU database' }) }
	}

	const gpuName = await getInstalledGpuName()

	const drmPorts = getPhysicalPortsFromXrandrInventory()

	// Try finding an exact or fuzzy match in the database.
	let match = null
	if (gpuName) {
		match = db.find(card => 
			gpuName.toLowerCase() === card.board_model.toLowerCase() ||
			gpuName.toLowerCase().includes(card.gpu_family.toLowerCase())
		)
	}

	if (!match && drmPorts.length === 0) {
		return { 
			status: 404, 
			headers: JSON_HEADERS, 
			body: jsonBody({ 
				error: gpuName ? `GPU '${gpuName}' not found in the database, and no DRM ports detected.` : 'No NVIDIA GPU detected on this server, and no DRM ports detected.',
				detected_gpu: gpuName || null
			}) 
		}
	}

	let ports = []
	if (drmPorts.length > 0) {
		ports = drmPorts
	} else if (match) {
		// Unroll the output ports
		let portIndex = 0

		// Typically, DisplayPort ports are prioritized sequentially left-to-right on the backplate.
		for (const output of match.video_outputs) {
			for (let i = 0; i < output.count; i++) {
				ports.push({
					id: `port-${portIndex}`,
					type: output.type,
					version: output.version || 'unknown',
					position: portIndex + 1
				})
				portIndex++
			}
		}
	}

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			detected_gpu: gpuName,
			match: match ? match.board_model : 'DRM Detected',
			layout: {
				slot_width: 1, // You could expand this logic if you add slot_width to the JSON
				ports: ports
			}
		})
	}
}

module.exports = {
	handleGpuLayoutGet,
	getPhysicalPortsFromXrandrInventory,
}
