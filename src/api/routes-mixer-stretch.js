'use strict'

const { swallow } = require('../utils/swallow')

/**
 * @param {{ amcp: import('../caspar/amcp-client').AmcpClient }} ctx
 * @param {number|string} channel
 * @param {number|string} layer
 */
async function queryLayerContentRes(ctx, channel, layer) {
	try {
		const info = await ctx.amcp.info(channel, layer)
		const s = Array.isArray(info?.data) ? info.data.join('\n') : String(info?.data || '')
		const wm = s.match(/<width>\s*(\d+)\s*<\/width>/i)
		const hm = s.match(/<height>\s*(\d+)\s*<\/height>/i)
		if (wm && hm) {
			const w = parseInt(wm[1], 10)
			const h = parseInt(hm[1], 10)
			if (w > 0 && h > 0) return { w, h }
		}
	} catch (err) { swallow(err, { tag: 'routes-mixer-stretch' }) }
	return null
}

function calcStretchFill(mode, lx, ly, lw, lh, resW, resH, cw, ch) {
	const nx = lx / resW
	const ny = ly / resH
	const clipRect = { x: nx, y: ny, w: lw / resW, h: lh / resH }
	const ar = cw / ch

	if (mode === 'none') {
		return {
			x: nx,
			y: ny,
			xScale: cw / resW,
			yScale: ch / resH,
			clip: cw > lw || ch > lh ? clipRect : null,
		}
	}
	if (mode === 'fit') {
		const fitScale = Math.min(lw / cw, lh / ch)
		const outW = cw * fitScale
		const outH = ch * fitScale
		const ox = lx + (lw - outW) / 2
		const oy = ly + (lh - outH) / 2
		return { x: ox / resW, y: oy / resH, xScale: outW / resW, yScale: outH / resH, clip: null }
	}
	if (mode === 'fill-h') {
		const outW = lw
		const outH = outW / ar
		const oy = ly + (lh - outH) / 2
		return {
			x: nx,
			y: oy / resH,
			xScale: outW / resW,
			yScale: outH / resH,
			clip: outH > lh ? clipRect : null,
		}
	}
	if (mode === 'fill-v') {
		const outH = lh
		const outW = outH * ar
		const ox = lx + (lw - outW) / 2
		return {
			x: ox / resW,
			y: ny,
			xScale: outW / resW,
			yScale: outH / resH,
			clip: outW > lw ? clipRect : null,
		}
	}
	return { x: nx, y: ny, xScale: lw / resW, yScale: lh / resH, clip: null }
}

module.exports = {
	queryLayerContentRes,
	calcStretchFill,
}
