/**
 * Scenes editor — build live route source item for layer drag to Sources.
 */

import { formatFps } from './sources-panel-helpers.js'
import { resolveLookStackChannelForBus } from '../lib/look-stack-amcp-channel.js'

/**
 * @param {object} ctx
 */
export function createBuildLayerRouteLiveSourceItem(ctx) {
	const { sceneState, getChannelMap } = ctx
	return function buildLayerRouteLiveSourceItem(scene, layerNumber, opts = {}) {
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
				label: `Route: Ch${ch} L${ln}${busTag} · ${lookName}`,
				lookId: scene?.id || '',
				lookName,
				resolution,
				fps,
				thumbnailChannel: ch,
			},
		}
	}
}
