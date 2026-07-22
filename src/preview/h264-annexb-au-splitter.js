'use strict'

/**
 * WO-319 — split a raw H.264 Annex B byte stream into ACCESS UNITS (server side, pure).
 *
 * The ingest pipeline is: Caspar NVENC consumer → MPEG-TS on localhost UDP → ffmpeg remux to a raw
 * Annex B elementary stream on stdout → THIS SPLITTER → gui-stream-gop-buffer. The GOP buffer's
 * whole policy (IDR-first, stale-drop) hangs on two facts this module must get right:
 *
 *   1. Frame boundaries. WebCodecs' VideoDecoder.decode() takes ONE access unit per chunk — feed it
 *      half a picture (or two) and it errors or shows corruption. So NAL units must be grouped into
 *      complete AUs, never split mid-picture.
 *   2. The keyframe flag. An AU is a keyframe iff it contains an IDR slice (NAL type 5). Mislabel a
 *      P-frame as key and a joining client decodes garbage; mislabel keys as P and no client can
 *      ever join.
 *
 * AU boundary detection (no AUDs guaranteed — NVENC via the TS remux may or may not emit them):
 * a new AU starts at
 *   - an AUD (NAL 9), or
 *   - an SPS/PPS/SEI (7/8/6) once the current AU already holds a slice (parameter sets and SEI
 *     always PRECEDE the picture they apply to), or
 *   - a VCL NAL (1..5) with first_mb_in_slice == 0 once the current AU already holds a slice — the
 *     first slice of the next picture. first_mb_in_slice is the leading ue(v) of the slice header;
 *     it is 0 exactly when the first payload bit is 1 (0x80), and the first payload byte cannot be
 *     an emulation-prevention byte, so no RBSP unescaping is needed for this one test.
 *
 * Keyframe AUs come out as [SPS, PPS, IDR…] because the TS remux repeats parameter sets before each
 * IDR — exactly what a WebCodecs decoder in Annex B mode (no description) needs in-band.
 *
 * Chunking: input arrives as arbitrary Buffer slices from a child process stdout. A NAL is only
 * complete once the NEXT start code is seen, so a tail is always carried; flush() hands out the
 * final AU at end-of-stream.
 */

const NAL_SLICE_NON_IDR = 1
const NAL_SLICE_IDR = 5
const NAL_SEI = 6
const NAL_SPS = 7
const NAL_PPS = 8
const NAL_AUD = 9

/** @param {number} type */
function isVcl(type) {
	return type >= 1 && type <= 5
}

/**
 * @typedef {{ data: Buffer, keyframe: boolean, nalTypes: number[] }} AccessUnit
 *   data — the complete AU, start codes included, ready for VideoDecoder.decode().
 */

function createAuSplitter() {
	return {
		/** @type {Buffer} bytes not yet resolved into complete NALs */
		carry: Buffer.alloc(0),
		/** @type {Buffer[]} NALs (with start codes) of the AU being assembled */
		auNals: [],
		/** @type {number[]} NAL types of the AU being assembled */
		auTypes: [],
		/** true once the AU being assembled holds a VCL NAL — the boundary conditions key off this */
		auHasVcl: false,
		auHasIdr: false,
	}
}

/**
 * Find the next Annex B start code at or after `from`. Returns { at, len } where `at` is the index
 * of the first 0x00 and len is 3 or 4, or null.
 * @param {Buffer} buf
 * @param {number} from
 */
function findStartCode(buf, from) {
	for (let i = from; i + 2 < buf.length; i++) {
		if (buf[i] === 0 && buf[i + 1] === 0) {
			if (buf[i + 2] === 1) return { at: i, len: 3 }
			if (buf[i + 2] === 0 && i + 3 < buf.length && buf[i + 3] === 1) return { at: i, len: 4 }
		}
	}
	return null
}

/**
 * Does this NAL start a NEW access unit, given the state of the one being assembled?
 * @param {ReturnType<typeof createAuSplitter>} s
 * @param {number} type
 * @param {Buffer} nal complete NAL including its start code
 * @param {number} headerAt index of the NAL header byte within `nal`
 */
