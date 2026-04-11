/**
 * POST /api/pgm-record — start/stop recording program channel output on the CasparCG host (FFmpeg FILE consumer).
 *
 * Uses Caspar AMCP: ADD &lt;ch&gt;-&lt;idx&gt; FILE &lt;path&gt; …ffmpeg args… — see Caspar FFmpeg consumer docs.
 * Compression defaults: H.264 (libx264) + AAC stereo; tune via env HIGHASCG_PGM_RECORD_CRF (default 26).
 */

'use strict'

const path = require('path')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getChannelMap } = require('../config/routing')
const { param } = require('../caspar/amcp-utils')

/** Dedicated consumer slot so REMOVE does not touch screen / stream consumers */
const PGM_RECORD_CONSUMER_INDEX = 98

/**
 * INFO PATHS / INFO CONFIG XML from Caspar includes {@code <media-path>…</media-path>} with the **resolved** folder on the server.
 * @param {string|string[]|undefined} blob
 * @returns {string}
 */
function parseMediaPathFromBlob(blob) {
	const s = blob == null ? '' : Array.isArray(blob) ? blob.join('\n') : String(blob)
	if (!s) return ''
	const m = s.match(/<media-path>\s*([^<]+?)\s*<\/media-path>/i)
	return m ? m[1].trim() : ''
}

function isAbsolutePath(p) {
	const s = String(p || '').trim()
	return s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s)
}

/**
 * Join directory + filename for the path Caspar will use (POSIX on Linux, win32 on drive paths).
 * @param {string} dir
 * @param {string} file
 */
function joinCasparMediaFile(dir, file) {
	const d = String(dir || '').trim().replace(/[/\\]+$/, '')
	if (!d) return file
	if (/^[A-Za-z]:[\\/]/.test(d)) return path.win32.join(d, file)
	return path.posix.join(d.replace(/\\/g, '/'), file.replace(/\\/g, '/'))
}

/**
 * Directory on the **CasparCG host** to write recordings into (same tree as CLS / media).
 * Override with env HIGHASCG_PGM_RECORD_DIR; otherwise INFO PATHS, then absolute media-path in INFO CONFIG, then config.local_media_path.
 * @param {object} ctx
 * @returns {Promise<string|null>}
 */
async function resolveCasparMediaDir(ctx) {
	const ov = process.env.HIGHASCG_PGM_RECORD_DIR
	if (ov && String(ov).trim()) return String(ov).trim()

	let p = parseMediaPathFromBlob(ctx.gatheredInfo?.infoPaths)
	if (p) return p

	try {
		if (ctx.amcp?.query?.infoPaths) {
			const r = await ctx.amcp.query.infoPaths()
			p = parseMediaPathFromBlob(r?.data)
			if (p) return p
		}
	} catch (e) {
		if (typeof ctx.log === 'function') ctx.log('debug', `[PGM record] INFO PATHS query: ${e?.message || e}`)
	}

	p = parseMediaPathFromBlob(ctx.gatheredInfo?.infoConfig)
	if (p && isAbsolutePath(p)) return p

	const local = (ctx.config?.local_media_path || '').trim()
	if (local) return isAbsolutePath(local) ? local : path.resolve(local)

	return null
}

function defaultCrf() {
	const n = parseInt(process.env.HIGHASCG_PGM_RECORD_CRF || '26', 10)
	if (Number.isFinite(n) && n >= 18 && n <= 51) return n
	return 26
}

/**
 * PGM can be multichannel; `-ac:a 2` breaks AAC init ("Unsupported channel layout …").
 * Resample + aformat to stereo before AAC. Override with HIGHASCG_PGM_RECORD_AFILTER (full filter graph, no `-filter:a` prefix).
 * Video-only: HIGHASCG_PGM_RECORD_NO_AUDIO=1
 */
function buildFfmpegArgs(crf) {
	const noAudio =
		process.env.HIGHASCG_PGM_RECORD_NO_AUDIO === '1' || String(process.env.HIGHASCG_PGM_RECORD_NO_AUDIO || '').toLowerCase() === 'true'
	const video = [
		`-codec:v libx264`,
		`-preset:v veryfast`,
		`-crf:v ${crf}`,
		`-tune:v zerolatency`,
		`-filter:v format=yuv420p`,
	].join(' ')
	if (noAudio) return `${video} -an`

	const af =
		String(process.env.HIGHASCG_PGM_RECORD_AFILTER || '').trim() ||
		'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo'
	return [
		video,
		`-filter:a ${af}`,
		`-codec:a aac`,
		`-b:a 128k`,
	].join(' ')
}

