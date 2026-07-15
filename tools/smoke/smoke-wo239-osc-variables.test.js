'use strict'

/**
 * WO-239 T239.3 smoke — OSC *variables* (osc-variables.js) still broken after the WO-235
 * type-leaf fix went live.
 *
 * Root cause (confirmed via new server's src-tree + live `/api/state` probes on this box):
 *
 *   `applyOscSnapshotToVariables` (src/osc/osc-variables.js) only ever walked
 *   `Object.keys(snapshot.channels[ch].layers)` of the *current* OSC snapshot to decide which
 *   `osc_ch{N}_l{L}_{clip,time,remaining,progress}` variables to write/clear. But `osc-state.js`
 *   `_pruneStaleLayers` (layerStaleTimeoutMs, default 10000ms) deletes a layer from
 *   `channels[ch].layers` once Caspar stops emitting OSC for it (CLEAR / stage teardown — by that
 *   function's own doc comment, "there is no final empty message"). Once a layer is pruned, it
 *   simply vanishes from `Object.keys(layers)`, so the variables function silently skipped it
 *   forever, leaving the last clip name / elapsed / remaining / progress values FROZEN in
 *   `ctx.variables` instead of clearing to ''.
 *
 *   Before WO-235, this was invisible: `layer.type` never resolved on the new binary (stayed
 *   `null` forever — see smoke-wo235-osc-compat.test.js), so the `type === 'empty'` gate in this
 *   same function cleared every layer's variables on *every* emit tick regardless of pruning —
 *   variables were blank-but-fresh, never frozen. WO-235 fixing `layer.type` derivation from the
 *   `.../foreground/producer` leaf is exactly what makes real content populate these variables
 *   correctly — which is what exposes this pre-existing gap as a visible "frozen" stale
 *   clip/timer once a clip stops and its layer ages out of OSC (the owner's "still something is
 *   broken in the osc variables parser" report, filed after the WO-235 restart went live).
 *
 * Fix: `applyOscSnapshotToVariables` now tracks, per channel, the set of layer numbers it saw on
 * the previous call (`ctx._oscVarsSeenLayers`) and explicitly clears the 4 variables for any
 * layer present last time but absent this time. `clearOscVariables` resets that tracking too.
 *
 * Secondary fix (same file review, T239.2): `osc-state.js` never parsed the new binary's
 * `.../foreground/loop` leaf (Caspar 2.6-dev av_producer.cpp:766/991 `state_["loop"] = loop` is a
 * TOP-LEVEL producer-state key, not nested under "file/" — confirmed via core/monitor/monitor.h's
 * state_proxy merge semantics AND a live `INFO 1` capture showing `<loop>true</loop>` as a
 * sibling of `<file>`, not a child of it — see smoke-wo235-osc-compat.test.js NEW_INFO_XML). Not
 * currently consumed by osc-variables.js, but fixed for correctness of `layer.file.loop`; old
 * `.../file/loop` still honored.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { OscState } = require('../../src/osc/osc-state')
const { applyOscSnapshotToVariables, clearOscVariables } = require('../../src/osc/osc-variables')

function makeOscState(overrides) {
	return new OscState(
		() => {},
		Object.assign(
			{ peakHoldMs: 1000, staleTimeoutMs: 0, layerStaleTimeoutMs: 0, emitIntervalMs: 50, wsDeltaBroadcast: false },
			overrides,
		),
	)
}

function makeCtx() {
	return { variables: {}, state: null, _oscVarsSeenLayers: undefined }
}

/** Minimal `state.setVariable` shim mirroring state-manager.js's semantics for this test's purposes. */
function attachStateShim(ctx) {
	ctx.state = {
		setVariable(key, value) {
			const s = value == null ? '' : String(value)
			ctx.variables[key] = s
		},
	}
	return ctx
}

