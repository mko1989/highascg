/**
 * Shared cable hook button (WO-42): same behavior as connector dot for arm/complete.
 */

/**
 * @param {HTMLElement} portEl
 * @param {{ connectorId: string, portKey: string, data?: object, onPortStartCable?: function }} opts
 */
export function appendCableAffordance(portEl, opts) {
	const { connectorId, portKey, data, onPortStartCable } = opts
	if (!portEl || !connectorId) return

	const btn = document.createElement('button')
	btn.type = 'button'
	btn.className = 'device-view__cable-affordance'
	btn.title = 'Start or complete cable at this connector'
	btn.setAttribute('data-connector-id', connectorId)
	btn.innerHTML = '+' // elegant plus icon

	btn.addEventListener('click', (ev) => {
		ev.preventDefault()
		ev.stopPropagation()
		if (onPortStartCable) {
			onPortStartCable(portKey, connectorId, data)
		}
	})

	portEl.appendChild(btn)
}
