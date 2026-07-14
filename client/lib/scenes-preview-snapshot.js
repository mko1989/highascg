import { getPipOverlaysFromLayer } from './pip-overlay-registry.js'
import { shouldApplyStraightAlphaKeyer } from './media-ext.js'

/**
 * Content keys whose change forces a full re-PLAY (vs MIXER-only update).
 * Single projection used on BOTH sides of every content comparison so the
 * stored snapshot and the current meta can never drift apart key-wise.
 * `!!` on booleans also normalizes old stored snapshots (pre-`browserAsCg`,
 * where the key is undefined) so they don't force one spurious re-PLAY.
 */
export function previewContentCompareKey(entry) {
	return {
		value: entry.value,
		loop: !!entry.loop,
		straightAlpha: !!entry.straightAlpha,
		contentFit: entry.contentFit,
		audioRoute: entry.audioRoute,
		volume: entry.volume,
		muted: !!entry.muted,
		pipOverlays: entry.pipOverlays,
		browserAsCg: !!entry.browserAsCg,
	}
}

/** @param {string} sceneId @param {object} scene */
export function buildPreviewContentSnapshot(sceneId, scene, computedFills = new Map()) {
	const contentByLayer = new Map()
	for (const l of scene.layers || []) {
		if (!l?.source?.value) continue
		const ln = Number(l.layerNumber)
		const f = computedFills.get(ln)
		contentByLayer.set(ln, {
			...layerContentMetaForSnapshot(l),
			effects: l.effects || [],
			fill: f ? { x: f.x, y: f.y, scaleX: f.scaleX, scaleY: f.scaleY } : null,
			rotation: l.rotation ?? 0,
			opacity: l.opacity ?? 1,
			keyer: shouldApplyStraightAlphaKeyer(!!l.straightAlpha, l.source?.value) ? 1 : 0,
		})
	}
	return { sceneId, contentByLayer }
}

export function layerContentMetaForSnapshot(layer) {
	if (!layer?.source?.value) return null
	return previewContentCompareKey({
		value: String(layer.source.value),
		loop: !!layer.loop,
		straightAlpha: !!layer.straightAlpha,
		contentFit: layer.contentFit || 'native',
		audioRoute: layer.audioRoute || '1+2',
		volume: layer.volume != null ? layer.volume : 1,
		muted: !!layer.muted,
		pipOverlays: getPipOverlaysFromLayer(layer),
		browserAsCg: !!layer.source.browserAsCg,
	})
}

/** Same clips on the same layers — only geometry / opacity / rotation may have changed. */
export function isGeometryOnlyPreview(lastPreviewContentSnapshot, scene) {
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
		if (JSON.stringify(previewContentCompareKey(p)) !== JSON.stringify(previewContentCompareKey(meta))) {
			return false
		}
	}
	return true
}
