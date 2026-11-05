'use strict'

/**
 * WO-947 — is a running stream actually reaching its receiver?
 *
 * HighAsCG marks a stream active when Caspar answers `202 ADD OK`; after that it never heard from the consumer again. When
 * the receiver goes away, Caspar's ffmpeg STREAM consumer (upstream PR #1727, in the fork) retries once a second and logs
 *   [2026-11-05 08:56:53.010] [warning] ffmpeg[rtmp://host/app/key] Connection lost. Attempting reconnection in 1000ms
 *   [2026-11-05 08:56:54.017] [info]    ffmpeg[rtmp://host/app/key] Attempting reconnect...
 * on every attempt, and nothing once it is through again — while the status kept saying active / no error (box, 04.11:
 * listener gone, 30 s of "Connection refused", the inspector and the header showed a healthy stream).
 *
 * The last line naming this consumer decides: a "Connection lost" or "Attempting reconnect" newer than STALE_MS →
 * reconnecting (since the first failure of that run); anything else → connected. The URL is matched in full (it is the
 * consumer's own name in the log) and never returned.
 */

const STALE_MS = 8000 // RTMP retries every ~1 s, SRT every ~4 s (1 s wait + its 3 s connect timeout): older = through again
const CACHE_MS = 1000 // the status is polled; read the log at most once a second
const TAIL_LINES = 600
const TAIL_BYTES = 256 * 1024

const LINE_RE = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})\][^\]]*\]\s+ffmpeg\[(.*?)\] (.*)$/

/** Local-time ms of a Caspar log line's timestamp (Caspar logs local time). */
function lineTime(m) {
	return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]).getTime()
}

const isFailure = (msg) => /^Connection lost\b|^Attempting reconnect/i.test(msg)

/**
 * @param {string} url the consumer's URL exactly as it was ADDed (unredacted)
 * @param {string[]} lines the tail of today's Caspar log
 * @param {number} nowMs
 * @returns {{ state: 'connected' | 'reconnecting', sinceMs: number | null, attempts: number }}
 */
function streamLinkState(url, lines, nowMs) {
	const ok = { state: 'connected', sinceMs: null, attempts: 0 }
	if (!url || !Array.isArray(lines)) return ok
	let last = null
	let since = null
	let attempts = 0
	for (const raw of lines) {
		const m = LINE_RE.exec(String(raw))
		if (!m || m[8] !== url) continue
		const t = lineTime(m)
		if (isFailure(m[9])) {
			if (since == null) since = t
			if (/^Connection lost/i.test(m[9])) attempts += 1
		} else {
			since = null // Initialized / anything else: a new run of the consumer
			attempts = 0
		}
		last = { t, failure: isFailure(m[9]) }
	}
	if (!last || !last.failure || nowMs - last.t > STALE_MS) return ok
	return { state: 'reconnecting', sinceMs: since, attempts }
}

let cache = { at: 0, path: '', lines: [] }

/**
 * The link state of the running stream in `rtmp` (ctx.streamingChannelRtmp), reading the Caspar log tail (cached).
 * @param {{ active?: boolean, url?: string | null }} rtmp
 * @param {{ logPath?: string, nowMs?: number, readTail?: (path: string, lines: number, bytes: number) => string[] }} [opts]
 */
function runningStreamLink(rtmp, opts = {}) {
	if (!rtmp || !rtmp.active || !rtmp.url) return null
	const now = opts.nowMs ?? Date.now()
	const { tailFileLines, resolveCasparLogPath } = require('../api/routes-logs')
	const path = opts.logPath || resolveCasparLogPath()
	const read = opts.readTail || tailFileLines
	if (opts.readTail || cache.path !== path || now - cache.at > CACHE_MS) {
		cache = { at: now, path, lines: read(path, TAIL_LINES, TAIL_BYTES) }
	}
	return streamLinkState(String(rtmp.url), cache.lines, now)
}

/** The operator-facing error for a reconnecting link ("" when connected). */
function linkErrorText(link) {
	if (!link || link.state !== 'reconnecting') return ''
	const at = link.sinceMs ? new Date(link.sinceMs).toTimeString().slice(0, 8) : ''
	return `Receiver not reachable — Caspar keeps retrying${at ? ` since ${at}` : ''}${link.attempts ? ` (${link.attempts} attempt${link.attempts === 1 ? '' : 's'})` : ''}`
}

/**
 * Watch the running stream's link while it runs: `onChange(link)` once per flip (connected ↔ reconnecting), so the
 * WS push (header badge, Inspector stream log, Companion) follows without anyone polling. Stops itself when the
 * stream is gone; the route also stops it on Stop.
 * @param {object} ctx
 * @param {(link: { state: string, sinceMs: number | null, attempts: number }) => void} onChange
 * @param {number} [everyMs]
 */
function watchStreamLink(ctx, onChange, everyMs = 2000) {
	unwatchStreamLink(ctx)
	ctx._streamLinkState = 'connected'
	ctx._streamLinkTimer = setInterval(() => {
		let link
		try {
			link = runningStreamLink(ctx.streamingChannelRtmp)
		} catch {
			return
		}
		if (!link) {
			unwatchStreamLink(ctx)
			return
		}
		if (link.state !== ctx._streamLinkState) {
			ctx._streamLinkState = link.state
			onChange(link)
		}
	}, everyMs)
	if (typeof ctx._streamLinkTimer?.unref === 'function') ctx._streamLinkTimer.unref()
}

function unwatchStreamLink(ctx) {
	if (ctx?._streamLinkTimer) clearInterval(ctx._streamLinkTimer)
	if (ctx) ctx._streamLinkTimer = null
}

module.exports = { streamLinkState, runningStreamLink, linkErrorText, watchStreamLink, unwatchStreamLink, STALE_MS }
