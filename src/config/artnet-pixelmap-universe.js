'use strict'

/**
 * WO-242: universe/spill math for one native `<artnet>` fixture group (a pixelmap screen's whole
 * fixture array is emitted as a single `<fixture fixture-count="cols x rows">`).
 *
 * Faithful reproduction of the deployed consumer's auto-spill rule per
 * docs/WALKTHROUGH_ARTNET_LED_WALL.md ("Universe math / auto-spill", citing
 * `artnet_consumer.cpp:318-333`): sub-fixtures are addressed sequentially from `start-address`;
 * when the *next* one would cross DMX channel 512 it spills whole to `universe+1` at channel 1
 * (same host/port) — a fixture's channel block is never split across two universes.
 *
 * Verified against the walkthrough's own worked examples:
 *  - fixture-channels=3, start-address=1, 8x4=32 fixtures -> 1 universe (96 <= 512).
 *  - fixture-channels=3, start-address=1, 48x27=1296 fixtures -> 8 universes (0-7).
 *
 * @param {{ rows: number, cols: number, channelsPerFixture: number, startAddress?: number, startUniverse?: number }} params
 * @returns {{ totalFixtures: number, channelsPerFixture: number, firstUniverseCapacity: number, capacityPerUniverse: number, universesUsed: number, startUniverse: number, endUniverse: number }}
 */
function computeArtnetUniverseSpill(params) {
	const rows = Math.max(1, Math.floor(Number(params?.rows) || 1))
	const cols = Math.max(1, Math.floor(Number(params?.cols) || 1))
	const channelsPerFixture = Math.max(1, Math.floor(Number(params?.channelsPerFixture) || 3))
	const startAddress = Math.min(512, Math.max(1, Math.floor(Number(params?.startAddress) || 1)))
	const startUniverse = Math.max(0, Math.floor(Number(params?.startUniverse) || 0))

	const totalFixtures = rows * cols
	// Fixtures that fit in one universe starting at DMX channel 1 (whole-fixture, no splitting).
	const capacityPerUniverse = Math.max(1, Math.floor(512 / channelsPerFixture))
	// Fixtures that fit in the *first* universe, offset by the configured start address.
	const firstUniverseCapacity = Math.max(0, Math.floor((512 - (startAddress - 1)) / channelsPerFixture))

	let universesUsed
	if (totalFixtures <= firstUniverseCapacity) {
		universesUsed = 1
	} else {
		const remaining = totalFixtures - firstUniverseCapacity
		universesUsed = 1 + Math.ceil(remaining / capacityPerUniverse)
	}
	const endUniverse = startUniverse + universesUsed - 1

	return {
		totalFixtures,
		channelsPerFixture,
		firstUniverseCapacity,
		capacityPerUniverse,
		universesUsed,
		startUniverse,
		endUniverse,
	}
}

module.exports = { computeArtnetUniverseSpill }
