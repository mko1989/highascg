/**
 * Auto-follow module web entrypoint (WO-31 / WO-30).
 *
 * Loaded dynamically by `web/lib/optional-modules.js` when the server reports the
 * `autofollow` module as enabled. Receives the shared app context.
 *
 * Current status: stub. Real UI is the per-device calibration wizard + arm/disarm/panic
 * controls + zone editor (shared with the Previs module's side-pane per WO-31 Phase 5).
 */

/**
 * @param {{ stateStore: any, ws: any, api: any }} ctx
 */
export default async function initAutofollowModule(ctx) {
	console.info('[autofollow] module loaded — skeleton; see work/31_WO_STAGE_AUTOFOLLOW_PTZ.md')

	if (ctx && ctx.ws && typeof ctx.ws.on === 'function') {
		ctx.ws.on('autofollow:device', (data) => {
			// TODO WO-31 Phase 5 — update device status pills in the inspector
			console.debug('[autofollow] device update:', data)
		})
		ctx.ws.on('autofollow:state', (data) => {
			// TODO WO-31 Phase 5 — update arm/disarm / panic indicator
			console.debug('[autofollow] state:', data)
		})
	}

	return { ready: true, note: 'skeleton — see WO-31' }
}
