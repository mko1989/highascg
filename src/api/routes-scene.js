/**
 * POST /api/scene/take — program look transition (AMCP + banks).
 * @see companion-module-casparcg-server/src/api-routes.js handleSceneTake
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const playbackTracker = require('../state/playback-tracker')
const liveSceneState = require('../state/live-scene-state')
const { layerHasContent, normalizeTransition, resolveChannelFramerateForMixerTween } = require('../engine/scene-transition')
const { runSceneTakeLbg } = require('../engine/scene-take-lbg')
const { clearSceneProgramLookStackLayers } = require('../engine/scene-exit-layers')
const { getChannelMap, getRouteString } = require('../config/routing')

const TAKE_TIMEOUT_MS = 120000
const OUT_PRIMARY_LAYER = 1

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Remove take-only fields from stored live scene JSON. */
function stripEphemeralTakeFields(scene) {
	if (!scene || typeof scene !== 'object') return scene
	const layers = Array.isArray(scene.layers)
		? scene.layers.map((L) => {
				if (!L || typeof L !== 'object') return L
				const { playSeekFrames, ...rest } = L
				return rest
			})
		: scene.layers
	return { ...scene, layers }
}

function sameSceneId(a, b) {
	const aid = a && typeof a === 'object' && a.id != null ? String(a.id) : ''
	const bid = b && typeof b === 'object' && b.id != null ? String(b.id) : ''
	return !!aid && !!bid && aid === bid
}

/**
 * @param {string} body
 * @param {object} ctx — app context (`self` in companion)
 */
