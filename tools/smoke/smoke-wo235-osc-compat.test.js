'use strict'

/**
 * WO-235 T235.5 smoke — new CasparCG (2.6-dev r253c16c) protocol compatibility.
 *
 * Root causes fixed (see src/osc/osc-state.js, src/utils/x-display-session-layout.js,
 * src/state/live-scene-reconcile.js for full citations to the new server's source tree):
 *
 *   1. core/producer/layer.cpp:132-141 (2.6-dev) never emits an explicit `.../type` OSC leaf —
 *      only `.../foreground/producer` / `.../background/producer` (the producer's *name*, e.g.
 *      "ffmpeg"/"empty"/"route"/"html"/"transition"). The old lineage's explicit `.../type`
 *      leaf is still honored (handled first) — both binaries work without a config switch.
 *      Symptom: `layer.type` stayed `null` forever → every OSC consumer that gates on
 *      `type === 'empty'` treated every layer as empty (playback.matrix stayed {}, per-layer
 *      timers in the main UI + multiview never populated).
 *   2. `.../file/time` carries [elapsed_sec, duration_sec] on both lineages (av_producer.cpp:990
 *      divides CHANNEL frame counters by CHANNEL fps on the new tree too — no unit/scale change),
 *      but a defensive sanity clamp was added against rare extreme-magnitude float garbage
 *      observed live (e.g. elapsed ~1e-32 / duration ~1e+23).
 *   3. live-scene-reconcile.js's `parseLayerFgClipsFromChannelXml` read `<file><clip>` as the
 *      clip *name* (old lineage: single string tag). The new tree repurposes `<clip>` as a
 *      numeric [start_sec, duration_sec] pair (av_producer.cpp:989) and moves the canonical
 *      clip id to a sibling `<name>` tag (av_producer.cpp:764) — the parser now prefers
 *      `<name>`/`$.name` and only falls back to `<clip>` when it does not look like the new
 *      numeric pair.
 *   4. host-operator-fullscreen.js's "No interactive operator display configured" 400:
 *      `multiviewScreenConsumerEnabled()` only trusted the legacy static
 *      `casparServer.multiview_enabled` / `multiview_screen_consumer` flags, which go stale
 *      once a multiview output is added via screenDestinations (Device Graph) without a config
 *      regenerate — even though the multiview channel + screen consumer are genuinely running
 *      (confirmed live via `INFO <multiview channel>`). Now falls back to the
 *      screenDestinations-derived channel map (routing-map.js already treats that as
 *      authoritative) when the legacy flags say no.
 *
 * NOTE ("old" INFO/OSC fixtures below): the pre-swap binary is not available on this box to
 * capture directly (WO-235 evidence). The "old-style" snippets here are reverse-engineered from
 * the parsers' own pre-existing fallback branches (XML attribute `<file name="...">`, singular
 * `<clip>Name</clip>` string tag, explicit `.../type` OSC leaf) — i.e. what the code was already
 * written to accept before this change — not captured packets. The "new-style" fixtures ARE
 * captured live (`curl -X POST localhost:4200/api/raw -d '{"command":"INFO 1"}'` against the
 * running 2.6-dev binary; addresses cross-checked against protocol/osc/client.cpp +
 * core/monitor/monitor.h in the new server's source tree).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { OscState } = require('../../src/osc/osc-state')
const { buildMatrixFromOsc, getOccupiedLayerNumbersFromOsc } = require('../../src/state/playback-tracker-osc')
const { parseLayerFgClipsFromChannelXml } = require('../../src/state/live-scene-reconcile')
const { multiviewScreenConsumerEnabled } = require('../../src/utils/x-display-session-layout')

function makeOscState(overrides) {
	return new OscState(
		() => {},
		Object.assign(
			{ peakHoldMs: 1000, staleTimeoutMs: 0, layerStaleTimeoutMs: 0, emitIntervalMs: 50, wsDeltaBroadcast: false },
			overrides,
		),
	)
}

describe('WO-235 T235.2 — osc-state elapsed/duration seconds, old + new format', () => {
	it('old lineage: flat `.../type` leaf + `.../file/time` — elapsed/duration in seconds', () => {
		const os = makeOscState()
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/file/name', args: ['BRIDGE/CLIP'] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/file/time', args: [4.06, 5.04] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/type', args: ['ffmpeg'] })

		const layer = os.getSnapshot().channels[1].layers[10]
		assert.equal(layer.type, 'ffmpeg')
		assert.equal(layer.file.elapsed, 4.06)
		assert.equal(layer.file.duration, 5.04)
		assert.ok(Math.abs(layer.file.remaining - 0.98) < 1e-9)
	})

	it('new lineage (2.6-dev): nested foreground/producer leaf, no `.../type` — elapsed/duration in seconds', () => {
		const os = makeOscState()
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/file/name', args: ['BRIDGE/CLIP'] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/file/time', args: [4.06, 5.04] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/producer', args: ['ffmpeg'] })
		// second tick (steady state, producer signature unchanged) — mirrors real bundle cadence
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/file/time', args: [4.16, 5.04] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/producer', args: ['ffmpeg'] })

		const layer = os.getSnapshot().channels[1].layers[10]
		assert.equal(layer.type, 'ffmpeg', 'layer.type must be populated from the `producer` leaf on the new binary')
		assert.equal(layer.file.elapsed, 4.16)
		assert.equal(layer.file.duration, 5.04)
		assert.ok(Math.abs(layer.file.remaining - 0.88) < 1e-9)
		assert.ok(layer.file.progress > 0 && layer.file.progress < 1)
	})

	it('new lineage: `/ch/` short address form still normalizes to `/channel/`', () => {
		const os = makeOscState()
		os.handleOscMessage({ address: '/ch/2/stage/layer/5/foreground/producer', args: ['empty'] })
		const layer = os.getSnapshot().channels[2].layers[5]
		assert.equal(layer.type, 'empty')
	})

	it('background producer sets backgroundType, not type', () => {
		const os = makeOscState()
		os.handleOscMessage({ address: '/channel/1/stage/layer/11/foreground/producer', args: ['ffmpeg'] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/11/background/producer', args: ['transition'] })
		const layer = os.getSnapshot().channels[1].layers[11]
		assert.equal(layer.type, 'ffmpeg')
		assert.equal(layer.backgroundType, 'transition')
	})

	it('rejects extreme-magnitude float garbage on `.../file/time` and keeps the previous elapsed', () => {
		const os = makeOscState()
		os.handleOscMessage({ address: '/channel/1/stage/layer/110/foreground/producer', args: ['ffmpeg'] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/110/foreground/file/time', args: [4.06, 5.04] })
		// observed live on the 2.6-dev binary for a producer mid-teardown
		os.handleOscMessage({
			address: '/channel/1/stage/layer/110/foreground/file/time',
			args: [1.4607449527806086e-32, 1.962100363335088e23],
		})
		const layer = os.getSnapshot().channels[1].layers[110]
		assert.equal(layer.file.elapsed, 4.06, 'garbage elapsed sample must not overwrite the last sane value')
		assert.equal(layer.file.duration, 5.04, 'garbage duration sample must not overwrite the last sane value')
	})
})

describe('WO-235 T235.3 — playback.matrix populates from new-style OSC addresses', () => {
	it('buildMatrixFromOsc finds occupied layers using nested foreground/producer', () => {
		const os = makeOscState()
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/file/name', args: ['BRIDGE/CLIP'] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/file/time', args: [4.06, 5.04] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/foreground/producer', args: ['ffmpeg'] })
		os.handleOscMessage({ address: '/channel/1/stage/layer/10/background/producer', args: ['empty'] })
		// an empty layer must NOT show up in the matrix
		os.handleOscMessage({ address: '/channel/1/stage/layer/20/foreground/producer', args: ['empty'] })

		const matrix = buildMatrixFromOsc({ oscState: os })
		assert.ok(matrix['1-10'], 'occupied layer 10 must appear in the matrix')
		assert.equal(matrix['1-10'].clip, 'BRIDGE/CLIP')
		assert.equal(matrix['1-20'], undefined, 'empty layer 20 must not appear in the matrix')

		const occupied = getOccupiedLayerNumbersFromOsc({ oscState: os }, 1)
		assert.deepEqual(occupied, [10])
	})

	it('regression: before the fix, a producer-only feed (no `.../type`) left the matrix empty', () => {
		// Simulates the exact live symptom: OSC arrives, file/name + file/time populate, but if
		// `layer.type` were never derived from `producer` it would stay null forever and
		// buildMatrixFromOsc would skip every layer (typ === 'empty' fallback).
		const os = makeOscState()
		os.handleOscMessage({ address: '/channel/3/stage/layer/2/foreground/file/name', args: ['BUMPER'] })
		os.handleOscMessage({ address: '/channel/3/stage/layer/2/foreground/file/time', args: [3.42, 15.04] })
		os.handleOscMessage({ address: '/channel/3/stage/layer/2/foreground/producer', args: ['ffmpeg'] })

		const layer = os.getSnapshot().channels[3].layers[2]
		assert.notEqual(layer.type, null, 'layer.type must not be null once a producer leaf has arrived')

		const matrix = buildMatrixFromOsc({ oscState: os })
		assert.ok(matrix['3-2'], 'matrix must contain the occupied layer')
	})
})

describe('WO-235 T235.4 — INFO XML consumers, old + new schema', () => {
	// New-style snippet captured live: curl -X POST localhost:4200/api/raw -d '{"command":"INFO 1"}'
	const NEW_INFO_XML = `<?xml version="1.0" encoding="utf-8"?>
<channel>
   <format>3072x1728</format>
   <framerate>50</framerate>
   <framerate>1</framerate>
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
                  <name>BRIDGE/355317</name>
                  <path>/home/casparcg/highascg/media/bridge/355317.mp4</path>
                  <time>4.0599999999999996</time>
                  <time>5.04</time>
               </file>
               <loop>true</loop>
               <paused>false</paused>
               <producer>ffmpeg</producer>
            </foreground>
         </layer_10>
         <layer_264>
            <background>
               <producer>empty</producer>
            </background>
            <foreground>
               <file>
                  <path>file:///home/casparcg/highascg/template/pip_edge_strip.html</path>
               </file>
               <paused>false</paused>
               <producer>html</producer>
            </foreground>
         </layer_264>
      </layer>
   </stage>
</channel>`

	// Old-style snippet reverse-engineered from the parsers' pre-existing fallback branches
	// (attribute-based `name=`, singular string `<clip>`, explicit `<type>`) — see file header note.
	const OLD_INFO_XML = `<?xml version="1.0" encoding="utf-8"?>
<channel>
   <format>3072x1728</format>
   <framerate>50</framerate>
   <stage>
      <layer>
         <layer_10>
            <foreground>
               <producer name="BRIDGE/355317">ffmpeg</producer>
               <file name="BRIDGE/355317">
                  <clip>BRIDGE/355317</clip>
                  <time>4.06</time>
                  <time>5.04</time>
               </file>
            </foreground>
         </layer_10>
         <layer_264>
            <foreground>
               <producer>html</producer>
               <file>
                  <path>file:///home/casparcg/highascg/template/pip_edge_strip.html</path>
               </file>
            </foreground>
         </layer_264>
      </layer>
   </stage>
</channel>`

	it('live-scene-reconcile: resolves the clip name from the new `<name>` tag, not the numeric `<clip>` pair', async () => {
		const out = await parseLayerFgClipsFromChannelXml(NEW_INFO_XML)
		assert.equal(out['10'], 'BRIDGE/355317', 'must read <name>, not mistake the duration ("5.04") for a clip name')
	})

	it('live-scene-reconcile: still resolves the clip name from the old attribute/singular-clip schema', async () => {
		const out = await parseLayerFgClipsFromChannelXml(OLD_INFO_XML)
		assert.equal(out['10'], 'BRIDGE/355317')
	})
})

describe('WO-235 T235.4 — operator-fullscreen 400 (interactive-zone detection)', () => {
	it(
		'multiviewScreenConsumerEnabled falls back to the screenDestinations-derived channel map ' +
			'when the legacy casparServer flags are stale',
		() => {
			// Legacy flags say "no multiview" (stale — not resynced since a multiview destination
			// was added via Device Graph), but screenDestinations has a live "mode": "multiview"
			// output — this is the exact shape observed live on the dev box.
			const config = {
				casparServer: {
					multiview_enabled: false,
					multiview_screen_consumer: false,
					screen_count: 1,
				},
				screen_count: 1,
				screenDestinations: {
					version: 1,
					destinations: [
						{ id: 'dst_pgm_1', mainScreenIndex: 0, mode: 'pgm_only', width: 1920, height: 1080, fps: 50 },
						{ id: 'dst_mv_1', mainScreenIndex: 0, mode: 'multiview', width: 1920, height: 1080, fps: 50 },
					],
				},
			}
			assert.equal(multiviewScreenConsumerEnabled(config), true)
		},
	)

	it('multiviewScreenConsumerEnabled stays false when neither legacy flags nor routing define a multiview output', () => {
		const config = {
			casparServer: { multiview_enabled: false, multiview_screen_consumer: false, screen_count: 1 },
			screen_count: 1,
			screenDestinations: {
				version: 1,
				destinations: [{ id: 'dst_pgm_1', mainScreenIndex: 0, mode: 'pgm_only', width: 1920, height: 1080, fps: 50 }],
			},
		}
		assert.equal(multiviewScreenConsumerEnabled(config), false)
	})

	it('multiviewScreenConsumerEnabled still honors the legacy flags when they say yes (no behavior change)', () => {
		const config = {
			casparServer: {
				multiview_enabled: true,
				multiview_screen_consumer: true,
				screen_count: 1,
			},
			screen_count: 1,
		}
		assert.equal(multiviewScreenConsumerEnabled(config), true)
	})
})
