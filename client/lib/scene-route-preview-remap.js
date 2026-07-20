/**
 * Intra-look `route://` remapping for the CLIENT preview push (looks editor → PRV bus).
 *
 * todos19.07.26 (owner): "the routes doesnt show up on preview, highascg knows which route it
 * should show on prv channel and what on pgm."
 *
 * A look-local route layer is stored against the PROGRAM bus — `buildLayerRouteDescriptor()`
 * defaults to `forceBus: 'pgm'`, so the ↗ button writes `route://<pgmCh>-<srcLayer>` into
 * `layer.source.value` (client/components/scenes-editor-layer-route.js). Every SERVER take path
 * rewrites that to the channel actually being taken via
 * `remapIntraLookRoutesForTakeChannel()` (src/engine/scene-route-deps.js, called from
 * scene-take-lbg.js and scene-take-pgm-only.js) — which is why PGM works, and why staging a look
 * through `/api/scene/take` with `target: 'preview'` works too.
 *
 * The looks-editor live preview does NOT go through the server take pipeline: it builds AMCP
 * itself in client/lib/scenes-preview-push-scene.js and PLAYs `layer.source.value` verbatim onto
 * the PRV channel. The route therefore still names the PROGRAM channel, so the PRV route producer
 * taps the program bus instead of the look being staged next to it — the operator sees the program
 * feed, or (far more often) nothing at all, because PGM keeps look content on bank-mapped physical
 * layers while PRV is bank-less.
 *
 * This module is the preview-side mirror of the server helper. Same rule as
 * `remapIntraLookRoutesForTakeChannel()`: only a LAYER route (`route://N-L`) whose target layer
 * number belongs to the look itself is rewritten — a route that points somewhere outside the look
 * (a live input host, another screen's bus, a whole-channel `route://N`) means exactly what it
 * says and is left alone. PRV is bank-less by design (WO-199), so the physical target equals the
 * logical layer number and no bank offset is applied.
 */

/**
 * @param {unknown} value
 * @returns {{ channel: number, layer: number | null } | null}
 */
export function parseRouteClipValue(value) {
	const m = String(value || '')
		.trim()
		.match(/^route:\/\/(\d+)(?:-(\d+))?$/i)
	if (!m) return null
	const channel = parseInt(m[1], 10)
	if (!Number.isFinite(channel) || channel < 1) return null
	const layer = m[2] != null ? parseInt(m[2], 10) : null
	return { channel, layer: Number.isFinite(layer) ? layer : null }
}

/**
 * Logical layer numbers a look occupies — the "is this route intra-look?" test.
 * @param {Array<{ layerNumber?: unknown }>} layers
 * @returns {Set<number>}
 */
export function lookLogicalLayerNumbers(layers) {
	const set = new Set()
	for (const l of layers || []) {
		const n = parseInt(String(l?.layerNumber), 10)
		if (Number.isFinite(n)) set.add(n)
	}
	return set
}

/**
 * Rewrite an intra-look layer route onto the channel the look is actually being staged on.
 * Anything else (non-route value, whole-channel route, route to a layer outside this look, or a
 * route that already names `targetChannel`) is returned unchanged.
 *
 * @param {unknown} value — `layer.source.value`
 * @param {number} targetChannel — the PRV/edit channel receiving the PLAY
 * @param {Set<number>} logicalLayers — from {@link lookLogicalLayerNumbers}
 * @returns {unknown} the value to PLAY
 */
export function remapIntraLookRouteForChannel(value, targetChannel, logicalLayers) {
	const ch = parseInt(String(targetChannel), 10)
	if (!Number.isFinite(ch) || ch < 1) return value
	const parsed = parseRouteClipValue(value)
	if (!parsed || parsed.layer == null) return value
	if (!(logicalLayers instanceof Set) || !logicalLayers.has(parsed.layer)) return value
	/* PRV is bank-less (WO-199 — the take path forces bank 'a' for preview), so physical == logical. */
	const next = `route://${ch}-${parsed.layer}`
	return next === String(value).trim() ? value : next
}

/**
 * Order per-layer AMCP blocks so an intra-look route's source layer is PLAYed first.
 *
 * The preview push emits one command list in ascending layer order; a route layer whose number
 * happens to sort BELOW its source (the ↗ button takes the lowest free layer number, so this
 * happens as soon as a gap exists under the routed layer) would create its route producer against
 * a layer that has not been PLAYed yet, and stay black. This mirrors
 * `partitionTakeJobsPlayOrder()` + `orderRouteJobsByDependency()` (src/engine/scene-route-deps.js):
 * non-route blocks keep their order and go first, intra-look route blocks follow, each after the
 * block it depends on (so route→route chains resolve too). Unresolvable leftovers are appended in
 * their original order rather than dropped.
 *
 * @template {{ layerNumber: number, routeTargetLayer: number | null }} T
 * @param {T[]} blocks
 * @returns {T[]}
 */
export function orderPreviewLayerBlocks(blocks) {
	const all = [...(blocks || [])]
	/** @type {T[]} */
	const sources = []
	/** @type {T[]} */
	const routes = []
	for (const b of all) {
		if (b && b.routeTargetLayer != null) routes.push(b)
		else sources.push(b)
	}
	if (routes.length === 0) return all

	const onAir = new Set(sources.map((b) => Number(b?.layerNumber)).filter(Number.isFinite))
	const remaining = [...routes]
	/** @type {T[]} */
	const ordered = []
	let guard = 0
	while (remaining.length > 0 && guard++ <= remaining.length + 8) {
		let progressed = false
		for (let i = 0; i < remaining.length; i++) {
			const b = remaining[i]
			if (onAir.has(Number(b.routeTargetLayer))) {
				ordered.push(b)
				const n = Number(b.layerNumber)
				if (Number.isFinite(n)) onAir.add(n)
				remaining.splice(i, 1)
				progressed = true
				break
			}
		}
		if (!progressed) break
	}
	ordered.push(...remaining)
	return [...sources, ...ordered]
}
