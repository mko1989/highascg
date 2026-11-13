'use strict'
/**
 * WO-1055 — GET /api/audio/alsa-cards?dir=capture|playback: the sound cards for the LTC in / out Device dropdowns, each named
 * by its stable ALSA id (`plughw:CARD=USB,DEV=0`). Own file: routes-audio.js sits at the 500-line limit.
 */
const { listAlsaCards } = require('../audio/audio-devices')

/** @param {Record<string, string>|null|undefined} query */
function handleAlsaCards(query) {
	const dir = query && query.dir === 'capture' ? 'capture' : 'playback'
	return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(listAlsaCards(dir)) }
}

module.exports = { handleAlsaCards }
