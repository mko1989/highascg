/**
 * Core AMCP batch builder for pushing a scene onto PRV look-stack preview channel(s).
 */

import { api } from './api-client.js'
import { postAmcpPreviewPipeline } from './amcp-preview-batch.js'
import { audioRouteToAudioFilter } from './audio-routes.js'
import { resolveProgramLayoutForProgramChannel } from './program-audio-layouts.js'
import { settingsState } from './settings-state.js'
import { resolveLayerFillForAmcp } from './mixer-fill.js'
import { cropAdjustedFillForLayer } from './layer-crop.js'
import { shouldApplyStraightAlphaKeyer } from './media-ext.js'
import { buildPipOverlayAmcpLinesAll, buildPipOverlayRemoveLines, buildPipOverlayRemoveStaleSlots } from './pip-overlay-amcp.js'
import { getPipOverlaysFromLayer, resolvePipOverlayCasparLayer, PIP_OVERLAY_MAX_STACK } from './pip-overlay-registry.js'
import { effectToAmcpLines } from './effect-registry.js'
import { amcpParam, chLayerAmcp } from '../components/scenes-shared.js'
import {
	PREVIEW_SCENE_LAYER_MIN,
	TIMELINE_LAYER_BASE,
	TIMELINE_LAYER_CLEAR_COUNT,
	getOccupiedPreviewLookLayersFromState,
	resolvePreviewAmcpChannel,
	isPreviewBusAvailable,
} from './scenes-preview-look-stack.js'
import { linearGainToCasparDb } from './audio-volume-scale.js'
import { buildPreviewContentSnapshot, isGeometryOnlyPreview, layerContentMetaForSnapshot, previewContentCompareKey } from './scenes-preview-snapshot.js'
import { sceneLayerRotationMixerLines, fillForSceneLayerRotationAnchor } from './scene-layer-rotation-amcp.js'
import { syncPreviewLiveToServer } from './scene-live-sync.js'
import {
	lookLogicalLayerNumbers,
	orderPreviewLayerBlocks,
	parseRouteClipValue,
	remapIntraLookRouteForChannel,
} from './scene-route-preview-remap.js'

/**
 * GET /api/media is expensive server-side (recursive media-dir scan + bounded ffprobe batch).
 * The old code fired it EAGERLY on every preview push — during a compose drag that meant one
 * catalog rebuild per push and dominated the perceived edit→PRV latency. Cache it across
 * pushes; it is only awaited at all when a layer's content resolution is not already in state.
 */
const MEDIA_LIST_CACHE_TTL_MS = 10000
let mediaListCacheAt = 0
/** @type {Promise<object[]> | null} */
let mediaListCachePromise = null

function getMediaListCached() {
	const now = Date.now()
	if (!mediaListCachePromise || now - mediaListCacheAt >= MEDIA_LIST_CACHE_TTL_MS) {
		mediaListCacheAt = now
		mediaListCachePromise = api.get('/api/media').catch(() => [])
	}
	return mediaListCachePromise
}

/**
 * @param {object} opts
 * @param {string} opts.sceneId
 * @param {number[]|undefined} opts.restrictMains
 * @param {boolean} [opts.forcePrvBus]
 * @param {object} opts.sceneState
 * @param {object} opts.stateStore
 * @param {() => object} opts.getChannelMap
 * @param {() => { w: number, h: number, fps?: number }} opts.getPreviewOutputResolution
 * @param {{ sceneId: string, contentByLayer: Map<number, object> } | null} opts.lastPreviewContentSnapshot
 * @param {number | null} opts.lastPreviewChannel
 * @param {Set<number> | null} opts.lastPreviewLayers
 * @param {object} opts.border
 * @param {(mIdx: number, forcePrvBus: boolean, borderEnabled: boolean) => { channel: number, layer: number }[]} opts.border.slotsForPreviewPush
 * @param {(gb: object, borderEnabled: boolean) => object} opts.border.payloadForBorderLines
 * @param {(slot: object, sceneId: string, borderEnabled: boolean, globalBorder: object) => boolean} opts.border.usesCgUpdate
 * @param {(slots: object[], sceneId: string, borderEnabled: boolean, globalBorder: object) => void} opts.border.recordPushMeta
 * @returns {Promise<{ lastPreviewLayers: Set<number>, lastPreviewContentSnapshot: object, lastPreviewChannel: number } | null>}
 */
