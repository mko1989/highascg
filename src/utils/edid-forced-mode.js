'use strict'

/**
 * WO-1129 — build a CustomEDID that adds ONE forced display mode (WxH@Hz) to a connector's real EDID.
 *
 * NVIDIA's proprietary X driver refuses RandR user modes (`xrandr --addmode` → BadMatch), so a mode the EDID does
 * not offer can only reach it through `Option "CustomEDID"`: the connector's own EDID with an extra Detailed Timing
 * Descriptor (DTD). Pure functions only — no fs, no X. Layout of the 128-byte base block (VESA E-EDID 1.3/1.4):
 *   - bytes 0-7 header 00 ff ff ff ff ff ff 00, byte 126 = extension block count, byte 127 = checksum (sum ≡ 0 mod 256);
 *   - four 18-byte descriptor slots at 54, 72, 90, 108. A DTD has a non-zero pixel clock in bytes 0-1 (LE, 10 kHz);
 *     a display descriptor has bytes 0-2 = 0 and its tag in byte 3 (0xFD range limits, 0xFC name, 0xFE text,
 *     0xFF serial, 0x10 dummy).
 * Slot 0 (the preferred timing) is never touched; extension blocks are carried over unchanged.
 */

const DESCRIPTOR_OFFSETS = [54, 72, 90, 108]
const EDID_HEADER = Buffer.from([0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00])
/** xrandr prints 2 decimals; anything within this many Hz is "the same mode". */
const RATE_TOLERANCE_HZ = 0.05

/** @param {Buffer} block 128 bytes → the byte that makes the block sum to 0 mod 256 */
function edidChecksumByte(block) {
	let sum = 0
	for (let i = 0; i < 127; i++) sum += block[i]
	return (256 - (sum % 256)) % 256
}

/**
 * Strict EDID check (the root helper repeats it in bash): 128·n bytes, header, every block sums to 0,
 * byte 126 = n − 1.
 * @param {Buffer} buf
 * @returns {{ ok: true, blocks: number } | { ok: false, error: string }}
 */
function validateEdid(buf) {
	if (!Buffer.isBuffer(buf) || buf.length < 128 || buf.length % 128 !== 0) {
		return { ok: false, error: `EDID must be 128·n bytes (got ${buf?.length ?? 0})` }
	}
	if (!buf.subarray(0, 8).equals(EDID_HEADER)) return { ok: false, error: 'EDID header is not 00ffffffffffff00' }
	const blocks = buf.length / 128
	for (let b = 0; b < blocks; b++) {
		let sum = 0
		for (let i = 0; i < 128; i++) sum += buf[b * 128 + i]
		if (sum % 256 !== 0) return { ok: false, error: `EDID block ${b} checksum is wrong` }
	}
	if (buf[126] !== blocks - 1) return { ok: false, error: `EDID byte 126 says ${buf[126]} extensions, file has ${blocks - 1}` }
	return { ok: true, blocks }
}

/**
 * @typedef {{ pixelClock10k: number, hActive: number, hBlank: number, hSyncOffset: number, hSyncWidth: number,
 *   vActive: number, vBlank: number, vSyncOffset: number, vSyncWidth: number, hSizeMm: number, vSizeMm: number,
 *   hBorder: number, vBorder: number, flags: number }} Dtd
 */

/** @param {Buffer} b @param {number} off @returns {Dtd | null} */
function decodeDtd(b, off) {
	const pixelClock10k = b[off] | (b[off + 1] << 8)
	if (!pixelClock10k) return null
	return {
		pixelClock10k,
		hActive: b[off + 2] | ((b[off + 4] & 0xf0) << 4),
		hBlank: b[off + 3] | ((b[off + 4] & 0x0f) << 8),
		vActive: b[off + 5] | ((b[off + 7] & 0xf0) << 4),
		vBlank: b[off + 6] | ((b[off + 7] & 0x0f) << 8),
		hSyncOffset: b[off + 8] | ((b[off + 11] & 0xc0) << 2),
		hSyncWidth: b[off + 9] | ((b[off + 11] & 0x30) << 4),
		vSyncOffset: (b[off + 10] >> 4) | ((b[off + 11] & 0x0c) << 2),
		vSyncWidth: (b[off + 10] & 0x0f) | ((b[off + 11] & 0x03) << 4),
		hSizeMm: b[off + 12] | ((b[off + 14] & 0xf0) << 4),
		vSizeMm: b[off + 13] | ((b[off + 14] & 0x0f) << 8),
		hBorder: b[off + 15],
		vBorder: b[off + 16],
		flags: b[off + 17],
	}
}

/** Refresh rate of a decoded DTD in Hz (progressive). */
function dtdRefreshHz(t) {
	const total = (t.hActive + t.hBlank) * (t.vActive + t.vBlank)
	return total > 0 ? (t.pixelClock10k * 10000) / total : 0
}

