/**
 * CG Studio — launcher-hosted module (no playout server process).
 *
 * The studio HTTP server runs inside the Electron launcher on the operator machine.
 * Template files are read/written under the linked HighAsCG server checkout `template/`.
 */

'use strict'

module.exports = {
	name: 'cg-studio',

	onBoot(ctx) {
		if (ctx && typeof ctx.log === 'function') {
			ctx.log(
				'info',
				'[cg-studio] launcher-hosted — enable in Electron launcher Modules tab; not started on playout server',
			)
		}
	},
}
