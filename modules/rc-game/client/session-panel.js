/* global document */
/**
 * WO-1125 — wiring of the self-service session panel into this game's lobby and results (the draw code is the RC kit's
 * ctl-panel.js; the state field names live in session-spec.js only).
 */
import { h } from './dom.js'
import { createCtlPanel } from './ctl-panel.js'
import { worldLinkEl } from './world-link.js'
import * as spec from './session-spec.js'

/** @param {object} G game state (G.net, G.scene) @param {HTMLElement} slot the lobby's slot  @returns the panel */
export function createSessionPanel(G, slot) {
	const panel = createCtlPanel({
		h,
		send: (m) => G.net?.send(m) ?? false,
		spec,
		ctx: () => ({ scene: G.scene }),
		worldEl: worldLinkEl('ghost world-link'),
	})
	slot.append(panel.el)
	document.body.append(panel.resultsEl)
	return panel
}
