'use strict'

/** Video looks use logical / bank-A physical layers from 10 upward. */
const LOOK_LAYER_MIN = 10

/** PGM layers 1–9 (bank A) and 101–109 (bank B) are reserved for always-on audio / route buses. */
const PGM_AUDIO_TRACK_LAYER_MAX = 9

/** Bank B physical offset (logical N → N + offset on bank b). */
const PGM_BANK_B_OFFSET = 100

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
 * Bank A: 10–99. Bank B: 110–199. Timeline uses 200+ (handled elsewhere).
 * @param {number} L
 */
function isLookPhysicalLayer(L) {
	const n = parseInt(L, 10)
	if (!Number.isFinite(n) || isPgmAudioTrackPhysicalLayer(n)) return false
	return (n >= LOOK_LAYER_MIN && n <= 99) || (n >= PGM_BANK_B_OFFSET + LOOK_LAYER_MIN && n <= 199)
}

module.exports = {
	LOOK_LAYER_MIN,
	PGM_AUDIO_TRACK_LAYER_MAX,
	PGM_BANK_B_OFFSET,
	isPgmAudioTrackPhysicalLayer,
	isPgmAudioTrackPhysicalLayerOnChannel,
	isLookPhysicalLayer,
}
