'use strict'

/**
 * WO-600 F (WO-598 thin client) — POST /api/scene/new-layer { sceneId, source: {type?, value, label?, resolution?}, mainIdx? }
 *
 * Returns the layer a media drop creates in the web compose frame (client/components/scenes-compose.js
 * addLayerFromMedia): addLayer → next free layer number ≥ 10 (scene-state-helpers nextLayerNumber) +
 * defaultLayerConfig + editor scene defaults (applySceneLayerDefaults) → setLayerSource (images never loop)
 * → native fill for the layer's content fit (fill-math sceneLayerPixelRectForContentFit → pixelRectToFill).
 * The pure client modules are imported (one implementation). The file's trim/mute defaults ARE applied (WO-592
 * owner decision; the web compose drop skipped them — fixed there as WO-611 #5). Nothing is stored — the client appends the
 * layer and saves it like any edit (deck sync → preview-push → autosave).
 * WO-622: route sources (the Godot Sources "Live" tab — PGM/PRV, DeckLink / audio / USB inputs) go through the web's
 * WO-156 rule (input-channels.js routeDropRejectionMessage: no whole-channel route into this main's own PGM / PRV, no
 * route onto its own channel-layer) with the look-stack channels the web compose resolves (look-stack-amcp-channel.js,
 * active main = mainIdx), and fit to the routed channel's resolution (mixer-fill.js getContentResolution).
 * A `live_audio` source starts at opacity 0 like the web drop.
 */

const path = require('path')
const { pathToFileURL } = require('url')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { REPO_ROOT } = require('../repo-paths')

const IMAGE_RE = /\.(jpe?g|png|gif|bmp|webp|tiff?)$/i
let _libs = null

async function libs() {
	if (!_libs) {
		const load = (n) => import(pathToFileURL(path.join(REPO_ROOT, 'client', 'lib', n)).href)
		const [helpers, fill, ed, inputs, stack, mixer] = await Promise.all(
			['scene-state-helpers.js', 'fill-math.js', 'editor-defaults-constants.js', 'input-channels.js', 'look-stack-amcp-channel.js', 'mixer-fill.js'].map(load),
		)
		_libs = { helpers, fill, ed, inputs, stack, mixer }
	}
	return _libs
}

function out(status, payload) {
	return { status, headers: JSON_HEADERS, body: jsonBody(payload) }
}

/**
 * source.resolution → server media details (routes / live audio: the channel map) → ffprobe of the file on disk
 * (web fetchMediaContentResolution order).
 */
async function defaultMediaResolution(ctx, source, map = {}, mainIdx = 0) {
	const { parseResolutionString, getMediaResolutionFromSelf } = require('../engine/scene-native-fill')
	let r = source.resolution ? parseResolutionString(source.resolution) : null
	const t = String(source.type || '')
	if (!(r?.w > 0) && (t === 'route' || t === 'live_audio' || String(source.value).startsWith('route://'))) {
		r = (await libs()).mixer.getContentResolution(source, { getState: () => ({ channelMap: map }) }, mainIdx)
	}
	if (!(r?.w > 0)) r = getMediaResolutionFromSelf(ctx, source.value)
	if (!(r?.w > 0)) {
		try {
			const fp = require('../media/local-media').resolveMediaFileOnDisk(ctx?.config || {}, source.value)
			if (fp) {
				const p = await require('../media/local-media-ffmpeg').probeMedia(fp)
				if (p?.resolution) r = parseResolutionString(p.resolution)
			}
		} catch {
			/* not on disk / no ffprobe */
		}
	}
	return r?.w > 0 && r?.h > 0 ? r : null
}

/**
 * @param {unknown} body
 * @param {object} ctx
 * @param {object} [deps] tests: resolveScene, getChannelMap, editorDefaults, mediaResolution
 */
async function handleNewLayer(body, ctx, deps = {}) {
	const b = parseBody(body)
	const sceneId = String(b.sceneId || '').trim()
	const src = b.source && typeof b.source === 'object' ? b.source : null
	if (!sceneId || !src || !String(src.value || '').trim()) return out(400, { ok: false, error: 'sceneId and source.value required' })
	const scene = deps.resolveScene ? deps.resolveScene(sceneId) : require('../engine/project-scenes-transform').resolveLiveSceneById(ctx, sceneId)
	if (!scene) return out(404, { ok: false, error: `look ${sceneId} not found` })
	const r = await buildLayerForSource(ctx, scene, src, b.mainIdx, deps)
	if (r.error) return out(r.status, { ok: false, error: r.error })
	return out(200, { ok: true, layer: r.layer, mainIdx: r.mainIdx, contentResolution: r.contentResolution })
}

