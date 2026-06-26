/**
 * Core AMCP batch builder for pushing a scene onto PRV look-stack preview channel(s).
 */

import { api } from './api-client.js'
import { postAmcpPreviewPipeline } from './amcp-preview-batch.js'
import { audioRouteToAudioFilter } from './audio-routes.js'
import { resolveProgramLayoutForProgramChannel } from './program-audio-layouts.js'
import { settingsState } from './settings-state.js'
import { resolveLayerFillForAmcp } from './mixer-fill.js'
import { shouldApplyStraightAlphaKeyer } from './media-ext.js'
import { buildPipOverlayAmcpLinesAll, buildPipOverlayRemoveLines, buildPipOverlayRemoveStaleSlots } from './pip-overlay-amcp.js'
import { getPipOverlaysFromLayer, resolvePipOverlayCasparLayer } from './pip-overlay-registry.js'
import { effectToAmcpLines } from './effect-registry.js'
import { amcpParam, chLayerAmcp } from '../components/scenes-shared.js'
import {
	PREVIEW_SCENE_LAYER_MIN,
	TIMELINE_LAYER_BASE,
	TIMELINE_LAYER_CLEAR_COUNT,
	getOccupiedPreviewLookLayersFromState,
	resolvePreviewAmcpChannel,
} from './scenes-preview-look-stack.js'
import { linearGainToCasparDb } from './audio-volume-scale.js'
import { buildPreviewContentSnapshot, isGeometryOnlyPreview, layerContentMetaForSnapshot } from './scenes-preview-snapshot.js'

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
		const mediaListPromise = api.get('/api/media').catch(() => [])
		async function getMediaListOnce() {
			return mediaListPromise
		}

		let lastComputedFills = new Map()
		let lastPreviewCh = null

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
				}
			}

			const computedFills = new Map()
			const sortedLayers = [...(scene.layers || [])].sort((a, b) => (a.layerNumber || 0) - (b.layerNumber || 0))

			for (const layer of sortedLayers) {
				const ln = layer.layerNumber
				const cl = chLayerAmcp(previewCh, ln)
				if (!layer.source?.value) continue

				const f = await resolveLayerFillForAmcp(layer, stateStore, mIdx, previewCanvas, getMediaListOnce, authoringCanvas)
				computedFills.set(Number(ln), f)

				const clipRaw = layer.source.value
				const browserCg =
					layer.source.type === 'browser' &&
					layer.source.browserAsCg === true &&
					/^https?:\/\//i.test(String(clipRaw || '').trim())
				const browserCgUrl = browserCg ? String(clipRaw).trim() : null
				const clip = browserCgUrl ? '[HTML] black' : clipRaw
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

				if (!prevFill || prevFill.x !== f.x || prevFill.y !== f.y || prevFill.scaleX !== f.scaleX || prevFill.scaleY !== f.scaleY) {
					mixerPart.push(`MIXER ${cl} FILL ${f.x} ${f.y} ${f.scaleX} ${f.scaleY} 1 DEFER`)
				}
				if (prevRot === undefined || prevRot !== (layer.rotation ?? 0)) {
					mixerPart.push(`MIXER ${cl} ROTATION ${layer.rotation ?? 0} 0 DEFER`)
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
				const prevContent = prevMeta
					? {
							value: prevMeta.value,
							loop: prevMeta.loop,
							straightAlpha: prevMeta.straightAlpha,
							contentFit: prevMeta.contentFit,
							audioRoute: prevMeta.audioRoute,
							volume: prevMeta.volume,
							muted: prevMeta.muted,
							pipOverlays: prevMeta.pipOverlays,
						}
					: null
				const contentUnchanged = prevContent && curMeta && JSON.stringify(prevContent) === JSON.stringify(curMeta)

				if (geometryOnly || contentUnchanged) {
					queue.push(...mixerPart)
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
					queue.push(
						playCmd,
						`MIXER ${cl} ANCHOR 0 0 DEFER`,
						`MIXER ${cl} FILL ${f.x} ${f.y} ${f.scaleX} ${f.scaleY} 1 DEFER`,
						`MIXER ${cl} ROTATION ${layer.rotation ?? 0} 0 DEFER`,
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
					if (lines) queue.push(...lines)
				}

				const nextP = nextPipLayerInPreview(ln)
				const pipOverlays = getPipOverlaysFromLayer(layer)
				const prevPip = prevMeta?.pipOverlays
				if (geometryOnly || contentUnchanged) {
					if (pipOverlays.length > 0) {
						queue.push(
							...buildPipOverlayAmcpLinesAll(
								pipOverlays,
								previewCh,
								ln,
								f,
								{ w: prvRes.w, h: prvRes.h },
								nextP,
								prevPip,
							),
						)
					} else if ((prevPip?.length ?? 0) > 0) {
						queue.push(...buildPipOverlayRemoveStaleSlots(previewCh, ln, nextP, prevPip, []))
					}
				} else {
					queue.push(...buildPipOverlayRemoveStaleSlots(previewCh, ln, nextP, prevPip, pipOverlays))
					if (pipOverlays.length > 0) {
						queue.push(
							...buildPipOverlayAmcpLinesAll(
								pipOverlays,
								previewCh,
								ln,
								f,
								{ w: prvRes.w, h: prvRes.h },
								nextP,
								prevPip,
							),
						)
					}
				}
			}

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
		const nextLastPreviewChannel = Number(lastPreviewCh)

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
