'use strict'

/**
 * WO-582 — "relative to the clip playing on this layer" must land the incoming clip on the SAME
 * frame the outgoing one shows when the PLAY hits, not the frame it showed when the take started.
 *
 * The seek is baked into the pre-rolled LOADBG; PLAY follows after the pipeline's prebuffer sleep.
 * Resolve→PLAY measured 134–300 ms on the box (28.09) and flips with bank parity (180 vs 80 ms
 * prebuffer), so no prediction fits every take — an averaged one landed −5…+7 frames off.
 *
 * So the lead is made FIXED instead of predicted: the seek projects the OSC playhead by
 * (sample age + TARGET_LEAD_MS), and the pipeline holds the PLAY until exactly that deadline
 * (`relativeSeekPlayWaitMs`), minus the small fixed cost of the COMMIT/PLAY round trips after it.
 */

const TARGET_LEAD_MS = Math.max(
	100,
	Math.min(1500, parseInt(process.env.HIGHASCG_RELATIVE_SEEK_LEAD_MS || '350', 10) || 350)
)
/** Time between the pipeline's pre-PLAY sleep ending and Caspar receiving the PLAY. */
const PLAY_SEND_OVERHEAD_MS = Math.max(0, parseInt(process.env.HIGHASCG_RELATIVE_SEEK_SEND_MS || '15', 10) || 0)
/**
 * Measured on air 28.09 with the fixed deadline: PLAY reached Caspar on target (335–347 ms after
 * resolve), yet the incoming still sat 1–2 f (mean 1.75 f @ 50 fps) behind in BOTH directions —
 * Caspar-side: the pre-rolled producer shows its seek frame on the tick after PLAY while the
 * outgoing keeps advancing. A constant, so it is added to the projection only (not the wait).
 */
const CASPAR_PLAY_PIPE_MS = Math.max(0, parseInt(process.env.HIGHASCG_RELATIVE_SEEK_PIPE_MS || '35', 10) || 0)
/** A stamp older than this is not from the take now running (pgm-only path never settles it). */
const MAX_PLAUSIBLE_MS = 2000

function chKey(channel) {
	return String(parseInt(channel, 10))
}

function pendingStamp(ctx, channel, now) {
	const stamp = ctx?._relativeSeekResolvedAt?.[chKey(channel)]
	return Number.isFinite(stamp) && now - stamp >= 0 && now - stamp <= MAX_PLAUSIBLE_MS ? stamp : null
}

/**
 * How long the pipeline must sleep before PLAY: its own prebuffer, or longer when a relative seek on
 * this channel was projected to a later PLAY moment.
 * @param {object} ctx
 * @param {number} channel
 * @param {number} prebufferMs
 * @param {number} [now]
 */
function relativeSeekPlayWaitMs(ctx, channel, prebufferMs, now = Date.now()) {
	const stamp = pendingStamp(ctx, channel, now)
	if (stamp == null) return prebufferMs
	return Math.max(prebufferMs, stamp + TARGET_LEAD_MS - PLAY_SEND_OVERHEAD_MS - now)
}

/**
 * Called by the take pipeline right after the PLAY batch is acknowledged: clears the pending stamp.
 * @param {object} ctx
 * @param {number} channel
 * @param {number} [now]
 * @returns {number|null} ms from resolve to PLAY ack when a relative seek was pending on this channel
 */
function settleRelativeSeekLead(ctx, channel, now = Date.now()) {
	const stamp = pendingStamp(ctx, channel, now)
	if (ctx?._relativeSeekResolvedAt) delete ctx._relativeSeekResolvedAt[chKey(channel)]
	return stamp == null ? null : now - stamp
}

/**
 * OSC playhead of an on-air layer, projected to the moment the incoming PLAY will land.
 * @param {object} ctx
 * @param {number} channel
 * @param {number} physicalLayer on-air Caspar layer
 * @param {number} fps
 * @param {number} [now]
 * @returns {number|null} frame, wrapped for looping clips; null when OSC has no playhead
 */
function projectRelativeSeekFrames(ctx, channel, physicalLayer, fps, now = Date.now()) {
	const ch = parseInt(channel, 10)
	const ln = parseInt(physicalLayer, 10)
	const rate = Math.max(1, fps || 25)
	if (!ctx?.oscState || typeof ctx.oscState.getSnapshot !== 'function') return null
	const channels = ctx.oscState.getSnapshot()?.channels
	const chan = channels?.[ch] ?? channels?.[String(ch)]
	const layer = chan?.layers?.[ln] ?? chan?.layers?.[String(ln)]
	if (!layer || String(layer.type || '') === 'empty') return null
	const f = layer.file || {}
	let frames = null
	if (Number.isFinite(f.frameElapsed) && f.frameElapsed >= 0) frames = f.frameElapsed
	else if (Number.isFinite(f.elapsed) && f.elapsed >= 0) frames = f.elapsed * rate
	if (frames == null) return null

	const ageMs = Number.isFinite(layer._lastOscAt) ? Math.max(0, Math.min(500, now - layer._lastOscAt)) : 0
	let projected = Math.round(frames + ((ageMs + TARGET_LEAD_MS + CASPAR_PLAY_PIPE_MS) * rate) / 1000)

	const total = Number.isFinite(f.duration) && f.duration > 0 ? Math.floor(f.duration * rate) : 0
	if (total > 0 && projected >= total) projected = f.loop === false ? total - 1 : projected % total

	if (!ctx._relativeSeekResolvedAt) ctx._relativeSeekResolvedAt = {}
	ctx._relativeSeekResolvedAt[chKey(ch)] = now
	return Math.max(0, projected)
}

module.exports = {
	TARGET_LEAD_MS,
	PLAY_SEND_OVERHEAD_MS,
	CASPAR_PLAY_PIPE_MS,
	relativeSeekPlayWaitMs,
	settleRelativeSeekLead,
	projectRelativeSeekFrames,
}
