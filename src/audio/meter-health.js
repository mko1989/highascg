'use strict'

const { amcpInfoText } = require('../streaming/caspar-ffmpeg-setup')
const { listConfiguredLiveAudioSlots } = require('../config/live-audio-input')
const { ensureMeterNullConsumer, isMeterNullConsumerEnabled } = require('./meter-null-consumer')
const { ensureLiveAudioInputsHealthy, isLiveAlsaProducerHealthy } = require('./live-audio-health')

const DEFAULT_STALE_MS = 8000
// WO-164: 15 s watchdog tick, probe-on-suspicion design. Added after the owner
// was confused by an unconditional `INFO <ch>-<layer>` AMCP command going out
// every 15 s ("there is a INFO 6-10 amcp command going out every 15s WTF???").
// The watchdog itself is correct/wanted (it restarts a dead ALSA capture via
// CLEAR/PLAY), but it used to probe AMCP on every tick regardless of health.
// It now only sends the AMCP INFO probe when the OSC meter freshness check
// (DEFAULT_STALE_MS, see live-audio-health.js) says meters are stale/absent,
// or as part of the post-repair confirmation — so a healthy steady state
// produces zero periodic AMCP traffic. See work/work-orders/164_WO_LIVE_AUDIO_WATCHDOG_QUIET_INFO_PROBE.md.
const WATCH_INTERVAL_MS = 15000

/** @type {WeakMap<object, ReturnType<typeof setInterval>>} */
const watchTimers = new WeakMap()

/**
 * Push full OSC snapshot to all WS clients (UI reload / navigation hydration).
 * @param {object} ctx
 */
function broadcastOscSnapshot(ctx) {
	if (!ctx?.oscState || typeof ctx.oscState.getSnapshot !== 'function') return
	if (typeof ctx._wsBroadcast !== 'function') return
	ctx._wsBroadcast('osc', ctx.oscState.getSnapshot())
}

/**
 * @param {object} ctx
 * @param {{ staleMs?: number, force?: boolean, broadcastOsc?: boolean }} [opts]
 */
async function repairLiveInputMetersIfStale(ctx, opts = {}) {
	if (!ctx?.amcp?.isConnected) return { ok: false, reason: 'amcp_disconnected' }

	const { slots } = listConfiguredLiveAudioSlots(ctx?.config)
	if (!slots.length) return { ok: true, skipped: 'no_inputs' }

	const staleMs = opts.staleMs ?? DEFAULT_STALE_MS
	const now = Date.now()
	const snap = ctx.oscState?.getSnapshot?.()
	const channels = snap?.channels || {}
	let repaired = []

	if (isMeterNullConsumerEnabled(ctx?.config)) {
		for (const slot of slots) {
			const ch = slot.channel
			if (!Number.isFinite(ch)) continue
			const audio = channels[String(ch)]?.audio
			const lastAt = audio?._lastUpdateAt || 0
			const oscStale = !lastAt || now - lastAt > staleMs
			if (!opts.force && !oscStale) continue
			try {
				await ensureMeterNullConsumer(ctx.amcp, ch)
			} catch (e) {
				if (typeof ctx.log === 'function') {
					ctx.log('warn', `[meter] repair null consumer ch ${ch}: ${e?.message || e}`)
				}
			}
		}
	}

	const liveRes = await ensureLiveAudioInputsHealthy(ctx, { force: opts.force, staleMs, slots })
	repaired = liveRes.repaired || []

	if (repaired.length && opts.broadcastOsc !== false) {
		broadcastOscSnapshot(ctx)
	}

	return { ok: liveRes.ok !== false, repaired, failed: liveRes.failed }
}

/**
 * Periodic watchdog: re-attach null consumers / ALSA PLAY when input-channel OSC meters go stale.
 * @param {object} ctx
 */
function startLiveInputMeterHealthWatch(ctx) {
	stopLiveInputMeterHealthWatch(ctx)
	const { count } = listConfiguredLiveAudioSlots(ctx?.config)
	if (count <= 0) return

	const timer = setInterval(() => {
		void repairLiveInputMetersIfStale(ctx, { broadcastOsc: true }).catch((e) => {
			if (typeof ctx.log === 'function') {
				ctx.log('debug', `[meter] health watch: ${e?.message || e}`)
			}
		})
	}, WATCH_INTERVAL_MS)
	if (timer.unref) timer.unref()
	watchTimers.set(ctx, timer)
}

/**
 * @param {object} ctx
 */
function stopLiveInputMeterHealthWatch(ctx) {
	const t = watchTimers.get(ctx)
	if (t) {
		clearInterval(t)
		watchTimers.delete(ctx)
	}
}

module.exports = {
	broadcastOscSnapshot,
	repairLiveInputMetersIfStale,
	startLiveInputMeterHealthWatch,
	stopLiveInputMeterHealthWatch,
	isLiveAlsaProducerHealthy,
	amcpInfoText,
	DEFAULT_STALE_MS,
	WATCH_INTERVAL_MS,
}
