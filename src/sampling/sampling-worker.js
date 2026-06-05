'use strict'

const { parentPort } = require('worker_threads')

/**
 * Pre-computed gamma table for 8-bit values.
 * @type {Uint8Array}
 */
let gammaTable = new Uint8Array(256)
let currentGamma = 1.0

function updateGammaTable(gamma) {
	if (gamma === currentGamma) return
	currentGamma = gamma
	for (let i = 0; i < 256; i++) {
		gammaTable[i] = Math.round(Math.pow(i / 255, gamma) * 255)
	}
}

updateGammaTable(2.2) // Default

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {string} order - 'rgb', 'grb', 'rgbw', 'rgbwa', etc.
 * @returns {number[]}
 */
function extractColors(r, g, b, order) {
	const format = (order || 'rgb').toLowerCase()
	const w = Math.min(r, g, b)
	const amber = Math.min(r, g) * 0.5

	// Plain RGB / GRB / … : send **raw** 8-bit channels (what you see on the PGM frame).
	// RGBW-style (r-w, g-w, b-w, w) only when the format includes **w** or **a**.
	if (!/[wa]/.test(format)) {
		const out = []
		for (let i = 0; i < format.length; i++) {
			const char = format[i]
			if (char === 'r') out.push(r)
			else if (char === 'g') out.push(g)
			else if (char === 'b') out.push(b)
		}
		return out.length ? out : [r, g, b]
	}

	const components = []
	for (let i = 0; i < format.length; i++) {
		const char = format[i]
		if (char === 'r') components.push(r - w)
		else if (char === 'g') components.push(g - w)
		else if (char === 'b') components.push(b - w)
		else if (char === 'w') components.push(w)
		else if (char === 'a') components.push(amber)
	}
	return components.length ? components : [r, g, b]
}

parentPort.on('message', (msg) => {
	const { type, payload } = msg

	if (type === 'process') {
		const { frame, fixtures, width, height, scale } = payload
		const results = []

		for (const fixture of fixtures) {
			const { sample, grid, colorOrder, gamma, brightness, rotation } = fixture
			
			if (gamma) updateGammaTable(gamma)
			
			const sx = (sample.x || 0) * scale
			const sy = (sample.y || 0) * scale
			const sw = (sample.w || width / scale) * scale
			const sh = (sample.h || height / scale) * scale
			const angle = (rotation || 0) * (Math.PI / 180)

			const cols = grid.cols || 1
			const rows = grid.rows || 1
			
			const cw = sw / cols
			const ch = sh / rows
			
			const fixtureDmx = []
			
			const cosA = Math.cos(angle)
			const sinA = Math.sin(angle)
			const centerX = sx + sw / 2
			const centerY = sy + sh / 2

			for (let r = 0; r < rows; r++) {
				for (let c = 0; c < cols; c++) {
					// Local coords (centered at fixture center)
					const lx = (c + 0.5) * cw - sw / 2
					const ly = (r + 0.5) * ch - sh / 2
					
					// Rotated coords
					const rx = lx * cosA - ly * sinA
					const ry = lx * sinA + ly * cosA
					
					// Global scaled coords
					const gx = Math.round(centerX + rx)
					const gy = Math.round(centerY + ry)
					
					let avgR = 0, avgG = 0, avgB = 0
					
					if (gx >= 0 && gx < width && gy >= 0 && gy < height) {
						const idx = (gy * width + gx) * 3
						avgR = frame[idx]
						avgG = frame[idx+1]
						avgB = frame[idx+2]
					}
					
					// Apply brightness
					avgR *= (brightness || 1.0)
					avgG *= (brightness || 1.0)
					avgB *= (brightness || 1.0)
					
					// Apply gamma
					avgR = gammaTable[Math.min(255, Math.max(0, Math.round(avgR)))]
					avgG = gammaTable[Math.min(255, Math.max(0, Math.round(avgG)))]
					avgB = gammaTable[Math.min(255, Math.max(0, Math.round(avgB)))]
					
					const colors = extractColors(avgR, avgG, avgB, colorOrder)
					fixtureDmx.push(...colors)
				}
			}
			
			results.push({
				id: fixture.id, // Include ID for UI sync
				universe: fixture.universe,
				startChannel: fixture.startChannel,
				data: fixtureDmx
			})
		}

		parentPort.postMessage({ type: 'results', payload: results })
	}
})
