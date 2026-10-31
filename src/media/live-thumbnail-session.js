/**
 * WO-887 — live-source thumbnails are captured ONCE per node session, at a moment the frame is not black.
 *
 * Before: capture-once-forever (WO-392) — any PNG on disk refused a new PRINT, PGM/PRV were never PRINTed from
 * a GET, so data/live-thumbnails/ch-N.png from July/August were served months later. Now:
 *   - the first GET /api/thumbnail/live/:ch of a node session starts ONE capture for that channel (lazy: no
 *     startup sweep, no background poller). The GET waits up to SESSION_GET_WAIT_MS for it;
 *   - the frame is accepted only when it is not black (live-thumbnail-frame-check.js); a black or failed
 *     capture never overwrites the PNG on disk, and is retried on a FIXED, bounded schedule
 *     (SESSION_RETRY_DELAYS_MS — one timer per pending channel, nothing when idle), then given up for the session;
 *   - until the session capture lands, the previous session's PNG is served as a placeholder (header says so);
 *   - once a good frame is captured, nothing recaptures automatically until the node restarts;
 *   - manual recapture is API-only: POST /api/thumbnail/live/recapture (restarts this flow), or the raw
 *     POST /api/thumbnail/live/capture / upload (marked fresh, so the session never overrides them).
 * Audio-only channels have no picture and are never captured; a custom upload on disk is never auto-replaced.
 */
'use strict'

const { analyzeThumbnailFrame } = require('./live-thumbnail-frame-check')
const { isAudioOnlyLiveChannel, listLiveThumbnailChannels } = require('./live-thumbnail-input-capture')

/** Delay before retry n (after attempt n failed or was black). Length = number of retries; ~8.7 min in total. */
const SESSION_RETRY_DELAYS_MS = [10000, 30000, 60000, 120000, 300000]

/** How long a thumbnail GET waits for the session capture before serving the placeholder. */
const SESSION_GET_WAIT_MS = 5000

/** Retry hint for a client while a capture is still running (PRINTs are serialized across channels). */
const CAPTURING_RETRY_HINT_MS = 3000

/**
 * @typedef {{ phase: 'capturing'|'waiting'|'fresh'|'gave_up', attempts: number, nextAt?: number,
 *   capturedAt?: string, lastError?: string|null, timer?: any, inflight?: Promise<void>, manual?: boolean }} SessionEntry
 */

/** @type {Map<number, SessionEntry>} */
const _sessions = new Map()

/** @param {unknown} v */
function toChannel(v) {
	return Math.max(1, parseInt(String(v), 10) || 1)
}

/** @param {object} ctx @param {{ channelMap?: object|null }} opts */
function resolveChannelMap(ctx, opts) {
	if (opts.channelMap !== undefined) return opts.channelMap
	try {
		return require('../config/routing').getChannelMap(ctx?.config || {})
	} catch {
		return null
	}
}

/** @param {object} ctx @param {string} level @param {string} msg */
function log(ctx, level, msg) {
	try {
		if (typeof ctx?.log === 'function') ctx.log(level, `[live-thumb] ${msg}`)
	} catch {
		/* logging must never break a thumbnail GET */
	}
}

/** @param {Promise<unknown>} p @param {number} ms */
function waitAtMost(p, ms) {
	let t = null
	return Promise.race([
		Promise.resolve(p).finally(() => t && clearTimeout(t)),
		new Promise((resolve) => {
			t = setTimeout(resolve, Math.max(0, ms))
		}),
	])
}

/**
 * Pure: should this GET start the channel's session capture?
 * @param {{ phase?: string, amcpReady?: boolean, audioOnly?: boolean, customCache?: boolean }} args
 * @returns {{ attempt: boolean, reason: string }}
 */
function decideSessionCapture(args) {
	const { phase, amcpReady = true, audioOnly = false, customCache = false } = args || {}
	if (audioOnly) return { attempt: false, reason: 'no_picture' }
	// One session capture per channel: started, waiting, fresh or given up — a GET never starts another.
	if (phase) return { attempt: false, reason: `session_${phase}` }
	if (customCache) return { attempt: false, reason: 'custom' }
	if (!amcpReady) return { attempt: false, reason: 'amcp_disconnected' }
	return { attempt: true, reason: 'session_first' }
}

/**
 * @param {SessionEntry|undefined} entry
 * @param {number} now
 * @returns {{ phase: string, attempts: number, retryInMs?: number, capturedAt?: string, lastError?: string }}
 */
function statusOf(entry, now) {
	if (!entry) return { phase: 'idle', attempts: 0 }
	const out = { phase: entry.phase, attempts: entry.attempts }
	if (entry.phase === 'waiting') out.retryInMs = Math.max(0, (entry.nextAt || now) - now)
	if (entry.phase === 'capturing') out.retryInMs = CAPTURING_RETRY_HINT_MS
	if (entry.capturedAt) out.capturedAt = entry.capturedAt
	if (entry.lastError) out.lastError = entry.lastError
	return out
}

/** @param {SessionEntry|undefined} entry */
function cancelTimer(entry) {
	if (entry?.timer) clearTimeout(entry.timer)
	if (entry) entry.timer = null
}

/**
 * One capture attempt; on a black / failed frame arms the next retry from the fixed schedule or gives up.
 * @param {object} ctx
 * @param {number} ch
 * @param {SessionEntry} entry
 * @param {object} opts — test seams: capture, analyze, retryDelaysMs, now
 * @returns {Promise<void>}
 */
