'use strict'

/**
 * WO-319 — GOP buffer / relay policy for the GUI live stream (server side, pure).
 *
 * The server ingests H.264 access units from the composed channel's NVENC consumer and relays them
 * to browser WebCodecs clients over the existing WS. Two hard requirements, both easy to get subtly
 * wrong, so the policy lives here as a pure state machine over frame DESCRIPTORS (no actual bytes,
 * no sockets) and is fully unit-tested:
 *
 *  1. IDR-FIRST for a joining or recovered client. WebCodecs' VideoDecoder cannot start on a P-frame
 *     — feeding it mid-GOP produces "no frame" / green output (the same PPS-referenced errors seen
 *     when ffprobe was pointed mid-stream during live verification). So a client that has not yet
 *     received a keyframe must be sent the latest buffered keyframe FIRST, then only frames from
 *     that keyframe onward.
 *  2. STALE-DROP under backpressure. A slow client must not accumulate an unbounded queue (that is
 *     latency, growing without bound). When it falls behind, drop to the newest keyframe and resume
 *     — decode-latest-wins, never replay a backlog.
 *
 * "Latest GOP" retention: the buffer keeps frames from the most recent keyframe onward, plus at most
 * one prior keyframe's tail is irrelevant — once a new keyframe arrives everything before it is
 * dropped, because no client will ever need it (a joiner starts at the newest keyframe; an
 * up-to-date client has already been sent the older frames).
 */

/**
 * @typedef {{ seq: number, keyframe: boolean, size?: number }} FrameDesc
 *   seq — monotonic sequence number assigned by the ingest. keyframe — IDR access unit.
 */

/**
 * @param {{ maxGopFrames?: number }} [opts] safety cap on a single GOP's retained frames (a broken
 *   encoder emitting no keyframes must not grow memory without bound). Default 600 (~12s at 50p).
 */
function createGopBuffer(opts = {}) {
	const maxGopFrames = Number.isFinite(opts.maxGopFrames) && opts.maxGopFrames > 0 ? Math.floor(opts.maxGopFrames) : 600
	return {
		maxGopFrames,
		/** @type {FrameDesc[]} frames from the current keyframe onward, in arrival order */
		frames: [],
		/** seq of the current GOP's keyframe, or null before the first keyframe */
		keyframeSeq: null,
		/** total frames ever accepted (for diagnostics) */
		accepted: 0,
		/** frames dropped because they arrived before the first keyframe */
		droppedPreKeyframe: 0,
	}
}

/**
 * Ingest one frame. A keyframe starts a fresh GOP (older frames are released). A non-keyframe before
 * the first keyframe is dropped — it is undecodable on its own and no client could ever use it.
 * @param {ReturnType<typeof createGopBuffer>} buf
 * @param {FrameDesc} frame
 * @returns {{ startedNewGop: boolean, dropped: boolean }}
 */
function pushFrame(buf, frame) {
	if (!frame || !Number.isFinite(frame.seq)) return { startedNewGop: false, dropped: true }
	if (frame.keyframe) {
		buf.frames = [frame]
		buf.keyframeSeq = frame.seq
		buf.accepted++
		return { startedNewGop: true, dropped: false }
	}
	if (buf.keyframeSeq == null) {
		// No decodable start point yet — a P-frame here is useless to everyone.
		buf.droppedPreKeyframe++
		return { startedNewGop: false, dropped: true }
	}
	buf.frames.push(frame)
	buf.accepted++
	// Safety cap only — a healthy stream re-keys long before this. Drop the OLDEST non-keyframe so
	// the keyframe itself is always retained (a joiner still needs it).
	if (buf.frames.length > buf.maxGopFrames) {
		buf.frames.splice(1, buf.frames.length - buf.maxGopFrames)
	}
	return { startedNewGop: false, dropped: false }
}

/**
 * The latest buffered keyframe descriptor, or null if none yet.
 * @param {ReturnType<typeof createGopBuffer>} buf
 */
function latestKeyframe(buf) {
	return buf.keyframeSeq != null && buf.frames.length ? buf.frames[0] : null
}

/**
 * A per-client cursor. `lastSentSeq` is the seq of the last frame delivered to this client, or null
 * if it has never received a decodable frame.
 */
function createClientCursor() {
	return { lastSentSeq: null, startedAtKeyframe: false }
}

/**
 * Decide what to send a client right now, given the buffer state and the client's cursor.
 *
 * Returns the ordered list of frames to deliver AND mutates the cursor to reflect them. The policy:
 *  - Client has no keyframe yet (fresh join, or was reset): send from the latest keyframe onward.
 *  - Client is caught up (lastSentSeq >= newest): send nothing.
 *  - Client is behind but its last frame is still within the current GOP: send the frames after it.
 *  - Client is behind and its last frame predates the current keyframe (it fell off / a re-key
 *    happened): it cannot continue from where it was — resync to the latest keyframe. This is the
 *    stale-drop: never replay the gap, jump forward.
 *
 * @param {ReturnType<typeof createGopBuffer>} buf
 * @param {ReturnType<typeof createClientCursor>} cursor
 * @returns {{ frames: FrameDesc[], resynced: boolean }}
 */
function framesForClient(buf, cursor) {
	if (!buf.frames.length || buf.keyframeSeq == null) return { frames: [], resynced: false }
	const newestSeq = buf.frames[buf.frames.length - 1].seq

	// Fresh client, or one whose last frame is older than the current GOP's keyframe: (re)start at
	// the keyframe. Both are the same action — deliver the whole current GOP, keyframe first.
	const behindGop = cursor.lastSentSeq == null || cursor.lastSentSeq < buf.keyframeSeq
	if (behindGop) {
		const frames = buf.frames.slice()
		const wasResync = cursor.lastSentSeq != null
		cursor.lastSentSeq = newestSeq
		cursor.startedAtKeyframe = true
		return { frames, resynced: wasResync }
	}

	// Caught up.
	if (cursor.lastSentSeq >= newestSeq) return { frames: [], resynced: false }

	// Within the current GOP: send only what is new.
	const idx = buf.frames.findIndex((f) => f.seq > cursor.lastSentSeq)
	const frames = idx >= 0 ? buf.frames.slice(idx) : []
	if (frames.length) cursor.lastSentSeq = frames[frames.length - 1].seq
	return { frames, resynced: false }
}

/**
 * Force a client back to needing a keyframe (e.g. the WS detected it lagging / its send buffer grew).
 * The next framesForClient() will resync it to the latest keyframe.
 * @param {ReturnType<typeof createClientCursor>} cursor
 */
function resetClientToKeyframe(cursor) {
	cursor.lastSentSeq = null
	cursor.startedAtKeyframe = false
}

module.exports = {
	createGopBuffer,
	pushFrame,
	latestKeyframe,
	createClientCursor,
	framesForClient,
	resetClientToKeyframe,
}
