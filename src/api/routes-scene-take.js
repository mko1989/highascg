/**
 * POST /api/scene/take — program look transition (AMCP + banks).
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const playbackTracker = require('../state/playback-tracker')
const liveSceneState = require('../state/live-scene-state')
const { layerHasContent } = require('../engine/scene-transition')
const { LOOK_LAYER_MIN, LOOK_LAYER_MAX } = require('../engine/look-layer-ranges')
const { runSceneTakeLbg } = require('../engine/scene-take-lbg')
const { clearSceneProgramLookStackLayers } = require('../engine/scene-exit-layers')
const { resolveSceneById } = require('../engine/project-scenes')
const { shouldFollowerSkipLocalPgmAmcp } = require('../replication/amcp-fanout')
const {
	stripEphemeralTakeFields,
	resolvePreviewChannel,
	isPreviewTakeTarget,
	getRouteMap,
} = require('./routes-scene-shared')

const TAKE_TIMEOUT_MS = 120000

/** Stamp + WS broadcast at PGM take start so hot backup mirrors leader transitions in sync. */
function announceProgramTakeToReplication(ctx, mainIdx, inc, forceCut) {
	if (mainIdx < 0 || !inc?.id) return Date.now()
	const rt = ctx._replication
	if (!rt || rt.roleState?.getRole() !== 'leader') return Date.now()
	const takeUpdatedAt = Date.now()
	const { announceLeaderProgramTake } = require('../replication/live-state-feed')
	announceLeaderProgramTake(rt, ctx, {
		screenIdx: mainIdx + 1,
		sceneId: String(inc.id),
		forceCut: !!forceCut,
		takeUpdatedAt,
	})
	return takeUpdatedAt
}

