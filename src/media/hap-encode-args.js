/**
 * WO-575 — pure helpers for the media-browser "Encode to HAP" feature (no I/O, no spawn).
 * The queue (`hap-encode-queue.js`) owns processes and files; everything decidable from strings and
 * numbers lives here so it is unit-testable.
 */

'use strict'

const path = require('path')

/** Raw texture bytes per pixel, before the snappy second stage (upper bound for the disk check). */
const BYTES_PER_PX = { hap: 0.5, hap_alpha: 1, hap_q: 1 }

/** Audio codecs that can be stream-copied into a MOV; anything else is transcoded to PCM. */
const MOV_COPY_AUDIO = /^(pcm_|aac$|alac$|mp3$|ac3$|eac3$)/

/** ffprobe pix_fmt names that carry an alpha plane. */
const ALPHA_PIX_FMT = /^(yuva|gbrap|rgba|bgra|argb|abgr|ayuv|ya\d|pal8)/

const HAP_SUFFIX = '_HAP'

/**
 * FFmpeg's hap encoder has no HAP Q Alpha, so Alpha + HQ falls back to HAP Alpha (dropping alpha
 * silently would be worse than dropping the Q colour path) — WO-575 D1.
 * @param {{ alpha?: boolean, hq?: boolean }} opts
 * @returns {{ format: 'hap' | 'hap_alpha' | 'hap_q', downgraded: boolean }}
 */
function pickHapFormat(opts) {
	const alpha = opts?.alpha === true
	const hq = opts?.hq === true
	if (alpha) return { format: 'hap_alpha', downgraded: hq }
	if (hq) return { format: 'hap_q', downgraded: false }
	return { format: 'hap', downgraded: false }
}

/**
 * `<dir>/<stem>_HAP.mov` next to the source, whatever the source container was.
 * @param {string} srcPath absolute path of the resolved source file
 */
function deriveOutputPath(srcPath) {
	const dir = path.dirname(srcPath)
	const stem = path.basename(srcPath, path.extname(srcPath))
	return path.join(dir, `${stem}${HAP_SUFFIX}.mov`)
}

/** In-progress name; invisible to the media scanner (extension `.part`). */
function partPathFor(outPath) {
	return `${outPath}.part`
}

/**
 * Media-browser id of the encoded file, derived from the source id (informational).
 * @param {string} sourceId
 */
function deriveOutputId(sourceId) {
	const id = String(sourceId || '')
	const slash = id.lastIndexOf('/')
	const dir = slash >= 0 ? id.slice(0, slash + 1) : ''
	const leaf = slash >= 0 ? id.slice(slash + 1) : id
	const ext = path.extname(leaf)
	const stem = ext ? leaf.slice(0, -ext.length) : leaf
	return `${dir}${stem}${HAP_SUFFIX}${ext ? '.mov' : ''}`
}

/**
 * Upper bound on the output size: HAP stores whole 4×4 texture blocks.
 * @returns {number} bytes, 0 when the inputs are unusable
 */
function estimateOutputBytes({ width, height, frames, format }) {
	const w = Math.ceil(Number(width) / 4) * 4
	const h = Math.ceil(Number(height) / 4) * 4
	const f = Number(frames)
	const bpp = BYTES_PER_PX[format]
	if (!(w > 0) || !(h > 0) || !(f > 0) || !bpp) return 0
	return Math.ceil(w * h * f * bpp)
}

/** @param {string} pixFmt ffprobe `pix_fmt` */
function pixFmtHasAlpha(pixFmt) {
	return ALPHA_PIX_FMT.test(String(pixFmt || '').toLowerCase())
}

/**
 * @param {string[]} audioCodecs codec names of every audio stream in the source
 * @returns {'copy' | 'pcm_s16le' | 'none'}
 */
function pickAudioMode(audioCodecs) {
	if (!Array.isArray(audioCodecs) || audioCodecs.length === 0) return 'none'
	return audioCodecs.every((c) => MOV_COPY_AUDIO.test(String(c || '').toLowerCase())) ? 'copy' : 'pcm_s16le'
}

/**
 * FFmpeg's hap encoder refuses frames whose width or height is not a multiple of 4 ("Video size is
 * not multiple of 4" — found by the real-encoder test with a 70×50 source; 1366×768 / 854×480 would
 * hit it too). Resize to the NEAREST multiple of 4 (≤2 px change) rather than pad: a padded edge
 * would show as a thin black/transparent line, a sub-0.3 % stretch does not.
 * @returns {{ width: number, height: number, resized: boolean }}
 */
function hapSafeSize(width, height) {
	const r4 = (n) => Math.max(4, Math.round(Number(n) / 4) * 4)
	const w = r4(width)
	const h = r4(height)
	return { width: w, height: h, resized: w !== Number(width) || h !== Number(height) }
}

/**
 * ffmpeg argv (without the binary). Frame rate is deliberately NOT touched (WO-575 R6): no `-r`,
 * and `-fps_mode passthrough` so a VFR source is not duplicated/dropped into CFR.
 * @param {{ input: string, outputPart: string, format: string, audioMode: 'copy' | 'pcm_s16le' | 'none', scaleTo?: { width: number, height: number } | null }} p
 * @returns {string[]}
 */
