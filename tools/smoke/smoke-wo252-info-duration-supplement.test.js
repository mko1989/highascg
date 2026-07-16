'use strict'

/**
 * WO-252 — Feed clip duration from AMCP INFO supplement into oscState.
 * Smoke tests for applyInfoTimingSupplement, parser→injection, and default resolution.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { OscState } = require('../../src/osc/osc-state')
const { parseString } = require('xml2js')
const { getInfoXml2jsOptions, extractChannelInfoFromParsed } = require('../../src/state/info-channel-parse')
const { resolveOscInfoSupplementMs } = require('../../src/utils/periodic-sync')

function makeOscState(overrides) {
	return new OscState(
		() => {},
		Object.assign(
			{ peakHoldMs: 1000, staleTimeoutMs: 0, layerStaleTimeoutMs: 0, emitIntervalMs: 50, wsDeltaBroadcast: false },
			overrides,
		),
	)
}

const NEW_INFO_XML = `<?xml version="1.0" encoding="utf-8"?>
<channel>
   <format>1920x1080</format>
   <framerate>50</framerate>
   <stage>
      <layer>
         <layer_10>
            <background>
               <producer>empty</producer>
            </background>
            <foreground>
               <file>
                  <clip>0</clip>
                  <clip>5.04</clip>
                  <name>BRIDGE/CLIP_1</name>
                  <path>/home/casparcg/media/bridge/clip_1.mp4</path>
                  <time>2.5</time>
                  <time>5.04</time>
               </file>
               <paused>false</paused>
               <producer>ffmpeg</producer>
            </foreground>
         </layer_10>
         <layer_110>
            <background>
               <producer>empty</producer>
            </background>
            <foreground>
               <file>
                  <clip>0</clip>
                  <clip>10.2</clip>
                  <name>BANKB/CLIP_2</name>
                  <path>/home/casparcg/media/bankb/clip_2.mp4</path>
                  <time>3.0</time>
                  <time>10.2</time>
               </file>
               <paused>false</paused>
               <producer>ffmpeg</producer>
            </foreground>
         </layer_110>
      </layer>
   </stage>
</channel>`

describe('WO-252 T252.1 — applyInfoTimingSupplement', () => {
	it('sets duration when OSC duration is absent', () => {
		const os = makeOscState()
		// No OSC file/time message — duration is undefined
		os.applyInfoTimingSupplement(1, 10, { durationSec: 5.04, timeSec: 2.5 })

		const layer = os.getSnapshot().channels[1].layers[10]
		assert.equal(layer.file.duration, 5.04)
		assert.ok(Math.abs(layer.file.remaining - 2.54) < 0.01)
		assert.ok(layer.file.progress > 0 && layer.file.progress < 1)
	})

	it('does NOT override a real OSC duration', () => {
		const os = makeOscState()
		// OSC provides a duration first
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/file/time', args: [1.0, 5.0] })
		// Then try to supplement with a different value
		os.applyInfoTimingSupplement(1, 10, { durationSec: 10.0, timeSec: 1.0 })

		const layer = os.getSnapshot().channels[1].layers[10]
		assert.equal(layer.file.duration, 5.0, 'OSC duration stays authoritative')
	})

	it('rejects insane duration values', () => {
		const os = makeOscState()
		// Try to supplement with garbage duration
		os.applyInfoTimingSupplement(1, 10, { durationSec: 1e23, timeSec: 0 })

		const layer = os.getSnapshot().channels[1].layers[10]
		assert.equal(layer.file.duration, undefined, 'insane duration must be rejected')
	})

	it('only fills elapsed when entirely absent; OSC elapsed stays authoritative', () => {
		const os = makeOscState()
		// OSC provides elapsed first
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/file/time', args: [1.5, 5.0] })
		// Then try to supplement with a different elapsed
		os.applyInfoTimingSupplement(1, 10, { durationSec: 5.0, timeSec: 3.0 })

		const layer = os.getSnapshot().channels[1].layers[10]
		assert.equal(layer.file.elapsed, 1.5, 'OSC elapsed stays authoritative')
	})

	it('fills elapsed when it is absent', () => {
		const os = makeOscState()
		// No OSC time message — elapsed is undefined
		os.applyInfoTimingSupplement(1, 10, { durationSec: 5.0, timeSec: 2.0 })

		const layer = os.getSnapshot().channels[1].layers[10]
		assert.equal(layer.file.elapsed, 2.0)
	})

	it('rejects insane elapsed values', () => {
		const os = makeOscState()
		// Try to supplement with garbage elapsed
		os.applyInfoTimingSupplement(1, 10, { durationSec: 5.0, timeSec: 1e-32 })

		const layer = os.getSnapshot().channels[1].layers[10]
		assert.equal(layer.file.elapsed, undefined, 'insane elapsed must be rejected')
	})

	it('marks the layer fresh with _lastOscAt so stale checks pass', () => {
		const os = makeOscState()
		const before = Date.now()
		os.applyInfoTimingSupplement(1, 10, { durationSec: 5.0, timeSec: 2.0 })
		const after = Date.now()

		const layer = os._channels[1].layers[10]
		assert.ok(layer._lastOscAt >= before && layer._lastOscAt <= after)
	})
})

describe('WO-252 T252.2 — INFO parse → oscState injection', () => {
	it('parses INFO XML and extracts real layer numbers correctly', (t, done) => {
		const xmlOpts = getInfoXml2jsOptions()
		parseString(NEW_INFO_XML, xmlOpts, (err, result) => {
			assert.ok(!err, 'XML must parse')
			const { framerate, layers } = extractChannelInfoFromParsed(result)
			assert.equal(framerate, '50')
			// Layer numbers come from the array indices
			assert.equal(layers[10]?.durationSec, '5.04')
			assert.equal(layers[10]?.timeSec, '2.50')
			assert.equal(layers[110]?.durationSec, '10.20')
			assert.equal(layers[110]?.timeSec, '3.00')
			done()
		})
	})

	it('injects parsed INFO into oscState with correct layer numbers', (t, done) => {
		const os = makeOscState()
		const ctx = { oscState: os }

		const xmlOpts = getInfoXml2jsOptions()
		parseString(NEW_INFO_XML, xmlOpts, (err, result) => {
			assert.ok(!err)
			const { layers: parsedLayers } = extractChannelInfoFromParsed(result)

			// Simulate what updateChannelVariablesFromXml does
			for (let layerIdx = 0; layerIdx < parsedLayers.length; layerIdx++) {
				const entry = parsedLayers[layerIdx]
				if (!entry) continue
				const durationSec = entry.durationSec ? parseFloat(entry.durationSec) : undefined
				const timeSec = entry.timeSec ? parseFloat(entry.timeSec) : undefined
				if (Number.isFinite(durationSec) || Number.isFinite(timeSec)) {
					ctx.oscState.applyInfoTimingSupplement(1, layerIdx, {
						durationSec: Number.isFinite(durationSec) ? durationSec : undefined,
						timeSec: Number.isFinite(timeSec) ? timeSec : undefined,
					})
				}
			}

			const snap = os.getSnapshot()
			// Layer 10 should have been injected
			assert.equal(snap.channels[1].layers[10].file.duration, 5.04)
			assert.equal(snap.channels[1].layers[10].file.elapsed, 2.5)
			// Layer 110 (bank B) should also have been injected correctly
			assert.equal(snap.channels[1].layers[110].file.duration, 10.2)
			assert.equal(snap.channels[1].layers[110].file.elapsed, 3)
			done()
		})
	})
})

describe('WO-252 T252.3 — resolveOscInfoSupplementMs defaults', () => {
	it('unset + no env → default 2000ms', () => {
		const originalEnv = process.env.HIGHASCG_OSC_INFO_MS
		delete process.env.HIGHASCG_OSC_INFO_MS
		try {
			const ms = resolveOscInfoSupplementMs({ config: {} })
			assert.equal(ms, 2000)
		} finally {
			if (originalEnv !== undefined) process.env.HIGHASCG_OSC_INFO_MS = originalEnv
		}
	})

	it('explicit 0 → 0 (disable)', () => {
		const originalEnv = process.env.HIGHASCG_OSC_INFO_MS
		delete process.env.HIGHASCG_OSC_INFO_MS
		try {
			const ms = resolveOscInfoSupplementMs({ config: { osc_info_supplement_ms: 0 } })
			assert.equal(ms, 0)
		} finally {
			if (originalEnv !== undefined) process.env.HIGHASCG_OSC_INFO_MS = originalEnv
		}
	})

	it('explicit 500 → 500', () => {
		const originalEnv = process.env.HIGHASCG_OSC_INFO_MS
		delete process.env.HIGHASCG_OSC_INFO_MS
		try {
			const ms = resolveOscInfoSupplementMs({ config: { osc_info_supplement_ms: 500 } })
			assert.equal(ms, 500)
		} finally {
			if (originalEnv !== undefined) process.env.HIGHASCG_OSC_INFO_MS = originalEnv
		}
	})

	it('env override respected', () => {
		const originalEnv = process.env.HIGHASCG_OSC_INFO_MS
		process.env.HIGHASCG_OSC_INFO_MS = '1500'
		try {
			const ms = resolveOscInfoSupplementMs({ config: {} })
			assert.equal(ms, 1500)
		} finally {
			if (originalEnv !== undefined) process.env.HIGHASCG_OSC_INFO_MS = originalEnv
			else delete process.env.HIGHASCG_OSC_INFO_MS
		}
	})
})

// 2026-07-16 follow-up: looping producers on the 2.6-dev binary report a MONOTONIC elapsed that
// accumulates across loop iterations — remaining/progress (and stored elapsed) must use the
// in-iteration position (elapsed % duration) or the UI timer jumps (owner: "05 to 7686").
const { computeRemainingAndProgress } = require('../../src/osc/osc-state-timing')
const { test: t2 } = require('node:test')
t2('loop-modulo: accumulated elapsed wraps to in-iteration position', () => {
	const assert2 = require('node:assert/strict')
	const r = computeRemainingAndProgress(7686, 30, { loop: true })
	assert2.equal(r.iterationElapsed, 7686 % 30)
	assert2.ok(r.remaining >= 0 && r.remaining <= 30)
	assert2.ok(r.progress >= 0 && r.progress <= 1)
})
t2('loop-modulo: non-looping elapsed is untouched even when > duration (stall case)', () => {
	const assert2 = require('node:assert/strict')
	const r = computeRemainingAndProgress(35, 30, { loop: false })
	assert2.equal(r.iterationElapsed, 35)
	assert2.equal(r.remaining, 0)
})
t2('loop-modulo: looping within first iteration is untouched', () => {
	const assert2 = require('node:assert/strict')
	const r = computeRemainingAndProgress(5, 30, { loop: true })
	assert2.equal(r.iterationElapsed, 5)
	assert2.equal(r.remaining, 25)
})
