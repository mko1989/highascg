'use strict'

/**
 * WO-707 — Follow "Auto" (owner 23.10: "how do i enable tracking to move the fixtures. there is follow none in the
 * follow inspector, with no other options, especialy for dev we need an auto"). The Follow list offers the project's
 * markers only, and a person moves a head only through a marker the operator added and the detection pins
 * (detect-pin.js). Auto is one more marker that needs no setup: AUTO_MARKER_ID, written by its own replace pin from
 * the detected person (sticky by track, else nearest the last, else the largest — the same rule), while person
 * detection is on and some head follows it. Until it has been on someone it stays out of the hub (heads on Auto hold
 * instead of swinging to where it was seeded); after that, nobody in view holds it (status 0); with detection off or no
 * head on Auto it leaves the hub, so it never shows as a phantom marker. The operator's own pin (Assist / Replace on a
 * project marker) is untouched: this is a second DetectPin with its own state.
 * WO-708: the multi-person director (auto-director.js) runs one of these per driven marker (A1…A9, Pin 1…9), each
 * fed only its own person, so `{ id, name }` pick the marker; the defaults are WO-707's single Auto marker.
 */

const { DetectPin } = require('./detect-pin')

const AUTO_MARKER_ID = 64999 // below the presenter range (presenters.js MARKER_BASE 65000)
const AUTO_NAME = 'Auto — tracked person'

function createAutoFollow({ id = AUTO_MARKER_ID, name = AUTO_NAME } = {}) {
	let pin = new DetectPin()
	let seen = false // the pin has been on a person since Auto was wanted

	/** @param {{ cfg: object, wanted: boolean, available: boolean, persons: object[], hub: object, planeZ: number, now: number, dt: number }} o */
	function step({ cfg, wanted, available, persons, hub, planeZ, now, dt }) {
		if (!wanted || !cfg?.enabled) {
			if (hub.markers.has(id)) hub.remove(id)
			pin = new DetectPin() // a fresh pick next time
			seen = false
			return
		}
		if (!hub.markers.has(id)) hub.set({ id, name, x: 0, y: 0, z: planeZ || 0, status: 0, source: 'detect' })
		const auto = { ...cfg, pin_mode: 'replace', pin_marker_id: id }
		pin.step({ cfg: auto, available, persons, hub, planeZ, now, dt })
		if (Object.keys(pin.attached()).length) seen = true
		else if (!seen) hub.remove(id)
	}

	return { id, step, attached: () => pin.attached() }
}

module.exports = { createAutoFollow, AUTO_MARKER_ID, AUTO_NAME }
