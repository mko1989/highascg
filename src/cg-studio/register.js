/**
 * CG Studio — launcher-hosted module (no playout server process).
 *
 * CG Studio — optional Electron launcher module (highascg-client packaging).
 * Operator UI: client/ → dist-web/ on playout :4200 in this unified repo.
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
