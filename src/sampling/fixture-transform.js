'use strict'

/**
 * Apply mirror and rotation transform to local fixture coordinates.
 *
 * @param {number} lx - Local X coordinate (relative to fixture center)
 * @param {number} ly - Local Y coordinate (relative to fixture center)
 * @param {boolean} mirrorH - Mirror horizontal (negate X)
 * @param {boolean} mirrorV - Mirror vertical (negate Y)
 * @param {number} rotation - Rotation in degrees (0-360)
 * @returns {{ rx: number, ry: number }} - Rotated coordinates
 */
function transformFixtureCoords(lx, ly, mirrorH, mirrorV, rotation) {
	// Apply mirror BEFORE rotation (in local coordinate space)
	let mx = mirrorH ? -lx : lx
	let my = mirrorV ? -ly : ly

	// Apply rotation
	const angle = rotation * (Math.PI / 180)
	const cosA = Math.cos(angle)
	const sinA = Math.sin(angle)
	const rx = mx * cosA - my * sinA
	const ry = mx * sinA + my * cosA

	return { rx, ry }
}

/**
 * Sample pixels in a cell using region averaging.
 * Averages all RGB values within the cell's bounding box.
 *
 * @param {Uint8Array|Uint8ClampedArray} frame - RGB frame data
 * @param {number} frameWidth - Frame width in pixels
 * @param {number} frameHeight - Frame height in pixels
 * @param {number} minX - Min X of cell in frame coords
 * @param {number} maxX - Max X of cell in frame coords
 * @param {number} minY - Min Y of cell in frame coords
 * @param {number} maxY - Max Y of cell in frame coords
 * @returns {{ r: number, g: number, b: number }} - Averaged RGB
 */
function averageRegion(frame, frameWidth, frameHeight, minX, maxX, minY, maxY) {
	let sumR = 0, sumG = 0, sumB = 0
	let count = 0

	const x1 = Math.max(0, Math.floor(minX))
	const x2 = Math.min(frameWidth - 1, Math.ceil(maxX))
	const y1 = Math.max(0, Math.floor(minY))
	const y2 = Math.min(frameHeight - 1, Math.ceil(maxY))

	// Stride for sampling: cap at roughly 64 samples per cell
	const cellW = x2 - x1 + 1
	const cellH = y2 - y1 + 1
	const targetSamples = Math.sqrt(64)
	const strideX = Math.max(1, Math.ceil(cellW / targetSamples))
	const strideY = Math.max(1, Math.ceil(cellH / targetSamples))

	for (let y = y1; y <= y2; y += strideY) {
		for (let x = x1; x <= x2; x += strideX) {
			const idx = (y * frameWidth + x) * 3
			sumR += frame[idx] || 0
			sumG += frame[idx + 1] || 0
			sumB += frame[idx + 2] || 0
			count++
		}
	}

	if (count === 0) {
		return { r: 0, g: 0, b: 0 }
	}

	return {
		r: Math.round(sumR / count),
		g: Math.round(sumG / count),
		b: Math.round(sumB / count),
	}
}

module.exports = {
	transformFixtureCoords,
	averageRegion,
}
