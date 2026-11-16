'use strict'

/**
 * WO-974 — spawn wrapper for tools/ltc/ltc_helper.py (libltc via ctypes). The helper owns the LTC
 * biphase encode/decode; node owns sources, sinks, lock state and the timeline.
 */

const path = require('path')
const { spawn, spawnSync } = require('child_process')

const HELPER = path.join(__dirname, '..', '..', 'tools', 'ltc', 'ltc_helper.py')
const LTC_SAMPLE_RATE = 48000
const APT_HINT = 'sudo apt install libltc11'

let _probe = null
let _libPath = ''

function python() {
	return process.env.HIGHASCG_PYTHON || 'python3'
}

/** config.ltc.libPath: an explicit libltc.so.11 (empty = the system libltc11 / HIGHASCG_LIBLTC). */
function setLibPath(p) {
	const next = typeof p === 'string' ? p.trim() : ''
	if (next !== _libPath) _probe = null
	_libPath = next
}

function childEnv() {
	return _libPath ? { ...process.env, HIGHASCG_LIBLTC: _libPath } : process.env
}

/**
 * Is libltc loadable? Cached per process (a fresh `apt install` is picked up by the next node start or `{fresh:true}`).
 * @returns {{ ok: boolean, lib?: string, error?: string }}
 */
function probeLibltc(opts = {}) {
	if (_probe && !opts.fresh) return _probe
	try {
		const r = spawnSync(python(), ['-I', HELPER, 'probe'], { encoding: 'utf8', timeout: 5000, env: childEnv() })
		const line = String(r.stdout || '').trim().split('\n').pop() || ''
		_probe = line ? JSON.parse(line) : { ok: false, error: String(r.stderr || r.error || 'no output').slice(0, 200) }
	} catch (e) {
		_probe = { ok: false, error: e instanceof Error ? e.message : String(e) }
	}
	if (!_probe.ok) _probe.hint = APT_HINT
	return _probe
}

/** @param {{ fps: number }} mode */
function fpsArg(mode) {
	if (Math.abs(mode.fps - 30000 / 1001) < 1e-3) return '29.97'
	if (Math.abs(mode.fps - 24000 / 1001) < 1e-3) return '23.976'
	return String(mode.fps)
}

/**
 * @param {{ fps: number, df: boolean }} mode
 * @param {{ channels?: number, channel?: number }} [opts]
 */
function spawnDecoder(mode, opts = {}) {
	const args = ['-I', HELPER, 'decode', '--rate', String(LTC_SAMPLE_RATE), '--fps', fpsArg(mode)]
	args.push('--channels', String(opts.channels || 1), '--channel', String(opts.channel || 1))
	return spawn(python(), args, { stdio: ['pipe', 'pipe', 'pipe'], env: childEnv() })
}

/**
 * @param {{ fps: number, df: boolean }} mode
 * @param {{ channels?: number, channel?: number|number[], volume?: number, start?: string, stopped?: boolean, report?: number,
 *   realtime?: boolean, alsa?: string, latencyMs?: number, sinkCmd?: string[], sinkLatencyMs?: number, userBits?: string }} [opts]
 *   alsa: play to that ALSA PCM in-process (WO-1092); sinkCmd: a player the helper starts on a real 4 KiB pipe (tests);
 *   neither: PCM on stdout. channel: one 1-based channel or a list (the same LTC on each).
 */
function spawnEncoder(mode, opts = {}) {
	const args = ['-I', HELPER, 'encode', '--rate', String(LTC_SAMPLE_RATE), '--fps', fpsArg(mode)]
	const ch = Array.isArray(opts.channel) ? opts.channel.join(',') : String(opts.channel || 1)
	args.push('--channels', String(opts.channels || 1), '--channel', ch)
	args.push('--volume', String(Number.isFinite(opts.volume) ? opts.volume : -18))
	args.push('--start', opts.start || '00:00:00:00', '--report', String(opts.report ?? 5))
	if (Math.abs(mode.fps - 30000 / 1001) < 1e-3) args.push('--df', mode.df ? '1' : '0')
	if (opts.userBits) args.push('--userbits', opts.userBits)
	if (opts.stopped) args.push('--stopped')
	if (opts.realtime) args.push('--realtime')
	if (opts.alsa) args.push('--alsa', opts.alsa, '--latency-ms', String(opts.latencyMs ?? 60))
	else if (Array.isArray(opts.sinkCmd) && opts.sinkCmd.length) {
		args.push('--sink-cmd', JSON.stringify(opts.sinkCmd), '--sink-latency-ms', String(opts.sinkLatencyMs ?? 0))
	}
	return spawn(python(), args, { stdio: ['pipe', 'pipe', 'pipe'], env: childEnv() })
}

/**
 * Line splitter for a child's stdout/stderr.
 * @param {import('stream').Readable} stream
 * @param {(line: string) => void} onLine
 */
function onLines(stream, onLine) {
	let buf = ''
	stream.setEncoding('utf8')
	stream.on('data', (chunk) => {
		buf += chunk
		let i
		while ((i = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, i).trim()
			buf = buf.slice(i + 1)
			if (line) onLine(line)
		}
		if (buf.length > 65536) buf = ''
	})
}

module.exports = { HELPER, LTC_SAMPLE_RATE, APT_HINT, probeLibltc, setLibPath, spawnDecoder, spawnEncoder, onLines }
