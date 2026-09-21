/**
 * WO-575 — ffprobe wrapper for the HAP encoder. `probeMedia` in local-media-ffmpeg.js is not reused:
 * it omits `pix_fmt` (alpha detection) and `nb_frames` (verification), and spawns a bare `ffprobe`.
 */

'use strict'

const { spawn } = require('child_process')
const { pixFmtHasAlpha } = require('./hap-encode-args')

const PROBE_TIMEOUT_MS = 30000

function parseRate(s) {
	const [n, d] = String(s || '')
		.split('/')
		.map(Number)
	return n > 0 && d > 0 ? n / d : 0
}

/**
 * @param {string} json raw ffprobe `-print_format json` output
 * @returns {object | null}
 */
function parseProbeJson(json) {
	let doc
	try {
		doc = JSON.parse(json)
	} catch {
		return null
	}
	const streams = Array.isArray(doc?.streams) ? doc.streams : []
	const vid = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
	const audioCodecs = streams.filter((s) => s.codec_type === 'audio').map((s) => String(s.codec_name || ''))
	const fmtDur = parseFloat(doc?.format?.duration)
	if (!vid) return { hasVideo: false, audioCodecs }
	const fps = parseRate(vid.r_frame_rate) || parseRate(vid.avg_frame_rate)
	const durationSec = parseFloat(vid.duration) > 0 ? parseFloat(vid.duration) : fmtDur > 0 ? fmtDur : 0
	const nb = parseInt(vid.nb_frames, 10)
	const frames = nb > 0 ? nb : 0
	return {
		hasVideo: true,
		codec: String(vid.codec_name || '').toLowerCase(),
		width: vid.width | 0,
		height: vid.height | 0,
		pixFmt: String(vid.pix_fmt || ''),
		hasAlpha: pixFmtHasAlpha(vid.pix_fmt),
		fps,
		frames,
		framesEst: frames || (durationSec > 0 && fps > 0 ? Math.round(durationSec * fps) : 0),
		durationSec,
		audioCodecs,
	}
}

/**
 * @param {string} ffprobeBin
 * @param {string} filePath
 * @param {typeof spawn} [spawnFn]
 * @returns {Promise<object | null>} null when ffprobe fails or times out
 */
function probeForHap(ffprobeBin, filePath, spawnFn = spawn) {
	return new Promise((resolve) => {
		let out = ''
		let settled = false
		const done = (v) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			resolve(v)
		}
		const ff = spawnFn(ffprobeBin, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath], {
			stdio: ['ignore', 'pipe', 'ignore'],
		})
		const timer = setTimeout(() => {
			try {
				ff.kill('SIGKILL')
			} catch {
				/* already gone */
			}
			done(null)
		}, PROBE_TIMEOUT_MS)
		ff.stdout?.on('data', (c) => {
			out += c
		})
		ff.on('error', () => done(null))
		ff.on('close', (code) => done(code === 0 ? parseProbeJson(out) : null))
	})
}

module.exports = { probeForHap, parseProbeJson }