export async function pushSceneToPreviewImpl(opts) {
	const {
		sceneId,
		restrictMains,
		forcePrvBus = false,
		sceneState,
		stateStore,
		getChannelMap,
		getPreviewOutputResolution,
		lastPreviewContentSnapshot,
		lastPreviewChannel,
		lastPreviewLayers,
		border,
	} = opts

	if (!sceneId) return null
	const scene = sceneState.getScene(sceneId)
	if (!scene) return null

	const cm = getChannelMap()
	let targetIdxs = (() => {
		const scope = String(scene.mainScope || 'all')
		if (scope === 'all') return Array.from({ length: cm.screenCount || 1 }, (_, i) => i)
		const n = parseInt(scope, 10)
		if (Number.isFinite(n) && n >= 0 && n < (cm.screenCount || 1)) return [n]
		return sceneState.armedScreenIndices?.length ? sceneState.armedScreenIndices : [sceneState.activeScreenIndex]
	})()
	if (Array.isArray(restrictMains) && restrictMains.length > 0) {
		const allow = new Set(restrictMains.map((x) => Number(x)).filter((n) => Number.isFinite(n)))
		const narrowed = targetIdxs.filter((i) => allow.has(i))
		targetIdxs =
			narrowed.length > 0
				? narrowed
				: [...allow].filter((i) => Number.isFinite(i) && i >= 0 && i < (cm.screenCount || 1))
	}
	if (targetIdxs.length === 0) return null

	const pendingPreviewMainIds = []
	const borderMetaAccumulator = []
	try {
		const commandsByChannel = new Map()
		const sideBorderPipelines = []
		/* Lazy + TTL-cached — never refetch the media catalog per drag-frame push. */
		const getMediaListOnce = () => getMediaListCached()

		let lastComputedFills = new Map()
		let lastPreviewCh = null
		const pipCgReadyKeys = new Set(
			lastPreviewContentSnapshot?.pipCgKeys instanceof Set
				? lastPreviewContentSnapshot.pipCgKeys
				: Array.isArray(lastPreviewContentSnapshot?.pipCgKeys)
					? lastPreviewContentSnapshot.pipCgKeys
					: [],
		)

		for (const mIdx of targetIdxs) {
			const prvRes =
				cm.previewResolutions?.[mIdx] ||
				cm.programResolutions?.[mIdx] ||
				getPreviewOutputResolution()
			const previewCanvas = { width: prvRes.w, height: prvRes.h, framerate: prvRes.fps ?? 50 }
			const authoringCanvas = sceneState.getCanvasForScreen(mIdx)
			const previewCh = resolvePreviewAmcpChannel(sceneState, getChannelMap, mIdx, forcePrvBus)
			lastPreviewCh = previewCh
			if (!previewCh || previewCh <= 0) {
				continue
			}

			const queue = []
			const sameSceneOnSamePrv =
				lastPreviewContentSnapshot &&
				lastPreviewContentSnapshot.sceneId === sceneId &&
				Number(lastPreviewChannel) === Number(previewCh)
			const geometryOnly = isGeometryOnlyPreview(lastPreviewContentSnapshot, scene) && sameSceneOnSamePrv
			const incrementalPreviewEdit = sameSceneOnSamePrv
			if (!incrementalPreviewEdit) {
				for (const k of [...pipCgReadyKeys]) {
					if (String(k).startsWith(`${previewCh}-`)) pipCgReadyKeys.delete(k)
				}
			}
			const layerNumsPip = (scene.layers || []).map((l) => Number(l.layerNumber)).filter((n) => n > 0)
			const nextPipLayerInPreview = (L) => {
				const a = layerNumsPip.filter((n) => n > L)
				return a.length ? Math.min(...a) : 10000
			}

			const newLookLayers = new Set()
			for (const l of scene.layers || []) {
				const ln = Number(l.layerNumber)
				if (ln >= PREVIEW_SCENE_LAYER_MIN) {
					newLookLayers.add(ln)
					const nextP = nextPipLayerInPreview(ln)
					const pips = getPipOverlaysFromLayer(l)
					for (let i = 0; i < pips.length; i++) {
						const oR = resolvePipOverlayCasparLayer(ln, i, nextP)
						if (Number.isFinite(oR)) newLookLayers.add(oR)
					}
				}
			}

			const layersToReset = new Set()
			if (!incrementalPreviewEdit) {
				const occupiedNow = getOccupiedPreviewLookLayersFromState(stateStore, previewCh)
				if (occupiedNow.size > 0) {
					for (const n of occupiedNow) {
						if (!newLookLayers.has(n)) layersToReset.add(n)
					}
				} else if (lastPreviewLayers && lastPreviewLayers.size > 0) {
					for (const n of lastPreviewLayers) {
						if (Number.isFinite(n) && n >= PREVIEW_SCENE_LAYER_MIN && !newLookLayers.has(n)) {
							layersToReset.add(n)
						}
					}
				}
				for (let ti = 0; ti < TIMELINE_LAYER_CLEAR_COUNT; ti++) {
					const ln = TIMELINE_LAYER_BASE + ti
					if (!newLookLayers.has(ln)) layersToReset.add(ln)
				}
			}

			if (!geometryOnly) {
				for (const ln of [...layersToReset].sort((a, b) => a - b)) {
					const dl = chLayerAmcp(previewCh, ln)
					queue.push(`STOP ${dl}`, `MIXER ${dl} CLEAR`, ...buildPipOverlayRemoveLines(previewCh, ln, 10000))
					const nextP = nextPipLayerInPreview(ln)
					for (let pi = 0; pi < PIP_OVERLAY_MAX_STACK; pi++) {
						const oR = resolvePipOverlayCasparLayer(ln, pi, nextP)
						if (Number.isFinite(oR)) pipCgReadyKeys.delete(`${previewCh}-${oR}`)
					}
				}
			}

			const computedFills = new Map()
			const sortedLayers = [...(scene.layers || [])].sort((a, b) => (a.layerNumber || 0) - (b.layerNumber || 0))

			/* todos19.07.26: a look-local route is authored against the PGM bus (`route://<pgmCh>-<L>`)
			 * and every SERVER take path rewrites it to the channel being taken. This client-built
			 * preview push does not go through that pipeline, so it must do the same remap itself —
			 * otherwise the PRV route producer taps the program bus and the route shows the program
			 * feed (or nothing, since PGM keeps look content on bank-mapped physical layers). */
			const lookLogicalLayers = lookLogicalLayerNumbers(scene.layers)
			/** @type {{ layerNumber: number, routeTargetLayer: number|null, lines: string[] }[]} */
			const layerBlocks = []

			for (const layer of sortedLayers) {
				const ln = layer.layerNumber
				const cl = chLayerAmcp(previewCh, ln)
				if (!layer.source?.value) continue
				/** AMCP for THIS layer, ordered against its route dependency before it joins `queue`. */
				const layerLines = []

				const f = await resolveLayerFillForAmcp(layer, stateStore, mIdx, previewCanvas, getMediaListOnce, authoringCanvas)
				computedFills.set(Number(ln), f)

				const clipRaw = layer.source.value
				/* Intra-look layer route → this PRV channel (bank-less, so physical == logical).
				 * Non-route values, whole-channel routes and routes pointing outside this look are
				 * returned unchanged — see client/lib/scene-route-preview-remap.js. */
				const clipRouted = remapIntraLookRouteForChannel(clipRaw, previewCh, lookLogicalLayers)
				const routeParsed = parseRouteClipValue(clipRaw)
				const routeTargetLayer =
					routeParsed?.layer != null && lookLogicalLayers.has(routeParsed.layer) ? routeParsed.layer : null
				const browserCg =
					layer.source.type === 'browser' &&
					layer.source.browserAsCg === true &&
					/^https?:\/\//i.test(String(clipRaw || '').trim())
				const browserCgUrl = browserCg ? String(clipRaw).trim() : null
				const clip = browserCgUrl ? '[HTML] black' : clipRouted
				const wantLoop = !!layer.loop
				let playCmd = `PLAY ${cl}`
				if (clip) playCmd += ' ' + amcpParam(clip)
				if (!String(clip || '').startsWith('route://') && wantLoop) playCmd += ' LOOP'
				const masterLayout = resolveProgramLayoutForProgramChannel(settingsState.getSettings(), stateStore.getState()?.channelMap, previewCh)
				const af = audioRouteToAudioFilter(layer.audioRoute || '1+2', masterLayout)
				if (af) playCmd += ` AF "${String(af).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

				const volGain = layer.muted ? 0 : layer.volume != null ? layer.volume : 1
				const vol = linearGainToCasparDb(volGain)
				const curKeyer = shouldApplyStraightAlphaKeyer(!!layer.straightAlpha, layer.source?.value) ? 1 : 0

				const prevMeta = lastPreviewContentSnapshot?.contentByLayer?.get(Number(ln))

				const mixerPart = []
				const prevFill = prevMeta?.fill
				const prevRot = prevMeta?.rotation
				const prevOp = prevMeta?.opacity
				const prevKeyer = prevMeta?.keyer
				const prevVol = prevMeta?.volume

				const rot = layer.rotation ?? 0
				const casparFill = fillForSceneLayerRotationAnchor(f, rot)
				const prevCasparFill =
					prevFill != null ? fillForSceneLayerRotationAnchor(prevFill, prevRot ?? 0) : null

				if (
					!prevCasparFill ||
					prevCasparFill.x !== casparFill.x ||
					prevCasparFill.y !== casparFill.y ||
					prevCasparFill.scaleX !== casparFill.scaleX ||
					prevCasparFill.scaleY !== casparFill.scaleY
				) {
					mixerPart.push(`MIXER ${cl} FILL ${casparFill.x} ${casparFill.y} ${casparFill.scaleX} ${casparFill.scaleY} 1 DEFER`)
				}
				if (prevRot === undefined || prevRot !== rot) {
					mixerPart.push(...sceneLayerRotationMixerLines(cl, rot, { deferRotation: true }))
				}
				if (prevOp === undefined || prevOp !== (layer.opacity ?? 1)) {
					mixerPart.push(`MIXER ${cl} OPACITY ${layer.opacity ?? 1} 0 DEFER`)
				}
				if (prevKeyer === undefined || prevKeyer !== curKeyer) {
					mixerPart.push(`MIXER ${cl} KEYER ${curKeyer}`)
				}
				if (prevVol === undefined || prevVol !== volGain) {
					mixerPart.push(`MIXER ${cl} VOLUME ${vol} DEFER`)
				}

				const curMeta = layerContentMetaForSnapshot(layer)
				const prevContent = prevMeta ? previewContentCompareKey(prevMeta) : null
				const contentUnchanged =
					prevContent && curMeta && JSON.stringify(prevContent) === JSON.stringify(previewContentCompareKey(curMeta))

				if (geometryOnly || contentUnchanged) {
					layerLines.push(...mixerPart)
				} else {
					const cgTail = []
					if (browserCgUrl) {
						const json = JSON.stringify({ url: browserCgUrl })
						cgTail.push(
							`CG ${cl} CLEAR`,
							`CG ${cl} ADD 0 highascg_browser_url 1 ${amcpParam(json)}`,
							`CG ${cl} PLAY 0`,
							`CG ${cl} UPDATE 0 ${amcpParam(json)}`,
						)
					}
					layerLines.push(
						playCmd,
						...sceneLayerRotationMixerLines(cl, rot, { deferRotation: true }),
						`MIXER ${cl} FILL ${casparFill.x} ${casparFill.y} ${casparFill.scaleX} ${casparFill.scaleY} 1 DEFER`,
						`MIXER ${cl} OPACITY ${layer.opacity ?? 1} 0 DEFER`,
						`MIXER ${cl} KEYER ${curKeyer}`,
						`MIXER ${cl} VOLUME ${vol} DEFER`,
						...cgTail,
					)
				}
				lastComputedFills = computedFills

				const effects = layer.effects || []
				for (const fx of effects) {
					const lines = effectToAmcpLines(fx.type, fx.params, cl)
					if (lines) layerLines.push(...lines)
				}

				const nextP = nextPipLayerInPreview(ln)
				const pipOverlays = getPipOverlaysFromLayer(layer)
				const prevPip = prevMeta?.pipOverlays
				if (geometryOnly || contentUnchanged) {
					if (pipOverlays.length > 0) {
						layerLines.push(
							...buildPipOverlayAmcpLinesAll(
								pipOverlays,
								previewCh,
								ln,
								/* WO-158 T158.5 (part B): border/overlay geometry hugs the visible (cropped) content —
								 * the video layer's own MIXER FILL (`f`, used above) stays uncropped. */
								cropAdjustedFillForLayer(f, layer),
								{ w: prvRes.w, h: prvRes.h },
								nextP,
								prevPip,
								pipCgReadyKeys,
								layer.rotation ?? 0,
							),
						)
					} else if ((prevPip?.length ?? 0) > 0) {
						layerLines.push(...buildPipOverlayRemoveStaleSlots(previewCh, ln, nextP, prevPip, [], pipCgReadyKeys))
					}
				} else {
					layerLines.push(...buildPipOverlayRemoveStaleSlots(previewCh, ln, nextP, prevPip, pipOverlays, pipCgReadyKeys))
					if (pipOverlays.length > 0) {
						layerLines.push(
							...buildPipOverlayAmcpLinesAll(
								pipOverlays,
								previewCh,
								ln,
								/* WO-158 T158.5 (part B): border/overlay geometry hugs the visible (cropped) content —
								 * the video layer's own MIXER FILL (`f`, used above) stays uncropped. */
								cropAdjustedFillForLayer(f, layer),
								{ w: prvRes.w, h: prvRes.h },
								nextP,
								prevPip,
								pipCgReadyKeys,
								layer.rotation ?? 0,
							),
						)
					}
				}

				layerBlocks.push({ layerNumber: Number(ln), routeTargetLayer, lines: layerLines })
			}

			/* An intra-look route producer must be created AFTER its source layer is playing. The ↗
			 * button takes the lowest free layer number, so a route can easily sort BELOW the layer it
			 * reads — mirrors partitionTakeJobsPlayOrder()/orderRouteJobsByDependency() on the server. */
			for (const block of orderPreviewLayerBlocks(layerBlocks)) queue.push(...block.lines)

			const globalBorder = sceneState.getGlobalBorderForScreen(mIdx)
			const borderEnabled = !!(globalBorder && globalBorder.enabled)
			const borderSlots = border.slotsForPreviewPush(mIdx, forcePrvBus, borderEnabled)
			const borderApiPayload = border.payloadForBorderLines(globalBorder, borderEnabled)
			const forceFadeIn = !!(borderEnabled && sceneState.borderJustEnabled?.[mIdx])
			if (borderSlots.length > 0) {
				try {
					for (const slot of borderSlots) {
						const isUpdate = !forceFadeIn && border.usesCgUpdate(slot, sceneId, borderEnabled, globalBorder)
						const borderRes = await api.post('/api/scene/border-lines', {
							channel: slot.channel,
							layer: slot.layer,
							border: borderApiPayload,
							isUpdate,
						})
						const raw = borderRes?.lines
						if (!Array.isArray(raw) || raw.length === 0) continue
						if (Number(slot.channel) === Number(previewCh)) {
							queue.push(...raw)
						} else {
							const needsMixerCommit = raw.some((l) => /\bDEFER\b/i.test(String(l)))
							sideBorderPipelines.push(needsMixerCommit ? [...raw, `MIXER ${slot.channel} COMMIT`] : raw)
						}
					}
					borderMetaAccumulator.push({ slots: borderSlots, borderEnabled, globalBorder })
				} catch (e) {
					console.warn('Failed to apply border lines:', e)
				}
				if (sceneState.borderJustEnabled && typeof sceneState.borderJustEnabled === 'object') {
					sceneState.borderJustEnabled[mIdx] = false
				}
			}

			queue.push(`MIXER ${previewCh} COMMIT`)
			commandsByChannel.set(previewCh, queue)
			pendingPreviewMainIds.push(mIdx)
		}

		const allCommands = [...commandsByChannel.values()].flat()
		if (allCommands.length > 0) {
			await postAmcpPreviewPipeline(allCommands)
		}
		for (const pipe of sideBorderPipelines) {
			if (pipe?.length) await postAmcpPreviewPipeline(pipe)
		}

		for (const ent of borderMetaAccumulator) {
			border.recordPushMeta(ent.slots, sceneId, ent.borderEnabled, ent.globalBorder)
		}

		for (const mIdx of pendingPreviewMainIds) {
			sceneState.setPreviewSceneId(sceneId, mIdx)
		}

		const nextLastPreviewLayers = new Set(
			(scene.layers || []).filter((l) => l.source?.value).map((l) => Number(l.layerNumber)),
		)
		const nextLastPreviewContentSnapshot = buildPreviewContentSnapshot(sceneId, scene, lastComputedFills)
		nextLastPreviewContentSnapshot.pipCgKeys = new Set(pipCgReadyKeys)
		const nextLastPreviewChannel = Number(lastPreviewCh)

		for (const mIdx of pendingPreviewMainIds) {
			// Skip preview live sync for PGM-only mains (no separate preview bus)
			if (isPreviewBusAvailable(cm, mIdx)) {
				try {
					await syncPreviewLiveToServer(sceneId, mIdx, { sceneState, stateStore })
				} catch (e) {
					console.warn('Preview live sync failed:', e?.message || e)
				}
			}
		}

		return {
			lastPreviewLayers: nextLastPreviewLayers,
			lastPreviewContentSnapshot: nextLastPreviewContentSnapshot,
			lastPreviewChannel: nextLastPreviewChannel,
		}
	} catch (e) {
		console.warn('Scene preview push failed:', e?.message || e)
		return null
	}
}
