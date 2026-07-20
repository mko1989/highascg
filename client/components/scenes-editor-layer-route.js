/**
 * Scenes editor — build a `route://` source descriptor for one look layer.
 *
 * todos20.07.26 (owner): "the route shouldnt go to live sources browser but be added as a new
 * layer in that look only." This module used to build an `extraLiveSources` item that the ↗
 * button POSTed to `/api/device-view` (`addExtraLiveSource`), which published the route into the
 * globally-visible Sources browser. It now only produces the descriptor; {@link addRouteLayerToLook}
 * turns it into a new layer of the CURRENT look and nothing is registered globally.
 *
 * Nothing was lost by dropping the registration: `isHostLiveSource()` already excludes
 * `routeType: 'layer'` (see src/config/host-live-sources.js — `isWebpageHostCandidate` returns
 * false for it), so a layer route never got a Caspar channel, a producer, or a
 * `playHostLiveSourceNow()` call. The registration was a catalog entry only. Likewise
 * `authoritativeEntryForSource()` in src/config/live-source-route-heal.js has no `layer` branch,
 * so these entries were never channel-healed either.
 *
 * The route producer resolves at play time straight from the layer's `source.value` — see
 * src/engine/scene-route-deps.js, which parses `route://ch-layer` off the scene layers and folds
 * the route PLAYs into the same atomic batch as their source layer.
 */

import { formatFps } from './sources-panel-helpers.js'
import { resolveLookStackChannelForBus } from '../lib/look-stack-amcp-channel.js'

/**
 * @param {object} ctx
 */
export function createBuildLayerRouteDescriptor(ctx) {
	const { sceneState, getChannelMap } = ctx
	/**
	 * @param {object} scene
	 * @param {number} layerNumber — logical layer of `scene` to route FROM
	 * @param {{ forceBus?: 'edit' | 'pgm' | 'prv' }} [opts]
	 * @returns {{ item: object } | { error: string }}
	 */
	return function buildLayerRouteDescriptor(scene, layerNumber, opts = {}) {
		const cm = getChannelMap()
		const forceBus = opts.forceBus || 'pgm'
		const ch = resolveLookStackChannelForBus(cm, sceneState, scene, forceBus)
		if (!Number.isFinite(ch) || ch <= 0) {
			return { error: 'No Caspar preview/program channel for this screen. Check routing in Settings.' }
		}
		const ln = Number(layerNumber)
		if (!Number.isFinite(ln) || ln < 1) return { error: 'Invalid layer number.' }
		const screenCount = Math.max(1, cm.screenCount ?? 1)
		const scope = String(scene?.mainScope || 'all')
		const mIdx =
			scope === 'all'
				? (sceneState.activeScreenIndex ?? 0)
				: Math.min(Math.max(parseInt(scope, 10) || 0, 0), screenCount - 1)
		const res = cm.previewResolutions?.[mIdx] || cm.programResolutions?.[mIdx]
		const resolution = res?.w && res?.h ? `${res.w}×${res.h}` : ''
		const fps = res?.fps != null ? formatFps(res.fps) : ''
		const value = `route://${ch}-${ln}`
		const busTag = forceBus === 'pgm' ? ' PGM' : forceBus === 'prv' ? ' PRV' : ''
		const lookName = String(scene?.name || '').trim() || 'Untitled look'
		return {
			item: {
				type: 'route',
				routeType: 'layer',
				value,
				label: `Route: Ch${ch} L${ln}${busTag}`,
				lookId: scene?.id || '',
				lookName,
				resolution,
				fps,
				thumbnailChannel: ch,
				/** logical layer of this look the route reads — lets the engine treat it as intra-look. */
				sourceLayerNumber: ln,
			},
		}
	}
}

/**
 * Add a route descriptor to `scene` as a NEW layer of that look. Look-local: nothing is written to
 * `extraLiveSources`, so no entry appears in the Sources browser.
 *
 * The new layer always gets a fresh logical layer number (`sceneState.addLayer` allocates the
 * lowest free one), so it can never route to itself — and because it targets a layer of its own
 * look, `findSceneSelfRouteViolation()` exempts it and `remapIntraLookRoutesForTakeChannel()`
 * rewrites it to the physical bank layer at take time (src/engine/scene-route-deps.js).
 *
 * @param {object} opts
 * @param {import('../lib/scene-state.js').SceneState} opts.sceneState
 * @param {{ id: string }} opts.scene
 * @param {object} opts.item — descriptor from {@link createBuildLayerRouteDescriptor}
 * @returns {{ ok: true, layerIndex: number } | { ok: false, reason: string }}
 */
export function addRouteLayerToLook({ sceneState, scene, item }) {
	if (!scene?.id) return { ok: false, reason: 'No look is open.' }
	if (!item?.value) return { ok: false, reason: 'Invalid route.' }
	const layerIndex = sceneState.addLayer(scene.id)
	// addLayer returns -1 when the look is full (it toasts LOOK_FULL_MESSAGE itself).
	if (!(layerIndex >= 0)) return { ok: false, reason: '' }
	sceneState.setLayerSource(scene.id, layerIndex, {
		type: 'route',
		routeType: 'layer',
		value: item.value,
		label: item.label || item.value,
		...(item.resolution ? { resolution: item.resolution } : {}),
		...(item.fps ? { fps: item.fps } : {}),
		...(Number.isFinite(Number(item.thumbnailChannel)) && Number(item.thumbnailChannel) > 0
			? { thumbnailChannel: Number(item.thumbnailChannel) }
			: {}),
		...(Number.isFinite(Number(item.sourceLayerNumber))
			? { sourceLayerNumber: Number(item.sourceLayerNumber) }
			: {}),
	})
	return { ok: true, layerIndex }
}
