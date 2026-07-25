/**
 * Low-latency mixer nudge (POST /api/preview/mixer-nudge), split out of scenes-preview-runtime.js.
 * While the looks editor drags geometry/opacity/crop, send ONLY the changed layers' fill fractions
 * to the server every ~90ms; the server maps look layer → staged PRV layer and computes the MIXER
 * lines with the SAME fill math the take pipeline uses. Cosmetic acceleration only: content changes
 * and convergence stay with the full push in scenes-preview-runtime.js.
 */

import { api } from '../lib/api-client.js'
import { isPreviewBusAvailable } from '../lib/scenes-preview-look-stack.js'
import { isGeometryOnlyPreview } from '../lib/scenes-preview-snapshot.js'

/**
 * Throttle for the low-latency geometry/opacity/crop nudge (POST /api/preview/mixer-nudge).
 * Cosmetic acceleration only — the full preview push / take pipeline stays authoritative and
 * converges to the same values (the server computes MIXER lines from the same fill fractions).
 */
const PREVIEW_NUDGE_THROTTLE_MS = 90

/** @param {{ sceneState: object, getChannelMap: () => object, getLastPreviewContentSnapshot: () => object|null }} env */
export function createMixerNudge(env) {
	const { sceneState, getChannelMap, getLastPreviewContentSnapshot } = env

	/** @type {ReturnType<typeof setTimeout> | null} */
	let nudgeTimer = null
	let nudgeInFlight = false
	let nudgeQueued = false
	let lastNudgeAt = 0
	/** @type {Map<string, string>} `${mIdx}:${layerNumber}` → JSON of last-nudged geometry */
	const lastNudgeSentByLayer = new Map()
	/** @type {string | null} */
	let lastNudgeSceneId = null
	/** WO-272: whether the last nudge targeted PGM (edit-on-PGM) — a mode flip resets the dedup map. */
	let lastNudgeTargetPgm = false

	function nudgeCropParams(l) {
		if (!Array.isArray(l.effects)) return null
		const fx = l.effects.find((e) => e?.type === 'crop')
		return fx?.params ?? null
	}

	function nudgeGeometryKeyForLayer(l) {
		return JSON.stringify({
			fill: l.fill ?? null,
			rotation: l.rotation ?? 0,
			opacity: l.opacity ?? 1,
			crop: nudgeCropParams(l),
			/* Lock state changes the resolved FILL (unlock → stretch, WO-326b) — toggling it with
			 * an unchanged rect must still re-nudge, so it is part of the dedup identity. */
			aspectLocked: l.aspectLocked !== false,
		})
	}

	/** Minimal layer subset — the server resolves fill fractions → MIXER numbers itself. */
	function nudgeLayerPayload(l) {
		const crop = nudgeCropParams(l)
		return {
			layerNumber: l.layerNumber,
			fill: l.fill ?? null,
			rotation: l.rotation ?? 0,
			opacity: l.opacity ?? 1,
			contentFit: l.contentFit,
			fillNativeAspect: l.fillNativeAspect,
			/* WO-326b: the server's mapContentFitToStretch branches on aspectLocked === false.
			 * Omitting it here made only the NUDGE contain-fit while the full push stretched —
			 * the two writers raced at throttle boundaries and the layer "sometimes jumped back
			 * to locked" mid-drag on PRV. */
			aspectLocked: l.aspectLocked,
			source: l.source ? { type: l.source.type, value: l.source.value } : null,
			effects: crop ? [{ type: 'crop', params: crop }] : [],
		}
	}

	function scheduleMixerNudge() {
		if (nudgeTimer != null) return
		const wait = Math.max(0, PREVIEW_NUDGE_THROTTLE_MS - (Date.now() - lastNudgeAt))
		nudgeTimer = setTimeout(() => {
			nudgeTimer = null
			void sendMixerNudge()
		}, wait)
	}

	async function sendMixerNudge() {
		if (nudgeInFlight) {
			nudgeQueued = true
			return
		}
		nudgeInFlight = true
		lastNudgeAt = Date.now()
		try {
			const id = sceneState.editingSceneId
			const scene = id ? sceneState.getScene(id) : null
			if (!id || !scene) return
			/* Only nudge the look our last full push/stage put on PRV, and only while the edit is
			 * geometry/opacity/crop-only — content changes (clip/loop/audio/PIP) need the full
			 * push's PLAY pipeline and must never be short-cut. */
			const lastPreviewContentSnapshot = getLastPreviewContentSnapshot()
			if (!lastPreviewContentSnapshot || lastPreviewContentSnapshot.sceneId !== id) return
			if (!isGeometryOnlyPreview(lastPreviewContentSnapshot, scene)) return
			/* WO-272 edit-on-PGM: same nudge machinery, pointed at the on-air PGM channel (the
			 * server maps logical→physical layers bank-aware and staleness-guards against what is
			 * actually live there). Only mains where this look IS live are nudged. */
			const pgmMode = sceneState.editOnPgm === true
			if (lastNudgeSceneId !== id || lastNudgeTargetPgm !== pgmMode) {
				lastNudgeSentByLayer.clear()
				lastNudgeSceneId = id
				lastNudgeTargetPgm = pgmMode
			}
			const cm = getChannelMap()
			for (const mIdx of nudgeTargetMainIdxs(scene, cm, sceneState)) {
				if (pgmMode) {
					if (sceneState.getLiveSceneIdForMain?.(mIdx) !== id) continue
				} else if (!isPreviewBusAvailable(cm, mIdx)) continue
				const changed = []
				for (const l of scene.layers || []) {
					if (!l?.source?.value) continue
					const ln = Number(l.layerNumber)
					if (!Number.isFinite(ln)) continue
					const key = `${mIdx}:${ln}`
					const geom = nudgeGeometryKeyForLayer(l)
					if (lastNudgeSentByLayer.get(key) === geom) continue
					changed.push({ layer: l, key, geom })
				}
				if (changed.length === 0) continue
				const cv = sceneState.getCanvasForScreen(mIdx)
				try {
					const res = await api.post('/api/preview/mixer-nudge', {
						mainIndex: mIdx,
						sceneId: id,
						...(pgmMode ? { target: 'pgm' } : {}),
						composeCanvas: cv ? { w: cv.width, h: cv.height } : null,
						layers: changed.map((c) => nudgeLayerPayload(c.layer)),
					})
					if (res?.ok) {
						for (const c of changed) lastNudgeSentByLayer.set(c.key, c.geom)
					} else {
						/* Not staged (yet/anymore) on this PRV — never repaint a foreign look; the
						 * authoritative push restages and the next nudge retries after that. */
						for (const c of changed) lastNudgeSentByLayer.delete(c.key)
					}
				} catch {
					/* cosmetic path — the authoritative push converges */
				}
			}
		} finally {
			nudgeInFlight = false
			if (nudgeQueued) {
				nudgeQueued = false
				scheduleMixerNudge()
			}
		}
	}

	function resetNudgeState() {
		lastNudgeSentByLayer.clear()
		lastNudgeSceneId = null
		lastNudgeTargetPgm = false
	}

	return { scheduleMixerNudge, sendMixerNudge, resetNudgeState }
}

export function nudgeTargetMainIdxs(scene, cm, sceneState) {
	const scope = String(scene.mainScope || 'all')
	if (scope === 'all') return Array.from({ length: cm.screenCount || 1 }, (_, i) => i)
	const n = parseInt(scope, 10)
	if (Number.isFinite(n) && n >= 0 && n < (cm.screenCount || 1)) return [n]
	return sceneState.armedScreenIndices?.length ? sceneState.armedScreenIndices : [sceneState.activeScreenIndex]
}
