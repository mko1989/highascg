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
const { resolveSceneById } = require('../engine/project-scenes')

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

/** Resolve Caspar preview (PRV) channel for a program take request. */
function resolvePreviewChannel(routeMap, mainIdx, requestChannel) {
	if (mainIdx >= 0) {
		return routeMap.switcherBus1Channels?.[mainIdx] ?? routeMap.previewChannels?.[mainIdx] ?? null
	}
	const ch = parseInt(requestChannel, 10)
	const previews = (routeMap.previewChannels || []).map((p) => Number(p)).filter((n) => Number.isFinite(n) && n > 0)
	return previews.includes(ch) ? ch : null
}

function isPreviewTakeTarget(body) {
	const t = String(body?.target || body?.bus || '').toLowerCase()
	return t === 'preview' || t === 'prv' || t === 'bus1'
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

	const sceneIdRaw = b.sceneId ?? b.lookId ?? b.incomingSceneId
	if ((!b.incomingScene || typeof b.incomingScene !== 'object') && sceneIdRaw != null && String(sceneIdRaw).trim()) {
		const fromProject = resolveSceneById(sceneIdRaw)
		if (fromProject) {
			b.incomingScene = fromProject
		}
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
		mainScreenIndex: -1,
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
		const bus1 = resolvePreviewChannel(routeMap, mainIdx, channel)
		const bus2 = null
		const previewOnly = isPreviewTakeTarget(b)
		// Preview bus mapped to the same physical channel as PGM — treat as PGM-only (no staging/exchange on shared air).
		const sharedPreviewBus = bus1 != null && Number(bus1) === Number(channel)

		if (previewOnly && bus1 == null) {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({
					error:
						'Preview take requested but this main has no preview bus (PGM-only destination). Use a normal program take or add a PGM/PRV screen destination.',
				}),
			}
		}

		if (previewOnly && bus1 != null) {
			if (typeof ctx.log === 'function') {
				ctx.log('info', `[scene-take] preview-only path prv=${bus1}`)
			}
			const prvCurrent = liveSceneState.getChannel(bus1)?.scene || null
			await runSceneTakeLbg(ctx.amcp, {
				...takeOpts,
				channel: bus1,
				currentScene: prvCurrent,
				incomingScene: inc,
				forceCut: !!b.forceCut,
				self: ctx,
				skipLayerVisualEquality: true,
			})
			if (inc && typeof inc === 'object' && inc.id) {
				liveSceneState.setChannel(bus1, { sceneId: String(inc.id), scene: stripEphemeralTakeFields(inc) })
			}
			liveSceneState.broadcastSceneLive(ctx)
			return
		}

		takeOpts.mainScreenIndex = mainIdx
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
		// 2-channel PGM/PRV: stage incoming on PRV (bus1), then take the same look on PGM; swap previous PGM onto PRV.
		if (bus1 != null && bus2 == null && !sharedPreviewBus) {
			if (typeof ctx.log === 'function') {
				ctx.log('info', `[scene-take] pgm/prv path ch=${channel} prv=${bus1}`)
			}
			const previousPgmScene = currentScene
			const stageOnPreview = b.stageOnPreview !== false
			if (stageOnPreview) {
				const prvCurrent = liveSceneState.getChannel(bus1)?.scene || null
				// PRV is a staging bus only: hard-cut so PGM can run the real transition without waiting twice.
				await runSceneTakeLbg(ctx.amcp, {
					...takeOpts,
					channel: bus1,
					currentScene: prvCurrent,
					incomingScene: inc,
					forceCut: true,
					self: ctx,
					skipLayerVisualEquality: true,
				})
				if (inc && typeof inc === 'object' && inc.id) {
					liveSceneState.setChannel(bus1, {
						sceneId: String(inc.id),
						scene: stripEphemeralTakeFields(inc),
					})
				}
			}
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
						if (typeof ctx.log === 'function') {
							ctx.log('info', `[scene-take] pgm->prv exchange done prvCh=${bus1}`)
						}
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
				skipLayerVisualEquality: true,
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
		const pgmOnly = bus1 == null || sharedPreviewBus
		if (pgmOnly && typeof ctx.log === 'function') {
			ctx.log(
				'info',
				`[scene-take] pgm-only stack ch=${channel} (no A/B banks; CUT / +Animate only)${sharedPreviewBus ? ' shared-preview-bus' : ''}`,
			)
		}
		// PGM-only (and any layout without a real preview bus): there is no separate PRV stack to
		// pre-build looks on, so live JSON often matches the incoming look while Caspar still needs
		// a fresh PLAY (re-take, recovery, or first air). Skip the layerVisuallyEqual no-op shortcut.
		await runSceneTakeLbg(ctx.amcp, { ...takeOpts, self: ctx, skipLayerVisualEquality: true, pgmOnly })
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
		// Param/slice changes: live JSON only (template polls). CG ADD only when type changes.
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
