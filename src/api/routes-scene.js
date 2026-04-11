/**
 * POST /api/scene/take — program look transition (AMCP + banks).
 * @see companion-module-casparcg-server/src/api-routes.js handleSceneTake
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const playbackTracker = require('../state/playback-tracker')
const liveSceneState = require('../state/live-scene-state')
const { runTimelineOnlyTake, isTimelineOnlyScene, layerHasContent } = require('../engine/scene-transition')
const { runSceneTakeLbg } = require('../engine/scene-take-lbg')

const TAKE_TIMEOUT_MS = 120000

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
	const takeOpts = {
		channel,
		currentScene,
		incomingScene: inc,
		framerate: b.framerate,
		forceCut: !!b.forceCut,
	}
	const runTake = async () => {
		if (isTimelineOnlyScene(inc)) {
			await runTimelineOnlyTake(ctx, takeOpts)
		} else {
			await runSceneTakeLbg(ctx.amcp, { ...takeOpts, self: ctx })
		}
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
