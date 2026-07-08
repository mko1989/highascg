'use strict'

/**
 * WO-151 — Multiview timers (B151.2) + geometry invariance (B151.1).
 * Run: node --test tools/smoke/smoke-multiview-timers-geometry.test.js
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { OscState } = require('../../src/osc/osc-state')
const { normalizeOscConfig } = require('../../src/osc/osc-config')

function mkOsc(extra = {}) {
	return new OscState(() => {}, {
		enabled: true,
		listenPort: 6251,
		listenAddress: '0.0.0.0',
		peakHoldMs: 2000,
		emitIntervalMs: 50,
		staleTimeoutMs: 5000,
		layerStaleTimeoutMs: 10000,
		wsDeltaBroadcast: false,
		...extra,
	})
}

function feedLayer(osc, ch, layer, name, elapsed, dur) {
	osc.handleOscMessage({ address: `/channel/${ch}/stage/layer/${layer}/foreground/file/name`, args: [name] })
	osc.handleOscMessage({ address: `/channel/${ch}/stage/layer/${layer}/foreground/file/time`, args: [elapsed, dur] })
}

describe('WO-151 B151.2 — stale OSC layers are pruned (server feed)', () => {
	it('drops a layer with no OSC for > layerStaleTimeoutMs; keeps fresh layers', () => {
		const osc = mkOsc()
		feedLayer(osc, 1, 10, 'live_clip.mp4', 3, 60) // bank A — currently playing
		feedLayer(osc, 1, 110, 'old_bank_b.mp4', 42, 60) // bank B — cleared on Caspar, OSC stops

		let snap = osc.getSnapshot()
		assert.ok(snap.channels['1'].layers['10'], 'fresh layer 10 present')
		assert.ok(snap.channels['1'].layers['110'], 'layer 110 present while fresh')

		// Simulate Caspar removing layer 110 (CLEAR) — no more OSC for it, only layer 10 keeps flowing.
		osc._channels[1].layers[110]._lastOscAt = Date.now() - 60_000
		feedLayer(osc, 1, 10, 'live_clip.mp4', 4, 60)

		snap = osc.getSnapshot()
		assert.ok(snap.channels['1'].layers['10'], 'live layer survives prune')
		assert.equal(snap.channels['1'].layers['110'], undefined, 'dead layer pruned from snapshot')

		// The overlay picks the highest layer with a file — after pruning that is the live one again.
		const layers = snap.channels['1'].layers
		const top = Object.keys(layers)
			.map((k) => parseInt(k, 10))
			.filter((n) => layers[n]?.file?.name)
			.sort((a, b) => b - a)[0]
		assert.equal(top, 10)
		assert.equal(layers[top].file.name, 'live_clip.mp4')
		osc.destroy()
	})

	it('prune also runs on the throttled change emit (WS broadcast path)', () => {
		const osc = mkOsc({ emitIntervalMs: 10 })
		feedLayer(osc, 2, 108, 'stale.mp4', 10, 20)
		osc._channels[2].layers[108]._lastOscAt = Date.now() - 60_000
		let payload = null
		osc.on('change', (p) => {
			payload = p
		})
		osc._flushEmit()
		assert.ok(payload, 'change emitted')
		assert.equal(payload.channels['2'].layers['108'], undefined, 'stale layer absent from broadcast')
		osc.destroy()
	})

	it('layerStaleTimeoutMs=0 disables pruning; normalizeOscConfig defaults it to 10000', () => {
		const osc = mkOsc({ layerStaleTimeoutMs: 0 })
		feedLayer(osc, 3, 99, 'keep.mp4', 1, 2)
		osc._channels[3].layers[99]._lastOscAt = Date.now() - 3_600_000
		assert.ok(osc.getSnapshot().channels['3'].layers['99'], 'pruning disabled keeps layer')
		osc.destroy()
		assert.equal(normalizeOscConfig({ osc: {} }).layerStaleTimeoutMs, 10000)
		assert.equal(normalizeOscConfig({ osc: { layerStaleTimeoutMs: 2500 } }).layerStaleTimeoutMs, 2500)
	})
})

describe('WO-151 B151.2 — overlay template stale-layer guard (template/multiview-playback-osc.js)', () => {
	it('shouldIgnoreOscPlaybackLayer skips layers whose _lastOscAt is stale vs snapshot updatedAt', () => {
		delete globalThis.mvPlaybackOsc
		delete require.cache[require.resolve('../../template/multiview-playback-osc.js')]
		require('../../template/multiview-playback-osc.js')
		const helper = globalThis.mvPlaybackOsc
		assert.ok(helper, 'helper registered on globalThis')

		const now = Date.now()
		const fresh = { _lastOscAt: now - 1000, file: { name: 'clip.mp4' } }
		const stale = { _lastOscAt: now - 30_000, file: { name: 'dead.mp4' } }

		assert.equal(helper.isStaleOscPlaybackLayer(fresh, now), false)
		assert.equal(helper.isStaleOscPlaybackLayer(stale, now), true)
		assert.equal(helper.shouldIgnoreOscPlaybackLayer(10, fresh, now), false)
		assert.equal(helper.shouldIgnoreOscPlaybackLayer(110, stale, now), true, 'stale bank-B layer skipped')
		// Backwards compatible: without a timestamp there is no stale skip (server prune covers it).
		assert.equal(helper.shouldIgnoreOscPlaybackLayer(110, stale), false)
		// Chrome layers still ignored regardless of freshness.
		assert.equal(helper.shouldIgnoreOscPlaybackLayer(999, fresh, now), true)
	})
})

describe('WO-151 B151.1 — multiview geometry invariance', () => {
	it('setCanvasSize rescales cells so the normalized (applied) layout is unchanged', async () => {
		const { default: MultiviewState } = await import('../../client/lib/multiview-state.js')
		const st = new MultiviewState()
		st.canvasWidth = 1920
		st.canvasHeight = 1080
		st.cells = [
			{ id: 'pgm', type: 'pgm', label: 'PGM', x: 96, y: 54, w: 768, h: 432, source: null, aspectLocked: true },
			{ id: 'prv', type: 'prv', label: 'PRV', x: 960, y: 540, w: 480, h: 270, source: null, aspectLocked: true },
		]
		const before = st.toApiLayout()

		// Channel-map sync flips the basis (e.g. programResolutions[0] = 3072×1728) — WO-151 trigger.
		st.setCanvasSize(3072, 1728)
		const after = st.toApiLayout()
		assert.equal(st.canvasWidth, 3072)
		for (let i = 0; i < before.length; i++) {
			for (const k of ['x', 'y', 'w', 'h']) {
				assert.ok(
					Math.abs(before[i][k] - after[i][k]) < 1e-6,
					`cell ${before[i].id} ${k}: ${before[i][k]} -> ${after[i][k]} must not move on basis change`,
				)
			}
		}

		// And back again — still identical (no cumulative drift beyond float noise).
		st.setCanvasSize(1920, 1080)
		const roundtrip = st.toApiLayout()
		for (let i = 0; i < before.length; i++) {
			for (const k of ['x', 'y', 'w', 'h']) {
				assert.ok(Math.abs(before[i][k] - roundtrip[i][k]) < 1e-6, `roundtrip ${before[i].id} ${k}`)
			}
		}
	})

	it('solveCellDimensions (timers dock, non-1920 canvas) produces a cell the server fills exactly — no letterbox', async () => {
		const layoutMod = await import('../../client/components/multiview-editor-canvas-layout.js')
		const { multiviewState } = await import('../../client/lib/multiview-state.js')
		const { chromeReserveForCellLayout, containFillInPictureRect, MV_STAGE_W, MV_STAGE_H } = require('../../src/engine/multiview-layout-helper')

		const prevW = multiviewState.canvasWidth
		const prevH = multiviewState.canvasHeight
		try {
			multiviewState.canvasWidth = 3072
			multiviewState.canvasHeight = 1728

			const ratio = 16 / 9
			const solved = layoutMod.solveCellDimensions(900, 900, ratio, 'width', 'pgm', true)

			// Normalize the solved editor-px cell exactly like toApiLayout does.
			const cell = { x: 0, y: 0, w: solved.w / 3072, h: solved.h / 1728 }

			// Server-side apply math (src/engine/multiview-apply.js): chrome reserve + contain-fill.
			const { labelSize } = chromeReserveForCellLayout(cell, 'pgm', true)
			const borderSize = 3
			const pw = cell.w * MV_STAGE_W
			const ph = cell.h * MV_STAGE_H
			const adjustedW = pw - borderSize * 2
			const adjustedH = ph - borderSize * 2 - labelSize
			const fill = containFillInPictureRect(1920, 1080, borderSize, borderSize, adjustedW, adjustedH)
			const dispW = fill.vw * MV_STAGE_W
			// Video must fill the cell width (letterboxing here was the visible B151.1 symptom).
			assert.ok(
				Math.abs(dispW - adjustedW) <= 3,
				`video width ${dispW.toFixed(2)} must fill picture rect ${adjustedW.toFixed(2)} (±3 stage px)`,
			)
		} finally {
			multiviewState.canvasWidth = prevW
			multiviewState.canvasHeight = prevH
		}
	})

	it('stage-px solver reaches the fixed point of the server chrome reserve (width lock, dock clamp region)', async () => {
		const layoutMod = await import('../../client/components/multiview-editor-canvas-layout.js')
		const { chromeReserveForCellLayout, MV_STAGE_H } = require('../../src/engine/multiview-layout-helper')
		for (const w of [220, 480, 900, 1400]) {
			const videoH = (w - 6) / (16 / 9)
			const solved = layoutMod.solveCellDimensionsStagePx(w, w, 16 / 9, 'width', 'pgm', true)
			const cell = { h: solved.h / MV_STAGE_H }
			const { labelSize } = chromeReserveForCellLayout(cell, 'pgm', true)
			// Server reserve on the solved cell must leave exactly the video height (no letterbox).
			assert.ok(
				Math.abs(solved.h - (videoH + 6 + labelSize)) <= 1.5,
				`w=${w}: solved h ${solved.h.toFixed(2)} vs videoH+chrome ${(videoH + 6 + labelSize).toFixed(2)} (labelSize ${labelSize})`,
			)
		}
	})
})
