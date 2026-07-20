/**
 * Wheel event normalization with touchpad scroll inversion.
 * Resolves WO-286: inverted two-finger scroll for laptop touchpads.
 *
 * All custom zoom/pan handlers in client/ route through this single point
 * to normalize deltaX/deltaY and apply the inversion preference.
 * Native list/panel scrolling (browser-default scroll) is unaffected.
 */

import { settingsState } from './settings-state.js'

/**
 * Normalize a wheel event to {dx, dy}, applying inversion when the
 * "Invert touchpad scroll" preference is on.
 *
 * @param {WheelEvent} event - raw wheel event from the browser
 * @returns {{dx: number, dy: number}} - normalized deltas, inverted if preference is on
 */
export function getWheelDelta(event) {
	let dx = event.deltaX
	let dy = event.deltaY

	const settings = settingsState.getSettings()
	const shouldInvert = settings?.ui?.invertTouchpadScroll === true

	if (shouldInvert) {
		dx = -dx
		dy = -dy
	}

	return { dx, dy }
}
