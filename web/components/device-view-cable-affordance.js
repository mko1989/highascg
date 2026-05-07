/**
 * Shared cable hook button (WO-42): same behavior as connector dot for arm/complete.
 */

const CABLE_ICON_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M14 5v2h-2.5c-.55 0-1 .45-1 1v2c0 1.1-.9 2-2 2H7v2H5v-2H3c-1.1 0-2-.9-2-2V9c0-1.1.9-2 2-2h6V5h2zm-9 4H3v2h2V9zm6 0H7v2h4V9zM11 3h2v2h-2V3z"/></svg>'

/**
 * @param {HTMLElement} portEl
 * @param {{ connectorId: string, portKey: string, data?: object, onPortStartCable?: function }} opts
 */
export function appendCableAffordance(portEl, opts) {
	// Disabled as requested: "remove that for now. it doesnt work"
}
