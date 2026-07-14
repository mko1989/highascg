'use strict'

const { parentPort } = require('worker_threads')
const { transformFixtureCoords, averageRegion } = require('./fixture-transform')

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
			const { sample, grid, colorOrder, gamma, brightness, rotation, mirrorH, mirrorV, sampleMode } = fixture

			if (gamma) updateGammaTable(gamma)

			const sx = (sample.x || 0) * scale
			const sy = (sample.y || 0) * scale
			const sw = (sample.w || width / scale) * scale
			const sh = (sample.h || height / scale) * scale

			const cols = grid.cols || 1
			const rows = grid.rows || 1

			const cw = sw / cols
			const ch = sh / rows

			const fixtureDmx = []

			const centerX = sx + sw / 2
			const centerY = sy + sh / 2
			const mode = sampleMode || 'center'

			for (let r = 0; r < rows; r++) {
				for (let c = 0; c < cols; c++) {
					let avgR = 0, avgG = 0, avgB = 0

					if (mode === 'average') {
						// Region average: sample all pixels in the cell
						// Compute corners of the cell in local coords
						const lx0 = c * cw - sw / 2
						const ly0 = r * ch - sh / 2
						const lx1 = (c + 1) * cw - sw / 2
						const ly1 = (r + 1) * ch - sh / 2

						// Transform all four corners and find bounding box
						const corners = [
							transformFixtureCoords(lx0, ly0, !!mirrorH, !!mirrorV, rotation || 0),
							transformFixtureCoords(lx1, ly0, !!mirrorH, !!mirrorV, rotation || 0),
							transformFixtureCoords(lx0, ly1, !!mirrorH, !!mirrorV, rotation || 0),
							transformFixtureCoords(lx1, ly1, !!mirrorH, !!mirrorV, rotation || 0),
						]

						let minRx = Infinity, maxRx = -Infinity, minRy = Infinity, maxRy = -Infinity
						for (const c of corners) {
							minRx = Math.min(minRx, c.rx)
							maxRx = Math.max(maxRx, c.rx)
							minRy = Math.min(minRy, c.ry)
							maxRy = Math.max(maxRy, c.ry)
						}

						// Global frame coords
						const gx0 = centerX + minRx
						const gx1 = centerX + maxRx
						const gy0 = centerY + minRy
						const gy1 = centerY + maxRy

						const region = averageRegion(frame, width, height, gx0, gx1, gy0, gy1)
						avgR = region.r
						avgG = region.g
						avgB = region.b
					} else {
						// Center mode: sample single pixel at cell center
						const lx = (c + 0.5) * cw - sw / 2
						const ly = (r + 0.5) * ch - sh / 2

						// Apply mirror and rotation transform
						const { rx, ry } = transformFixtureCoords(lx, ly, !!mirrorH, !!mirrorV, rotation || 0)

						// Global scaled coords
						const gx = Math.round(centerX + rx)
						const gy = Math.round(centerY + ry)

						if (gx >= 0 && gx < width && gy >= 0 && gy < height) {
							const idx = (gy * width + gx) * 3
							avgR = frame[idx]
							avgG = frame[idx + 1]
							avgB = frame[idx + 2]
						}
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
