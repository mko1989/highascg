'use strict'

/**
 * WO-731 — Allen & Heath SQ5 / SQ6 / SQ7: MIDI over TCP 51325, "SQ MIDI Protocol" Issue 3. Everything is NRPN on
 * the desk's MIDI channel N (Utility → General → MIDI):
 *   set      BN 63 MB, BN 62 LB, BN 06 VC, BN 26 VF
 *   get      BN 63 MB, BN 62 LB, BN 60 7F → the desk answers with the set message
 *   input n mute      MB 00, LB n-1   VC 00, VF 01 = muted / 00 = unmuted
 *   input n level→LR  MB 40, LB n-1   14-bit (VC << 7 | VF); with the desk's NRPN fader law on **Linear Taper**:
 *                     dB = (v - 15196) / 118.72, fitted to the PDF table (every row +10 … -89 dB exact), 0 = -∞
 * The fader law cannot be read over MIDI: the page asks the operator to set Linear Taper. SQ has no name read.
 */

const { createMidiTcp } = require('./midi-tcp')

const valueToDb = (v) => {
	if (v === 0) return -Infinity
	const db = (v - 15196) / 118.72
	return db < -89 ? -Infinity : Math.min(10, db)
}
const dbToValue = (db) =>
	!(db >= -89) ? 0 : Math.max(0, Math.min(16383, Math.round(15196 + Math.min(10, db) * 118.72)))

function create({ host, port, midiChannel = 1 }) {
	const N = Math.max(0, Math.min(15, midiChannel - 1))
	const link = createMidiTcp({ host, port })
	const B = 0xb0 | N

	const get = (msb, lsb, what) =>
		link.request(
			[B, 0x63, msb, B, 0x62, lsb, B, 0x60, 0x7f],
			(e) => e.kind === 'nrpn' && e.ch === N && e.msb === msb && e.lsb === lsb && e.vf !== undefined,
			what
		)
	const set = (msb, lsb, vc, vf) => link.send([B, 0x63, msb, B, 0x62, lsb, B, 0x06, vc, B, 0x26, vf])

	return {
		async probe() {
			const m = await get(0x00, 0x00, 'mute of input 1')
			return `SQ · input 1 ${m.vf ? 'muted' : 'on'}`
		},
		async getChannel(n) {
			const level = await get(0x40, n - 1, `level of input ${n}`)
			const mute = await get(0x00, n - 1, `mute of input ${n}`)
			return { on: mute.vf === 0, db: valueToDb((level.vc << 7) | level.vf) }
		},
		async setOn(n, on) {
			await set(0x00, n - 1, 0x00, on ? 0x00 : 0x01)
		},
		async setDb(n, db) {
			const v = dbToValue(db)
			await set(0x40, n - 1, (v >> 7) & 0x7f, v & 0x7f)
		},
		async names(count) {
			return Array.from({ length: count }, (_, i) => ({ channel: i + 1, name: '' }))
		},
		close: () => link.close(),
	}
}

module.exports = { create, valueToDb, dbToValue }
