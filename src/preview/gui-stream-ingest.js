'use strict'

/**
 * WO-319 — ingest lifecycle for the GUI live stream (server side).
 *
 * Pipeline: Caspar NVENC consumer (gui-stream-nvenc-args) → MPEG-TS on localhost UDP → system
 * ffmpeg remuxes to a raw Annex B elementary stream on stdout → h264-annexb-au-splitter → the
 * gui-stream-gop-buffer, which the WS relay serves clients from.
 *
 * LIFECYCLE IS REFCOUNTED, NOT ALWAYS-ON. The NVENC session, the UDP stream and the remux process
 * only exist while at least one browser client is watching the preview: `acquire()` on client
 * connect, `release()` on disconnect. The last release LINGERS a few seconds before tearing down —
 * a page reload must not thrash ADD/REMOVE on a live channel. This mirrors how the consumer was
 * live-verified (added and removed with zero disturbance to the on-air channel), and keeps the box
 * at 0 NVENC sessions whenever nobody is looking.
 *
 * CONSUMER INDEX: 730. Must never collide with this box's fixed indices — 720 is the meter-null
 * consumer on EVERY channel (src/audio/meter-null-consumer.js), 96 is the streaming/record
 * consumer, 600 is the screen consumer.
 *
 * The remux ffmpeg is plain `-c:v copy` — no decode, no filter; the ONE encode in the whole
 * pipeline stays on the NVENC block inside Caspar. TS from the mpegts demuxer is already Annex B,
 * so no bitstream filter is needed either.
 */

const { spawn } = require('child_process')
const { EventEmitter } = require('events')

const {
	buildGuiStreamAddCommand,
	buildGuiStreamRemoveCommand,
	DEFAULT_FPS,
	DEFAULT_GOP,
} = require('./gui-stream-nvenc-args')
const { createAuSplitter, pushChunk } = require('./h264-annexb-au-splitter')
const { createGopBuffer, pushFrame } = require('./gui-stream-gop-buffer')

/** See header — chosen clear of 720 (meter-null), 96 (record), 600 (screen). */
const GUI_STREAM_CONSUMER_INDEX = 730
/** Localhost UDP port for the TS hop; 9250–9260 verified free on this box. */
const GUI_STREAM_UDP_PORT = 9250
/** Teardown linger after the last client leaves — ride out page reloads. */
const DEFAULT_LINGER_MS = 5000
/** Backoff for restarting a died remux process while clients are still attached. */
const REMUX_RESTART_DELAY_MS = 1000

/**
 * ffmpeg arguments for the UDP→AnnexB remux hop. Pure, exported for tests.
 *
 * PROBE SETTINGS ARE LOAD-BEARING — verified live on this box 2026-07-22. The operator-GUI channel
 * is a near-static screen, so VBR NVENC emits big keyframes and tiny P-frames — an effective bitrate
 * of ~0.04 Mbps (video ES). At that trickle, the "obvious" low-latency posture
 * `-fflags nobuffer -analyzeduration 0 -probesize 65536` makes ffmpeg abandon stream detection
 * BEFORE the first keyframe arrives, so `-c:v copy` never latches and stdout stays empty forever
 * (0 access units — the exact symptom that cost the first live probe). ffmpeg must be allowed to
 * accumulate up to one GOP (~1s) to see SPS/PPS + IDR. `analyzeduration`/`probesize` are ceilings,
 * not fixed delays — a busy channel identifies in milliseconds; only a static one uses the full
 * second, which the 1s GOP imposes anyway. `-flags low_delay` (decoder low delay) is safe and kept;
 * `-fflags nobuffer` is NOT — it is what broke detection.
 * @param {number} port
 * @returns {string[]}
 */
function buildRemuxArgs(port) {
	return [
		'-hide_banner',
		'-loglevel', 'warning',
		'-flags', 'low_delay',
		'-probesize', '500000',
		'-analyzeduration', '1000000',
		// overrun_nonfatal: a stalled reader must degrade (drop) rather than kill the process.
		'-i', `udp://127.0.0.1:${port}?fifo_size=1048576&overrun_nonfatal=1`,
		'-map', '0:v:0',
		'-c:v', 'copy',
		// Latency: emit every packet the instant it is remuxed — no output buffering. Without this
		// ffmpeg can hold several frames before flushing pipe:1, adding tens of ms on top of the network.
		'-flush_packets', '1',
		'-max_delay', '0',
		'-f', 'h264',
		'pipe:1',
	]
}

/**
 * @param {{
 *   amcp: { raw: (cmd: string) => Promise<any> },
 *   log?: (level: string, msg: string) => void,
 *   channel: number,
 *   consumerIndex?: number,
 *   port?: number,
 *   scale?: string|null,
 *   bitrateKbps?: number,
 *   fps?: number,
 *   gop?: number,
 *   lingerMs?: number,
 *   restartDelayMs?: number,
 *   spawnImpl?: typeof spawn,
 * }} opts `scale` e.g. '1920:1080' to downscale a 2160p channel before encode.
 */
