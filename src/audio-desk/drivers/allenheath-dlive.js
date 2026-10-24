'use strict'

/**
 * WO-731 — Allen & Heath dLive: MIDI over TCP (MixRack 51325, Surface 51328), "dLive MIDI Over TCP/IP Protocol"
 * V1.9 / V2.0. Inputs 1-128 are notes / NRPN MSB 00-7F on the base MIDI channel N (the desk's Utility → Control →
 * MIDI setting, "1 to 5" = N 0).
 *   mute     9N CH 7F|3F, 9N CH 00          (velocity ≥ 40 = muted, 01-3F = unmuted, 00 ignored)
 *   fader    BN 63 CH, BN 62 17, BN 06 LV   LV = (dB + 54) / 64 × 127, 0 = -∞ (0 dB = 6B, -10 dB = 57)
 *   get      F0 00 00 1A 50 10 01 00 0N 05 09 CH F7 (mute) · … 0N 05 0B 17 CH F7 (fader) → the desk answers with
 *            the normal message · … 0N 01 CH F7 (name) → … 0N 02 CH <ASCII> F7
 * Avantis speaks the same set messages but has no documented read, so it is not offered (it cannot honour "never
 * lower a fader that is higher").
 */

const { createMidiTcp } = require('./midi-tcp')

const SYSEX = [0xf0, 0x00, 0x00, 0x1a, 0x50, 0x10, 0x01, 0x00]

const lvToDb = (lv) => (lv === 0 ? -Infinity : (lv * 64) / 127 - 54)
const dbToLv = (db) => (!(db > -54) ? 0 : Math.max(0, Math.min(127, Math.round(((db + 54) / 64) * 127))))

function create({ host, port, midiChannel = 1 }) {
	const N = Math.max(0, Math.min(11, midiChannel - 1))
	const link = createMidiTcp({ host, port })
	const isName = (ch) => (e) => e.kind === 'sysex' && e.bytes[8] === N && e.bytes[9] === 0x02 && e.bytes[10] === ch

	async function name(ch) {
		const e = await link.request([...SYSEX, N, 0x01, ch, 0xf7], isName(ch), `name of input ${ch + 1}`)
		return Buffer.from(e.bytes.slice(11, -1))
			.toString('latin1')
			.replace(/[^\x20-\x7e]/g, '')
			.trim()
	}

	return {
		async probe() {
			const n = await name(0)
			return `dLive · input 1 "${n}"`
		},
		async getChannel(n) {
			const ch = n - 1
			const fader = await link.request(
				[...SYSEX, N, 0x05, 0x0b, 0x17, ch, 0xf7],
				(e) => e.kind === 'nrpn' && e.ch === N && e.msb === ch && e.lsb === 0x17,
				`fader of input ${n}`
			)
			const mute = await link.request(
				[...SYSEX, N, 0x05, 0x09, ch, 0xf7],
				(e) => e.kind === 'note' && e.ch === N && e.note === ch && e.vel > 0,
				`mute of input ${n}`
			)
			return { on: mute.vel < 0x40, db: lvToDb(fader.vc) }
		},
		async setOn(n, on) {
			await link.send([0x90 | N, n - 1, on ? 0x3f : 0x7f, 0x90 | N, n - 1, 0x00])
		},
		async setDb(n, db) {
			await link.send([0xb0 | N, 0x63, n - 1, 0xb0 | N, 0x62, 0x17, 0xb0 | N, 0x06, dbToLv(db)])
		},
		async names(count) {
			const out = []
			for (let ch = 0; ch < count; ch++) out.push({ channel: ch + 1, name: await name(ch) })
			return out
		},
		close: () => link.close(),
	}
}

module.exports = { create, lvToDb, dbToLv, SYSEX }
