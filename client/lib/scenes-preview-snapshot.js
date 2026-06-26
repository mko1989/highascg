import { getPipOverlaysFromLayer } from './pip-overlay-registry.js'
import { shouldApplyStraightAlphaKeyer } from './media-ext.js'

/** @param {string} sceneId @param {object} scene */
export function buildPreviewContentSnapshot(sceneId, scene, computedFills = new Map()) {
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

export function layerContentMetaForSnapshot(layer) {
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