function createGuiStreamIngest(opts) {
	const log = opts.log || (() => {})
	const spawnImpl = opts.spawnImpl || spawn
	const channel = opts.channel
	const consumerIndex = opts.consumerIndex ?? GUI_STREAM_CONSUMER_INDEX
	const port = opts.port ?? GUI_STREAM_UDP_PORT
	const lingerMs = Number.isFinite(opts.lingerMs) ? opts.lingerMs : DEFAULT_LINGER_MS
	const restartDelayMs = Number.isFinite(opts.restartDelayMs) ? opts.restartDelayMs : REMUX_RESTART_DELAY_MS
	const fps = opts.fps ?? DEFAULT_FPS
	const gop = opts.gop ?? DEFAULT_GOP

	const ev = new EventEmitter()
	// Relay fan-out can exceed the default 10-listener heuristic; that warning would be noise here.
	ev.setMaxListeners(0)

	const state = {
		refs: 0,
		running: false,
		starting: false,
		buf: createGopBuffer({ maxGopFrames: Math.max(gop * 4, 200) }),
		splitter: createAuSplitter(),
		seq: 0,
		/** @type {import('child_process').ChildProcess|null} */
		proc: null,
		/** @type {NodeJS.Timeout|null} */
		lingerTimer: null,
		/** @type {NodeJS.Timeout|null} */
		restartTimer: null,
		consumerAdded: false,
		lastError: null,
	}

	function addCommand() {
		return buildGuiStreamAddCommand({
			channel,
			consumerIndex,
			port,
			args: { scale: opts.scale ?? null, bitrateKbps: opts.bitrateKbps, fps, gop },
		})
	}

	function spawnRemux() {
		const proc = spawnImpl('ffmpeg', buildRemuxArgs(port), { stdio: ['ignore', 'pipe', 'pipe'] })
		state.proc = proc
		proc.stdout.on('data', (chunk) => {
			for (const au of pushChunk(state.splitter, chunk)) {
				const frame = { seq: state.seq++, keyframe: au.keyframe, size: au.data.length, data: au.data }
				pushFrame(state.buf, frame)
				ev.emit('au', frame)
			}
		})
		let errTail = ''
		proc.stderr.on('data', (d) => {
			errTail = (errTail + d.toString()).slice(-2000)
		})
		proc.on('exit', (code, signal) => {
			if (state.proc !== proc) return
			state.proc = null
			if (!state.running) return // expected — we killed it during stop()
			state.lastError = `remux exited (code=${code} signal=${signal}) ${errTail.trim().slice(-300)}`
			log('warn', `[GUI stream] ${state.lastError} — restarting in ${restartDelayMs}ms`)
			state.restartTimer = setTimeout(() => {
				state.restartTimer = null
				if (state.running) spawnRemux()
			}, restartDelayMs)
		})
	}

	async function start() {
		if (state.running || state.starting) return
		state.starting = true
		try {
			// Reader FIRST, consumer second — Caspar starts sending the moment the ADD lands, and TS
			// before the reader binds the port is simply lost (worst case a client waits one GOP).
			spawnRemux()
			const cmd = addCommand()
			log('info', `[GUI stream] starting: ${cmd}`)
			await opts.amcp.raw(cmd)
			state.consumerAdded = true
			state.running = true
		} catch (e) {
			state.lastError = `start failed: ${e?.message || e}`
			log('warn', `[GUI stream] ${state.lastError}`)
			if (state.proc) {
				state.proc.kill('SIGTERM')
				state.proc = null
			}
			throw e
		} finally {
			state.starting = false
		}
	}

	async function stop() {
		state.running = false
		if (state.restartTimer) {
			clearTimeout(state.restartTimer)
			state.restartTimer = null
		}
		if (state.proc) {
			state.proc.kill('SIGTERM')
			state.proc = null
		}
		if (state.consumerAdded) {
			state.consumerAdded = false
			try {
				await opts.amcp.raw(buildGuiStreamRemoveCommand({ channel, consumerIndex }))
				log('info', `[GUI stream] consumer removed (${channel}-${consumerIndex})`)
			} catch (e) {
				// The REMOVE failing (e.g. Caspar restarted underneath us) must not leave the ingest
				// wedged — log it; a later start() re-ADDs idempotently at the same index.
				log('warn', `[GUI stream] REMOVE failed: ${e?.message || e}`)
			}
		}
		// Fresh assembly state for the next start — never leak half an AU across sessions.
		state.splitter = createAuSplitter()
		state.buf = createGopBuffer({ maxGopFrames: Math.max(gop * 4, 200) })
	}

	async function acquire() {
		state.refs++
		if (state.lingerTimer) {
			clearTimeout(state.lingerTimer)
			state.lingerTimer = null
		}
		if (!state.running && !state.starting) await start()
		return state.refs
	}

	function release() {
		state.refs = Math.max(0, state.refs - 1)
		if (state.refs > 0) return state.refs
		if (state.lingerTimer) clearTimeout(state.lingerTimer)
		state.lingerTimer = setTimeout(() => {
			state.lingerTimer = null
			if (state.refs === 0) {
				stop().catch((e) => log('warn', `[GUI stream] stop failed: ${e?.message || e}`))
			}
		}, lingerMs)
		return 0
	}

	/**
	 * Remove a consumer left at our index by a CRASHED previous run (highascg dying does not
	 * detach its Caspar consumers — without this, a stale NVENC session would encode forever).
	 * Best-effort: on a clean box the REMOVE simply errors and that is the expected case.
	 */
	async function cleanupStaleConsumer() {
		try {
			await opts.amcp.raw(buildGuiStreamRemoveCommand({ channel, consumerIndex }))
			log('info', `[GUI stream] removed stale consumer ${channel}-${consumerIndex} from a previous run`)
		} catch {
			/* nothing stale — the normal case */
		}
	}

	return {
		events: ev,
		acquire,
		release,
		stop,
		cleanupStaleConsumer,
		get buffer() {
			return state.buf
		},
		stats() {
			return {
				refs: state.refs,
				running: state.running,
				seq: state.seq,
				accepted: state.buf.accepted,
				channel,
				consumerIndex,
				port,
				lastError: state.lastError,
			}
		},
		// test hooks
		_state: state,
	}
}

module.exports = {
	GUI_STREAM_CONSUMER_INDEX,
	GUI_STREAM_UDP_PORT,
	DEFAULT_LINGER_MS,
	buildRemuxArgs,
	createGuiStreamIngest,
}
