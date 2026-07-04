'use strict'

const { swallow } = require('../utils/swallow')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { resolveChannelFramerateForMixerTween } = require('../engine/scene-transition')

const GLOBAL_BORDER_LAYER = 998

const _pendingBorderClears = new Map()

function _borderKey(channel, layer) {
	return `${channel}-${layer}`
}

function _cancelPendingBorderClear(channel, layer) {
	const key = _borderKey(channel, layer)
	const t = _pendingBorderClears.get(key)
	if (t) {
		clearTimeout(t)
		_pendingBorderClears.delete(key)
	}
}

function _scheduleBorderClearAfterFade(ctx, channel, layer, fadeFrames) {
	_cancelPendingBorderClear(channel, layer)
	let framerate = 50
	try {
		framerate = resolveChannelFramerateForMixerTween(ctx, channel) || 50
	} catch (err) { swallow(err, { tag: 'scene-border' }) }
	const fadeMs = Math.ceil((Math.max(1, fadeFrames) / Math.max(1, framerate)) * 1000) + 100
	const { buildGlobalBorderClearLines } = require('../engine/global-border')
	const key = _borderKey(channel, layer)
	const timer = setTimeout(async () => {
		_pendingBorderClears.delete(key)
		try {
			if (!ctx.amcp) return
			const clearLines = buildGlobalBorderClearLines(channel, layer)
			for (const line of clearLines) {
				try { await ctx.amcp.raw(line) } catch (err) { swallow(err, { tag: 'scene-border:amcp' }) }
			}
		} catch (e) {
			if (typeof ctx.log === 'function') {
				ctx.log('warn', `[global-border] post-fade clear failed: ${e?.message || e}`)
			}
		}
	}, fadeMs)
	_pendingBorderClears.set(key, timer)
}

function _normalizeGlobalBorder(border) {
	if (!border || typeof border !== 'object') return border
	return {
		...border,
		params: { ...(border.params || {}), side: 'inside' },
	}
}

async function handleBorderLines(body, ctx) {
	const b = parseBody(body)
	const channel = parseInt(b.channel, 10)
	const rawBorder = b.border
	const isUpdate = !!b.isUpdate
	const rawLayer = parseInt(b.layer, 10)
	const layer =
		Number.isFinite(rawLayer) && rawLayer >= 1 && rawLayer <= 9998 ? rawLayer : GLOBAL_BORDER_LAYER

	if (!channel || channel < 1) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'channel required' }) }
	}

	const {
		buildGlobalBorderAmcpLines,
		buildGlobalBorderClearLines,
		buildGlobalBorderOpacityFadeLine,
		borderPayloadToOverlay,
	} = require('../engine/global-border')
	const {
		writeGlobalBorderLiveFile,
		markCasparBorderType,
		casparBorderTypeChanged,
		clearCasparBorderType,
	} = require('../engine/global-border-live')

	const fadeDuration = Math.max(0, parseInt(rawBorder?.fadeDuration ?? 0, 10) || 0)
	const border = _normalizeGlobalBorder(rawBorder)

	const overlay = border ? borderPayloadToOverlay(border) : null
	let lines = []
	if (overlay && border.enabled) {
		writeGlobalBorderLiveFile(channel, overlay)
		_cancelPendingBorderClear(channel, layer)
		const typeChanged = casparBorderTypeChanged(channel, overlay.type)
		if (isUpdate && !typeChanged) {
			lines = []
		} else if (fadeDuration > 0 && !isUpdate) {
			lines = buildGlobalBorderAmcpLines(channel, layer, overlay, ctx, { initialOpacity: 0 })
			lines.push(buildGlobalBorderOpacityFadeLine(channel, layer, 1, fadeDuration))
			markCasparBorderType(channel, overlay.type)
		} else {
			lines = buildGlobalBorderAmcpLines(channel, layer, overlay, ctx, {
				initialOpacity: isUpdate && typeChanged ? 1 : 1,
			})
			markCasparBorderType(channel, overlay.type)
		}
	} else {
		clearCasparBorderType(channel)
		if (fadeDuration > 0) {
			lines = [buildGlobalBorderOpacityFadeLine(channel, layer, 0, fadeDuration)]
			_scheduleBorderClearAfterFade(ctx, channel, layer, fadeDuration)
		} else {
			lines = buildGlobalBorderClearLines(channel, layer)
		}
	}

	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ lines }) }
}

async function handleBorderPresetCrossfade(body, ctx) {
	const b = parseBody(body)
	const channel = parseInt(b.channel, 10)
	const fromLayer = parseInt(b.fromLayer, 10)
	const toLayer = parseInt(b.toLayer, 10)
	const inactiveMode = b.inactiveMode === 'add' ? 'add' : 'update'
	const fadeDuration = Math.max(0, parseInt(String(b.fadeDuration ?? 25), 10) || 25)
	if (!channel || channel < 1) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'channel required' }) }
	}
	if (!Number.isFinite(fromLayer) || !Number.isFinite(toLayer)) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'fromLayer and toLayer required' }) }
	}
	const rawBorder = b.border
	if (!rawBorder || typeof rawBorder !== 'object') {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'border object required' }) }
	}
	const { buildGlobalBorderPresetCrossfadeLines } = require('../engine/global-border')
	const border = _normalizeGlobalBorder(rawBorder)
	_cancelPendingBorderClear(channel, fromLayer)
	_cancelPendingBorderClear(channel, toLayer)
	const lines = buildGlobalBorderPresetCrossfadeLines(channel, fromLayer, toLayer, border, ctx, fadeDuration, inactiveMode)
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ lines }) }
}

module.exports = {
	handleBorderLines,
	handleBorderPresetCrossfade,
}