/** @param {Dtd} t @returns {Buffer} 18 bytes; throws when a field does not fit its bit width */
function encodeDtd(t) {
	const lim = [
		['pixelClock10k', 1, 0xffff], ['hActive', 1, 4095], ['hBlank', 1, 4095], ['vActive', 1, 4095], ['vBlank', 1, 4095],
		['hSyncOffset', 0, 1023], ['hSyncWidth', 0, 1023], ['vSyncOffset', 0, 63], ['vSyncWidth', 0, 63],
		['hSizeMm', 0, 4095], ['vSizeMm', 0, 4095], ['hBorder', 0, 255], ['vBorder', 0, 255], ['flags', 0, 255],
	]
	for (const [k, min, max] of lim) {
		const v = t[k]
		if (!Number.isInteger(v) || v < min || v > max) throw new Error(`DTD ${k}=${v} out of range ${min}..${max}`)
	}
	const o = Buffer.alloc(18)
	o[0] = t.pixelClock10k & 0xff
	o[1] = t.pixelClock10k >> 8
	o[2] = t.hActive & 0xff
	o[3] = t.hBlank & 0xff
	o[4] = ((t.hActive >> 8) << 4) | (t.hBlank >> 8)
	o[5] = t.vActive & 0xff
	o[6] = t.vBlank & 0xff
	o[7] = ((t.vActive >> 8) << 4) | (t.vBlank >> 8)
	o[8] = t.hSyncOffset & 0xff
	o[9] = t.hSyncWidth & 0xff
	o[10] = ((t.vSyncOffset & 0x0f) << 4) | (t.vSyncWidth & 0x0f)
	o[11] = ((t.hSyncOffset >> 8) << 6) | ((t.hSyncWidth >> 8) << 4) | ((t.vSyncOffset >> 4) << 2) | (t.vSyncWidth >> 4)
	o[12] = t.hSizeMm & 0xff
	o[13] = t.vSizeMm & 0xff
	o[14] = ((t.hSizeMm >> 8) << 4) | (t.vSizeMm >> 8)
	o[15] = t.hBorder
	o[16] = t.vBorder
	o[17] = t.flags
	return o
}

/**
 * DTD from an X modeline (`computeModelineForWxH().timings` / `cvt` output: clock MHz, h disp/ss/se/total,
 * v disp/ss/se/total, flags). The clock is recomputed by the caller for the exact rate.
 * @param {string[]} timings
 * @param {{ hSizeMm?: number, vSizeMm?: number }} [size]
 * @returns {Dtd | null}
 */
function dtdFromModelineTimings(timings, size = {}) {
	if (!Array.isArray(timings) || timings.length < 9) return null
	const [clk, hd, hss, hse, ht, vd, vss, vse, vt] = timings.slice(0, 9).map(Number)
	if (![clk, hd, hss, hse, ht, vd, vss, vse, vt].every(Number.isFinite)) return null
	const flagText = timings.slice(9).join(' ').toLowerCase()
	if (/interlace|doublescan/.test(flagText)) return null
	return {
		pixelClock10k: Math.round(clk * 100),
		hActive: hd,
		hBlank: ht - hd,
		hSyncOffset: hss - hd,
		hSyncWidth: hse - hss,
		vActive: vd,
		vBlank: vt - vd,
		vSyncOffset: vss - vd,
		vSyncWidth: vse - vss,
		hSizeMm: size.hSizeMm || 0,
		vSizeMm: size.vSizeMm || 0,
		hBorder: 0,
		vBorder: 0,
		/* digital separate sync (bits 4-3 = 11) + polarities: bit 2 = +vsync, bit 1 = +hsync */
		flags: 0x18 | (/\+vsync/.test(flagText) ? 0x04 : 0) | (/\+hsync/.test(flagText) ? 0x02 : 0),
	}
}

/** @param {Buffer} edid @returns {Array<{ slot: number, off: number, dtd: Dtd | null, tag: number | null }>} */
function listBaseDescriptors(edid) {
	return DESCRIPTOR_OFFSETS.map((off, slot) => {
		const dtd = decodeDtd(edid, off)
		return { slot, off, dtd, tag: dtd ? null : edid[off + 3] }
	})
}

/** A slot we may overwrite: a dummy/empty descriptor first, then the 0xFE text, then the 0xFC name. Never slot 0. */
function pickFreeSlot(descs, edid) {
	const isEmpty = (d) => d.tag === 0x10 || edid.subarray(d.off, d.off + 18).every((x) => x === 0)
	const order = [isEmpty, (d) => d.tag === 0xfe, (d) => d.tag === 0xfc]
	for (const test of order) {
		const hit = descs.find((d) => d.slot > 0 && !d.dtd && test(d))
		if (hit) return hit
	}
	return null
}

/**
 * Widen a 0xFD range-limits descriptor so the new timing is inside it (EDID 1.4 byte-4 +255 offsets honoured).
 * @returns {boolean} true when a byte changed
 */
