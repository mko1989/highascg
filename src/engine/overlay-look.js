/**
 * WO-860 — overlay looks. A look whose every sourced layer is template CG on the 700+ overlay band (lower thirds and
 * the like; shaders composite on the look band, WO-322, and do not count) is taken OVER the on-air look: its
 * templates play on their CG hosts and the look band, the bank pointer and the screen's live look stay as they were
 * (owner 30.10: "they should not change the pgm but rather display over it on a cg layer"). A look that also carries
 * a video source is a normal look and takes the normal way.
 *
 * PGM overlays on air are tracked in overlay-look-live.js: their hosts survive a later normal take (scene-take-lbg.js
 * adds them to its incoming-template set; a normal look that declares the same host takes it over), they are cleared
 * once played out (the lower third's hold duration) and the deck's stop button plays them out.
 *
 * Lower thirds animate themselves out after `displayDurationSec`. On a preview bus that only hides what the operator
 * is editing (the look editor shows PRV), so PRV staging holds them (`holdLowerThirdCgData`) — for overlay and
 * normal looks alike.
 */

'use strict'

const { layerHasContent, normalizeTransition } = require('./scene-transition')
const {
	isSceneTemplateLayer,
	buildSceneTemplateCgSpec,
	buildSceneTemplateCgAmcpLines,
	resolveTemplateCgHostLayer,
} = require('./scene-template-cg')
const { isShaderCgName, isLowerThirdCgName, TEMPLATE_CG_OVERLAY_LAYER_BASE } = require('./cg-routing')
const { getResolvedFillForSceneLayer } = require('./scene-native-fill')
const live = require('./overlay-look-live')

/**
 * The CG host an overlay layer plays on, or null when the layer is not overlay template CG.
 * @param {object} layer
 * @param {object} [ctx]
 * @returns {number|null}
 */
function overlayHostOfLayer(layer, ctx) {
	const id = layer?.source?.value
	if (!isSceneTemplateLayer(layer, id, ctx)) return null
	const spec = buildSceneTemplateCgSpec(layer, id, ctx)
	if (!spec || isShaderCgName(spec.cgName)) return null
	const host = resolveTemplateCgHostLayer(layer.layerNumber, spec.cgName)
	return host >= TEMPLATE_CG_OVERLAY_LAYER_BASE ? host : null
}

/**
 * @param {object} scene
 * @param {object} [ctx]
 * @returns {boolean}
 */
function isOverlayLook(scene, ctx) {
	if (!scene || scene.audioOnlyLook || !Array.isArray(scene.layers)) return false
	const sourced = scene.layers.filter(layerHasContent)
	return sourced.length > 0 && sourced.every((l) => overlayHostOfLayer(l, ctx) != null)
}

function _hold(o) {
	if (o && typeof o === 'object' && !Array.isArray(o)) o.displayDurationSec = 0
}

/**
 * A lower third's CG JSON with every auto-out timer set to 0 ("hold until stop", lt-engine.js). The engine reads the
 * duration from `style` and lets the active `data` step override it, so all three places are set.
 * @param {string} data — the CG JSON string
 * @param {string} cgName
 * @returns {string}
 */
function holdLowerThirdCgData(data, cgName) {
	if (!isLowerThirdCgName(cgName)) return data
	let o
	try {
		o = JSON.parse(data || '{}')
	} catch {
		return data
	}
	if (!o || typeof o !== 'object' || Array.isArray(o)) return data
	_hold(o)
	if (o.style && typeof o.style === 'object') _hold(o.style)
	else o.style = { displayDurationSec: 0 }
	for (const step of Array.isArray(o.data) ? o.data : [o.data]) _hold(step)
	return JSON.stringify(o)
}

/**
 * Lines that play an overlay look's templates on `channel` (no AMCP is sent).
 * @param {{ channel: number, scene: object, self: object, preview?: boolean, forceCut?: boolean }} opts
 * @returns {Promise<{ lines: string[], hosts: number[], holds: number[] }>} holds: seconds each template stays up (0 = held)
 */
async function buildOverlayLookLines({ channel, scene, self, preview = false, forceCut = false }) {
	const t = normalizeTransition(scene?.defaultTransition, forceCut || preview)
	const fadeDur = forceCut || preview || !(t.duration > 0) ? 0 : t.duration
	const fade = fadeDur > 0 ? { fadeDurFrames: fadeDur, fadeTween: t.tween } : {}  // the look's transition fades the CG host in
	const lines = []
	const hosts = []
	const holds = []
	const sorted = scene.layers.filter(layerHasContent).sort((a, b) => (a.layerNumber || 0) - (b.layerNumber || 0))
	for (const layer of sorted) {
		const spec = buildSceneTemplateCgSpec(layer, layer.source.value, self)
		if (!spec) continue
		if (preview) spec.data = holdLowerThirdCgData(spec.data, spec.cgName)
		const fill = await getResolvedFillForSceneLayer(self, layer, channel, scene)
		lines.push(...buildSceneTemplateCgAmcpLines(channel, layer.layerNumber, spec, { ...fade, fill }))
		hosts.push(resolveTemplateCgHostLayer(layer.layerNumber, spec.cgName))
		holds.push(live.templateHoldSec(spec.cgName, spec.data))
	}
	return { lines, hosts, holds }
}

/**
 * Play an overlay look on `channel`. On a PGM channel it goes on air (overlay-look-live.js): taken out after its hold.
 * @param {{ amcp: object, channel: number, scene: object, self: object, preview?: boolean, forceCut?: boolean }} opts
 */
async function takeOverlayLook(opts) {
	const { amcp, channel, scene, self, preview = false } = opts
	const { lines, hosts, holds } = await buildOverlayLookLines(opts)
	const { sendPipOverlayLinesSerial } = require('./pip-overlay')
	await sendPipOverlayLinesSerial(amcp, lines)
	const holdSec = live.lookHoldSec(holds)
	if (!preview) live.markOverlayLive({ amcp, self, channel, sceneId: String(scene?.id ?? ''), hosts, holdSec })
	self?.log?.(
		'info',
		`[overlay-look] ${preview ? 'PRV' : 'PGM'} ch=${channel} look=${scene?.id} hosts=${hosts.join(',')}` +
			(preview ? '' : ` hold=${holdSec > 0 ? `${holdSec}s` : 'until stop'}`),
	)
	return { lines, hosts, holds }
}

module.exports = {
	isOverlayLook,
	holdLowerThirdCgData,
	buildOverlayLookLines,
	takeOverlayLook,
	pgmOverlayHosts: live.pgmOverlayHosts,
	releasePgmOverlayHosts: live.releasePgmOverlayHosts,
}
