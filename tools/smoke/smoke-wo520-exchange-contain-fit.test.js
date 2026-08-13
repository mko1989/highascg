'use strict'

/**
 * WO-520 — dropping different media onto a clip that already has a transform.
 *
 * Owner 13.08: *"I want the new media to be confined to the same max size the layer had before
 * keeping the new clips ratio. no crops."*
 *
 * Before this, an exchange preserved the transform VERBATIM (todos19.07.26), so a clip with a
 * different aspect ratio was stretched or squashed into the outgoing clip's rect. The previous rect
 * is now a MAX BOUNDING BOX: scale to fit inside it at the new clip's own ratio, centred, never
 * cropped and never grown past it.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

/** Load the ESM helper without a bundler. */
const fit = new Function(
	read('client/lib/fill-math.js').replace(/export function/g, 'function') +
		'; return containRectPreservingAspect',
)()

const BOX = { x: 100, y: 50, w: 800, h: 400 } // 2:1

test('WO-520: a wider-than-box clip is limited by WIDTH and never exceeds the box', () => {
	const r = fit(BOX, 1920, 1080) // 16:9 into 2:1
	assert.ok(r.w <= BOX.w && r.h <= BOX.h, `must fit inside: ${JSON.stringify(r)}`)
	assert.equal(r.h, 400, 'the 2:1 box is wider than 16:9, so height is the limit')
	assert.ok(Math.abs(r.w / r.h - 1920 / 1080) < 0.01, 'aspect ratio preserved')
})

test('WO-520: a taller-than-box clip is limited by HEIGHT and never exceeds the box', () => {
	const r = fit(BOX, 1080, 1920) // 9:16 into 2:1
	assert.ok(r.w <= BOX.w && r.h <= BOX.h)
	assert.equal(r.h, 400)
	assert.ok(Math.abs(r.w / r.h - 1080 / 1920) < 0.01, 'aspect ratio preserved')
})

test('WO-520: NO CROP — the fitted rect is always within the old bounds', () => {
	for (const [cw, ch] of [
		[1920, 1080],
		[1080, 1920],
		[1000, 500],
		[4096, 400],
		[100, 4000],
	]) {
		const r = fit(BOX, cw, ch)
		assert.ok(r.x >= BOX.x - 1, `left edge inside for ${cw}x${ch}: ${JSON.stringify(r)}`)
		assert.ok(r.y >= BOX.y - 1, `top edge inside for ${cw}x${ch}`)
		assert.ok(r.x + r.w <= BOX.x + BOX.w + 1, `right edge inside for ${cw}x${ch}`)
		assert.ok(r.y + r.h <= BOX.y + BOX.h + 1, `bottom edge inside for ${cw}x${ch}`)
	}
})

test('WO-520: the layer keeps its position — the centre does not move', () => {
	// Within a pixel: an odd fitted width cannot sit exactly centred in an even box at integer
	// coordinates, and rounding to whole pixels matters more than a half-pixel of symmetry.
	for (const [cw, ch] of [
		[1920, 1080],
		[1080, 1920],
		[1234, 567],
	]) {
		const r = fit(BOX, cw, ch)
		assert.ok(
			Math.abs(r.x + r.w / 2 - (BOX.x + BOX.w / 2)) <= 0.5,
			`a deliberately placed layer must not jump (${cw}x${ch}): ${JSON.stringify(r)}`,
		)
		assert.ok(Math.abs(r.y + r.h / 2 - (BOX.y + BOX.h / 2)) <= 0.5)
	}
})

test('WO-520: a matching ratio fills the box exactly', () => {
	assert.deepEqual(fit(BOX, 1000, 500), BOX, 'same 2:1 ratio → unchanged')
})

test('WO-520: it never grows content past the old box', () => {
	const r = fit(BOX, 40, 20) // tiny 2:1 source
	assert.deepEqual(r, BOX, 'the box is a MAX bound; scaling up to it is the documented behaviour')
})

test('WO-520: unknown media size leaves the rect untouched', () => {
	// Guessing here would silently move a live layer.
	assert.deepEqual(fit(BOX, 0, 0), BOX)
	assert.deepEqual(fit(BOX, undefined, undefined), BOX)
})

test('WO-520: the exchange path uses it; the EMPTY-layer path still content-fits to canvas', () => {
	const src = read('client/components/scenes-compose.js')
	assert.match(src, /createApplyExchangeFitForSource/, 'the exchange applier must exist')
	assert.match(src, /isExchange\s*\n?\s*\?\s*applyExchangeFitForSource/, 'and be used on exchange')
	assert.match(src, /: applyNativeFillForSource/, 'an empty layer must still content-fit to canvas')
	// The old behaviour was to do nothing at all on exchange.
	assert.doesNotMatch(src, /isExchange\s*\n?\s*\?\s*Promise\.resolve\(\)/, 'verbatim-transform path is gone')
})

test('WO-520: an exchange with unknown content resolution patches nothing', () => {
	const src = read('client/components/scenes-compose.js')
	const body = /function applyExchangeFitForSource\([\s\S]*?\n\t\}/.exec(src)[0]
	assert.match(body, /if \(!\(contentRes\?\.w > 0 && contentRes\?\.h > 0\)\) return/, 'no guess, no patch')
})
