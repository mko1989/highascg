'use strict'

/**
 * WO-974 — `config.ltc` (general.json) defaults + normalizer. Everything is off by default: LTC never opens an
 * audio device until the operator enables a direction and picks its device.
 */

const { fpsMode, parseTc, FPS_MODES } = require('./timecode-math')

const LTC_DEFAULTS = Object.freeze({
	fps: '25',
	libPath: '', // explicit libltc.so.11; '' = the system package (sudo apt install libltc11)
	input: Object.freeze({
		enabled: false,
		source: 'alsa', // 'alsa' | 'bridge' | 'fifo'
		device: '',
		channels: 2,
		channel: 1,
		slot: 1,
		path: '',
		lockFrames: 4,
		dropoutMs: 400,
		freewheelMs: 2000,
		chase: Object.freeze({
			enabled: false,
			timelineId: '', // '' = the timeline on air
			offset: '00:00:00:00', // LTC at timeline 0
			thresholdFrames: 3,
			stopOnLoss: true,
			latencyMs: 0,
			/** Chase locate = pause, seek this far ahead, resume when the LTC gets there: Caspar lands the seek while
			 * paused (box 06.11, 4K H.264 on PRV: content −50…−95 ms vs −326…−645 ms for a playing seek). 500 ms was
			 * too short for a backward jump into another clip (−212 / −252 ms, two runs); 800 lands it at −90 ms.
			 * 0 = seek in place. */
			prerollMs: 800,
		}),
	}),
	/** WO-1092: see the settings table in work/work-orders/1092_WO_ltc_out_settings_and_channel_pair.md. */
	output: Object.freeze({
		enabled: false,
		source: 'timeline', // 'timeline' | 'clock' (time of day) | 'test' (free-running from `offset`)
		sink: 'alsa', // 'alsa' | 'fifo'
		device: '', // ALSA PCM (plughw:CARD=<id>,DEV=<n>) or 'program' = the program audio output (shared, own channels)
		channels: 2, // channels on the device (filled from the device probe; the fallback when a busy card cannot be asked)
		channel: 1, // LTC on this channel …
		pair: false, // … and on the next one (the same signal on both)
		path: '',
		volumeDb: -18, // peak dBFS; −18 dBFS ≈ 0 dBu at EBU R68 alignment
		offset: '00:00:00:00', // LTC at timeline 0 (source timeline) / where the test clock starts (source test)
		fps: 'timeline', // 'timeline' = the on-air timeline's rate (50 → 25, 59.94 → 29.97 DF) or a forced LTC rate key
		latencyMs: 0, // delay LTC by this much (negative = earlier) to meet picture at the receiver
		whenPaused: 'silence', // 'silence' (a chasing reader parks) | 'hold' (repeat the paused frame)
		userBits: '', // '' or 8 hex digits, user-bit group 1 first
	}),
})

function int(v, lo, hi, d) {
	const n = parseInt(String(v ?? ''), 10)
	return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d
}

function num(v, lo, hi, d) {
	const n = Number(v)
	return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d
}

function str(v, d = '') {
	return typeof v === 'string' ? v.trim().slice(0, 512) : d
}

function tcText(v, d) {
	return parseTc(v) ? String(v).trim().replace(';', ':') : d
}

function oneOf(v, list, d) {
	return list.includes(v) ? v : d
}

const OUT_FPS = ['timeline', ...Object.keys(FPS_MODES)]

function hex8(v, d) {
	const t = typeof v === 'string' ? v.trim().toUpperCase() : ''
	return t === '' || /^[0-9A-F]{8}$/.test(t) ? t : d
}

/**
 * @param {unknown} raw config.ltc as stored (partial / legacy / garbage tolerated)
 * @param {object} [prev] the normalized section before an edit: an invalid timecode field keeps its previous value
 * @returns {typeof LTC_DEFAULTS}
 */
function normalizeLtcConfig(raw, prev) {
	const r = raw && typeof raw === 'object' ? raw : {}
	const i = r.input && typeof r.input === 'object' ? r.input : {}
	const c = i.chase && typeof i.chase === 'object' ? i.chase : {}
	const o = r.output && typeof r.output === 'object' ? r.output : {}
	const D = LTC_DEFAULTS
	const inChannels = int(i.channels, 1, 64, D.input.channels)
	const outChannels = int(o.channels, 1, 64, D.output.channels)
	return {
		fps: fpsMode(r.fps ?? D.fps).key,
		libPath: str(r.libPath),
		input: {
			enabled: i.enabled === true,
			source: oneOf(i.source, ['alsa', 'bridge', 'fifo'], D.input.source),
			device: str(i.device),
			channels: inChannels,
			channel: int(i.channel, 1, inChannels, 1),
			slot: int(i.slot, 1, 8, D.input.slot),
			path: str(i.path),
			lockFrames: int(i.lockFrames, 2, 25, D.input.lockFrames),
			dropoutMs: int(i.dropoutMs, 100, 5000, D.input.dropoutMs),
			freewheelMs: int(i.freewheelMs, 0, 30000, D.input.freewheelMs),
			chase: {
				enabled: c.enabled === true,
				timelineId: str(c.timelineId),
				offset: tcText(c.offset, prev?.input?.chase?.offset || D.input.chase.offset),
				thresholdFrames: int(c.thresholdFrames, 1, 250, D.input.chase.thresholdFrames),
				stopOnLoss: c.stopOnLoss !== false,
				latencyMs: int(c.latencyMs, -1000, 1000, 0),
				prerollMs: int(c.prerollMs, 0, 2000, D.input.chase.prerollMs),
			},
		},
		output: outputSection(o, outChannels, prev),
	}
}

function outputSection(o, outChannels, prev) {
	const D = LTC_DEFAULTS.output
	const pair = o.pair === true && outChannels >= 2
	const channel = int(o.channel, 1, pair ? outChannels - 1 : outChannels, 1)
	return {
		enabled: o.enabled === true,
		source: oneOf(o.source, ['timeline', 'clock', 'test'], D.source),
		sink: oneOf(o.sink, ['alsa', 'fifo'], D.sink),
		device: str(o.device),
		channels: outChannels,
		channel,
		pair,
		path: str(o.path),
		volumeDb: num(o.volumeDb, -60, 0, D.volumeDb),
		offset: tcText(o.offset, prev?.output?.offset || D.offset),
		fps: oneOf(String(o.fps ?? ''), OUT_FPS, D.fps),
		latencyMs: int(o.latencyMs, -500, 1000, D.latencyMs),
		whenPaused: oneOf(o.whenPaused, ['silence', 'hold'], D.whenPaused),
		userBits: hex8(o.userBits, prev?.output?.userBits ?? D.userBits),
	}
}

/** Why a direction cannot run with this config ('' = it can). */
function inputProblem(cfg) {
	const i = cfg.input
	if (i.source === 'alsa' && !i.device) return 'no input device chosen'
	if (i.source === 'fifo' && !i.path) return 'no input path'
	return ''
}

function outputProblem(cfg) {
	const o = cfg.output
	if (o.sink === 'alsa' && !o.device) return 'no output device chosen'
	if (o.sink === 'fifo' && !o.path) return 'no output path'
	return ''
}

module.exports = { normalizeLtcConfig, inputProblem, outputProblem }
