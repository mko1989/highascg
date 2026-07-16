'use strict'

/**
 * WO-250 T250.4 smoke.
 *
 * Issue A (web-UI timers "fight between screens/layers"): `pickTopLayerStateForPlayback`
 * (`client/components/playback-timer.js`) used to pick the highest-numbered layer on the
 * WHOLE channel regardless of which bank (A: 10-99, B: 110-199) was actually live. After a
 * take, the losing bank's frozen layer lingers up to 10s (`src/osc/osc-state.js`
 * `_pruneStaleLayers`, default `src/osc/osc-config.js:37`) and briefly outranks the live
 * bank's layer ("gibberish" latch/jump). T250.1 restricts the pick to the active bank's
 * range and skips layers whose OSC is stale relative to the snapshot clock.
 *
 * Issue B (MV progress bars gone): `template/multiview_master.html` (the active MV template)
 * drew the progress bar a full `rowStep` below the label/time and separately gated it on
 * `ty + 2 <= maxY` — on short docks / >=2 rows the bar silently clipped while the digits
 * above it still fit. T250.2 reserves the bar INSIDE the row's own budget so digits+bar
 * always render together. T250.3 covers an independent candidate cause: some builds report
 * `file/time` duration as 0/absent even when `file/frame` + `file/fps` are known; osc-state
 * now derives duration from them (rollback-safe: real duration always wins).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '../../')

const { pickTopLayerStateForPlayback } = require('../../client/components/playback-timer.js')
const { OscState } = require('../../src/osc/osc-state')

function makeOscState(overrides) {
	return new OscState(
		() => {},
		Object.assign(
			{ peakHoldMs: 1000, staleTimeoutMs: 0, layerStaleTimeoutMs: 0, emitIntervalMs: 50, wsDeltaBroadcast: false },
			overrides,
		),
	)
}

describe('WO-250 T250.1 — bank-aware, stale-aware top-layer pick', () => {
	it("bank 'b' active: stale L10 (bank A leftover) + live L110 (bank B) -> picks 110", () => {
		const now = Date.now()
		const channelState = {
			layers: {
				10: { _lastOscAt: now - 20000, file: { name: 'old-a.mov', duration: 5, elapsed: 2 } },
				110: { _lastOscAt: now, file: { name: 'new-b.mov', duration: 5, elapsed: 1 } },
			},
		}
		const result = pickTopLayerStateForPlayback(channelState, { bank: 'b', nowTs: now })
		assert.equal(result.layerNum, 110, 'must pick the live bank-B layer, not the out-of-bank/stale L10')
	})

	it("bank 'a' active: live L10 + lingering L110 (bank B leftover, not yet pruned) -> picks 10", () => {
		const now = Date.now()
		const channelState = {
			layers: {
				10: { _lastOscAt: now, file: { name: 'live-a.mov', duration: 5, elapsed: 1 } },
				// Server hasn't pruned this yet (< layerStaleTimeoutMs), but it's the wrong bank for 'a'.
				110: { _lastOscAt: now - 3000, file: { name: 'stale-b.mov', duration: 5, elapsed: 4 } },
			},
		}
		const result = pickTopLayerStateForPlayback(channelState, { bank: 'a', nowTs: now })
		assert.equal(result.layerNum, 10, "the losing bank's lingering higher layer must not outrank the live bank-A layer")
	})

	it('within the same bank range, a stale layer is skipped in favor of a live lower-numbered layer', () => {
		const now = Date.now()
		const channelState = {
			layers: {
				// Stale relative to nowTs (older than the 12s guard window) even though it's the higher number.
				20: { _lastOscAt: now - 20000, file: { name: 'stale-20.mov', duration: 5, elapsed: 4 } },
				15: { _lastOscAt: now, file: { name: 'live-15.mov', duration: 5, elapsed: 1 } },
			},
		}
		const result = pickTopLayerStateForPlayback(channelState, { bank: 'a', nowTs: now })
		assert.equal(result.layerNum, 15, 'stale layer 20 must be skipped even though 20 > 15')
	})

	it('timer band (980-989) and border (998) layers are never picked, even with no other candidates', () => {
		const now = Date.now()
		const channelState = {
			layers: {
				985: { _lastOscAt: now, file: { name: 'timer-band.mov', duration: 5, elapsed: 1 } },
				998: { _lastOscAt: now, file: { name: 'border.mov', duration: 5, elapsed: 1 } },
			},
		}
		const result = pickTopLayerStateForPlayback(channelState, { bank: 'a', nowTs: now })
		assert.equal(result.layerNum, null, 'timer band 980-989 and border 998 must be excluded')
	})

	it('PRV / bankless channel (no bank opt) defaults to the 10-99 range', () => {
		const now = Date.now()
		const channelState = {
			layers: {
				15: { _lastOscAt: now, file: { name: 'prv.mov', duration: 5, elapsed: 1 } },
				115: { _lastOscAt: now, file: { name: 'should-be-ignored.mov', duration: 5, elapsed: 1 } },
			},
		}
		const result = pickTopLayerStateForPlayback(channelState, { nowTs: now })
		assert.equal(result.layerNum, 15, 'no bank -> 10-99 default range, 110-199 candidate excluded')
	})
})

describe('WO-250 T250.3 — osc-state duration fallback from frameTotal/fps', () => {
	it('file/time duration 0 + frameTotal/fps known -> duration derived', () => {
		const os = makeOscState()
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/file/frame', args: [125, 250] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/file/fps', args: [25] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/file/time', args: [5.0, 0] })

		const layer = os.getSnapshot().channels[1].layers[10]
		assert.equal(layer.file.elapsed, 5.0)
		assert.equal(layer.file.duration, 10, '250 frames / 25 fps = 10s')
		assert.ok(Math.abs(layer.file.remaining - 5) < 1e-9)
	})

	it('file/time omits duration entirely + frameTotal/fps known -> duration derived', () => {
		const os = makeOscState()
		os.handleOscMessage({ address: '/channel/1/stage/layer/20/file/frame', args: [40, 200] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/20/file/fps', args: [50] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/20/file/time', args: [0.8] })

		const layer = os.getSnapshot().channels[1].layers[20]
		assert.equal(layer.file.elapsed, 0.8)
		assert.equal(layer.file.duration, 4, '200 frames / 50 fps = 4s')
	})

	it('real duration from file/time wins, untouched, over frameTotal/fps derivation', () => {
		const os = makeOscState()
		os.handleOscMessage({ address: '/channel/1/stage/layer/11/file/frame', args: [50, 999] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/11/file/fps', args: [25] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/11/file/time', args: [2.0, 8.0] })

		const layer = os.getSnapshot().channels[1].layers[11]
		assert.equal(layer.file.duration, 8.0, 'real duration (8.0) must win, not 999/25=39.96')
	})

	it('fps 0 does not crash and does not derive a duration', () => {
		const os = makeOscState()
		assert.doesNotThrow(() => {
			os.handleOscMessage({ address: '/channel/1/stage/layer/12/file/frame', args: [10, 500] })
			os.handleOscMessage({ address: '/channel/1/stage/layer/12/file/fps', args: [0] })
			os.handleOscMessage({ address: '/channel/1/stage/layer/12/file/time', args: [1.0, 0] })
		})

		const layer = os.getSnapshot().channels[1].layers[12]
		assert.equal(layer.file.elapsed, 1.0)
		// 2026-07-16: a file/time duration of 0 is now treated as ABSENT, not stored as literal 0 —
		// storing 0 clobbered the INFO-supplied duration every tick (the "7 thousand seconds" bug).
		// fps 0 still must not DERIVE a duration; the result is simply no positive duration.
		assert.ok(!(layer.file.duration > 0), 'fps 0 must not derive a duration; a 0 file/time duration stays absent')
	})
})

describe('WO-250 T250.2 — MV master/overlay progress-bar template parity', () => {
	const masterFile = path.join(repoRoot, 'template/multiview_master.html')
	const overlayFile = path.join(repoRoot, 'template/multiview_overlay.js')
	const masterContent = fs.readFileSync(masterFile, 'utf8')
	const overlayContent = fs.readFileSync(overlayFile, 'utf8')

	it('both templates gate the progress bar on the identical hasRuntime condition', () => {
		const hasRuntimeExpr = 'const hasRuntime = Number.isFinite(duration) && duration > 0 && !isStale;'
		assert.ok(masterContent.includes(hasRuntimeExpr), 'master.html must define hasRuntime with the shared condition')
		assert.ok(overlayContent.includes(hasRuntimeExpr), 'overlay.js must define hasRuntime with the shared condition')
	})

	it('master.html: bar draw is gated on hasBar (derived from row.hasRuntime) and drawn every time hasBar is true', () => {
		assert.match(
			masterContent,
			/const hasBar = row\.hasRuntime && Number\(row\.duration\) > 0;/,
			'master.html should derive hasBar from row.hasRuntime',
		)
		assert.match(masterContent, /if \(hasBar\) \{/, 'master.html should branch the bar draw on hasBar')
		// The bar fillRect calls must live inside the row loop's hasBar-gated region — from the
		// (second) `if (hasBar) {` that follows the label draw, through the single unconditional
		// `ty += rowStep;` — not conditioned on a second, separate maxY check (T250.2: no more
		// silent bar clipping into the next row's space).
		const loopTailMatch = masterContent.match(/ctx\.fillText\(labelText, dockX \+ pad, ty \+ 8\);[\s\S]*?ty \+= rowStep;/)
		assert.ok(loopTailMatch, 'must find the post-label-draw region of the row loop')
		assert.match(loopTailMatch[0], /if \(hasBar\) \{/, 'bar block must be gated on hasBar')
		assert.match(loopTailMatch[0], /fillRect\(dockX \+ pad, barY,/, 'bar background fillRect must be inside the hasBar block')
		assert.doesNotMatch(
			loopTailMatch[0],
			/ty \+ 2 <= maxY/,
			'bar draw must not be re-gated on a second maxY check that can clip it independently of the row budget',
		)
	})

	it('overlay.js: progress-bar-fill markup is rendered whenever row.hasRuntime is true (unchanged, not touched by T250.2)', () => {
		assert.match(overlayContent, /if \(row\.hasRuntime\) \{/, 'overlay.js should branch on row.hasRuntime')
		assert.match(overlayContent, /label-layer-progress-bar-fill/, 'overlay.js should render the progress bar fill element')
	})

	it('master.html: row loop advances ty by a single unconditional rowStep that already reserves the bar for hasBar rows', () => {
		assert.match(
			masterContent,
			/const rowStep = hasBar \? textRowH \+ barH \+ 2 : textRowH;/,
			'rowStep must reserve text+bar+gap for rows with a bar',
		)
		assert.match(masterContent, /if \(ty \+ rowStep > maxY\) break;/, 'the row-start gate must use the full per-row budget, not just label height')
	})
})
