'use strict'

/**
 * WO-837 — grandMA3 over OSC/UDP (Menu > In & Out > OSC: Enable Input, Port, Mode UDP, Receive / Receive Command = Yes).
 * Source: grandMA3 User Manual, "Remote Inputs — OSC":
 *   https://help.malighting.com/grandMA3/2.1/HTML/remote_inputs_osc.html   (same page for 2.0 / 2.2 / 2.3)
 *   https://help.malighting.com/grandMA3/2.1/HTML/keyword_sendosc.html     (SendOSC keyword)
 *   message  (/prefix)/<OSC address>,<type>,<value>   — the prefix is optional, has no slashes, and when set on the
 *            console only messages starting with it are processed (console record field `prefix`)
 *   /Page1/Fader201,i,100          executor 201 on page 1 to 100 (a fade time as 2nd int: /Page1/Fader201,ii,100,5)
 *   /cmd,s,<text>                  a full command-line string (needs "Receive Command" = Yes on that OSC line)
 * Address words Page / Fader are case-sensitive. The manual's SendOSC page says an executor needs its page; version
 * 2.2 text also shows a page-less /Fader201 — we always send the page-qualified form.
 * UNCERTAIN: the command-line keywords below (Go+, Goto Cue, Off, Sequence/Executor) are standard MA3 syntax but were not
 * run against a console here. `list` is a sequence number ("3") or an executor "<page>.<number>" ("1.101");
 * `fader` is "<number>" (page 1) or "<page>.<number>" ("2.201").
 */

const { I, S } = require('../actions')

const target = (list) => (list.includes('.') ? `Executor ${list}` : `Sequence ${list}`)

module.exports = {
	kind: 'grandma3',
	label: 'MA Lighting grandMA3 (OSC)',
	defaultPort: 8000,
	messages(con, a) {
		const pre = con.prefix ? `/${con.prefix}` : ''
		const cmd = (text) => [{ address: `${pre}/cmd`, args: [S(text)] }]
		switch (a.action) {
			case 'go':
				return cmd(a.cue != null ? `Goto Cue ${a.cue} ${target(a.list)}` : `Go+ ${target(a.list)}`)
			case 'fader': {
				const [page, num] = a.fader.includes('.') ? a.fader.split('.') : ['1', a.fader]
				return [{ address: `${pre}/Page${page}/Fader${num}`, args: [I(a.level)] }]
			}
			case 'release':
				return cmd(`Off ${target(a.list)}`)
			case 'command':
				return cmd(a.command)
		}
		throw new Error(`grandMA3: unsupported action ${a.action}`)
	},
	/** Echo only prints to the MA3 system monitor. */
	testMessages(con) {
		return [{ address: `${con.prefix ? `/${con.prefix}` : ''}/cmd`, args: [S('Echo "HighAsCG link test"')] }]
	},
}