async function handleSceneTake(body, ctx) {
	const b = parseBody(body)
	const channel = parseInt(b.channel, 10)
	if (!channel || channel < 1) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'channel required' }) }
	}

	if (!b.incomingScene || typeof b.incomingScene !== 'object') {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'incomingScene object required (layer list missing from take request)' }),
		}
	}
	if (!Array.isArray(b.incomingScene.layers)) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'incomingScene.layers must be an array' }),
		}
	}
	if (!b.incomingScene.layers.some(layerHasContent)) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({
				error:
					'incomingScene has no layers with sources — client must send full scene JSON on take (check browser / Companion proxy is not stripping the body)',
			}),
		}
	}

	const useClientCurrentScene = b.useServerLive === false && Object.prototype.hasOwnProperty.call(b, 'currentScene')
	const requestedCurrentScene = useClientCurrentScene ? b.currentScene : null

	const inc = b.incomingScene
	const routeMap = getChannelMap(ctx.config || {}, ctx.switcherOutputBusByChannel)
	const takeOpts = {
		channel,
		currentScene: null,
		incomingScene: inc,
		framerate: b.framerate,
		forceCut: !!b.forceCut,
	}
	const runTake = async () => {
		// Resolve currentScene at execution time (inside queue) to avoid stale-state races
		// when multiple rapid take requests are enqueued for the same channel.
		const currentScene = useClientCurrentScene
			? requestedCurrentScene
			: (liveSceneState.getChannel(channel)?.scene || null)
		let mainIdx = Array.isArray(routeMap.programChannels) ? routeMap.programChannels.indexOf(channel) : -1
		if (mainIdx < 0 && routeMap.programCh && Number.isFinite(routeMap.screenCount)) {
			for (let i = 0; i < routeMap.screenCount; i++) {
				if (routeMap.programCh(i + 1) === channel) {
					mainIdx = i
					break
				}
			}
		}
		const bus1 = mainIdx >= 0 ? (routeMap.switcherBus1Channels?.[mainIdx] ?? routeMap.previewChannels?.[mainIdx] ?? null) : null
		const bus2 = null
		if (typeof ctx.log === 'function') {
			const sceneName = String(inc?.name || '').trim()
			ctx.log(
				'info',
				`[scene-take] scene=${String(inc?.id || 'n/a')}${sceneName ? ` (${sceneName})` : ''} scope=${String(inc?.mainScope || 'n/a')} ch=${channel} main=${mainIdx >= 0 ? mainIdx + 1 : 'n/a'} bus1=${bus1 ?? 'n/a'} bus2=${bus2 ?? 'n/a'} forceCut=${!!b.forceCut}`,
			)
		}
		// Unknown PGM slot (map drift vs client, or auxiliary channel): skip PGM↔PRV exchange — still run LOADBG/PLAY on `channel`.
		if (mainIdx < 0 && typeof ctx.log === 'function') {
			ctx.log(
				'warn',
				`[scene-take] channel ${channel} not in routing programChannels — using direct-program path (no pgm/prv exchange)`,
			)
		}
		// 2-channel PGM/PRV workflow: build incoming on PRV, then transition PGM route to PRV.
		if (bus1 != null && bus2 == null) {
			if (typeof ctx.log === 'function') {
				ctx.log('info', `[scene-take] pgm/prv path ch=${channel} prv=${bus1}`)
			}
			// Removed: We allow re-taking the same look so users can re-trigger animations or videos.
			// Native layer transitions are superior because they don't require detaching a route,
			// preventing playback time jumps and double-decoding on the PGM channel.
			const previousPgmScene = currentScene
			let previewExchangePromise = null
			let previewExchangeStarted = false
			const startPreviewExchange = () => {
				if (previewExchangeStarted) return previewExchangePromise
				if (
					!previousPgmScene ||
					typeof previousPgmScene !== 'object' ||
					!Array.isArray(previousPgmScene.layers) ||
					!previousPgmScene.layers.some(layerHasContent)
				) {
					return null
				}
				previewExchangeStarted = true
				previewExchangePromise = (async () => {
					try {
						// After PGM take completes: wipe PRV occupied look-stack layers, then hard-cut the *pre-take* PGM look onto PRV (no transition, no fade).
						await clearSceneProgramLookStackLayers(ctx.amcp, bus1, ctx)
						await runSceneTakeLbg(ctx.amcp, {
							...takeOpts,
							channel: bus1,
							currentScene: null,
							incomingScene: previousPgmScene,
							forceCut: true,
							self: ctx,
							skipLayerVisualEquality: true,
						})
						const prevId = String(previousPgmScene.id || `preview_${Date.now()}`)
						liveSceneState.setChannel(bus1, { sceneId: prevId, scene: stripEphemeralTakeFields(previousPgmScene) })
					} catch (e) {
						if (typeof ctx.log === 'function') ctx.log('warn', `[scene-take] pgm->prv exchange failed: ${e?.message || e}`)
					}
				})()
				return previewExchangePromise
			}

			await runSceneTakeLbg(ctx.amcp, {
				...takeOpts,
				channel,
				currentScene: previousPgmScene,
				incomingScene: inc,
				forceCut: !!b.forceCut,
				self: ctx,
			})
			if (inc && typeof inc === 'object' && inc.id) {
				liveSceneState.setChannel(channel, { sceneId: String(inc.id), scene: stripEphemeralTakeFields(inc) })
			}

			// Bus exchange: previous PGM look on PRV — runs only after PGM take finishes (no AMCP race with the PGM mix).
			startPreviewExchange()
			if (previewExchangePromise) await previewExchangePromise
			liveSceneState.broadcastSceneLive(ctx)
			return
		}
		if (typeof ctx.log === 'function') {
			ctx.log('info', `[scene-take] direct-program path ch=${channel} (no pgm/prv bus exchange)`)
		}
		// PGM-only (and any layout without a real preview bus): there is no separate PRV stack to
		// pre-build looks on, so live JSON often matches the incoming look while Caspar still needs
		// a fresh PLAY (re-take, recovery, or first air). Skip the layerVisuallyEqual no-op shortcut.
		await runSceneTakeLbg(ctx.amcp, { ...takeOpts, self: ctx, skipLayerVisualEquality: true })
		if (inc && typeof inc === 'object' && inc.id) {
			liveSceneState.setChannel(channel, { sceneId: String(inc.id), scene: stripEphemeralTakeFields(inc) })
		}
		liveSceneState.broadcastSceneLive(ctx)
	}

	if (!ctx._sceneTakeChainByChannel) ctx._sceneTakeChainByChannel = {}
	const chKey = String(channel)
	const prev = ctx._sceneTakeChainByChannel[chKey] || Promise.resolve()
	const takePromise = prev.then(() => runTake())
	ctx._sceneTakeChainByChannel[chKey] = takePromise.catch(() => {})

	try {
		await Promise.race([
			takePromise,
			new Promise((_, reject) => setTimeout(() => reject(new Error('Scene take timed out')), TAKE_TIMEOUT_MS)),
		])
	} catch (e) {
		const log = ctx.log
		if (typeof log === 'function') log('error', 'Scene take failed: ' + (e?.message || e))
		const msg = e?.message || String(e)
		const timedOut = /timed out/i.test(msg)
		return {
			status: timedOut ? 504 : 500,
			headers: JSON_HEADERS,
			body: jsonBody({ error: msg || 'Scene take failed' }),
		}
	}

	const matrix = playbackTracker.getMatrixForState(ctx)
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			ok: true,
			sceneLive: liveSceneState.getAll(),
			playbackMatrix: matrix,
		}),
	}
}

