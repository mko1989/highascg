'use strict'

// WO-164: the live-audio meter-health watchdog ticks every 15 s but must only
// send the AMCP `INFO <ch>-<layer>` probe when OSC meters are stale/absent —
// never as an unconditional per-tick check. See:
// work/work-orders/164_WO_LIVE_AUDIO_WATCHDOG_QUIET_INFO_PROBE.md

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { listConfiguredLiveAudioSlots } = require('../../src/config/live-audio-input')
const { ensureLiveAudioInputsHealthy } = require('../../src/audio/live-audio-health')
const { repairLiveInputMetersIfStale } = require('../../src/audio/meter-health')

const cfg = {
	caspar_global_portaudio: true,
	live_audio_input_count: 1,
	live_audio_input_1_device: 'alsa://hw:0,0',
	live_audio_capture_bridge: false, // keep PLAY variants as plain alsa:// (no ffmpeg bridge spawn in the smoke)
	live_audio_meter_null_consumer: false, // out of scope for WO-164; keep amcp.info counts isolated to the health probe
}

const { slots } = listConfiguredLiveAudioSlots(cfg)
const slot = slots[0]
assert.ok(slot, 'fixture config must resolve one configured live-audio slot')

/**
 * @param {{ lastUpdateAt?: number|null, infoText?: string }} [opts]
 */
function makeCtx(opts = {}) {
	const infoCalls = []
	const rawCalls = []
	const logs = []
	const ctx = {
		config: cfg,
		amcp: {
			isConnected: true,
			info: async (ch, layer) => {
				infoCalls.push({ ch, layer })
				return { data: opts.infoText ?? '<type>ffmpeg</type><clip>alsa://dsnoop:0,0</clip>' }
			},
			raw: async (cmd) => {
				rawCalls.push(cmd)
				return {}
			},
		},
		oscState: {
			getSnapshot: () => ({
				channels: {
					[String(slot.channel)]: {
						audio: opts.lastUpdateAt == null ? undefined : { _lastUpdateAt: opts.lastUpdateAt },
					},
				},
			}),
		},
		log: (level, msg) => logs.push({ level, msg }),
	}
	return { ctx, infoCalls, rawCalls, logs }
}

describe('WO-164 live-audio watchdog: probe-on-suspicion', () => {
	it('fresh OSC meters produce zero amcp.info calls across several watchdog ticks', async () => {
		const { ctx, infoCalls, rawCalls } = makeCtx({ lastUpdateAt: Date.now() })

		for (let i = 0; i < 5; i++) {
			const res = await repairLiveInputMetersIfStale(ctx, { broadcastOsc: false })
			assert.equal(res.ok, true)
			assert.deepEqual(res.repaired, [])
		}

		assert.equal(infoCalls.length, 0, 'expected zero AMCP INFO probes while OSC meters stay fresh')
		assert.equal(rawCalls.length, 0, 'expected zero AMCP CLEAR/PLAY traffic while OSC meters stay fresh')
	})

	it('stale OSC meters trigger exactly one probe log line and the CLEAR/PLAY repair path', async () => {
		const { ctx, infoCalls, rawCalls, logs } = makeCtx({ lastUpdateAt: Date.now() - 20000 })

		const res = await ensureLiveAudioInputsHealthy(ctx, { slots })

		assert.equal(res.ok, true)
		assert.equal(res.repaired.length, 1)
		assert.equal(res.repaired[0].channel, slot.channel)

		assert.ok(infoCalls.length >= 1, 'expected the AMCP INFO probe to fire on stale meters')

		assert.ok(rawCalls.some((c) => c.startsWith(`CLEAR ${slot.channel}-${slot.layer}`)), 'expected CLEAR on repair')
		assert.ok(rawCalls.some((c) => c.startsWith(`PLAY ${slot.channel}-${slot.layer}`)), 'expected PLAY on repair')

		assert.ok(
			logs.some((l) => l.msg === `[live-audio-health] meters stale on slot ${slot.slot} → probing ch${slot.channel}-${slot.layer}`),
			`expected the WO-164 probe log line, got: ${JSON.stringify(logs.map((l) => l.msg))}`,
		)
	})

	it('absent OSC meters (never updated) are treated as stale too and still repair', async () => {
		const { ctx, infoCalls, rawCalls } = makeCtx({ lastUpdateAt: null })

		const res = await ensureLiveAudioInputsHealthy(ctx, { slots })

		assert.equal(res.repaired.length, 1)
		assert.ok(infoCalls.length >= 1)
		assert.ok(rawCalls.some((c) => c.startsWith(`PLAY ${slot.channel}-${slot.layer}`)))
	})

	it('a forced repair still runs even when OSC meters are fresh (unrelated to periodic staleness gating)', async () => {
		const { ctx, rawCalls } = makeCtx({ lastUpdateAt: Date.now() })

		const res = await ensureLiveAudioInputsHealthy(ctx, { slots, force: true })

		assert.equal(res.repaired.length, 1)
		assert.ok(rawCalls.some((c) => c.startsWith(`CLEAR ${slot.channel}-${slot.layer}`)))
		assert.ok(rawCalls.some((c) => c.startsWith(`PLAY ${slot.channel}-${slot.layer}`)))
	})
})