function liveEntryFromTake(inc, takeUpdatedAt) {
	return {
		sceneId: String(inc.id),
		scene: stripEphemeralTakeFields(inc),
		updatedAt: takeUpdatedAt,
	}
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
	// WO-160 T160.3: logical look layers live in 10–99 (bank A physical = logical, bank B = +100).
	// A stale client (old unbounded +10 numbering) must never write into the audio (1–9/101–109),
	// bank B (110–199), timeline (210+) or PIP overlay (260+) bands.
	const outOfRangeLayer = b.incomingScene.layers.find((l) => {
		if (!layerHasContent(l)) return false
		const n = Number(l.layerNumber)
		return !Number.isInteger(n) || n < LOOK_LAYER_MIN || n > LOOK_LAYER_MAX
	})
	if (outOfRangeLayer) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({
				error: `incomingScene layer number ${outOfRangeLayer.layerNumber} is outside the look layer range ${LOOK_LAYER_MIN}-${LOOK_LAYER_MAX} — reload the operator UI so the project migrates to consecutive layer numbering (WO-160)`,
			}),
		}
	}

	const useClientCurrentScene = b.useServerLive === false && Object.prototype.hasOwnProperty.call(b, 'currentScene')
	const requestedCurrentScene = useClientCurrentScene ? b.currentScene : null

	const inc = b.incomingScene
	const routeMap = getRouteMap(ctx)
	const takeOpts = {
		channel,
		currentScene: null,
		incomingScene: inc,
		framerate: b.framerate,
		forceCut: !!b.forceCut,
		mainScreenIndex: -1,
	}
	const runTake = async () => {
		const currentScene = useClientCurrentScene
			? requestedCurrentScene
			: (liveSceneState.getChannel(channel)?.scene || null)
		// WO-156: multi-hop route cycles (this look routes ch X while X routes back here) are
		// allowed but logged — direct self-routes are rejected in runSceneTakeLbg.
		if (typeof ctx.log === 'function') {
			const { findCrossChannelRouteCycles } = require('../engine/scene-route-deps')
			const cycles = findCrossChannelRouteCycles(inc, channel, (ch) => liveSceneState.getChannel(ch)?.scene || null)
			for (const via of cycles) {
				ctx.log(
					'warn',
					`[scene-take] cross-channel route cycle: ch${channel} routes ch${via} while ch${via} routes ch${channel} (allowed — watch for feedback/starvation)`,
				)
			}
		}
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
			/* WO-199: PRV is bank-less — force bank 'a' so preview uses logical layer targets */
			if (!ctx.programLayerBankByChannel) ctx.programLayerBankByChannel = {}
			ctx.programLayerBankByChannel[String(bus1)] = 'a'
			await runSceneTakeLbg(ctx.amcp, {
				...takeOpts,
				channel: bus1,
				currentScene: prvCurrent,
				incomingScene: inc,
				/* FIX-3 (2026-07-15 review, WO-209 finding 2): PRV staging is always a cut (no
				 * previous PRV content needs a crossfade), and WO-209's banklessTake requires
				 * forceCut:true — match the other two preview call sites below instead of
				 * trusting the caller-supplied flag. */
				forceCut: true,
				self: ctx,
				skipLayerVisualEquality: true,
				banklessTake: true,
			})
			if (inc && typeof inc === 'object' && inc.id) {
				liveSceneState.setChannel(bus1, { sceneId: String(inc.id), scene: stripEphemeralTakeFields(inc) })
			}
			liveSceneState.broadcastSceneLive(ctx)
			return
		}

		if (shouldFollowerSkipLocalPgmAmcp(ctx, channel, { previewOnly: false })) {
			if (typeof ctx.log === 'function') {
				ctx.log(
					'info',
					`[scene-take] follower amcp-fanout: skip local PGM AMCP ch=${channel} (leader fan-out drives air)`,
				)
			}
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
		if (mainIdx < 0 && typeof ctx.log === 'function') {
			ctx.log(
				'warn',
				`[scene-take] channel ${channel} not in routing programChannels — using direct-program path (no pgm/prv exchange)`,
			)
		}
		if (bus1 != null && bus2 == null && !sharedPreviewBus) {
			if (typeof ctx.log === 'function') {
				ctx.log('info', `[scene-take] pgm/prv path ch=${channel} prv=${bus1}`)
			}
			const previousPgmScene = currentScene
			const stageOnPreview = b.stageOnPreview !== false
			/* WO-272: edit-on-PGM content pushes re-take the SAME look that is already on air —
			 * flipping the "previous" (older edit of the same look) onto PRV would clobber whatever
			 * the operator has staged there. `previewExchange: false` skips the pgm→prv flip-flop;
			 * default (absent) keeps the normal take behavior unchanged. */
			const previewExchange = b.previewExchange !== false
			if (stageOnPreview) {
				const prvCurrent = liveSceneState.getChannel(bus1)?.scene || null
				/* WO-199: PRV is bank-less — force bank 'a' so preview uses logical layer targets */
				if (!ctx.programLayerBankByChannel) ctx.programLayerBankByChannel = {}
				ctx.programLayerBankByChannel[String(bus1)] = 'a'
				await runSceneTakeLbg(ctx.amcp, {
					...takeOpts,
					channel: bus1,
					currentScene: prvCurrent,
					incomingScene: inc,
					forceCut: true,
					self: ctx,
					skipLayerVisualEquality: true,
					banklessTake: true,
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
					// No previous PGM look to flip onto PRV (first take / state cleared by the
					// Caspar reconcile). Without this, the STAGED incoming look stays on PRV —
					// i.e. PRV shows the exact look that is now on air (WO-150 B150.1). Classic
					// flip-flop with an empty "previous" means an EMPTY preview.
					if (!stageOnPreview) return null
					previewExchangeStarted = true
					previewExchangePromise = (async () => {
						try {
							await clearSceneProgramLookStackLayers(ctx.amcp, bus1, ctx)
							liveSceneState.clearChannel?.(bus1)
							if (typeof ctx.log === 'function') {
								ctx.log('info', `[scene-take] pgm->prv exchange: no previous look — cleared staged PRV ch=${bus1}`)
							}
						} catch (e) {
							if (typeof ctx.log === 'function') ctx.log('warn', `[scene-take] prv clear failed: ${e?.message || e}`)
						}
					})()
					return previewExchangePromise
				}
				previewExchangeStarted = true
				previewExchangePromise = (async () => {
					try {
						await clearSceneProgramLookStackLayers(ctx.amcp, bus1, ctx)
						/* WO-199: PRV is bank-less — force bank 'a' so preview uses logical layer targets */
						if (!ctx.programLayerBankByChannel) ctx.programLayerBankByChannel = {}
						ctx.programLayerBankByChannel[String(bus1)] = 'a'
						await runSceneTakeLbg(ctx.amcp, {
							...takeOpts,
							channel: bus1,
							currentScene: null,
							incomingScene: previousPgmScene,
							forceCut: true,
							self: ctx,
							skipLayerVisualEquality: true,
							banklessTake: true,
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

			const takeUpdatedAt = announceProgramTakeToReplication(ctx, mainIdx, inc, !!b.forceCut)
			const pgmTakePromise = runSceneTakeLbg(ctx.amcp, {
				...takeOpts,
				channel,
				currentScene: previousPgmScene,
				incomingScene: inc,
				forceCut: !!b.forceCut,
				self: ctx,
				skipLayerVisualEquality: true,
			})
			// Flip-flop the preview WHILE the program transition runs (different Caspar
			// channel, independent AMCP). Sequenced after the awaited PGM take, PRV kept
			// showing the staged incoming look for the entire fade + teardown — the
			// operator-visible "wrong look on preview after transition" (WO-150 B150.1).
			if (previewExchange) startPreviewExchange()
			await pgmTakePromise
			if (inc && typeof inc === 'object' && inc.id) {
				liveSceneState.setChannel(channel, liveEntryFromTake(inc, takeUpdatedAt))
			}

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
				`[scene-take] pgm-only channel — LBG bank pipeline with unconditional orphan sweep (WO-160b) ch=${channel}${sharedPreviewBus ? ' shared-preview-bus' : ''}`,
			)
		}
		const takeUpdatedAt = announceProgramTakeToReplication(ctx, mainIdx, inc, !!b.forceCut)
		await runSceneTakeLbg(ctx.amcp, { ...takeOpts, self: ctx, skipLayerVisualEquality: true, pgmOnly })
		if (inc && typeof inc === 'object' && inc.id) {
			liveSceneState.setChannel(channel, liveEntryFromTake(inc, takeUpdatedAt))
		}
		liveSceneState.broadcastSceneLive(ctx)
	}

	if (!ctx._sceneTakeChainByChannel) ctx._sceneTakeChainByChannel = {}
	const chKey = String(channel)
	const prev = ctx._sceneTakeChainByChannel[chKey] || Promise.resolve()
	const takePromise = prev.then(() => runTake())
	ctx._sceneTakeChainByChannel[chKey] = takePromise.catch(() => {})

	let takeTimeoutTimer = null
	try {
		await Promise.race([
			takePromise,
			new Promise((_, reject) => {
				takeTimeoutTimer = setTimeout(() => reject(new Error('Scene take timed out')), TAKE_TIMEOUT_MS)
			}),
		])
	} catch (e) {
		const log = ctx.log
		if (typeof log === 'function') log('error', 'Scene take failed: ' + (e?.message || e))
		const msg = e?.message || String(e)
		const timedOut = /timed out/i.test(msg)
		// WO-156: validation failures (e.g. self-route guard) carry statusCode 400 — surface as
		// client errors so the UI toasts the message instead of a generic server error.
		const clientErrorStatus =
			Number.isInteger(e?.statusCode) && e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : null
		return {
			status: timedOut ? 504 : (clientErrorStatus ?? 500),
			headers: JSON_HEADERS,
			body: jsonBody({ error: msg || 'Scene take failed' }),
		}
	} finally {
		// Do not leak a 2-minute timer per take (kept the event loop alive; WO-156 cleanup).
		if (takeTimeoutTimer) clearTimeout(takeTimeoutTimer)
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

module.exports = {
	handleSceneTake,
}
