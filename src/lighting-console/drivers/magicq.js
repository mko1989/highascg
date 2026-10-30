'use strict'

/**
 * WO-837 — ChamSys MagicQ over OSC/UDP.
 * Source (the vendor manual, "MagicQ OSC Addresses" table, Receiving Messages):
 *   https://docs.chamsys.co.uk/magicq/1.9.9.x/manual/OSC.html   (older URL redirects there; also secure.chamsys.co.uk/docs/magicq/manual/OSC.html)
 *   /pb/<playback>             float 0.0–1.0 or int 0–100 → playback fader level
 *   /pb/<playback>/go          optional non-zero value → Go
 *   /pb/<playback>/release     optional non-zero value → release
 *   /pb/<playback>/<cue>       optional non-zero value → jump to cue (cue may carry a decimal, "2.5")
 *   /rpc                       string argument → ChamSys Remote Protocol commands
 *     (https://docs.chamsys.co.uk/magicq/manual/remote_control_commands.html)
 *   /feedback/off              no argument → turns OSC feedback off (our harmless test message)
 * The manual recommends 8000 receive / 9000 transmit; ports are set in Setup > View Settings > Network (OSC Rx Port).
 * Docs notes: PC/Mac MagicQ answers playbacks 1–10 only (consoles all 202); OSC is UDP only; the MQ40/MQ40N have none.
 * UNCERTAIN: "jump to cue" is documented as a jump, not as an activate — a released playback may need a /go first
 * (a 2017 QLab thread reports the stack stays inactive). We implement the documented form: go to a cue = jump.
 */

const { I, S } = require('../actions')

module.exports = {
	kind: 'magicq',
	label: 'ChamSys MagicQ (OSC)',
	defaultPort: 8000,
	/** @returns {{ address: string, args: object[] }[]} */
	messages(_con, a) {
		switch (a.action) {
			case 'go':
				return a.cue != null ? [{ address: `/pb/${a.list}/${a.cue}`, args: [I(1)] }] : [{ address: `/pb/${a.list}/go`, args: [I(1)] }]
			case 'fader':
				return [{ address: `/pb/${a.fader}`, args: [I(a.level)] }]
			case 'release':
				return [{ address: `/pb/${a.list}/release`, args: [I(1)] }]
			case 'command':
				return [{ address: '/rpc', args: [S(a.command)] }]
		}
		throw new Error(`MagicQ: unsupported action ${a.action}`)
	},
	/** UDP has no answer, so a test only proves the datagram left this machine. */
	testMessages() {
		return [{ address: '/feedback/off', args: [] }]
	},
}
