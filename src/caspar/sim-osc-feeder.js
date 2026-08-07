'use strict'

/**
 * WO-453: synthetic OSC for `offline_mode` / `--no-caspar`.
 *
 * The real server is OSC-authoritative for playback: timers, progress bars,
 * playlist auto-advance (WO-251) and clip-end fade all read OscState, which only
 * Caspar's UDP feed populates. In simulation nothing sends UDP, so this feeder
 * reports {@link SimPlaybackState} into `appCtx.oscState.handleOscMessage()` —
 * the exact ingress the UDP listener uses — every tick. Everything downstream
 * (state mirror, WS broadcast, playlist handler, variables) is the production
 * pipeline, untouched.
 *
 * Address schema follows the 2.6-dev binary (see osc-state-layer.js WO-235
 * notes): `.../foreground/producer` names the producer (no `type` leaf),
 * `.../foreground/file/time` carries [elapsed, duration].
 */

const TICK_MS = 200

function startSimOscFeeder(appCtx) {
	const sim = appCtx?.amcp?._simulated
	const oscState = appCtx?.oscState
	if (!sim || !oscState || typeof oscState.handleOscMessage !== 'function') return () => {}

	const emit = (address, args) => oscState.handleOscMessage({ address, args })

	const tick = () => {
		const state = sim.state
		const modes = sim.channelModes()
		modes.forEach((mode, i) => emit(`/channel/${i + 1}/format`, [mode]))

		for (const [ch, layers] of state.channels) {
			for (const [num, cell] of layers) {
				const base = `/channel/${ch}/stage/layer/${num}`
				const fg = cell.fg

				if (fg) {
					let elapsed = state.elapsedOf(cell)
					if (!fg.paused && !fg.loop && elapsed >= fg.duration) {
						// Natural end: AUTO background promotes (native LOADBG handoff —
						// playlist advance detection keys off the file-name change), else the
						// producer empties like a real ffmpeg producer teardown.
						if (cell.bg && cell.bg.auto) {
							cell.fg = { ...cell.bg, paused: false, startedAt: Date.now(), pausedElapsed: null }
							cell.bg = null
							elapsed = 0
						} else {
							cell.fg = null
							cell.emptiedAt = Date.now()
							emit(`${base}/foreground/producer`, ['empty'])
							continue
						}
					}
					const cur = cell.fg
					emit(`${base}/foreground/producer`, ['ffmpeg'])
					emit(`${base}/foreground/file/name`, [cur.clip])
					emit(`${base}/foreground/file/path`, [cur.clip])
					emit(`${base}/foreground/file/time`, [state.elapsedOf(cell) ?? 0, cur.duration])
					emit(`${base}/foreground/paused`, [cur.paused])
					emit(`${base}/foreground/loop`, [cur.loop])
				} else if (cell.cg) {
					emit(`${base}/foreground/producer`, ['html'])
				} else if (cell.emptiedAt && Date.now() - cell.emptiedAt < 2000) {
					// Keep reporting empty briefly so consumers see the transition, then let
					// OscState's stale-layer pruning drop the layer like the real feed does.
					emit(`${base}/foreground/producer`, ['empty'])
				}

				if (cell.bg) {
					emit(`${base}/background/producer`, ['ffmpeg'])
					emit(`${base}/background/file/name`, [cell.bg.clip])
				} else if (cell.fg) {
					emit(`${base}/background/producer`, ['empty'])
				}
			}
		}
	}

	const timer = setInterval(() => {
		try {
			tick()
		} catch (e) {
			appCtx.log?.('warn', `[SIM OSC] tick failed: ${e?.message || e}`)
		}
	}, TICK_MS)
	if (timer.unref) timer.unref()
	appCtx.log?.('info', `[SIM OSC] Synthetic OSC feeder on (${TICK_MS}ms tick) — sim playback drives the real OscState pipeline`)

	return () => clearInterval(timer)
}

module.exports = { startSimOscFeeder }
