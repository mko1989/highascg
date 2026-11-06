'use strict'

/**
 * WO-974 — LTC reader: an audio source (ALSA capture, the live-audio bridge's LTC tee, or a FIFO) → libltc decoder
 * helper → LtcLock. Restarts its pipeline with a back-off when a process exits.
 *
 * Sources (config.ltc.input.source):
 *   'alsa'   arecord -D <device> -c <channels>, LTC on <channel>. Opens the device itself — only for a device nothing
 *            else holds (hw: devices are single-open; the DM3 is the live-audio bridge's).
 *   'bridge' the live-audio bridge slot <slot> tees channel <channel> as s16le mono to UDP 52240+slot
 *            (live-audio-bridge.js), so the bridge stays the device's only opener.
 *   'fifo'   s16le mono from a path (named pipe — the software loopback used for verification).
 */

const dgram = require('dgram')
const { spawn } = require('child_process')
const { spawnDecoder, onLines, LTC_SAMPLE_RATE } = require('./ltc-helper')
const { LtcLock } = require('./ltc-lock')
const { fpsMode, tcToFrames } = require('./timecode-math')

const LTC_BRIDGE_UDP_PORT_BASE = 52240
const RESTART_MS = 2000

function ltcBridgeUdpPort(slot) {
	return LTC_BRIDGE_UDP_PORT_BASE + (parseInt(String(slot), 10) || 0)
}

/**
 * @param {{ cfg: object, fps: unknown, log?: Function, onFrame?: Function }} deps cfg = normalized config.ltc.input
 */
function createLtcInput({ cfg, fps, log = () => {}, onFrame }) {
	const mode = fpsMode(fps)
	const lock = new LtcLock({ fps: mode.key, lockFrames: cfg.lockFrames, dropoutMs: cfg.dropoutMs, freewheelMs: cfg.freewheelMs })
	let stopped = false
	let decoder = null
	let feeder = null // child process or dgram socket or read stream
	let timer = null
	let lastError = ''
	let lastVol = null
	let starts = 0

	function fail(msg) {
		lastError = String(msg || '').slice(0, 240)
		log('warn', `[LTC in] ${lastError}`)
	}

	function teardown() {
		const d = decoder
		const f = feeder
		decoder = null
		feeder = null
		try {
			if (f && typeof f.kill === 'function') f.kill('SIGKILL')
			else if (f && typeof f.close === 'function') f.close()
			else if (f && typeof f.destroy === 'function') f.destroy()
		} catch {
			/* already gone */
		}
		try {
			d?.stdin?.destroy()
			d?.kill('SIGKILL')
		} catch {
			/* already gone */
		}
	}

	function scheduleRestart(why) {
		if (stopped || timer) return
		if (why) fail(why)
		teardown()
		timer = setTimeout(() => {
			timer = null
			start()
		}, RESTART_MS)
	}

	function attachFeeder(sink) {
		if (cfg.source === 'bridge') {
			const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
			sock.on('message', (msg) => sink.write(msg))
			sock.on('error', (e) => scheduleRestart(`UDP ${ltcBridgeUdpPort(cfg.slot)}: ${e.message}`))
			sock.bind(ltcBridgeUdpPort(cfg.slot), '127.0.0.1')
			return sock
		}
		if (cfg.source === 'fifo') {
			/* WO-974 incident 06.11: node must never open() a FIFO itself — with no writer the open blocks a libuv
			 * worker in the kernel (wait_for_partner) and not even process.exit gets past it (node hung 4 min on
			 * shutdown). A `cat` child does the blocking open; SIGKILL ends it wherever it is. */
			const p = spawn('cat', ['--', cfg.path], { stdio: ['ignore', 'pipe', 'pipe'] })
			p.on('error', (e) => scheduleRestart(`cat ${cfg.path}: ${e.message}`))
			p.stderr.on('data', (b) => (lastError = String(b).trim().slice(0, 240)))
			p.on('close', (code) => scheduleRestart(`${cfg.path}: end of stream (${code})`))
			p.stdout.pipe(sink, { end: false })
			return p
		}
		const args = ['-q', '-D', cfg.device, '-t', 'raw', '-f', 'S16_LE', '-r', String(LTC_SAMPLE_RATE), '-c', String(cfg.channels)]
		const p = spawn('arecord', args, { stdio: ['ignore', 'pipe', 'pipe'] })
		p.on('error', (e) => scheduleRestart(`arecord: ${e.message}`))
		p.stderr.on('data', (b) => (lastError = String(b).trim().slice(0, 240)))
		p.on('close', (code) => scheduleRestart(`arecord -D ${cfg.device} exited ${code}${lastError ? `: ${lastError}` : ''}`))
		p.stdout.pipe(sink, { end: false })
		return p
	}

	function start() {
		if (stopped) return
		starts++
		const chan = cfg.source === 'alsa' ? { channels: cfg.channels, channel: cfg.channel } : {}
		const d = spawnDecoder(mode, chan)
		decoder = d
		d.on('error', (e) => scheduleRestart(`decoder: ${e.message}`))
		d.on('close', (code) => {
			if (decoder === d) scheduleRestart(code === 3 ? 'libltc missing (sudo apt install libltc11)' : `decoder exited ${code}`)
		})
		d.stdin.on('error', () => {})
		d.stderr.on('data', (b) => (lastError = String(b).trim().slice(0, 240)))
		onLines(d.stdout, (line) => {
			let rec
			try {
				rec = JSON.parse(line)
			} catch {
				return
			}
			const now = Date.now()
			lock.push(tcToFrames(rec, mode), now)
			lastVol = rec.vol
			if (lastError && lock.state(now) === 'locked') lastError = ''
			onFrame?.(rec, now)
		})
		try {
			feeder = attachFeeder(d.stdin)
		} catch (e) {
			scheduleRestart(e instanceof Error ? e.message : String(e))
		}
	}

	function stop() {
		stopped = true
		if (timer) clearTimeout(timer)
		timer = null
		teardown()
	}

	function status(now = Date.now()) {
		const where = cfg.source === 'bridge' ? `bridge slot ${cfg.slot}` : cfg.source === 'fifo' ? cfg.path : cfg.device
		return {
			...lock.snapshot(now),
			fps: mode.key,
			source: cfg.source,
			where,
			channel: cfg.source === 'alsa' ? cfg.channel : 1,
			volumeDb: lastVol,
			error: lastError || null,
			starts,
		}
	}

	return { start, stop, status, lock, mode }
}

module.exports = { createLtcInput, ltcBridgeUdpPort }
