/**
 * POST /api/mixer/:command — keyer, blend, fill, clip, …
 * @see companion-module-casparcg-server/src/api-routes.js handleMixer / handleMixerSafe
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

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
	} catch {}
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

/**
 * @param {string} path
 * @param {string} body
 * @param {{ amcp: import('../caspar/amcp-client').AmcpClient }} ctx
 */
async function handleMixer(path, body, ctx) {
	const m = path.match(/^\/api\/mixer\/([^/]+)$/)
	if (!m) return null
	const b = parseBody(body)
	const { channel = 1, layer } = b
	const amcp = ctx.amcp

	const cmd = m[1].toLowerCase()
	let r
	switch (cmd) {
		case 'keyer':
			r = await amcp.mixer.mixerKeyer(channel, layer, b.keyer)
			break
		case 'chroma':
			r = await amcp.mixer.mixerChroma(channel, layer, b)
			break
		case 'blend':
			r = await amcp.mixer.mixerBlend(channel, layer, b.mode)
			break
		case 'invert':
			r = await amcp.mixer.mixerInvert(channel, layer, b.invert)
			break
		case 'straight_alpha':
			r = await amcp.mixer.mixerStraightAlphaOutput(channel, b.enable)
			break
		case 'opacity':
			r = await amcp.mixer.mixerOpacity(channel, layer, b.opacity, b.duration, b.tween, b.defer)
			break
		case 'brightness':
			r = await amcp.mixer.mixerBrightness(channel, layer, b.value, b.duration, b.tween, b.defer)
			break
		case 'saturation':
			r = await amcp.mixer.mixerSaturation(channel, layer, b.value, b.duration, b.tween, b.defer)
			break
		case 'contrast':
			r = await amcp.mixer.mixerContrast(channel, layer, b.value, b.duration, b.tween, b.defer)
			break
		case 'levels':
			r = await amcp.mixer.mixerLevels(channel, layer, b) // options object
			break
		case 'fill': {
			let fx = b.x
			let fy = b.y
			let fxs = b.xScale
			let fys = b.yScale
			const stretchMode = b.stretch
			if (stretchMode && stretchMode !== 'stretch') {
				const contentRes = await queryLayerContentRes(ctx, channel, layer)
				if (contentRes) {
					const resW = b.channelW || 1920
					const resH = b.channelH || 1080
					const lw = b.layerW || resW
					const lh = b.layerH || resH
					const lx = b.layerX != null ? b.layerX : fx * resW
					const ly = b.layerY != null ? b.layerY : fy * resH
					const sf = calcStretchFill(stretchMode, lx, ly, lw, lh, resW, resH, contentRes.w, contentRes.h)
					fx = sf.x
					fy = sf.y
					fxs = sf.xScale
					fys = sf.yScale
					if (sf.clip) {
						try {
							await amcp.mixer.mixerClip(channel, layer, sf.clip.x, sf.clip.y, sf.clip.w, sf.clip.h)
						} catch {}
					} else {
						try {
							await amcp.mixer.mixerClip(channel, layer, 0, 0, 1, 1)
						} catch {}
					}
				}
			} else if (stretchMode === 'stretch') {
				try {
					await amcp.mixer.mixerClip(channel, layer, 0, 0, 1, 1)
				} catch {}
			}
			r = await amcp.mixer.mixerFill(channel, layer, fx, fy, fxs, fys, b.duration, b.tween, b.defer)
			break
		}
		case 'clip':
			r = await amcp.mixer.mixerClip(channel, layer, b.x, b.y, b.xScale, b.yScale, b.duration, b.tween, b.defer)
			break
		case 'anchor':
			r = await amcp.mixer.mixerAnchor(channel, layer, b.x, b.y, b.duration, b.tween, b.defer)
			break
		case 'crop':
			r = await amcp.mixer.mixerCrop(channel, layer, b.left, b.top, b.right, b.bottom, b.duration, b.tween, b.defer)
			break
		case 'rotation':
			r = await amcp.mixer.mixerRotation(channel, layer, b.degrees, b.duration, b.tween, b.defer)
			break
		case 'volume':
			r = await amcp.mixer.mixerVolume(channel, layer, b.volume, b.duration, b.tween, b.defer)
			break
		case 'mastervolume':
			r = await amcp.mixer.mixerMastervolume(channel, b.volume, b.duration, b.tween, b.defer)
			break
		case 'grid':
			r = await amcp.mixer.mixerGrid(channel, b.resolution, b.duration, b.tween, b.defer)
			break
		case 'commit':
			r = await amcp.mixer.mixerCommit(channel)
			break
		case 'clear':
			r = await amcp.mixer.mixerClear(channel, layer)
			break
		default:
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: `Unknown mixer command: ${cmd}` }) }
	}
	return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
}

async function handleMixerSafe(path, body, ctx) {
	try {
		return await handleMixer(path, body, ctx)
	} catch (e) {
		const msg = e?.message || String(e)
		const isConnection = /not connected|socket|econnrefused|etimedout|econnreset|connection refused|network/i.test(
			msg,
		)
		return {
			status: isConnection ? 503 : 502,
			headers: JSON_HEADERS,
			body: jsonBody({ error: msg }),
		}
	}
}

async function handlePost(path, body, ctx) {
	if (!ctx.amcp) return null
	return handleMixerSafe(path, body, ctx)
}

async function handleGet(path, query, ctx) {
	const m = path.match(/^\/api\/mixer\/([^/]+)$/)
	if (!m) return null
	if (!ctx.amcp) return null
	// Delegate to the same function but with query converted to body
	// Our AmcpMixer methods are designed such that if arguments are undefined, it will send the query command
	const surrogateBody = JSON.stringify({
		channel: query.channel ? parseInt(query.channel, 10) : 1,
		layer: query.layer ? parseInt(query.layer, 10) : undefined,
	})
	return handleMixerSafe(path, surrogateBody, ctx)
}

module.exports = { handlePost, handleGet }