function startsNewAu(s, type, nal, headerAt) {
	if (s.auNals.length === 0) return false
	if (type === NAL_AUD) return true
	if (!s.auHasVcl) return false
	if (type === NAL_SPS || type === NAL_PPS || type === NAL_SEI) return true
	if (isVcl(type)) {
		// first_mb_in_slice == 0 ⇔ leading ue(v) bit is 1.
		const payload = nal[headerAt + 1]
		return payload !== undefined && (payload & 0x80) !== 0
	}
	return false
}

/**
 * @param {ReturnType<typeof createAuSplitter>} s
 * @returns {AccessUnit|null}
 */
function takeAu(s) {
	if (!s.auNals.length) return null
	const au = { data: Buffer.concat(s.auNals), keyframe: s.auHasIdr, nalTypes: s.auTypes }
	s.auNals = []
	s.auTypes = []
	s.auHasVcl = false
	s.auHasIdr = false
	return au
}

/**
 * Ingest one complete NAL (start code included). Returns a finished AU if this NAL closed one.
 * @param {ReturnType<typeof createAuSplitter>} s
 * @param {Buffer} nal
 * @param {number} headerAt
 * @returns {AccessUnit|null}
 */
function acceptNal(s, nal, headerAt) {
	const type = nal[headerAt] & 0x1f
	const finished = startsNewAu(s, type, nal, headerAt) ? takeAu(s) : null
	s.auNals.push(nal)
	s.auTypes.push(type)
	if (isVcl(type)) s.auHasVcl = true
	if (type === NAL_SLICE_IDR) s.auHasIdr = true
	return finished
}

/**
 * Push a chunk of the elementary stream. Returns the access units COMPLETED by this chunk (possibly
 * none — a large AU can span many chunks).
 * @param {ReturnType<typeof createAuSplitter>} s
 * @param {Buffer} chunk
 * @returns {AccessUnit[]}
 */
function pushChunk(s, chunk) {
	if (!chunk || !chunk.length) return []
	let buf = s.carry.length ? Buffer.concat([s.carry, chunk]) : chunk
	/** @type {AccessUnit[]} */
	const out = []

	let first = findStartCode(buf, 0)
	if (!first) {
		// No start code at all yet — either garbage before the first NAL (droppable once it can't be
		// a partial start code) or the middle of a NAL whose start we already consumed. Since we only
		// ever leave `carry` beginning AT a start code (or at stream start), a start-less buffer here
		// means pre-stream garbage: keep just enough tail to not lose a split start code.
		s.carry = buf.length > 3 ? buf.subarray(buf.length - 3) : buf
		return out
	}

	let at = first.at
	let len = first.len
	for (;;) {
		const next = findStartCode(buf, at + len)
		if (!next) break
		const nal = buf.subarray(at, next.at)
		const au = acceptNal(s, nal, len) // header is right after the start code
		if (au) out.push(au)
		at = next.at
		len = next.len
	}
	// The last NAL is incomplete until the next start code (or flush) — carry it. BUT its boundary
	// decision only needs the header + first payload byte, so the AU it closes can be released NOW
	// instead of a full frame period later (20ms at 50p — real latency for a live preview). This is
	// idempotent: once the AU is taken, startsNewAu() sees an empty assembly and stays false, so the
	// eventual acceptNal() of this same NAL cannot double-flush.
	s.carry = buf.subarray(at)
	if (s.carry.length >= len + 2) {
		const type = s.carry[len] & 0x1f
		if (startsNewAu(s, type, s.carry, len)) {
			const early = takeAu(s)
			if (early) out.push(early)
		}
	}
	return out
}

/**
 * End of stream: complete the carried NAL and hand out the final AU.
 * @param {ReturnType<typeof createAuSplitter>} s
 * @returns {AccessUnit[]}
 */
function flush(s) {
	/** @type {AccessUnit[]} */
	const out = []
	const sc = findStartCode(s.carry, 0)
	if (sc && s.carry.length > sc.at + sc.len) {
		const au = acceptNal(s, s.carry.subarray(sc.at), sc.len)
		if (au) out.push(au)
	}
	s.carry = Buffer.alloc(0)
	const last = takeAu(s)
	if (last) out.push(last)
	return out
}

module.exports = {
	createAuSplitter,
	pushChunk,
	flush,
	// exported for tests
	findStartCode,
	NAL_SLICE_NON_IDR,
	NAL_SLICE_IDR,
	NAL_SEI,
	NAL_SPS,
	NAL_PPS,
	NAL_AUD,
}
