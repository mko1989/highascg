'use strict'

/**
 * WO-606 — Shader Live, server side: every shader currently LIVE on any channel, from the live scene
 * state. A CJS mirror of client/lib/shader-live-instances.js (WO-345 / issues 01.08), resolved here
 * so Godot never rebuilds it from scene.live + a playlist poll.
 *
 * Playlist layers keep their authored source.value across hops, so a running playlist on a program
 * channel resolves to the item actually on air (ctx.playlistActiveIndices, the same index
 * GET /api/playlist/state reports). Looks recalled on preview do not run playlists (WO-581) — they
 * keep the authored value, like the web.
 */

const liveSceneState = require('../state/live-scene-state')

const SHADER_VALUE_RE = /(^|\/)shaders\/(sh-[a-z0-9-]+)/i

/** @param {object} ctx @param {number} ch */
function isPreview(ctx, ch) {
	try {
		return require('../engine/caspar-channel-clear').isPreviewCasparChannel(ctx.config, ch)
	} catch {
		return false
	}
}

/** @param {object} ctx @param {number} ch @param {object} scene @param {object} layer @returns {string|null} */
function playlistNowValue(ctx, ch, scene, layer) {
	const list = layer?.sourceMode === 'list' && Array.isArray(layer?.playlist) ? layer.playlist : null
	if (!list || !list.length || isPreview(ctx, ch)) return null
	const { playlistRuntimeKey } = require('../engine/scene-take-lbg-playlist')
	const rt = (ctx.playlistActiveIndices || {})[playlistRuntimeKey(ch, scene.id, layer.layerNumber)]
	const idx = rt ?? (ctx.playlistStartIndices || {})[`${scene.id}-${layer.layerNumber}`] ?? 0
	const it = list[Number(idx) || 0]
	return it?.value ? String(it.value) : null
}

/**
 * @param {object} ctx  needs config, programLayerBankByChannel, playlistActiveIndices
 * @param {Record<string, { scene?: object }>} [all]  live scene state (default: the store)
 * @returns {Array<{ key: string, shaderId: string, cgName: string, channel: number, pLayer: number, isPrv: boolean, sceneName: string }>}
 */
function liveShaderInstances(ctx, all = liveSceneState.getAll()) {
	const banks = ctx.programLayerBankByChannel || {}
	const out = []
	for (const chKey of Object.keys(all || {})) {
		const scene = all[chKey]?.scene
		if (!scene || !Array.isArray(scene.layers)) continue
		const ch = parseInt(chKey, 10)
		const prv = isPreview(ctx, ch)
		for (const layer of scene.layers) {
			const value = String(playlistNowValue(ctx, ch, scene, layer) ?? layer?.source?.value ?? '')
			const m = SHADER_VALUE_RE.exec(value)
			if (!m) continue
			const logical = Number(layer.layerNumber)
			const bank = prv ? 'a' : String(banks[chKey] || 'a')
			const pLayer = bank === 'b' ? logical + 100 : logical
			const shaderId = m[2].toLowerCase()
			out.push({
				key: `${shaderId}@${ch}-${pLayer}`,
				shaderId,
				/* Full template path for the CG ADD re-host fallback (same string the engine plays). */
				cgName: value.trim().toLowerCase(),
				channel: ch,
				pLayer,
				isPrv: prv,
				sceneName: String(scene.name || scene.id || ''),
			})
		}
	}
	// PGM instances first so auto-select lands on air.
	out.sort((a, b) => Number(a.isPrv) - Number(b.isPrv) || a.channel - b.channel)
	return out
}

module.exports = { liveShaderInstances, SHADER_VALUE_RE }
