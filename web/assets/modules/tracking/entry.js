/**
 * Tracking module web entrypoint (WO-19 / WO-30).
 *
 * Loaded dynamically by `web/lib/optional-modules.js` when the server reports the `tracking`
 * module as enabled. Receives the shared app context.
 *
 * Current status: stub. Real UI is the inspector calibration wizard + zone editor under
 * the Previs side-pane (WO-19 Phase 5). Most of this module is headless — inference runs
 * server-side and the UI just visualises `tracking:persons` WS broadcasts.
 */

/**
 * @param {{ stateStore: any, ws: any }} ctx
 */
export default async function initTrackingModule(ctx) {
	console.info('[tracking] module loaded — skeleton; see work/19_WO_PERSON_TRACKING.md')

	if (ctx && ctx.ws && typeof ctx.ws.on === 'function') {
		ctx.ws.on('tracking:persons', (data) => {
			// TODO WO-19 Phase 5 — render person markers over the 3D previs floor plane
			if (data && Array.isArray(data.persons) && data.persons.length > 0) {
				console.debug('[tracking] persons frame:', data.persons.length)
			}
		})
	}

	return { ready: true, note: 'skeleton — see WO-19' }
}
