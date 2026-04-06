/**
 * Compare edited scene to persisted program snapshot (scene.live) for PRV route sync.
 * Mirrors scene-transition.js sourceEqual / fillEqual / layerVisuallyEqual (browser-safe).
 */

function sourceEqual(a, b) {
	if (!a && !b) return true
	if (!a || !b) return false
	const v1 = String(a.value || '')
	const v2 = String(b.value || '')
	if (v1 !== v2) return false
	const t1 = String(a.type || '').toLowerCase()
	const t2 = String(b.type || '').toLowerCase()
	if (t1 === t2) return true
	if ((t1 === 'media' || t1 === 'file') && (t2 === 'media' || t2 === 'file')) return true
	return false
}

function numClose(a, b, eps = 1e-5) {
	return Math.abs(Number(a) - Number(b)) < eps
}

/**
 * Live snapshot vs editor can differ slightly in normalized FILL (native letterbox recomputation).
 * Loose tolerance only for PRV route:// eligibility — not for transition diff logic.
 */
function fillEqualForLiveRoute(f1, f2) {
	const a = { x: 0, y: 0, scaleX: 1, scaleY: 1, ...(f1 || {}) }
	const b = { x: 0, y: 0, scaleX: 1, scaleY: 1, ...(f2 || {}) }
	// Loose: server vs browser can differ slightly after native-fill math; avoid false "native PRV" after take.
	const eps = 0.01
	return (
		numClose(a.x, b.x, eps) &&
		numClose(a.y, b.y, eps) &&
		numClose(a.scaleX, b.scaleX, eps) &&
		numClose(a.scaleY, b.scaleY, eps)
	)
}

function layerVisuallyEqualForRoute(cur, incoming) {
	if (!cur || !incoming) return false
	if (!sourceEqual(cur.source, incoming.source)) return false
	if (!fillEqualForLiveRoute(cur.fill, incoming.fill)) return false
	const epsRot = 0.01
	if (!numClose(cur.rotation ?? 0, incoming.rotation ?? 0, epsRot)) return false
	if (!numClose(cur.opacity ?? 1, incoming.opacity ?? 1, epsRot)) return false
	if (!!cur.straightAlpha !== !!incoming.straightAlpha) return false
	return !!cur.loop === !!incoming.loop
}

function layerHasContent(l) {
	return !!(l && l.source && l.source.value)
}

/**
 * True when this look matches what's on program for the given channel — preview can use route:// PGM layers.
 * @param {object} scene - edited scene
 * @param {object | null} liveEntry - { sceneId, scene } from scene.live[programCh]
 */
function countContentLayers(layers) {
	return (layers || []).filter((l) => layerHasContent(l)).length
}

export function sceneMatchesLiveProgram(scene, liveEntry) {
	if (!scene || !liveEntry || liveEntry.sceneId !== scene.id || !liveEntry.scene) return false
	const live = liveEntry.scene
	if (countContentLayers(scene.layers) !== countContentLayers(live.layers)) return false
	const byNum = new Map((live.layers || []).map((l) => [l.layerNumber, l]))
	for (const layer of scene.layers || []) {
		if (!layerHasContent(layer)) continue
		const cur = byNum.get(layer.layerNumber)
		if (!cur || !layerHasContent(cur)) return false
		if (!layerVisuallyEqualForRoute(cur, layer)) return false
	}
	return true
}