function buildFfmpegArgs({ input, outputPart, format, audioMode, scaleTo }) {
	const args = [
		'-nostdin',
		'-hide_banner',
		'-v',
		'warning',
		'-progress',
		'pipe:1',
		'-nostats',
		'-i',
		input,
		'-map',
		'0:v:0',
	]
	if (audioMode !== 'none') args.push('-map', '0:a')
	args.push(
		'-c:v',
		'hap',
		'-format',
		format,
		'-compressor',
		'snappy',
		'-chunks',
		'4',
		'-pix_fmt',
		'rgba',
		'-fps_mode',
		'passthrough'
	)
	if (scaleTo) args.push('-vf', `scale=${scaleTo.width}:${scaleTo.height}:flags=lanczos`)
	if (audioMode !== 'none') args.push('-c:a', audioMode)
	args.push('-f', 'mov', outputPart)
	return args
}

/**
 * Most useful part of ffmpeg's stderr for a failure message: the error-looking lines (ffmpeg prints
 * the real cause first and a generic "nothing was written" last), else the last few lines.
 */
function summarizeStderr(text) {
	const lines = String(text || '')
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
	const errs = lines.filter((l) => /error|invalid|not multiple|unsupported|fail|no such|permission/i.test(l))
	return (errs.length ? errs.slice(0, 2) : lines.slice(-3)).join(' | ')
}

/** `ffprobe` next to a configured `ffmpeg` binary, else the bare name. */
function ffprobeBinFor(ffmpegBin) {
	const b = String(ffmpegBin || 'ffmpeg')
	if (b === 'ffmpeg') return 'ffprobe'
	const base = path.basename(b)
	return base === 'ffmpeg' ? path.join(path.dirname(b), 'ffprobe') : 'ffprobe'
}

/**
 * Feed stdout chunks from `-progress pipe:1`; returns the latest complete block's fields.
 * Blocks are `key=value` lines terminated by `progress=continue|end`.
 * @param {{ buf: string, cur: Record<string, string> }} state mutable parser state
 * @param {string} chunk
 * @returns {Array<Record<string, string>>} completed blocks, in order
 */
function feedProgress(state, chunk) {
	state.buf += chunk
	const out = []
	let nl
	while ((nl = state.buf.indexOf('\n')) >= 0) {
		const line = state.buf.slice(0, nl).trim()
		state.buf = state.buf.slice(nl + 1)
		const eq = line.indexOf('=')
		if (eq <= 0) continue
		const k = line.slice(0, eq)
		state.cur[k] = line.slice(eq + 1)
		if (k === 'progress') {
			out.push(state.cur)
			state.cur = {}
		}
	}
	return out
}

/**
 * @param {Record<string, string>} block one completed `-progress` block
 * @param {{ frames?: number, durationSec?: number }} total from the source probe
 * @returns {{ pct: number | null, speed: number | null }}
 */
function progressFromBlock(block, total) {
	const frame = Number(block.frame)
	let pct = null
	if (total?.frames > 0 && Number.isFinite(frame)) pct = frame / total.frames
	else {
		const us = Number(block.out_time_us ?? block.out_time_ms)
		if (total?.durationSec > 0 && Number.isFinite(us) && us >= 0) pct = us / 1e6 / total.durationSec
	}
	if (pct != null) pct = Math.max(0, Math.min(1, pct))
	const sp = parseFloat(String(block.speed || '').replace('x', ''))
	return { pct, speed: Number.isFinite(sp) ? sp : null }
}

/**
 * Compare an encoded `.part` against its source. Duration is compared (not just frame count)
 * because containers without `nb_frames` (mkv) can't be counted cheaply.
 * @param {{ codec?: string, width?: number, height?: number, durationSec?: number, frames?: number, fps?: number }} src
 * @param {typeof src} out
 * @returns {string | null} reason on mismatch, null when it matches
 */
function verifyEncoded(src, out) {
	if (out.codec !== 'hap') return `output codec is "${out.codec || 'unknown'}", expected hap`
	if (src.width !== out.width || src.height !== out.height) {
		return `output is ${out.width}×${out.height}, source is ${src.width}×${src.height}`
	}
	if (src.frames > 0 && out.frames > 0 && src.frames !== out.frames) {
		return `output has ${out.frames} frames, source has ${src.frames}`
	}
	if (src.durationSec > 0) {
		const tol = Math.max(2 / (src.fps > 0 ? src.fps : 25), 0.1)
		if (!(out.durationSec > 0) || Math.abs(out.durationSec - src.durationSec) > tol) {
			return `output duration ${out.durationSec ?? '?'}s differs from source ${src.durationSec}s`
		}
	}
	return null
}

module.exports = {
	HAP_SUFFIX,
	pickHapFormat,
	deriveOutputPath,
	partPathFor,
	deriveOutputId,
	estimateOutputBytes,
	pixFmtHasAlpha,
	pickAudioMode,
	hapSafeSize,
	buildFfmpegArgs,
	summarizeStderr,
	ffprobeBinFor,
	feedProgress,
	progressFromBlock,
	verifyEncoded,
}
