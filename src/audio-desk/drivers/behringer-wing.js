'use strict'

/**
 * WO-731 — Behringer WING (full, Compact, Rack): OSC on UDP 2223, `/ch/N/...` without zero padding (Maillot, "WING
 * Remote Protocols"). A query answers `,sff` (text, raw 0..1, value) for floats and `,sfi` for ints: the third value
 * is the one in real units. `fdr` is in dB already (-144 = -∞); `mute` is 1 = muted, the opposite of the X32.
 * The WING does not echo our own sets either; Accept reads back with a query.
 */

const { createOscUdp } = require('./osc-udp')

const value = (args) => (args?.length >= 3 ? args[2].value : args?.[0]?.value)

function create({ host, port }) {
	const link = createOscUdp({ host, port })
	return {
		async probe() {
			// "/?" → "WING,<ip>,<name>,<model>,<serial>,<firmware>"
			const info = String((await link.query('/?'))[0]?.value || '').split(',')
			return [info[3], info[2]].filter(Boolean).join(' · ') || 'WING'
		},
		async getChannel(n) {
			const db = Number(value(await link.query(`/ch/${n}/fdr`)))
			const mute = Number(value(await link.query(`/ch/${n}/mute`)))
			return { on: mute === 0, db: db <= -144 ? -Infinity : db }
		},
		async setOn(n, on) {
			link.send(`/ch/${n}/mute`, [{ type: 'i', value: on ? 0 : 1 }])
		},
		async setDb(n, db) {
			link.send(`/ch/${n}/fdr`, [{ type: 'f', value: db === -Infinity ? -144 : Math.max(-144, Math.min(10, db)) }])
		},
		async names(count) {
			const out = []
			for (let n = 1; n <= count; n++)
				out.push({ channel: n, name: String((await link.query(`/ch/${n}/name`))[0]?.value ?? '') })
			return out
		},
		close: () => link.close(),
	}
}

module.exports = { create }
