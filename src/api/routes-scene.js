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

	let currentScene = null
	if (b.useServerLive === false && Object.prototype.hasOwnProperty.call(b, 'currentScene')) {
		currentScene = b.currentScene
	} else {
		const stored = liveSceneState.getChannel(channel)
		currentScene = stored?.scene || null
	}

	const inc = b.incomingScene
	const routeMap = getChannelMap(ctx.config || {}, ctx.switcherOutputBusByChannel)
	const takeOpts = {
		channel,
		currentScene,
		incomingScene: inc,
		framerate: b.framerate,
		forceCut: !!b.forceCut,
	}
	const runTake = async () => {
		const mainIdx = Array.isArray(routeMap.programChannels) ? routeMap.programChannels.indexOf(channel) : -1
		const bus1 = mainIdx >= 0 ? (routeMap.switcherBus1Channels?.[mainIdx] ?? routeMap.previewChannels?.[mainIdx] ?? null) : null
		const bus2 = null
		if (typeof ctx.log === 'function') {
			ctx.log(
				'info',
				`[scene-take] scene=${String(inc?.id || 'n/a')} scope=${String(inc?.mainScope || 'n/a')} ch=${channel} main=${mainIdx >= 0 ? mainIdx + 1 : 'n/a'} bus1=${bus1 ?? 'n/a'} bus2=${bus2 ?? 'n/a'} forceCut=${!!b.forceCut}`,
			)
		}
		// PGM-only screens are intentionally single-channel (resource-saving mode): no bus switch path.
		if (mainIdx < 0) {
			throw new Error(`scene take requires a valid output channel, got ${channel}`)
		}
		// 2-channel PGM/PRV workflow: build incoming on PRV, then transition PGM route to PRV.
		if (bus1 != null && bus2 == null) {
			if (typeof ctx.log === 'function') {
				ctx.log('info', `[scene-take] pgm/prv path ch=${channel} prv=${bus1}`)
			}
			// Re-taking the same look should be a no-op to avoid route flicker and extra AMCP churn.
			if (!b.forceCut && sameSceneId(currentScene, inc)) {
				if (typeof ctx.log === 'function') {
					ctx.log('info', `[scene-take] no-op: scene ${String(inc?.id || 'n/a')} already on pgm ch=${channel}`)
				}
				liveSceneState.broadcastSceneLive(ctx)
				return
			}
			// Native layer transitions are superior because they don't require detaching a route,
			// preventing playback time jumps and double-decoding on the PGM channel.
			const previousPgmScene = currentScene
			const prvStored = liveSceneState.getChannel(bus1)
			const prvCurrentScene = prvStored?.scene || null

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
			
			// Bus exchange behavior: previous PGM look becomes PRV look after take.
			if (
				previousPgmScene &&
				typeof previousPgmScene === 'object' &&
				Array.isArray(previousPgmScene.layers) &&
				previousPgmScene.layers.some(layerHasContent)
			) {
				try {
					await runSceneTakeLbg(ctx.amcp, {
						...takeOpts,
						channel: bus1,
						currentScene: prvCurrentScene,
						incomingScene: previousPgmScene,
						forceCut: true,
						self: ctx,
					})
					const prevId = String(previousPgmScene.id || `preview_${Date.now()}`)
					liveSceneState.setChannel(bus1, { sceneId: prevId, scene: stripEphemeralTakeFields(previousPgmScene) })
				} catch (e) {
					if (typeof ctx.log === 'function') ctx.log('warn', `[scene-take] pgm->prv exchange failed: ${e?.message || e}`)
				}
			}
			liveSceneState.broadcastSceneLive(ctx)
			return
		}
		if (typeof ctx.log === 'function') {
			ctx.log('info', `[scene-take] direct-program path ch=${channel} (2-channel pgm/prv mode)`)
		}
		await runSceneTakeLbg(ctx.amcp, { ...takeOpts, self: ctx })
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

async function handlePost(path, body, ctx) {
	if (path !== '/api/scene/take') return null
	if (!ctx.amcp) return null
	return handleSceneTake(body, ctx)
}

module.exports = { handlePost, handleSceneTake }
