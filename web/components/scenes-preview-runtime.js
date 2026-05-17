/**
 * PRV preview push queue + AMCP batching for the scenes editor (coalesced, serialized).
 */

import { api } from '../lib/api-client.js'
import { postAmcpPreviewPipeline, AMCP_BATCH_MAX_COMMANDS } from '../lib/amcp-preview-batch.js'
import { audioRouteToAudioFilter } from '../lib/audio-routes.js'
import { resolveLayerFillForAmcp } from '../lib/mixer-fill.js'
import { shouldApplyStraightAlphaKeyer } from '../lib/media-ext.js'
import { buildPipOverlayAmcpLinesAll, buildPipOverlayRemoveLines, buildPipOverlayRemoveStaleSlots } from '../lib/pip-overlay-amcp.js'
import { getPipOverlaysFromLayer, resolvePipOverlayCasparLayer } from '../lib/pip-overlay-registry.js'
import { amcpParam, chLayerAmcp } from './scenes-shared.js'
import { effectToAmcpLines } from '../lib/effect-registry.js'

const PREVIEW_PUSH_DEBOUNCE_MS = 16

/** Must match server `TIMELINE_LAYER_BASE` — timeline clips use Caspar layers 200+. */
const TIMELINE_LAYER_BASE = 200
const TIMELINE_LAYER_CLEAR_COUNT = 32

/** Scene content on PRV uses the same layer numbers as PGM (L9 = black CG; main clips on 10, 20, 30…; PIP/CG in the band above each). */
const PREVIEW_SCENE_LAYER_MIN = 10

/** @param {object} [stateStore] @param {number} previewCh @returns {Set<number>} */
function allMatrixLayersOnPreviewChannel(stateStore, previewCh) {
	const out = new Set()
	const st = stateStore?.getState?.() || {}
	const matrix = st?.playback?.matrix || st?.playbackMatrix || {}
	if (!matrix || typeof matrix !== 'object') return out
	for (const key of Object.keys(matrix)) {
		const m = String(key).match(/^(\d+)-(\d+)$/)
		if (!m) continue
		const ch = Number(m[1])
		const ln = Number(m[2])
		if (ch !== Number(previewCh)) continue
		if (!Number.isFinite(ln) || ln < PREVIEW_SCENE_LAYER_MIN || ln >= 10000) continue
		out.add(ln)
	}
	return out
}

/** Common look-stack decade slots (PIP HTML may use base+1… — matrix sweep catches orphans). */
function defaultLookDecadeLayersForSweep() {
	const out = new Set()
	for (let L = 10; L <= 900; L += 10) out.add(L)
	return out
}

