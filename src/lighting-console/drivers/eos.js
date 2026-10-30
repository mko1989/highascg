'use strict'

/**
 * WO-837 — ETC Eos family over OSC/UDP (Eos console, Nomad, Ion, Element; the console's "OSC RX Port", UDP).
 * Sources:
 *   Eos OSC Conventions / OSC Dictionary (Eos online help, Show Control > OSC; the pages move between releases):
 *     https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/23_Show_Control/08_OSC/OSC_Dictionary.htm
 *   Eos Family Show Control User Guide (Rev C): https://media.musson.com/mti/docs/e/o/eosfamily_showcontrol_userguide_revc.pdf
 *   ETC support "Triggering Eos from QLab using OSC" (the working examples below, RX port 8000):
 *     https://support.etcconnect.com/ETC/Consoles/Eos_Family/Software_and_Programming/Triggering_Eos_from_QLab_using_OSC
 *     /eos/cue/<list>/<cue>/fire   no argument → fire that cue of that list (e.g. /eos/cue/3/9/fire)
 *     /eos/key/go_0                presses GO
 *     all messages to Eos begin /eos/ ; names are case-insensitive
 *   ETC community (fader banks): https://community.etcconnect.com/control_consoles/eos-family-consoles/f/eos-family/22844/osc-fader-inconsistency/108324
 *     /eos/fader/<bank>/config/<n>  makes a virtual bank of n faders for OSC; /eos/fader/<bank>/<index> float 0.0–1.0 = level
 *   Command line: /eos/newcmd (clears the line first) and /eos/cmd (appends), string argument; a trailing "#" is
 *     the Enter that executes it (Eos serial/OSC command syntax).
 * UNCERTAIN — verify on a real console (phase 3): (1) the docs say a plain "go in cue list N" has no direct OSC
 * address, so go-without-cue and release are sent as command lines ("Cue N Go#", "Cue N Release#");
 * (2) the virtual fader bank must be configured; we send config (at least 10 faders) before every level so it is
 * never missing — ETC forum posts report "invalid fader index" if it was not; (3) ETC's own docs are known to be
 * wrong in places (colour ranges), so the cue-fire / newcmd forms are the ones with a vendor example.
 * `fader` is "<index>" (bank 1) or "<bank>.<index>".
 */

const { S, F } = require('../actions')

module.exports = {
	kind: 'eos',
	label: 'ETC Eos (OSC)',
	defaultPort: 8000,
	messages(_con, a) {
		switch (a.action) {
			case 'go':
				return a.cue != null
					? [{ address: `/eos/cue/${a.list}/${a.cue}/fire`, args: [] }]
					: [{ address: '/eos/newcmd', args: [S(`Cue ${a.list} Go#`)] }]
			case 'fader': {
				const [bank, index] = a.fader.includes('.') ? a.fader.split('.') : ['1', a.fader]
				const n = Math.max(10, parseInt(index, 10))
				return [
					{ address: `/eos/fader/${bank}/config/${n}`, args: [] },
					{ address: `/eos/fader/${bank}/${index}`, args: [F(a.level / 100)] },
				]
			}
			case 'release':
				return [{ address: '/eos/newcmd', args: [S(`Cue ${a.list} Release#`)] }]
			case 'command':
				return [{ address: '/eos/newcmd', args: [S(a.command.endsWith('#') ? a.command : `${a.command}#`)] }]
		}
		throw new Error(`Eos: unsupported action ${a.action}`)
	},
	/** /eos/ping is the documented keep-alive; Eos answers on its TX port, which we do not listen on. */
	testMessages() {
		return [{ address: '/eos/ping', args: [S('HighAsCG')] }]
	},
}
