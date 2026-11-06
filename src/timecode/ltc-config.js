'use strict'

/**
 * WO-974 — `config.ltc` (general.json) defaults + normalizer. Everything is off by default: LTC never opens an
 * audio device until the operator enables a direction and picks its device.
 */

const { fpsMode, parseTc } = require('./timecode-math')

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
		}),
	}),
	output: Object.freeze({
		enabled: false,
		source: 'timeline', // 'timeline' | 'clock'
		sink: 'alsa', // 'alsa' | 'fifo'
		device: '',
		channels: 2,
		channel: 1,
		path: '',
		volumeDb: -18,
		offset: '00:00:00:00', // LTC at timeline 0
		leadMs: 60,
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
			},
		},
		output: {
			enabled: o.enabled === true,
			source: oneOf(o.source, ['timeline', 'clock'], D.output.source),
			sink: oneOf(o.sink, ['alsa', 'fifo'], D.output.sink),
			device: str(o.device),
			channels: outChannels,
			channel: int(o.channel, 1, outChannels, 1),
			path: str(o.path),
			volumeDb: num(o.volumeDb, -60, 0, D.output.volumeDb),
			offset: tcText(o.offset, prev?.output?.offset || D.output.offset),
			leadMs: int(o.leadMs, 0, 1000, D.output.leadMs),
		},
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
