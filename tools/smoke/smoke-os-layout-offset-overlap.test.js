'use strict'

/* Regression: two xrandr outputs were assigned the same origin, so they scanned out identical
 * pixels and the operator GUI appeared on the PGM2 monitor as well as its own (highascg7579).
 *
 * computePlacedLayoutResults lays heads out left-to-right from a running cumulativeX, so a head
 * that follows another already carries the correct relative offset. applyMappingGpuPlacementOffsets
 * then moves everything right of the pixel-mapping bbox. Screens were SHIFTED (`x += offX`) but
 * multiview/prv heads were CLAMPED (`x = max(x, offX)`), which discards that relative offset and
 * parks the head exactly on the bbox edge — where the first shifted screen also lands.
 *
 * Screens and multiview must use the same relative move, or spacing computed upstream is lost. */

const assert = require('assert')
const { applyMappingGpuPlacementOffsets } = require('../../src/utils/os-layout-calculator-offset')

const BBOX = { minX: 0, minY: 0, maxX: 6144, maxY: 1536 }
const MAPPING_OUTPUTS = [{ sysId: 'DP-4' }, { sysId: 'DP-6' }]

const head = (x, extra) => ({ x, y: 0, width: 1920, height: 1080, ...(extra || {}) })

function place(config, results, { bbox = BBOX, outputs = MAPPING_OUTPUTS, operator = new Map(), bound = true } = {}) {
	applyMappingGpuPlacementOffsets(config, results, bbox, outputs, operator, bound)
	return results
}

function originsOf(results) {
	return [
		...Object.values(results.screens || {}),
		...Object.values(results.multiview || {}),
		...Object.values(results.prv || {}),
	].map((i) => `${i.x},${i.y}`)
}

/* The live highascg7579 shape: screen_2 at cumulative 0, operator_gui head at cumulative 1920,
 * both to the right of a 6144-wide mapping bbox. */
{
	const results = { screens: { 2: head(0) }, multiview: { 1: head(1920) }, prv: {} }
	place({}, results)
	assert.strictEqual(results.screens[2].x, 6144, 'screen_2 shifts to the bbox edge')
	assert.strictEqual(results.multiview[1].x, 8064, 'multiview keeps its 1920 offset past screen_2')
	const origins = originsOf(results)
	assert.strictEqual(new Set(origins).size, origins.length, `overlapping origins: ${origins.join(' ')}`)
}

/* A PRV head carries its offset the same way. */
{
	const results = { screens: { 1: head(0) }, multiview: { 1: head(1920) }, prv: { 1: head(3840) } }
	place({}, results)
	assert.deepStrictEqual(
		[results.screens[1].x, results.multiview[1].x, results.prv[1].x],
		[6144, 8064, 9984],
		'screen, multiview and prv stay 1920 apart after the offset',
	)
}

/* A single multiview head with nothing before it still lands on the bbox edge, not past it —
 * the old clamp and the shift agree here, which is why this case never surfaced the bug. */
{
	const results = { screens: {}, multiview: { 1: head(0) }, prv: {} }
	place({}, results)
	assert.strictEqual(results.multiview[1].x, 6144, 'lone multiview head sits at the bbox edge')
}

/* Manual overrides still win outright and are never shifted. */
{
	const results = { screens: { 2: head(0) }, multiview: { 1: head(1920) }, prv: {} }
	place({ multiview_1_os_x: 200 }, results)
	assert.strictEqual(results.multiview[1].x, 1920, 'a manual multiview x is left untouched')

	const legacy = { screens: {}, multiview: { 1: head(1920) }, prv: {} }
	place({ multiview_os_x: 200 }, legacy)
	assert.strictEqual(legacy.multiview[1].x, 1920, 'the legacy multiview_os_x key also pins the head')

	const prvPinned = { screens: {}, multiview: {}, prv: { 1: head(1920) } }
	place({ screen_1_prv_os_x: 200 }, prvPinned)
	assert.strictEqual(prvPinned.prv[1].x, 1920, 'a manual prv x is left untouched')
}

/* Operator overrides with no destination binding skip the WO-40a auto-offset entirely. */
{
	const results = { screens: { 2: head(0) }, multiview: { 1: head(1920) }, prv: {} }
	place({}, results, { operator: new Map([[1, { sysId: 'DP-2' }]]), bound: false })
	assert.strictEqual(results.screens[2].x, 0, 'screens untouched when the auto-offset is skipped')
	assert.strictEqual(results.multiview[1].x, 1920, 'multiview untouched when the auto-offset is skipped')
}

/* A taller-than-wide bbox stacks vertically; x must not move on that path. */
{
	const tall = { minX: 0, minY: 0, maxX: 1920, maxY: 4320 }
	const results = { screens: { 1: head(0) }, multiview: { 1: head(1920) }, prv: {} }
	place({}, results, { bbox: tall })
	assert.strictEqual(results.screens[1].y, 4320, 'screens stack below the bbox')
	assert.strictEqual(results.multiview[1].y, 4320, 'multiview stacks below the bbox')
	assert.strictEqual(results.multiview[1].x, 1920, 'x is untouched on the vertical path')
}

console.log('smoke-os-layout-offset-overlap: ok')
