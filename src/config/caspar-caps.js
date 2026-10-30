'use strict'

/**
 * WO-869 — what the running Caspar binary can draw, as far as the planner cares. One process-wide record, because the
 * planner is called from the generator, the os-layout, the device-view API and the live apply alike; they must all
 * see the same answer or the config would carry a slice window the layout never placed.
 *
 * `screenSlices`: true = the screen consumer takes `<slices>` / `APPLY … SLICES` (the WO-869 fork); false = it does
 * not (stock 2.5.1, the rollback binaries); null = not known yet (no probe answered). The planner treats null as
 * true, so a box that never connected generates what it did before the probe existed.
 *
 * Set by engine/caspar-caps-probe.js on every Caspar (re)connect and by a refused live APPLY.
 */

/** @type {{ screenSlices: boolean|null, source: string, at: number }} */
let caps = { screenSlices: null, source: 'unprobed', at: 0 }

function getCasparCaps() {
	return { ...caps }
}

/** @param {{ screenSlices?: boolean|null, source?: string }} patch */
function setCasparCaps(patch) {
	caps = { ...caps, ...patch, at: Date.now() }
	return getCasparCaps()
}

function resetCasparCaps() {
	caps = { screenSlices: null, source: 'unprobed', at: 0 }
}

/**
 * Read `screenSlices` from INFO <ch> XML. The fork's screen consumer always reports `<slices>n</slices>` in its
 * `<screen>` state (0 when it draws the whole frame); the stock consumer has no such element.
 * @param {string} xml
 * @returns {boolean|null} null when the channel has no screen consumer to tell from
 */
function screenSlicesFromInfoXml(xml) {
	const blocks = String(xml || '').match(/<screen>[\s\S]*?<\/screen>/g) || []
	if (!blocks.length) return null
	return blocks.some((b) => /<slices>\s*-?\d+\s*<\/slices>/.test(b))
}

module.exports = { getCasparCaps, setCasparCaps, resetCasparCaps, screenSlicesFromInfoXml }
