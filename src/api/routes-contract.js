'use strict'

/**
 * WO-598 C4 — the layer bands both clients need, from the server modules that own them:
 *   GET /api/contract/constants → { version, layers }
 * The web client and the Godot client keep a few compile-time copies (they render before a fetch returns);
 * smoke-wo598-contract-constants fails CI when any copy drifts from this document.
 */

const { JSON_HEADERS, jsonBody } = require('./response')
const R = require('../engine/look-layer-ranges')
const { GLOBAL_BORDER_LAYER_PGM_A, GLOBAL_BORDER_LAYER_PGM_B } = require('../engine/global-border')
const { GLOBAL_BORDER_LAYER_PRV_MIRROR } = require('../engine/global-border-control')
const MV = require('../engine/multiview-apply')
const { STACK_LAYER_MIN, STACK_LAYER_MAX } = require('./routes-shader-stack')
const { LIVE_AUDIO_LAYER_BASE } = require('../config/live-audio-input')

const CONTRACT_VERSION = 1

/** @returns {{ version: number, layers: object }} */
function contractConstants() {
	return {
		version: CONTRACT_VERSION,
		layers: {
			pgmAudioTrackMax: R.PGM_AUDIO_TRACK_LAYER_MAX,
			bankBOffset: R.PGM_BANK_B_OFFSET,
			look: { min: R.LOOK_LAYER_MIN, max: R.LOOK_LAYER_MAX },
			audioOnlyLook: R.AUDIO_ONLY_LOOK_LAYER,
			timeline: { base: R.TIMELINE_LAYER_BASE, maxCount: R.TIMELINE_LAYER_MAX_COUNT },
			pipOverlay: { base: R.PIP_OVERLAY_BAND_BASE, maxStack: R.PIP_OVERLAY_MAX_STACK, max: R.PIP_OVERLAY_BAND_MAX },
			editChrome: R.EDIT_CHROME_LAYER,
			globalBorder: { pgmA: GLOBAL_BORDER_LAYER_PGM_A, pgmB: GLOBAL_BORDER_LAYER_PGM_B, prvMirror: GLOBAL_BORDER_LAYER_PRV_MIRROR },
			hardMax: R.HARD_MAX_PHYSICAL_LAYER,
			liveAudioInput: LIVE_AUDIO_LAYER_BASE,
			shaderStack: { min: STACK_LAYER_MIN, max: STACK_LAYER_MAX },
			multiview: { bg: MV.MV_BG_LAYER, cellStart: MV.MV_CELL_LAYER_START, overlay: MV.OVERLAY_LAYER, max: MV.MAX_MV_LAYERS },
		},
	}
}

/** @param {any} routes */
function register(routes) {
	routes.get('/api/contract/constants', () => ({ status: 200, headers: JSON_HEADERS, body: jsonBody(contractConstants()) }), { requireCaspar: false })
}

module.exports = { register, contractConstants }
