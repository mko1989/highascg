/**
 * Global border slot resolution + AMCP helpers for PRV preview runtime (PGM 998/996, PRV 997 mirror).
 */

import { api } from './api-client.js'
import { postAmcpPreviewPipeline } from './amcp-preview-batch.js'

export const GB_LAYER_PGM_A = 998
export const GB_LAYER_PGM_B = 996
export const GB_LAYER_PRV_MIRROR = 997

/**
 * @param {{ sceneState: object, getChannelMap: () => object, lastGlobalBorderPushMeta: Map<string, { sceneId: string, borderType: string }> }} deps
 */
export function createScenesPreviewGlobalBorder(deps) {
	const { sceneState, getChannelMap, lastGlobalBorderPushMeta } = deps

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
		return gb?.activePgmLayer === 996 ? GB_LAYER_PGM_B : GB_LAYER_PGM_A
	}

	/** @returns {{ channel: number, layer: number }[]} */
	function globalBorderCasparSlots(mIdx) {
		const gb = sceneState.getGlobalBorderForScreen(mIdx)
		if (!gb) return []
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

	function globalBorderSlotsForPreviewPush(mIdx, forcePrvBus, borderEnabled) {
		const gb = sceneState.getGlobalBorderForScreen(mIdx)
		if (!gb) return []
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
		if (!gb) return { ok: false, error: 'no_border_slot' }
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

	function borderSlicesKey(globalBorder) {
		const slices = globalBorder?.slices
		if (!Array.isArray(slices) || slices.length === 0) return ''
		return JSON.stringify(
			slices.map((s) => ({
				x: Number(s.x) || 0,
				y: Number(s.y) || 0,
				w: Number(s.w) || 0,
				h: Number(s.h) || 0,
			})),
		)
	}

	function borderUsesCgUpdate(slot, sceneId, borderEnabled, globalBorder) {
		if (!borderEnabled || !globalBorder) return false
		const prev = lastGlobalBorderPushMeta.get(borderMetaKey(slot.channel, slot.layer))
		const ty = String(globalBorder.type || '').toLowerCase()
		const sk = borderSlicesKey(globalBorder)
		return !!(
			prev &&
			String(prev.sceneId) === String(sceneId) &&
			String(prev.borderType || '').toLowerCase() === ty &&
			String(prev.slicesKey ?? '') === sk
		)
	}

	function stripMirrorFromBorderPayload(gb) {
		if (!gb || typeof gb !== 'object') return gb
		const { mirrorBorderOnPrv, borderPresets, pgmAirSnapshot, ...rest } = gb
		return rest
	}

	function normalizeBorderSlices(slices) {
		if (!Array.isArray(slices) || slices.length === 0) return []
		return slices.map((s) => ({
			x: Number(s.x) || 0,
			y: Number(s.y) || 0,
			w: Math.max(0.001, Number(s.w) || 1),
			h: Math.max(0.001, Number(s.h) || 1),
		}))
	}

	function borderPayloadForBorderLines(gb, borderEnabled) {
		const fd = Math.max(0, parseInt(String(gb?.fadeDuration ?? 25), 10) || 25)
		if (!borderEnabled || !gb) return { enabled: false, fadeDuration: fd }
		const payload = { ...stripMirrorFromBorderPayload(gb), fadeDuration: fd }
		const norm = normalizeBorderSlices(gb.slices)
		if (norm.length) payload.slices = norm
		else delete payload.slices
		return payload
	}

	function recordBorderPushMeta(slots, sceneId, borderEnabled, globalBorder) {
		for (const slot of slots) {
			const k = borderMetaKey(slot.channel, slot.layer)
			if (!borderEnabled) {
				lastGlobalBorderPushMeta.delete(k)
			} else {
				lastGlobalBorderPushMeta.set(k, {
					sceneId: String(sceneId),
					borderType: String(globalBorder.type || ''),
					slicesKey: borderSlicesKey(globalBorder),
				})
			}
		}
	}

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
							slices: border.slices,
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

	return {
		physicalPgmChannelForMain,
		physicalPrvChannelForMain,
		globalBorderCasparSlots,
		globalBorderClearSlots,
		globalBorderSlotsForPreviewPush,
		borderMetaKey,
		borderUsesCgUpdate,
		borderPayloadForBorderLines,
		recordBorderPushMeta,
		recallGlobalBorderPreset,
		pushBorderOnlyNow,
		GB_LAYER_PRV_MIRROR,
	}
}