function runAttempt(ctx, ch, entry, opts) {
	const clock = opts.now || Date.now
	entry.phase = 'capturing'
	entry.attempts += 1
	const capture = opts.capture || require('./live-thumbnail-cache-capture').captureLiveThumbnailToCache
	const analyze = opts.analyze || analyzeThumbnailFrame
	const accept = async (buf) => !(await analyze(buf)).black
	entry.inflight = (async () => {
		let res
		try {
			res = await capture(ctx, ch, { force: true, accept })
		} catch (e) {
			res = { ok: false, error: e?.message || String(e) }
		}
		if (_sessions.get(ch) !== entry) return // superseded by a manual recapture / capture
		if (res?.ok) {
			entry.phase = 'fresh'
			entry.capturedAt = new Date(clock()).toISOString()
			entry.lastError = null
			log(ctx, 'info', `ch${ch}: session thumbnail captured (attempt ${entry.attempts})`)
			return
		}
		entry.lastError = res?.error || 'capture failed'
		const delays = opts.retryDelaysMs || SESSION_RETRY_DELAYS_MS
		const delay = delays[entry.attempts - 1]
		if (delay == null) {
			entry.phase = 'gave_up'
			log(ctx, 'warn', `ch${ch}: no usable frame after ${entry.attempts} tries (${entry.lastError}) — keeping the previous thumbnail this session`)
			return
		}
		entry.phase = 'waiting'
		entry.nextAt = clock() + delay
		entry.timer = setTimeout(() => {
			entry.timer = null
			if (_sessions.get(ch) === entry && entry.phase === 'waiting') runAttempt(ctx, ch, entry, opts)
		}, delay)
		entry.timer?.unref?.()
	})()
	return entry.inflight
}

/** @param {object} ctx @param {number} ch @param {object} opts */
function startSession(ctx, ch, opts) {
	cancelTimer(_sessions.get(ch))
	/** @type {SessionEntry} */
	const entry = { phase: 'capturing', attempts: 0, lastError: null, timer: null }
	_sessions.set(ch, entry)
	runAttempt(ctx, ch, entry, opts)
	return entry
}

/**
 * GET path: start the channel's session capture on first request, wait a bounded time for it.
 * @param {object} ctx — { config, amcp, log? }
 * @param {number} channel
 * @param {{ customCache?: boolean, channelMap?: object|null, waitMs?: number, capture?: Function,
 *   analyze?: Function, retryDelaysMs?: number[], now?: () => number }} [opts]
 * @returns {Promise<ReturnType<typeof statusOf> & { reason: string }>}
 */
async function ensureSessionLiveThumbnail(ctx, channel, opts = {}) {
	const ch = toChannel(channel)
	const clock = opts.now || Date.now
	const existing = _sessions.get(ch)
	const decision = decideSessionCapture({
		phase: existing?.phase,
		amcpReady: !!ctx?.amcp,
		audioOnly: isAudioOnlyLiveChannel(resolveChannelMap(ctx, opts), ch),
		customCache: opts.customCache === true,
	})
	if (!decision.attempt) {
		const st = statusOf(existing, clock())
		if (decision.reason === 'no_picture') st.phase = 'no_picture'
		else if (decision.reason === 'custom') st.phase = 'custom'
		return { ...st, reason: decision.reason }
	}
	const entry = startSession(ctx, ch, opts)
	await waitAtMost(entry.inflight, opts.waitMs ?? SESSION_GET_WAIT_MS)
	return { ...statusOf(entry, clock()), reason: decision.reason }
}

/**
 * Manual recapture (API only): forget this session's result for the channels and run the flow again.
 * @param {object} ctx
 * @param {number[]|null} channels — null = every live channel of the channel map + every channel seen this session
 * @param {{ waitMs?: number, channelMap?: object|null } & object} [opts]
 */
async function recaptureLiveThumbnails(ctx, channels, opts = {}) {
	const clock = opts.now || Date.now
	const cm = resolveChannelMap(ctx, opts)
	const list = Array.isArray(channels) && channels.length
		? [...new Set(channels.map(toChannel))]
		: [...new Set([...listLiveThumbnailChannels(cm), ..._sessions.keys()])].sort((a, b) => a - b)
	const started = []
	const results = []
	for (const ch of list) {
		if (isAudioOnlyLiveChannel(cm, ch)) {
			results.push({ channel: ch, phase: 'no_picture', attempts: 0 })
			continue
		}
		if (!ctx?.amcp) {
			results.push({ channel: ch, phase: 'idle', attempts: 0, lastError: 'Caspar not connected' })
			continue
		}
		const entry = startSession(ctx, ch, opts)
		started.push(entry.inflight)
		results.push({ channel: ch, entry })
	}
	await waitAtMost(Promise.all(started), opts.waitMs ?? SESSION_GET_WAIT_MS * 3)
	return results.map((r) => (r.entry ? { channel: r.channel, ...statusOf(r.entry, clock()) } : r))
}

/**
 * A manual capture / upload wins for the rest of the session (no automatic retry overrides it).
 * @param {number} channel
 * @param {number} [now]
 */
function markSessionThumbnailFresh(channel, now = Date.now()) {
	const ch = toChannel(channel)
	const prev = _sessions.get(ch)
	cancelTimer(prev)
	_sessions.set(ch, {
		phase: 'fresh',
		attempts: prev?.attempts || 0,
		capturedAt: new Date(now).toISOString(),
		lastError: null,
		timer: null,
		manual: true,
	})
}

/** Test seam: drop all session state and timers. */
function _resetSessions() {
	for (const e of _sessions.values()) cancelTimer(e)
	_sessions.clear()
}

module.exports = {
	SESSION_RETRY_DELAYS_MS,
	decideSessionCapture,
	ensureSessionLiveThumbnail,
	recaptureLiveThumbnails,
	markSessionThumbnailFresh,
	_resetSessions,
}
