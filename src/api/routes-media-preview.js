/**
 * WO-592 — media-inspector preview on the kiosk. Browsers can't decode most of the library
 * (NotchLC/HAP/ProRes), so the kiosk previews through Caspar itself: the clip is LOADed onto the
 * operator-GUI channel's MEDIA_PREVIEW_LAYER and shows through a hole the inspector reports
 * (role 'media' cell — src/system/operator-gui-media-layer.js positions/clears it).
 * The GUI channel has a screen consumer only, so the preview is silent; it never touches PGM/PRV.
 *
 *   POST /api/media/preview  { action: 'load', id }            → { ok, channel, layer, clip }
 *                            { action: 'play' | 'pause' | 'stop' }
 *                            { action: 'seek', seconds }   — SEEK counts CHANNEL frames on this build
 *                              (probed 04.10: SEEK 100/200 on the 50p GUI channel → 2 s/4 s of a 30p clip)
 */
'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { resolveOperatorGuiChannel, MEDIA_PREVIEW_LAYER } = require('../system/operator-gui-channel-geometry')
const { clearMediaPreviewLayer } = require('../system/operator-gui-media-layer')
const { resolveSceneClipForAmcp } = require('../engine/scene-take-lbg-helpers')
const { operatorGuiModeDimensions } = require('../config/config-generator-channel-plan')

const err = (status, error) => ({ status, headers: JSON_HEADERS, body: jsonBody({ error }) })

/**
 * @param {string|object} body
 * @param {{ amcp?: object, config?: object, log?: Function }} ctx
 */
async function handleMediaPreviewPost(body, ctx) {
	const b = parseBody(body) || {}
	const gui = resolveOperatorGuiChannel(ctx.config || {})
	if (!gui) return err(409, 'No operator screen configured — kiosk preview unavailable')
	if (!ctx.amcp) return err(503, 'Caspar not connected')
	const ch = gui.ch
	const layer = MEDIA_PREVIEW_LAYER
	const action = String(b.action || '')
	try {
		if (action === 'load') {
			const id = String(b.id || '').trim()
			if (!id || id.includes('..')) return err(400, 'id required')
			const clip = resolveSceneClipForAmcp(id, ctx)
			await ctx.amcp.basic.load(ch, layer, clip, {}) // no flat `load` alias on AmcpClient
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, channel: ch, layer, clip }) }
		}
		if (action === 'play') await ctx.amcp.resume(ch, layer)
		else if (action === 'pause') await ctx.amcp.pause(ch, layer)
		else if (action === 'seek') {
			const chFps = Number(operatorGuiModeDimensions(gui.dest)?.fps) || 50
			const f = Math.max(0, Math.round((Number(b.seconds) || 0) * chFps))
			await ctx.amcp.call(ch, layer, 'SEEK', String(f))
		} else if (action === 'stop') await clearMediaPreviewLayer(ctx, ch)
		else return err(400, `unknown action: ${action}`)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, channel: ch, layer }) }
	} catch (e) {
		ctx.log?.('warn', `[media-preview] ${action} ${ch}-${layer} failed: ${e?.message || e}`)
		return err(502, e?.message || `${action} failed`)
	}
}

module.exports = { handleMediaPreviewPost }
