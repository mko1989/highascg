'use strict'

/**
 * WO-160 — single source of truth for the per-channel physical layer bands.
 *
 * | Band                          | Range     |
 * |-------------------------------|-----------|
 * | Audio / route buses, bank A   | 1–9       |
 * | Look layers, bank A           | 10–99     | logical = physical (consecutive from 10, step 1)
 * | Audio / route buses, bank B   | 101–109   |
 * | Look layers, bank B           | 110–199   | logical + 100
 * | Timelines                     | 210–259   |
 * | PIP overlays                  | 260–979   | 4 slots per content layer, both banks
 * | Editing chrome (WO-339)       | 980–995   | PRV-only, non-persisted; single CG layer 990 today
 * | Global border                 | 996 / 998 |
 * | Hard ceiling                  | < 1000    | Caspar has 999 layers per channel
 */

/** Video looks use logical / bank-A physical layers from 10 upward. */
const LOOK_LAYER_MIN = 10

/** Bank-A look stack upper bound — the 101–109 audio-bus mirror caps bank A at 99 (90 layers/look). */
const LOOK_LAYER_MAX = 99

/** PGM layers 1–9 (bank A) and 101–109 (bank B) are reserved for always-on audio / route buses. */
const PGM_AUDIO_TRACK_LAYER_MAX = 9

/** Bank B physical offset (logical N → N + offset on bank b). */
const PGM_BANK_B_OFFSET = 100

/** Timeline clips play on TIMELINE_LAYER_BASE + layerIndex (WO-160: 200 → 210, clear of look overflow). */
const TIMELINE_LAYER_BASE = 210

/** Timelines are capped to 50 layers (210–259) so they never reach the PIP overlay band at 260. */
const TIMELINE_LAYER_MAX_COUNT = 50

/** PIP overlay band base — compact-indexed slots for both banks (see pip-overlay-utils.js). */
const PIP_OVERLAY_BAND_BASE = 260

/** Max stacked HTML overlays per content layer (WO-160: 8 → 4 to fit both banks < 998). */
const PIP_OVERLAY_MAX_STACK = 4

/** Last layer the PIP band can emit: 260 + 179 * 4 + 3. */
const PIP_OVERLAY_BAND_MAX = 979

/** WO-339 — editing-chrome band (980–995): non-persisted PRV-only decorations while a look is
 * being edited (layer outlines/labels, template/edit_chrome.html). One CG layer today; the band
 * is reserved so PIP overlays (≤979) and the global border (996/998) can never collide with it.
 * Client mirror: client/lib/scenes-preview-edit-chrome.js. */
const EDIT_CHROME_LAYER = 990

/** Caspar allows layers 0–999 per channel — nothing may allocate above this. */
const HARD_MAX_PHYSICAL_LAYER = 999

/**
 * Shared guard: every physical layer the engine emits must stay below the Caspar ceiling.
 * Formula outputs are range-safe by construction, so a throw here is a programming error.
 * @param {number} physicalLayer
 * @param {string} [context] — for the error message (e.g. 'pip-overlay slot')
 * @returns {number} the validated layer
 */
function assertPhysicalLayerBelowCeiling(physicalLayer, context = 'layer') {
	const n = Number(physicalLayer)
	if (!Number.isFinite(n) || n > HARD_MAX_PHYSICAL_LAYER) {
		throw new Error(
			`physical layer ${physicalLayer} exceeds Caspar ceiling ${HARD_MAX_PHYSICAL_LAYER} (${context})`,
		)
	}
	return n
}

function programAndPreviewChannels(cfg) {
	// Lazy require avoids routing ↔ live-audio-input circular import in tests.
	const { getChannelMap } = require('../config/routing')
	const map = getChannelMap(cfg || {})
	return new Set([
		...(map.programChannels || []),
		...(map.previewChannels || []).map((p) => Number(p)).filter((n) => Number.isFinite(n) && n > 0),
	])
}

/**
 * Physical Caspar layers reserved for always-on audio tracks (not part of look stack).
 * Bank A: 1–9. Bank B: 101–109 (logical 1–9 on inactive stack).
 * @param {number} physicalLayer
 */