describe('WO-239 T239.1/T239.3 — osc-variables per-layer derivation, old + new OSC format', () => {
	it('new lineage: nested foreground/producer + file/time populates clip/time/remaining/progress', () => {
		const os = makeOscState()
		// First tick: the `producer` leaf's signature transitions from unset -> 'ffmpeg', which
		// clears file timing (new-producer guard in osc-state.js `_routeLayer`). Second tick (steady
		// state, signature unchanged) mirrors the real bundle cadence — same pattern as
		// smoke-wo235-osc-compat.test.js's "new lineage" case.
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/file/name', args: ['BRIDGE/355317'] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/file/time', args: [3.96, 5.04] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/producer', args: ['ffmpeg'] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/file/name', args: ['BRIDGE/355317'] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/file/time', args: [4.06, 5.04] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/producer', args: ['ffmpeg'] })

		const ctx = attachStateShim(makeCtx())
		applyOscSnapshotToVariables(ctx, os.getSnapshot())

		assert.equal(ctx.variables['osc_ch1_l10_clip'], 'BRIDGE/355317')
		assert.equal(ctx.variables['osc_ch1_l10_time'], '4.06')
		assert.ok(Math.abs(Number(ctx.variables['osc_ch1_l10_remaining']) - 0.98) < 1e-6)
		assert.notEqual(ctx.variables['osc_ch1_l10_progress'], '')
	})

	it('old lineage: flat `.../type` leaf still derives the same variables', () => {
		const os = makeOscState()
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/file/name', args: ['BRIDGE/355317'] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/file/time', args: [4.06, 5.04] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/type', args: ['ffmpeg'] })

		const ctx = attachStateShim(makeCtx())
		applyOscSnapshotToVariables(ctx, os.getSnapshot())

		assert.equal(ctx.variables['osc_ch1_l10_clip'], 'BRIDGE/355317')
		assert.equal(ctx.variables['osc_ch1_l10_time'], '4.06')
	})

	it(
		'REGRESSION (pre-fix symptom): a layer that stops sending OSC and gets pruned must have its ' +
			'variables cleared, not frozen at the last value',
		() => {
			const os = makeOscState({ layerStaleTimeoutMs: 5 })
			// Two ticks: first sets the producer signature (which clears file timing on transition),
			// second is steady state with real timing — mirrors the live bundle cadence.
			os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/file/name', args: ['BRIDGE/355317'] })
			os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/file/time', args: [3.96, 5.04] })
			os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/producer', args: ['ffmpeg'] })
			os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/file/name', args: ['BRIDGE/355317'] })
			os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/file/time', args: [4.06, 5.04] })
			os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/producer', args: ['ffmpeg'] })

			const ctx = attachStateShim(makeCtx())
			applyOscSnapshotToVariables(ctx, os.getSnapshot())
			assert.equal(ctx.variables['osc_ch1_l10_clip'], 'BRIDGE/355317', 'sanity: clip populated while occupied')
			assert.equal(ctx.variables['osc_ch1_l10_time'], '4.06')

			// Simulate Caspar going silent for this layer (CLEAR / stage teardown, no final "empty"
			// message) long enough to cross layerStaleTimeoutMs, then another emit tick arrives for a
			// different, unrelated layer — this is what triggers _pruneStaleLayers to drop layer 10.
			const realNow = Date.now
			try {
				Date.now = () => realNow() + 1000
				os.handleOscMessage({ address: '/channel/1/stage/layer/99/foreground/producer', args: ['empty'] })
				const snap = os.getSnapshot()
				assert.equal(snap.channels[1].layers[10], undefined, 'sanity: layer 10 must actually be pruned')

				applyOscSnapshotToVariables(ctx, snap)
			} finally {
				Date.now = realNow
			}

			assert.equal(ctx.variables['osc_ch1_l10_clip'], '', 'pruned layer clip must clear, not stay frozen')
			assert.equal(ctx.variables['osc_ch1_l10_time'], '', 'pruned layer time must clear, not stay frozen')
			assert.equal(ctx.variables['osc_ch1_l10_remaining'], '', 'pruned layer remaining must clear, not stay frozen')
			assert.equal(ctx.variables['osc_ch1_l10_progress'], '', 'pruned layer progress must clear, not stay frozen')
		},
	)

	it('explicit `type === empty` still clears immediately (no regression from the tracking change)', () => {
		const os = makeOscState()
		os.handleOscMessage({ address: '/channel/2/stage/layer/3/foreground/file/name', args: ['CLIP'] })
		os.handleOscMessage({ address: '/channel/2/stage/layer/3/foreground/file/time', args: [1, 10] })
		os.handleOscMessage({ address: '/channel/2/stage/layer/3/foreground/producer', args: ['ffmpeg'] })

		const ctx = attachStateShim(makeCtx())
		applyOscSnapshotToVariables(ctx, os.getSnapshot())
		assert.equal(ctx.variables['osc_ch2_l3_clip'], 'CLIP')

		os.handleOscMessage({ address: '/channel/2/stage/layer/3/foreground/producer', args: ['empty'] })
		applyOscSnapshotToVariables(ctx, os.getSnapshot())
		assert.equal(ctx.variables['osc_ch2_l3_clip'], '')
		assert.equal(ctx.variables['osc_ch2_l3_time'], '')
	})

	it('clearOscVariables resets the per-layer tracking set (no stale-diff carryover across an OSC subsystem restart)', () => {
		const ctx = attachStateShim(makeCtx())
		ctx.variables['osc_ch1_l10_clip'] = 'STALE'
		ctx._oscVarsSeenLayers = { 1: new Set([10, 11]) }

		clearOscVariables(ctx)

		assert.equal(ctx.variables['osc_ch1_l10_clip'], undefined, 'osc_ keys must be wiped')
		assert.deepEqual(ctx._oscVarsSeenLayers, {}, 'tracking must reset so a fresh subsystem start does not diff against stale layer numbers')
	})

	it('multiple layers on the same channel: only the one that disappears gets cleared', () => {
		const os = makeOscState({ layerStaleTimeoutMs: 5 })
		os.handleOscMessage({ address: '/channel/4/stage/layer/10/foreground/file/name', args: ['A'] })
		os.handleOscMessage({ address: '/channel/4/stage/layer/10/foreground/file/time', args: [1, 10] })
		os.handleOscMessage({ address: '/channel/4/stage/layer/10/foreground/producer', args: ['ffmpeg'] })
		os.handleOscMessage({ address: '/channel/4/stage/layer/60/foreground/file/path', args: ['file:///tmpl/mv.html'] })
		os.handleOscMessage({ address: '/channel/4/stage/layer/60/foreground/producer', args: ['html'] })

		const ctx = attachStateShim(makeCtx())
		applyOscSnapshotToVariables(ctx, os.getSnapshot())
		assert.equal(ctx.variables['osc_ch4_l10_clip'], 'A')
		assert.equal(ctx.variables['osc_ch4_l60_clip'], 'file:///tmpl/mv.html')

		const realNow = Date.now
		try {
			Date.now = () => realNow() + 1000
			// Layer 60 gets a fresh tick (stays alive); layer 10 gets nothing (goes stale and is pruned).
			os.handleOscMessage({ address: '/channel/4/stage/layer/60/foreground/producer', args: ['html'] })
			const snap = os.getSnapshot()
			assert.equal(snap.channels[4].layers[10], undefined)
			assert.ok(snap.channels[4].layers[60])
			applyOscSnapshotToVariables(ctx, snap)
		} finally {
			Date.now = realNow
		}

		assert.equal(ctx.variables['osc_ch4_l10_clip'], '', 'pruned layer 10 must clear')
		assert.equal(ctx.variables['osc_ch4_l60_clip'], 'file:///tmpl/mv.html', 'still-alive layer 60 must be untouched')
	})
})

describe('WO-239 T239.2 — osc-state `loop` leaf, old + new address shape', () => {
	it('new lineage: `.../foreground/loop` (sibling of file/, not nested under it) sets layer.file.loop', () => {
		const os = makeOscState()
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/file/name', args: ['CLIP'] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/loop', args: [true] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/producer', args: ['ffmpeg'] })

		const layer = os.getSnapshot().channels[1].layers[10]
		assert.equal(layer.file.loop, true)
	})

	it('old lineage: `.../file/loop` (nested under file/) still sets layer.file.loop', () => {
		const os = makeOscState()
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/file/name', args: ['CLIP'] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/file/loop', args: [1] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/type', args: ['ffmpeg'] })

		const layer = os.getSnapshot().channels[1].layers[10]
		assert.equal(layer.file.loop, true)
	})

	it('background loop leaf sets backgroundFile.loop, not file.loop', () => {
		const os = makeOscState()
		os.handleOscMessage({ address: '/channel/1/stage/layer/11/background/loop', args: [true] })
		const layer = os.getSnapshot().channels[1].layers[11]
		assert.equal(layer.backgroundFile.loop, true)
		assert.equal(layer.file.loop, undefined)
	})
})