const GLOBAL_BORDER_LAYER = 998

// Pending fade-out CG CLEAR timers per `${channel}-${layer}`, so a re-enable before the
// fade finishes cancels the pending clear (otherwise the new CG would be wiped).
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
	} catch (_) {}
	const fadeMs = Math.ceil((Math.max(1, fadeFrames) / Math.max(1, framerate)) * 1000) + 100
	const { buildGlobalBorderClearLines } = require('../engine/global-border')
	const key = _borderKey(channel, layer)
	const timer = setTimeout(async () => {
		_pendingBorderClears.delete(key)
		try {
			if (!ctx.amcp) return
			const clearLines = buildGlobalBorderClearLines(channel, layer)
			for (const line of clearLines) {
				try { await ctx.amcp.raw(line) } catch (_) {}
			}
		} catch (e) {
			if (typeof ctx.log === 'function') {
				ctx.log('warn', `[global-border] post-fade clear failed: ${e?.message || e}`)
			}
		}
	}, fadeMs)
	_pendingBorderClears.set(key, timer)
}

/**
 * Normalize the global border payload for AMCP template rendering.
 * - Force `side: 'inside'` — `outside` pushes the frame past the body edge, which
 *   the HTML consumer renders as scrollbars (and hides the actual border).
 */
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
		buildGlobalBorderUpdateLines,
		buildGlobalBorderClearLines,
		buildGlobalBorderOpacityFadeLine,
	} = require('../engine/global-border')

	const fadeDuration = Math.max(0, parseInt(rawBorder?.fadeDuration ?? 0, 10) || 0)
	const border = _normalizeGlobalBorder(rawBorder)

	let lines = []
	if (border && border.enabled) {
		// A pending fade-out clear would wipe the new CG mid-render.
		_cancelPendingBorderClear(channel, layer)
		if (isUpdate) {
			lines = buildGlobalBorderUpdateLines(channel, layer, border)
		} else if (fadeDuration > 0) {
			lines = buildGlobalBorderAmcpLines(channel, layer, border, ctx, { initialOpacity: 0 })
			lines.push(buildGlobalBorderOpacityFadeLine(channel, layer, 1, fadeDuration))
		} else {
			lines = buildGlobalBorderAmcpLines(channel, layer, border, ctx, { initialOpacity: 1 })
		}
	} else {
		if (fadeDuration > 0) {
			lines = [buildGlobalBorderOpacityFadeLine(channel, layer, 0, fadeDuration)]
			// MIXER OPACITY 0 leaves the CG resident — schedule a CLEAR after the fade so
			// a subsequent enable can ADD cleanly and we don't keep a dead template loaded.
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

async function handlePost(path, body, ctx) {
	if (path === '/api/scene/take') {
		if (!ctx.amcp) return null
		return handleSceneTake(body, ctx)
	}
	if (path === '/api/scene/border-lines') {
		return handleBorderLines(body, ctx)
	}
	if (path === '/api/scene/border-preset-crossfade') {
		return handleBorderPresetCrossfade(body, ctx)
	}
	return null
}

module.exports = { handlePost, handleSceneTake }
