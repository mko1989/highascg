'use strict'

/**
 * Split a square companion-thumb JPEG buffer into four quadrant PNG data-URIs.
 */

const jpeg = require('jpeg-js')
const { PNG } = require('pngjs')

const QUADRANT_OFFSET = {
	tl: { x: 0, y: 0 },
	tr: { x: 0.5, y: 0 },
	bl: { x: 0, y: 0.5 },
	br: { x: 0.5, y: 0.5 },
}

/**
 * @param {Buffer} jpegBuf
 * @returns {{ width: number, height: number, data: Buffer } | null}
 */
function decodeJpegRaster(jpegBuf) {
	try {
		const decoded = jpeg.decode(jpegBuf, { useTArray: true })
		if (!decoded?.width || !decoded?.height) return null
		return {
			width: decoded.width,
			height: decoded.height,
			data: Buffer.from(decoded.data),
		}
	} catch {
		return null
	}
}

/**
 * @param {{ width: number, height: number, data: Buffer }} raster
 * @param {'tl'|'tr'|'bl'|'br'} quadrant
 * @returns {Buffer}
 */
function cropQuadrantPng(raster, quadrant) {
	const w = raster.width
	const h = raster.height
	const qw = Math.max(1, Math.floor(w / 2))
	const qh = Math.max(1, Math.floor(h / 2))
	const off = QUADRANT_OFFSET[quadrant]
	const x = Math.floor(w * off.x)
	const y = Math.floor(h * off.y)
	const out = new PNG({ width: qw, height: qh })

	for (let row = 0; row < qh; row += 1) {
		for (let col = 0; col < qw; col += 1) {
			const srcIdx = ((y + row) * w + (x + col)) * 4
			const dstIdx = (row * qw + col) * 4
			out.data[dstIdx] = raster.data[srcIdx]
			out.data[dstIdx + 1] = raster.data[srcIdx + 1]
			out.data[dstIdx + 2] = raster.data[srcIdx + 2]
			out.data[dstIdx + 3] = raster.data[srcIdx + 3] ?? 255
		}
	}

	return PNG.sync.write(out)
}

/**
 * @param {Buffer} jpegBuf
 * @returns {Partial<Record<'tl'|'tr'|'bl'|'br', string>>}
 */
function splitCompanionThumbQuadrants(jpegBuf) {
	const raster = decodeJpegRaster(jpegBuf)
	if (!raster || raster.width < 2 || raster.height < 2) return {}

	/** @type {Partial<Record<'tl'|'tr'|'bl'|'br', string>>} */
	const out = {}
	for (const quad of /** @type {const} */ (['tl', 'tr', 'bl', 'br'])) {
		try {
			const png = cropQuadrantPng(raster, quad)
			if (png.length > 32) {
				out[quad] = `data:image/png;base64,${png.toString('base64')}`
			}
		} catch {
			/* skip */
		}
	}
	return out
}

/**
 * @param {number} channel
 * @param {'tl'|'tr'|'bl'|'br'} quadrant
 */
function quadrantVariableKey(channel, quadrant) {
	return `compose_preview_ch${channel}_quad_${quadrant}`
}

module.exports = {
	splitCompanionThumbQuadrants,
	quadrantVariableKey,
}
