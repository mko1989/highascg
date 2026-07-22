'use strict'

/**
 * WO-319 — the Annex B access-unit splitter that feeds the GOP buffer.
 *
 * What must never go wrong (each produces visible decode failure downstream):
 *  - An AU split across two chunks must come out as ONE unit — WebCodecs decodes one AU per chunk.
 *  - The keyframe flag must be exactly "contains an IDR slice" — it drives the whole IDR-first policy.
 *  - Streams WITHOUT AUDs (NVENC via TS remux often omits them) must still split on picture
 *    boundaries via first_mb_in_slice == 0.
 *  - A chunk boundary landing INSIDE a start code must not corrupt the split.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
	createAuSplitter,
	pushChunk,
	flush,
	findStartCode,
} = require('../../src/preview/h264-annexb-au-splitter')

const SC4 = [0, 0, 0, 1]
const SC3 = [0, 0, 1]
// NAL header byte: forbidden_zero=0, nal_ref_idc=3 (<<5), type. Payload first byte 0x80 = first_mb_in_slice 0.
const nal = (type, firstMbZero = true, extra = [0xaa, 0xbb]) =>
	Buffer.from([...SC4, 0x60 | type, firstMbZero ? 0x88 : 0x3a, ...extra])
const SPS = () => nal(7)
const PPS = () => nal(8)
const IDR = (firstMbZero = true) => nal(5, firstMbZero)
const P = (firstMbZero = true) => nal(1, firstMbZero)
const AUD = () => Buffer.from([...SC4, 0x09, 0x10])
const SEI = () => nal(6)

/** Feed a whole stream in one push + flush, return AUs. */
function splitAll(buffers, chunkSize = Infinity) {
	const s = createAuSplitter()
	const stream = Buffer.concat(buffers)
	const out = []
	if (chunkSize === Infinity) {
		out.push(...pushChunk(s, stream))
	} else {
		for (let i = 0; i < stream.length; i += chunkSize) {
			out.push(...pushChunk(s, stream.subarray(i, i + chunkSize)))
		}
	}
	out.push(...flush(s))
	return out
}

test('a keyframe AU [SPS,PPS,IDR] and following P-frames split correctly WITHOUT AUDs', () => {
	const aus = splitAll([SPS(), PPS(), IDR(), P(), P()])
	assert.equal(aus.length, 3, 'one key AU + two P AUs')
	assert.deepEqual(aus[0].nalTypes, [7, 8, 5])
	assert.equal(aus[0].keyframe, true, 'the SPS/PPS/IDR unit is the keyframe')
	assert.deepEqual(aus.map((a) => a.keyframe), [true, false, false])
})

test('AUD-delimited streams split on the AUD', () => {
	const aus = splitAll([AUD(), SPS(), PPS(), IDR(), AUD(), P(), AUD(), P()])
	assert.equal(aus.length, 3)
	assert.deepEqual(aus[0].nalTypes, [9, 7, 8, 5])
	assert.equal(aus[0].keyframe, true)
	assert.deepEqual(aus[1].nalTypes, [9, 1])
	assert.equal(aus[1].keyframe, false)
})

test('a multi-slice picture stays ONE access unit (first_mb_in_slice != 0 on later slices)', () => {
	// One picture as two slices: second slice has first_mb_in_slice != 0 → NOT a new AU.
	const aus = splitAll([SPS(), PPS(), IDR(true), IDR(false), P(true)])
	assert.equal(aus.length, 2, 'two pictures, not three')
	assert.deepEqual(aus[0].nalTypes, [7, 8, 5, 5], 'both IDR slices in one AU')
	assert.equal(aus[1].nalTypes.length, 1)
})

test('every chunk size from 1 byte up yields the identical split (boundaries inside start codes)', () => {
	const parts = [SPS(), PPS(), IDR(), P(), SEI(), P(), AUD(), P()]
	const reference = splitAll(parts)
	assert.equal(reference.length, 4)
	for (const size of [1, 2, 3, 4, 5, 7, 11, 13]) {
		const got = splitAll(parts, size)
		assert.equal(got.length, reference.length, `chunk size ${size}: AU count`)
		for (let i = 0; i < got.length; i++) {
			assert.deepEqual(got[i].nalTypes, reference[i].nalTypes, `chunk size ${size}: AU ${i} NAL types`)
			assert.ok(got[i].data.equals(reference[i].data), `chunk size ${size}: AU ${i} bytes identical`)
			assert.equal(got[i].keyframe, reference[i].keyframe, `chunk size ${size}: AU ${i} keyframe flag`)
		}
	}
})

test('SEI before a picture attaches to the FOLLOWING picture, not the previous one', () => {
	const aus = splitAll([SPS(), PPS(), IDR(), SEI(), P()])
	assert.equal(aus.length, 2)
	assert.deepEqual(aus[1].nalTypes, [6, 1], 'SEI travels with the picture it describes')
})

test('3-byte start codes are handled the same as 4-byte ones', () => {
	const p3 = Buffer.from([...SC3, 0x61, 0x88, 0xaa]) // P slice, 3-byte SC
	const aus = splitAll([SPS(), PPS(), IDR(), p3, p3])
	assert.equal(aus.length, 3)
	assert.equal(aus[1].nalTypes[0], 1)
})

test('AU bytes are preserved verbatim — start codes included, nothing dropped or reordered', () => {
	const parts = [SPS(), PPS(), IDR(), P()]
	const aus = splitAll(parts)
	assert.ok(Buffer.concat(aus.map((a) => a.data)).equals(Buffer.concat(parts)), 'concat of AUs == input stream')
})

test('garbage before the first start code is discarded, stream recovers', () => {
	const s = createAuSplitter()
	const out = []
	out.push(...pushChunk(s, Buffer.from([0xde, 0xad, 0xbe, 0xef])))
	out.push(...pushChunk(s, Buffer.concat([SPS(), PPS(), IDR(), P()])))
	out.push(...flush(s))
	assert.equal(out.length, 2)
	assert.equal(out[0].keyframe, true)
	assert.deepEqual(out[0].nalTypes, [7, 8, 5])
})

test('an incomplete trailing NAL is NOT emitted by pushChunk, only completed by the next chunk', () => {
	const s = createAuSplitter()
	const idr = IDR()
	const first = pushChunk(s, Buffer.concat([SPS(), PPS(), idr.subarray(0, idr.length - 1)]))
	assert.equal(first.length, 0, 'nothing complete yet — the IDR could still grow')
	const rest = pushChunk(s, Buffer.concat([idr.subarray(idr.length - 1), P()]))
	// P() closes the key AU.
	assert.equal(rest.length, 1)
	assert.deepEqual(rest[0].nalTypes, [7, 8, 5])
	assert.equal(rest[0].keyframe, true)
})

test('findStartCode: distinguishes 3- and 4-byte codes and ignores 00 00 02', () => {
	assert.deepEqual(findStartCode(Buffer.from([0, 0, 1, 9]), 0), { at: 0, len: 3 })
	assert.deepEqual(findStartCode(Buffer.from([0xff, 0, 0, 0, 1, 9]), 0), { at: 1, len: 4 })
	assert.equal(findStartCode(Buffer.from([0, 0, 2, 0, 0, 2]), 0), null)
})

test('flush hands out the final AU (streams do not end on a start code)', () => {
	const s = createAuSplitter()
	pushChunk(s, Buffer.concat([SPS(), PPS(), IDR()]))
	const aus = flush(s)
	assert.equal(aus.length, 1)
	assert.equal(aus[0].keyframe, true)
})
