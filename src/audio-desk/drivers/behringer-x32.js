'use strict'

/**
 * WO-731 — Behringer X32 / Midas M32 (UDP 10023) and X Air / Midas MR (UDP 10024): OSC, `/ch/NN/...` with two-digit
 * channel numbers. `mix/on` is 1 = unmuted. The fader is a float 0..1 on Behringer's 4-segment law (Maillot, "X32 OSC
 * Remote Protocol", float ↔ dB). The desk does not echo our own sets, so Accept reads back with a query.
 */

const { createOscUdp } = require('./osc-udp')

/** float 0..1 → dB (0 → -∞). */
function floatToDb(f) {
	if (!(f > 0)) return -Infinity
	if (f >= 0.5) return f * 40 - 30
	if (f >= 0.25) return f * 80 - 50
	if (f >= 0.0625) return f * 160 - 70
	return f * 480 - 90
}

/** dB → float 0..1 (the desk snaps to its 1024 steps). */
function dbToFloat(db) {
	if (!(db > -90)) return 0
	if (db >= 10) return 1
	if (db >= -10) return (db + 30) / 40
	if (db >= -30) return (db + 50) / 80
	if (db >= -60) return (db + 70) / 160
	return (db + 90) / 480
}

const pad = (n) => String(n).padStart(2, '0')
const first = (args) => args?.[0]?.value

function create({ host, port }) {
	const link = createOscUdp({ host, port })
	return {
		async probe() {
			// /info → ",ssss" server version, "osc-server", model, firmware (e.g. V2.05 osc-server X32C 2.08)
			const a = await link.query('/info')
			return [a[2]?.value, a[3]?.value && `firmware ${a[3].value}`].filter(Boolean).join(' · ')
		},
		async getChannel(n) {
			const f = first(await link.query(`/ch/${pad(n)}/mix/fader`))
			const on = first(await link.query(`/ch/${pad(n)}/mix/on`))
			return { on: on === 1, db: floatToDb(Number(f)) }
		},
		async setOn(n, on) {
			link.send(`/ch/${pad(n)}/mix/on`, [{ type: 'i', value: on ? 1 : 0 }])
		},
		async setDb(n, db) {
			link.send(`/ch/${pad(n)}/mix/fader`, [{ type: 'f', value: dbToFloat(db) }])
		},
		async names(count) {
			const out = []
			for (let n = 1; n <= count; n++)
				out.push({ channel: n, name: String(first(await link.query(`/ch/${pad(n)}/config/name`)) ?? '') })
			return out
		},
		close: () => link.close(),
	}
}

module.exports = { create, floatToDb, dbToFloat }
