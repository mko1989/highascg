'use strict'

/**
 * WO-861 §3 smoke — live-audio recovery is single-flight per slot. Box 30.10: after a node restart the startup
 * routing and the meter watchdog both ran playLiveAlsaClipWithRecovery for slot 1; each restarted the bridge ffmpeg
 * under the other ("Device or resource busy" on the single-open USB card) and both gave up — no live audio.
 * (a) two concurrent recoveries of one slot → one PLAY, the same result; another slot still runs on its own.
 * (b) a forced bridge restart waits for the old ffmpeg to exit before spawning the next (source pin).
 * (c) the producer check polls INFO for a grace period (a fresh bridge was judged dead at 450 ms, playing 1 s later).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { playLiveAlsaClipWithRecovery } = require('../../src/audio/live-audio-health.js')

function fakeCtx() {
	const sent = []
	return {
		sent,
		// bridge off: the recovery is CLEAR → PLAY → INFO only
		config: { casparServer: { live_audio_capture_bridge: false } },
		amcp: {
			isConnected: true,
			raw: async (c) => {
				sent.push(c)
				await new Promise((r) => setTimeout(r, 5))
			},
			info: async () => ({ data: '<foreground><producer>ffmpeg</producer> alsa://hw:3,0</foreground>' }),
		},
	}
}

describe('WO-861 live-audio recovery single-flight', () => {
	it('(a) concurrent recoveries of one slot share one PLAY', async () => {
		const ctx = fakeCtx()
		const slot = { slot: 1, channel: 7, layer: 10, clip: 'alsa://hw:3,0' }
		const opts = { verifyMs: 1, verifyGraceMs: 0, clearSettleMs: 1, log: false }
		const [a, b] = await Promise.all([
			playLiveAlsaClipWithRecovery(ctx, slot, opts),
			playLiveAlsaClipWithRecovery(ctx, slot, opts),
		])
		assert.equal(a.ok, true)
		assert.deepEqual(a, b)
		assert.equal(ctx.sent.filter((c) => c.startsWith('PLAY 7-10')).length, 1)
		const other = await Promise.all([
			playLiveAlsaClipWithRecovery(ctx, slot, opts),
			playLiveAlsaClipWithRecovery(ctx, { ...slot, slot: 2, channel: 8 }, opts),
		])
		assert.ok(other.every((r) => r.ok))
		assert.equal(ctx.sent.filter((c) => c.startsWith('PLAY')).length, 3) // the finished one does not block a new run
	})

	it('(c) a producer that comes up after the first INFO is not judged dead (polled within the grace)', async () => {
		const ctx = fakeCtx()
		let n = 0
		ctx.amcp.info = async () => ({
			data:
				++n < 3
					? '<foreground><type>empty</type></foreground>'
					: '<foreground><producer>ffmpeg</producer> alsa://hw:3,0</foreground>',
		})
		const slot = { slot: 3, channel: 7, layer: 10, clip: 'alsa://hw:3,0' }
		const r = await playLiveAlsaClipWithRecovery(ctx, slot, {
			verifyMs: 1,
			verifyGraceMs: 1500,
			clearSettleMs: 1,
			log: false,
		})
		assert.equal(r.ok, true)
		assert.equal(n, 3)
		const dead = fakeCtx()
		dead.amcp.info = async () => ({ data: '<foreground><type>empty</type></foreground>' })
		const d = await playLiveAlsaClipWithRecovery(
			dead,
			{ ...slot, slot: 4 },
			{ verifyMs: 1, verifyGraceMs: 400, clearSettleMs: 1, log: false }
		)
		assert.equal(d.ok, false)
	})

	it('(b) a forced bridge restart awaits the old ffmpeg exit before spawning', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/audio/live-audio-bridge.js'), 'utf8')
		const fn = src.slice(
			src.indexOf('async function ensureLiveAudioBridge'),
			src.indexOf('async function restartLiveAudioBridge')
		)
		assert.match(fn, /prev\.kill\('SIGTERM'\)/)
		assert.match(fn, /prev\.once\('close'/)
		assert.ok(fn.indexOf("prev.once('close'") < fn.indexOf('startLiveAudioBridge(ctx, n)'))
	})
})