function widenRangeLimits(edid, off, { hz, hKhz, clockMhz }) {
	const fl = edid[off + 4]
	const read = (i, bit) => edid[off + i] + (fl & bit ? 255 : 0)
	const cur = { minV: read(5, 0x01), maxV: read(6, 0x02), minH: read(7, 0x04), maxH: read(8, 0x08) }
	const next = {
		minV: Math.max(1, Math.min(cur.minV, Math.floor(hz))),
		maxV: Math.max(cur.maxV, Math.ceil(hz)),
		minH: Math.max(1, Math.min(cur.minH, Math.floor(hKhz))),
		maxH: Math.max(cur.maxH, Math.ceil(hKhz)),
	}
	const clk10 = Math.max(edid[off + 9], Math.min(255, Math.ceil(clockMhz / 10)))
	let flags = fl & 0xf0
	const put = (i, v, bit) => {
		const offset = v > 255 ? 255 : 0
		if (offset) flags |= bit
		edid[off + i] = Math.min(255, v - offset)
	}
	const before = Buffer.from(edid.subarray(off, off + 18))
	put(5, next.minV, 0x01)
	put(6, next.maxV, 0x02)
	put(7, next.minH, 0x04)
	put(8, next.maxH, 0x08)
	edid[off + 9] = clk10
	edid[off + 4] = flags
	return !before.equals(edid.subarray(off, off + 18))
}

/**
 * Add WxH@Hz to an EDID as a DTD. Prefers the panel's own blanking (a DTD with the same active size, clock rescaled
 * to htotal·vtotal·Hz — panels tolerate this best); else the given modeline's blanking (CVT/CVT-RB from
 * modeline-timings.js), clock likewise rescaled.
 * @param {Buffer} edid the connector's REAL EDID (base block + extensions)
 * @param {{ width: number, height: number, refreshHz: number, fallbackTimings?: string[] | null }} want
 * @returns {{ ok: true, edid: Buffer, alreadyPresent: boolean, slot?: number, replacedTag?: number, source?: 'panel'|'modeline',
 *   dtd?: Dtd, refreshHz?: number, rangeWidened?: boolean } | { ok: false, error: string }}
 */
function buildForcedModeEdid(edid, want) {
	const v = validateEdid(edid)
	if (!v.ok) return { ok: false, error: v.error }
	const W = Number(want?.width)
	const H = Number(want?.height)
	const hz = Number(want?.refreshHz)
	if (!(W >= 64 && H >= 64 && hz > 0 && hz < 1000)) return { ok: false, error: `bad mode ${W}x${H}@${hz}` }
	const out = Buffer.from(edid)
	const descs = listBaseDescriptors(out)
	const progressive = descs.filter((d) => d.dtd && !(d.dtd.flags & 0x80))
	if (progressive.some((d) => d.dtd.hActive === W && d.dtd.vActive === H && Math.abs(dtdRefreshHz(d.dtd) - hz) < RATE_TOLERANCE_HZ)) {
		return { ok: true, edid: Buffer.from(edid), alreadyPresent: true }
	}
	const sameSize = progressive
		.filter((d) => d.dtd.hActive === W && d.dtd.vActive === H)
		.sort((a, b) => Math.abs(dtdRefreshHz(a.dtd) - hz) - Math.abs(dtdRefreshHz(b.dtd) - hz))
	let base = sameSize.length ? { ...sameSize[0].dtd } : null
	const source = base ? 'panel' : 'modeline'
	if (!base) {
		const size = progressive[0]?.dtd || { hSizeMm: out[21] * 10, vSizeMm: out[22] * 10 }
		base = dtdFromModelineTimings(want.fallbackTimings || [], { hSizeMm: size.hSizeMm, vSizeMm: size.vSizeMm })
		if (!base || base.hActive !== W || base.vActive !== H) {
			return { ok: false, error: `no ${W}x${H} timing in the EDID and no usable modeline to build one from` }
		}
	}
	const htotal = base.hActive + base.hBlank
	const vtotal = base.vActive + base.vBlank
	base.pixelClock10k = Math.round((htotal * vtotal * hz) / 10000)
	let dtdBytes
	try {
		dtdBytes = encodeDtd(base)
	} catch (e) {
		return { ok: false, error: `cannot encode ${W}x${H}@${hz}: ${e.message}` }
	}
	const slot = pickFreeSlot(descs, out)
	if (!slot) {
		return { ok: false, error: 'EDID has no free descriptor slot (no dummy, 0xFE text or 0xFC name descriptor to replace)' }
	}
	const replacedTag = slot.tag
	dtdBytes.copy(out, slot.off)
	const range = descs.find((d) => !d.dtd && d.tag === 0xfd)
	const clockMhz = base.pixelClock10k / 100
	const rangeWidened = range ? widenRangeLimits(out, range.off, { hz, hKhz: (clockMhz * 1000) / htotal, clockMhz }) : false
	out[127] = edidChecksumByte(out)
	const dtd = decodeDtd(out, slot.off)
	return { ok: true, edid: out, alreadyPresent: false, slot: slot.slot, replacedTag, source, dtd, refreshHz: dtdRefreshHz(dtd), rangeWidened }
}

module.exports = {
	RATE_TOLERANCE_HZ,
	edidChecksumByte,
	validateEdid,
	decodeDtd,
	encodeDtd,
	dtdRefreshHz,
	dtdFromModelineTimings,
	listBaseDescriptors,
	buildForcedModeEdid,
}