function isPgmAudioTrackPhysicalLayer(physicalLayer) {
	const n = parseInt(physicalLayer, 10)
	if (!Number.isFinite(n)) return false
	if (n >= 1 && n <= PGM_AUDIO_TRACK_LAYER_MAX) return true
	if (n >= PGM_BANK_B_OFFSET + 1 && n <= PGM_BANK_B_OFFSET + PGM_AUDIO_TRACK_LAYER_MAX) return true
	return false
}

/**
 * Same as {@link isPgmAudioTrackPhysicalLayer} but only on program/preview buses.
 * @param {object} [cfg]
 * @param {number} channel
 * @param {number} physicalLayer
 */
function isPgmAudioTrackPhysicalLayerOnChannel(cfg, channel, physicalLayer) {
	const ch = parseInt(channel, 10)
	if (!Number.isFinite(ch) || !isPgmAudioTrackPhysicalLayer(physicalLayer)) return false
	return programAndPreviewChannels(cfg).has(ch)
}

/**
 * Physical layers owned by look take / transition cleanup (excludes audio track slots 1–9 / 101–109).
 * Bank A: 10–99. Bank B: 110–199. Timelines use 210+ and PIP overlays 260+ (handled elsewhere).
 * WO-160: ranges unchanged — logical numbering became consecutive from 10 (step 1), but bank A
 * physical stays = logical and bank B stays logical + 100.
 * @param {number} L
 */
function isLookPhysicalLayer(L) {
	const n = parseInt(L, 10)
	if (!Number.isFinite(n) || isPgmAudioTrackPhysicalLayer(n)) return false
	return (
		(n >= LOOK_LAYER_MIN && n <= LOOK_LAYER_MAX) ||
		(n >= PGM_BANK_B_OFFSET + LOOK_LAYER_MIN && n <= PGM_BANK_B_OFFSET + LOOK_LAYER_MAX)
	)
}

/**
 * WO-160 one-way migration: renumber a look's logical layerNumbers to consecutive-from-10
 * (10, 11, 12, …) by current ascending layerNumber order. Legacy decade looks (10/20/30)
 * and >99 overflow (100/110/…) fold into the sequence; already-consecutive looks are untouched.
 * Mutates layer objects in place (array order preserved — z-order derives from layerNumber).
 * @param {Array<{ layerNumber?: number | string }>} layers
 * @returns {boolean} true when any layerNumber changed
 */
function renumberLookLayersConsecutive(layers) {
	if (!Array.isArray(layers) || layers.length === 0) return false
	const nums = layers.map((l) => Number(l && l.layerNumber))
	const allFinite = nums.every((n) => Number.isFinite(n))
	if (allFinite && new Set(nums).size === nums.length) {
		const min = Math.min(...nums)
		const max = Math.max(...nums)
		if (min === LOOK_LAYER_MIN && max === LOOK_LAYER_MIN + layers.length - 1) return false
	}
	const sorted = [...layers].sort((a, b) => {
		const na = Number(a && a.layerNumber)
		const nb = Number(b && b.layerNumber)
		const va = Number.isFinite(na) ? na : Number.POSITIVE_INFINITY
		const vb = Number.isFinite(nb) ? nb : Number.POSITIVE_INFINITY
		return va - vb
	})
	let changed = false
	sorted.forEach((l, i) => {
		if (!l || typeof l !== 'object') return
		const next = LOOK_LAYER_MIN + i
		if (Number(l.layerNumber) !== next) {
			l.layerNumber = next
			changed = true
		}
	})
	return changed
}

module.exports = {
	LOOK_LAYER_MIN,
	LOOK_LAYER_MAX,
	PGM_AUDIO_TRACK_LAYER_MAX,
	PGM_BANK_B_OFFSET,
	TIMELINE_LAYER_BASE,
	TIMELINE_LAYER_MAX_COUNT,
	PIP_OVERLAY_BAND_BASE,
	PIP_OVERLAY_MAX_STACK,
	PIP_OVERLAY_BAND_MAX,
	EDIT_CHROME_LAYER,
	HARD_MAX_PHYSICAL_LAYER,
	assertPhysicalLayerBelowCeiling,
	isPgmAudioTrackPhysicalLayer,
	isPgmAudioTrackPhysicalLayerOnChannel,
	isLookPhysicalLayer,
	renumberLookLayersConsecutive,
}