/** Consumer already removed (crashed or manual) — treat stop as OK. */
function isRemoveNotFoundError(err) {
	const msg = err?.message || String(err || '')
	return /404\s+REMOVE\s+FAILED/i.test(msg) || /MEDIAFILE_NOT_FOUND.*REMOVE/i.test(msg)
}

/**
 * @param {object} ctx
 */
function handleGet(ctx) {
	const r = ctx.pgmRecord
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			recording: !!(r && r.active),
			path: r?.path || null,
			mediaDir: r?.mediaDir || null,
			channel: r?.channel ?? null,
			consumerIndex: PGM_RECORD_CONSUMER_INDEX,
		}),
	}
}

/**
 * @param {string} body
 * @param {object} ctx
 */
async function handlePost(body, ctx) {
	if (!ctx.amcp) {
		return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
	}

	const b = parseBody(body)
	const action = b.action === 'stop' ? 'stop' : 'start'
	const map = getChannelMap(ctx.config || {})
	const channel = map.programCh(1)
	const crf =
		b.crf != null && Number.isFinite(Number(b.crf)) ? Math.min(51, Math.max(18, Math.round(Number(b.crf)))) : defaultCrf()

	if (!ctx.pgmRecord) ctx.pgmRecord = { active: false, path: null, channel: null, mediaDir: null }

	if (action === 'start') {
		if (ctx.pgmRecord.active) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Already recording — stop first' }) }
		}
		const dir = await resolveCasparMediaDir(ctx)
		if (!dir) {
			return {
				status: 502,
				headers: JSON_HEADERS,
				body: jsonBody({
					error:
						'Could not resolve Caspar media folder. Wait until the server has sent INFO PATHS, set Settings → Local media path to the Caspar media directory, or set HIGHASCG_PGM_RECORD_DIR on the HighAsCG host.',
				}),
			}
		}
		const base = `highascg_pgm_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`
		const absPath = joinCasparMediaFile(dir, base)
		const args = buildFfmpegArgs(crf)
		const paramsAfterPath = `${param(absPath)} ${args}`
		try {
			const res = await ctx.amcp.basic.add(channel, 'FILE', paramsAfterPath, PGM_RECORD_CONSUMER_INDEX)
			ctx.pgmRecord = { active: true, path: absPath, channel, mediaDir: dir }
			ctx.log('info', `[PGM record] started ch${channel} → ${absPath} (${res?.data != null ? String(res.data) : 'OK'})`)
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({
					ok: true,
					recording: true,
					path: absPath,
					mediaDir: dir,
					channel,
					crf,
					amcp: res,
				}),
			}
		} catch (e) {
			const msg = e?.message || String(e)
			ctx.log('warn', `[PGM record] start failed: ${msg}`)
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
		}
	}

	/* stop */
	if (!ctx.pgmRecord.active) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Not recording' }) }
	}
	const ch = ctx.pgmRecord.channel ?? channel
	const outPath = ctx.pgmRecord.path
	try {
		const res = await ctx.amcp.basic.remove(ch, null, PGM_RECORD_CONSUMER_INDEX)
		ctx.log('info', `[PGM record] stopped ch${ch} (${res?.data != null ? String(res.data) : 'OK'})`)
		ctx.pgmRecord = { active: false, path: null, channel: null, mediaDir: null }
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, recording: false, path: outPath, amcp: res }),
		}
	} catch (e) {
		const msg = e?.message || String(e)
		if (isRemoveNotFoundError(e)) {
			if (typeof ctx.log === 'function') {
				ctx.log('info', `[PGM record] stop: consumer already gone (ffmpeg may have exited): ${msg}`)
			}
			ctx.pgmRecord = { active: false, path: null, channel: null, mediaDir: null }
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({
					ok: true,
					recording: false,
					path: outPath,
					warning: 'Consumer was already removed (recording may have failed — check Caspar logs).',
				}),
			}
		}
		ctx.pgmRecord = { active: false, path: null, channel: null, mediaDir: null }
		if (typeof ctx.log === 'function') ctx.log('warn', `[PGM record] stop: ${msg} (state cleared)`)
		return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
	}
}

module.exports = { handleGet, handlePost, PGM_RECORD_CONSUMER_INDEX }