/**
 * The layer `src` becomes on `scene` (shared with WO-623 POST /api/scene/new-look).
 * @returns {Promise<{ layer?: object, mainIdx?: number, contentResolution?: object|null, status?: number, error?: string }>}
 */
async function buildLayerForSource(ctx, scene, src, mainIdxIn, deps = {}) {
	const type = String(src.type || 'media')
	const { helpers, ed, inputs, stack } = await libs()
	const n = helpers.nextLayerNumber(scene)
	if (n < 0) return { status: 409, error: helpers.LOOK_FULL_MESSAGE }
	// the config-only map has no programResolutions: without them every fit assumed a 1920×1080 canvas
	const getMap = deps.getChannelMap || (() => require('../engine/scene-take-payload').withProgramResolutions(require('../config/routing').getChannelMap(ctx?.config || {}, ctx?.switcherOutputBusByChannel) || {}, ctx))
	const map = getMap()
	const scope = parseInt(String(scene.mainScope ?? ''), 10)
	const mainIdx = Number.isFinite(Number(mainIdxIn)) ? Math.max(0, Math.floor(Number(mainIdxIn))) : Number.isFinite(scope) ? scope : 0
	if (type === 'route' || String(src.value).startsWith('route://')) {
		const active = { activeScreenIndex: mainIdx }
		const why = inputs.routeDropRejectionMessage(src.value, {
			editChannel: stack.resolveLookStackChannelForBus(map, active, scene, 'edit'),
			pgmChannel: stack.resolveLookStackChannelForBus(map, active, scene, 'pgm'),
			targetLayerNumber: n,
		})
		if (why) return { status: 400, error: why }
	}
	const layer = helpers.defaultLayerConfig(n)
	const defaults = ed.mergeEditorDefaults(deps.editorDefaults ? deps.editorDefaults() : ctx?.config?.editorDefaults).scene
	layer.loop = !!defaults.loop
	layer.startBehaviour = defaults.startBehaviour === 'relativeToPrevious' ? 'relativeToPrevious' : 'beginning'
	layer.contentFit = defaults.contentFit
	layer.source = { ...src, type, value: String(src.value), label: src.label || String(src.value) }
	if (IMAGE_RE.test(String(src.value))) layer.loop = false
	if (type === 'live_audio') layer.opacity = 0
	/* WO-592 owner decision (04.10): a dropped clip brings its file's trim/mute defaults — via the web's own
	 * withMediaFileDefaults (the web compose drop missed this until WO-611 #5). */
	const fileDefaults = deps.fileDefaults ? deps.fileDefaults(String(src.value)) : require('../media/media-library-registry').getEntryByPath(String(src.value))?.defaults
	if (fileDefaults && typeof fileDefaults === 'object') {
		const mfd = await import(pathToFileURL(path.join(REPO_ROOT, 'client', 'lib', 'media-file-defaults.js')).href)
		mfd.setLocalMediaFileDefaults(String(src.value), fileDefaults)
		Object.assign(layer, mfd.fileDefaultsPatchForNewSource(layer.source))
	}

	const res = map.programResolutions?.[mainIdx] || map.programResolutions?.[0] || {}
	const canvas = { width: Number(res.w) > 0 ? Number(res.w) : 1920, height: Number(res.h) > 0 ? Number(res.h) : 1080 }
	const fit = await fitFillForSource(ctx, layer.source, layer.contentFit, canvas, deps.mediaResolution, map, mainIdx)
	if (fit.fill) layer.fill = fit.fill
	return { layer, mainIdx, contentResolution: fit.contentResolution }
}

/**
 * Web reapplyLayerFrameForContentFit / applyNativeFillForSource: fill for `contentFit` from the source's
 * resolution on `canvas`; `fill: null` when the resolution is unknown (caller keeps the current fill).
 */
async function fitFillForSource(ctx, source, contentFit, canvas, mediaResolution = null, map = {}, mainIdx = 0) {
	const { fill } = await libs()
	const contentRes = await (mediaResolution ? mediaResolution(source) : defaultMediaResolution(ctx, source, map, mainIdx))
	if (!contentRes) return { fill: null, contentResolution: null }
	const rect = fill.sceneLayerPixelRectForContentFit(canvas.width, canvas.height, contentRes.w, contentRes.h, contentFit || 'native')
	return { fill: fill.pixelRectToFill(rect, canvas), contentResolution: contentRes }
}

module.exports = { handleNewLayer, buildLayerForSource, fitFillForSource, libs }