/** @param {{ sceneState: object, stateStore: object, getChannelMap: () => object, getPreviewChannel: () => number|null, getPreviewOutputResolution: () => { w: number, h: number, fps?: number } }} opts */
export function createScenesPreviewRuntime(opts) {
	const { sceneState, stateStore, getChannelMap, getPreviewChannel, getPreviewOutputResolution } = opts

	/** @type {Set<number> | null} */
	let lastPreviewLayers = null

	/**
	 * After a successful push, tracks which layers had which clip so we can send MIXER-only updates
	 * (no PLAY) when only fill / rotation / opacity change — video keeps playing.
	 * @type {{ sceneId: string, contentByLayer: Map<number, { value: string, loop: boolean, straightAlpha: boolean }> } | null}
	 */
	let lastPreviewContentSnapshot = null

	let previewPushBusy = false
	let previewPushPending = false
	/** @type {{ sceneId: string, targetMains?: number[], forcePrvBus?: boolean } | null} */
	let previewPushRequest = null

	let previewDebounce = null

	let previewFlushRaf = null

	/** PGM stack 998/996 for preset crossfades; PRV edit bus uses 997 (WO-43). */
	const GB_LAYER_PGM_A = 998
	const GB_LAYER_PGM_B = 996
	const GB_LAYER_PRV_MIRROR = 997

	/** @type {Map<string, { sceneId: string, borderType: string }>} — key `${channel}-${layer}` */
	let lastGlobalBorderPushMeta = new Map()

	function physicalPgmChannelForMain(mIdx) {
		const cm = getChannelMap()
		const n = Number(cm.programChannels?.[mIdx] ?? cm.playbackChannels?.[mIdx])
		return Number.isFinite(n) && n > 0 ? n : null
	}

	function physicalPrvChannelForMain(mIdx) {
		const cm = getChannelMap()
		const n = Number(cm.previewChannels?.[mIdx])
		return Number.isFinite(n) && n > 0 ? n : null
	}

	function globalBorderActivePgmLayerNumber(mIdx) {
		const gb = sceneState.getGlobalBorderForScreen(mIdx)
		return gb.activePgmLayer === 996 ? GB_LAYER_PGM_B : GB_LAYER_PGM_A
	}

	/** @returns {{ channel: number, layer: number }[]} */
	function globalBorderCasparSlots(mIdx) {
		const gb = sceneState.getGlobalBorderForScreen(mIdx)
		const mirror = gb.mirrorBorderOnPrv === true
		const pgmCh = physicalPgmChannelForMain(mIdx)
		const prvCh = physicalPrvChannelForMain(mIdx)
		if (mirror && prvCh && pgmCh && prvCh !== pgmCh) {
			return [{ channel: prvCh, layer: GB_LAYER_PRV_MIRROR }]
		}
		const out = []
		if (pgmCh) out.push({ channel: pgmCh, layer: globalBorderActivePgmLayerNumber(mIdx) })
		return out
	}

	/**
	 * Slots to fade out / clear — PGM 998+996 (stack), PRV 997 only when PRV edit bus on or meta says we own it.
	 */
	function globalBorderClearSlots(mIdx) {
		const gb = sceneState.getGlobalBorderForScreen(mIdx)
		const mirror = gb?.mirrorBorderOnPrv === true
		const pgmCh = physicalPgmChannelForMain(mIdx)
		const prvCh = physicalPrvChannelForMain(mIdx)
		const out = []
		if (pgmCh) {
			out.push({ channel: pgmCh, layer: GB_LAYER_PGM_A })
			out.push({ channel: pgmCh, layer: GB_LAYER_PGM_B })
		}
		const separatePrv = !!(prvCh && pgmCh && prvCh !== pgmCh)
		const include997 = separatePrv && (mirror || lastGlobalBorderPushMeta.has(borderMetaKey(prvCh, GB_LAYER_PRV_MIRROR)))
		if (include997) out.push({ channel: prvCh, layer: GB_LAYER_PRV_MIRROR })
		return out
	}

	/**
	 * Border AMCP targets for this preview push.
	 * Deck PRV recall (`forcePrvBus`) must not touch PGM (avoids ch1 blink); optional PRV L997 only when mirrored.
	 */
	function globalBorderSlotsForPreviewPush(mIdx, forcePrvBus, borderEnabled) {
		const gb = sceneState.getGlobalBorderForScreen(mIdx)
		const mirror = gb.mirrorBorderOnPrv === true
		const pgmCh = physicalPgmChannelForMain(mIdx)
		const prvCh = physicalPrvChannelForMain(mIdx)
		const separatePrv = !!(prvCh && pgmCh && prvCh !== pgmCh)

		if (forcePrvBus) {
			if (!separatePrv) return []
			if (borderEnabled) {
				if (!mirror) return []
				return [{ channel: prvCh, layer: GB_LAYER_PRV_MIRROR }]
			}
			if (mirror) return [{ channel: prvCh, layer: GB_LAYER_PRV_MIRROR }]
			return []
		}

		if (borderEnabled) return globalBorderCasparSlots(mIdx)
		return globalBorderClearSlots(mIdx)
	}

	function borderMetaKey(ch, layer) {
		return `${ch}-${layer}`
	}

	/**
	 * @param {number} mIdx
	 * @param {number} slotNum
	 * @returns {Promise<{ ok: boolean, error?: string }>}
	 */
	async function recallGlobalBorderPreset(mIdx, slotNum) {
		const preset = sceneState.getGlobalBorderPreset(mIdx, slotNum)
		if (!preset?.data) return { ok: false, error: 'empty_slot' }
		const gb = sceneState.getGlobalBorderForScreen(mIdx)
		const pgmCh = physicalPgmChannelForMain(mIdx)
		if (!pgmCh) return { ok: false, error: 'no_pgm' }

		const fromLayer = globalBorderActivePgmLayerNumber(mIdx)
		const toLayer = fromLayer === GB_LAYER_PGM_A ? GB_LAYER_PGM_B : GB_LAYER_PGM_A
		const inactiveMode = lastGlobalBorderPushMeta.has(borderMetaKey(pgmCh, toLayer)) ? 'update' : 'add'
		const mergedBorder = { ...gb, ...preset.data, enabled: true }
		const borderForApi = { ...stripMirrorFromBorderPayload(mergedBorder), fadeDuration: gb.fadeDuration ?? 25 }
		try {
			const borderRes = await api.post('/api/scene/border-preset-crossfade', {
				channel: pgmCh,
				fromLayer,
				toLayer,
				border: borderForApi,
				fadeDuration: gb.fadeDuration ?? 25,
				inactiveMode,
			})
			const raw = borderRes?.lines
			if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'no_lines' }
			const needsMixerCommit = raw.some((l) => /\bDEFER\b/i.test(String(l)))
			const pipe = needsMixerCommit ? [...raw, `MIXER ${pgmCh} COMMIT`] : raw
			await postAmcpPreviewPipeline(pipe)
		} catch (e) {
			console.warn('Border preset recall failed:', e)
			return { ok: false, error: String(e?.message || e) }
		}
		sceneState.setGlobalBorderForScreen(mIdx, {
			...gb,
			...preset.data,
			enabled: true,
			activePgmLayer: toLayer === GB_LAYER_PGM_B ? 996 : 998,
		})
		sceneState.noteGlobalBorderPushedToPgm(mIdx, {
			...gb,
			...preset.data,
			enabled: true,
			activePgmLayer: toLayer === GB_LAYER_PGM_B ? 996 : 998,
		})
		const refSceneId = String(
			sceneState.getPreviewSceneIdForMain(mIdx) ||
				sceneState.getLiveSceneIdForMain(mIdx) ||
				sceneState.editingSceneId ||
				`__border_main_${mIdx}__`,
		)
		lastGlobalBorderPushMeta.delete(borderMetaKey(pgmCh, fromLayer))
		recordBorderPushMeta([{ channel: pgmCh, layer: toLayer }], refSceneId, true, { type: preset.data.type })
		return { ok: true }
	}

	function borderUsesCgUpdate(slot, sceneId, borderEnabled, globalBorder) {
		if (!borderEnabled || !globalBorder) return false
		const prev = lastGlobalBorderPushMeta.get(borderMetaKey(slot.channel, slot.layer))
		const ty = String(globalBorder.type || '').toLowerCase()
		return !!(prev && String(prev.sceneId) === String(sceneId) && String(prev.borderType || '').toLowerCase() === ty)
	}

	function stripMirrorFromBorderPayload(gb) {
		if (!gb || typeof gb !== 'object') return gb
		const { mirrorBorderOnPrv, borderPresets, pgmAirSnapshot, ...rest } = gb
		return rest
	}

	/** Payload for `/api/scene/border-lines` — always send `fadeDuration` so enable/disable use mixer fades. */
	function borderPayloadForBorderLines(gb, borderEnabled) {
		const fd = Math.max(0, parseInt(String(gb?.fadeDuration ?? 25), 10) || 25)
		if (!borderEnabled) return { enabled: false, fadeDuration: fd }
		return { ...stripMirrorFromBorderPayload(gb), fadeDuration: fd }
	}

	function recordBorderPushMeta(slots, sceneId, borderEnabled, globalBorder) {
		for (const slot of slots) {
			const k = borderMetaKey(slot.channel, slot.layer)
			if (!borderEnabled) {
				lastGlobalBorderPushMeta.delete(k)
			} else {
				lastGlobalBorderPushMeta.set(k, { sceneId: String(sceneId), borderType: String(globalBorder.type || '') })
			}
		}
	}

	/**
	 * Read currently occupied look-stack layers from live state for a given PRV channel.
	 * This is the source of truth for what is actually on-air in Caspar, so we avoid
	 * blanket clears and avoid relying only on local "last pushed" cache.
	 *
	 * @param {number} previewCh
	 * @returns {Set<number>}
	 */
	function getOccupiedPreviewLookLayersFromState(previewCh) {
		const out = new Set()
		const st = stateStore?.getState?.() || {}
		const matrix = st?.playback?.matrix || st?.playbackMatrix || {}
		if (!matrix || typeof matrix !== 'object') return out
		for (const cell of Object.values(matrix)) {
			if (!cell || typeof cell !== 'object') continue
			if (cell.playing === false) continue
			const ch = Number(cell.channel)
			const ln = Number(cell.layer)
			if (!Number.isFinite(ch) || !Number.isFinite(ln)) continue
			if (ch !== Number(previewCh)) continue
			// Keep preview cleanup scoped to look stack range (decade-based 10,20... + PIP HTML overhead).
			if (ln < PREVIEW_SCENE_LAYER_MIN || ln >= 10000) continue
			out.add(ln)
		}
		return out
	}

	/**
	 * Caspar channel used for look-stack preview AMCP (L10+, PIPs, etc.).
	 * Deck / explicit recall must hit the real PRV bus even if compose had `editOnPgm` left on.
	 */
	function resolvePreviewAmcpChannel(mIdx, forcePrvBus) {
		const cm = getChannelMap()
		if (forcePrvBus) {
			const prv = Number(cm.previewChannels?.[mIdx])
			if (Number.isFinite(prv) && prv > 0) return prv
			const pgm = Number(cm.programChannels?.[mIdx] ?? cm.playbackChannels?.[mIdx])
			return Number.isFinite(pgm) && pgm > 0 ? pgm : null
		}
		if (sceneState.editOnPgm) {
			const pgm = Number(cm.programChannels?.[mIdx] ?? cm.playbackChannels?.[mIdx])
			return Number.isFinite(pgm) && pgm > 0 ? pgm : null
		}
		const prv = Number(cm.previewChannels?.[mIdx])
		return Number.isFinite(prv) && prv > 0 ? prv : null
	}

	async function drainPreviewPushQueue() {
		if (previewPushBusy) {
			previewPushPending = true
			return
		}
		previewPushBusy = true
		try {
			const req = previewPushRequest
			previewPushRequest = null
			const id = req?.sceneId ?? sceneState.editingSceneId
			const restrictMains = req?.targetMains
			const forcePrvBus = req?.forcePrvBus === true
			if (id) {
				await pushSceneToPreview(id, restrictMains, forcePrvBus)
			}
		} finally {
			previewPushBusy = false
			if (previewPushPending) {
				previewPushPending = false
				void drainPreviewPushQueue()
			}
		}
	}

	/**
	 * Wait until the preview AMCP push queue is idle (e.g. after `sendSceneToPreviewCard`).
	 */
	async function waitForPreviewPushComplete() {
		await new Promise((r) => setTimeout(r, 0))
		for (let i = 0; i < 400; i++) {
			if (!previewPushBusy && !previewPushPending) return
			await new Promise((r) => setTimeout(r, 16))
		}
	}

	function schedulePreviewPush() {
		if (previewDebounce != null) clearTimeout(previewDebounce)
		previewDebounce = setTimeout(() => {
			previewDebounce = null
			previewPushRequest = null
			void drainPreviewPushQueue()
		}, PREVIEW_PUSH_DEBOUNCE_MS)
	}

	function flushPreviewPush() {
		if (previewDebounce != null) clearTimeout(previewDebounce)
		previewDebounce = null
		previewPushRequest = null
		void drainPreviewPushQueue()
	}

	function scheduleFlushPreviewFromInspector() {
		if (previewFlushRaf != null) cancelAnimationFrame(previewFlushRaf)
		previewFlushRaf = requestAnimationFrame(() => {
			previewFlushRaf = null
			flushPreviewPush()
		})
	}

	/** @param {string} sceneId @param {object} scene */
	function buildPreviewContentSnapshot(sceneId, scene, computedFills = new Map()) {
		const contentByLayer = new Map()
		for (const l of scene.layers || []) {
			if (!l?.source?.value) continue
			const ln = Number(l.layerNumber)
			const f = computedFills.get(ln)
			contentByLayer.set(ln, {
				value: String(l.source.value),
				loop: !!l.loop,
				straightAlpha: !!l.straightAlpha,
				contentFit: l.contentFit || 'native',
				audioRoute: l.audioRoute || '1+2',
				volume: l.volume != null ? l.volume : 1,
				muted: !!l.muted,
				pipOverlays: getPipOverlaysFromLayer(l),
				effects: l.effects || [],
				fill: f ? { x: f.x, y: f.y, scaleX: f.scaleX, scaleY: f.scaleY } : null,
				rotation: l.rotation ?? 0,
				opacity: l.opacity ?? 1,
				keyer: shouldApplyStraightAlphaKeyer(!!l.straightAlpha, l.source?.value) ? 1 : 0,
			})
		}
		return { sceneId, contentByLayer }
	}

	/** Same clips on the same layers — only geometry / opacity / rotation may have changed. */
	function isGeometryOnlyPreview(sceneId, scene) {
		if (!lastPreviewContentSnapshot) return false
		const prev = lastPreviewContentSnapshot.contentByLayer
		const cur = new Map()
		for (const l of scene.layers || []) {
			if (!l?.source?.value) continue
			cur.set(Number(l.layerNumber), layerContentMetaForSnapshot(l))
		}
		if (prev.size !== cur.size) return false
		for (const [num, meta] of cur) {
			const p = prev.get(num)
			if (!p) return false
			const pContent = {
				value: p.value,
				loop: p.loop,
				straightAlpha: p.straightAlpha,
				contentFit: p.contentFit,
				audioRoute: p.audioRoute,
				volume: p.volume,
				muted: p.muted,
				pipOverlays: p.pipOverlays,
			}
			if (JSON.stringify(pContent) !== JSON.stringify(meta)) {
				return false
			}
		}
		return true
	}

	function layerContentMetaForSnapshot(layer) {
		if (!layer?.source?.value) return null
		return {
			value: String(layer.source.value),
			loop: !!layer.loop,
			straightAlpha: !!layer.straightAlpha,
			contentFit: layer.contentFit || 'native',
			audioRoute: layer.audioRoute || '1+2',
			volume: layer.volume != null ? layer.volume : 1,
			muted: !!layer.muted,
			pipOverlays: getPipOverlaysFromLayer(layer),
			browserAsCg: !!layer.source.browserAsCg,
		}
	}

	/**
	 * @param {string} sceneId
	 * @param {number[]|undefined} restrictMains - If set, only push AMCP / set preview state for these main indices (deck column, look recall, etc.).
	 * @param {boolean} [forcePrvBus] - When true (deck / recall), always use the mapped preview channel, not PGM from edit-on-PGM compose mode.
	 */
	async function pushSceneToPreview(sceneId, restrictMains, forcePrvBus = false) {
		if (!sceneId) return
		const scene = sceneState.getScene(sceneId)
		if (!scene) return

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
			// If routing/scene-scope metadata drifts, still honor an explicit deck column / recall target.
			targetIdxs =
				narrowed.length > 0
					? narrowed
					: [...allow].filter((i) => Number.isFinite(i) && i >= 0 && i < (cm.screenCount || 1))
		}
		if (targetIdxs.length === 0) return

		const pendingPreviewMainIds = []
		const borderMetaAccumulator = []
		try {
			const commandsByChannel = new Map()
			/** PGM (or other non-preview) border batches — DEFER lines must not share PRV's MIXER COMMIT. */
			const sideBorderPipelines = []
			const mediaListPromise = api.get('/api/media').catch(() => [])
			async function getMediaListOnce() { return mediaListPromise }
			
			let lastComputedFills = new Map()
			let lastPreviewCh = null

			for (const mIdx of targetIdxs) {
				const prvRes =
					cm.previewResolutions?.[mIdx] ||
					cm.programResolutions?.[mIdx] ||
					getPreviewOutputResolution()
				const previewCanvas = { width: prvRes.w, height: prvRes.h, framerate: prvRes.fps ?? 50 }
				const authoringCanvas = sceneState.getCanvasForScreen(mIdx)
				const previewCh = resolvePreviewAmcpChannel(mIdx, forcePrvBus)
				lastPreviewCh = previewCh
				if (!previewCh || previewCh <= 0) {
					continue
				}

				const queue = []
				const sameSceneOnSamePrv =
					lastPreviewContentSnapshot &&
					lastPreviewContentSnapshot.sceneId === sceneId &&
					Number(lastPreviewChannel) === Number(previewCh)
				const geometryOnly = isGeometryOnlyPreview(sceneId, scene) && sameSceneOnSamePrv
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
					const occupiedNow = getOccupiedPreviewLookLayersFromState(previewCh)
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
					// Timeline shares PRV; playback matrix often omits timeline slots — strip before look PLAY.
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
						layer.source.type === 'browser' && layer.source.browserAsCg === true && /^https?:\/\//i.test(String(clipRaw || '').trim())
					const browserCgUrl = browserCg ? String(clipRaw).trim() : null
					const clip = browserCgUrl ? '[HTML] black' : clipRaw
					const wantLoop = !!layer.loop
					let playCmd = `PLAY ${cl}`
					if (clip) playCmd += ' ' + amcpParam(clip)
					if (!String(clip || '').startsWith('route://') && wantLoop) playCmd += ' LOOP'
					const af = audioRouteToAudioFilter(layer.audioRoute || '1+2')
					if (af) playCmd += ` AF ${amcpParam(af)}`
					
					const vol = layer.muted ? 0 : layer.volume != null ? layer.volume : 1
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
					if (prevVol === undefined || prevVol !== vol) {
						mixerPart.push(`MIXER ${cl} VOLUME ${vol} DEFER`)
					}

					const curMeta = layerContentMetaForSnapshot(layer)
					const prevContent = prevMeta ? {
						value: prevMeta.value,
						loop: prevMeta.loop,
						straightAlpha: prevMeta.straightAlpha,
						contentFit: prevMeta.contentFit,
						audioRoute: prevMeta.audioRoute,
						volume: prevMeta.volume,
						muted: prevMeta.muted,
						pipOverlays: prevMeta.pipOverlays,
					} : null
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
						queue.push(playCmd, 
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

					// Effects
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

				// Global border: compose pushes update PGM (+ optional PRV mirror). Deck PRV recall never touches PGM.
				const globalBorder = sceneState.getGlobalBorderForScreen(mIdx)
				const borderEnabled = !!(globalBorder && globalBorder.enabled)
				const borderSlots = globalBorderSlotsForPreviewPush(mIdx, forcePrvBus, borderEnabled)
				const borderApiPayload = borderPayloadForBorderLines(globalBorder, borderEnabled)
				const forceFadeIn = !!(borderEnabled && sceneState.borderJustEnabled?.[mIdx])
				if (borderSlots.length > 0) {
					try {
						for (const slot of borderSlots) {
							const isUpdate = !forceFadeIn && borderUsesCgUpdate(slot, sceneId, borderEnabled, globalBorder)
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
				recordBorderPushMeta(ent.slots, sceneId, ent.borderEnabled, ent.globalBorder)
			}

			for (const mIdx of pendingPreviewMainIds) {
				sceneState.setPreviewSceneId(sceneId, mIdx)
			}

			lastPreviewLayers = new Set((scene.layers || []).filter(l => l.source?.value).map(l => Number(l.layerNumber)))
			lastPreviewContentSnapshot = buildPreviewContentSnapshot(sceneId, scene, lastComputedFills)
			lastPreviewChannel = Number(lastPreviewCh)
		} catch (e) {
			console.warn('Scene preview push failed:', e?.message || e)
		}
	}

	/**
	 * @param {string} sceneId
	 * @param {{ targetMains?: number[] }} [opts]
	 */
	function sendSceneToPreviewCard(sceneId, opts = {}) {
		if (previewDebounce != null) clearTimeout(previewDebounce)
		previewDebounce = null
		const forcePrvBus = opts.forcePrvBus !== false
		previewPushRequest = { sceneId, targetMains: opts.targetMains, forcePrvBus }
		void drainPreviewPushQueue()
	}

	/** @type {number | null} */
	let lastPreviewChannel = null

	function clearLastPreviewLayers() {
		lastPreviewLayers = null
		lastPreviewContentSnapshot = null
		lastPreviewChannel = null
		lastGlobalBorderPushMeta.clear()
	}

	/**
	 * Clear preview selection for one main and stop look-stack layers on the mapped PRV channel.
	 * When PGM and PRV share the same physical channel, only UI preview state is cleared (no AMCP).
	 * @param {number} mIdx
	 * @param {{ full?: boolean }} [opts] — `full`: also sweep timeline layers, deck decade slots, and all matrix layers on PRV (not only “last look” / occupied).
	 */
	async function clearPreviewBusForMain(mIdx, opts = {}) {
		if (previewDebounce != null) {
			clearTimeout(previewDebounce)
			previewDebounce = null
		}
		previewPushRequest = null
		await waitForPreviewPushComplete()

		sceneState.setPreviewSceneId(null, mIdx)

		const pgmCh = physicalPgmChannelForMain(mIdx)
		const prvCh = physicalPrvChannelForMain(mIdx)
		const separatePrv = !!(prvCh && pgmCh && prvCh !== pgmCh)
		if (!separatePrv || !prvCh) return

		const previewCh = prvCh
		const queue = []
		const occupied = getOccupiedPreviewLookLayersFromState(previewCh)
		if (Number(lastPreviewChannel) === Number(previewCh) && lastPreviewLayers) {
			for (const n of lastPreviewLayers) {
				if (Number.isFinite(n) && n >= PREVIEW_SCENE_LAYER_MIN && n < 10000) occupied.add(n)
			}
		}
		if (opts.full) {
			for (const n of allMatrixLayersOnPreviewChannel(stateStore, previewCh)) occupied.add(n)
			for (let ti = 0; ti < TIMELINE_LAYER_CLEAR_COUNT; ti++) occupied.add(TIMELINE_LAYER_BASE + ti)
			for (const n of defaultLookDecadeLayersForSweep()) occupied.add(n)
		}

		for (const ln of [...occupied].sort((a, b) => a - b)) {
			const dl = chLayerAmcp(previewCh, ln)
			queue.push(`STOP ${dl}`, `MIXER ${dl} CLEAR`, ...buildPipOverlayRemoveLines(previewCh, ln, 10000))
		}

		const gb = sceneState.getGlobalBorderForScreen(mIdx)
		const mirror = gb?.mirrorBorderOnPrv === true
		const include997 =
			mirror || lastGlobalBorderPushMeta.has(borderMetaKey(previewCh, GB_LAYER_PRV_MIRROR))

		if (include997) {
			try {
				const borderRes = await api.post('/api/scene/border-lines', {
					channel: previewCh,
					layer: GB_LAYER_PRV_MIRROR,
					border: borderPayloadForBorderLines(gb, false),
					isUpdate: false,
				})
				const raw = borderRes?.lines
				if (Array.isArray(raw) && raw.length > 0) queue.push(...raw)
			} catch (e) {
				console.warn('Failed to clear PRV border mirror:', e?.message || e)
			}
			lastGlobalBorderPushMeta.delete(borderMetaKey(previewCh, GB_LAYER_PRV_MIRROR))
		}

		const commitLine = `MIXER ${previewCh} COMMIT`
		queue.push(commitLine)
		if (queue.some((l) => l !== commitLine)) {
			await postAmcpPreviewPipeline(queue)
		}

		if (Number(lastPreviewChannel) === Number(previewCh)) {
			lastPreviewLayers = null
			lastPreviewContentSnapshot = null
			lastPreviewChannel = null
		}
	}

	/**
	 * After take, `applySceneFromTakePayload` replaces layers from the server — the next debounced push
	 * would otherwise see a "content change" vs the pre-take snapshot and run a full STOP/CLEAR sweep on PRV.
	 * Prime the snapshot from the current scene so the next push is geometry-only (mixer updates).
	 */
	function primePreviewSnapshotFromScene(sceneId) {
		const scene = sceneState.getScene(sceneId)
		if (!scene || !sceneId) return
		lastPreviewContentSnapshot = buildPreviewContentSnapshot(sceneId, scene)
		const used = new Set()
		for (const l of scene.layers || []) {
			if (l?.source?.value) used.add(Number(l.layerNumber))
		}
		lastPreviewLayers = used
	}

	/** @returns {Promise<void>} */
	async function pushBorderOnlyNow() {
		const targetIdxs = sceneState.armedScreenIndices?.length ? sceneState.armedScreenIndices : [sceneState.activeScreenIndex]

		for (const mIdx of targetIdxs) {
			const border = sceneState.getGlobalBorderForScreen(mIdx)
			const borderEnabled = !!(border && border.enabled)
			const slots = borderEnabled ? globalBorderCasparSlots(mIdx) : globalBorderClearSlots(mIdx)
			if (slots.length === 0) continue

			const forceFullAdd = !!sceneState.borderJustEnabled?.[mIdx]
			const refSceneId = String(
				sceneState.getPreviewSceneIdForMain(mIdx) ||
					sceneState.getLiveSceneIdForMain(mIdx) ||
					sceneState.editingSceneId ||
					`__border_main_${mIdx}__`,
			)
			const borderApiPayload = borderPayloadForBorderLines(border, borderEnabled)

			for (const slot of slots) {
				try {
					const forceFadeIn = !!(borderEnabled && forceFullAdd)
					const isUpdate = !forceFadeIn && borderUsesCgUpdate(slot, refSceneId, borderEnabled, border)
					const borderRes = await api.post('/api/scene/border-lines', {
						channel: slot.channel,
						layer: slot.layer,
						border: borderApiPayload,
						isUpdate,
					})
					const raw = borderRes?.lines
					if (!Array.isArray(raw) || raw.length === 0) continue
					const needsMixerCommit = raw.some((l) => /\bDEFER\b/i.test(String(l)))
					const pipe = needsMixerCommit ? [...raw, `MIXER ${slot.channel} COMMIT`] : raw
					await postAmcpPreviewPipeline(pipe)
				} catch (e) {
					console.warn('Failed to push border only:', e)
				}
			}
			recordBorderPushMeta(slots, refSceneId, borderEnabled, border)
			const pgmCh0 = physicalPgmChannelForMain(mIdx)
			if (
				pgmCh0 &&
				slots.some(
					(s) =>
						Number(s.channel) === Number(pgmCh0) &&
						(s.layer === GB_LAYER_PGM_A || s.layer === GB_LAYER_PGM_B),
				)
			) {
				if (borderEnabled) {
					for (const slot of slots) {
						if (Number(slot.channel) !== Number(pgmCh0)) continue
						const ln = Number(slot.layer)
						if (ln !== GB_LAYER_PGM_A && ln !== GB_LAYER_PGM_B) continue
						sceneState.noteGlobalBorderPushedToPgm(mIdx, {
							enabled: !!border.enabled,
							type: border.type,
							params: border.params,
							fadeDuration: border.fadeDuration,
							artnetPatch: border.artnetPatch,
							activePgmLayer: ln,
						})
					}
				} else {
					sceneState.noteGlobalBorderPushedToPgm(mIdx, { ...border, enabled: false })
				}
			}
			if (forceFullAdd && sceneState.borderJustEnabled && typeof sceneState.borderJustEnabled === 'object') {
				sceneState.borderJustEnabled[mIdx] = false
			}
		}
	}

	/** @type {ReturnType<typeof setTimeout> | null} */
	let borderPushDebounceTimer = null

	function pushBorderOnly() {
		const jb = sceneState.borderJustEnabled
		const urgent = jb && typeof jb === 'object' && Object.values(jb).some(Boolean)
		if (urgent) {
			if (borderPushDebounceTimer) {
				clearTimeout(borderPushDebounceTimer)
				borderPushDebounceTimer = null
			}
			void pushBorderOnlyNow()
			return
		}
		if (borderPushDebounceTimer) clearTimeout(borderPushDebounceTimer)
		borderPushDebounceTimer = setTimeout(() => {
			borderPushDebounceTimer = null
			void pushBorderOnlyNow()
		}, 110)
	}

	return {
		pushSceneToPreview,
		schedulePreviewPush,
		flushPreviewPush,
		scheduleFlushPreviewFromInspector,
		/** Await the current PRV push queue before continuing (e.g. after preview recall). */
		drainPreviewPushQueue,
		waitForPreviewPushComplete,
		sendSceneToPreviewCard,
		clearLastPreviewLayers,
		clearPreviewBusForMain,
		primePreviewSnapshotFromScene,
		pushBorderOnly,
		recallGlobalBorderPreset,
	}
}
