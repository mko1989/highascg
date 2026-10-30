'use strict'

/**
 * WO-866 — `POST /api/audio/parts-capture { seconds }`: record the next `seconds` (1–120) of the samples the drum
 * detectors get (the FFT source: live-audio slot tee or own capture) to a WAV, replay them through a fresh
 * audio-parts.js hop by hop and store the hits (sample-exact) beside it. For tuning the WO-861 detectors against a
 * reference on real music; files go to ~/.highascg/cache/audio-captures/ (never the repo). Also the test-music source.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { JSON_HEADERS, jsonBody } = require('./response')
const { createAudioParts } = require('../audio/audio-parts')

const DRUMS = ['kick', 'snare', 'hats']

function captureDir() {
	return process.env.HIGHASCG_AUDIO_CAPTURE_DIR || path.join(os.homedir(), '.highascg', 'cache', 'audio-captures')
}

/** 16-bit mono PCM WAV. */
function wavOf(f32, rate) {
	const b = Buffer.alloc(44 + f32.length * 2)
	b.write('RIFF', 0)
	b.writeUInt32LE(36 + f32.length * 2, 4)
	b.write('WAVEfmt ', 8)
	b.writeUInt32LE(16, 16)
	b.writeUInt16LE(1, 20)
	b.writeUInt16LE(1, 22)
	b.writeUInt32LE(rate, 24)
	b.writeUInt32LE(rate * 2, 28)
	b.writeUInt16LE(2, 32)
	b.writeUInt16LE(16, 34)
	b.write('data', 36)
	b.writeUInt32LE(f32.length * 2, 40)
	for (let i = 0; i < f32.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, f32[i])) * 32767), 44 + i * 2)
	return b
}

/** Replay `f32` through a fresh detector in 512-sample pushes: each drum's hit times (ms from the start). */
function replayHits(f32, rate, opts = {}) {
	const parts = createAudioParts({ sampleRate: rate, ...opts })
	const hits = { kick: [], snare: [], hats: [] }
	const last = { kick: 0, snare: 0, hats: 0 }
	for (let at = 0; at + 512 <= f32.length; at += 512) {
		parts.push(f32.subarray(at, at + 512))
		const snap = parts.snapshot()
		for (const d of DRUMS) {
			const n = snap[d]?.n || 0
			if (n > last[d]) hits[d].push(Math.round(((at + 512) / rate) * 10000) / 10)
			last[d] = n
		}
	}
	return hits
}

/**
 * @param {object} ctx app context (recordAudioCapture from audio-capture-lifecycle.js)
 * @param {{ seconds?: unknown }} b parsed body
 */
async function handlePartsCapture(ctx, b) {
	if (typeof ctx?.recordAudioCapture !== 'function') {
		return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'no audio capture running' }) }
	}
	let f32
	try {
		f32 = await ctx.recordAudioCapture(Number(b?.seconds) || 20)
	} catch (e) {
		return { status: 409, headers: JSON_HEADERS, body: jsonBody({ error: String(e?.message || e) }) }
	}
	const rate = ctx.audioCaptureRate || 48000
	const dir = captureDir()
	fs.mkdirSync(dir, { recursive: true })
	const base = path.join(dir, new Date().toISOString().replace(/[:.]/g, '-'))
	fs.writeFileSync(base + '.wav', wavOf(f32, rate))
	const hits = replayHits(f32, rate)
	fs.writeFileSync(base + '.hits.json', JSON.stringify({ rate, seconds: f32.length / rate, hits }))
	const counts = Object.fromEntries(DRUMS.map((d) => [d, hits[d].length]))
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, wav: base + '.wav', hits: base + '.hits.json', counts }),
	}
}

/**
 * `POST /api/audio/test-music { file }` — a media file on the box (media-root relative, as the media browser lists it)
 * feeds the FFT / drum detectors instead of the live input, looped in real time; `{ stop: true }` gives the live input
 * back. For tests with nothing plugged into the input (owner 30.10). Not stored: a restart is back on the live input.
 */
function handleTestMusic(ctx, b) {
	if (typeof ctx?.audioTestMusic !== 'function') {
		return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'no audio capture running' }) }
	}
	if (b?.stop) return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, ...ctx.audioTestMusic(null) }) }
	const { resolveMediaFileOnDiskExact } = require('../media/local-media-paths')
	const abs = typeof b?.file === 'string' ? resolveMediaFileOnDiskExact(ctx.config, b.file) : null
	if (!abs) return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'no such media file' }) }
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, ...ctx.audioTestMusic(abs) }) }
}

/**
 * `GET|POST /api/audio/parts-sensitivity { kick?, snare?, hats? }` — the operator's per-drum sensitivity, 0..1 (0.5 = the
 * WO-866 tuning, higher = more hits). Stored in config.audioCapture.partsSensitivity (audio_capture.json) and applied live.
 */
function handleSensitivity(ctx, b) {
	const cur = { kick: 0.5, snare: 0.5, hats: 0.5, ...(ctx.config?.audioCapture?.partsSensitivity || {}) }
	if (b) {
		for (const d of DRUMS) {
			const v = Number(b[d])
			if (b[d] != null && Number.isFinite(v)) cur[d] = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100
		}
		ctx.config.audioCapture = { ...(ctx.config.audioCapture || {}), partsSensitivity: cur }
		if (ctx.configManager) ctx.configManager.save({ ...ctx.configManager.get(), audioCapture: ctx.config.audioCapture })
		if (typeof ctx.audioPartsSensitivity === 'function') ctx.audioPartsSensitivity(cur)
	}
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, sensitivity: cur }) }
}

module.exports = { handlePartsCapture, handleTestMusic, handleSensitivity, replayHits, wavOf }
